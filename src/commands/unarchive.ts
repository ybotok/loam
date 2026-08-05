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
import type { Command } from "commander";
import { existsSync, lstatSync } from "node:fs";
import { readdir, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/json.js";
import { resolveInside, resolvePortableFileInside } from "../core/path-safety.js";
import { featuresDir as featuresRoot, resolveFeature } from "../core/repo.js";
import { sayRecovery } from "./archive.js";
import {
  acquireDocsLock,
  clearCommitIntent,
  DocsBusyError,
  InterruptedCommitError,
  message,
  planWrite,
  quietRm,
  recoverInterruptedCommit,
  rollbackError,
  rollbackStaged,
  sha256,
  stageWrites,
  swapStaged,
  writeCommitIntent,
  SNAPSHOT_DIR,
  SNAPSHOT_MANIFEST,
  SNAPSHOT_VERSION,
  type PlannedWrite,
  type SnapshotManifest,
} from "../core/staging.js";

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
class RestoreFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    msg: string,
  ) {
    super(msg);
  }
}

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

async function unarchiveLocked(
  docsDir: string,
  featureId: string,
  json: boolean,
  force: boolean,
): Promise<void> {
  // Same first move as archive, under the same lock: a commit killed between two
  // renames is exactly the state an undo must not be computed on top of.
  const recovered = await recoverInterruptedCommit(docsDir);
  if (recovered !== null && !json) sayRecovery(recovered);

  const featuresDir = featuresRoot(docsDir);
  const archiveDir = join(featuresDir, "archive");

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
interface ValidatedSnapshotEntry {
  path: string;
  existed: boolean;
  after: string;
  /** sha256 the pre-image beside the manifest must still have; null when archive created the destination. */
  before: string | null;
  /** Contained destination under the docs repo. */
  target: string;
  /** Contained pre-image, or null when archive created the destination. */
  snapshot: string | null;
}

interface ValidatedSnapshotManifest extends Omit<SnapshotManifest, "files"> {
  files: ValidatedSnapshotEntry[];
}

async function readManifest(
  featureDir: string,
  docsDir: string,
  featureId: string,
  dirName: string,
): Promise<ValidatedSnapshotManifest | null> {
  try {
    const path = resolveInside(
      featureDir,
      join(SNAPSHOT_DIR, SNAPSHOT_MANIFEST),
      "snapshot manifest path",
    );
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.version !== SNAPSHOT_VERSION) return null;
    if (parsed.feature !== featureId || parsed.dirName !== dirName) return null;
    if (typeof parsed.archivedAt !== "string" || !isCanonicalIsoDate(parsed.archivedAt)) return null;
    if (!Array.isArray(parsed.files)) return null;

    const seen = new Set<string>();
    const files: ValidatedSnapshotEntry[] = [];
    for (const raw of parsed.files) {
      if (!isRecord(raw)) return null;
      if (typeof raw.path !== "string" || typeof raw.existed !== "boolean") return null;
      if (typeof raw.after !== "string" || !/^[0-9a-f]{64}$/.test(raw.after)) return null;
      // A manifest that claims a pre-image must say what it should hash to, and
      // one that claims none must not. Either way it is a shape question, so it
      // is answered here with the rest of them; whether the bytes MATCH is a
      // different answer with its own code (`snapshot-corrupt`).
      if (raw.existed ? typeof raw.before !== "string" || !/^[0-9a-f]{64}$/.test(raw.before) : raw.before !== null) {
        return null;
      }
      const before = raw.existed ? (raw.before as string) : null;
      if (seen.has(raw.path)) return null;
      seen.add(raw.path);

      const target = resolvePortableFileInside(docsDir, raw.path, `snapshot path '${raw.path}'`);
      let snapshot: string | null = null;
      const snapshotRel = `${SNAPSHOT_DIR}/files/${raw.path}`;
      if (raw.existed) {
        // Resolve from the feature directory, which always exists. The `files/`
        // directory legitimately does not exist when every archive write was a
        // creation; anchoring here permits that case while still inspecting an
        // existing `files` component for symlink escape.
        snapshot = resolvePortableFileInside(featureDir, snapshotRel, `snapshot pre-image '${raw.path}'`);
        // Archive writes plain files. A missing pre-image or a symlink (even an
        // internally-contained one) is not the byte snapshot this manifest
        // claims, so refuse before any destination is staged.
        if (!existsSync(snapshot) || !lstatSync(snapshot).isFile()) return null;
      } else {
        const unexpected = resolvePortableFileInside(featureDir, snapshotRel, `snapshot pre-image '${raw.path}'`);
        if (existsSync(unexpected)) return null;
      }
      files.push({ path: raw.path, existed: raw.existed, after: raw.after, before, target, snapshot });
    }

    return {
      version: SNAPSHOT_VERSION,
      feature: featureId,
      dirName,
      archivedAt: parsed.archivedAt,
      files,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoDate(value: string): boolean {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

/** Remove `dir` and each empty ancestor, stopping short of `stopAt`. Best effort. */
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
