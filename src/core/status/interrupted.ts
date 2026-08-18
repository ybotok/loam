/**
 * The one state that outranks everything else: a journaled writer — archive,
 * unarchive, rebase, vouch, new, or a record — killed mid-commit, read off
 * the intent journal `.loam-commit` leaves in the docs repo. The shape both report forms carry it in is `InterruptedCommit`
 * (report.ts); this module is the cheap read behind it, and the recovery step
 * that leads every `next[]` while the journal exists.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COMMIT_INTENT } from "../staging/interrupted.js";
import { readCommitIntent } from "../staging/recovery/intent.js";
import { readTxnIntent } from "../staging/txn/journal.js";
import type { InterruptedCommit, NextStep } from "./report.js";

/**
 * The intent journal, if a commit left one behind. Null on every healthy repo,
 * which is every repo except one whose last write was killed.
 *
 * Cheap on purpose: an `existsSync` and, at most, one small JSON read. `doctor`
 * pays for the whole `scanWritePathResidue` walk because it is a diagnosis;
 * `status` is run before every step of the loop and asks the one question whose
 * answer invalidates all its others.
 */
export async function readInterruptedCommit(docsDir: string): Promise<InterruptedCommit | null> {
  const intent = await readCommitIntent(docsDir);
  if (intent === null) {
    if (!existsSync(join(docsDir, COMMIT_INTENT))) return null;
    // Version 2 — the smaller journaled transaction. Its `rerun` field IS the
    // recovering command: recovery runs at the start of that command's next
    // invocation, exactly as archive's does under its own lock.
    const txn = await readTxnIntent(docsDir);
    if (txn !== null) {
      return {
        command: txn.command,
        feature: txn.target,
        host: txn.host,
        pid: txn.pid,
        at: txn.at,
        files: txn.files.map((f) => f.path),
        unreadable: false,
        recover: txn.rerun,
      };
    }
    return {
      command: null,
      feature: null,
      host: null,
      pid: null,
      at: null,
      files: [],
      unreadable: true,
      recover: null,
    };
  }
  return {
    command: intent.command,
    feature: intent.feature,
    // Coerced here rather than trusted. `readCommitIntent` validates exactly the
    // fields a REPAIR needs — the version, the command, the restore direction,
    // the feature, the two move paths and the file digests — so `host`, `pid`
    // and `at` arrive as whatever the journal happened to hold, `undefined`
    // included. That is worse than null in both renderings: `JSON.stringify`
    // drops an undefined value's key entirely, so `--json` loses the field
    // instead of reporting it empty, and the two human lines print
    // "(undefined, pid undefined, undefined)". These three are the label a
    // person places the crash against and nothing branches on them, so the
    // coercion belongs at this boundary — widening the validator would change
    // which journals `archive` and `unarchive` agree to repair, which is a
    // decision about somebody's half-written docs, not about a label.
    host: typeof intent.host === "string" ? intent.host : null,
    pid: typeof intent.pid === "number" ? intent.pid : null,
    at: typeof intent.at === "string" ? intent.at : null,
    files: intent.files.map((f) => f.path),
    unreadable: false,
    // The recovering command is the interrupted one re-run: it repairs first,
    // under the lock, from the snapshot it took before the commit. Spelled per
    // branch rather than interpolated, like doctor's own repair line, so
    // test/agent-commands-runnable.test.ts can parse it against the real program.
    recover: intent.command === "archive" ? `loam archive ${intent.feature}` : `loam unarchive ${intent.feature}`,
  };
}

/**
 * The step that has to come before every other one. Always first, and never
 * elided by the fleet form's cap: nothing else in the list can be done until
 * somebody knows whether the living docs are the docs.
 */
export function recoverStep(i: InterruptedCommit): NextStep {
  return {
    code: "next.recover-commit",
    statement: i.unreadable
      ? `${COMMIT_INTENT} in this docs repo cannot be read — a commit was interrupted and the one record of which files it had already written is unreadable. Nothing below can be trusted until a human compares the living docs against version control.`
      : `A \`${i.recover}\` was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — ${i.files.length} file(s) may be half-written: ${i.files.join(", ")}. Everything below is derived from those files.`,
    // No command loam offers repairs an unreadable journal — saying otherwise
    // would send an agent to run something that refuses.
    command: i.recover ?? "loam doctor --json",
  };
}
