/**
 * The scaffold's commit window: lock, recover, the one existence check, the
 * exclusive-create transaction. Split from new.ts on the same seam vouch's
 * commitStamp and gherkin's commitEmission sit on — everything in here holds
 * the docs lock, nothing outside it does — and, as there, the split keeps the
 * window's extent visible in the code shape. This module prints nothing; the
 * caller renders every arm.
 */
import { type FeatureEntry } from "../../core/repo/entries.js";
import { type DocsDir } from "../../core/kernel/ids/dirs.js";
import { resolveFeature } from "../../core/repo/repo.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../core/staging/writes.js";

export type ScaffoldCommit =
  | { ok: true; recovered: CommitRecovery | null }
  | {
      ok: false;
      code: "docs-busy" | "commit-interrupted" | "merge-failed" | "rollback-incomplete";
      message: string;
    }
  /** The feature exists — found by the under-lock check, or by losing the create race. */
  | { ok: false; code: "already-exists"; existing: FeatureEntry | null; recovered: CommitRecovery | null }
  /**
   * The docs repo went away between the command's gate and the locked read.
   * Deliberately NOT a `code:` arm: the caller renders it through the shared
   * docs-repo reporter, and the codes-drift collector reads every `code:`
   * literal as a stable emission — which this discriminant is not.
   */
  | { ok: false; repoGone: DocsRepoUnavailableError };

export async function commitScaffold(
  docsDir: DocsDir,
  featureId: string,
  writes: PlannedWrite[],
): Promise<ScaffoldCommit> {
  // The commit window holds the docs lock: two `new`s for one id serialise
  // into a stable already-exists, and a predecessor's interrupted commit is
  // rolled forward (or refused) before this one stages anything.
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLockWaiting(docsDir, LOCK_WAIT_MS);
  } catch (err) {
    if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
    throw err;
  }
  try {
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      return { ok: false, code: "commit-interrupted", message: err.message };
    }
    // The one existence check, UNDER the lock and AFTER recovery: two racing
    // runs serialise on it, and a recovered half-scaffold has been completed
    // by the recovery above, so this refusal is truthful.
    let existing: FeatureEntry | null;
    try {
      existing = await resolveFeature(docsDir, featureId, "include");
    } catch (err) {
      // The command's gate already refused both broken states, so reaching
      // here means the docs repo went away between that check and this read.
      // Same breach, same two codes — the alternative is a stack trace under
      // `internal` that names neither.
      if (!(err instanceof DocsRepoUnavailableError)) throw err;
      return { ok: false, repoGone: err };
    }
    if (existing) return { ok: false, code: "already-exists", existing, recovered };
    const staged = await stageWrites(writes);
    const committed = await commitStaged(
      { root: docsDir, command: "new", rerun: `loam new ${featureId}`, target: featureId },
      staged,
      "scaffolded",
    );
    if (!committed.ok) {
      // A lost exclusive-create race IS the feature existing: the other `new`
      // won, and this refusal is the same stable answer the check above gives
      // when it sees the winner first.
      return committed.raced
        ? { ok: false, code: "already-exists", existing: null, recovered }
        : { ok: false, code: committed.code, message: committed.message };
    }
    return { ok: true, recovered };
  } finally {
    await releaseLock();
  }
}
