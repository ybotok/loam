/**
 * The human view of a status: one feature, or the whole fleet.
 *
 * Separate from `./json.ts` because the two answer different readers and only
 * one of them is a contract. This side may be reworded freely; the payload
 * beside it may not.
 *
 * Which is also why no bare stage word leads a line here any more. `stage` is a
 * value an agent branches on, and `ready` printed alone over a feature with
 * nothing built read to a person as "ready to ship". The sentence comes from
 * `stageWords` (core/status/feature/words.ts) — the same one the `next[]`
 * statements quote — with the counts that make it true, and the machine value
 * rides in its own row for whoever needs to map the two.
 */
import { answeredSplit, uncommittedClause } from "../../core/verify/record.js";
import { SEVERITY_MARK } from "../../core/vocabulary/report.js";
import { unshippable } from "../../core/status/feature/next.js";
import { archivedVerification, featureLabel, fleetStageWords, stageWords } from "../../core/status/feature/words.js";
import type {
  ArtifactState,
  FeatureStatusReport,
  InterruptedCommit,
  VerificationState,
} from "../../core/status/report.js";
import type { FleetStatusReport } from "../../core/status/fleet/report.js";
import { printFleetNext, printNext } from "./fleet-next.js";

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
 * An artifact row's status, in words. The machine value is `done` for a file
 * that is written AND for one the feature does not owe, and `ready` for a
 * verification record whose claims are still open — three readings a person
 * cannot tell apart from one word, and the reason a table of `done` rows read
 * as finished work over a feature nobody had built.
 */
function artifactWord(a: ArtifactState, v: VerificationState): string {
  if (a.id === "verification") {
    if (a.status === "missing") return "none yet";
    // An attested record is complete and rests on an agent's word; "open"
    // over it contradicted the header that says every claim is answered.
    if (a.status === "ready") return v.verdict === "attested" ? "attested" : "open";
    if (a.status === "done") return "verified";
    if (a.status === "draft") return v.state === "stale" ? "stale" : "unreadable";
    return a.status;
  }
  // A document holding nothing but the scaffold's comment is not "written",
  // owed or not — that word over it is how an untouched feature read as ready.
  if (a.empty === true) return "not written";
  if (a.status === "done") return a.exists ? "written" : "not owed";
  if (a.status === "draft") return "has errors";
  return a.status;
}

/**
 * The counts come from the record's `claims:` array (verify's `tallyRecord`),
 * never from its `summary:` block. The verdict is printed beside the state
 * because they answer different questions and only together are they honest:
 * `recorded  4/4 confirmed` used to be the whole line for a feature `verify`
 * calls `attested` — complete, and resting on somebody's word about a test.
 * Who answered the confirmed ones rides right after the count for the same
 * reason one step further: `verified` turns on the scenario claims alone, and
 * `verified 19/19 confirmed` read as nineteen runs over a record where six
 * answers were an agent's word about a permission or an edge.
 *
 * With no record, the line says how many claims there ARE to answer, when the
 * report knows (`checklist`): "none" alone read as "nothing to do".
 */
