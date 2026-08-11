/**
 * `loam status` — the read-only projection. Nothing here computes anything: the
 * derivation lives in core/status.ts (and, underneath it, in the same coherence
 * and verification calls `validate`, `verify` and `archive` make). This file
 * resolves the target, refuses the arguments it cannot honour, and renders.
 *
 * It reports and does not gate, which is why it never sets a non-zero exit code
 * on a successful run — see `registerStatus`.
 */
import type { Command } from "commander";
import { loadConfig } from "../core/envelope/config.js";
import { FleetContext } from "../core/fleet-context.js";
import { emitJson, fail, reportNoConfig } from "../core/envelope/json.js";
import { findingJson, SEVERITY_MARK } from "../core/vocabulary/report.js";
import { DocsRepoUnavailableError } from "../core/repo/state.js";
import { featureCandidates, missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";
import {
  featureStatus,
  fleetStatus,
  type ArtifactState,
  type FeatureStatusReport,
  type FleetStatusReport,
  type InterruptedCommit,
  type NextStep,
  type VerificationState,
} from "../core/status.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "./docs-repo-gate.js";

interface StatusOptions {
  json?: boolean;
  service?: string;
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .argument("[feature]", "feature id or directory name; omit for the whole repository")
    .description("Report where the work stands and what to do next, derived from the files")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--service <id>", "narrow the per-service view to one service")
    .action(async (featureArg: string | undefined, opts: StatusOptions) => {
      const json = opts.json === true;
      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      // A docsDir that is not a docs repo is refused, never rendered as a repo
      // with nothing in it — the doctrine docs-repo-gate.ts's docsRepoReady exists
      // for. `status` counts services, so it needs services/ in both modes.
      if (!docsRepoReady(json, docsDir, "services")) return;
      const context = new FleetContext();
      // What the refusal below says it was answering when it gave up.
      let scope = "this repository";

      try {
        if (featureArg === undefined) {
          // `bound` is what THIS repo says it is, which is a different fact from
          // `--service` (which narrows the view). Passing it is what lets the
          // fleet form notice that the repository it is standing in has never
          // been adopted — the one thing a fleet count cannot see.
          const report = await fleetStatus(docsDir, {
            service: opts.service,
            bound: config.service,
            context,
          });
          // A `--service` that names nothing is refused rather than answered
          // with an empty fleet: "no services and no features" and "you
          // misspelled it" are opposite facts, and only one of them is worth
          // acting on.
          if (opts.service !== undefined && report.services.total === 0) {
            fail(json, "unknown-service", `No service '${opts.service}' under ${docsDir}/services/.`);
            return;
          }
          if (json) emitJson({ command: "status", docsDir, scope: "fleet", ...fleetJson(report) });
          else printFleet(report);
          return;
        }

        // Archived features are IN scope: an agent asking where FEAT-101 stands
        // after it shipped deserves "it shipped", not "no such feature" — the
        // same reading `show` takes. An argument naming two directories is
        // still answered (status writes nothing), with the tie broken the way
        // resolveFeature always breaks it.
        const feature = await resolveFeature(docsDir, featureArg, "include", context);
        if (!feature) {
          fail(json, "unknown-target", await missingFeatureMessage(docsDir, featureArg, context));
          return;
        }
        scope = feature.id;
        // `config.service` is not a lens like `--service`: it says which
        // repository this IS, and three of the steps (`loam gherkin`, `verify
        // --record --service`) refuse anywhere else. Without it status handed a
        // docs-repo reader commands only a service repo can run, and never told
        // a service repo that the work in front of it was its own.
        const report = await featureStatus(docsDir, feature, {
          service: opts.service,
          boundService: config.service,
          context,
        });
        if (opts.service !== undefined && !report.feature.services.includes(opts.service)) {
          fail(
            json,
            "unknown-service",
            `${feature.id} carries no delta for '${opts.service}'. It touches: ${
              report.feature.services.length > 0 ? report.feature.services.join(", ") : "(no services)"
            }.`,
          );
          return;
        }
        const ambiguous = await featureCandidates(docsDir, featureArg, "include", context);
        if (json) {
          emitJson({ command: "status", docsDir, scope: "feature", ...featureJson(report) });
        } else {
          printFeature(report, ambiguous.length > 1 ? ambiguous.map((c) => c.dirName) : []);
        }
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // One unreadable artifact must not escape as a stack trace and an
        // `internal` envelope that names nothing: the projection is
        // all-or-nothing (a status missing one artifact reads as a feature that
        // does not owe it), so the honest answer is a refusal naming the path.
        // The errno-vs-path reading this branch depends on — the reason one
        // directory where a file belongs used to kill BOTH forms of status —
        // now lives once, with its reasoning, on the shared helper.
        reportRepositoryUnavailable(
          json,
          err,
          `the status of ${scope} would be missing an artifact`,
          docsDir,
        );
      }
      // No exit code is set on any path above that succeeded, deliberately.
      // `doctor` exits 1 because a broken installation makes every later
      // command lie, and `validate` exits 1 because it IS the fleet gate. This
      // command is a question, and its answer is equally true whether the
      // feature is finished or not — an agent runs it precisely BECAUSE work is
      // outstanding, and exiting 1 there would make every `set -e` script and
      // every CI step read "there is work to do" as a failure.
    });
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

/**
 * `issues` go out through `findingJson`, the same serializer `validate` uses:
 * an `Issue` is a `Finding` without details, and one breach reported by two
 * commands must arrive in one shape or a consumer needs two parsers.
 */
function featureJson(r: FeatureStatusReport): Record<string, unknown> {
  return {
    interrupted: r.interrupted,
    feature: r.feature,
    service: r.service,
    artifacts: r.artifacts,
    checks: { ...r.checks, issues: r.checks.issues.map(findingJson) },
    verification: r.verification,
    next: r.next,
  };
}

function fleetJson(r: FleetStatusReport): Record<string, unknown> {
  return {
    interrupted: r.interrupted,
    service: r.service,
    services: r.services,
    features: r.features,
    order: r.order,
    next: r.next,
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function pad(values: string[]): number {
  return Math.max(0, ...values.map((v) => v.length));
}

/**
 * The half-merged-repo banner, printed FIRST and on stderr.
 *
 * stderr, alone among this command's output, because it is not part of the
 * answer: it is the reason the answer may be wrong. A reader piping `status`
 * into a pager still sees it, and the human view stays the shape every other
 * run has. `--json` carries the same fact in `interrupted`.
 */
function printInterrupted(i: InterruptedCommit): void {
  console.error(
    i.unreadable
      ? "⚠ this docs repo holds a .loam-commit that cannot be read — a commit was interrupted and nothing here can be trusted until a human compares the living docs against version control."
      : `⚠ a \`${i.recover}\` was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — ${i.files.length} file(s) may be half-written: ${i.files.join(", ")}. Everything below is derived from them.`,
  );
  console.error("");
}

/** `spec (payment-service)` — the artifact id plus the service, when it has one. */
function artifactLabel(a: ArtifactState): string {
  return a.service === null ? a.id : `${a.id} (${a.service})`;
}

/**
 * The counts come from the record's `claims:` array (verify's `tallyRecord`),
 * never from its `summary:` block. The verdict is printed beside the state
 * because they answer different questions and only together are they honest:
 * `recorded  4/4 confirmed` used to be the whole line for a feature `verify`
 * calls `attested` — complete, and resting on somebody's word about a test.
 */
function verificationLine(v: VerificationState): string {
  if (v.state === "absent") return "none";
  if (v.state === "unreadable") return "unreadable";
  return (
    `${v.state} · ${v.verdict}  ${v.confirmed}/${v.claims} confirmed` +
    (v.unanswered > 0 ? ` · ${v.unanswered} unanswered` : "") +
    (v.attested > 0 ? ` · ${v.attested} scenario(s) on an agent's word, not a test run` : "") +
    `  (recorded ${v.recorded ?? "?"})`
  );
}

/**
 * The steps, numbered, with the command on its own indented line — doctor's
 * layout, for doctor's reason: what to do and what to type are two different
 * sentences, and someone scanning a half-built feature reads down the `run:`
 * column.
 */
function printNext(steps: NextStep[]): void {
  console.log("\n  next");
  for (const [i, step] of steps.entries()) {
    console.log(`    ${i + 1}. ${step.code}: ${step.statement}`);
    console.log(`       run: ${step.command}`);
  }
}

function printFeature(r: FeatureStatusReport, ambiguous: string[]): void {
  if (r.interrupted !== null) printInterrupted(r.interrupted);
  const f = r.feature;
  console.log(`loam status ${f.id} — ${f.stage}${f.archived ? " (archived)" : ""}`);
  console.log(`  feature       ${f.dirName}  ${f.path}`);
  console.log(`  services      ${f.services.length > 0 ? f.services.join(", ") : "(none)"}`);
  if (r.service !== null) console.log(`  narrowed to   ${r.service}`);
  if (f.blockedBy.length > 0) console.log(`  waiting on    ${f.blockedBy.join(", ")}`);
  console.log(
    `  coherence     ${
      r.checks.ran
        ? `${r.checks.errors} error(s) · ${r.checks.warnings} warning(s) · ${r.checks.gating} gate archive`
        : "not run (archived)"
    }`,
  );
  console.log(`  verification  ${verificationLine(r.verification)}`);
  if (ambiguous.length > 0) {
    console.log(`  note          '${f.id}' also names ${ambiguous.filter((d) => d !== f.dirName).join(", ")}`);
  }

  console.log("\n  artifacts");
  const labels = r.artifacts.map(artifactLabel);
  const labelWidth = pad(labels);
  const statusWidth = pad(r.artifacts.map((a) => a.status));
  for (const [i, a] of r.artifacts.entries()) {
    // `done` on a file that is not there is the one row a reader misreads: it
    // means the feature owes no such artifact, not that one was written. The
    // JSON contract says it with `exists`; the human view has to say it in
    // words, or the table quietly claims files that do not exist.
    const note =
      a.blockedBy.length > 0
        ? `  (needs ${a.blockedBy.join(", ")})`
        : !a.exists && a.status === "done"
          ? "  (not written — none owed)"
          : "";
    console.log(
      `    ${a.status.padEnd(statusWidth)}  ${labels[i]!.padEnd(labelWidth)}  ${a.path}${note}`.trimEnd(),
    );
  }

  if (r.checks.issues.length > 0) {
    console.log("\n  findings");
    for (const issue of r.checks.issues) {
      console.log(`    ${SEVERITY_MARK[issue.severity]} ${issue.code}: ${issue.message}`);
    }
  }

  printNext(r.next);
}

function printFleet(r: FleetStatusReport): void {
  if (r.interrupted !== null) printInterrupted(r.interrupted);
  const s = r.services;
  console.log(`loam status — ${s.total} service(s) · ${r.features.length} feature(s) in flight`);
  console.log(
    `  services      ${s.undocumented} undocumented · ${s.draft} draft · ${s.vouched} vouched`,
  );
  if (r.service !== null) console.log(`  narrowed to   ${r.service}`);
  if (r.order.length > 1) console.log(`  order         ${r.order.join(" → ")}`);

  if (r.features.length > 0) {
    console.log("\n  features");
    const ids = pad(r.features.map((f) => f.id));
    const stages = pad(r.features.map((f) => f.stage));
    for (const f of r.features) {
      const detail =
        f.blockedBy.length > 0
          ? `waiting on ${f.blockedBy.join(", ")}`
          : f.missing.length > 0
            ? `missing ${f.missing.join(", ")}`
            : f.services.join(", ");
      console.log(`    ${f.stage.padEnd(stages)}  ${f.id.padEnd(ids)}  ${detail}`.trimEnd());
    }
  }

  printNext(r.next);
}
