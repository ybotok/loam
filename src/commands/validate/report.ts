/**
 * Everything that happens to a `TargetReport` around the checks themselves:
 * how one is built when a target could not be read at all, how a finding's
 * evidence is capped, how the set is summed, and how it prints.
 *
 * A module rather than the tail of validate.ts because the rollup and the
 * renderer have to agree. The `--all` footer and the `--json` summary are the
 * same `summary()`, and the cap reaches both payloads from one place; a second
 * copy of either is how a footer starts printing a number its own findings
 * contradict.
 */
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listCodes } from "../../core/explain/lookup.js";
import {
  countSeverity,
  subjectsWith,
  SEVERITY_MARK,
  type Finding,
  type TargetReport,
} from "../../core/vocabulary/report.js";
import { EXPLAIN_FOOTER, plural } from "../policy/format.js";
import {
  ADOPTION_AXES,
  groupedWarnCodes,
  type Adoption,
  type AdoptionAxis,
} from "./fleet/scorecard/adoption.js";

/**
 * The rollup `--json` carries and the `--all` footer prints.
 *
 * Four named fields rather than a `Record<string, number>`: the keys ARE the
 * contract, and under an index signature every read of them was an assertion
 * (`s.errors!`) that tsc could not check — rename one and the compiler stayed
 * quiet while the footer printed `undefined errors`.
 */
export interface ValidateSummary {
  services: number;
  features: number;
  errors: number;
  warnings: number;
}

export function summary(targets: TargetReport[]): ValidateSummary {
  return {
    services: targets.filter((t) => t.kind === "service").length,
    features: targets.filter((t) => t.kind === "feature").length,
    errors: countSeverity(targets, "error"),
    warnings: countSeverity(targets, "warn"),
  };
}

/**
 * How many services this run could not check, for the rollup line and the
 * `--json` payload.
 *
 * Counted off the findings rather than alongside them, so the rollup line
 * and the per-service findings can never disagree about how many services
 * this run could not check. The by-SUBJECT rule (a service whose spec.md and
 * arch.spec.md both name `sources` raises two findings and is one service) is
 * `subjectsWith`'s, spelled once for every findings-derived rollup — the
 * fleet scorecard counts through the same function on the same code, so its
 * number and this one are structurally the same number. The code is a LITERAL
 * rather than checks/vocabulary.ts's UNVERIFIABLE constant because the
 * stable-code collector reads counting sites too, and it refuses a slot it
 * cannot read — the collector is also what convicts a typo here.
 */
export function unverifiableSubjects(targets: TargetReport[]): number {
  return subjectsWith(targets, "sources.unverifiable-from-here");
}

/**
 * How many `details` lines any one finding may print before the rest are
 * summarised away.
 *
 * A finding's details are evidence, not a log: LikeC4 reports one syntax error
 * as dozens of cascading diagnostics, and a fleet-sized repo multiplies that by
 * every target that mentions the file. The report is read by a person scrolling
 * a CI log and by an agent with a context window, and neither of them is helped
 * by the four-hundredth copy. The cap is applied to the JSON payload too, on
 * purpose: `--json` is the interface an agent pipes, and an unbounded array is
 * the same denial-of-attention there, just machine-readable.
 */
const DETAIL_LIMIT = 10;

/** Truncate every finding's details, marking what was dropped so nothing looks complete when it is not. */
export function capDetails(t: TargetReport): TargetReport {
  return {
    ...t,
    findings: t.findings.map((f) => {
      const details = f.details ?? [];
      if (details.length <= DETAIL_LIMIT) return f;
      return {
        ...f,
        details: [...details.slice(0, DETAIL_LIMIT), `… (+${details.length - DETAIL_LIMIT} more)`],
      };
    }),
  };
}

/**
 * One target's checks, with an IO exception turned into a finding ON that
 * target instead of aborting the run.
 *
 * A fleet gate that dies on the first unreadable file reports nothing about the
 * other ninety-nine services — one bad permission bit, one file that is a
 * dangling symlink, and CI's answer to "how is the fleet" becomes a stack
 * trace. The failure is real and it is an error, so the run still exits 1; what
 * changes is that everything else is still graded, and the finding names the
 * service and the path instead of arriving as the `internal` catch-all.
 */
export async function guarded(
  target: { kind: "service" | "feature"; id: string },
  run: () => Promise<TargetReport>,
): Promise<TargetReport> {
  try {
    return await run();
  } catch (err) {
    // A docs repo that vanished mid-run is not one target's problem — it is the
    // whole run's, and the action's own catch reports it.
    if (err instanceof DocsRepoUnavailableError) throw err;
    const path = (err as NodeJS.ErrnoException).path;
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: target.kind,
      id: target.id,
      findings: [
        {
          severity: "error",
          code: target.kind === "service" ? "service.unreadable" : "feature.unreadable",
          subject: target.id,
          message:
            `${target.id}: ${path === undefined ? "an artifact" : path} could not be read — ` +
            `nothing about this ${target.kind} was checked. ${reason}`,
        },
      ],
    };
  }
}

