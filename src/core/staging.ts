/**
 * The commit machinery `archive` and `unarchive` share: stage every new file
 * version beside its target, swap the staged versions in, roll back what
 * already went in when a later step fails — plus the undo snapshot `archive`
 * writes and `unarchive` honours. Moved here verbatim from archive.ts once
 * unarchive became its second consumer; the MERGE computations stay with
 * archive, which is still their only caller.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { repoPath } from "./json.js";

/**
 * A planned file write — the merge is computed fully before anything touches
 * disk. `content: null` means "delete this file"; only `unarchive` plans those,
 * to take back a file the archive created.
 */
export interface PlannedWrite {
  path: string;
  content: string | null;
  /** Create the target atomically without replacing a concurrently created file. */
  exclusive?: boolean;
}

/**
 * The one place that decides whether a planned write is a CREATE.
 *
 * `exclusive` is a no-clobber create (link(2)), so it can only be asked of a
 * path that does not exist yet: asking it of an overwrite would fail EEXIST on
 * every single run. Deciding here — rather than at each of the dozen
 * `writes.push` sites in archive and unarchive — is what keeps the two commands
 * from disagreeing about which of their writes may safely lose a race. An
 * OVERWRITE is not left unguarded: `swapStaged` compares the target against the
 * pre-image immediately before the rename, so a file another writer changed
 * under us stops the commit instead of silently burying their bytes.
 */
export function planWrite(path: string, content: string | null): PlannedWrite {
  if (content !== null && !existsSync(path)) return { path, content, exclusive: true };
  return { path, content };
}

/** A planned write with its new bytes parked next to the target, ready to swap in. */
export interface StagedWrite {
  write: PlannedWrite;
  /** Temp file holding the new bytes, in the target's OWN directory. Null for a delete. */
  tmp: string | null;
  /** The target's bytes before the swap; null when it did not exist. */
  before: string | null;
  /**
   * Topmost directory this write had to create, if any — a rollback owes the repo
   * its directories back too. An empty `services/<svc>/` left standing is the
   * fleet claiming a service that was never merged.
   */
  createdDir: string | null;
  swapped: boolean;
}

/* ------------------------------------------------------------------ */
/* The docs-repo advisory lock                                         */
/* ------------------------------------------------------------------ */

/** The lock file, in the docs repo root — one writer at a time across the whole fleet. */
export const DOCS_LOCK = ".loam-lock";

/** Another writer holds the docs repo. Commands map this to the `docs-busy` envelope code. */
export class DocsBusyError extends Error {
  override readonly name = "DocsBusyError";

  constructor(
    readonly lockPath: string,
    holder: string,
  ) {
    super(
      `another loam command is writing this docs repo (${holder}) — nothing was read or written. ` +
        `Wait for it to finish, or remove ${lockPath} if no such command is running.`,
    );
  }
}

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
 * Take the docs repo's advisory lock for the whole plan+commit window, and
 * return the release.
 *
 * Advisory, and deliberately coarse: the destructive commands write the SAME
 * three shared files (a service spec, a service contract, the one landscape),
 * so two of them overlapping is not a merge to be resolved but a merge one of
 * them computed against a snapshot that no longer exists. Two archives used to
 * plan against the same landscape bytes and the second's splice silently
 * dropped the first's additions — exit 0 on both, and a `validate` that stayed
 * green because the surviving document was perfectly coherent.
 *
 * O_EXCL create is the primitive: it is atomic on every filesystem loam runs
 * on, needs no daemon, and leaves a file a human can read and delete. A holder
 * that died without releasing would otherwise wedge the repo forever, so a lock
 * naming a pid on THIS host that no longer exists is broken once and retried —
 * two racers could both break the same stale lock, which is why the pre-image
 * check in `swapStaged` remains the second line of defence rather than an
 * optimisation.
 */
