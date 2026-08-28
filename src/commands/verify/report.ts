/**
 * The done-check as an answer: every claim, its verdict, and who said so.
 *
 * The per-claim rows are computed once and both surfaces read them — `--json`
 * and the terminal cannot disagree about a count, which is the failure this
 * shape prevents. The federation note is here rather than at the call sites
 * because a federated record answers per SERVICE and a reader looking at one
 * lens has to be told which of the others have not answered yet.
 */
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { type CommitRecovery } from "../../core/staging/interrupted.js";
import { type AnsweredBy } from "../../core/verify/answers.js";
import { type Checklist } from "../../core/verify/checklist.js";
import { type EvidencePin } from "../../core/verify/pins/pin.js";
import {
  openClaimsNotice,
  tallyAnswers,
  type Verification,
  verificationPath,
  verificationVerdict,
} from "../../core/verify/record.js";
import { EXPLAIN_FOOTER, plural } from "../policy/format.js";
import { answeredMark, contestedNotices, contractReportLine, forkedChecklistNotices, MARK, noticesFor, reportLine } from "./frozen.js";

export interface ClaimStatus {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: "confirmed" | "unconfirmed" | "unanswered";
  answered_by?: AnsweredBy;
  evidence: string[];
  note?: string;
  /** The recorded pins, passed through where the record carries them — additive payload key. */
  evidence_pins?: EvidencePin[];
}

export function statuses(checklist: Checklist, claims: Checklist["claims"], recorded: Verification | null): ClaimStatus[] {
  const subjects = new Map(checklist.claims.map((claim) => [claim.id, claim.subject]));
  const attested =
    recorded?.schema !== 2
      ? null
      : new Set(
          (recorded.attestations ?? []).flatMap((attestation) =>
            attestation.claims.filter((id) => subjects.get(id) === attestation.service),
          ),
        );
  const byId = new Map(
    (recorded?.claims ?? [])
      .filter((claim) => attested === null || attested.has(claim.id))
      .map((claim) => [claim.id, claim]),
  );
  return claims.map((c) => {
    const answer = byId.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      subject: c.subject,
      claim: c.claim,
      verdict: answer?.verdict ?? "unanswered",
      ...(answer?.answered_by === undefined ? {} : { answered_by: answer.answered_by }),
      evidence: answer?.evidence ?? [],
      ...(answer?.note === undefined ? {} : { note: answer.note }),
      ...(answer?.evidence_pins === undefined ? {} : { evidence_pins: answer.evidence_pins }),
    };
  });
}

/**
 * The read view.
 *
 * `lens` is `--service`: the same checklist, narrowed to the claims that
 * service's code answers. It exists because in a ten-repo fleet the whole
 * checklist is never one repository's business, and an agent that cannot ask
 * "what do I still owe on FEAT-1?" answers the question by guessing. Narrowing
 * narrows the verdict too — `verified` then means "every claim owned by this
 * service is confirmed", which is why the payload names the service it applied.
 *
 * `bound` is loam.json's `service` — what this repository says it is. It only
 * shapes the footer, and it is the whole of how federation is discoverable:
 * the recording form printed here is the one that will actually work from here.
 */
/**
 * Which feature is being reported on, and in what voice.
 *
 * Three of these travelled as loose strings beside two booleans through every
 * reporting path. They are one thing — the target of this run — and a record
 * makes the `--json` flag impossible to transpose with a lens name, which is
 * what the positional form allowed.
 */
export interface VerifyTarget {
  docsDir: string;
  featureDir: string;
  json: boolean;
  /**
   * Non-null when the record path first rolled a predecessor's interrupted
   * commit forward under its lock. Only `record` reports it; the read path
   * never recovers, so it never carries one.
   */
  recovered?: CommitRecovery | null;
}