/**
 * `target.ambiguous` — the positional named a service AND a feature. The tie is
 * still broken the way it always was (the feature wins), because changing which
 * one is picked would silently re-target every script that relies on it; what
 * is new is that the run says which reading it took and how to force the other.
 */
export function ambiguousTarget(arg: string, chosen: "service" | "feature"): Finding {
  const other = chosen === "feature" ? "service" : "feature";
  return {
    severity: "warn",
    code: "target.ambiguous",
    subject: arg,
    message:
      `'${arg}' names both a service and a feature — validated as the ${chosen}. ` +
      `Pass --${other} ${arg} for the other reading.`,
  };
}

/* ------------------------------------------------------------------ */
/* Text renderer                                                       */
/* ------------------------------------------------------------------ */

/** What `renderText` needs of the run beyond the graded targets themselves. */
export interface RenderOptions {
  all: boolean;
  errorsOnly: boolean;
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
 * machine or an exit code reads moves by a single bit.
 */
export function renderText(targets: TargetReport[], opts: RenderOptions): void {
  const { all, errorsOnly, unverifiable } = opts;
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
  for (const t of targets) {
    const shown = t.findings.filter(
      (f) => !isGrouped(f) && (!errorsOnly || f.severity !== "ok"),
    );
    if (shown.length === 0) continue;
    // A feature announces itself; a service's findings already carry its name.
    if (t.kind === "feature") console.log(t.id);
    let header: string | undefined;
    for (const f of shown) {
      const hint = f.text ?? {};
      if (hint.header && hint.header !== header) {
        header = hint.header;
        console.log(`  ${header}`);
      }
      // The whole report goes to stdout, in document order. Splitting errors
      // onto stderr meant a piped stdout silently lost them from the middle of
      // the report and 2>&1 could reorder it; the exit code carries failure,
      // and stderr stays reserved for refusals (the fail() path).
      const marker = hint.marker === false ? "" : `${SEVERITY_MARK[f.severity]} `;
      // `ok` confirmations stay clean, deliberately. A clean fleet run is
      // several hundred ✓ lines and two warnings, and a code appended to every
      // one of them would cost exactly the signal the exceptions carry — there
      // is nothing to look up about a check that passed.
      const code = f.severity !== "ok" && explainable.has(f.code) ? `  (${f.code})` : "";
      console.log(`${" ".repeat(hint.indent ?? 0)}${marker}${f.message}${code}`);
      for (const d of f.details ?? []) console.log(`    ${hint.detailPrefix ?? ""}${d}`);
    }
  }

  if (!all) {
    // Without the --all footer there would be nothing at all to print for a
    // clean single target under --errors-only — and silence is the one output
    // that must never mean "checked, fine".
    if (errorsOnly && targets.every((t) => t.findings.every((f) => f.severity === "ok"))) {
      console.log(`${targets.map((t) => t.id).join(", ")}: no errors or warnings`);
    }
    if (pointer) console.log(`\n${EXPLAIN_FOOTER}`);
    return;
  }
  const s = summary(targets);
  console.log(
    `\n${plural(s.services, "service")}, ${plural(s.features, "feature")} — ` +
      `${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`,
  );
  // One line for the whole fleet, never one per service: honest about the blind
  // spot without drowning the report in a hundred copies of it.
  if (unverifiable > 0) {
    const whose = unverifiable === 1 ? "1 service's" : `${unverifiable} services'`;
    console.log(
      `⚠ sources.unverifiable-from-here: ${whose} sources can only be checked from their own repos`,
    );
  }
  // The axis banners — one per not-started axis that actually grouped a
  // warning, in the axes' fixed order, each naming its dropped codes with
  // counts. Tallied off the UNFILTERED findings (the same walk the footer
  // counts), and printed under --errors-only too: like the footer and the
  // unverifiable line this is a rollup, not a finding.
  if (card !== null && grouped.size > 0) {
    const tally = new Map<string, number>();
    for (const t of targets) {
      for (const f of t.findings) {
        if (isGrouped(f)) tally.set(f.code, (tally.get(f.code) ?? 0) + 1);
      }
    }
    for (const axis of ADOPTION_AXES) {
      // Insertion order of `grouped` is the table's order, so the pairs render
      // deterministically across runs and machines.
      const pairs = [...grouped]
        .filter(([code, a]) => a === axis && (tally.get(code) ?? 0) > 0)
        .map(([code]) => [code, tally.get(code) ?? 0] as const);
      if (pairs.length === 0) continue;
      const total = pairs.reduce((n, [, k]) => n + k, 0);
      console.log(
        `⚠ ${axis} axis not started fleet-wide (0 of ${plural(card.services, "service")}), ` +
          `expected during staged adoption — ${total} warning(s) grouped: ` +
          `${pairs.map(([code, k]) => `${code}×${k}`).join(", ")}; every finding is unchanged in --json`,
      );
    }
  }
  if (pointer) console.log(`\n${EXPLAIN_FOOTER}`);
}
