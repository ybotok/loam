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
import { contractAnswers } from "../../core/verify/evidence/contract.js";
import { commitVerification } from "../../core/verify/store/commit.js";
import {
  tallyRecord,
  type ConsumedReports,
  type Verification,
  type VerifyNotice,
  verificationPath,
  verificationVerdict,
} from "../../core/verify/record.js";
import { plural, sayDiscarded, sayRecovered } from "../policy/format.js";
import { readContractResults } from "./evidence/contract.js";
import { claimTokens, pinAnswers } from "./evidence/pins.js";
import { readResults, repositoryCommit, validateServiceEvidence } from "./results.js";
import { contestedNotices, contestedOperationNotices, contractReportLine, noticesFor, reportLine } from "./frozen.js";
import { type VerifyTarget } from "./report.js";

/** The flags `loam verify --record` reads. */
export interface VerifyOptions {
  record?: string;
  results?: string;
  contractResults?: string;
  /** `--diff-answers a.json b.json` — the read-only cross-examination lens
   * (./cross/diff.ts): both files validate against the current checklist and
   * nothing is written. verify.ts refuses recording combinations and arity ≠ 2. */
  diffAnswers?: string[];
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
  /**
   * The existing record as ONE read — the parse the merge consumes and the
   * exact bytes it was parsed from — or null when there was no record. One
   * field rather than a `Verification` beside a `Buffer` because the two are
   * meaningless apart: a pre-image from any other read would let the commit
   * vouch for a document the merge never saw, and as separate fields that
   * inconsistent pair is representable and compiles.
   */
  previous: { verification: Verification; raw: Buffer } | null;
}

