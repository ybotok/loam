/**
 * The human view of a status: one feature, or the whole fleet.
 *
 * Separate from `./json.ts` because the two answer different readers and only
 * one of them is a contract. This side may be reworded freely; the payload
 * beside it may not.
 */
import { SEVERITY_MARK } from "../../core/vocabulary/report.js";
import type {
  ArtifactState,
  FeatureStatusReport,
  FleetStatusReport,
  InterruptedCommit,
  NextStep,
  VerificationState,
} from "../../core/status/report.js";

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

/**
 * The business flows the services in view already appear in.
 *
 * Silent when the fleet declares none, unlike the delta brief's version of the
 * same section: this report is a table of what is OWED, and a "(none)" row for
 * a fleet that has never drawn a use case would be one more line between the
 * reader and the next step. The unreadable arm is not silent, because that one
 * is a hole rather than an absence.
 */
function printUseCases(u: FeatureStatusReport["useCases"]): void {
  if (u.unreadable) {
    console.log("\n  use cases     architecture/ does not parse, so the flows through these services could not be read");
    return;
  }
  if (u.flows.length === 0) return;
  console.log("\n  use cases");
  for (const flow of u.flows) {
    console.log(`    ${flow.title ?? flow.id}  [${flow.id}]  ${flow.file}`);
    for (const step of flow.steps) {
      const label = step.title === undefined ? "" : ` '${step.title}'`;
      console.log(`      step ${step.ordinal}${label}: ${step.source} -> ${step.target}`);
    }
  }
}

export function printFeature(r: FeatureStatusReport, ambiguous: string[]): void {
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

  printUseCases(r.useCases);
  printNext(r.next);
}

export function printFleet(r: FleetStatusReport): void {
  if (r.interrupted !== null) printInterrupted(r.interrupted);
  const s = r.services;
  console.log(`loam status — ${s.total} service(s) · ${r.features.length} feature(s) in flight`);
  console.log(
    // The sampled count inside the vouched one, the scorecard's own layout: a
    // reader who stops at the first number must not have been told the
    // stronger of the two.
    `  services      ${s.undocumented} undocumented · ${s.draft} draft · ${s.vouched} vouched${s.sampledVouched > 0 ? ` (${s.sampledVouched} sampled)` : ""}`,
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