export async function acquireDocsLock(docsDir: string): Promise<() => Promise<void>> {
  const path = join(docsDir, DOCS_LOCK);
  const payload = `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(path, payload, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (attempt === 0 && (await breakStaleLock(path))) continue;
      throw new DocsBusyError(path, await describeLock(path));
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await quietRm(path);
    };
  }
}

/** Remove a lock whose holder is a dead process on this same host. Returns whether it did. */
async function breakStaleLock(path: string): Promise<boolean> {
  let holder: { pid?: unknown; host?: unknown };
  try {
    holder = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; host?: unknown };
  } catch {
    // Unreadable or not ours to interpret — treat it as held. A lock file we
    // cannot understand is the one case where guessing is worst.
    return false;
  }
  if (holder.host !== hostname() || typeof holder.pid !== "number") return false;
  try {
    // Signal 0 asks "does this pid exist" without delivering anything. EPERM
    // means it exists and belongs to somebody else — alive either way.
    process.kill(holder.pid, 0);
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
  }
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function describeLock(path: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; host?: unknown; at?: unknown };
    return `pid ${String(raw.pid)} on ${String(raw.host)} since ${String(raw.at)}`;
  } catch {
    return `see ${path}`;
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
      const before = existsSync(write.path) ? await readFile(write.path, "utf8") : null;
      let tmp: string | null = null;
      if (write.content !== null) {
        tmp = tempPath(write.path, i);
        await writeFile(tmp, write.content, "utf8");
      }
      staged.push({ write, tmp, before, createdDir, swapped: false });
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
    const now = existsSync(s.write.path) ? await readFile(s.write.path, "utf8") : null;
    if (now !== s.before) throw new StagingRaceError(s.write.path);
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
      const now = existsSync(s.write.path) ? await readFile(s.write.path, "utf8") : null;
      if (now !== s.write.content) {
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
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = tempPath(path, 0);
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

/** A hidden sibling of `path`: same directory, so the rename never crosses a filesystem. */
function tempPath(path: string, n: number): string {
  return join(dirname(path), `.${basename(path)}.loam-${process.pid}-${n}-${Date.now()}.tmp`);
}

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

/** Say what the failure cost: nothing, or a repo that needs looking at by hand. */
export function rollbackError(err: unknown, failures: string[]): Error {
  if (failures.length === 0) {
    return new Error(`${message(err)} — the living docs were rolled back, nothing was merged`);
  }
  return new Error(
    `${message(err)} — ROLLBACK INCOMPLETE, these files may be half-merged and need checking by hand: ${failures.join(", ")}`,
  );
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* The undo snapshot                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where archive parks the bytes it is about to overwrite, inside the feature
 * directory so it travels with it into `features/archive/`.
 *
 * It exists because the merge is not invertible: a MODIFIED requirement's
 * previous text appears nowhere in the delta, and a landscape rewritten by hand
 * since cannot be un-rewritten by re-reading the delta either. `unarchive` puts
 * bytes back; it does not recompute them.
 */
export const SNAPSHOT_DIR = ".loam-before";
export const SNAPSHOT_MANIFEST = "manifest.json";
/** Bumped only when the layout changes in a way `unarchive` must refuse to guess at. */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotEntry {
  /** Docs-repo-relative path, forward slashes — the same spelling `--json` uses. */
  path: string;
  /** False when archive CREATED the file: restoring it means deleting it again. */
  existed: boolean;
  /** sha256 of what archive wrote, so unarchive can tell its own merge from later edits. */
  after: string;
}

export interface SnapshotManifest {
  version: number;
  feature: string;
  dirName: string;
  archivedAt: string;
  files: SnapshotEntry[];
}

export function snapshotDir(featureDir: string): string {
  return join(featureDir, SNAPSHOT_DIR);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function writeSnapshot(
  featureDir: string,
  docsDir: string,
  featureId: string,
  dirName: string,
  staged: StagedWrite[],
): Promise<void> {
  const dir = snapshotDir(featureDir);
  // A leftover from a rolled-back run would describe a merge that never happened.
  await quietRm(dir);

  const files: SnapshotEntry[] = [];
  for (const s of staged) {
    const rel = repoPath(docsDir, s.write.path);
    files.push({ path: rel, existed: s.before !== null, after: sha256(s.write.content ?? "") });
    if (s.before !== null) {
      const dest = join(dir, "files", rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, s.before, "utf8");
    }
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    feature: featureId,
    dirName,
    archivedAt: new Date().toISOString(),
    files,
  };
  // Manifest last: its presence is what says the pre-images beside it are complete.
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SNAPSHOT_MANIFEST), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
