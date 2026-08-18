/**
 * Writing the answers down.
 *
 * The one command in loam that takes somebody's word for something, so every
 * refusal here is about whose word is on the file. The legacy all-at-once form
 * run over a federated record does not merge and does not migrate — it would
 * erase every other service's commit-bound attestation, invisibly, because what
 * replaces it is a well-formed and plausible record.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { today } from "../../core/provenance/stamp.js";
import { runnerAnswers } from "../../core/results.js";
import { checkAnswers, type Answer } from "../../core/verify/answers.js";
import {
  buildFederatedVerification,
  buildVerification,
  type DiscardedAnswer,
} from "../../core/verify/build.js";
import { type Checklist } from "../../core/verify/checklist.js";
import { commitVerification } from "../../core/verify/store/commit.js";
import {
  tallyRecord,
  type ConsumedReport,
  type Verification,
  verificationPath,
  verificationVerdict,
} from "../../core/verify/record.js";
import { plural } from "../policy/format.js";
import { readResults, repositoryCommit, validateServiceEvidence } from "./results.js";
import { contestedNotices, noticesFor, reportLine } from "./frozen.js";
import { type VerifyTarget } from "./report.js";

/** The flags `loam verify --record` reads. */
export interface VerifyOptions {
  record?: string;
  results?: string;
  service?: string;
  json?: boolean;
}

/**
 * The repository whose word this record is taking, for which service, and over
 * which existing record.
 *
 * `previous` belongs here rather than beside it: every refusal in this function
 * is about whether THIS attestor may write over what that record already says,
 * so the two are never asked about separately.
 */
export interface Attestor {
  /** Undefined in the legacy all-at-once form, which answers for every service. */
  service: string | undefined;
  repoDir: string;
  previous: Verification | null;
  /**
   * The exact bytes `previous` was parsed from — null when there was no record.
   * They travel together because they ARE the same read: the merge consumes the
   * parse, the commit compares the bytes, and a pre-image from any other read
   * would let the commit vouch for a document the merge never saw.
   */
  preImage: Buffer | null;
}

