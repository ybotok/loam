/**
 * Checklist plus answers becomes a record — once for a feature answered all at
 * once, once for a fleet answering service by service.
 *
 * The federated form is separate from `buildVerification` and not a flag on it
 * because the two disagree about what an unanswered claim means: answering
 * everything at once, a missing answer is a gap in this run, while a federated
 * record is assembled from attestations that each covered one service and were
 * never expected to cover the rest. They also land in different places: the
 * all-at-once record is the one file `verification.yaml`, while each service's
 * attestation is a file of its own under `verification/` (`./location.ts` says
 * why, on `verificationDir`).
 */
import { type Checklist } from "./checklist.js";
import { type Answer } from "./answers.js";
import { type ConsumedReports, type RecordedClaim, type Verification } from "./record.js";

export function buildVerification(
  checklist: Checklist,
  answers: Answer[],
  today: string,
  reports: ConsumedReports = {},
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
    // Deliberately no `evidence_pins` here: the legacy all-at-once form binds
    // to no commit, so there is no attested blob to pin — and none is ever
    // handed in, because pins are computed inside the federated evidence
    // validation this form never runs.
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
    ...(reports.results === undefined ? {} : { report: reports.results }),
    ...(reports.contract === undefined ? {} : { contractReport: reports.contract }),
  };
}

/**
 * An answer the previous record held that the new one does not carry.
 *
 * Dropping these is correct — see `buildServiceRecord` — but doing it silently
 * is not: a schema-1 record answers the WHOLE checklist, so the first
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

/** One service's attestation: whose word it is, when, and against which commit. */
export interface Attestation {
  service: string;
  recorded: string;
  commit: string;
  reports: ConsumedReports;
  /** The docs-repo HEAD the checklist was derived from, when git could answer. */
  docsCommit?: string;
  /**
   * The working tree against `commit`: the uncommitted paths git reported
   * (empty when clean), or null when git could not say. Anything but an empty
   * list marks the attestation `dirty` — see `ServiceAttestation.dirty`.
   */
  uncommitted?: string[] | null;
}

/**
 * The record files a service's write replaces, as the authoritative read found
 * them: the one-file record, and this service's own `verification/<svc>.yaml`.
 * `filed` names every service that already has a file of its own — what
 * decides whether anything in the one-file record still counts.
 */
export interface PreviousFiles {
  legacy: Verification | null;
  own: Verification | null;
  filed: ReadonlySet<string>;
}

export interface ServiceBuild {
  /** `verification/<svc>.yaml` as it will be written: this service's attestation and answers, nobody else's. */
  record: Verification;
  /**
   * Whether the one-file record goes in the same commit, because nothing in it
   * counts any more: an all-at-once record never counts once a service has a
   * file (its answers carry no attestation — today's write used to overwrite it
   * for the same reason), and a federated one stops counting once every
   * service it names has a file of its own.
   */
  dropLegacy: boolean;
  /** In record order — see {@link DiscardedAnswer}. */
  discarded: DiscardedAnswer[];
}

/**
 * One service's attestation, as the file only that service ever writes.
 *
 * This used to be a merge: the new attestation spliced into the one shared
 * record, every other service's answers retained, pruned to the current
 * checklist and re-sorted — and that rewrite of everybody's bytes is exactly
 * what made two teams' docs PRs conflict. Now nothing else is touched. The
 * other services' files stand as they are, the union is added up at read time
 * (`read/union.ts`), and an answer of theirs the feature no longer asks is
 * simply not counted there rather than pruned here.
 *
 * The file is a whole schema-2 record with one attestation, so it is graded
 * with the same shape check as every record and reads without loam: its
 * `summary` counts the whole checklist, with the claims other services answer
 * honestly `unanswered` in it.
 */