function verificationLine(v: VerificationState, asked: number | null): string {
  if (v.state === "absent") return asked === null ? "none — no record" : `none yet — ${asked} claim(s) to answer`;
  if (v.state === "unreadable") return "unreadable";
  // The flag rides beside the verdict it qualifies: `verified` over a commit
  // that did not hold the tested code is the reading this line must not allow.
  const dirty = v.uncommitted === undefined ? "" : uncommittedClause(v.uncommitted);
  return (
    `${v.state} · ${v.verdict}${dirty}  ${v.confirmed}/${v.claims} confirmed` +
    (v.confirmed > 0 ? ` (${answeredSplit(v.answered)})` : "") +
    (v.unanswered > 0 ? ` · ${v.unanswered} unanswered` : "") +
    (v.attested > 0 ? ` · ${v.attested} scenario(s) on an agent's word, not a test run` : "") +
    `  (recorded ${v.recorded ?? "?"})`
  );
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
function printUseCases(u: FeatureStatusReport["useCases"], words: { heading: string; unreadable: string }): void {
  if (u.unreadable) {
    console.log(`\n  ${words.unreadable}`);
    return;
  }
  if (u.flows.length === 0) return;
  console.log(`\n  ${words.heading}`);
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
  // `unshippable`'s count, not `gating`'s: archive's pre-plan refusals carry no
  // `gates`, so "N would stop archive" read 0 over a feature archive refuses.
  const blocking = r.checks.issues.filter(unshippable).length;
  const words = stageWords({
    stage: f.stage,
    archived: f.archived,
    verification: r.verification,
    asked: r.checklist?.claims ?? null,
    missing: r.artifacts.filter((a) => a.status === "missing" && a.id !== "verification").map(artifactLabel),
    narrowed: r.service !== null,
    services: f.services.length,
    blockedBy: f.blockedBy,
    interrupted: r.interrupted !== null,
    blocking,
  });
  console.log(`loam status ${featureLabel(f)}: ${words}`);
  console.log(`  stage         ${f.stage}  (\`loam explain ${f.stage}\` says what it promises and what it does not)`);
  console.log(`  feature       ${f.dirName}  ${f.path}`);
  console.log(`  services      ${f.services.length > 0 ? f.services.join(", ") : "(none)"}`);
  if (r.service !== null) console.log(`  narrowed to   ${r.service}`);
  if (f.blockedBy.length > 0) console.log(`  waiting on    ${f.blockedBy.join(", ")}`);
  console.log(
    `  coherence     ${
      r.checks.ran
        ? `${r.checks.errors} error(s) · ${r.checks.warnings} warning(s) · ${blocking} stop it (validate --feature or archive refuses on each)`
        : "not run — an archived feature is history, already merged"
    }`,
  );
  console.log(`  verification  ${verificationLine(r.verification, r.checklist?.claims ?? null)}`);
  // Printed whatever the count, zero included: "no open questions" is a fact a
  // reviewer wants as much as "twenty-five", and it is never a grade.
  console.log(`  questions     ${f.openQuestions} open in intent.md's \`## Open questions\` — counted, not graded`);
  if (ambiguous.length > 0) {
    console.log(`  note          '${f.id}' also names ${ambiguous.filter((d) => d !== f.dirName).join(", ")}`);
  }

  console.log("\n  artifacts");
  const labels = r.artifacts.map(artifactLabel);
  const labelWidth = pad(labels);
  const statuses = r.artifacts.map((a) => artifactWord(a, r.verification));
  const statusWidth = pad(statuses);
  for (const [i, a] of r.artifacts.entries()) {
    // A row for a file that is not there is the one a reader misreads: `not
    // owed` means the feature owes no such artifact, not that one was written.
    // The JSON contract says it with `exists`; the human view says it in
    // words, or the table quietly claims files that do not exist.
    const note =
      a.blockedBy.length > 0
        ? `  (needs ${a.blockedBy.join(", ")})`
        : !a.exists && a.status === "done"
          ? "  (not written)"
          : "";
    console.log(
      `    ${statuses[i]!.padEnd(statusWidth)}  ${labels[i]!.padEnd(labelWidth)}  ${a.path}${note}`.trimEnd(),
    );
  }

  if (r.checks.issues.length > 0) {
    console.log("\n  findings");
    for (const issue of r.checks.issues) {
      console.log(`    ${SEVERITY_MARK[issue.severity]} ${issue.code}: ${issue.message}`);
    }
  }

  printUseCases(r.useCases, {
    heading: "use cases",
    unreadable: "use cases     architecture/ does not parse, so the flows through these services could not be read",
  });
  // The feature's own flows under a heading of their own: they are what the
  // change is FOR, and a reader must not take them for flows already living.
  if (r.featureUseCases !== undefined) {
    printUseCases(r.featureUseCases, {
      heading: "its use cases (this feature's own flows)",
      unreadable: "its use cases this feature's usecases/ could not be read against the map its merge leaves",
    });
  }
  printNext(r.next);
}

export function printFleet(r: FleetStatusReport): void {
  if (r.interrupted !== null) printInterrupted(r.interrupted);
  const s = r.services;
  console.log(`loam status — ${s.total} service(s) · ${r.features.length} feature(s) in flight`);
  // The sampled and stale counts inside the vouched one, the scorecard's own
  // layout: a reader who stops at the first number must not have been told the
  // stronger of the two.
  const notes = [
    ...(s.sampledVouched > 0 ? [`${s.sampledVouched} sampled`] : []),
    ...(s.contentStale > 0 ? [`${s.contentStale} stale`] : []),
  ];
  console.log(
    `  services      ${s.undocumented} undocumented · ${s.draft} draft · ${s.vouched} vouched${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
  );
  if (r.service !== null) console.log(`  narrowed to   ${r.service}`);
  if (r.order.length > 1) console.log(`  order         ${r.order.join(" → ")}`);

  // Two lines a feature: the id and what it is CALLED, then where it stands in
  // words. The fleet form grades nothing (no coherence run, no checklist), so
  // its sentence can only count what a record already says — and says so.
  if (r.features.length > 0) {
    console.log("\n  features");
    const ids = pad(r.features.map((f) => f.id));
    for (const f of r.features) {
      console.log(`    ${f.id.padEnd(ids)}  ${f.title ?? ""}`.trimEnd());
      const where = fleetStageWords(f, r.interrupted !== null);
      console.log(`    ${" ".repeat(ids)}  ${where} · ${f.services.length > 0 ? f.services.join(", ") : "no service yet"}`);
    }
  }
  // Archived with the done-check still open — listed so open work does not
  // vanish at archive (`FleetStatusReport.unverifiedArchived` says why). The
  // verdict sentence is the one `loam status <FEAT>` prints for the same record.
  if (r.unverifiedArchived.length > 0) {
    console.log("\n  archived, not verified");
    const ids = pad(r.unverifiedArchived.map((f) => f.id));
    for (const f of r.unverifiedArchived) {
      console.log(`    ${f.id.padEnd(ids)}  ${f.title ?? ""}`.trimEnd());
      console.log(`    ${" ".repeat(ids)}  ${archivedVerification(f.verification)} · ${f.services.length > 0 ? f.services.join(", ") : "no service"}`);
    }
  }

  printFleetNext(r);
}
