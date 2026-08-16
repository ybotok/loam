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
import {
  countSeverity,
  SEVERITY_MARK,
  type Finding,
  type TargetReport,
} from "../../core/vocabulary/report.js";
import { plural } from "../policy/format.js";

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

/**
 * `--errors-only` is a RENDERING lever, the way `--strict` is an exit-code
 * lever: neither changes the report, and the `--json` payload is unaffected by
 * both. On a fleet of a hundred services the clean run prints several hundred
 * `ok` confirmations, and the two warnings that matter are somewhere inside it;
 * anyone reading a CI log wants the exceptions, and anyone auditing wants all
 * of it. Both are available, from the same run, and neither is the default.
 */
export function renderText(
  targets: TargetReport[],
  all: boolean,
  unverifiable: number,
  errorsOnly: boolean,
): void {
  for (const t of targets) {
    const shown = errorsOnly ? t.findings.filter((f) => f.severity !== "ok") : t.findings;
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
      console.log(`${" ".repeat(hint.indent ?? 0)}${marker}${f.message}`);
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
}
