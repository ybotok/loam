/**
 * An archived feature's record, read back and never recomputed.
 *
 * A frozen record is history: the checklist it answered no longer exists in
 * `features/`, so there is nothing to re-derive it from and re-deriving it would
 * be an opinion about a feature nobody can change. Everything here reads the
 * recorded claims, which is also why the shared marks (`answeredMark`), the
 * contested-claim notices and the report-pin lines live beside it: the read
 * and record views print the same facts about the same claims, in one voice.
 */
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { contestedDigests } from "../../core/results.js";
import { type Claim } from "../../core/verify/checklist.js";
import { contestedOperations } from "../../core/verify/evidence/contract.js";
import {
  attestedNotice,
  openClaimsNotice,
  tallyRecord,
  type AnsweredClaim,
  type ConsumedContractReport,
  type ConsumedReport,
  type Verification,
  type VerifyNotice,
  verificationPath,
  verificationVerdict,
} from "../../core/verify/record.js";
import { plural } from "../policy/format.js";
import { type VerifyTarget } from "./report.js";

export function reportFrozen(
  target: VerifyTarget,
  featureId: string,
  v: Verification | null,
): void {
  const { docsDir, featureDir, json } = target;
  const tally = v === null ? null : tallyRecord(v);
  const verdict = tally === null ? "unverified" : verificationVerdict(tally);
  // The open-claims line rides into the frozen view too: a feature archived on
  // a partial record must keep saying so after it ships, not only before. No
  // record stays bare — the prose already says nothing was recorded.
  const open = tally === null ? null : openClaimsNotice(tally, featureId);
  const notices = [...(v === null ? [] : noticesFor(v.claims, featureId)), ...(open === null ? [] : [open])];

  if (json) {
    emitJson({
      feature: featureId,
      path: repoPath(docsDir, featureDir),
      frozen: true,
      verified: verdict === "verified",
      verdict,
      attested: tally?.attested ?? 0,
      summary: v === null ? null : v.summary,
      recorded:
        v === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: v.recorded,
              checklist: v.checklist,
              ...(v.attestations === undefined ? {} : { attestations: v.attestations }),
              ...(v.report === undefined ? {} : { report: v.report }),
              ...(v.contractReport === undefined ? {} : { contractReport: v.contractReport }),
            },
      claims: v === null ? [] : v.claims,
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  if (v === null) {
    console.log(
      `${featureId} is archived and has no verification record — nothing was recorded before it shipped.`,
    );
    return;
  }

  console.log(
    `${featureId} — verification recorded ${v.recorded}, frozen at archive (${repoPath(docsDir, featureDir)})\n`,
  );
  for (const c of v.claims) {
    // `subject` is absent in records written before schema 2 — an old record
    // must read as itself, not gain a service it never named.
    const subject = c.subject === undefined ? "" : `  [${c.subject}]`;
    console.log(`  ${MARK[c.verdict]} ${c.id}${subject}  ${c.claim}${answeredMark(c)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }
  const counts = tallyRecord(v);
  console.log(`\n  Recorded ${v.recorded} — ${counts.confirmed} confirmed, ${counts.unconfirmed} unconfirmed.`);
  console.log(
    "  This checklist is frozen at record time: the feature is archived and its claims are not re-derived.",
  );
  for (const attestation of v.attestations ?? []) {
    console.log(
      `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}).`,
    );
    if (attestation.report !== undefined) console.log(`      from ${reportLine(attestation.report)}`);
    if (attestation.contractReport !== undefined) {
      console.log(`      from ${contractReportLine(attestation.contractReport)}`);
    }
  }
  if (v.report !== undefined) console.log(`  Answered from ${reportLine(v.report)}.`);
  if (v.contractReport !== undefined) console.log(`  Contract report read: ${contractReportLine(v.contractReport)}.`);
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
}

export const MARK: Record<string, string> = { confirmed: "✓", unconfirmed: "✗", unanswered: "?" };

/**
 * Who answered, where that changes what the verdict means. `[runner]` is a
 * digest-matched green run; `[contract]` is an operationId-matched green
 * contract-test run — mechanical too, and marked so the record's provenance is
 * readable per line, not only in `contractReport:`; `[attested]` is a scenario
 * claim confirmed on somebody's word — the same ✓, a weaker fact, and it must
 * be visible on the line itself and not only in the summary. The attested test
 * runs FIRST and uses `attestedClaims`' own predicate (a confirmed scenario
 * claim not answered by the runner), so the mark can never disagree with the
 * tally: a scenario claim carrying `answered_by: external-runner` — a hand
 * edit, or a future loam; the reader accepts any string on purpose — COUNTS as
 * attested, and printing `[contract]` two lines above a notice saying "an
 * agent's word" would be the mark calling the tally a liar. Everything else is
 * unmarked: an agent's answer about a service existing or an operation being
 * exposed is exactly what the checklist asks for.
 */
export function answeredMark(c: AnsweredClaim): string {
  if (c.answered_by === "runner") return "  [runner]";
  if (c.kind === "scenario.tested") {
    return c.verdict === "confirmed" ? "  [attested]" : "";
  }
  return c.answered_by === "external-runner" ? "  [contract]" : "";
}

/** Everything a verify surface has to say about a set of answers beyond the counts. */
export function noticesFor(claims: readonly AnsweredClaim[], feature: string): VerifyNotice[] {
  const attested = attestedNotice(claims, feature);
  return attested === null ? [] : [attested];
}

/**
 * `verify.checklist-forked` — two services answered DIFFERENT versions of this
 * feature{@link ServiceAttestation}'s question set.
 *
 * The record carries one top-level `checklist` digest, so before attestations
 * carried their own the file could not represent this at all: a service that
 * attested last week against a delta since rewritten wrote the same digest as
 * one that attested this morning, and the record-level staleness check flagged
 * both or neither. It could never say WHICH answers went stale, which is the
 * only question a reader has.
 *
 * A warn, and only ever a warn: a fork is normal mid-rollout — services attest
 * as they finish, and a feature legitimately changes between the first and the
 * last. What it must not do is stay invisible. Attestations with no `checklist`
 * field are excluded rather than counted as a third version: they make no claim
 * about what they answered, and reading silence as disagreement would fire this
 * on every record written before the field existed.
 */
export function forkedChecklistNotices(
  recorded: Verification | null,
  current: string,
): VerifyNotice[] {
  const stated = (recorded?.attestations ?? []).filter((a) => a.checklist !== undefined);
  // Measured against the CURRENT checklist, not pairwise between attestations.
  // The pairwise reading answers the wrong question: three services that all
  // attested against a since-rewritten delta agree with each other perfectly
  // and are all stale, which pairwise calls clean. What a reader needs is
  // WHICH services answered something other than what is being asked now.
  const behind = stated.filter((a) => a.checklist !== current);
  if (behind.length === 0) return [];
  const byVersion = [...new Set(behind.map((a) => a.checklist!))]
    .sort()
    .map((v) => `${v} (${behind.filter((a) => a.checklist === v).map((a) => a.service).sort().join(", ")})`);
  return [
    {
      code: "verify.checklist-forked",
      severity: "warn",
      message:
        `${plural(behind.length, "service")} answered a different version of this feature's question set ` +
        `than the one it now asks (${current}): ${byVersion.join("; ")}. ` +
        "The feature changed after they recorded, so their answers are not about the questions being asked now. " +
        "Re-record them from their own repositories (`loam verify <FEAT> --service <id> --record`), " +
        "or accept the split knowingly — nothing gates on it.",
    },
  ];
}

