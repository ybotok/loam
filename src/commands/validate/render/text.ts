/**
 * `loam validate`'s human view: how a graded report prints.
 *
 * Its own package since the fleet report grew an ORDER — lead findings, the
 * counts and the error index, every feature, the fleet, the footer — and two
 * levers that fold lines (axis banners, repeat groups). None of that changes a
 * finding, a count or an exit code: `--json` and `--strict` read the targets
 * this module is handed, never what it chose to print.
 *
 * The rollup is not recounted here. `RenderOptions.summary` IS the run's
 * `summary()` (`../report.ts`), the same object `--json` carries, handed in by
 * validate.ts — a renderer with its own count is how a footer starts printing
 * a number its own findings contradict.
 */
import { listCodes } from "../../../core/explain/lookup.js";
import {
  NOT_CHECKED_MARK,
  SEVERITY_MARK,
  subjectsWith,
  type Finding,
  type TargetReport,
} from "../../../core/vocabulary/report.js";
import { EXPLAIN_FOOTER } from "../../policy/format.js";
import { groupedWarnCodes, type Adoption, type AdoptionAxis } from "../fleet/scorecard/adoption.js";
import type { LensReport } from "../lens/joins.js";
import type { ValidateSummary } from "../report.js";
import { printRepeats, repeatedFindings } from "./repeats.js";
import { LENS_LEAD, lensTail, printErrorIndex, printFooter, summaryLine } from "./rollups.js";

/** What `renderText` needs of the run beyond the graded targets themselves. */
export interface RenderOptions {
  all: boolean;
  errorsOnly: boolean;
  /** The run's `summary()` — the very object the `--json` payload carries. */
  summary: ValidateSummary;
  /** The fleet's unverifiable-sources subject count, for the one-line rollup. */
  unverifiable: number;
  /**
   * The run's scorecard facts the renderer reads — ONE field, not a nullable
   * adoption beside a defaulted denominator, so "adoption without its real
   * denominator" is not constructible. Null on every single-target run and on
   * an `--all` run whose card failed closed, and null renders exactly as
   * before grouping existed: fail-open to today's behaviour, every warning
   * printed individually.
   */
  scorecard: { readonly adoption: Adoption; readonly services: number } | null;
  /**
   * The spine lens's account of itself, or null on every run without
   * `--spine`. When set, `targets` and `summary` are already the lens's shown
   * half (validate.ts partitions before anything renders), and this module
   * only adds the lines that say so: the lead, and the tail naming what the
   * lens set aside and how many joins the map states.
   */
  lens: LensReport | null;
}

/**
 * `--errors-only` is a RENDERING lever, the way `--strict` is an exit-code
 * lever: neither changes the report, and the `--json` payload is unaffected by
 * both. On a fleet of a hundred services the clean run prints several hundred
 * `ok` confirmations, and the two warnings that matter are somewhere inside it;
 * anyone reading a CI log wants the exceptions, and anyone auditing wants all
 * of it. Both are available, from the same run, and neither is the default.
 *
 * Axis grouping is the same kind of lever, one notch further: warnings whose
 * SOLE cause is a fleet-wide not-started axis (the mechanical, fail-closed
 * rule in fleet/scorecard/adoption.ts — warn severity, listed code, axis at
 * zero) are dropped from the per-target listing and re-stated as one banner
 * per axis after the footer. The report, the footer's counts, `--json` and
 * `--strict` are all computed from the UNFILTERED findings, so nothing a
 * machine or an exit code reads moves by a single bit. Repeat grouping
 * (`./repeats.ts`) is the third, under the same rule.
 */
