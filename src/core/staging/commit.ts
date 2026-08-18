/**
 * The commit itself, in three steps: stage every new version beside its
 * target, swap them in, roll back what already went in when a later step fails.
 *
 * This is what `archive` and `unarchive` share, and it moved out of archive.ts
 * verbatim once unarchive became its second consumer. The MERGE computations
 * stayed with archive, which is still their only caller — the split was about a
 * second CONSUMER, never about archive being long.
 *
 * `StagingRaceError` belongs here rather than with the lock, though both are
 * about a second writer: the lock is taken before a plan is computed, while
 * this is the compare-and-set immediately before each rename — the second line
 * of defence for exactly the window two racers who both broke the same stale
 * lock would land in.
 */
import { existsSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sameBytes, toBytes, type PlannedWrite, type StagedWrite } from "./writes.js";

/**
 * The target changed between the pre-image staging read and the swap.
 *
 * The pre-image is what a rollback restores and what `unarchive` is handed, so
 * swapping over somebody else's newer bytes would both lose their work and
 * arm a rollback that writes a third version nobody wrote. Commands map this to
 * `merge-failed`: nothing of theirs went in, the docs are as the other writer
 * left them, and re-running can work.
 */
export class StagingRaceError extends Error {
  override readonly name = "StagingRaceError";

  constructor(readonly path: string) {
    super(`${path} changed while this command was planning its merge — nothing was written; re-run`);
  }
}

/**
 * Write every new version to a temp file beside its target, remembering what the
 * target said first. Nothing observable changes here: on failure the temp files
 * are removed and the docs are exactly as they were.
 *
 * The pre-image is read eagerly and deliberately: it is what a rollback restores
 * and what `unarchive` is given, so a file we cannot read is a file we cannot
 * safely rewrite, and the merge must stop before it starts.
 */
export async function stageWrites(writes: PlannedWrite[]): Promise<StagedWrite[]> {
  const staged: StagedWrite[] = [];
  try {
    for (const [i, write] of writes.entries()) {
      // mkdir(recursive) reports the topmost directory it had to create — the
      // handle a rollback needs to put the tree back the way it found it.
      const createdDir = (await mkdir(dirname(write.path), { recursive: true })) ?? null;
      const before = existsSync(write.path) ? await readFile(write.path) : null;
      const content = toBytes(write.content);
      let tmp: string | null = null;
      if (content !== null) {
        tmp = tempPath(write.path, i);
        await writeFile(tmp, content);
      }
      staged.push({ write, content, tmp, before, createdDir, swapped: false });
    }
  } catch (err) {
    await discardStaged(staged);
    throw err;
  }
  return staged;
}

/**
 * Swap the staged versions in, one file at a time. Each swap is a rename(2)
 * within a single directory, so a concurrent reader sees either the old bytes or
 * the new ones — never a half-written file. Across files it is not atomic: the
 * caller rolls back what has already gone in.
 *
 * Every swap re-reads its target first and compares it with the pre-image the
 * plan was computed from — a compare-and-set on the file's whole content. It is
 * half a CAS on purpose: read and rename cannot be one syscall, so a writer
 * landing inside that window still wins. What it does buy is the window that
 * actually matters — the seconds a plan spends parsing LikeC4 and merging YAML
 * between the pre-image read and this swap — and it costs one read per file.
 */
export async function swapStaged(staged: StagedWrite[]): Promise<void> {
  for (const s of staged) {
    const now = existsSync(s.write.path) ? await readFile(s.write.path) : null;
    if (!sameBytes(now, s.before)) throw new StagingRaceError(s.write.path);
    if (s.tmp === null) {
      if (s.before !== null) await unlink(s.write.path);
    } else if (s.write.exclusive === true) {
      // link(2) is the same-filesystem, atomic no-clobber counterpart to rename:
      // it fails with EEXIST instead of replacing a file created after planning.
      await link(s.tmp, s.write.path);
      s.swapped = true;
      await unlink(s.tmp);
      s.tmp = null;
      continue;
    } else {
      await rename(s.tmp, s.write.path);
    }
    s.swapped = true;
  }
}

