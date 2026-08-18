/**
 * The emission's commit window: lock the owned root, recover a predecessor,
 * stage every write and delete, prove the tree still matches what reconcile
 * graded, and land it through the journaled transaction.
 *
 * Split from gherkin.ts so the lock's extent is visible in the code shape,
 * exactly as vouch's commitStamp is — and because this is the writer the
 * roadmap named: a kill inside the old write/delete loop left a half-old,
 * half-new suite with no marker, in the one repo (the service's own) where
 * nothing else of loam's ever looked.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { quietRmdir, rollbackStaged, stageWrites } from "../../core/staging/commit.js";
import { COMMIT_INTENT, type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { type ActionRow, type Scope } from "./reconcile.js";

export type EmissionCommit =
  | { ok: true; recovered: CommitRecovery | null }
  | { ok: false; code: "docs-busy" | "commit-interrupted" | "merge-failed" | "rollback-incomplete"; message: string };

/**
 * Roll a predecessor's interrupted emission forward before ANYTHING reads the
 * suite — reconcile grades the very bytes a half-commit corrupts. Cheap when
 * there is nothing to do: no journal, no lock, no I/O beyond one existsSync.
 */
export async function recoverEmissionRoot(root: string): Promise<EmissionCommit> {
  if (!existsSync(join(root, COMMIT_INTENT))) return { ok: true, recovered: null };
  let release: () => Promise<void>;
  try {
    release = await acquireDocsLockWaiting(root, LOCK_WAIT_MS);
  } catch (err) {
    if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
    throw err;
  }
  try {
    return { ok: true, recovered: await recoverInterruptedCommit(root) };
  } catch (err) {
    if (err instanceof InterruptedCommitError) return { ok: false, code: "commit-interrupted", message: err.message };
    throw err;
  } finally {
    await release();
  }
}

/**
 * Stage, compare, journal, swap. The compare is against the bytes RECONCILE
 * read: a `.feature` that changed (or appeared) between the grading and this
 * commit is refused by name, never buried — the suite is code somebody may be
 * editing, and "refused, not buried" is the no-clobber rule the roadmap
 * spells for exactly this writer.
 */
export async function commitEmission(
  spec: { root: string; service: string; scope: Scope },
  plan: { writes: ActionRow[]; orphans: { path: string; raw: Buffer }[] },
): Promise<EmissionCommit> {
  const { root, service, scope } = spec;
  // The lock file lives in the root, so the root must exist first. If the
  // commit then fails having created it, the empty directory is removed
  // again — an empty loam/ flips the repo into "opted in" and tells
  // `loam validate` the whole living suite is missing.
  const rootExisted = existsSync(root);
  await mkdir(root, { recursive: true });
  let release: () => Promise<void>;
  try {
    release = await acquireDocsLockWaiting(root, LOCK_WAIT_MS);
  } catch (err) {
    if (!rootExisted) await quietRmdir(root);
    if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
    throw err;
  }
  try {
    // A writer can have crashed between the command-start recovery and this
    // window; the re-check is one existsSync when nothing happened.
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(root);
    } catch (err) {
      if (err instanceof InterruptedCommitError) return { ok: false, code: "commit-interrupted", message: err.message };
      throw err;
    }

    const planned: PlannedWrite[] = [
      // A "written" row was graded against an ABSENT file, so its create is
      // exclusive: a file appearing after planning loses the link(2) race and
      // the run refuses rather than overwriting it.
      ...plan.writes.map((a): PlannedWrite =>
        a.action === "written" ? { path: a.path, content: a.content, exclusive: true } : { path: a.path, content: a.content },
      ),
      ...plan.orphans.map((o): PlannedWrite => ({ path: o.path, content: null })),
    ];
    const staged = await stageWrites(planned);

    // The bytes reconcile graded must be the bytes this commit replaces or
    // deletes. `swapStaged` re-checks against ITS read just before each
    // rename; this compare closes the other half of the window, from the
    // grading to the staging.
    const graded = new Map<string, Buffer>();
    for (const a of plan.writes) if (a.action === "replaced") graded.set(a.path, a.raw);
    for (const o of plan.orphans) graded.set(o.path, o.raw);
    const moved = staged
      .filter((s) => {
        const raw = graded.get(s.write.path);
        return raw !== undefined && (s.before === null || !s.before.equals(raw));
      })
      .map((s) => s.write.path);
    if (moved.length > 0) {
      await rollbackStaged(staged);
      return {
        ok: false,
        code: "merge-failed",
        message:
          `the suite changed while this emission was being planned — ${moved.join(", ")} ` +
          `no longer holds the bytes the plan was graded against. Nothing was written: re-run.`,
      };
    }

    const committed = await commitStaged(
      {
        root,
        command: "gherkin",
        rerun: scope.mode === "feature" ? `loam gherkin ${scope.featureId}` : "loam gherkin",
        target: service,
      },
      staged,
      "emitted",
    );
    if (!committed.ok) {
      return committed.raced
        ? {
            ok: false,
            code: "merge-failed",
            message:
              "a .feature file appeared after planning and the emission refused to overwrite it — " +
              `${committed.message}. Nothing else was written: re-run to grade the new file.`,
          }
        : { ok: false, code: committed.code, message: committed.message };
    }
    return { ok: true, recovered };
  } finally {
    await release();
    if (!rootExisted && !existsSync(join(root, COMMIT_INTENT))) await quietRmdir(root);
  }
}

