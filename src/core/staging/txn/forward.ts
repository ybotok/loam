/**
 * Roll a version-2 journal FORWARD: finish the renames a killed commit did
 * not reach, from the staged temps that are already durable on disk.
 *
 * Forward and not undo, because that is what is actually durable: the
 * after-bytes were written and (per stageWrites) fully on disk before the
 * journal existed, while the OVERWRITTEN files' pre-images are durable
 * nowhere — the rename that replaced them destroyed the only copy. The plan
 * was validated completely before the first rename, so the post-state is
 * exactly what a successful run would have produced; unarchive's
 * finish-never-undo recovery is the precedent.
 *
 * The refuse-to-choose doctrine is rollbackStaged's, verbatim: a file whose
 * bytes are neither the before- nor the after-digest was edited by somebody
 * since the crash, and completing over it would destroy one of two truths.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { quietRmdir } from "../commit.js";
import { sha256 } from "../writes.js";
import { COMMIT_INTENT, type CommitRecovery, InterruptedCommitError, sweepPidTemps } from "../interrupted.js";
import { clearTxnIntent, type TxnIntent, type TxnIntentFile, type TxnIntentMove } from "./journal.js";

export async function recoverForward(root: string, intent: TxnIntent): Promise<CommitRecovery> {
  const target = (f: TxnIntentFile): string => join(root, ...f.path.split("/"));
  const abs = (rel: string): string => join(root, ...rel.split("/"));
  const done: TxnIntentFile[] = [];
  const pending: TxnIntentFile[] = [];
  const unknown: string[] = [];
  for (const f of intent.files) {
    const file = target(f);
    const now = existsSync(file) ? sha256(await readFile(file)) : null;
    if (now === f.after) done.push(f);
    else if (now === f.before) pending.push(f);
    else unknown.push(f.path);
  }
  // A directory rename is classified by pure existence — a rename moves the
  // inode, so "which end exists" is exactly as discriminating as a digest is
  // for a file. Both ends existing (or neither) is a state no step of the
  // commit produces: somebody made a directory since the crash, and choosing
  // which tree to keep is the refuse-to-choose case below.
  const movesDone: TxnIntentMove[] = [];
  const movesPending: TxnIntentMove[] = [];
  for (const m of intent.moves) {
    const fromExists = existsSync(abs(m.from));
    const toExists = existsSync(abs(m.to));
    if (toExists && !fromExists) movesDone.push(m);
    else if (fromExists && !toExists) movesPending.push(m);
    else unknown.push(`${m.from} -> ${m.to}`);
  }
  if (unknown.length > 0) {
    throw new InterruptedCommitError(
      `a \`${intent.rerun}\` was interrupted mid-commit (pid ${intent.pid} on ${intent.host}, ${intent.at}) and ` +
        `${unknown.length} of the file(s) it was writing now hold bytes that are neither what it found nor what it ` +
        `wrote — somebody edited them since: ${unknown.join(", ")}. loam will not choose between those two truths. ` +
        `Reconcile them against version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }

  // Whether forward is still POSSIBLE is decided before a single byte moves:
  // completing some files and then refusing on a missing temp would leave the
  // repo in a state neither the old nor the new tree ever had.
  const missing = pending.filter((f) => f.after !== null && !usableTemp(root, f));
  if (missing.length > 0) {
    // A file whose before and after digests are EQUAL — an unchanged file
    // carried through a commit — reads as "done" in whichever state it is in,
    // so it is not evidence that any rename landed. Only a file that could
    // tell the two states apart counts as one — and a landed directory MOVE
    // always can, so it counts too.
    const evidence = done.filter((f) => f.before !== f.after);
    if (evidence.length === 0 && movesDone.length === 0) {
      // Nothing ever swapped and the temps are gone — this is the tree a
      // completed ROLLBACK leaves when the crash landed between the rollback
      // and the journal's removal. The complete pre-state is on disk, which
      // is one of the two states recovery promises; declaring it beats
      // refusing over bytes that are already consistent.
      await finish(root, intent);
      return { command: intent.command, feature: intent.target, outcome: "consistent", repaired: [] };
    }
    throw new InterruptedCommitError(
      `a \`${intent.rerun}\` was interrupted mid-commit and ${missing.map((f) => f.path).join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} still in the pre-commit state, but the staged bytes that would ` +
        `finish ${missing.length === 1 ? "it" : "them"} are gone or no longer match the digest recorded before the ` +
        `crash. Restore the tree from version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }

  const repaired: string[] = [];
  for (const f of pending) {
    const file = target(f);
    if (f.after === null) {
      await rm(file, { force: true });
      await quietRmdir(dirname(file));
    } else {
      await rename(join(root, ...f.tmp!.split("/")), file);
    }
    repaired.push(f.path);
  }
  // Renames after the file swaps, in recorded order — the order the commit
  // itself performs them. One that cannot land now (the destination's parent
  // deleted since the crash, a Windows EPERM on an open handle) is a refusal
  // naming the pair, not a half-finished loop: nothing before it is undone,
  // and the journal stays for the next attempt.
  for (const m of movesPending) {
    try {
      await rename(abs(m.from), abs(m.to));
    } catch (err) {
      throw new InterruptedCommitError(
        `a \`${intent.rerun}\` was interrupted mid-commit and the rename ${m.from} -> ${m.to} that would finish it ` +
          `cannot be performed now (${err instanceof Error ? err.message : String(err)}). ` +
          `Complete or undo it by hand against version control, delete ${COMMIT_INTENT}, then re-run.`,
      );
    }
    repaired.push(m.to);
  }
  await finish(root, intent);
  return {
    command: intent.command,
    feature: intent.target,
    outcome: repaired.length > 0 ? "repaired" : "completed",
    repaired,
  };
}

/** Is the recorded temp still there with exactly the bytes the journal promised? */
function usableTemp(root: string, f: TxnIntentFile): boolean {
  if (f.tmp === null) return false;
  const path = join(root, ...f.tmp.split("/"));
  try {
    return sha256(readFileSync(path)) === f.after;
  } catch {
    return false;
  }
}

async function finish(root: string, intent: TxnIntent): Promise<void> {
  const dirs = intent.files.flatMap((f) => {
    const out = [dirname(join(root, ...f.path.split("/")))];
    if (f.tmp !== null) out.push(dirname(join(root, ...f.tmp.split("/"))));
    return out;
  });
  await sweepPidTemps(dirs, intent.pid);
  await clearTxnIntent(root);
}

