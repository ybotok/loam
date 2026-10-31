/**
 * `loam validate`'s output phase: the one place a graded run becomes either the
 * `--json` envelope or the human view.
 *
 * Moved out of `../validate.ts`, which is the argument grammar, the target
 * dispatch and the run's one filesystem snapshot — grading ends there, and
 * everything here only reads what grading produced. The seam is the phase: by
 * the time this module is called every target is graded and every rollup input
 * (the scope, the introduced binding, the scorecard) is decided, so nothing in
 * it can change a finding, a count or an exit code. The exit code stays with
 * the action, which decides it from the same targets it hands in here.
 */
import { emitJson } from "../../../core/envelope/json.js";
import { scopeJson, scopeLine, type ValidateScope } from "../../../core/diff/scope/changed-paths.js";
import { targetJson, type TargetReport } from "../../../core/vocabulary/report.js";
import { fixesFor } from "../../policy/format.js";
import { introducedJson, introducedLead, type IntroducedBinding } from "../checks/introduced.js";
import { printScorecard } from "../fleet/scorecard/print.js";
import { type Scorecard } from "../fleet/scorecard/scorecard.js";
import { lensJson, type LensReport } from "../lens/joins.js";
import type { ValidateSummary } from "../report.js";
import { renderText } from "./text.js";

/** Everything the output phase reads of one graded run. */
export interface ValidateReport {
  json: boolean;
  /** `--all` was passed: the fleet layout, its footer and the scorecard. */
  all: boolean;
  errorsOnly: boolean;
  /** Every graded target, uncapped — what `fixes` is computed off, as `totals` is. */
  targets: TargetReport[];
  /** The same targets through `capDetails` — the evidence both payloads print. */
  capped: TargetReport[];
  /**
   * The run's `summary()` over `targets`. Handed in, never counted here: the
   * `--json` summary and the text footer print this one object (../report.ts
   * says why a renderer with its own count is how a footer starts contradicting
   * its own findings), and this package importing the rollup's module would
   * also close a cycle with the validate package that imports it.
   */
  totals: ValidateSummary;
  /** `reportValid(targets)`, decided by the action because the exit code reads it too. */
  valid: boolean;
  /** What the positional argument turned out to name, for the JSON payload. */
  resolvedKind: "service" | "feature" | undefined;
  /** The `--base` narrowing. Null on every unscoped run — including every run without --base. */
  scope: ValidateScope | null;
  /** The features a bare run validated in place of a bound service they introduce. Null on every other run. */
  introduced: IntroducedBinding | null;
  /** The fleet's unverifiable-sources subject count — `unverifiableSubjects` over `targets`. */
  unverifiable: number;
  /** The fleet scorecard, or null where the action suppressed it or it failed closed. */
  scorecard: Scorecard | null;
  /**
   * The spine lens's account of itself, or null on every run without
   * `--spine` — and null renders, byte for byte, the report that existed
   * before the lens did. When set, `targets` are already the SHOWN half.
   */
  lens: LensReport | null;
}

export function emitValidateReport(report: ValidateReport): void {
  const { json, targets, capped, totals, valid, resolvedKind, scope, introduced, scorecard, lens } = report;
  const unverifiable = report.unverifiable;
  if (json) {
    emitJson({
      command: "validate",
      valid,
      summary: totals,
      // Right beside the two keys it qualifies, and only under `--spine`: with
      // it, `valid` means "no spine error" and `summary` counts the shown half,
      // and a consumer reading either without this key would read a partition
      // as the fleet.
      ...(lens === null ? {} : { lens: lensJson(lens) }),
      ...(resolvedKind === undefined ? {} : { resolvedKind }),
      // What this run looked at. Only under `--base`, so an unscoped payload
      // is today's document and its ABSENCE says `summary` counts the whole
      // fleet — scopeJson has why a scoped one may not stay silent.
      ...(scope === null ? {} : { scope: scopeJson(scope) }),
      // Only when a bare run validated the features introducing the bound service: why `targets` holds no service.
      ...(introduced === null ? {} : { boundService: introducedJson(introduced) }),
      // Emitted in every mode now that it is derived per service: a
      // single-service run knows exactly as much about its own blind spot
      // as `--all` knows about the fleet's.
      sourcesUnverifiableFromHere: unverifiable,
      ...(scorecard === null ? {} : { scorecard }),
      // What to do about every code this run raised — the one thing the
      // payload could not previously answer. `validate` is step 1 of every
      // generated protocol and the command an agent reads first, and until
      // now it replied in prose: a finding names a code and says what is
      // wrong, and nothing in it said that `loam explain <code>` knows what
      // to do next.
      //
      // A top-level MAP, not a field on each finding, for the reason
      // report.ts's DETAIL_LIMIT gives about evidence: a hundred-service
      // fleet raising one code a hundred times would ship the same
      // sentence a hundred times, in the interface an agent pipes into a
      // context window. The consumer joins `findings[].code` to
      // `fixes[code]` — one lookup, no round trip, no repetition.
      //
      // Keyed ONLY by codes a non-`ok` finding raised. A confirmation has
      // nothing to fix, and on a clean fleet the `ok` codes are the
      // overwhelming majority of findings; attaching fixes to them would
      // pay the whole vocabulary's byte cost to tell a reader that nothing
      // is wrong. `targets` is read here rather than `capped` because
      // capping truncates evidence, not findings — the two raise the same
      // codes, and reading the uncapped set keeps this rollup computed off
      // the same targets as `summary()`.
      //
      // Not behind a flag, deliberately. It is additive, so no consumer
      // that ignores it is affected; it is small, because it carries only
      // the handful of codes this run actually raised rather than the
      // 227-row vocabulary; and a flag would mean an agent has to already
      // know the fixes exist in order to ask for them — which is the exact
      // gap being closed. It is emitted on a green run too, as `{}`, so a
      // consumer never has to branch on the key's presence before looking
      // a code up in it.
      fixes: fixesFor(
        targets.flatMap((t) => t.findings.filter((f) => f.severity !== "ok").map((f) => f.code)),
      ),
      targets: capped.map(targetJson),
    });
  } else {
    // The scope FIRST: a reader has to know what the report below is a
    // report ABOUT, and in the zero-target case there is nothing below at
    // all — printed after the findings, the one run that most needs words
    // would read as a green over the whole system.
    if (scope !== null) console.log(scopeLine(scope));
    // First for the same reason: what follows is a feature's report, not the service's.
    if (introduced !== null) console.log(`${introducedLead(introduced).join("\n")}\n`);
    renderText(capped, {
      all: report.all,
      errorsOnly: report.errorsOnly,
      summary: totals,
      unverifiable,
      scorecard,
      lens,
    });
    if (scorecard !== null) printScorecard(scorecard);
  }
}
