/**
 * `subsystem move` and `subsystem rename` — ONE transaction over N directory
 * renames plus the generated views file, the first real consumer of the
 * journaled txn's moves half (`core/staging/txn/`). The planning lives in
 * this module; the commit window itself is `./txn/txn.ts`, shared with
 * `new` and `rm`.
 *
 * The ONLY move-specific refusal is `move-uncommitted` — git reports
 * uncommitted changes under a directory being moved — and only on positive
 * evidence: where git will not say, the move proceeds. After a landed move
 * loam performs the roadmap's one blessed git write, a best-effort `git add`
 * of the rename pairs and the regenerated views file, so git records the
 * renames as renames and `subsystem history` stays answerable once the user
 * commits. Nothing is ever committed.
 */
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { serviceDirOf } from "../../core/kernel/ids/dirs.js";
import { parseSubsystemName } from "../../core/kernel/ids/subsystem.js";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { gitDirtyPaths, gitStageRenames } from "../../core/provenance/gitq/moves.js";
import { servicesDir, subsystemViewsPath } from "../../core/repo/paths.js";
import { findInTree, nearestTreeNames, treeNames, withinSubsystem } from "../../core/repo/tree/find.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { commitWindow, reportViews, type SubsystemTxn } from "./txn/txn.js";

/** What one name resolved to for a move: where it is, and where it goes. */
interface Moved {
  name: string;
  kind: "service" | "subsystem";
  dir: string;
  /** Path of the CONTAINING directory, as names from services/ down. */
  parent: string[];
}

/** `subsystem move <name>... --into <sub|.>` — services and whole subtrees alike. */
export async function runMove(docsDir: DocsDir, names: string[], into: string, json: boolean): Promise<void> {
  await commitWindow(docsDir, json, async (tree): Promise<SubsystemTxn | null> => {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) {
        fail(json, "invalid-option", `'${name}' is named twice — each service or subsystem moves once.`);
        return null;
      }
      seen.add(name);
    }
    const target = resolveTarget(tree, into, { docsDir, json });
    if (target === null) return null;
    const moved: Moved[] = [];
    for (const name of names) {
      const hit = findInTree(tree, name);
      if (hit === null) {
        const close = nearestTreeNames(name, treeNames(tree));
        fail(
          json,
          "unknown-target",
          `No service or subsystem '${name}' in the tree.` +
            (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " `loam subsystem list` shows what exists."),
        );
        return null;
      }
      moved.push(
        hit.kind === "service"
          ? { name, kind: "service", dir: hit.service.dir, parent: hit.service.subsystem }
          : { name, kind: "subsystem", dir: hit.subsystem.dir, parent: hit.subsystem.path.slice(0, -1) },
      );
    }
    for (const m of moved) {
      if (m.kind === "subsystem" && withinSubsystem({ ...dummy, name: m.name, path: [...m.parent, m.name] }, target.path)) {
        fail(json, "invalid-option", `'${m.name}' cannot move into itself or its own subtree.`);
        return null;
      }
      if (m.parent.join("/") === target.path.join("/")) {
        fail(json, "invalid-option", `'${m.name}' is already directly in ${into === "." ? "the services/ root" : `'${into}'`} — nothing to move.`);
        return null;
      }
      const inside = moved.find(
        (other) => other.kind === "subsystem" && other !== m && (m.dir + sep).startsWith(other.dir + sep),
      );
      if (inside !== undefined) {
        fail(json, "invalid-option", `'${m.name}' sits inside '${inside.name}', which is also being moved — name only the subtree root.`);
        return null;
      }
      if (existsSync(join(target.dir, m.name))) {
        // Unreachable in a healthy flat namespace; a tree already carrying
        // name collisions can produce it, and refusing beats stacking a
        // second directory of the same name.
        fail(json, "already-exists", `${repoPath(docsDir, join(target.dir, m.name))} already exists — fix the name collision first.`);
        return null;
      }
    }
    if (await refuseUncommitted(docsDir, moved.map((m) => m.dir), json)) return null;
    const renames = moved.map((m) => ({ from: m.dir, to: join(target.dir, m.name) }));
    return {
      target: names.join(", "),
      writes: [],
      tree: movedTree(tree, renames, servicesDir(docsDir)),
      moves: renames,
      failedCode: "move-failed",
      what: "moved",
      report: async (views, recovered) => {
        await stageInGit(docsDir, renames);
        const rows = moved.map((m, i) => ({
          name: m.name,
          kind: m.kind,
          from: repoPath(docsDir, renames[i]!.from),
          to: repoPath(docsDir, renames[i]!.to),
        }));
        if (json) {
          emitJson({ into, moved: rows, views, ...(recovered === null ? {} : { recovered }) });
          return;
        }
        for (const row of rows) console.log(`moved ${row.from} -> ${row.to}`);
        console.log(`Renames staged where git answers; nothing committed${reportViews(views)}.`);
      },
    };
  });
}

