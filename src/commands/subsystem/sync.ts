/**
 * `loam subsystem sync` — the ONE repair for `subsystem.views-stale`:
 * recompute the generated views file from the tree, write it when it
 * differs, remove it when the tree has no subsystems, and say which.
 *
 * The write goes through the same lock + journaled transaction every docs
 * writer uses (`commitStaged`), so a predecessor's interrupted commit is
 * recovered first and a sync killed mid-swap is rolled forward by the next
 * writer. Idempotent by construction: the expected bytes are a pure function
 * of the tree and the committed landscape, so a second run reports `current`
 * and writes nothing.
 *
 * The expected bytes come from `./txn/views.ts` — the same module every
 * writer verb renders from, so sync and the transactions cannot disagree
 * about what the file should say.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { emitJson, fail } from "../../core/envelope/json.js";
import { subsystemViewsPath } from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { viewsAgree } from "../../core/repo/tree/views.js";
import { expectedViews } from "./txn/views.js";

/** What one sync did to the file. */
type SyncAction = "current" | "created" | "updated" | "removed";

export async function runSync(docsDir: DocsDir, json: boolean): Promise<void> {
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLockWaiting(docsDir, LOCK_WAIT_MS);
  } catch (err) {
    if (!(err instanceof DocsBusyError)) throw err;
    fail(json, "docs-busy", err.message);
    return;
  }
  try {
    // A predecessor's journal is recovered (or refused) before the tree is
    // read: the views file itself may be the half-written one.
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      fail(json, "commit-interrupted", err.message);
      return;
    }

    const tree = await listFleetTree(docsDir);
    const expected = await expectedViews(docsDir, tree);
    const path = subsystemViewsPath(docsDir);
    const expectedBytes = expected === null ? null : Buffer.from(expected, "utf8");
    // Content, not bytes: `viewsAgree` records why, beside the generator. A
    // Windows clone hands this file back CRLF with not one fact changed, and a
    // byte compare made `sync` answer `updated` and rewrite it LF — after which
    // git shows the file permanently modified and the next checkout puts the
    // CRLF back. `validate` stopped demanding that rewrite; `sync` must stop
    // offering it, or the two disagree about the same file.
    const actual = existsSync(path) ? await readFile(path, "utf8") : null;
    if (viewsAgree(actual, expected)) {
      report(json, { action: "current", subsystems: tree.subsystems.length, recovered });
      return;
    }
    const action: SyncAction = actual === null ? "created" : expectedBytes === null ? "removed" : "updated";
    const staged = await stageWrites([{ path, content: expectedBytes }]);
    const committed = await commitStaged(
      { root: docsDir, command: "subsystem", rerun: "loam subsystem sync", target: "subsystems" },
      staged,
      "synced",
    );
    if (!committed.ok) {
      fail(json, committed.code, committed.message);
      return;
    }
    report(json, { action, subsystems: tree.subsystems.length, recovered });
  } finally {
    await releaseLock();
  }
}

function report(
  json: boolean,
  out: { action: SyncAction; subsystems: number; recovered: CommitRecovery | null },
): void {
  if (json) {
    emitJson({
      command: "subsystem",
      path: "architecture/subsystems.likec4",
      action: out.action,
      subsystems: out.subsystems,
      ...(out.recovered === null ? {} : { recovered: out.recovered }),
    });
    return;
  }
  if (out.recovered !== null && out.recovered.outcome !== "consistent") {
    console.log(
      `note: recovered an interrupted \`loam ${out.recovered.command}\` commit first (${out.recovered.outcome}).`,
    );
  }
  const sentence: Record<SyncAction, string> = {
    current: `architecture/subsystems.likec4 is current (${out.subsystems} subsystem(s)) — nothing to write.`,
    created: `wrote architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    updated: `updated architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    removed: `removed architecture/subsystems.likec4 — the tree has no subsystems, so the generated file must be absent.`,
  };
  console.log(sentence[out.action]);
}
