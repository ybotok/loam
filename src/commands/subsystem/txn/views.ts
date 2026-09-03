/**
 * What the generated views file MUST say — the shared answer every subsystem
 * writer and `subsystem sync` render from. A module beneath the verbs (in the
 * txn/ subpackage) because the commit window and sync both consume it, and a
 * second spelling of "what should the views say" would be a second chance to
 * disagree with `validate`'s staleness check.
 */
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadArchitecture } from "../../../core/c4/project/architecture.js";
import { serviceDirOf, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { landscapePath } from "../../../core/repo/paths.js";
import { type MapFacts, renderSubsystemViews } from "../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";

/**
 * The elements and declared global style ids of the whole `architecture/`
 * PROJECT — the member join, and the one line a view may borrow a palette
 * with — or no elements and no ids when the map is absent or does not parse.
 * Tolerant on purpose: sync must stay runnable in a repo whose landscape is
 * broken — it renders what the committed bytes resolve (no includes, no style
 * reference), deterministically, and the next sync after the landscape is
 * repaired catches the file up. `validate` skips the staleness question in
 * exactly those states.
 *
 * The PROJECT, not the landscape file alone, and that is a correctness rule
 * rather than a preference: `validate` grades this file against
 * `loadArchitecture` — the landscape merged with every
 * `architecture/usecases/*.likec4`, which may `extend` the model and bind
 * elements of its own. While this side read the landscape alone, a use-case
 * document declaring one element bound to a filed service was enough to make
 * `sync` answer `current` while `validate --all` reported
 * `subsystem.views-stale` and named `sync` as the repair — a loop no command
 * could clear, reproduced on `examples/docs` before this call changed. Two
 * readers of "what should the views say" must read the same documents, or the
 * shared render in `core/repo/tree/render/views.ts` is shared in name only.
 */
export async function landscapeFacts(docsDir: DocsDir): Promise<MapFacts> {
  if (!existsSync(landscapePath(docsDir))) return { elements: [] };
  try {
    const doc = await loadArchitecture(docsDir);
    // The whole document on success, so the render reads the same record
    // `validate --all` grades against; `globalStyles` rides along without
    // being named here, and a field the loaders add later does too.
    return doc.errors.length > 0 ? { elements: [] } : doc;
  } catch {
    return { elements: [] };
  }
}

/** The bytes the views file must hold for this tree, or null for "must be absent". */
export async function expectedViews(docsDir: DocsDir, tree: FleetTree): Promise<string | null> {
  return renderSubsystemViews(tree, await landscapeFacts(docsDir));
}

/**
 * The tree AS THE RENAMES LEAVE IT, computed in memory: every dir under a
 * moved root is remapped by prefix, and each entry's placement chain is
 * re-derived from its remapped dir. The views file is rendered from this, so
 * the commit lands file and renames agreeing — never from a re-walk that
 * would have to happen between two states. Beside `expectedViews` because the
 * two are one promise: what the commit renames and what the file says must
 * come from the same in-memory answer.
 */
export function movedTree(tree: FleetTree, renames: { from: string; to: string }[], servicesRoot: string): FleetTree {
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
