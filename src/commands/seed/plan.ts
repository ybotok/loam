/**
 * What a seed run will write, decided in full before a byte lands. Split from
 * `./commit.ts` on the phase seam: that module owns the WINDOW — the lock, the
 * interrupted-commit recovery, the two refusals and the transaction — while
 * this one answers the single question "given the tree as it is and the fleet
 * file as it reads, which files change and how". Nothing here acquires
 * anything, and nothing here writes: it is called under the lock and hands
 * back a plan the transaction executes or rolls back whole.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { architectureDir } from "../../core/c4/project/architecture.js";
import { architectureDocuments } from "../../core/c4/project/documents.js";
import { loadProject } from "../../core/c4/project/load.js";
import type { FleetSeed } from "../../core/c4/seed/fleet-file.js";
import { serviceDirOf, type DocsDir } from "../../core/kernel/ids/dirs.js";
import {
  landscapePath,
  servicePathsUnder,
  servicesDir,
  subsystemPathUnder,
  subsystemViewsPath,
  unfiledServicePaths,
} from "../../core/repo/paths.js";
import { SUBSYSTEM_MARKER } from "../../core/repo/tree/marker.js";
import { type MapFacts, renderSubsystemViews, viewsAgree } from "../../core/repo/tree/render/views.js";
import type { FleetTree, SubsystemEntry, WalkedService } from "../../core/repo/tree/walk.js";
import { TEMP_FILE_RE } from "../../core/staging/commit.js";
import { planWrite, type PlannedWrite } from "../../core/staging/writes.js";

/** Everything the plan reads. The commit request extends this and adds only `rerun`. */
export interface SeedPlanInput {
  docsDir: DocsDir;
  seed: FleetSeed;
  /** The sealed landscape text (stamp on line 1), already proven to parse. */
  landscape: string;
  /**
   * That same text's parsed facts — the loadSource self-check's output. They
   * were first reused for the views join on their own, on the reasoning that
   * the seed template declares no `global` block (`core/c4/seed/template.ts`)
   * and so the render's style question had the answer "none"; true of the
   * template and beside the point, because `validate --all` recomputes the
   * expected bytes from the whole `architecture/` PROJECT, and a palette in a
   * sibling document is in that census (`projectFacts` below carries the
   * defect). They are now the render's input only when the landscape IS the
   * whole project — no sibling document exists — and the fallback when the
   * project does not parse.
   */
  map: MapFacts;
}

/**
 * The facts the generated views are rendered from: the `architecture/` PROJECT
 * as this commit leaves it — the sealed landscape standing in for the file it is
 * about to become, beside every other `.likec4` the directory already holds —
 * and never the sealed landscape alone.
 *
 * WHY THE PROJECT. `subsystem.views-stale` (`validate --all`) and `loam
 * subsystem sync` both recompute the expected bytes from `loadArchitecture` —
 * the landscape merged with every other `architecture/**` document, the
 * generated file excluded — and the render asks that document set which global
 * style ids it declares. A repository's `global { styleGroup subsystems { … } }`
 * naturally lives in a sibling such as `architecture/usecases/palette.likec4`,
 * since seed regenerates the landscape wholesale, so it was in the grader's
 * census and not in seed's: a seed into such a repo wrote a views file the very
 * next `validate --all` — seed's own first `next` command — graded stale, and
 * re-seeding wrote the same bytes again, the one loop no `next` could leave.
 * Reading the same documents the grader reads is what makes the shared render
 * shared in fact rather than in name (commands/subsystem/txn/views.ts's banner).
 *
 * NO SIBLING, NO WORKSPACE: the landscape's own facts, already in hand from the
 * self-check, ARE the project's, and the common case pays one readdir.
 *
 * STAGED, for `core/c4/project/staged.ts`'s reason: `loadProject` copies
 * documents from disk keyed on their path relative to a base, and the landscape
 * here exists only in memory. That module's staging is bound to a feature's
 * merge preview, so the same handful of copies is made here once more — the
 * temp tree is gone before this returns, and nothing under the docs repo is
 * touched.
 *
 * FAIL CLOSED to the landscape's own facts. A project that does not parse (a
 * sibling carrying an error of its own, or a copy the temp directory refused)
 * declares nothing loam can rely on, so the render carries exactly what it
 * carried before the project was asked, and the seed still lands: that sibling
 * is `landscape.invalid`'s to name on the next `validate --all`, and a seed
 * refusing over it would make seed the first command to grade a file it does
 * not own. Nothing is hidden by the fallback: the grader compares the views
 * file only once the project has parsed (`validate/fleet/landscape.ts`), so
 * the repo sees the one finding that names the sibling, never a stale-views
 * finding over a file no command could have rendered differently.
 */
