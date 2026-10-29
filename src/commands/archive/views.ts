/**
 * The generated views files as THIS archive's commit leaves them — planned
 * beside the merges, so `architecture/subsystems.likec4`,
 * `architecture/services.likec4` and `architecture/platform.likec4` land in the
 * same journaled commit as the map and the tree they are rendered from.
 *
 * THE DEFECT THIS CLOSES. Archive used to leave both files alone and print a
 * ⚠ naming `loam subsystem sync`: a feature that added one service and one edge
 * archived at exit 0, said its piece, and left `validate --all` red with
 * `subsystem.views-stale` until somebody ran a second command nothing in the
 * QUICKSTART walk mentioned (2026-10-28). The files are a pure function of the
 * tree and the map (`core/repo/tree/render/views.ts`), and the archive is the
 * writer that just changed both — so it owes the files the same commit, exactly
 * as every subsystem verb already does (`../subsystem/txn/txn.ts`).
 *
 * WHY THIS IS NOT A SECOND WRITER THAT CAN DISAGREE. The objection the old
 * comment in `./run.ts` recorded was that archive would have to compute the
 * post-merge tree and map itself, "which is how the two writers disagree". Each
 * half of that is now somebody else's answer, re-used rather than re-spelled:
 *
 *  - the MAP is the archive's own planned bytes — every planned `.likec4` write
 *    under `architecture/` laid over the living project documents
 *    (`architectureProjectDocuments`, the list `loadArchitecture` reads, root
 *    `exclude` and all) and parsed by the same `loadProject`. Not a second merge:
 *    the bytes parsed are the bytes the commit swaps in;
 *  - the TREE is the walked tree plus the services the plan's own writes bring
 *    into being, each unfiled at `services/<id>/` — the one place an archive
 *    ever creates a service;
 *  - the RENDER, the compare and the veto are sync's: `renderSubsystemViews` /
 *    `renderServiceOverviews`, `planGenerated` (content, not bytes), and
 *    `readGeneratedFile` — a file at a reserved path loam did not write is left
 *    alone, never overwritten.
 *
 * And the archive still grades its result through validate's own function
 * after the commit (`staleGeneratedViews`, `./run.ts`): if this ever renders
 * something sync would not, the outcome is the old ⚠ naming `loam subsystem
 * sync`, never a stale file reported current.
 *
 * ONLY WHEN THE PLAN FEEDS THE VIEWS. A plan that writes no map document and
 * creates no service changes neither input, so it parses nothing here: a
 * requirements-only archive pays no LikeC4 workspace for a question whose
 * answer it cannot move, and a views file that was already stale stays the
 * fleet gate's finding rather than becoming a silent side effect of an
 * unrelated merge.
 *
 * IN THE SNAPSHOT LIKE EVERY OTHER WRITE, because crash recovery restores from
 * the snapshot's pre-images (`core/staging/recovery/recover.ts`) and a file the
 * journal names must have one. `loam unarchive` therefore puts the pre-archive
 * views back with the pre-archive map — and steps over a views file a later
 * writer regenerated (`../unarchive/restore.ts` says why).
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { architectureDir, architectureProjectDocuments, generatedArchitectureDocuments } from "../../core/c4/project/architecture.js";
import { architectureDocuments } from "../../core/c4/project/documents.js";
import { asLoadedDoc, loadProject } from "../../core/c4/project/load.js";
import type { LoadedDoc } from "../../core/c4/likec4.js";
import { serviceDirOf, type DocsDir } from "../../core/kernel/ids/dirs.js";
import { rawServiceId } from "../../core/kernel/ids/service.js";
import { isPathInside } from "../../core/kernel/path-safety.js";
import { repoPath } from "../../core/envelope/json.js";
import type { FleetContext } from "../../core/fleet-context.js";
import { platformViewsPath, serviceViewsPath, servicesDir, subsystemViewsPath } from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { docsRepoState } from "../../core/repo/state.js";
import { readGeneratedFile } from "../../core/repo/tree/render/service/header.js";
import { planGenerated } from "../../core/repo/tree/render/stale.js";
import { renderPlatformOverview, renderServiceOverviews, renderSubsystemViews } from "../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { planWrite, type PlannedWrite } from "../../core/staging/writes.js";

/** What the planner owes the plan, and the reserved files it found somebody else's. */
export interface ViewsPlan {
  /** The views writes to append to the plan. */
  writes: PlannedWrite[];
  /**
   * Generated paths holding a file loam did NOT write (no mark on its first
   * line), left alone. The closing line names each with the refusal sentence
   * every writer of these paths prints (`authoredRefusal`) instead of "run
   * `loam subsystem sync`", which refuses the same file — the back-and-forth
   * `core/repo/tree/render/service/header.ts` exists to end.
   */
  authored: string[];
}

/**
 * The views writes this archive owes — none when the plan feeds neither input,
 * when the merged map does not parse, when both files already agree, or when
 * anything on the way could not be read. Empty is never a refusal: it means the
 * post-commit grade (`staleGeneratedViews`, `./run.ts`) answers about the files,
 * exactly as it did before the archive wrote them, so no failure in here can
 * fail an archive that would have succeeded without it.
 */
