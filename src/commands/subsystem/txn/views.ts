/**
 * What the generated views file MUST say — the shared answer every subsystem
 * writer and `subsystem sync` render from. A module beneath the verbs (in the
 * txn/ subpackage) because the commit window and sync both consume it, and a
 * second spelling of "what should the views say" would be a second chance to
 * disagree with `validate`'s staleness check.
 */
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { loadFile, type Elem } from "../../../core/c4/likec4.js";
import { serviceDirOf, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { landscapePath } from "../../../core/repo/paths.js";
import { renderSubsystemViews } from "../../../core/repo/tree/views.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";

/**
 * The landscape's elements for the member join, or the empty list when the
 * map is absent or does not parse. Tolerant on purpose: sync must stay
 * runnable in a repo whose landscape is broken — it renders what the
 * committed bytes resolve (no includes), deterministically, and the next sync
 * after the landscape is repaired catches the file up. `validate` skips the
 * staleness question in exactly those states, so the two never contradict.
 */
export async function landscapeElements(docsDir: DocsDir): Promise<Elem[]> {
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return [];
  try {
    const doc = await loadFile(path);
    return doc.errors.length > 0 ? [] : doc.elements;
  } catch {
    return [];
  }
}

/** The bytes the views file must hold for this tree, or null for "must be absent". */
export async function expectedViews(docsDir: DocsDir, tree: FleetTree): Promise<string | null> {
  return renderSubsystemViews(tree, await landscapeElements(docsDir));
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