async function projectFacts(req: SeedPlanInput): Promise<MapFacts> {
  const arch = architectureDir(req.docsDir);
  const landscape = resolve(landscapePath(req.docsDir));
  const siblings = await architectureDocuments(arch, [landscape, subsystemViewsPath(req.docsDir)]);
  if (siblings.length === 0) return req.map;
  // The temp directory is made INSIDE the try, not one line above it: a full
  // disk, a read-only temp root, or a TMPDIR naming a directory that no longer
  // exists rejects `mkdtemp`, and outside the try that rejection left `seed` as
  // the generic `internal` refusal on a repository where nothing is wrong — the
  // defect docs/CODE-STYLE.md's "read inside the try that handles the read" rule
  // was written from.
  let root: string | null = null;
  try {
    root = await mkdtemp(join(tmpdir(), "loam-seed-"));
    const staged: string[] = [];
    for (const path of [landscape, ...siblings]) {
      const dest = join(root, relative(arch, path));
      await mkdir(dirname(dest), { recursive: true });
      // The landscape is staged from the bytes this commit writes, never from
      // the file on disk — which may be the scaffold's stub, a stamped
      // predecessor, or absent — so the project parsed is the one the grader
      // will read after the commit.
      if (path === landscape) await writeFile(dest, req.landscape, "utf8");
      else await copyFile(path, dest);
      staged.push(dest);
    }
    const project = await loadProject(root, staged);
    return project.clean ? { elements: project.elements, globalStyles: project.globalStyles } : req.map;
  } catch {
    // `loadProject` throws on an error it cannot attribute to a document, and
    // a full disk fails the staging above; both are the fail-closed arm.
    return req.map;
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
  }
}

export interface SeedPlan {
  writes: PlannedWrite[];
  /** Service ids split by whether this run creates the directory. */
  services: { created: string[]; existing: string[] };
}

/**
 * Does this existing service directory hold nothing git would keep? An empty
 * directory is a service to the walk but nothing at all to git, so a landscape
 * declaring it clones into a repo where `validate --all` fails on a service
 * that exists only on the author's disk. Seed's own crash window produces
 * exactly this tree — `stageWrites` creates directories before the journal is
 * written, so a kill in between leaves directories no recovery knows about —
 * and so does a plain `mkdir`. Staging temps do not count as content: they are
 * that same crash's litter, not somebody's file.
 */
async function keepsNothing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).every((entry) => TEMP_FILE_RE.test(entry));
  } catch {
    // Unreadable is not empty: the walk found this directory a moment ago, and
    // inventing a write into a directory we cannot list is the wrong guess.
    return false;
  }
}

/**
 * The complete plan, in memory, before a byte lands: the sealed landscape, one
 * marker per NEW subsystem, one `.gitkeep` per service directory this commit
 * creates — and per existing one holding nothing git would keep (see
 * `keepsNothing`) — and the generated views file rendered from the tree AS
 * THIS COMMIT LEAVES IT, never from a re-walk between two states
 * (commands/subsystem/txn/views.ts's `movedTree` doctrine). That last one is
 * the only write that can be a DELETE: a tree with no subsystems owes no views
 * file, and a leftover is a finding.
 *
 * Existing directories are never moved: fleet.yaml's placement is ignored for
 * a service that already exists — moving is `loam subsystem move <id> --into
 * <name>`'s job, under its own guards — and nothing anywhere is deleted except
 * that one generated file.
 */
