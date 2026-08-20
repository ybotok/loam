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
import { ungroupedFlows } from "../../core/flows/groups.js";
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
import { printUngrouped } from "./render.js";

/** What one sync did to the file. */
type SyncAction = "current" | "created" | "updated" | "removed";

/**
 * What one sync has to say: what it did to the file, and what did not reach a
 * view of it.
 *
 * Named rather than spelled inline at both call sites, because `groups`,
 * `journeys` and `ungrouped` are three readings of ONE `FlowState` and are only
 * true together — a report assembled from two reads could say a fleet has two
 * groups and three journeys none of which is in one.
 */
interface SyncReport {
  action: SyncAction;
  groups: number;
  /** Every dynamic view the `architecture/` project declares — the denominator `ungrouped` is out of. */
  journeys: number;
  /** The journeys in no group, sorted: drawn, graded, and in none of the views this file holds. */
  ungrouped: string[];
  recovered: CommitRecovery | null;
}

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
    // Taken from the SAME state the expected bytes come from, so what the report
    // says and what the file holds cannot describe two different reads.
    const counted = {
      groups: state.groups.length,
      journeys: state.flows.length,
      ungrouped: ungroupedFlows(state.flows),
    };
    const path = flowGroupViewsPath(docsDir);
    const expectedBytes = state.expected === null ? null : Buffer.from(state.expected, "utf8");
    const actual = existsSync(path) ? await readFile(path) : null;
    if (sameBytes(actual, expectedBytes)) {
      report(json, { action: "current", ...counted, recovered });
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
    report(json, { action, ...counted, recovered });
  } finally {
    await releaseLock();
  }
}

function report(json: boolean, out: SyncReport): void {
  if (json) {
    // `journeys` and `ungrouped` are ADDITIVE keys on a frozen envelope: a
    // consumer reading `groups` is untouched, and one that wants to know what
    // the generated file leaves out no longer has to parse the text view.
    emitJson({
      path: "architecture/flow-groups.likec4",
      action: out.action,
      groups: out.groups,
      journeys: out.journeys,
      ungrouped: out.ungrouped,
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
  // AFTER the sentence, including on `current` and `removed`: the sentence is
  // about the file, this is about what never reached it, and a run that wrote
  // nothing is exactly when an author is most likely to be asking why their
  // journey is missing.
  printUngrouped(out.ungrouped, out.journeys);
}