/** `subsystem rename <old> <new>` — one rename through the same transaction. */
export async function runRename(docsDir: DocsDir, names: [string, string], json: boolean): Promise<void> {
  const [from, to] = names;
  await commitWindow(docsDir, json, async (tree): Promise<SubsystemTxn | null> => {
    const hit = findInTree(tree, from);
    if (hit === null) {
      const close = nearestTreeNames(from, tree.subsystems.map((s) => s.name));
      fail(
        json,
        "unknown-target",
        `No subsystem '${from}' in the tree.` + (close.length > 0 ? ` Close names: ${close.join(", ")}.` : ""),
      );
      return null;
    }
    if (hit.kind === "service") {
      fail(
        json,
        "invalid-option",
        `'${from}' is a service — a service's id IS its identity (loam.json, frontmatter, feature specs all join on it), so loam never renames one.`,
      );
      return null;
    }
    const parsed = parseSubsystemName(to, "subsystem name");
    if (!parsed.ok) {
      fail(json, "invalid-option", parsed.problem);
      return null;
    }
    const taken = findInTree(tree, to);
    if (taken !== null) {
      const where = taken.kind === "service" ? taken.service.dir : taken.subsystem.dir;
      fail(json, "already-exists", `'${to}' is already a ${taken.kind} (${repoPath(docsDir, where)}) — the namespace is flat at any depth.`);
      return null;
    }
    if (await refuseUncommitted(docsDir, [hit.subsystem.dir], json)) return null;
    const rename = { from: hit.subsystem.dir, to: join(hit.subsystem.dir, "..", to) };
    return {
      target: `${from} -> ${to}`,
      writes: [],
      tree: movedTree(tree, [rename], servicesDir(docsDir)),
      moves: [rename],
      failedCode: "move-failed",
      what: "renamed",
      report: async (views, recovered) => {
        await stageInGit(docsDir, [rename]);
        if (json) {
          emitJson({
            renamed: from,
            to,
            path: repoPath(docsDir, rename.to),
            views,
            ...(recovered === null ? {} : { recovered }),
          });
          return;
        }
        console.log(`renamed subsystem '${from}' -> '${to}' (${repoPath(docsDir, rename.to)}/)${reportViews(views)}`);
      },
    };
  });
}

/** A placeholder SubsystemEntry shape for `withinSubsystem` — only `path` is read. */
const dummy = { name: "", path: [] as string[], dir: "", meta: {} };

/** Where `--into` points: the services/ root for `.`, an existing subsystem otherwise. */
function resolveTarget(
  tree: FleetTree,
  into: string,
  at: { docsDir: DocsDir; json: boolean },
): { dir: string; path: string[] } | null {
  if (into === ".") return { dir: servicesDir(at.docsDir), path: [] };
  const hit = findInTree(tree, into);
  if (hit === null) {
    const close = nearestTreeNames(into, tree.subsystems.map((s) => s.name));
    fail(
      at.json,
      "unknown-target",
      `No subsystem '${into}' to move into.` +
        (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " `--into .` unfiles; `loam subsystem new` creates."),
    );
    return null;
  }
  if (hit.kind === "service") {
    fail(at.json, "invalid-option", `--into names the service '${into}' — a service never contains other services.`);
    return null;
  }
  return { dir: hit.subsystem.dir, path: hit.subsystem.path };
}

/**
 * The one move-specific refusal, on positive evidence only: git names
 * uncommitted work under a directory about to be renamed. Null (git will not
 * say) proceeds — a fleet that does not use git must not be refused over it.
 */
async function refuseUncommitted(docsDir: DocsDir, dirs: string[], json: boolean): Promise<boolean> {
  const dirty = await gitDirtyPaths(
    docsDir,
    dirs.map((d) => repoPath(docsDir, d)),
  );
  if (dirty === null || dirty.length === 0) return false;
  fail(
    json,
    "move-uncommitted",
    `git reports uncommitted changes under the directory(ies) being moved: ${dirty.join(", ")}. ` +
      "Renaming now would sweep those edits into a move nobody reviewed — commit or stash them, then re-run. " +
      "Nothing was moved.",
  );
  return true;
}

/**
 * Stage the move's whole delta, silently: the rename pairs (both ends — the
 * delete side and the add side) AND the regenerated views file. The views
 * file rides along for the same reason the transaction writes it in the same
 * commit: a user whose next `git commit` captured the renames without it
 * would commit a tree `validate --all` fails (`subsystem.views-stale`) — the
 * exact "failing between two commits" state the roadmap forbids.
 */
async function stageInGit(docsDir: DocsDir, renames: { from: string; to: string }[]): Promise<void> {
  await gitStageRenames(docsDir, [
    ...renames.flatMap((r) => [repoPath(docsDir, r.from), repoPath(docsDir, r.to)]),
    repoPath(docsDir, subsystemViewsPath(docsDir)),
  ]);
}

/**
 * The tree AS THE RENAMES LEAVE IT, computed in memory: every dir under a
 * moved root is remapped by prefix, and each entry's placement chain is
 * re-derived from its remapped dir. The views file is rendered from this, so
 * the commit lands file and renames agreeing — never from a re-walk that
 * would have to happen between two states.
 */
function movedTree(tree: FleetTree, renames: { from: string; to: string }[], servicesRoot: string): FleetTree {
  const remap = (dir: string): string => {
    for (const r of renames) {
      if (dir === r.from || dir.startsWith(r.from + sep)) return r.to + dir.slice(r.from.length);
    }
    return dir;
  };
  const chainOf = (dir: string): string[] => relative(servicesRoot, dir).split(sep);
  return {
    findings: tree.findings,
    services: tree.services.map((s) => {
      const dir = remap(s.dir);
      // The constructor call records provenance: a readdir-established
      // directory carried through a rename this same commit performs.
      return { ...s, dir: serviceDirOf(dir), subsystem: chainOf(dir).slice(0, -1) };
    }),
    subsystems: tree.subsystems.map((s) => {
      const dir = remap(s.dir);
      return { ...s, dir, path: chainOf(dir) };
    }),
  };
}
