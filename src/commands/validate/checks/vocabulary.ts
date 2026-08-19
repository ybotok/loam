/**
 * The handful of facts every validate check speaks, and none of them owns.
 *
 * A leaf module rather than a paragraph beside its first caller, because the
 * checks are spread across packages and each of these is read from more than
 * one of them: the fleet target and the feature target both decide which drawn
 * element answers for a service directory, and the dispatcher's rollup and the
 * service target's sources check both name one finding code. The exemptions
 * were prose in two places before they were an import, and prose does not fail
 * a build when it drifts.
 */
import { type LikeC4Error } from "../../../core/c4/likec4.js";

/** C4 kinds that model people. A person is never a service directory. */
export const ACTOR_KINDS = new Set(["person", "actor", "user"]);

/** Tag marking an element as somebody else's system — undocumented on purpose. */
export const EXTERNAL_TAG = "external";

/** The one code the rollup line counts; spelled once so the two cannot drift. */
export const UNVERIFIABLE = "sources.unverifiable-from-here";

/**
 * One parser diagnostic as a finding's evidence line: `L12:` when the parser
 * knew a line, because that lets a reader open the file at the fault instead of
 * searching for it.
 *
 * Three other modules hand-roll the same ternary (`commands/show.ts`,
 * `commands/delta.ts`, `core/c4/splice/landscape-merge.ts`). All four belong
 * beside `LikeC4Error` in `core/c4/likec4.ts`. The line budget that blocked
 * that is gone — the neutral model view and its service join moved out to
 * `core/c4/model/model.ts` — so what remains is a consolidation, which is a
 * change of its own.
 */
export function errorText(e: LikeC4Error): string {
  return typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message;
}
