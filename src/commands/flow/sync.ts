/**
 * `loam flow sync` — the ONE repair for `flow.views-stale`: recompute
 * `architecture/flow-groups.likec4` from the flow documents, write it when it
 * differs, remove it when no flow declares a group, and say which.
 *
 * A structural clone of `../subsystem/sync.ts`, down to the transaction: the
 * write goes through the same lock and journaled commit every docs writer uses
 * (`commitStaged`), so a predecessor's interrupted commit is recovered first
 * and a sync killed mid-swap is rolled forward by the next writer. Idempotent
 * by construction — the expected bytes are a pure function of the committed
 * flow documents and the committed landscape, so a second run reports `current`
 * and writes nothing.
 *
 * The expected bytes come from `core/flows/project.ts`, the same module
 * `validate --all` grades staleness with, so the regenerator and the check
 * cannot disagree about what the file should say.
 *
 * IT REFUSES ON AN UNREADABLE FLOW DOCUMENT, and that is the one behaviour it
 * does not share with `subsystem sync`. That command tolerates an unparseable
 * landscape because the worst it can then render is a view with no includes;
 * here a document that did not parse contributes no group, "no group" means
 * "the file must be absent", and tolerance would spell that as DELETING every
 * correct group view over one typo.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { flowErrorLine, readFlowState } from "../../core/flows/project.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { emitJson, fail } from "../../core/envelope/json.js";
import { flowGroupViewsPath } from "../../core/repo/paths.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { sameBytes } from "../../core/staging/writes.js";

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
    // A predecessor's journal is recovered (or refused) before the documents
    // are read: the views file itself may be the half-written one.
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      fail(json, "commit-interrupted", err.message);
      return;
    }

    const state = await readFlowState(docsDir);
    if (state.errors.length > 0) {
      fail(
        json,
        "flow-invalid",
        `${state.errors.length} error(s) in the LikeC4 document(s) the flows are read from ` +
          "(architecture/flows/ and the fleet map beside it) — nothing was written. A journey nobody can " +
          "read declares no group, and regenerating from that would delete the group views of every " +
          "journey that IS readable. Fix the document the message names, then re-run:\n" +
          state.errors.map((err) => `  ${flowErrorLine(docsDir, err)}`).join("\n"),
      );
      return;
    }
    const path = flowGroupViewsPath(docsDir);
    const expectedBytes = state.expected === null ? null : Buffer.from(state.expected, "utf8");
    const actual = existsSync(path) ? await readFile(path) : null;
    if (sameBytes(actual, expectedBytes)) {
      report(json, { action: "current", groups: state.groups.length, recovered });
      return;
    }
    const action: SyncAction = actual === null ? "created" : expectedBytes === null ? "removed" : "updated";
    const staged = await stageWrites([{ path, content: expectedBytes }]);
    const committed = await commitStaged(
      { root: docsDir, command: "flow", rerun: "loam flow sync", target: "flow-groups" },
      staged,
      "synced",
    );
    if (!committed.ok) {
      fail(json, committed.code, committed.message);
      return;
    }
    report(json, { action, groups: state.groups.length, recovered });
  } finally {
    await releaseLock();
  }
}

function report(
  json: boolean,
  out: { action: SyncAction; groups: number; recovered: CommitRecovery | null },
): void {
  if (json) {
    emitJson({
      path: "architecture/flow-groups.likec4",
      action: out.action,
      groups: out.groups,
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
    current: `architecture/flow-groups.likec4 is current (${out.groups} group(s)) — nothing to write.`,
    created: `wrote architecture/flow-groups.likec4 — ${out.groups} group view(s).`,
    updated: `updated architecture/flow-groups.likec4 — ${out.groups} group view(s).`,
    removed: `removed architecture/flow-groups.likec4 — no flow declares a group, so the generated file must be absent.`,
  };
  console.log(sentence[out.action]);
}
