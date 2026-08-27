/**
 * Where a use-case FINDING points: the validate target it is filed against, the
 * document the view was written in, and the view itself.
 *
 * A leaf module rather than another export on `./usecases.ts`, because both
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
 *
 * `viewFile` and `stepPlace` themselves moved to `core/usecases/place.ts` once
 * `loam diff`, `loam delta` and `loam context` became readers too; that module's
 * banner records why, and why the `landscape:` prefix below stayed here.
 */
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { viewFile } from "../../../../core/usecases/place.js";

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