/**
 * Put back every file that was already swapped, newest first, from the bytes read
 * before the swap. Returns the paths it could NOT restore — the caller must say so
 * out loud rather than report a clean failure over a half-merged repo.
 *
 * A rollback only ever un-does ITS OWN write: if the file no longer holds the
 * bytes this run put there, somebody else has written it since, and restoring
 * the pre-image would destroy their work while reporting a clean failure. That
 * file is left exactly as found and named in the failures, which is what turns
 * the caller's answer from `merge-failed` ("trust the repo") into
 * `rollback-incomplete` ("look at it by hand") — the honest answer, because the
 * repo now holds one run's writes half-reverted next to another's.
 */
export async function rollbackStaged(staged: StagedWrite[]): Promise<string[]> {
  const failures: string[] = [];
  for (const s of [...staged].reverse()) {
    if (!s.swapped) continue;
    try {
      const now = existsSync(s.write.path) ? await readFile(s.write.path) : null;
      if (!sameBytes(now, s.content)) {
        failures.push(`${s.write.path} (changed by another writer after this run wrote it — left as found)`);
        continue;
      }
      if (s.before === null) await rm(s.write.path, { force: true });
      else await atomicWrite(s.write.path, s.before);
      s.swapped = false;
    } catch (err) {
      failures.push(`${s.write.path} (${message(err)})`);
    }
  }
  await discardStaged(staged);
  return failures;
}

/** Write `content` to `path` through a temp file in the same directory. */
export async function atomicWrite(path: string, content: Buffer): Promise<void> {
  const tmp = tempPath(path, 0);
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/** A hidden sibling of `path`: same directory, so the rename never crosses a filesystem. */
export function tempPath(path: string, n: number): string {
  return join(dirname(path), `.${basename(path)}.loam-${process.pid}-${n}-${Date.now()}.tmp`);
}

/** The shape `tempPath` writes — what a scan for leftovers of a killed run matches on. */
export const TEMP_FILE_RE = /^\..*\.loam-\d+-\d+-\d+\.tmp$/;

/**
 * Everything staging left on disk: the temp files, and the directories it made
 * for them.
 *
 * Directories go by rmdir, never by recursive remove, and the walk stops the
 * moment one is not empty. The recursive form used to be reached for because
 * "we created this directory, so it is ours" — but a directory created at plan
 * time is shared by the time the rollback runs: a second archive can have put a
 * whole feature inside `features/archive/` in between, and `rm -r` on our own
 * created root took their work with it, silently, on OUR failure path.
 */
async function discardStaged(staged: StagedWrite[]): Promise<void> {
  for (const s of staged) if (s.tmp !== null) await quietRm(s.tmp);
  const roots = staged.filter((s) => s.createdDir !== null).map((s) => resolve(s.createdDir!));
  for (const s of [...staged].reverse()) {
    const root = roots.find((candidate) => contains(candidate, s.write.path));
    if (root !== undefined) await quietPruneEmptyParents(dirname(s.write.path), root);
  }
}

function contains(parent: string, candidate: string): boolean {
  const rel = relative(parent, resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Undo the directories a write had to create, from `start` up to and including
 * `boundary`. Remove only directories that are still EMPTY: anything else in
 * there arrived after we made it, and belongs to whoever put it there.
 */
/** Remove `dir` if it is empty. Best effort — a directory left standing is noise, not corruption. */
export async function quietRmdir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // Not empty, or not ours.
  }
}

export async function quietPruneEmptyParents(start: string, boundary: string): Promise<void> {
  let cursor = resolve(start);
  const root = resolve(boundary);
  while (contains(root, cursor)) {
    try {
      await rmdir(cursor);
    } catch {
      return;
    }
    if (cursor === root) return;
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

export async function quietRm(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Best effort — a leftover temp file is noise, not corruption.
  }
}

/**
 * The one spelling of the sentence a rollback failure prints, parameterised
 * only by the verb for what the files were mid-way through becoming. It
 * existed in three near-copies (archive's "half-merged", vouch's
 * "half-stamped", verify's "half-written") — the exact shape whose fix lands
 * in one copy while an operator greps their logs for another.
 */
export function rollbackMessage(err: unknown, failures: string[], what: string): string {
  return `${message(err)} — ROLLBACK INCOMPLETE, these files may be half-${what} and need checking by hand: ${failures.join(", ")}`;
}

/** Say what the failure cost: nothing, or a repo that needs looking at by hand. */
export function rollbackError(err: unknown, failures: string[]): Error {
  if (failures.length === 0) {
    return new Error(`${message(err)} — the living docs were rolled back, nothing was merged`);
  }
  return new Error(
    rollbackMessage(err, failures, "merged"),
  );
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

