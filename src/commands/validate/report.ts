/**
 * Everything that happens to a `TargetReport` around the checks themselves:
 * how one is built when a target could not be read at all, how a finding's
 * evidence is capped, and how the set is summed. How it PRINTS is
 * `./render/text.ts`.
 *
 * A module rather than the tail of validate.ts because the rollup and the
 * renderer have to agree. The `--all` footer and the `--json` summary are the
 * same `summary()` — computed here once and HANDED to the renderer, which
 * never counts for itself — and the cap reaches both payloads from one place;
 * a second copy of either is how a footer starts printing a number its own
 * findings contradict.
 */
import { isAbsolute } from "node:path";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { repoPath } from "../../core/envelope/json.js";
import {
  countSeverity,
  subjectsWith,
  type Finding,
  type TargetReport,
} from "../../core/vocabulary/report.js";

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
 * number and this one are structurally the same number. The code is a LITERAL,
 * as it is at the emission site (checks/sources.ts), rather than a shared
 * constant, because the stable-code collector reads counting sites too, and it
 * refuses a slot it cannot read — the collector is also what convicts a typo
 * here.
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
 * `docsDir` is how it names the path: see `shownPath`.
 */
export async function guarded(
  target: { kind: "service" | "feature"; id: string },
  docsDir: string,
  run: () => Promise<TargetReport>,
): Promise<TargetReport> {
  try {
    return await run();
  } catch (err) {
    // A docs repo that vanished mid-run is not one target's problem — it is the
    // whole run's, and the action's own catch reports it.
    if (err instanceof DocsRepoUnavailableError) throw err;
    const abs = (err as NodeJS.ErrnoException).path;
    const path = abs === undefined ? undefined : shownPath(docsDir, abs);
    // Node spells the same absolute path inside its own message
    // (`EACCES: permission denied, open '…'`), so the reason is respelled
    // with it — otherwise the one finding would name the file twice, two ways.
    const said = err instanceof Error ? err.message : String(err);
    const reason = abs === undefined || path === undefined ? said : said.replaceAll(abs, path);
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
 * A path as a finding's message names it: repo-relative and `/`-separated when
 * it is inside the docs repo, so the report reads the same on every machine
 * and in every CI log — an absolute path names the checkout that ran the
 * check, not the file in the repository. A path OUTSIDE the docs repo (a
 * source file in the service repo loam is standing in) keeps its absolute
 * spelling: the `../` route to it depends on where two checkouts happen to
 * sit, which is exactly what a relative path was meant to stop mattering.
 */
function shownPath(docsDir: string, abs: string): string {
  const rel = repoPath(docsDir, abs);
  return rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? abs : rel;
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
