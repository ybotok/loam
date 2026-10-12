/**
 * The three plan lines a contract merge's verdicts print — the quote, the
 * stale baseline and the overwrite — spelled once for both planners
 * (./openapi.ts, ./asyncapi.ts), which used to print them in fourteen parallel
 * loops. Every surface reaches the reader by exactly the same sentence an
 * operation or a slot does, because it is graded by exactly the same verdict;
 * one spelling is what keeps the two axes from describing one verdict in two
 * sentences. The label prefix (`path-level …`, `component …`, `components.…`)
 * stays at the call site: it is the one part that differs.
 */
import type { IssueCode } from "../../../../core/vocabulary/issue.js";
import type { Plan } from "../state.js";

type Say = (line?: string) => void;

/**
 * Said out loud, because "the plan wrote less than my delta spells" is the one
 * thing a reader cannot infer from a merged file. Not a warning: quoting the
 * contract around your change is correct authoring, and leaving the quote
 * alone is the correct merge. The path-level and component quotes get the
 * same sentence for the same reason.
 */
export function sayQuoted(say: Say, labels: readonly string[]): void {
  for (const label of labels) say(`      · quotes ${label} — unchanged since it was pinned, left as living has it`);
}

/**
 * Stale surfaces reaching the merge at all means --approve pushed past the
 * gate's `openapi.baseline-stale` / `asyncapi.baseline-stale` — the plan still
 * names what it cost.
 */
export function sayStale(say: Say, labels: readonly string[]): void {
  for (const label of labels) {
    say(`      ⚠ stale baseline on ${label} — the living value moved since this delta was pinned; the overwrite is what --approve chose`);
  }
}

/** One overwrite the plan warns about. The code is spelled literally at each call site. */
export interface Overwrite {
  svc: string;
  code: IssueCode;
  /** What the printed line names: the label with its prefix. */
  label: string;
  /** The warning's sentence, before any consumer clause. */
  message: string;
  /** Who the overwrite lands on (./consumers.ts), or absent where nothing can name it. */
  named?: { clause: string; details: string[] } | null;
}

/**
 * Warn about one overwrite and print it. The consumer clause, when there is
 * one, ends both the warning's message and the printed line, and its evidence
 * rides as the warning's `details` and as indented lines under it.
 */
export function warnOverwrite(plan: Pick<Plan, "planWarns">, say: Say, overwrite: Overwrite): void {
  const named = overwrite.named ?? null;
  const clause = named === null ? "" : `; ${named.clause}`;
  plan.planWarns.push({
    severity: "warn",
    code: overwrite.code,
    subject: overwrite.svc,
    message: overwrite.message + clause,
    ...(named === null ? {} : { details: named.details }),
  });
  say(`      ⚠ overwrites ${overwrite.label} — the living definition differs${clause}`);
  for (const line of named?.details ?? []) say(`          ${line}`);
}