/**
 * The claims one report could not attribute: a scenario digest — and therefore
 * an `@loam-digest-…` tag — that more than one service claims.
 *
 * This is now a GUARD rather than a diagnosis of ordinary authoring. Until the
 * digest was salted by service, two services wording a scenario identically
 * really did share one tag, and this is what stopped one repository's green run
 * from confirming the other's claim. `scenarioBodyHash` folds the owning
 * service into the hash, so a claim's digest is computed from the same service
 * the claim is filed under and two subjects cannot share one short of a
 * truncated-sha256 collision. It stays because the invariant is worth asserting
 * where it is relied on: if this ever fires, a digest is answering for two
 * services and no report can say which, so nothing here may confirm.
 *
 * Derived from claims rather than from a report, so the read view raises it too
 * — the collision exists the moment the checklist does, and learning about it
 * from a `--results` run that already happened is learning too late.
 */
export function contestedNotices(claims: readonly Claim[]): VerifyNotice[] {
  const contested = contestedDigests(claims);
  if (contested.size === 0) return [];
  const shared = [...contested].map(([digest, services]) => `${digest} (${services.join(", ")})`);
  return [
    {
      code: "verify.digest-contested",
      severity: "warn",
      message:
        `${plural(contested.size, "scenario digest")} claimed by more than one service: ${shared.join("; ")}. ` +
        "The digest is salted by service, so this is a hash collision, not shared wording — but one report still " +
        "cannot say whose suite ran them, so a shared --results run leaves them unconfirmed. " +
        "Record each service's claims from its own repository with --service.",
      claims: claims.filter((c) => c.digest !== undefined && contested.has(c.digest)).map((c) => c.id),
    },
  ];
}

