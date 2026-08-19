/**
 * What the generated views file MUST say — the shared answer every subsystem
 * writer and `subsystem sync` render from. A module beneath the verbs (in the
 * txn/ subpackage) because the commit window and sync both consume it, and a
 * second spelling of "what should the views say" would be a second chance to
 * disagree with `validate`'s staleness check.
 */
import { existsSync } from "node:fs";
import { loadFile, type Elem } from "../../../core/c4/likec4.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
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