export function renderText(targets: TargetReport[], opts: RenderOptions): void {
  const { all, errorsOnly } = opts;
  // When the fleet-wide "not started" claim is measurable at all — each guard
  // fails closed to ungrouped rendering. `!all` is structural, not just the
  // call site's promise: the banners print after the footer that only `--all`
  // reaches, so grouping outside `--all` would DROP warnings instead of
  // moving them — the one thing this lever must never do. `services === 0`
  // is the vacuous fleet: with no services every axis is 0 "fleet-wide", and
  // a banner over "0 of 0 services" would hide the fleet-level warnings of a
  // repo that merely has no fleet yet. And an unreadable service proves
  // nothing about what it started: its all-false participation (contracts.ts)
  // could MANUFACTURE the very N=0 that licenses suppression — beside an
  // error saying that service could not be checked — so one
  // `service.unreadable` subject disables grouping for the whole run.
  const card =
    !all ||
    opts.scorecard === null ||
    opts.scorecard.services === 0 ||
    subjectsWith(targets, "service.unreadable") > 0
      ? null
      : opts.scorecard;
  const grouped = card === null ? new Map<string, AdoptionAxis>() : groupedWarnCodes(card.adoption);
  const isGrouped = (f: Finding): boolean => f.severity === "warn" && grouped.has(f.code);

  // The explain pointer follows any report that printed work — a non-ok
  // finding, listed or folded under an axis banner. Gated on the UNFILTERED
  // findings like every other rollup, so `--errors-only` and grouping cannot
  // print codes the pointer then fails to follow. It is computed HERE rather
  // than beside the two places it prints because the code column below asks
  // the same question and must not walk the findings a second time to answer
  // it differently.
  const pointer = targets.some((t) => t.findings.some((f) => f.severity !== "ok"));
  // The lookup key on the line itself.
  //
  // Until now a text report printed messages and no codes, so the footer under
  // it could only say codes were somewhere else — in `--json`, which a reader
  // would have to re-run the whole command to see. The code is what `loam
  // explain` takes, what a CI branch tests and what a bug report quotes, and
  // withholding it from the one surface a person actually reads made the
  // footer's own offer unreachable.
  //
  // Only where a code is genuinely answerable, and that guard is not
  // decoration: a handful of emitted finding codes still have no fix-table row
  // (test/explain.test.ts names them), and printing one beside a footer
  // promising an explanation would send the reader to a refusal. The set is
  // built ONCE per render, and only when something non-ok will be printed:
  // `explainSubject` walks the shipped workflow bodies per code (the cost
  // `fixesFor` measured from the other side, where a handful of lookups is the
  // cheaper shape), while `listCodes()` walks them once for the whole
  // vocabulary — and a fleet report has far more finding lines than the fleet
  // has distinct codes. Measured: 2.7 ms for all 273 codes, once per report.
  const explainable = pointer ? new Set(listCodes().map((listing) => listing.code)) : new Set<string>();
  const listed = (f: Finding): boolean => !isGrouped(f) && (!errorsOnly || f.severity !== "ok");
  const { lens } = opts;
  // Before the first finding, for the scope line's reason (render/emit.ts):
  // a reader has to know the report below is a partition before reading a
  // green tick in it as the fleet's.
  if (lens !== null) console.log(LENS_LEAD);

  if (!all) {
    for (const t of targets) printTarget(t, listed, explainable);
    // Without the --all footer there would be nothing at all to print for a
    // clean single target under --errors-only — and silence is the one output
    // that must never mean "checked, fine".
    if (errorsOnly && targets.every((t) => t.findings.every((f) => f.severity === "ok"))) {
      console.log(`${targets.map((t) => t.id).join(", ")}: no errors or warnings`);
    }
    if (lens !== null) for (const line of lensTail(lens, false)) console.log(line);
    if (pointer) console.log(`\n${EXPLAIN_FOOTER}`);
    return;
  }
  const lensed = lens !== null;
  printFleet(targets, { listed, explainable, summary: opts.summary, lensed });
  printFooter(targets, { summary: opts.summary, unverifiable: opts.unverifiable, card, grouped, isGrouped, lensed });
  // Right under the footer it qualifies, and like the footer printed under
  // --errors-only and on a green run (rollups.ts says why).
  if (lens !== null) for (const line of lensTail(lens, true)) console.log(line);
  if (pointer) console.log(`\n${EXPLAIN_FOOTER}`);
}

/** What the fleet layout reads of the render already decided above. */
interface FleetView {
  /** Whether a finding prints at all — the `--errors-only` and axis-banner levers already applied. */
  listed: (f: Finding) => boolean;
  explainable: ReadonlySet<string>;
  summary: ValidateSummary;
  /** Under `--spine`: the counts line names the lens (`summaryLine`). */
  lensed: boolean;
}