export async function record(
  target: VerifyTarget,
  checklist: Checklist,
  attestor: Attestor,
  opts: VerifyOptions,
): Promise<void> {
  const { docsDir, featureDir, json } = target;
  const { service, repoDir, previous } = attestor;
  // The legacy all-at-once form answers the WHOLE checklist on one repository's
  // word and writes a schema-1 record — no attestations, no commits. Run over a
  // federated record it does not merge and it does not migrate: it erases every
  // other service's commit-bound attestation, and the erasure is invisible
  // afterwards because what replaces it is a well-formed, plausible record. So
  // it refuses, and names the repositories whose word is on the file.
  const attested = previous?.verification.schema === 2 ? (previous.verification.attestations ?? []) : [];
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

  // The mechanical halves: with --results, every scenario.tested claim is the
  // cucumber report's to answer — matched by digest, confirmed only by a green
  // run — and with --contract-results, every api.exposes claim is the contract
  // report's, matched by operationId under the same ownership discipline. A
  // partial suite leaves its unexercised claims unconfirmed rather than
  // agent-attestable in the same run: silence must not read as checked, and
  // the escape is a --record run without the flag.
  const runnerClaims =
    opts.results === undefined ? [] : scopedClaims.filter((c) => c.kind === "scenario.tested");
  const contractClaims =
    opts.contractResults === undefined ? [] : scopedClaims.filter((c) => c.kind === "api.exposes");
  const agentClaims = scopedClaims.filter(
    (c) =>
      (opts.results === undefined || c.kind !== "scenario.tested") &&
      (opts.contractResults === undefined || c.kind !== "api.exposes"),
  );

  let fromRunner: Answer[] = [];
  let fromContract: Answer[] = [];
  const reports: ConsumedReports = {};
  if (opts.results !== undefined) {
    // A federated record attests for THIS repository, so its report has to be a
    // file inside it — see evidence/read.ts.
    const read = await readResults(opts.results, service === undefined ? undefined : repoDir);
    if (!read.ok) return fail(json, read.code, read.message);
    reports.results = read.report;
    fromRunner = runnerAnswers(runnerClaims, read.scenarios, read.report.path);
  }
  if (opts.contractResults !== undefined) {
    // Same resolution rules as the cucumber report, same refusal code: the two
    // pins make the same promise about the same repository.
    const read = await readContractResults(opts.contractResults, service === undefined ? undefined : repoDir);
    if (!read.ok) return fail(json, read.code, read.message);
    reports.contract = read.report;
    fromContract = contractAnswers(contractClaims, read.runs, read.report.path);
  }

  // The agent's half — exactly what no report owns. A mechanical flag alone is
  // legal only when the reports own the whole checklist: anything left over
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
  } else if (agentClaims.length > 0 && (opts.results !== undefined || opts.contractResults !== undefined)) {
    const owns = [
      ...(opts.results === undefined ? [] : ["--results answers only the scenario.tested claims"]),
      ...(opts.contractResults === undefined ? [] : ["--contract-results answers only the api.exposes claims"]),
    ].join(" and ");
    return fail(
      json,
      "answers-mismatch",
      `${owns}; ${agentClaims.length} claim(s) have no answer: ` +
        `${agentClaims.map((c) => c.id).join(", ")}. Record them with --record <answers.json> alongside.`,
    );
  }

  const checked = checkAnswers(
    agentClaims,
    raw,
    opts.results === undefined && opts.contractResults === undefined
      ? undefined
      : new Set([...runnerClaims, ...contractClaims].map((c) => c.id)),
    { feature: checklist.feature, ...(service === undefined ? {} : { service }) },
  );
  if (!checked.ok) return fail(json, checked.code, checked.message);

  let serviceCommit: string | undefined;
  let answers = [...fromRunner, ...fromContract, ...checked.answers];
  let pinNotice: VerifyNotice | null = null;
  if (service !== undefined) {
    const commit = await repositoryCommit(repoDir);
    if (!commit.ok) return fail(json, "repository-unavailable", commit.message);
    serviceCommit = commit.commit;
    // All halves, one validator. The runner's evidence used to skip it
    // entirely: `--results` minted confirmations whose evidence strings nothing
    // ever checked, in the one mode that promises every answer is bound to this
    // repository at this commit. The same pass stamps each agent citation's
    // evidence pin and scans its blob for the claim's token (evidence/pins.ts).
    const evidence = await validateServiceEvidence(answers, { repoDir, commit: serviceCommit }, reports, claimTokens(scopedClaims));
    if (!evidence.ok) return fail(json, "answers-unevidenced", evidence.message);
    ({ answers, notice: pinNotice } = pinAnswers(answers, evidence, serviceCommit));
  }

  const recorded = today(new Date());
  let verification: Verification;
  let discarded: DiscardedAnswer[] = [];
  if (service === undefined) {
    verification = buildVerification(checklist, answers, recorded, reports);
  } else {
    // The docs side of the pin, and it is ASKED FOR rather than required: a
    // docs repo is not obliged to be a git checkout, and the attestation simply
    // carries no `docsCommit` when git cannot answer. Failing the record over
    // it would refuse a working fleet for a field that is optional by design.
    const docsHead = await repositoryCommit(docsDir);
    const built = buildFederatedVerification(
      checklist,
      {
        service,
        recorded,
        commit: serviceCommit!,
        reports,
        ...(docsHead.ok ? { docsCommit: docsHead.commit } : {}),
      },
      answers,
      previous?.verification ?? null,
    );
    verification = built.verification;
    discarded = built.discarded;
  }
  // Staged, compared against the locked read's bytes, swapped in by one
  // rename — see core/verify/store/commit.ts for what each refusal means.
  const committed = await commitVerification(featureDir, verification, previous?.raw ?? null, docsDir);
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
  const notices = [
    ...noticesFor(verification.claims, verification.feature),
    ...contestedNotices(runnerClaims),
    ...contestedOperationNotices(contractClaims),
    ...(pinNotice === null ? [] : [pinNotice]),
  ];

  if (json) {
    emitJson({
      feature: verification.feature,
      path: repoPath(docsDir, path),
      ...(target.recovered == null ? {} : { recovered: target.recovered }),
      digest: verification.checklist,
      verified,
      verdict,
      attested: tally.attested,
      recorded: verification.recorded,
      summary: verification.summary,
      ...(verification.attestations === undefined ? {} : { attestations: verification.attestations }),
      ...(reports.results === undefined ? {} : { report: reports.results }),
      ...(reports.contract === undefined ? {} : { contractReport: reports.contract }),
      unconfirmed: unconfirmed.map((c) => ({ id: c.id, claim: c.claim, ...(c.note === undefined ? {} : { note: c.note }) })),
      ...(discarded.length === 0 ? {} : { discarded }),
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  if (target.recovered != null) console.log(`${sayRecovered(target.recovered)}\n`);
  console.log(`${verification.feature} verification recorded — ${repoPath(docsDir, path)}\n`);
  console.log(`  ${tally.confirmed} of ${plural(tally.claims, "claim")} confirmed with evidence.`);
  if (reports.results !== undefined) {
    console.log(`  ${plural(fromRunner.length, "scenario claim")} answered by the test runner (${opts.results}).`);
    console.log(`  Report read: ${reportLine(reports.results)}.`);
  }
  if (reports.contract !== undefined) {
    console.log(`  ${plural(fromContract.length, "api.exposes claim")} answered by the contract test run (${opts.contractResults}).`);
    console.log(`  Contract report read: ${contractReportLine(reports.contract)}.`);
  }
  if (opts.record !== undefined && (reports.results !== undefined || reports.contract !== undefined)) {
    console.log(`  ${plural(checked.answers.length, "claim")} answered by ${opts.record}.`);
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

  sayDiscarded(discarded, repoPath(docsDir, verificationPath(featureDir)), verification.feature);
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
