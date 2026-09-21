/**
 * What `verification.yaml` says about this checklist, for the one question a
 * packet asks of it: which units have stopped being work.
 *
 * Nothing here decides what "confirmed" or "attested" MEAN — those verdicts are
 * `core/verify/record.ts`'s and nowhere else's, and they are imported rather
 * than re-derived. What this module owns is the RESOLUTION: which recorded row
 * counts as the answer to which claim, and the rule that a record which answers
 * a different question set answers nothing at all.
 *
 * The resolution is a deliberate mirror of `statuses()` in
 * `src/commands/verify/report.ts`, not a second opinion: core may never import
 * commands (AGENTS.md's dependency direction), and that helper lives in a
 * command module beside the printing it feeds. The two must move together —
 * a change to the attestation-scoping rule there is a change here. The rule
 * itself is one sentence: in a federated (schema 2) record, an answer only
 * counts when the attestation that carried it belongs to the service the
 * checklist files the claim under, so one repository cannot answer another's
 * claims by writing their ids into its own attestation.
 */
import type { FeatureDir } from "../kernel/ids/dirs.js";
import type { Checklist } from "../verify/checklist.js";
import { readVerificationState } from "../verify/file.js";
import { attestedClaims, type RecordedClaim, type Verification } from "../verify/record.js";

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
  return { state: "recorded", answers: scopedAnswers(checklist, read.verification) };
}

/**
 * The recorded rows that may answer this checklist, keyed by claim id.
 *
 * A legacy record (no `schema`) is all-at-once: every row it holds is an answer
 * to the whole checklist. A schema-2 record is federated, so a row only counts
 * where an attestation from the claim's OWN subject listed that claim id — see
 * this module's header for why. Rows for ids the checklist no longer asks are
 * simply never looked up.
 */
function scopedAnswers(checklist: Checklist, recorded: Verification): Map<string, RecordedClaim> {
  const subjects = new Map(checklist.claims.map((claim) => [claim.id, claim.subject]));
  const attested =
    recorded.schema !== 2
      ? null
      : new Set(
          (recorded.attestations ?? []).flatMap((attestation) =>
            attestation.claims.filter((id) => subjects.get(id) === attestation.service),
          ),
        );
  return new Map(
    recorded.claims
      .filter((claim) => attested === null || attested.has(claim.id))
      .map((claim) => [claim.id, claim]),
  );
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