export async function planGeneratedViews(
  config: { docsDir: DocsDir; fleet: FleetContext },
  writes: readonly PlannedWrite[],
): Promise<ViewsPlan> {
  const none: ViewsPlan = { writes: [], authored: [] };
  const { docsDir } = config;
  // A docs repo with no services/ still archives a landscape-only feature
  // exactly as before (`./run.ts` tolerates it on purpose), and has no tree to
  // render from — `loam subsystem sync` refuses the same repository. The tree
  // read would throw `DocsRepoUnavailableError` and turn a clean archive into
  // `internal`, so the planner steps aside and the post-commit grade answers.
  if (docsRepoState(docsDir).kind !== "ok") return none;
  try {
    const arch = architectureDir(docsDir);
    const generated = new Set(generatedArchitectureDocuments(docsDir).map((path) => resolve(path)));
    const mapWrites = writes.filter(
      (w) => w.path.endsWith(".likec4") && isPathInside(arch, w.path) && !generated.has(resolve(w.path)),
    );
    const tree = await listFleetTree(docsDir, config.fleet);
    const created = createdServices(docsDir, tree, writes);
    if (mapWrites.length === 0 && created.length === 0) return none;

    const map = await mergedMap(docsDir, mapWrites);
    if (map === null) return none;
    const after: FleetTree = {
      ...tree,
      services: [
        ...tree.services,
        ...created.map((id) => ({ id: rawServiceId(id), dir: serviceDirOf(join(servicesDir(docsDir), id)), subsystem: [] })),
      ],
    };
    const owed: ViewsPlan = { writes: [], authored: [] };
    for (const file of [
      { path: subsystemViewsPath(docsDir), content: renderSubsystemViews(after, map) },
      { path: serviceViewsPath(docsDir), content: renderServiceOverviews(after, map) },
      { path: platformViewsPath(docsDir), content: renderPlatformOverview(after, map).content },
    ]) {
      const { text, authored } = await readGeneratedFile(file.path);
      // Somebody's own document at a path loam reserves: never written over,
      // and named in the closing line with the refusal every writer prints.
      if (authored) {
        owed.authored.push(file.path);
        continue;
      }
      const { write } = planGenerated(file, text);
      // `planWrite`, so a create is the same no-clobber create every other new
      // file in this commit is: a views file another writer lands between this
      // read and the swap is that writer's, and stays.
      if (write !== null) owed.writes.push(planWrite(write.path, write.content));
    }
    return owed;
  } catch {
    // An unreadable views file (a directory in its place, a permission), a
    // tree walk that hits one, a temp tree that cannot be staged: each costs
    // this planner its answer and nothing else — see the doc above.
    return none;
  }
}

/** The line the plan prints for one views write — the same in the dry run and the real one. */
export function viewsLine(docsDir: DocsDir, write: PlannedWrite): string {
  const verb = write.content === null ? "removed" : "regenerated";
  return `  views: ${repoPath(docsDir, write.path)} — ${verb} for the merged map and tree, as \`loam subsystem sync\` would`;
}

/**
 * The service ids the plan's writes bring into being: a write under
 * `services/<id>/` that no walked service owns. Read off the writes rather than
 * off the delta's service list, because the writes ARE what makes the
 * directory exist — a delta service whose requirement delta merges nothing
 * creates no directory, and a service the map draws gets one only when the plan
 * writes its model (`./plan/landscape.ts`).
 */
function createdServices(docsDir: DocsDir, tree: FleetTree, writes: readonly PlannedWrite[]): string[] {
  const root = servicesDir(docsDir);
  const ids = new Set<string>();
  for (const w of writes) {
    if (!isPathInside(root, w.path) || w.content === null) continue;
    if (tree.services.some((s) => isPathInside(s.dir, w.path))) continue;
    const first = relative(root, w.path).split(/[\\/]/)[0];
    // A file directly under services/ creates no service directory.
    if (first !== undefined && first !== relative(root, w.path)) ids.add(first);
  }
  return [...ids].sort();
}

/**
 * The `architecture/` project as the commit leaves it, parsed — or null when
 * it does not parse, which is the one answer that licences nothing: the render
 * would fall back to a tolerant shape `../subsystem/sync.ts` refuses to write
 * over an existing file, and the archive is not the place to second-guess that.
 *
 * Staged in a temp tree, as `core/c4/project/staged.ts` stages the merge
 * preview: `loadProject` copies documents from disk, so bytes that exist only
 * in the plan have to be written somewhere first.
 */
async function mergedMap(docsDir: DocsDir, mapWrites: readonly PlannedWrite[]): Promise<LoadedDoc | null> {
  const arch = resolve(architectureDir(docsDir));
  const planned = new Map(mapWrites.map((w) => [resolve(w.path), w.content]));
  const root = await mkdtemp(join(tmpdir(), "loam-archive-views-"));
  try {
    const destOf = async (path: string): Promise<string> => {
      const dest = join(root, relative(arch, path));
      await mkdir(dirname(dest), { recursive: true });
      return dest;
    };
    for (const path of await architectureProjectDocuments(docsDir)) {
      // A planned write replaces the living document — or deletes it, which
      // is `content: null` in the plan and simply not staged here.
      if (!planned.has(resolve(path))) await copyFile(path, await destOf(path));
    }
    for (const [path, content] of planned) if (content !== null) await writeFile(await destOf(path), content);
    const doc = asLoadedDoc(await loadProject(root, await architectureDocuments(root)));
    return doc.errors.length === 0 ? doc : null;
  } catch {
    // A temp tree that cannot be staged (ENOSPC, a denied temp directory) or a
    // parse error `loadProject` cannot attribute to a document: either way there
    // is no map to render from, which is the same licence-nothing answer as a
    // map that does not parse.
    return null;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
