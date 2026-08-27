/**
 * The handful of facts every validate check speaks, and none of them owns.
 *
 * A leaf module rather than a paragraph beside its first caller, because the
 * checks are spread across packages and each of these is read from more than
 * one of them: the dispatcher's rollup and the service target's sources check
 * both name one finding code, and several targets render parser diagnostics
 * the same way. ACTOR_KINDS and EXTERNAL_TAG lived here too, until they
 * reached a third copy (`core/gate/partners.ts`, `core/verify/checklist.ts`);
 * their shared spelling is now `core/vocabulary/maturity.ts`, beside the
 * landscape evidence that asks the same questions.
 */
import { type LikeC4Error } from "../../../core/c4/likec4.js";

/** The one code the rollup line counts; spelled once so the two cannot drift. */
export const UNVERIFIABLE = "sources.unverifiable-from-here";

/**
 * One parser diagnostic as a finding's evidence line: `L12:` when the parser
 * knew a line, because that lets a reader open the file at the fault instead of
 * searching for it.
 *
 * Three other modules hand-roll the same ternary (`commands/show.ts`,
 * `commands/delta.ts`, `core/c4/splice/landscape-merge.ts`). All four belong
 * beside `LikeC4Error` in `core/c4/likec4.ts`. That used to be blocked by the
 * file limit — nine lines of headroom — and is not any more: moving the resolver
 * out to `core/c4/resolve/service.ts` left the loader around 100 lines under.
 * The consolidation is now unblocked and simply owed.
 */
export function errorText(e: LikeC4Error): string {
  return typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message;
}