export function report(
  target: VerifyTarget,
  checklist: Checklist,
  recorded: Verification | null,
  scope: { lens?: string; bound?: string } = {},
): void {
  const { docsDir, featureDir, json } = target;
  const lens = scope.lens;
  const owners = [...new Set(checklist.claims.map((c) => c.subject))].sort();
  const scoped = lens === undefined ? checklist.claims : checklist.claims.filter((c) => c.subject === lens);
  const claims = statuses(checklist, scoped, recorded);
  const count = (v: string): number => claims.filter((c) => c.verdict === v).length;
  const summary = {
    claims: claims.length,
    confirmed: count("confirmed"),
    unconfirmed: count("unconfirmed"),
    unanswered: count("unanswered"),
  };
  // A record that answers a different question set is not an answer to this one,
  // however complete it looks — so staleness disqualifies it as a whole.
  const stale = recorded !== null && recorded.checklist !== checklist.digest;
  const tally = tallyAnswers(claims);
  const verdict = verificationVerdict(tally, stale);
  // `verified` keeps its name and its type, and loses its old meaning: a
  // scenario claim on an agent's word is answered, not run, so it no longer
  // reads the same as a green suite. `verdict` carries the distinction.
  const verified = verdict === "verified";
  // Contest is derivable from the checklist alone, so the read view says it
  // too: an agent looking at what it owes should learn that a second service
  // answers the same claim BEFORE it runs a suite whose report cannot be
  // attributed. Always from the whole checklist, never the lens — a shared
  // digest is a fact about the feature, and a narrowed view is the one place it
  // would otherwise be invisible.
  // The open-claims honesty line only where a record EXISTS: with none, the
  // surface already says "Not verified", and not-started is not partial.
  const open = recorded === null ? null : openClaimsNotice(tally, checklist.feature);
  const notices = [
    ...noticesFor(claims, checklist.feature),
    ...(open === null ? [] : [open]),
    ...contestedNotices(checklist.claims),
    ...forkedChecklistNotices(recorded),
  ];

  if (json) {
    emitJson({
      feature: checklist.feature,
      path: repoPath(docsDir, featureDir),
      digest: checklist.digest,
      // Named only when narrowed, so a consumer can never mistake a service's
      // verdict for the feature's.
      ...(lens === undefined ? {} : { service: lens, checklistClaims: checklist.claims.length }),
      verified,
      verdict,
      attested: tally.attested,
      summary,
      services: owners,
      recorded:
        recorded === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: recorded.recorded,
              checklist: recorded.checklist,
              stale,
              ...(recorded.attestations === undefined ? {} : { attestations: recorded.attestations }),
              ...(recorded.report === undefined ? {} : { report: recorded.report }),
              ...(recorded.contractReport === undefined ? {} : { contractReport: recorded.contractReport }),
            },
      claims,
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  const scopeNote =
    lens === undefined ? "" : ` owned by ${lens} (of ${plural(checklist.claims.length, "claim")} on the checklist)`;
  console.log(
    `${checklist.feature} — ${plural(claims.length, "claim")}${scopeNote} derived from ${repoPath(docsDir, featureDir)}\n`,
  );
  if (claims.length === 0) {
    console.log(
      lens === undefined
        ? "  Nothing to check: this feature's delta, specs and openapi promise nothing yet."
        : `  No claim on this checklist is owned by '${lens}'.${owners.length > 0 ? ` The services that own claims here are ${owners.join(", ")}.` : ""}`,
    );
    return;
  }
  for (const c of claims) {
    console.log(`  ${MARK[c.verdict]} ${c.id}  [${c.subject}]  ${c.claim}${answeredMark(c)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }

  console.log("");
  if (recorded === null) {
    console.log(`  Not verified — no ${repoPath(docsDir, verificationPath(featureDir))}.`);
  } else {
    console.log(
      `  Recorded ${recorded.recorded} — ${summary.confirmed} confirmed, ${summary.unconfirmed} unconfirmed, ${summary.unanswered} unanswered.`,
    );
    if (stale) {
      console.log("  STALE: the feature changed after this was recorded. Answer the claims above again.");
    }
    for (const attestation of recorded.attestations ?? []) {
      console.log(
        `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}, ${plural(attestation.claims.length, "claim")}).`,
      );
      if (attestation.report !== undefined) console.log(`      from ${reportLine(attestation.report)}`);
      if (attestation.contractReport !== undefined) {
        console.log(`      from ${contractReportLine(attestation.contractReport)}`);
      }
    }
    if (recorded.report !== undefined) console.log(`  Answered from ${reportLine(recorded.report)}.`);
    if (recorded.contractReport !== undefined) {
      console.log(`  Contract report read: ${contractReportLine(recorded.contractReport)}.`);
    }
  }
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
  // An attested record has answered every question — telling it to "answer each
  // claim" would send an agent round a loop it has already run. The notice
  // above names the one thing left, which is a test run.
  if (verdict === "unverified") {
    console.log("\n  Answer each claim, then record the answers:\n");
    console.log('    [{ "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/x.ts:42"] }]');
    console.log(`\n    loam verify ${checklist.feature} --record answers.json${recordSuffix(scope, owners)}`);
    for (const line of federationNote(scope, owners)) console.log(line);
    console.log("\n  A claim you cannot show evidence for is `unconfirmed` — say why in `note`.");
  }
  // APPENDED, as format.ts promises — the report's last line, never a wedge
  // between the notices and the recording instructions that follow them. It
  // follows printed notice codes only: claim marks carry no code to look up,
  // and the frozen post-archive view (frozen.ts) stays without it on purpose,
  // because shipped history is not a fix-it surface.
  if (notices.length > 0) console.log(`\n${EXPLAIN_FOOTER}`);
}

/**
 * The `--service` the printed form should carry. It comes from loam.json, never
 * from the checklist: the only attestation this repository can make is its own,
 * and a hint naming a service that lives somewhere else is a hint that fails.
 */
export function recordSuffix(scope: { lens?: string; bound?: string }, owners: string[]): string {
  if (scope.bound !== undefined) return ` --service ${scope.bound}`;
  return owners.length > 1 || scope.lens !== undefined ? " --service <svc>" : "";
}

/** Why the form above has a `--service` on it — the one place federation is taught. */
export function federationNote(scope: { lens?: string; bound?: string }, owners: string[]): string[] {
  if (scope.bound !== undefined) {
    const others = owners.filter((s) => s !== scope.bound);
    return [
      "",
      `  This repository is ${scope.bound}, so it attests only ${scope.bound}'s claims, bound to its git HEAD.`,
      ...(others.length === 0
        ? []
        : [`  The claims owned by ${others.join(", ")} are recorded the same way from those repositories.`]),
    ];
  }
  if (owners.length > 1 || scope.lens !== undefined) {
    return [
      "",
      `  This checklist spans ${plural(owners.length, "service")} (${owners.join(", ")}) — each attests its own claims`,
      "  from its own repository, where loam.json names that service.",
    ];
  }
  return [];
}

/**
 * The frozen view: an archived feature's record, verbatim. No checklist is
 * derived and no staleness is judged — there is nothing current to judge
 * against, and pretending otherwise is how a true record reads as a lie.
 * `frozen` is the marker a consumer branches on.
 *
 * The verdict is recounted from `claims[]`, never taken from `summary`: this is
 * the post-ship verdict on a feature nobody can re-derive a checklist for, so a
 * record whose counts had drifted from its own answers reported a shipped
 * feature as fully confirmed. (A record that contradicts itself never reaches
 * here — `readVerificationState` refuses it — so the recount and the summary
 * agree; the recount is what says WHY.) No record at all is reported as exactly
 * that, with `summary: null`, not zero claims, which would falsely say the
 * feature promised nothing.
 */
