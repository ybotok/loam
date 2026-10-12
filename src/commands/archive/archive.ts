/**
 * `loam archive`: fold a finished feature's three axes into the living docs.
 *
 * Registration and the lock, nothing else. Everything the command actually does
 * is under `./plan/` and `./run.ts`, in that order — the gate refuses, the plan
 * computes, the commit swaps.
 */
import type { Command } from "commander";
import { CodedFailure, configOrRefuse, fail, type ErrorCode } from "../../core/envelope/json.js";
import { message } from "../../core/staging/commit.js";
import { acquireDocsLock, DocsBusyError } from "../../core/staging/lock.js";
import { type ArchiveOptions } from "./plan/refusal.js";
import { archiveLocked } from "./run.js";
import { LandscapeSpliceError } from "../../core/c4/splice/contract.js";
import { NotUtf8Error } from "../../core/staging/writes.js";
import { OpenapiMergeError } from "../../core/openapi/merge/error.js";
import { InterruptedCommitError } from "../../core/staging/interrupted.js";

/**
 * The code a failed archive answers with. A `CodedFailure` is thrown from the
 * plan phase (nothing written yet) and from the commit's rollback path (whose
 * message says whether the rollback held). Anything that escapes runArchive and
 * matches no arm below is a bug, and reports as `internal`.
 */
function archiveErrorCode(err: unknown): ErrorCode {
  if (err instanceof CodedFailure) return err.code;
  // Another writer holds the docs repo — the lock is taken refuse-fast below.
  if (err instanceof DocsBusyError) return "docs-busy";
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
  const config = await configOrRefuse(json);
  if (config === null) return;
  const release = await acquireDocsLock(config.docsDir);
  try {
    await archiveLocked(config, featureId, opts);
  } finally {
    await release();
  }
}
