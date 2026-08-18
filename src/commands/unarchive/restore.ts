/**
 * Putting the docs back: read the snapshot, verify every pre-image, then write.
 *
 * The whole restore runs under the docs lock, and the verification is the point
 * of the split — `unarchive` says "I put your docs back", and that sentence must
 * never be sayable over a pre-image that was edited in the archived feature
 * directory since. Each entry carries both the digest of what archive WROTE and
 * the digest of what it will RESTORE, and a mismatch on either refuses.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { archiveDir as archiveRoot, featuresDir as featuresRoot } from "../../core/repo/paths.js";
import { resolveFeature } from "../../core/repo/repo.js";
import { sayRecovery } from "../archive/plan/refusal.js";
import {
  quietRm,
  rollbackError,
  rollbackStaged,
  stageWrites,
  swapStaged,
} from "../../core/staging/commit.js";
import { clearCommitIntent, writeCommitIntent } from "../../core/staging/recovery/intent.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { SNAPSHOT_DIR } from "../../core/staging/snapshot.js";
import { planWrite, sha256, type PlannedWrite } from "../../core/staging/writes.js";
import { readManifest, RestoreFailure } from "./manifest.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

export async function unarchiveLocked(
  docsDir: DocsDir,
  featureId: string,
  json: boolean,
  force: boolean,
): Promise<void> {
  // Same first move as archive, under the same lock: a commit killed between two
  // renames is exactly the state an undo must not be computed on top of.
  const recovered = await recoverInterruptedCommit(docsDir);
  if (recovered !== null && !json) sayRecovery(recovered);

  const featuresDir = featuresRoot(docsDir);
  const archiveDir = archiveRoot(docsDir);

  const feature = await resolveFeature(docsDir, featureId, "only");
  if (!feature) {
    fail(json, "unknown-target", `No archived feature '${featureId}' under ${archiveDir}.`);
    return;
  }
  const dest = join(featuresDir, feature.dirName);

  // Refuse to clobber. A feature that is active again carries its own delta, and
  // dropping the archived copy on top of it would bury work in flight. Resolved
  // by the feature's OWN id, not the raw argument — the collision is with
  // whatever answers to this feature's name, however the caller spelled it.
  const active = await resolveFeature(docsDir, feature.id, "exclude");
  if (active !== null || existsSync(dest)) {
    const name = active?.dirName ?? feature.dirName;
    fail(
      json,
      "feature-active",
      `unarchive ${feature.id} — BLOCKED: features/${name} already exists. Remove or rename it, then re-run.`,
    );
    return;
  }

  const manifest = await readManifest(feature.dir, docsDir, feature.id, feature.dirName);
  if (manifest === null) {
    fail(
      json,
      "snapshot-missing",
      `unarchive ${feature.id} — BLOCKED: features/archive/${feature.dirName}/${SNAPSHOT_DIR}/ is missing or was written by a different loam. ` +
        `It was archived before loam recorded what it overwrote, and the previous text of a MODIFIED requirement exists nowhere else — ` +
        `restore the living docs from version control instead.`,
    );
    return;
  }

  // What archive wrote is recorded, so a file edited since can be told from one
  // this archive is still the top of. Restoring over a later change is silent data
  // loss, so it takes --force to say it was meant.
  const writes: PlannedWrite[] = [];
  const drifted: string[] = [];
  // Pre-images whose bytes are not the bytes archive wrote down. Collected
  // whole, then refused together: "which files" is what makes the message
  // actionable, and no destination is staged until every one is accounted for.
  const corrupt: string[] = [];
  for (const entry of manifest.files) {
    const current = existsSync(entry.target) ? await readFile(entry.target) : null;
    const now = current === null ? null : sha256(current);
    // Drift is "restoring this would destroy something", so a file already
    // holding its OWN pre-image is not drifted — putting it back writes the
    // same bytes. It is also the state an interrupted restore leaves behind
    // (the repair finishes the swaps it can, then this command re-runs): the
    // narrower test used to call every repaired file a later change and demand
    // `--force` to discard this command's own half-finished undo.
    const restored = entry.existed ? now === entry.before : now === null;
    if (now !== entry.after && !restored) drifted.push(entry.path);
    let before: Buffer | null = null;
    if (entry.snapshot !== null) {
      before = await readFile(entry.snapshot);
      // The one check that was missing entirely. `after` describes what archive
      // WROTE and is checked above; nothing described the bytes it would
      // RESTORE, so a pre-image edited inside the archived feature — a bad
      // merge, a rebase, an editor — was written back verbatim and this command
      // said "the living docs are back to what they said before the archive"
      // over text nobody ever wrote.
      if (sha256(before) !== entry.before) corrupt.push(entry.path);
    }
    // A restore whose destination is GONE is a create, and takes the same
    // no-clobber swap an archive's creates take: between the manifest read and
    // the swap, another writer may have put that path back, and a rename would
    // bury it. The same helper both commands use, so neither can decide
    // differently about the same file.
    writes.push(planWrite(entry.target, before));
  }
  if (corrupt.length > 0) {
    fail(
      json,
      "snapshot-corrupt",
      `unarchive ${feature.id} — BLOCKED: ${corrupt.length} snapshot pre-image(s) no longer match the digest archive ` +
        `recorded for them, so restoring them would write text nobody authored: ${corrupt.join(", ")}. ` +
        `--force does not override this — it discards LATER changes to the living docs, and the damage here is to the ` +
        `undo itself. Restore the living docs from version control instead.`,
    );
    return;
  }
  if (drifted.length > 0 && !force) {
    fail(
      json,
      "snapshot-stale",
      `unarchive ${feature.id} — BLOCKED: ${drifted.length} file(s) changed since the archive, so this is no longer an undo: ` +
        `${drifted.join(", ")}. Re-run with --force to restore anyway, discarding those changes.`,
    );
    return;
  }

  if (!json) {
    console.log(`unarchive ${feature.id}\n`);
    if (drifted.length > 0) {
      console.log(`⚠ discarding later changes to ${drifted.length} file(s) (--force):`);
      for (const p of drifted) console.log(`  ⚠ ${p}`);
      console.log("");
    }
  }

  const staged = await stageWrites(writes);
  try {
    // The same journal archive writes, in the other direction: a restore killed
    // between two renames leaves the docs half-back, and the merged text it was
    // replacing is recorded nowhere — so a repair FINISHES this restore rather
    // than undoing it, from the same digest-checked pre-images.
    await writeCommitIntent(
      docsDir,
      { command: "unarchive", restore: "after", feature: feature.id, moveFrom: feature.dir, moveTo: dest },
      staged,
    );
    await swapStaged(staged);
    await rename(feature.dir, dest);
    await clearCommitIntent(docsDir);
  } catch (err) {
    // The code is a caller's answer to "can I trust the repo?": restore-failed
    // means yes (rolled back), rollback-incomplete means look at it by hand —
    // rollbackError's message lists the files that need one.
    const failures = await rollbackStaged(staged);
    await clearCommitIntent(docsDir);
    const wrapped = rollbackError(err, failures);
    throw new RestoreFailure(failures.length > 0 ? "rollback-incomplete" : "restore-failed", wrapped.message);
  }

  // The snapshot describes an archive that no longer exists; the empty directories
  // are what the merge left behind. Both are tidying — neither can fail the undo.
  await quietRm(join(dest, SNAPSHOT_DIR));
  for (const w of writes) if (w.content === null) await pruneEmptyDirs(dirname(w.path), docsDir);
  await pruneEmptyDirs(archiveDir, docsDir);

  const restored = writes.filter((w) => w.content !== null).map((w) => repoPath(docsDir, w.path));
  const removed = writes.filter((w) => w.content === null).map((w) => repoPath(docsDir, w.path));

  if (json) {
    emitJson({
      feature: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, dest),
      restored,
      removed,
      discarded: drifted,
      ...(recovered === null ? {} : { recovered }),
    });
    return;
  }
  for (const p of restored) console.log(`  restored: ${p}`);
  for (const p of removed) console.log(`  removed:  ${p}`);
  console.log(`\n  reopened: features/archive/${feature.dirName} → features/${feature.dirName}`);
  console.log("  the living docs are back to what they said before the archive.");
}

/**
 * The snapshot manifest, or null when there is nothing this command can honour —
 * absent, unreadable, or a layout version it would have to guess at. All three are
 * the same answer to the caller: this feature cannot be unarchived automatically.
 */

async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let cur = dir;
  for (;;) {
    const rel = relative(stopAt, cur);
    if (rel === "" || rel.startsWith("..")) return;
    try {
      if ((await readdir(cur)).length > 0) return;
      await rmdir(cur);
    } catch {
      return;
    }
    cur = dirname(cur);
  }
}
