/**
 * What gets written down, and how a set of answers counts up to a verdict.
 *
 * The shapes and the arithmetic are one module because they are one claim about
 * the same numbers: `tallyRecord` recounts from the answers rather than reading
 * the `summary` field back, so a record whose header disagrees with its own
 * claims is caught rather than believed. A separate counter would be a second
 * opinion, which is precisely what this file exists to prevent.
 *
 * `verified` is reserved for a checklist whose scenarios a RUN answered.
 * Where an agent answered one instead — a legacy service whose suite is months
 * away, which is the fleet loam exists for — the record marks it attested, and
 * `attestedNotice` says so on every surface that reads the record.
 */
import { join } from "node:path";
import { type ClaimKind } from "./checklist.js";
import { type AnsweredBy, type Verdict } from "./answers.js";

export interface RecordedClaim {
  id: string;
  kind: ClaimKind;
  /** Present in federated records; omitted by legacy records written before schema 2. */
  subject?: string;
  claim: string;
  verdict: Verdict;
  /** Who answered — absent only in records written before `--results` existed. */
  answered_by?: AnsweredBy;
  evidence: string[];
  note?: string;
}

/**
 * The test report a `--results` run consumed.
 *
 * Nothing can prove a JSON file came from executing a particular commit — a
 * report is bytes, and bytes are writable. What loam can do is stop leaving the
 * question open: it records exactly which file it read (inside the attesting
 * repository, resolved by the same path rules as evidence), the sha256 of the
 * bytes it read, the file's own mtime and how many digest-tagged scenarios it
 * carried. A reviewer holding the repository can tell whether this is that
 * file; before this, `answered_by: runner` named nothing at all.
 */
export interface ConsumedReport {
  /** As it was passed to `--results` — repo-relative in a federated record. */
  path: string;
  /** Full sha256 of the bytes read, so `shasum -a 256 <path>` answers the question. */
  digest: string;
  /** ISO-8601 mtime of the report file — when the run that wrote it finished. */
  mtime: string;
  /** How many digest-tagged scenarios the report carried. */
  scenarios: number;
}

/** A service repository's commit-bound contribution to a federated record. */
export interface ServiceAttestation {
  service: string;
  commit: string;
  recorded: string;
  /** Claim ids this commit answered. Kept explicit so stale answers can be pruned safely. */
  claims: string[];
  /** The report that answered this service's scenario claims, when `--results` did. */
  report?: ConsumedReport;
}

export interface Verification {
  /** Federated, partial records use schema 2. Absent means the original all-at-once format. */
  schema?: 2;
  feature: string;
  /** The day the answers were recorded. */
  recorded: string;
  /** The checklist digest they answer — how a later reader spots a record gone stale. */
  checklist: string;
  summary: { claims: number; confirmed: number; unconfirmed: number; unanswered?: number };
  claims: RecordedClaim[];
  /** The all-at-once form's consumed report; the federated form files it per attestation. */
  report?: ConsumedReport;
  attestations?: ServiceAttestation[];
}

/**
 * Anything carrying an answer, whichever surface holds it: a recorded claim, or
 * the read view's per-claim status. Structural on purpose — the same questions
 * are asked of both, and neither should have to convert into the other to be
 * counted.
 */
export interface AnsweredClaim {
  id: string;
  kind: string;
  verdict: string;
  answered_by?: string;
}

/**
 * The confirmed `scenario.tested` claims that no test run answered.
 *
 * A scenario claim's whole premise is that a run answers it — its digest IS the
 * tag `loam gherkin` stamps, and `--results` matches the two mechanically. An
 * agent may still answer one, because a legacy service has no runnable suite
 * for months and that fleet is who loam is for; but the answer is somebody's
 * word about a test, and it must not read as the run. A record written before
 * `--results` existed carries no `answered_by` at all: unknown counts as agent
 * here, because the alternative is to credit a run nobody can point at.
 */
