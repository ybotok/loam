/**
 * What the verification record says about this checklist, for the one
 * question a packet asks of it: which units have stopped being work.
 *
 * Nothing here decides what "confirmed" or "attested" MEAN — those verdicts are
 * `core/verify/record.ts`'s and nowhere else's, and they are imported rather
 * than re-derived. Nor, now, which recorded row counts as the answer to which
 * claim: that attestation-scoping rule was carried here as "a deliberate
 * mirror" of `statuses()` in `src/commands/verify/report.ts`, because core may
 * never import commands, and it moved down into `countedAnswers` in
 * `core/verify/record.ts` so both read one copy. What this module still owns
 * is the rule that a record which answers a different question set answers
 * nothing at all.
 */
import type { FeatureDir } from "../kernel/ids/dirs.js";
import type { Checklist } from "../verify/checklist.js";
import { readVerificationState } from "../verify/read/file.js";
import { attestedClaims, countedAnswers, type RecordedClaim } from "../verify/record.js";

/** The four states a packet reports, and the four a reader has to tell apart. */
export type RecordState = "absent" | "recorded" | "stale" | "unreadable";

export interface RecordView {
  state: RecordState;
  /** Claim id → the answer that counts for it. Empty unless `state` is "recorded". */
  answers: ReadonlyMap<string, RecordedClaim>;
}

/**
 * Read the record beside the feature and say what it answers.
 *
 * Staleness is all-or-nothing and it is the checklist digest that decides: a
 * record that answers a different question set is not an answer to this one,
 * however complete it looks. So a stale, unreadable or absent record confirms
 * NOTHING — every unit stays open, and the `record` key on the payload is what
 * says why the packet looks untouched. Silently crediting a stale record would
 * be the worst failure this command can have: an agent reading a thin packet as
 * "nothing left to do" over answers to questions nobody is asking any more.
 */
export async function readRecordView(featureDir: FeatureDir, checklist: Checklist): Promise<RecordView> {
  const read = await readVerificationState(featureDir);
  if (read.state === "absent") return { state: "absent", answers: new Map() };
  if (read.state === "unreadable") return { state: "unreadable", answers: new Map() };
  if (read.verification.checklist !== checklist.digest) return { state: "stale", answers: new Map() };
  return { state: "recorded", answers: countedAnswers(checklist.claims, read.verification) };
}

/**
 * Which claims have stopped being work, and which are complete-but-unrun.
 *
 * `attestedClaims` is the authority for the second set — a confirmed
 * `scenario.tested` whose `answered_by` is not a runner — and it is imported
 * rather than restated because the same predicate decides `verify`'s verdict,
 * `status`'s rung and the `verify.scenario-attested` notice. An attested unit
 * NEVER vanishes: it is somebody's word about a test, and the whole reason loam
 * exists is that a word must not read the same as a run.
 */
export function settledClaims(view: RecordView): { done: Set<string>; attested: Set<string> } {
  const answers = [...view.answers.values()];
  const attested = new Set(attestedClaims(answers));
  const done = new Set(
    answers.filter((claim) => claim.verdict === "confirmed" && !attested.has(claim.id)).map((claim) => claim.id),
  );
  return { done, attested };
}
