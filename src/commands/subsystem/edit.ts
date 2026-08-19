/**
 * The two verbs that create and remove GROUPS: `subsystem new` and
 * `subsystem rm`. Both commit the marker AND the regenerated views file in
 * one journaled transaction, because a marker without its view (or a view
 * outliving its marker) is exactly the `subsystem.views-stale` state the
 * generated file's contract refuses to leave behind.
 *
 * `rm` refuses a subsystem with members — services, child subsystems, or any
 * stray non-dot file beside the marker — naming them (`subsystem-not-empty`):
 * a destructive command never picks targets the caller did not name, and a
 * directory emptied of its marker but not of its contents would re-enter the
 * walk as a phantom service.
 */
import { existsSync } from "node:fs";
import { readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { parseSubsystemName } from "../../core/kernel/ids/subsystem.js";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { servicesDir } from "../../core/repo/paths.js";
import { findInTree, nearestTreeNames, servicesUnder, subsystemsUnder } from "../../core/repo/tree/find.js";
import { SUBSYSTEM_MARKER } from "../../core/repo/tree/marker.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { planWrite } from "../../core/staging/writes.js";
import { commitWindow, reportViews, type SubsystemTxn } from "./txn/txn.js";
import type { SubsystemOptions } from "./subsystem.js";

/** `subsystem new <name> [--under <parent>] [--title …] [--description …] [--owner …]` */
export async function runNew(
  docsDir: DocsDir,
  name: string,
  opts: SubsystemOptions,
  json: boolean,
): Promise<void> {
  const parsed = parseSubsystemName(name, "subsystem name");
  if (!parsed.ok) {
    fail(json, "invalid-option", parsed.problem);
    return;
  }
  await commitWindow(docsDir, json, async (tree): Promise<SubsystemTxn | null> => {
    // The flat namespace: one name, one meaning, at any depth — a `new` that
    // collides with ANY service or subsystem would be the exact state
    // `subsystem.name-collision` refuses after the fact.
    const taken = findInTree(tree, name);
    if (taken !== null) {
      const where = taken.kind === "service" ? taken.service.dir : taken.subsystem.dir;
      fail(
        json,
        "already-exists",
        `'${name}' is already a ${taken.kind} (${repoPath(docsDir, where)}) — ` +
          `service ids and subsystem names share one flat namespace, unique at any depth. Pick another name.`,
      );
      return null;
    }
    let parentDir = servicesDir(docsDir);
    let parentPath: string[] = [];
    if (opts.under !== undefined) {
      const parent = findInTree(tree, opts.under);
      if (parent === null) {
        const close = nearestTreeNames(opts.under, tree.subsystems.map((s) => s.name));
        fail(
          json,
          "unknown-target",
          `No subsystem '${opts.under}' in the tree.` +
            (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " `loam subsystem list` shows what exists."),
        );
        return null;
      }
      if (parent.kind === "service") {
        fail(json, "invalid-option", `--under names the service '${opts.under}' — a service never contains subsystems.`);
        return null;
      }
      parentDir = parent.subsystem.dir;
      parentPath = parent.subsystem.path;
    }
    const dir = join(parentDir, name);
    const meta = {
      ...(opts.title === undefined ? {} : { title: opts.title }),
      ...(opts.description === undefined ? {} : { description: opts.description }),
      ...(opts.owner === undefined ? {} : { owner: opts.owner }),
    };
    // An empty file is a valid marker — presence classifies, content is metadata.
    const marker = Object.keys(meta).length === 0 ? "" : stringify(meta);
    const after: FleetTree = {
      ...tree,
      subsystems: [...tree.subsystems, { name, path: [...parentPath, name], dir, meta }],
    };
    return {
      target: name,
      writes: [planWrite(join(dir, SUBSYSTEM_MARKER), marker)],
      tree: after,
      // A lost exclusive-create race on the marker IS the name being taken.
      racedCode: "already-exists",
      what: "created",
      report: (views, recovered) => {
        if (json) {
          emitJson({
            created: name,
            path: repoPath(docsDir, dir),
            views,
            ...(recovered === null ? {} : { recovered }),
          });
          return;
        }
        console.log(`created ${repoPath(docsDir, dir)}/ (${SUBSYSTEM_MARKER} written)${reportViews(views)}`);
      },
    };
  });
}

/** `subsystem rm <name>` — refuses anything but an empty group. */
export async function runRm(docsDir: DocsDir, name: string, json: boolean): Promise<void> {
  await commitWindow(docsDir, json, async (tree): Promise<SubsystemTxn | null> => {
    const hit = findInTree(tree, name);
    if (hit === null) {
      const close = nearestTreeNames(name, tree.subsystems.map((s) => s.name));
      fail(
        json,
        "unknown-target",
        `No subsystem '${name}' in the tree.` +
          (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " `loam subsystem list` shows what exists."),
      );
      return null;
    }
    if (hit.kind === "service") {
      fail(
        json,
        "invalid-option",
        `'${name}' is a service, not a subsystem — loam does not delete services (\`git rm -r ${repoPath(docsDir, hit.service.dir)}\` does, and version control keeps the record).`,
      );
      return null;
    }
    const sub = hit.subsystem;
    const services = servicesUnder(tree, sub).map((s) => s.id);
    const children = subsystemsUnder(tree, sub).map((s) => s.name);
    // Stray non-dot files beside the marker count as members too: after the
    // marker is gone the directory would re-enter the walk as an empty
    // "service" the moment anything keeps rmdir from removing it.
    const strays = (await readdir(sub.dir, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith(".") && e.name !== SUBSYSTEM_MARKER)
      .map((e) => e.name);
    const members = [
      ...services.map((s) => `service ${s}`),
      ...children.map((c) => `subsystem ${c}`),
      ...strays.map((f) => `file ${f}`),
    ];
    if (members.length > 0) {
      fail(
        json,
        "subsystem-not-empty",
        `'${name}' still holds ${members.length} member(s): ${members.join(", ")}. ` +
          "`loam subsystem move <name>... --into <sub|.>` moves them out; a destructive command never picks targets you did not name.",
      );
      return null;
    }
    const after: FleetTree = { ...tree, subsystems: tree.subsystems.filter((s) => s !== sub) };
    return {
      target: name,
      writes: [{ path: join(sub.dir, SUBSYSTEM_MARKER), content: null }],
      tree: after,
      what: "removed",
      report: async (views, recovered) => {
        // The directory itself, after the transaction: the marker is gone, the
        // group was verifiably empty, and an empty marker-less directory would
        // read as an unfiled service. Dotfile litter (.DS_Store) can still
        // defeat rmdir — reported, not swallowed.
        let directoryRemoved = true;
        try {
          await rmdir(sub.dir);
        } catch {
          directoryRemoved = !existsSync(sub.dir);
        }
        if (json) {
          emitJson({
            removed: name,
            path: repoPath(docsDir, sub.dir),
            directoryRemoved,
            views,
            ...(recovered === null ? {} : { recovered }),
          });
          return;
        }
        console.log(`removed subsystem '${name}' (${repoPath(docsDir, sub.dir)}/)${reportViews(views)}`);
        if (!directoryRemoved) {
          console.log(
            `note: the directory itself could not be removed (something non-loam is still inside) — ` +
              `until it is deleted by hand it will list as an empty unfiled service.`,
          );
        }
      },
    };
  });
}
