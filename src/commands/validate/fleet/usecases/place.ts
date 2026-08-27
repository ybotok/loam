/**
 * Where a use-case finding points: the document the view was written in, the
 * view itself, and the hop inside it.
 *
 * A leaf module rather than three more exports on `./usecases.ts`, because both
 * graders in this package need it while the entry module imports both of them —
 * the leaf-helper-stranded-in-a-heavier-module shape docs/CODE-STYLE.md names as
 * the cause of every import cycle this repository has carried.
 *
 * NAMING THE FILE IS THE WHOLE SUBJECT. `validate --all` reads `architecture/`
 * as ONE LikeC4 project, so a `dynamic view` may have been written in
 * `architecture/landscape.likec4` or in any `architecture/usecases/*.likec4`,
 * and the project is what merges them. A message that named the landscape by
 * default would send its author to a file that does not contain the view — the
 * same defect `landscape.invalid`'s message was corrected for when the project
 * loader landed, arriving again one axis later.
 */
import type { ParsedStep, ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";

/**
 * The document the view was written in, spelled repo-relative.
 *
 * `sourcePath` is relative to the LikeC4 PROJECT root, which for this loader is
 * `architecture/`, so the prefix is added here and nowhere else. The caller owes
 * one thing in exchange, and `./usecases.ts` states it: only views that came
 * from `loadProject` may be graded at all, because the single-file loaders name
 * every document after themselves (`source.c4`) and this function would then
 * spell a path that has never existed.
 *
 * An ABSENT `sourcePath` names the directory rather than guessing a file.
 * LikeC4 synthesizes only element views and `readDynamicViews` drops those, so
 * nothing at the 1.59.2 pin reaches this arm; if a release ever stopped emitting
 * the field, falling back to `architecture/landscape.likec4` would put a false
 * cross-reference in a message, which is how the next reader stops looking.
 */
export function viewFile(view: ParsedView): string {
  return view.sourcePath === undefined ? "architecture/" : `architecture/${view.sourcePath}`;
}

/**
 * The opening of every finding in this family:
 * `landscape: architecture/usecases/checkout.likec4 — dynamic view 'uc_checkout'`.
 *
 * The `landscape:` prefix is the TARGET's name, not a file reference — every
 * finding filed on the fleet target carries it, and `landscape.invalid` already
 * sets the precedent of naming another document right after it.
 */
export function viewPlace(view: ParsedView): string {
  return `landscape: ${viewFile(view)} — dynamic view '${view.id}'`;
}

/**
 * `step 4 'confirms the order'`, or `step 4` where the author labelled nothing.
 *
 * The ordinal is the view's own leaf numbering (`ParsedStep.ordinal`), which
 * skips group brackets — so it counts what the author sees on the diagram, and
 * a message naming step 4 is naming the fourth arrow.
 */
export function stepPlace(step: ParsedStep): string {
  return step.title === undefined ? `step ${step.ordinal}` : `step ${step.ordinal} '${step.title}'`;
}