export async function planSeedWrites(req: SeedPlanInput, tree: FleetTree): Promise<SeedPlan> {
  const { docsDir, seed } = req;
  const writes: PlannedWrite[] = [planWrite(landscapePath(docsDir), req.landscape)];

  const existingSubs = new Map(tree.subsystems.map((s) => [s.name, s]));
  const newSubs: SubsystemEntry[] = [];
  for (const sub of seed.subsystems) {
    if (existingSubs.has(sub as string)) continue;
    const dir = subsystemPathUnder(servicesDir(docsDir), sub);
    // A comment line parses to null — a valid empty marker (tree/marker.ts).
    writes.push(planWrite(join(dir, SUBSYSTEM_MARKER), "# subsystem marker\n"));
    newSubs.push({ name: sub as string, path: [sub as string], dir, meta: {} });
  }

  const treeDirs = new Map(tree.services.map((s) => [s.id as string, s.dir]));
  // Every existing directory inspected at once — independent reads, so the
  // loop below stays synchronous.
  const invisible = new Map(
    await Promise.all([...treeDirs].map(async ([id, dir]) => [id, await keepsNothing(dir)] as const)),
  );
  const created: string[] = [];
  const existing: string[] = [];
  const newWalked: WalkedService[] = [];
  for (const s of seed.services) {
    const already = treeDirs.get(s.id as string);
    if (already !== undefined) {
      existing.push(s.id);
      // Existing, but git-invisible: give it the `.gitkeep` a created service
      // gets, or the landscape about to be written declares a directory the
      // next clone will not have. `planWrite` makes this a no-op when the file
      // is already there, so a real service is never touched.
      if (invisible.get(s.id as string) === true) writes.push(planWrite(join(already, ".gitkeep"), ""));
      continue;
    }
    created.push(s.id);
    const parent = s.subsystem === null ? null : existingSubs.get(s.subsystem as string) ?? null;
    const dir =
      s.subsystem === null
        ? unfiledServicePaths(docsDir, s.id).dir
        : parent !== null
          ? servicePathsUnder(parent.dir, s.id).dir
          : // A subsystem this same commit creates: the creation spelling,
            // through the same branded joins the subsystem verbs use.
            serviceDirOf(join(subsystemPathUnder(servicesDir(docsDir), s.subsystem), s.id));
    writes.push(planWrite(join(dir, ".gitkeep"), ""));
    newWalked.push({
      // A ServiceId IS a RawServiceId (the checked subtype), so no re-cast.
      id: s.id,
      dir,
      subsystem: s.subsystem === null ? [] : parent !== null ? parent.path : [s.subsystem as string],
    });
  }

  const plannedTree: FleetTree = {
    findings: [],
    services: [...tree.services, ...newWalked],
    subsystems: [...tree.subsystems, ...newSubs],
  };
  // The generated views file, including its ABSENCE. `renderSubsystemViews`
  // returning null means the tree has no subsystems, and its contract is that
  // the file must then not exist — `validate` grades a leftover as
  // `subsystem.views-stale`, so a seed that ignored the file would exit 0 and
  // send the caller, via its own `next` list, into a failing gate over a file
  // it had in hand. `content: null` is the delete the transaction understands
  // (commands/subsystem/txn/txn.ts's `"removed"`), and a file that already
  // SAYS this is left out of the journal entirely rather than written back
  // over itself.
  //
  // "Already says this" is content, not bytes: `viewsAgree` performs the
  // comparison and records the Windows reason for it, beside the generator
  // that mints the bytes. What gets WRITTEN is unchanged — the LF render, as a
  // Buffer — so this decode is a comparison only, never the string round trip
  // to disk that writes.ts forbids; a views file whose bytes are not UTF-8
  // therefore fails the compare and is regenerated, which is the right answer
  // for it anyway.
  const viewsPath = subsystemViewsPath(docsDir);
  const views = renderSubsystemViews(plannedTree, await projectFacts(req));
  const wanted = views === null ? null : Buffer.from(views, "utf8");
  const onDisk = existsSync(viewsPath) ? await readFile(viewsPath, "utf8") : null;
  if (!viewsAgree(onDisk, views)) writes.push({ path: viewsPath, content: wanted });

  return { writes, services: { created: created.sort(), existing: existing.sort() } };
}
