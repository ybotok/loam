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
import { readFile, rename } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CodedFailure, emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { acrossRename, isPathInside } from "../../core/kernel/path-safety.js";
import { archiveDir as archiveRoot, featuresDir as featuresRoot } from "../../core/repo/paths.js";
import { listServices, resolveFeature } from "../../core/repo/repo.js";
import { docsRepoState } from "../../core/repo/state.js";
import { sayRecovery } from "../archive/plan/refusal.js";
import {
  quietPruneEmptyParents,
  quietRm,
  rollbackError,
  rollbackStaged,
  stageWrites,
  swapStaged,
} from "../../core/staging/commit.js";
import { clearCommitIntent, writeCommitIntent } from "../../core/staging/recovery/intent.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { SNAPSHOT_DIR } from "../../core/staging/snapshot/manifest.js";
import { planWrite, sha256, type PlannedWrite } from "../../core/staging/writes.js";
import { readManifest } from "./manifest.js";
import { generatedArchitectureDocuments, staleGeneratedViews } from "../../core/c4/project/architecture.js";
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

  // The restore-time half of the snapshot's (service, artifact) re-keying: a
  // keyed entry restores into wherever its service lives TODAY, and the
  // enumeration is the only thing that may say where that is. Built once here,
  // as a map, so the manifest validation stays a pure question of one file
  // against one repo state. "no-services" is tolerated the way `listFeatures`
  // tolerates it: a docs repo whose `services/` is gone still restores by the
  // literal paths (every id resolves to null), and it is `doctor`'s job to say
  // the directory is missing — refusing the undo here would add a second,
  // contradictory diagnosis.
  const enumerated = docsRepoState(docsDir).kind === "ok" ? await listServices(docsDir) : [];
  const serviceDirs = new Map<string, string>(enumerated.map((s) => [s.id, repoPath(docsDir, s.dir)]));
  const manifest = await readManifest({
    featureDir: feature.dir,
    docsDir,
    featureId: feature.id,
    dirName: feature.dirName,
    serviceDirOf: (service: string): string | null => serviceDirs.get(service) ?? null,
  });
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
  // Rows written into ANOTHER change in flight — a document whose links into
  // this feature the archive rewrote — whose feature directory is gone. That
  // feature has a lifecycle of its own: archived since, it is history with its
  // own snapshot; removed, it was abandoned. Putting the pre-image back would
  // recreate a one-file `features/<other>/` that every reader then lists as a
  // change in flight, beside the archived one or in place of the one somebody
  // deleted — and calling the row drift would send the reader to `--force`,
  // which does exactly that. Nothing edited it: it is left as it is, and said.
  const left: string[] = [];
  // The generated views files an archive wrote since it began regenerating them
  // in its own commit (`../archive/views.ts`). They are DERIVED, never authored:
  // one a later writer regenerated — a subsystem verb, another archive, a sync —
  // is not "a later change" whose loss `--force` should be asked to accept, and
  // its pre-image is no truer than its current bytes. So a drifted one is
  // stepped over rather than restored or refused, and the post-commit grade
  // below names it if the restored map leaves it stale. One untouched since the
  // archive is restored like any other file, which is the exact undo.
  const generated = new Set(generatedArchitectureDocuments(docsDir).map((path) => resolve(path)));
  const regenerated: string[] = [];
  for (const entry of manifest.files) {
    const owner = inFlightFeatureDir(featuresDir, archiveDir, entry.target);
    if (owner !== null && owner !== dest && !existsSync(owner)) {
      left.push(entry.path);
      continue;
    }
    const current = existsSync(entry.target) ? await readFile(entry.target) : null;
    const now = current === null ? null : sha256(current);
    // Drift is "restoring this would destroy something", so a file already
    // holding its OWN pre-image is not drifted — putting it back writes the
    // same bytes. It is also the state an interrupted restore leaves behind
    // (the repair finishes the swaps it can, then this command re-runs): the
    // narrower test used to call every repaired file a later change and demand
    // `--force` to discard this command's own half-finished undo.
    const restored = entry.existed ? now === entry.before : now === null;
    // What archive LEFT: the bytes it wrote, or — for a file it deleted — no
    // file at all. Read as bytes, a delete's empty-digest `after` matched
    // nothing on disk, and every retired flow was reported as edited since.
    const asArchived = entry.removed ? now === null : now === entry.after;
    if (!asArchived && !restored && generated.has(resolve(entry.target))) {
      regenerated.push(entry.path);
      continue;
    }
    if (!asArchived && !restored) drifted.push(entry.path);
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
    throw new CodedFailure(failures.length > 0 ? "rollback-incomplete" : "restore-failed", wrapped.message);
  }

  // The snapshot describes an archive that no longer exists; the empty directories
  // are what the merge left behind. Both are tidying — neither can fail the undo.
  await quietRm(join(dest, SNAPSHOT_DIR));
  for (const w of writes) if (w.content === null) await pruneBelowRoot(docsDir, dirname(w.path));
  await pruneBelowRoot(docsDir, archiveDir);

  // Named where each file IS now: the feature's own documents were restored
  // inside the archived directory and the rename just carried them out of it,
  // so their write paths name a directory that no longer exists.
  const landed = (path: string): string => repoPath(docsDir, acrossRename(path, feature.dir, dest));
  const restored = writes.filter((w) => w.content !== null).map((w) => landed(w.path));
  const removed = writes.filter((w) => w.content === null).map((w) => landed(w.path));
  // The undo puts back what the archive WROTE. An archive made by 0.2.0-alpha.16
  // or earlier never wrote the two generated views files — a sync run between
  // that archive and this undo rewrote them against the merged map — and a
  // views file a later writer regenerated is stepped over above, never
  // restored. Either way the map can just have gone back while a views file did
  // not — the services overview naming a service the map no longer draws — and
  // "the living docs are back" would be said over a repo whose next
  // `validate --all` is red. Graded after the commit through validate's own
  // function, as archive grades its own result.
  const staleViews = await staleGeneratedViews(docsDir);

  if (json) {
    emitJson({
      command: "unarchive",
      feature: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, dest),
      restored,
      removed,
      // Docs-relative as the manifest spells them, then named where they landed —
      // the same file must not answer to two names across `discarded` and
      // `restored`. The refusal and the `--force` warning above print the
      // pre-move name, because they are said before the move.
      discarded: drifted.map((rel) => landed(join(docsDir, ...rel.split("/")))),
      // Additive, and omitted when nothing is stale — `archive --json`'s key, same meaning.
      ...(staleViews.length === 0 ? {} : { staleViews }),
      ...(recovered === null ? {} : { recovered }),
    });
    return;
  }
  for (const p of restored) console.log(`  restored: ${p}`);
  for (const p of removed) console.log(`  removed:  ${p}`);
  for (const p of left) console.log(`  left:     ${p} — its feature is no longer in flight, so its pre-archive text is not put back`);
  for (const p of regenerated) console.log(`  left:     ${p} — regenerated since the archive; a generated file is re-derived, never restored`);
  console.log(`\n  reopened: features/archive/${feature.dirName} → features/${feature.dirName}`);
  if (staleViews.length === 0) {
    console.log("  the living docs are back to what they said before the archive.");
    return;
  }
  // The narrower claim, true whether the views went stale after the archive or
  // were stale before it — the closing line is a claim about the whole docs
  // repo, and `archive` withholds its own for the same files.
  console.log("  the documents the archive wrote are back to what they said before it.");
  for (const path of staleViews) {
    console.log(`  ⚠ ${path} no longer matches the tree and this map — run \`loam subsystem sync\`.`);
  }
}

/**
 * The in-flight feature directory a row's target sits in — `features/<dir>/`
 * for a file below it, never under `features/archive/` — or null for a row
 * anywhere else. The caller tells this feature's own destination apart.
 *
 * `--json` has no key for the rows the caller leaves: the payload's lists name
 * files the undo wrote, and these it deliberately did not touch. The text
 * output says each one.
 */
function inFlightFeatureDir(featuresDir: string, archiveDir: string, target: string): string | null {
  if (!isPathInside(featuresDir, target) || isPathInside(archiveDir, target)) return null;
  const [dir, ...below] = relative(featuresDir, target).split(sep);
  return dir === undefined || below.length === 0 ? null : join(featuresDir, dir);
}

/**
 * Remove the empty directories from `dir` upward, stopping BELOW the docs root:
 * never the root itself, nor anything outside it. The walk is staging's own,
 * bounded at the top-level directory `dir` sits in.
 */
async function pruneBelowRoot(docsDir: string, dir: string): Promise<void> {
  const top = relative(docsDir, dir).split(sep)[0] ?? "";
  if (top === "" || top.startsWith("..")) return;
  await quietPruneEmptyParents(dir, join(docsDir, top));
}
