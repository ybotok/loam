/**
 * Mechanical cross-examination of two blind answer sets over one checklist.
 *
 * The doctrine lives here because every surface reads it from this module:
 * agreement is a review-ranking signal, never a verdict. The two sets almost
 * always come from two contexts of the same model, so their agreeing is
 * correlated evidence — which is why this module deliberately imports nothing
 * from `../record.ts`'s verdict machinery (`verificationVerdict`,
 * `tallyRecord`): a cross-examination has no `verified`, no `attested`, and
 * can never upgrade either. What it ranks is where a human reads first — the
 * disagreements, then the agreements whose cited files do not overlap.
 *
 * The join is by claim id ONLY. The ids are deterministic functions of the
 * claims (`../claims/identity.ts`), which is the whole mechanism: two agents
 * who never saw each other's work still answered the same question under the
 * same key, so their answers are mechanically joinable — where fuzzy-matching
 * claim TEXT would make "the same question" an opinion about wording.
 */
import type { Answer, Verdict } from "../answers.js";
import type { Claim } from "../checklist.js";
import type { ClaimKind } from "../claims/identity.js";
import type { VerifyNotice } from "../record.js";

/**
 * One side's answer, as the cross-examination reports it. Deliberately
 * narrower than {@link Answer}: `answered_by` is always `agent` under a diff
 * (both sets validate through `checkAnswers`' agent path, no report in
 * sight), and `evidence_pins` never rides through — a pin is loam's own
 * stamp, absent from `checkAnswers`' output by construction, and a diff of
 * caller-written files must not launder one into a payload.
 */
export interface CrossAnswer {
  verdict: Verdict;
  evidence: string[];
  note?: string;
}

interface CrossBase {
  id: string;
  kind: ClaimKind;
  subject: string;
  claim: string;
  a: CrossAnswer;
  b: CrossAnswer;
}

/**
 * One claim, both answers, and what their comparison is. A union rather than
 * an optional-field record so `evidenceDisjoint` is not constructible on the
 * arms it means nothing for: two agents disagreeing cite different things by
 * definition, and two unconfirmed answers cite nothing.
 */
export type CrossClaim =
  | (CrossBase & { code: "cross.agree-confirmed"; evidenceDisjoint?: true })
  | (CrossBase & { code: "cross.agree-unconfirmed" })
  | (CrossBase & { code: "cross.disagree" });

export type CrossCode = CrossClaim["code"];

export interface CrossExamination {
  /** Checklist order — the order the questions were asked, whatever either agent did. */
  rows: CrossClaim[];
  summary: {
    claims: number;
    agreeConfirmed: number;
    agreeUnconfirmed: number;
    disagree: number;
    evidenceDisjoint: number;
  };
  /** The `cross.disagree` rows again, first-class: they are what a reader is for. */
  disagreements: CrossClaim[];
}

/**
 * The FILE a piece of evidence cites: one trailing `:<line>` or
 * `:<line>-<line>` suffix stripped, nothing else judged. Mechanical string
 * surgery on purpose — evidence is prose the answerer wrote, and any deeper
 * reading (resolving against a tree, normalizing separators) would turn the
 * disjointness signal into an opinion about paths instead of a fact about
 * citations.
 */
function citedFile(evidence: string): string {
  return evidence.replace(/:\d+(-\d+)?$/, "");
}

function side(answer: Answer): CrossAnswer {
  return {
    verdict: answer.verdict,
    evidence: answer.evidence,
    ...(answer.note === undefined ? {} : { note: answer.note }),
  };
}

function crossRow(claim: Claim, a: Answer, b: Answer): CrossClaim {
  const base: CrossBase = {
    id: claim.id,
    kind: claim.kind,
    subject: claim.subject,
    claim: claim.claim,
    a: side(a),
    b: side(b),
  };
  if (a.verdict !== b.verdict) return { ...base, code: "cross.disagree" };
  if (a.verdict === "confirmed") {
    // Both confirmed, so both cite at least one entry (`checkAnswers` refuses
    // an evidenced-nothing confirmation) — disjoint therefore means "looked in
    // different places and agreed anyway", never "nobody cited anything".
    const files = new Set(a.evidence.map(citedFile));
    const disjoint = !b.evidence.some((entry) => files.has(citedFile(entry)));
    return { ...base, code: "cross.agree-confirmed", ...(disjoint ? { evidenceDisjoint: true as const } : {}) };
  }
  return { ...base, code: "cross.agree-unconfirmed" };
}

/**
 * Join two validated answer sets over the claims they both answered.
 *
 * Both sets must have come out of `checkAnswers` over THIS `claims` array,
 * which refuses any set that does not answer every claim exactly once — so
 * there is deliberately no missing-answer branch in the result shape. The
 * guard below still fails closed on a caller that skipped validation: a
 * silent skip would report "no disagreement" about a claim nobody compared,
 * which is the one lie this module exists to prevent.
 */
export function crossExamine(claims: Claim[], a: Answer[], b: Answer[]): CrossExamination {
  const byIdA = new Map(a.map((answer) => [answer.id, answer]));
  const byIdB = new Map(b.map((answer) => [answer.id, answer]));
  const rows = claims.map((claim) => {
    const answerA = byIdA.get(claim.id);
    const answerB = byIdB.get(claim.id);
    if (answerA === undefined || answerB === undefined) {
      throw new Error(
        `crossExamine: claim ${claim.id} has no answer in the ${answerA === undefined ? "first" : "second"} set — ` +
          "validate both sets with checkAnswers over the same claims before joining them",
      );
    }
    return crossRow(claim, answerA, answerB);
  });
  const of = (code: CrossCode): number => rows.filter((row) => row.code === code).length;
  const disagreements = rows.filter((row) => row.code === "cross.disagree");
  return {
    rows,
    summary: {
      claims: rows.length,
      agreeConfirmed: of("cross.agree-confirmed"),
      agreeUnconfirmed: of("cross.agree-unconfirmed"),
      disagree: disagreements.length,
      evidenceDisjoint: rows.filter((row) => row.code === "cross.agree-confirmed" && row.evidenceDisjoint === true)
        .length,
    },
    disagreements,
  };
}

/**
 * The one notice this lens raises: agreements whose cited file sets share no
 * path. Second in the reading order after the disagreements, because it is
 * the shape correlated agreement takes when both agents guessed — each found
 * something plausible somewhere, and nothing says they found the same thing.
 */
export function disjointNotice(rows: readonly CrossClaim[]): VerifyNotice | null {
  const ids = rows
    .filter((row) => row.code === "cross.agree-confirmed" && row.evidenceDisjoint === true)
    .map((row) => row.id);
  if (ids.length === 0) return null;
  return {
    code: "cross.evidence-disjoint",
    severity: "warn",
    message:
      `${ids.length} agreed-confirmed claim(s) cite non-overlapping files: ${ids.join(", ")}. ` +
      "Two agents agreeing from different evidence is the second thing to read, after the disagreements.",
    claims: ids,
  };
}
