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
import { existsSync } from "node:fs";
import { readdir, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/json.js";
import { featuresDir as featuresRoot, resolveFeature } from "../core/repo.js";
import {
  message,
  quietRm,
  rollbackError,
  rollbackStaged,
  sha256,
  snapshotDir,
  stageWrites,
  swapStaged,
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
        const code = err instanceof RestoreFailure ? err.code : "restore-failed";
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
  const { docsDir } = config;
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

  const manifest = await readManifest(feature.dir);
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
  for (const entry of manifest.files) {
    const abs = join(docsDir, ...entry.path.split("/"));
    const current = existsSync(abs) ? await readFile(abs, "utf8") : null;
    if (current === null || sha256(current) !== entry.after) drifted.push(entry.path);
    const before = entry.existed
      ? await readFile(join(snapshotDir(feature.dir), "files", ...entry.path.split("/")), "utf8")
      : null;
    writes.push({ path: abs, content: before });
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
    await swapStaged(staged);
    await rename(feature.dir, dest);
  } catch (err) {
    // The code is a caller's answer to "can I trust the repo?": restore-failed
    // means yes (rolled back), rollback-incomplete means look at it by hand —
    // rollbackError's message lists the files that need one.
    const failures = await rollbackStaged(staged);
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
async function readManifest(featureDir: string): Promise<SnapshotManifest | null> {
  const path = join(snapshotDir(featureDir), SNAPSHOT_MANIFEST);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as SnapshotManifest;
    if (parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
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