export async function record(
  target: VerifyTarget,
  checklist: Checklist,
  attestor: Attestor,
  opts: VerifyOptions,
): Promise<void> {
  const { docsDir, featureDir, json } = target;
  const { service, repoDir, previous, preImage } = attestor;
  // The legacy all-at-once form answers the WHOLE checklist on one repository's
  // word and writes a schema-1 record — no attestations, no commits. Run over a
  // federated record it does not merge and it does not migrate: it erases every
  // other service's commit-bound attestation, and the erasure is invisible
  // afterwards because what replaces it is a well-formed, plausible record. So
  // it refuses, and names the repositories whose word is on the file.
  const attested = previous?.schema === 2 ? (previous.attestations ?? []) : [];
  if (service === undefined && attested.length > 0) {
    const services = [...new Set(attested.map((a) => a.service))].sort();
    return fail(
      json,
      "record-federated",
      `${repoPath(docsDir, verificationPath(featureDir))} is a federated record: ${plural(services.length, "service")} (${services.join(", ")}) have attested claims against their own git commits. ` +
        "Recording without --service would replace all of it with one unattested answer set. " +
        `Record this service's claims from its own repo instead: \`loam verify ${checklist.feature} --record answers.json --service <svc>\`.`,
    );
  }

  const scopedClaims =
    service === undefined ? checklist.claims : checklist.claims.filter((claim) => claim.subject === service);
  if (service !== undefined && scopedClaims.length === 0) {
    return fail(
      json,
      "unknown-service",
      `The current ${checklist.feature} checklist has no claims owned by service '${service}'.`,
    );
  }

  // The runner's half: with --results, every scenario.tested claim is the
  // report's to answer — matched by digest, confirmed only by a green run.
  const runnerClaims =
    opts.results === undefined ? [] : scopedClaims.filter((c) => c.kind === "scenario.tested");
  const agentClaims =
    opts.results === undefined ? scopedClaims : scopedClaims.filter((c) => c.kind !== "scenario.tested");

  let fromRunner: Answer[] = [];
  let consumed: ConsumedReport | undefined;
  if (opts.results !== undefined) {
    // A federated record attests for THIS repository, so its report has to be a
    // file inside it — see readResults.
    const read = await readResults(opts.results, service === undefined ? undefined : repoDir);
    if (!read.ok) return fail(json, read.code, read.message);
    consumed = read.report;
    fromRunner = runnerAnswers(runnerClaims, read.scenarios, consumed.path);
  }

  // The agent's half — exactly what the runner does not own. --results alone
  // is legal only when the runner owns the whole checklist: anything left over
  // refuses with the ids, the same discipline as a claim with no answer.
  let raw: unknown = [];
  if (opts.record !== undefined) {
    try {
      // The one path that stays cwd-relative, and deliberately: the answer set
      // is a file the caller just wrote and hands to the command, not part of
      // the repository being attested. Nothing on the record points at it.
      raw = JSON.parse(await readFile(resolve(process.cwd(), opts.record), "utf8"));
    } catch (err) {
      return fail(
        json,
        "answers-unreadable",
        `Cannot read ${opts.record}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (agentClaims.length > 0 && opts.results !== undefined) {
    return fail(
      json,
      "answers-mismatch",
      `--results answers only the scenario.tested claims; ${agentClaims.length} claim(s) have no answer: ` +
        `${agentClaims.map((c) => c.id).join(", ")}. Record them with --record <answers.json> alongside --results.`,
    );
  }

  const checked = checkAnswers(
    agentClaims,
    raw,
    opts.results === undefined ? undefined : new Set(runnerClaims.map((c) => c.id)),
    { feature: checklist.feature, ...(service === undefined ? {} : { service }) },
  );
  if (!checked.ok) return fail(json, checked.code, checked.message);

  let serviceCommit: string | undefined;
  if (service !== undefined) {
    const commit = await repositoryCommit(repoDir);
    if (!commit.ok) return fail(json, "repository-unavailable", commit.message);
    serviceCommit = commit.commit;
    // Both halves, one validator. The runner's evidence used to skip it
    // entirely: `--results` minted confirmations whose evidence strings nothing
    // ever checked, in the one mode that promises every answer is bound to this
    // repository at this commit.
    const evidenceFailure = await validateServiceEvidence(
      [...fromRunner, ...checked.answers],
      repoDir,
      serviceCommit,
      consumed,
    );
    if (evidenceFailure !== null) return fail(json, "answers-unevidenced", evidenceFailure);
  }

  const recorded = today(new Date());
  let verification: Verification;
  let discarded: DiscardedAnswer[] = [];
  if (service === undefined) {
    verification = buildVerification(checklist, [...fromRunner, ...checked.answers], recorded, consumed);
  } else {
    const built = buildFederatedVerification(
      checklist,
      { service, recorded, commit: serviceCommit!, report: consumed },
      [...fromRunner, ...checked.answers],
      previous,
    );
    verification = built.verification;
    discarded = built.discarded;
  }
  // Staged, compared against the locked read's bytes, swapped in by one
  // rename — see core/verify/store/commit.ts for what each refusal means.
  const committed = await commitVerification(featureDir, verification, preImage);
  if (!committed.ok) return fail(json, committed.code, committed.message);
  const path = committed.path;
  const unconfirmed = verification.claims.filter((c) => c.verdict === "unconfirmed");

  // The same judgment read mode makes (see report): the record just written IS
  // the current checklist's answer, so `stale` is false by construction and the
  // remaining question is whether every claim was confirmed — and, now, by
  // whom. Counted from the claims, not from the summary this same call wrote.
  // Without these fields an agent that recorded all-confirmed answers would
  // have to re-run verify just to learn the state it created.
  const tally = tallyRecord(verification);
  const verdict = verificationVerdict(tally);
  const verified = verdict === "verified";
  const notices = [...noticesFor(verification.claims, verification.feature), ...contestedNotices(runnerClaims)];

  if (json) {
    emitJson({
      feature: verification.feature,
      path: repoPath(docsDir, path),
      digest: verification.checklist,
      verified,
      verdict,
      attested: tally.attested,
      recorded: verification.recorded,
      summary: verification.summary,
      ...(verification.attestations === undefined ? {} : { attestations: verification.attestations }),
      ...(consumed === undefined ? {} : { report: consumed }),
      unconfirmed: unconfirmed.map((c) => ({ id: c.id, claim: c.claim, ...(c.note === undefined ? {} : { note: c.note }) })),
      ...(discarded.length === 0 ? {} : { discarded }),
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  console.log(`${verification.feature} verification recorded — ${repoPath(docsDir, path)}\n`);
  console.log(`  ${tally.confirmed} of ${plural(tally.claims, "claim")} confirmed with evidence.`);
  if (consumed !== undefined) {
    console.log(
      `  ${plural(fromRunner.length, "scenario claim")} answered by the test runner (${opts.results})` +
        `${opts.record === undefined ? "" : `, ${checked.answers.length} by ${opts.record}`}.`,
    );
    console.log(`  Report read: ${reportLine(consumed)}.`);
  }
  if (service !== undefined) {
    const attestation = verification.attestations?.find((item) => item.service === service);
    if (attestation !== undefined) {
      console.log(`  ${service} attested at git commit ${attestation.commit}.`);
    }
  }
  for (const c of unconfirmed) {
    console.log(`  ✗ ${c.claim}${c.note === undefined ? "" : ` — ${c.note}`}`);
  }

  // What the previous record answered and this one does not. A federated write
  // is a partial write, so the first one over an all-at-once record drops every
  // answer it cannot attribute to a commit — correct, but silence here reads as
  // loam having lost the answers, and nobody goes looking for what to re-record.
  if (discarded.length > 0) {
    const off = discarded.filter((d) => d.reason === "off-checklist").length;
    console.log(
      `\n  ${plural(discarded.length, "earlier answer")} from ${repoPath(docsDir, verificationPath(featureDir))} ${discarded.length === 1 ? "is" : "are"} not carried into this record:`,
    );
    for (const d of discarded) {
      console.log(
        `    - ${d.id}${d.subject === undefined ? "" : ` [${d.subject}]`}  ${d.claim}` +
          (d.reason === "off-checklist"
            ? "  (the feature changed; nothing asks this any more)"
            : "  (no commit attestation binds it — its service must record it again)"),
      );
    }
    if (discarded.length > off) {
      console.log(
        `    Each owning service records its own with \`loam verify ${verification.feature} --record answers.json --service <svc>\` in its repo.`,
      );
    }
  }
  console.log("");
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
  console.log(
    tally.unanswered > 0
      ? `  Partial federation — ${plural(tally.unanswered, "claim")} remain unanswered for their owning service repositories.`
      : verdict === "attested"
        ? "  Recorded as attested, not verified: the record travels into features/archive/ saying so."
        : unconfirmed.length === 0
          ? "  The record travels with the feature into features/archive/."
          : "  Recorded as it stands. Nothing gates on this — it is what a reviewer reads later, so leave it true.",
  );
}