/**
 * The digest-contested rule's twin on the contract axis: operationIds that
 * more than one service on this checklist exposes, which one report can
 * therefore never attribute (`contestedOperations`, the module that also
 * leaves those claims unconfirmed). Raised where the contract report is
 * consumed, so the record path says WHY the claims came back unconfirmed
 * instead of leaving two bare ✗ lines to be misread as failures.
 */
export function contestedOperationNotices(claims: readonly Claim[]): VerifyNotice[] {
  const contested = contestedOperations(claims);
  if (contested.size === 0) return [];
  const shared = [...contested].map(([operation, services]) => `${operation} (${services.join(", ")})`);
  return [
    {
      code: "verify.operation-contested",
      severity: "warn",
      message:
        `${plural(contested.size, "operationId")} exposed by more than one service on this checklist: ${shared.join("; ")}. ` +
        "A contract report entry names no service, so a shared --contract-results run cannot say whose suite exercised them and leaves them unconfirmed. " +
        "Record each service's claims from its own repository with --service.",
      claims: claims.filter((c) => c.operation !== undefined && contested.has(c.operation)).map((c) => c.id),
    },
  ];
}

/** The report a `--results` run consumed, as one line a reviewer can check by hand. */
export function reportLine(r: ConsumedReport): string {
  return `${r.path} (sha256 ${r.digest.slice(0, 12)}…, ${plural(r.scenarios, "tagged scenario")}, written ${r.mtime})`;
}

/**
 * The contract report a `--contract-results` run consumed — the same line for
 * the same promise, counting operations where the cucumber one counts tagged
 * scenarios. A separate function rather than a parameter on `reportLine`
 * because the two pins are different shapes, and a merged formatter would need
 * exactly the switching flag that near-duplicates are kept apart to avoid.
 */
export function contractReportLine(r: ConsumedContractReport): string {
  return `${r.path} (sha256 ${r.digest.slice(0, 12)}…, ${plural(r.operations, "operation")}, written ${r.mtime})`;
}


/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

/**
 * `repoDir` is the repository an attestation is ABOUT: the commit it names, the
 * tree its evidence must resolve inside, and where a `--results` report has to
 * live. It is threaded rather than read here because it comes from
 * `config.root`, and a `process.cwd()` in this function was the whole bug —
 * from a subdirectory, "this repo" quietly became that subdirectory.
 */
