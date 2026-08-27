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
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Elem } from "../../core/c4/likec4.js";
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
import { renderSubsystemViews } from "../../core/repo/tree/views.js";
import type { FleetTree, SubsystemEntry, WalkedService } from "../../core/repo/tree/walk.js";
import { TEMP_FILE_RE } from "../../core/staging/commit.js";
import { planWrite, sameBytes, type PlannedWrite } from "../../core/staging/writes.js";

/** Everything the plan reads. The commit request extends this and adds only `rerun`. */
export interface SeedPlanInput {
  docsDir: DocsDir;
  seed: FleetSeed;
  /** The sealed landscape text (stamp on line 1), already proven to parse. */
  landscape: string;
  /**
   * That same text's parsed elements — the loadSource self-check's output,
   * reused for the views join so the generated views file agrees byte for byte
   * with what `validate --all` will recompute from the committed landscape.
   */
  elements: Elem[];
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
  // (commands/subsystem/txn/txn.ts's `"removed"`), and an identical file is
  // left out of the journal entirely rather than written back over itself.
  const viewsPath = subsystemViewsPath(docsDir);
  const views = renderSubsystemViews(plannedTree, req.elements);
  const wanted = views === null ? null : Buffer.from(views, "utf8");
  const current = existsSync(viewsPath) ? await readFile(viewsPath) : null;
  if (!sameBytes(current, wanted)) writes.push({ path: viewsPath, content: wanted });

  return { writes, services: { created: created.sort(), existing: existing.sort() } };
}
