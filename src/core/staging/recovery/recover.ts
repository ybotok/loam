/**
 * Refuse or repair an interrupted commit, before this run reads anything.
 *
 * Split from `./intent.ts` because this is the only module on the write path
 * that writes bytes nobody asked for in this run. Repair is never more than the
 * pre-image the interrupted run had already captured, and only once that
 * pre-image's own digest matches what the record captured before the crash. A
 * file in NEITHER state was written by somebody else since, so this refuses and
 * names it rather than choosing which of two truths to destroy.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoPath } from "../../envelope/json.js";
import { sha256 } from "../writes.js";
import { atomicWrite, quietRm, TEMP_FILE_RE } from "../commit.js";
import { SNAPSHOT_DIR } from "../snapshot.js";
import {
  clearCommitIntent,
  readCommitIntent,
  COMMIT_INTENT,
  type CommitIntent,
  type CommitIntentFile,
  type CommitRecovery,
  InterruptedCommitError,
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

/**
 * Drop the record, and the staged temp files the killed run could not remove.
 *
 * Scoped to that run's own pid and its own targets — the temp name carries both
 * — so a leftover belonging to anything else is left for `doctor` to name.
 * Without this a repair that put every byte back still left the docs repo
 * dirty, which is the one thing a caller checks to decide whether it worked.
 */
async function finishRecovery(docsDir: string, intent: CommitIntent): Promise<void> {
  const dirs = new Set(intent.files.map((f) => dirname(join(docsDir, ...f.path.split("/")))));
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!TEMP_FILE_RE.test(name) || !name.includes(`.loam-${intent.pid}-`)) continue;
      await quietRm(join(dir, name));
    }
  }
  await clearCommitIntent(docsDir);
}

/** Remove `dir` if it is empty. Best effort — a directory left standing is noise, not corruption. */
async function quietRmdir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // Not empty, or not ours.
  }
}

