/**
 * Refuse or repair an interrupted commit, before this run reads anything.
 *
 * Split from `./intent.ts` because this is the only module on the write path
 * that writes bytes nobody asked for in this run. Two journal versions, two
 * doctrines, one dispatch: a version-1 record (archive/unarchive) is repaired
 * BACKWARD from the snapshot pre-images, each verified against the digest the
 * record captured; a version-2 record is handed to `txn/forward.ts`, which
 * rolls FORWARD from the staged temps under the same verification. Either
 * way, a file in NEITHER recorded state was written by somebody else since,
 * so recovery refuses and names it rather than choosing which of two truths
 * to destroy.
 */
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoPath } from "../../envelope/json.js";
import { sha256 } from "../writes.js";
import { atomicWrite, quietRmdir } from "../commit.js";
import { SNAPSHOT_DIR } from "../snapshot.js";
import {
  COMMIT_INTENT,
  type CommitRecovery,
  InterruptedCommitError,
  sweepPidTemps,
} from "../interrupted.js";
import { readTxnIntent } from "../txn/journal.js";
import { recoverForward } from "../txn/forward.js";
import {
  clearCommitIntent,
  readCommitIntent,
  type CommitIntent,
  type CommitIntentFile,
} from "./intent.js";

/**
 * Refuse or repair before this run reads anything. Returns null when there is
 * nothing to recover.
 *
 * Repair is only ever the bytes the interrupted run already had on disk: each
 * file still in the wrong state is rewritten from the snapshot pre-image and
 * only after that pre-image's own sha256 matches the digest the record captured
 * before the crash. A file in NEITHER state was written by somebody else since,
 * so this refuses and names it rather than choosing which of two truths to
 * destroy — the same doctrine `rollbackStaged` follows when it leaves a file as
 * found.
 */
export async function recoverInterruptedCommit(docsDir: string): Promise<CommitRecovery | null> {
  const path = join(docsDir, COMMIT_INTENT);
  if (!existsSync(path)) return null;
  const intent = await readCommitIntent(docsDir);
  if (intent === null) {
    // Version 2 — the smaller transaction's journal. Same file, different
    // recovery: forward from the staged temps, in txn/forward.ts.
    const txn = await readTxnIntent(docsDir);
    if (txn !== null) return recoverForward(docsDir, txn);
    throw new InterruptedCommitError(
      `${repoPath(docsDir, path)} records a commit this loam cannot read, so it cannot tell a half-merged docs repo ` +
        `from a healthy one. Check the living docs against version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }
  const moveFrom = join(docsDir, ...intent.moveFrom.split("/"));
  const moveTo = join(docsDir, ...intent.moveTo.split("/"));
  // The move is the commit's LAST step. If it landed, every swap before it did
  // too, and only the record's own removal was lost.
  if (existsSync(moveTo) && !existsSync(moveFrom)) {
    await finishRecovery(docsDir, intent);
    return { command: intent.command, feature: intent.feature, outcome: "completed", repaired: [] };
  }

  const target = (rel: string): string => join(docsDir, ...rel.split("/"));
  const wanted = (f: CommitIntentFile): string | null => (intent.restore === "before" ? f.before : f.after);
  const other = (f: CommitIntentFile): string | null => (intent.restore === "before" ? f.after : f.before);
  const pending: CommitIntentFile[] = [];
  const unknown: string[] = [];
  for (const f of intent.files) {
    const file = target(f.path);
    const now = existsSync(file) ? sha256(await readFile(file)) : null;
    if (now === wanted(f)) continue;
    if (now === other(f)) pending.push(f);
    else unknown.push(f.path);
  }
  if (unknown.length > 0) {
    throw new InterruptedCommitError(
      `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit (pid ${intent.pid} on ${intent.host}, ` +
        `${intent.at}) and ${unknown.length} of the file(s) it was writing now hold bytes that are neither what it ` +
        `found nor what it wrote — somebody edited them since: ${unknown.join(", ")}. loam will not choose between ` +
        `those two truths. Reconcile them against version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }
  if (pending.length === 0) {
    await finishRecovery(docsDir, intent);
    return { command: intent.command, feature: intent.feature, outcome: "consistent", repaired: [] };
  }

  // The pre-images travel inside the feature directory, so they are at one of
  // the two ends of the move depending on how far the interrupted run got.
  // Deliberately NOT the snapshot's (service, artifact) re-keying: the journal
  // and the snapshot were written seconds apart under the same docs lock, so
  // the journal's literal paths and the pre-image keys cannot have diverged —
  // a service directory moved by hand between the crash and this repair leaves
  // its files "in neither recorded state", which is the refusal below, not a
  // resolution question.
  const roots = [join(moveFrom, SNAPSHOT_DIR, "files"), join(moveTo, SNAPSHOT_DIR, "files")];
  const repaired: string[] = [];
  for (const f of pending) {
    const file = target(f.path);
    const want = wanted(f);
    if (want === null) {
      await rm(file, { force: true });
      await quietRmdir(dirname(file));
      repaired.push(f.path);
      continue;
    }
    const source = roots.map((r) => join(r, ...f.path.split("/"))).find((p) => existsSync(p));
    if (source === undefined) {
      throw new InterruptedCommitError(
        `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit and ${f.path} is half-written, but ` +
          `the pre-image that would repair it is gone. Restore ${f.path} from version control, delete ` +
          `${COMMIT_INTENT}, then re-run.`,
      );
    }
    const bytes = await readFile(source);
    if (sha256(bytes) !== want) {
      throw new InterruptedCommitError(
        `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit and ${f.path} is half-written, but ` +
          `the pre-image that would repair it no longer matches the digest recorded before the commit — it has been ` +
          `edited since. Restore ${f.path} from version control, delete ${COMMIT_INTENT}, then re-run.`,
      );
    }
    await atomicWrite(file, bytes);
    repaired.push(f.path);
  }
  await finishRecovery(docsDir, intent);
  return { command: intent.command, feature: intent.feature, outcome: "repaired", repaired };
}

/** Drop the record, and (via the shared pid-scoped sweep) the killed run's own temps. */
async function finishRecovery(docsDir: string, intent: CommitIntent): Promise<void> {
  await sweepPidTemps(
    intent.files.map((f) => dirname(join(docsDir, ...f.path.split("/")))),
    intent.pid,
  );
  await clearCommitIntent(docsDir);
}


