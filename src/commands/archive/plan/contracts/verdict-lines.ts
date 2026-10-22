/**
 * The plan lines a contract merge's verdicts print — the quote, the stale
 * baseline, the overwrite and the `info` the merge does not carry — spelled
 * once for both planners
 * (./openapi.ts, ./asyncapi.ts), which used to print them in fourteen parallel
 * loops. Every surface reaches the reader by exactly the same sentence an
 * operation or a slot does, because it is graded by exactly the same verdict;
 * one spelling is what keeps the two axes from describing one verdict in two
 * sentences. The label prefix (`path-level …`, `component …`, `components.…`)
 * stays at the call site: it is the one part that differs.
 */
import { isDeepStrictEqual } from "node:util";
import { withoutFeatureKeysDeep } from "../../../../core/openapi/digest.js";
import { isRecord } from "../../../../core/kernel/records.js";
import { compareIds } from "../../../../core/repo/entries.js";
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

/**
 * The `info` keys a feature's contract spells differently from the living one,
 * as `info.<key>` labels, sorted — empty when the delta writes no `info`, or
 * writes exactly what living has.
 *
 * Neither merge carries `info` (nor any root key outside the sections it
 * merges: `../../../../core/asyncapi/merge/markers.ts` names what those are),
 * and that is a decision rather than a gap — a delta is a diff of operations
 * and slots, and its `info` is most often the scaffold's or a copy. But a
 * delta that DID move it — a new version, a rewritten description — lost the
 * change with exit 0 and nothing in the plan, so the reader learned it from
 * the living file weeks later. Only keys the delta declares are compared: a
 * key living has and the delta leaves out is a key nobody asked to change.
 * Feature bookkeeping is never compared: an `x-loam-*` key of `info` itself is
 * skipped, and the merges' own markers are stripped from the values below it
 * (`withoutFeatureKeysDeep`), so a pin can never read as drift.
 */
export function infoDrift(livingPlain: unknown, featurePlain: unknown): string[] {
  const feature = isRecord(featurePlain) ? featurePlain.info : undefined;
  if (!isRecord(feature)) return [];
  const living = isRecord(livingPlain) && isRecord(livingPlain.info) ? livingPlain.info : {};
  return Object.keys(feature)
    .filter((key) => !key.startsWith("x-loam-"))
    .filter((key) => !isDeepStrictEqual(withoutFeatureKeysDeep(feature[key]), living[key]))
    .map((key) => `info.${key}`)
    .sort(compareIds);
}

/** Which contract the drift is about, the code it is reported under, and what the merge carries instead. */
export interface InfoDrift {
  svc: string;
  code: IssueCode;
  /** `openapi.yaml` or `asyncapi.yaml` — the living file the author edits instead. */
  file: string;
  /** What the merge DOES carry, in the words the warning prints. */
  carries: string;
  labels: readonly string[];
}

/**
 * Warn about one contract's `info` drift and print it. A warning, not a gate:
 * keeping the living `info` is the merge working as designed, and the remedy —
 * edit the living file in the same change — is the author's call. What must
 * not happen is the silence.
 */
export function warnInfoDrift(plan: Pick<Plan, "planWarns">, say: Say, drift: InfoDrift): void {
  if (drift.labels.length === 0) return;
  const which = drift.labels.join(", ");
  plan.planWarns.push({
    severity: "warn",
    code: drift.code,
    subject: drift.svc,
    message:
      `${drift.svc}: the delta's ${which} differ(s) from the living ${drift.file} — the merge carries ${drift.carries} and never ` +
      `info, so the living contract keeps its own. If it should move, edit the living ${drift.file} in this change.`,
  });
  say(`      ⚠ info not merged — the delta's ${which} differ(s) from the living ${drift.file}, which keeps its own`);
}
