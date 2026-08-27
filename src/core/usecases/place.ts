/**
 * Where a use case lives and where one of its hops sits — the two spellings
 * every surface that mentions a use case has to agree on.
 *
 * They began in `commands/validate/fleet/usecases/place.ts`, beside the four
 * `usecase.*` graders that were their only reader. `loam diff` naming the flow a
 * removal breaks is the second reader and `loam delta`/`loam context` are the
 * third and fourth, and `core/` may not import from `commands/` (AGENTS.md), so
 * the alternative was a second spelling of `architecture/<sourcePath>` in core.
 * The two would drift silently and in the worst possible direction: a file path
 * in a message that no longer names the file the view is in is how the next
 * reader stops looking (docs/CODE-STYLE.md).
 *
 * What did NOT move is `viewPlace`, the `landscape: …` opening the validate
 * findings carry. That prefix is the name of a validate TARGET, so it is command
 * vocabulary — a `loam diff` finding is filed against a service, not against the
 * fleet map, and borrowing validate's prefix there would claim a target that run
 * does not have.
 */
import type { ParsedStep, ParsedView } from "../c4/parsed/dynamic-views.js";

/**
 * The document the view was written in, spelled repo-relative.
 *
 * `sourcePath` is relative to the LikeC4 PROJECT root, which for
 * `loadArchitecture` is `architecture/`, so the prefix is added here and nowhere
 * else. The caller owes one thing in exchange: only views that came from
 * `loadProject` may be spelled with this, because the single-file loaders name
 * every document after themselves (`source.c4`) and this function would then
 * spell a path that has never existed.
 *
 * An ABSENT `sourcePath` names the directory rather than guessing a file.
 * LikeC4 synthesizes only element views and `readDynamicViews` drops those, so
 * nothing at the 1.59.2 pin reaches this arm; if a release ever stopped emitting
 * the field, falling back to `architecture/landscape.likec4` would put a false
 * cross-reference in a message.
 */
export function viewFile(view: ParsedView): string {
  return view.sourcePath === undefined ? "architecture/" : `architecture/${view.sourcePath}`;
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

/**
 * A use case and one of its hops, named the way a reader outside `validate`
 * meets them: `use case 'uc_checkout' step 4 'authorizes the payment'
 * (architecture/usecases/checkout.likec4)`.
 *
 * The file goes LAST here and first in validate's `viewPlace`, and that is not
 * an inconsistency to tidy away. A validate finding is a line in a report about
 * documents, so it leads with the document; a diff victim is one entry in a
 * `details[]` list whose other entries name edges and requirements, so it has to
 * lead with the thing that broke and carry the file as the place to go fix it.
 */
export function hopPlace(view: ParsedView, step: ParsedStep): string {
  return `use case '${view.id}' ${stepPlace(step)} (${viewFile(view)})`;
}
