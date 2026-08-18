/**
 * The journaled commit itself: journal (fsynced) → swap → clear, with
 * archive's ordering on the failure path — the rollback decides the outcome,
 * and only then does the journal have nothing left to describe. A crash
 * anywhere inside leaves either the journal plus a recoverable tree (roll
 * forward finishes it) or a fully rolled-back tree whose stale journal the
 * next recovery reads as the consistent pre-state.
 *
 * Callers stage for themselves before committing, on purpose: vouch's
 * byte-level raced check and gherkin's planned-vs-read compare both have to
 * run BETWEEN staging and the swap, against the pre-images staging read.
 */
import { message, rollbackMessage, rollbackStaged, StagingRaceError, swapStaged } from "../commit.js";
import { type StagedWrite } from "../writes.js";
import { clearTxnIntent, writeTxnIntent, type TxnSpec } from "./journal.js";

export type StagedCommit =
  | { ok: true }
  | {
      ok: false;
      code: "merge-failed" | "rollback-incomplete";
      message: string;
      /**
       * The failure was another writer winning a race (an exclusive create
       * losing to a concurrent one, or the pre-image compare firing), so the
       * caller may map it to its own stable race code — `new` answers
       * `already-exists`, vouch answers `vouch-raced` — instead of the
       * generic merge failure.
       */
      raced: boolean;
    };

/**
 * `what` is the verb the rollback sentence uses for the half-state ("merged",
 * "stamped", "written") — each caller keeps the word its operators already
 * grep their logs for.
 */
export async function commitStaged(spec: TxnSpec, staged: StagedWrite[], what: string): Promise<StagedCommit> {
  await writeTxnIntent(spec, staged);
  try {
    await swapStaged(staged);
  } catch (err) {
    const failures = await rollbackStaged(staged);
    // The journal is cleared only when the rollback HELD. On rollback-incomplete
    // the tree is genuinely half-written and the temps are gone — the journal
    // is the one durable record of which files, so doctor keeps naming them,
    // validate keeps refusing to grade the tree green, and the next writer
    // refuses commit-interrupted instead of writing over the wreckage. Archive
    // pays the same way by retaining its snapshot on this path.
    if (failures.length === 0) await clearTxnIntent(spec.root);
    const raced = err instanceof StagingRaceError || (err as NodeJS.ErrnoException).code === "EEXIST";
    if (failures.length > 0) {
      // NEVER raced, whatever threw: callers remap a raced failure onto their
      // own softer code (vouch-raced, already-exists) with "nothing was
      // written" prose — and here something WAS written and could not be
      // taken back. rollback-incomplete is the one answer that demands a
      // human, and no remap may swallow the file list that says where.
      return { ok: false, code: "rollback-incomplete", message: rollbackMessage(err, failures, what), raced: false };
    }
    return { ok: false, code: "merge-failed", message: `${message(err)} — rolled back, nothing was written`, raced };
  }
  await clearTxnIntent(spec.root);
  return { ok: true };
}
