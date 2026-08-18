/**
 * `loam archive`: fold a finished feature's three axes into the living docs.
 *
 * Registration and the lock, nothing else. Everything the command actually does
 * is under `./plan/` and `./run.ts`, in that order — the gate refuses, the plan
 * computes, the commit swaps.
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, reportNoConfig, type ErrorCode } from "../../core/envelope/json.js";
import { message } from "../../core/staging/commit.js";
import { acquireDocsLock, DocsBusyError } from "../../core/staging/lock.js";
import { ArchiveFailure, type ArchiveOptions } from "./plan/refusal.js";
import { archiveLocked } from "./run.js";
import { LandscapeSpliceError } from "../../core/c4/splice/contract.js";
import { NotUtf8Error } from "../../core/staging/writes.js";
import { OpenapiMergeError } from "../../core/openapi/merge/error.js";
import { InterruptedCommitError } from "../../core/staging/interrupted.js";


function archiveErrorCode(err: unknown): ErrorCode {
  if (err instanceof ArchiveFailure) return err.code;
  // Every splice refusal is the mechanical merge answer — see the class.
  if (err instanceof LandscapeSpliceError) return "merge-failed";
  if (err instanceof NotUtf8Error) return "merge-failed";
  // The merge branch wraps its own call and re-throws as merge-failed; the
  // create branch (`stripOpenapiRemovalMarkers`) does not, so one unreadable
  // feature contract answered merge-failed or `internal` depending on whether
  // the service already had a living openapi.yaml. The code answers "can I
  // trust the repo?", and that answer does not turn on which side of the merge
  // the document sat on.
  if (err instanceof OpenapiMergeError) return "merge-failed";
  if (err instanceof InterruptedCommitError) return "commit-interrupted";
  return "internal";
}


export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .option("--approve", "archive despite GATING coherence issues (may corrupt the living docs); advisory warnings never block")
    .option("--dry-run", "print the whole merge plan and write nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: ArchiveOptions) => {
      const json = opts.json === true;
      try {
        await runArchive(featureId, opts);
      } catch (err) {
        // Plan-phase failures happen before any write; commit-phase failures are
        // rolled back by runArchive, which says so in the message it throws.
        // A file loam cannot decode is one it cannot merge, and that is the same
        // answer as any other merge it could not compute: nothing was written.
        fail(json, archiveErrorCode(err), `archive ${featureId} failed: ${message(err)}`);
      }
    });
}

async function runArchive(featureId: string, opts: ArchiveOptions): Promise<void> {
  const json = opts.json === true;
  const loaded = await loadConfig();
  if (loaded.kind !== "loaded") {
    reportNoConfig(json, loaded);
    return;
  }
  const config = loaded.config;
  let release: () => Promise<void>;
  try {
    release = await acquireDocsLock(config.docsDir);
  } catch (err) {
    if (err instanceof DocsBusyError) throw new ArchiveFailure("docs-busy", err.message);
    throw err;
  }
  try {
    await archiveLocked(config, featureId, opts);
  } finally {
    await release();
  }
}
