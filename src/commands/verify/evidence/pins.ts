/**
 * The record path's half of evidence pins: attaching what the evidence
 * validation computed onto the answers being recorded, and saying — once,
 * while the agent is still in the loop — when a cited blob does not contain
 * the string its claim asserts.
 *
 * It lives in `evidence/` beside the report readers because it is the same
 * subject (what a federated confirmation rests on), and because `record.ts`
 * sits against the line limit: the notice's wording and the attach loop are a
 * seam of their own, not lines seventeen-through-forty of the record flow.
 */
import { type Answer } from "../../../core/verify/answers.js";
import { type Claim } from "../../../core/verify/checklist.js";
import { type EvidencePin } from "../../../core/verify/pins/pin.js";
import { type VerifyNotice } from "../../../core/verify/record.js";
import { plural } from "../../policy/format.js";

/**
 * One citation whose committed blob does not contain the claim's token —
 * collected by `validateServiceEvidence` in the same pass that builds the pin,
 * where the blob is already in hand. The type lives here rather than in
 * `../results.ts` so this package never imports its parent back (the package
 * graph's acyclicity is a checked obligation, not a taste).
 */
export interface TokenMiss {
  id: string;
  /** The `path:line` citation whose blob was scanned. */
  evidence: string;
  token: string;
}

/** Claim id → the literal the claim asserts, for the kinds that assert one. */
export function claimTokens(claims: readonly Claim[]): ReadonlyMap<string, string> {
  return new Map(claims.flatMap((c) => (c.token === undefined ? [] : [[c.id, c.token] as const])));
}

/** The validation's pin and token-miss halves together — they come from one pass. */
export interface EvidencePins {
  /** Claim id → one pin per file:line citation, in evidence order. */
  pins: ReadonlyMap<string, EvidencePin[]>;
  tokenMisses: TokenMiss[];
}

export interface PinnedAnswers {
  answers: Answer[];
  /** The record-time token warning, or null when every scanned blob held its token. */
  notice: VerifyNotice | null;
}

/**
 * Stamp the computed pins onto the answers they were computed from, and build
 * the one record-time notice. The notice is verdict-neutral and gates nothing
 * — verify has never gated — but it fires HERE rather than only at the next
 * `loam validate` because record time is the anti-fabrication moment: the
 * agent whose evidence does not spell the claim is still in the loop to
 * re-read it. The validate-side `evidence.token-missing` finding describes the
 * same fact later and continuously, in a different repository's run; neither
 * surface is derivable from the other's.
 */
export function pinAnswers(answers: Answer[], evidence: EvidencePins, commit: string): PinnedAnswers {
  const pinned = answers.map((answer) => {
    const pins = evidence.pins.get(answer.id);
    return pins === undefined ? answer : { ...answer, evidence_pins: pins };
  });
  if (evidence.tokenMisses.length === 0) return { answers: pinned, notice: null };
  const cited = evidence.tokenMisses.map((m) => `${m.id} ${m.evidence} (token '${m.token}')`);
  return {
    answers: pinned,
    notice: {
      code: "verify.evidence-token-missing",
      severity: "warn",
      message:
        `${plural(evidence.tokenMisses.length, "confirmed citation")} whose file at ${commit.slice(0, 12)} does not contain ` +
        `the literal string the claim asserts: ${cited.join("; ")}. ` +
        "Read that evidence before trusting it — a pin records what was cited, not that the claim is true. " +
        "The answer stands as given; nothing gates on this.",
      claims: [...new Set(evidence.tokenMisses.map((m) => m.id))],
    },
  };
}