/**
 * The `--all` listing, in the order a reader needs it rather than the order
 * the targets were graded in.
 *
 * Graded order put every service first and the features last, so on a real
 * fleet the feature blocks — the work somebody is doing right now — and any
 * error that made the run red sat under hundreds of per-service lines. Now:
 * the findings that say nothing below can be trusted (`TextHint.lead`); the
 * counts; the error index; each feature's block; then the fleet — the
 * landscape, the groups repeat grouping folded, every service. The footer
 * still closes it, because CI logs are read from the tail. A finding prints at
 * most once: in full under its target, or — when repeat grouping folded it —
 * counted on its group's line, the group's first member printed in full.
 */
function printFleet(targets: readonly TargetReport[], view: FleetView): void {
  const { listed, explainable } = view;
  const lead = (f: Finding): boolean => f.text?.lead === true;
  const body = (f: Finding): boolean => listed(f) && !lead(f);
  const services = targets.filter((t) => t.kind === "service");
  const repeats = repeatedFindings(services, body);
  const block = (f: Finding): boolean => body(f) && !repeats.collapsed.has(f);
  const features = targets.filter((t) => t.kind === "feature");
  const featuresPrint = features.some((t) => t.findings.some(block));
  const fleetPrints = repeats.groups.length > 0 || targets.some((t) => t.kind !== "feature" && t.findings.some(block));

  // The head prints only above something: on a run whose listing is empty (a
  // clean fleet under --errors-only) the footer below is the whole report,
  // and the same counts twice in a row would say nothing new.
  if (targets.some((t) => t.findings.some(listed))) {
    const leads = targets.flatMap((t) => t.findings.filter((f) => lead(f) && listed(f)));
    for (const f of leads) printFinding(f, explainable);
    console.log(summaryLine(view.summary, view.lensed));
    printErrorIndex(targets);
    if (featuresPrint || fleetPrints) console.log("");
  }
  for (const t of features) printTarget(t, block, explainable);
  // One blank line between the features and the fleet, so the last feature's
  // indented coherence line is not read as the landscape's first.
  if (featuresPrint && fleetPrints) console.log("");
  for (const t of targets) if (t.kind === "landscape") printTarget(t, block, explainable);
  printRepeats(repeats.groups, (f) => findingLine(f, explainable));
  for (const t of services) printTarget(t, block, explainable);
}

/** One target's block: the findings `show` admits, under the target's own header. */
function printTarget(t: TargetReport, show: (f: Finding) => boolean, explainable: ReadonlySet<string>): void {
  const shown = t.findings.filter(show);
  if (shown.length === 0) return;
  // A feature announces itself; a service's findings already carry its name.
  if (t.kind === "feature") console.log(t.id);
  let header: string | undefined;
  for (const f of shown) {
    const hint = f.text ?? {};
    if (hint.header && hint.header !== header) {
      header = hint.header;
      console.log(`  ${header}`);
    }
    printFinding(f, explainable);
  }
}

/** A finding's line and its evidence. */
function printFinding(f: Finding, explainable: ReadonlySet<string>): void {
  // The whole report goes to stdout, in the order it prints. Splitting errors
  // onto stderr meant a piped stdout silently lost them from the middle of
  // the report and 2>&1 could reorder it; the exit code carries failure,
  // and stderr stays reserved for refusals (the fail() path).
  console.log(findingLine(f, explainable));
  for (const d of f.details ?? []) console.log(`    ${f.text?.detailPrefix ?? ""}${d}`);
}

/** The one spelling of a finding's line — the listing's and a repeat group's example's. */
function findingLine(f: Finding, explainable: ReadonlySet<string>): string {
  const hint = f.text ?? {};
  // The not-checked glyph replaces ✓ only. A hint can never print a ⚠ or a ✗
  // as anything but itself: a check that did not run is an `ok` fact, and a
  // stray hint on a real finding must not make it look like one.
  const glyph = hint.marker === "not-checked" && f.severity === "ok" ? NOT_CHECKED_MARK : SEVERITY_MARK[f.severity];
  const marker = hint.marker === false ? "" : `${glyph} `;
  // `ok` confirmations stay clean, deliberately. A clean fleet run is
  // several hundred ✓ lines and two warnings, and a code appended to every
  // one of them would cost exactly the signal the exceptions carry — there
  // is nothing to look up about a check that passed.
  const code = f.severity !== "ok" && explainable.has(f.code) ? `  (${f.code})` : "";
  return `${" ".repeat(hint.indent ?? 0)}${marker}${f.message}${code}`;
}