export function attestedClaims(claims: readonly AnsweredClaim[]): string[] {
  return claims
    .filter((c) => c.kind === "scenario.tested" && c.verdict === "confirmed" && c.answered_by !== "runner")
    .map((c) => c.id);
}

/** How a set of answers counts up — recounted from the answers, never read off a `summary`. */
export interface RecordTally {
  /** Questions asked: answered, plus the ones a federated record leaves for other repos. */
  claims: number;
  confirmed: number;
  unconfirmed: number;
  unanswered: number;
  /** Of the confirmed, the scenario claims on an agent's word. See {@link attestedClaims}. */
  attested: number;
}

/**
 * `unanswered` is the count the answers themselves cannot show: a federated
 * record holds only what somebody answered, and the claims still owed to other
 * repositories exist on the checklist, not in `claims[]`. Read views that carry
 * an `unanswered` status inside the list pass 0 and are counted in place.
 */
export function tallyAnswers(claims: readonly AnsweredClaim[], unanswered = 0): RecordTally {
  const of = (verdict: string): number => claims.filter((c) => c.verdict === verdict).length;
  return {
    claims: claims.length + unanswered,
    confirmed: of("confirmed"),
    unconfirmed: of("unconfirmed"),
    unanswered: of("unanswered") + unanswered,
    attested: attestedClaims(claims).length,
  };
}

/**
 * The record's own answers, recounted. Never `v.summary`: the summary is what
 * whoever wrote the file said the answers add up to, and every reader that
 * believed it reported a record full of unconfirmed claims as fully confirmed.
 * `readVerificationState` refuses a record whose summary contradicts this, so a
 * caller holding a Verification may use either — and should use this one.
 */
export function tallyRecord(v: Verification): RecordTally {
  return tallyAnswers(v.claims, v.summary.unanswered ?? 0);
}

/**
 * Three states, because two were a lie. `verified` is the strong claim — every
 * question answered, every answer confirmed, and every scenario answered by a
 * digest-matched green run. `attested` is the same completeness resting, for at
 * least one scenario, on an agent's word. `unverified` is everything else:
 * nothing recorded, a record gone stale, a claim unanswered or unconfirmed, or
 * a checklist that asks nothing at all.
 */
export const VERIFICATION_VERDICTS = ["verified", "attested", "unverified"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export function verificationVerdict(t: RecordTally, stale = false): VerificationVerdict {
  if (stale || t.claims === 0 || t.confirmed !== t.claims) return "unverified";
  return t.attested > 0 ? "attested" : "verified";
}

/** A finding a verify surface reports about a record. Stable code, prose that may change. */
export interface VerifyNotice {
  code: string;
  severity: "warn";
  message: string;
  /** The claims it is about, when it is about claims. */
  claims?: string[];
}

/**
 * The one notice `verify`, `list` and `status` all show: this record's scenario
 * claims were confirmed without a run.
 *
 * It is a warning and it gates nothing — verify has never gated, and a service
 * with no suite yet has to be able to ship. What it must never do is read the
 * same as a green run.
 */
export function attestedNotice(claims: readonly AnsweredClaim[], feature: string): VerifyNotice | null {
  const ids = attestedClaims(claims);
  if (ids.length === 0) return null;
  return {
    code: "verify.scenario-attested",
    severity: "warn",
    message:
      `${ids.length} scenario claim(s) are confirmed on an agent's word, not on a test run: ${ids.join(", ")}. ` +
      `Answer them mechanically once the suite runs: \`loam verify ${feature} --results <cucumber.json>\`.`,
    claims: ids,
  };
}

/**
 * Where the record lives: inside the feature, so `archive` carries it into
 * `features/archive/` with everything else and a reviewer finds it next to the
 * delta it is about. YAML rather than frontmatter or JSON — it is data, it has
 * to survive without loam, and one claim per block is a diff a person can read.
 */
export function verificationPath(featureDir: string): string {
  return join(featureDir, "verification.yaml");
}

