/**
 * Checklist plus answers becomes a record — once for a feature answered all at
 * once, once for a fleet answering service by service.
 *
 * The federated form is separate from `buildVerification` and not a flag on it
 * because the two disagree about what an unanswered claim means: answering
 * everything at once, a missing answer is a gap in this run, while a federated
 * record is assembled from attestations that each covered one service and were
 * never expected to cover the rest.
 */
import { type Checklist } from "./checklist.js";
import { type Answer } from "./answers.js";
import {
  type ConsumedReport,
  type RecordedClaim,
  type ServiceAttestation,
  type Verification,
} from "./record.js";

export function buildVerification(
  checklist: Checklist,
  answers: Answer[],
  today: string,
  report?: ConsumedReport,
): Verification {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const claims: RecordedClaim[] = checklist.claims.map((c) => {
    // Callers hand in an answer per claim — `runnerAnswers` is total over the
    // checklist, and both other callers map the checklist to build theirs. The
    // branch is here because the alternative to a diagnosis is a `TypeError` on
    // `a.verdict`, which cli.ts reports as `internal` with a stack about a
    // property of `undefined` and no word about which claim went missing.
    const a = byId.get(c.id);
    if (a === undefined) throw new Error(`buildVerification: no answer for claim ${c.id}`);
    return {
      id: c.id,
      kind: c.kind,
      claim: c.claim,
      verdict: a.verdict,
      answered_by: a.answered_by,
      evidence: a.evidence,
      ...(a.note === undefined ? {} : { note: a.note }),
    };
  });
  const confirmed = claims.filter((c) => c.verdict === "confirmed").length;
  return {
    feature: checklist.feature,
    recorded: today,
    checklist: checklist.digest,
    summary: { claims: claims.length, confirmed, unconfirmed: claims.length - confirmed },
    claims,
    ...(report === undefined ? {} : { report }),
  };
}

/**
 * An answer the previous record held that the new one does not carry.
 *
 * Dropping these is correct — see `buildFederatedVerification` — but doing it
 * silently is not: a schema-1 record answers the WHOLE checklist, so the first
 * federated write turns a green record into a partial one, and an operator who
 * is not told which answers went missing reads the drop as loam losing data.
 */
export interface DiscardedAnswer {
  id: string;
  claim: string;
  /** The service the record filed it under, when it said. Absent in schema-1 records. */
  subject?: string;
  /**
   * `off-checklist` — the feature changed and nobody asks this question any
   * more. `unattested` — the question still stands, but no service attestation
   * binds the answer to a commit, so it cannot be carried into a federated
   * record; the owning repository has to record it again.
   */
  reason: "off-checklist" | "unattested";
}

export interface FederatedBuild {
  verification: Verification;
  /** In checklist-independent record order — see {@link DiscardedAnswer}. */
  discarded: DiscardedAnswer[];
}

/**
 * Replace one service's contribution while retaining current contributions
 * from other repositories. Claim ids removed from the live checklist are
 * pruned from both the answers and their attestations, so a changed feature can
 * never keep a green answer to a question it no longer asks.
 */
/** One service's attestation: whose word it is, when, and against which commit. */
export interface Attestation {
  service: string;
  recorded: string;
  commit: string;
  report?: ConsumedReport;
}

export function buildFederatedVerification(
  checklist: Checklist,
  attestation: Attestation,
  answers: Answer[],
  previous: Verification | null,
): FederatedBuild {
  const { service, recorded, commit, report } = attestation;
  const currentById = new Map(checklist.claims.map((claim) => [claim.id, claim]));
  const localIds = new Set(checklist.claims.filter((claim) => claim.subject === service).map((claim) => claim.id));

  // An old all-at-once record remains readable, but its answers have no commit
  // attestation and therefore cannot silently become somebody else's
  // federated contribution. The first schema-2 write starts a clean federation.
  const previouslyAttested = new Set((previous?.attestations ?? []).flatMap((a) => a.claims));
  const retained = (previous?.schema === 2 ? previous.claims : []).filter((claim) => {
    const current = currentById.get(claim.id);
    return current !== undefined && current.subject !== service && previouslyAttested.has(claim.id);
  });
  const local = answers.map((answer): RecordedClaim => {
    // Same contract as `buildVerification`: an answer is built from the live
    // checklist, so it always names a current claim. Off-checklist answers do
    // NOT belong here — `discarded` means "an answer the PREVIOUS record held",
    // and routing an incoming stray into it would change what the printed
    // notice tells an operator. A caller that reaches this gets told which
    // answer it was rather than a `TypeError` on `claim.kind`.
    const claim = currentById.get(answer.id);
    if (claim === undefined) {
      throw new Error(`buildFederatedVerification: answer ${answer.id} names no current claim`);
    }
    return {
      id: claim.id,
      kind: claim.kind,
      subject: claim.subject,
      claim: claim.claim,
      verdict: answer.verdict,
      answered_by: answer.answered_by,
      evidence: answer.evidence,
      ...(answer.note === undefined ? {} : { note: answer.note }),
    };
  });
  const byId = new Map([...retained, ...local].map((claim) => [claim.id, claim]));
  const claims = checklist.claims.flatMap((claim) => {
    const answer = byId.get(claim.id);
    if (answer === undefined) return [];
    // Normalize retained legacy entries to the current question text and add
    // the subject schema 2 needs for future independent replacement.
    return [{ ...answer, kind: claim.kind, subject: claim.subject, claim: claim.claim }];
  });

  const retainedAttestations = (previous?.attestations ?? []).flatMap((attestation) => {
    if (attestation.service === service) return [];
    const ids = attestation.claims.filter(
      (id) => currentById.get(id)?.subject === attestation.service && byId.has(id),
    );
    return ids.length === 0 ? [] : [{ ...attestation, claims: ids }];
  });
  const attestations: ServiceAttestation[] = [
    ...retainedAttestations,
    {
      service,
      commit,
      recorded,
      claims: checklist.claims.filter((c) => localIds.has(c.id)).map((c) => c.id),
      // Filed with the attestation, not the record: the report is one
      // repository's run, and it is pruned or retained with that repository's
      // answers rather than outliving them.
      ...(report === undefined ? {} : { report }),
    },
  ].sort((a, b) => a.service.localeCompare(b.service));

  const confirmed = claims.filter((claim) => claim.verdict === "confirmed").length;
  const unconfirmed = claims.length - confirmed;
  const unanswered = checklist.claims.length - claims.length;

  // Everything the old record answered that the new one does not. The caller
  // prints it; nothing here decides it is acceptable.
  const discarded = (previous?.claims ?? [])
    .filter((claim) => !byId.has(claim.id))
    .map((claim): DiscardedAnswer => ({
      id: claim.id,
      claim: claim.claim,
      ...(claim.subject === undefined ? {} : { subject: claim.subject }),
      reason: currentById.has(claim.id) ? "unattested" : "off-checklist",
    }));

  return {
    verification: {
      schema: 2,
      feature: checklist.feature,
      recorded,
      checklist: checklist.digest,
      summary: { claims: checklist.claims.length, confirmed, unconfirmed, unanswered },
      claims,
      attestations,
    },
    discarded,
  };
}
