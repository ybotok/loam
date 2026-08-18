/**
 * The verification record's commit: staged beside the target, compared against
 * the byte pre-image the merge consumed, swapped in by one rename(2).
 *
 * The record used to go down as a plain `writeFile`, which cost three ways at
 * once: two `--record` runs read the same pre-image and the last writer
 * silently discarded the other service's attestation; a process killed
 * mid-write left the ONLY copy truncated, unreadable, and blocking every later
 * record; and an edit that landed between the read and the write was buried
 * under bytes computed from a document that no longer existed. The docs lock
 * (taken by `loam verify` before its authoritative read) closes the first;
 * this module closes the other two, and backstops the lock itself for a writer
 * that never took it.
 *
 * A sub-package of core/verify rather than a sixth file in it, and a consumer
 * of core/staging's primitives rather than a re-implementation: `stageWrites`
 * and `swapStaged` already do temp-beside-target, whole-content compare-and-set
 * and same-directory rename — vouch commits through exactly this shape.
 */
import { message, rollbackStaged, stageWrites, StagingRaceError, swapStaged } from "../../staging/commit.js";
import { type PlannedWrite } from "../../staging/writes.js";
import { renderVerification } from "../file.js";
import { verificationPath, type Verification } from "../record.js";

/**
 * `record-raced` re-runs cleanly: the merge is recomputed over whatever the
 * other writer left. The other two are staging's own vocabulary, with staging's
 * meanings — `merge-failed` trusts the repo, `rollback-incomplete` does not.
 */
export type VerificationCommit =
  | { ok: true; path: string }
  | { ok: false; code: "record-raced" | "merge-failed" | "rollback-incomplete"; message: string };

/**
 * `preImage` is the exact bytes the caller's merge was computed from, or null
 * when the record was absent at the authoritative read — in which case the
 * commit may only CREATE (link(2) refuses a file that appeared since), never
 * replace one it has not read.
 */
export async function commitVerification(
  featureDir: string,
  v: Verification,
  preImage: Buffer | null,
): Promise<VerificationCommit> {
  const path = verificationPath(featureDir);
  const write: PlannedWrite =
    preImage === null ? { path, content: renderVerification(v), exclusive: true } : { path, content: renderVerification(v) };
  const staged = await stageWrites([write]);
  const s = staged[0]!;
  // The compare the read promised: the file as staging found it must be the
  // file the merge consumed. `swapStaged` re-checks against ITS read just
  // before the rename, so together the two compares cover the whole window
  // from the authoritative read to the swap.
  const edited = preImage === null ? s.before !== null : s.before === null || !s.before.equals(preImage);
  if (edited) {
    await rollbackStaged(staged);
    return { ok: false, code: "record-raced", message: racedMessage(path) };
  }
  try {
    await swapStaged(staged);
  } catch (err) {
    const failures = await rollbackStaged(staged);
    if (failures.length > 0) {
      return {
        ok: false,
        code: "rollback-incomplete",
        message: `${message(err)} — ROLLBACK INCOMPLETE, ${failures.join(", ")} may be half-written and needs checking by hand`,
      };
    }
    // EEXIST is the exclusive create losing its race — same fact as the CAS
    // refusal, discovered by link(2) instead of by the compare.
    if (err instanceof StagingRaceError || (err as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, code: "record-raced", message: racedMessage(path) };
    }
    return { ok: false, code: "merge-failed", message: `${message(err)} — nothing was recorded; the record is as the last writer left it` };
  }
  return { ok: true, path };
}

function racedMessage(path: string): string {
  return (
    `${path} changed while this record was being written — another writer or an editor landed between the read and the write. ` +
    "Nothing was written and their bytes are untouched. Re-run: the merge is recomputed over the record as it now stands."
  );
}
