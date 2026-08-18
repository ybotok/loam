import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, reportNoConfig } from "../../core/envelope/json.js";
import { message } from "../../core/staging/commit.js";
import { acquireDocsLock, DocsBusyError } from "../../core/staging/lock.js";
import { InterruptedCommitError } from "../../core/staging/interrupted.js";
import { unarchiveLocked } from "./restore.js";
import { RestoreFailure } from "./manifest.js";

/**
 * `loam unarchive <FEAT>` — take back a `loam archive`.
 *
 * Not an inverse merge, and it cannot be one. Undoing the requirements axis would
 * mean restoring a MODIFIED requirement's PREVIOUS text, which appears nowhere:
 * the delta records what the requirement became, never what it was. The landscape
 * axis is no better — the merge drops the feature tags, so the added lines are
 * indistinguishable from lines that were always there. Anything reconstructed
 * from the archived feature would be a plausible guess at the old docs, which is
 * exactly the kind of quiet fiction the rest of loam exists to prevent.
 *
 * So archive writes the bytes down instead (`<feature>/.loam-before/`), and this
 * command puts them back. The snapshot is optional on restore: a feature archived
 * before it existed fails with a clear message rather than a crash.
 */

interface UnarchiveOptions {
  json?: boolean;
  force?: boolean;
}

/**
 * A commit-phase failure with its stable `--json` code attached — the mirror of
 * archive's discipline. `restore-failed` answers "can I trust the repo?" with
 * yes: nothing was restored, or everything was rolled back, and re-running can
 * work. `rollback-incomplete` is the code that demands a human: the restore
 * failed AND some files could not be put back — the message lists them.
 * Anything ELSE that escapes runUnarchive never touched the commit phase, so
 * the action handler reports it as `restore-failed`.
 */

export function registerUnarchive(program: Command): void {
  program
    .command("unarchive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Take back a `loam archive`: restore the living docs and re-open the feature")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--force", "restore even if the living docs changed after the archive (discards those changes)")
    .action(async (featureId: string, opts: UnarchiveOptions) => {
      const json = opts.json === true;
      try {
        await runUnarchive(featureId, json, opts.force === true);
      } catch (err) {
        const code = err instanceof RestoreFailure
          ? err.code
          : err instanceof InterruptedCommitError
            ? "commit-interrupted"
            : "restore-failed";
        fail(json, code, `unarchive ${featureId} failed: ${message(err)}`);
      }
    });
}

async function runUnarchive(featureId: string, json: boolean, force: boolean): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    reportNoConfig(json);
    return;
  }
  // The same lock archive takes, for the same reason: unarchive rewrites the
  // living spec, contract and landscape from a snapshot, and an archive landing
  // inside that window would have its merge silently reverted by our restore —
  // or ours by its merge. One writer per docs repo, whichever direction it
  // writes in.
  let release: () => Promise<void>;
  try {
    release = await acquireDocsLock(config.docsDir);
  } catch (err) {
    if (err instanceof DocsBusyError) throw new RestoreFailure("docs-busy", err.message);
    throw err;
  }
  try {
    await unarchiveLocked(config.docsDir, featureId, json, force);
  } finally {
    await release();
  }
}