export function buildServiceRecord(
  checklist: Checklist,
  attestation: Attestation,
  answers: Answer[],
  previous: PreviousFiles,
): ServiceBuild {
  const { service, recorded, commit, reports, docsCommit, uncommitted } = attestation;
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const currentIds = new Set(checklist.claims.map((claim) => claim.id));
  for (const answer of answers) {
    // Same contract as `buildVerification`: an answer is built from the live
    // checklist, so it always names a current claim. Off-checklist answers do
    // NOT belong here — `discarded` means "an answer the PREVIOUS record held",
    // and routing an incoming stray into it would change what the printed
    // notice tells an operator. A caller that reaches this gets told which
    // answer it was rather than an answer silently missing from the file.
    if (!currentIds.has(answer.id)) {
      throw new Error(`buildServiceRecord: answer ${answer.id} names no current claim`);
    }
  }
  const claims = checklist.claims.flatMap((claim): RecordedClaim[] => {
    const answer = byId.get(claim.id);
    if (answer === undefined) return [];
    return [
      {
        id: claim.id,
        kind: claim.kind,
        subject: claim.subject,
        claim: claim.claim,
        verdict: answer.verdict,
        answered_by: answer.answered_by,
        evidence: answer.evidence,
        ...(answer.note === undefined ? {} : { note: answer.note }),
        // The pins the evidence validation stamped onto this repository's
        // answers ride into the file here; no other service's file is
        // rewritten, so THEIR pins are never touched at all.
        ...(answer.evidence_pins === undefined ? {} : { evidence_pins: answer.evidence_pins }),
      },
    ];
  });
  const confirmed = claims.filter((claim) => claim.verdict === "confirmed").length;
  const record: Verification = {
    schema: 2,
    feature: checklist.feature,
    recorded,
    checklist: checklist.digest,
    summary: {
      claims: checklist.claims.length,
      confirmed,
      unconfirmed: claims.length - confirmed,
      unanswered: checklist.claims.length - claims.length,
    },
    claims,
    attestations: [
      {
        service,
        commit,
        recorded,
        claims: checklist.claims.filter((c) => c.subject === service).map((c) => c.id),
        // What THIS repository answered, and what it answered it against.
        // `checklist` is what `verify.checklist-forked` and the union's
        // one-version rule read; `docsCommit` pins the side the question came
        // from.
        checklist: checklist.digest,
        ...(docsCommit === undefined ? {} : { docsCommit }),
        // Not shown clean is flagged the same as shown dirty: an unanswered
        // check is not a passed one (`validateServiceEvidence`'s doctrine).
        ...(uncommitted === undefined || uncommitted?.length === 0
          ? {}
          : { dirty: true, ...(uncommitted === null ? {} : { uncommitted }) }),
        // Each report is one repository's run, filed with that repository's
        // attestation — the contract report under the same rule as the
        // cucumber one.
        ...(reports.results === undefined ? {} : { report: reports.results }),
        ...(reports.contract === undefined ? {} : { contractReport: reports.contract }),
      },
    ],
  };

  const { legacy, own, filed } = previous;
  const federatedLegacy = legacy?.schema === 2;
  const dropLegacy =
    legacy !== null &&
    (!federatedLegacy || (legacy.attestations ?? []).every((a) => a.service === service || filed.has(a.service)));
  // Everything this write takes off the disk that the new file does not carry:
  // this service's own previous answers (from its file, or from its share of a
  // one-file record no file of its own had superseded yet) and, when the
  // one-file record is dropped, an all-at-once record's answers. Another
  // service's answers are never in this list — their files are not touched.
  const replaced = [
    ...(own?.claims ?? []),
    ...(legacy === null
      ? []
      : !federatedLegacy
        ? legacy.claims
        : own === null
          ? legacy.claims.filter((claim) => claim.subject === service)
          : []),
  ];
  const carried = new Set(claims.map((claim) => claim.id));
  // Keyed by id: a service's own file and its share of the one-file record
  // can both hold the same stale answer, and it is one answer.
  const dropped = new Map(replaced.filter((claim) => !carried.has(claim.id)).map((claim) => [claim.id, claim]));
  const discarded = [...dropped.values()]
    .map((claim): DiscardedAnswer => ({
      id: claim.id,
      claim: claim.claim,
      ...(claim.subject === undefined ? {} : { subject: claim.subject }),
      reason: currentIds.has(claim.id) ? "unattested" : "off-checklist",
    }));
  return { record, dropLegacy, discarded };
}
