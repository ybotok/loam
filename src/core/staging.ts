/**
 * The commit machinery `archive` and `unarchive` share: stage every new file
 * version beside its target, swap the staged versions in, roll back what
 * already went in when a later step fails — plus the undo snapshot `archive`
 * writes and `unarchive` honours. Moved here verbatim from archive.ts once
 * unarchive became its second consumer; the MERGE computations stay with
 * archive, which is still their only caller.
 */
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, open, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { repoPath } from "./json.js";

/**
 * A planned file write — the merge is computed fully before anything touches
 * disk. `content: null` means "delete this file"; only `unarchive` plans those,
 * to take back a file the archive created.
 *
 * BYTES, not text. The whole write path — pre-image, staged content, snapshot,
 * the compare-and-set before each swap — moves Buffers, because a docs repo is
 * not guaranteed to hold text loam can decode: `Buffer.toString("utf8")` never
 * fails, it substitutes U+FFFD, so reading a file as a string and writing the
 * string back is a silent, permanent rewrite of every byte loam did not
 * understand. It reached the snapshot too, so `unarchive` restored the damage
 * and reported success. Text is now produced only where a PARSER needs it, by
 * `decodeUtf8`, which refuses instead of substituting.
 */
export interface PlannedWrite {
  path: string;
  /**
   * A `string` is accepted for the callers whose new version IS text they
   * composed from nothing (a re-pinned delta, a restamped spec) and is encoded
   * as UTF-8 once, at staging. A caller holding BYTES — anything derived from a
   * file loam read — must hand over the Buffer: the round trip through a string
   * is the corruption above.
   */
  content: string | Buffer | null;
  /** Create the target atomically without replacing a concurrently created file. */
  exclusive?: boolean;
}

/** The one place a planned write becomes bytes. */
function toBytes(content: string | Buffer | null): Buffer | null {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
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
export function planWrite(path: string, content: string | Buffer | null): PlannedWrite {
  if (content !== null && !existsSync(path)) return { path, content, exclusive: true };
  return { path, content };
}

/** A planned write with its new bytes parked next to the target, ready to swap in. */
export interface StagedWrite {
  write: PlannedWrite;
  /** What this write puts on disk — `write.content` encoded once. Null for a delete. */
  content: Buffer | null;
  /** Temp file holding the new bytes, in the target's OWN directory. Null for a delete. */
  tmp: string | null;
  /** The target's bytes before the swap; null when it did not exist. */
  before: Buffer | null;
  /**
   * Topmost directory this write had to create, if any — a rollback owes the repo
   * its directories back too. An empty `services/<svc>/` left standing is the
   * fleet claiming a service that was never merged.
   */
  createdDir: string | null;
  swapped: boolean;
}

/* ------------------------------------------------------------------ */
/* Bytes in, text only where a parser needs it                         */
/* ------------------------------------------------------------------ */

/**
 * A file loam must PARSE, whose bytes are not UTF-8.
 *
 * Commands map this to `merge-failed`: nothing was written, the file is named,
 * and re-saving it as UTF-8 makes the command work. The read-only migration
 * ingest already refuses non-UTF-8 input outright (openspec-inventory.ts) —
 * the destructive path has strictly more to lose, so it refuses the same way
 * rather than substituting U+FFFD and rewriting the file over the author.
 */
export class NotUtf8Error extends Error {
  override readonly name = "NotUtf8Error";

  constructor(readonly path: string) {
    super(
      `${path} is not valid UTF-8 — loam parses this file as text and writes it back, which would replace every ` +
        `undecodable byte with U+FFFD, in the living document AND in the undo snapshot. Nothing was written. ` +
        `Re-save it as UTF-8, then re-run.`,
    );
  }
}

/** Decode bytes a parser is about to be handed, or refuse naming the file. */
export function decodeUtf8(bytes: Buffer, path: string): string {
  if (!isUtf8(bytes)) throw new NotUtf8Error(path);
  return bytes.toString("utf8");
}

/** Read a file loam is going to parse. The only supported way to turn a docs file into a string. */
export async function readUtf8(path: string): Promise<string> {
  return decodeUtf8(await readFile(path), path);
}

/** Same bytes? Absence is its own value: a file that is gone is not a file that is empty. */
function sameBytes(a: Buffer | null, b: Buffer | null): boolean {
  return a === null || b === null ? a === b : a.equals(b);
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
async function atomicWrite(path: string, content: Buffer): Promise<void> {
  const tmp = tempPath(path, 0);
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/** A hidden sibling of `path`: same directory, so the rename never crosses a filesystem. */
function tempPath(path: string, n: number): string {
  return join(dirname(path), `.${basename(path)}.loam-${process.pid}-${n}-${Date.now()}.tmp`);
}

/** The shape `tempPath` writes — what a scan for leftovers of a killed run matches on. */
const TEMP_FILE_RE = /^\..*\.loam-\d+-\d+-\d+\.tmp$/;

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
/**
 * Bumped only when the layout changes in a way `unarchive` must refuse to guess
 * at. 2 added `before` — a version-1 snapshot records nothing about the bytes it
 * would RESTORE, so nothing can tell an intact pre-image from an edited one, and
 * "I put your docs back" over a silently altered pre-image is the one sentence
 * this command must never be able to say by accident.
 */
export const SNAPSHOT_VERSION = 2;

export interface SnapshotEntry {
  /** Docs-repo-relative path, forward slashes — the same spelling `--json` uses. */
  path: string;
  /** False when archive CREATED the file: restoring it means deleting it again. */
  existed: boolean;
  /** sha256 of what archive wrote, so unarchive can tell its own merge from later edits. */
  after: string;
  /**
   * sha256 of the pre-image beside this manifest — the bytes `unarchive` will
   * RESTORE. Null when archive created the file (there is no pre-image).
   *
   * `after` describes what archive wrote and is checked against the living docs;
   * nothing described the restore source at all, so a pre-image edited in the
   * archived feature directory — by a bad merge, a rebase, a stray editor — was
   * written back verbatim and every loam surface certified the result.
   */
  before: string | null;
}

/** A snapshot directory that must not be replaced, because it is the only copy of the true pre-images. */
export class SnapshotClobberError extends Error {
  override readonly name = "SnapshotClobberError";

  constructor(readonly dir: string, detail: string) {
    super(
      `${dir} already holds an undo snapshot that does NOT match the living docs (${detail}) — a previous archive of ` +
        `this feature wrote to the living docs and never took them back, and these are the only copies of what they ` +
        `said before. Overwriting them would make that merge permanent and unreportable. Run \`loam archive\` again ` +
        `after restoring the living docs from version control, or delete ${SNAPSHOT_DIR}/ if you know the merge never landed.`,
    );
  }
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

export function sha256(content: Buffer | string): string {
  return typeof content === "string"
    ? createHash("sha256").update(content, "utf8").digest("hex")
    : createHash("sha256").update(content).digest("hex");
}

export async function writeSnapshot(
  featureDir: string,
  docsDir: string,
  featureId: string,
  dirName: string,
  staged: StagedWrite[],
): Promise<void> {
  const dir = snapshotDir(featureDir);
  await assertSnapshotReplaceable(dir, docsDir);
  // A leftover from a rolled-back run would describe a merge that never happened.
  await quietRm(dir);

  const files: SnapshotEntry[] = [];
  for (const s of staged) {
    const rel = repoPath(docsDir, s.write.path);
    files.push({
      path: rel,
      existed: s.before !== null,
      after: sha256(s.content ?? Buffer.alloc(0)),
      before: s.before === null ? null : sha256(s.before),
    });
    if (s.before !== null) {
      const dest = join(dir, "files", rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, s.before);
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

/**
 * Refuse to replace a snapshot whose pre-images are still the only record of
 * what the living docs said.
 *
 * A snapshot in an ACTIVE feature directory means a previous archive of this
 * same feature wrote it — and since a clean rollback deletes it, finding one
 * means that run either died mid-commit or reported `rollback-incomplete`. If
 * its pre-images still match the living docs, nothing of that run landed and
 * the snapshot is stale bookkeeping. If they do not, the living docs carry
 * that run's writes, these files are the only way back, and the unconditional
 * clear turned a repairable half-merge into a permanent one — after which
 * `unarchive` restored the half-merged text and said the docs were back.
 */
async function assertSnapshotReplaceable(dir: string, docsDir: string): Promise<void> {
  const manifestPath = join(dir, SNAPSHOT_MANIFEST);
  // The manifest is written LAST, so a `files/` tree without one is a snapshot
  // whose run died before it could swap anything: it describes no merge.
  if (!existsSync(manifestPath)) return;
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new SnapshotClobberError(dir, `${SNAPSHOT_MANIFEST} cannot be read, so nothing can say whether it is stale`);
  }
  const parsed = manifest as Partial<SnapshotManifest>;
  if (parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.files)) {
    throw new SnapshotClobberError(dir, `it was written by a different loam and cannot be checked against the living docs`);
  }
  const landed: string[] = [];
  for (const entry of parsed.files) {
    if (typeof entry?.path !== "string") {
      throw new SnapshotClobberError(dir, `${SNAPSHOT_MANIFEST} is malformed, so nothing can say whether it is stale`);
    }
    const target = join(docsDir, ...entry.path.split("/"));
    const now = existsSync(target) ? sha256(await readFile(target)) : null;
    // `existed: false` means archive created the file, so "nothing landed"
    // means it is still absent.
    const untouched = entry.existed ? now === entry.before : now === null;
    if (!untouched) landed.push(entry.path);
  }
  if (landed.length > 0) throw new SnapshotClobberError(dir, `${landed.length} file(s) already carry that merge: ${landed.join(", ")}`);
}

/* ------------------------------------------------------------------ */
/* The commit intent record                                            */
/* ------------------------------------------------------------------ */

/**
 * The journal that makes an interrupted commit detectable.
 *
 * `swapStaged` is N renames, and only each ONE of them is atomic. A kill
 * between two of them leaves the living docs half-merged — and nothing could
 * see it: `doctor` and `status` called the repo healthy, `validate --all`
 * blamed the delta, and the next archive cleared the one snapshot that could
 * have repaired it. So the swap loop now runs inside a record written and
 * fsynced BEFORE the first rename and removed after the last step of the
 * commit: its mere presence says a commit was in flight, and its per-path
 * digests say, file by file, whether that file's rename landed.
 *
 * It is deliberately NOT a source of truth and never disagrees with the files:
 * every judgement it supports is made by re-reading the living bytes and
 * comparing digests, and every byte a repair writes comes from the snapshot
 * and is verified against the digest recorded before the crash. Outside the
 * commit window it does not exist.
 */
export const COMMIT_INTENT = ".loam-commit";
export const COMMIT_INTENT_VERSION = 1;

export interface CommitIntentFile {
  /** Docs-repo-relative path, forward slashes. */
  path: string;
  /** sha256 of the bytes before the swap; null when the swap creates the file. */
  before: string | null;
  /** sha256 of the bytes the swap writes; null when the swap deletes the file. */
  after: string | null;
}

export interface CommitIntent {
  version: number;
  /** Which command was committing — the sentence a human reads, not a branch. */
  command: "archive" | "unarchive";
  /**
   * The state a repair returns the docs to. `archive` undoes (its rollback path
   * would have restored the pre-images anyway); `unarchive` finishes (its target
   * bytes ARE the pre-images, and the merged text it was replacing is recorded
   * nowhere else).
   */
  restore: "before" | "after";
  pid: number;
  host: string;
  at: string;
  feature: string;
  /** Docs-repo-relative feature directory the commit's final move takes FROM. */
  moveFrom: string;
  /** …and TO. Both landed ⇒ every earlier step landed too. */
  moveTo: string;
  files: CommitIntentFile[];
}

/** An interrupted commit this loam must not silently write over. */
export class InterruptedCommitError extends Error {
  override readonly name = "InterruptedCommitError";
}

/** What `recoverInterruptedCommit` did, for the caller to print and put in `--json`. */
export interface CommitRecovery {
  command: "archive" | "unarchive";
  feature: string;
  /**
   * `completed` — every step but the record's own removal landed;
   * `consistent` — no file was left in the other state;
   * `repaired` — files were put back, byte for byte, from the snapshot.
   */
  outcome: "completed" | "consistent" | "repaired";
  /** Docs-repo-relative paths this recovery rewrote or removed. */
  repaired: string[];
}

/**
 * Write the intent record and get it onto the disk before the first swap.
 *
 * fsync, not just write: the point of the record is to survive the crash that
 * interrupts the commit, and a record still sitting in the page cache when the
 * machine dies describes nothing. The directory entry is fsynced too where the
 * platform allows opening a directory — without that the file's bytes can be
 * durable while its name is not.
 */
export async function writeCommitIntent(
  docsDir: string,
  spec: {
    command: CommitIntent["command"];
    restore: CommitIntent["restore"];
    feature: string;
    moveFrom: string;
    moveTo: string;
  },
  staged: StagedWrite[],
): Promise<void> {
  const intent: CommitIntent = {
    version: COMMIT_INTENT_VERSION,
    command: spec.command,
    restore: spec.restore,
    pid: process.pid,
    host: hostname(),
    at: new Date().toISOString(),
    feature: spec.feature,
    moveFrom: repoPath(docsDir, spec.moveFrom),
    moveTo: repoPath(docsDir, spec.moveTo),
    files: staged.map((s) => ({
      path: repoPath(docsDir, s.write.path),
      before: s.before === null ? null : sha256(s.before),
      after: s.content === null ? null : sha256(s.content),
    })),
  };
  const path = join(docsDir, COMMIT_INTENT);
  const handle = await open(path, "w");
  try {
    await handle.writeFile(JSON.stringify(intent, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const dir = await open(docsDir, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // Not every platform lets a directory be opened; the record's own bytes are
    // flushed either way, which is the part that carries the digests.
  }
}

/** The commit finished (or was rolled back): there is nothing left to recover from. */
export async function clearCommitIntent(docsDir: string): Promise<void> {
  await quietRm(join(docsDir, COMMIT_INTENT));
}

/** The intent record as written, or null when it is absent or unreadable. */
export async function readCommitIntent(docsDir: string): Promise<CommitIntent | null> {
  const path = join(docsDir, COMMIT_INTENT);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  const i = parsed as Partial<CommitIntent>;
  if (i === null || typeof i !== "object") return null;
  if (i.version !== COMMIT_INTENT_VERSION) return null;
  if (i.command !== "archive" && i.command !== "unarchive") return null;
  if (i.restore !== "before" && i.restore !== "after") return null;
  if (typeof i.feature !== "string" || typeof i.moveFrom !== "string" || typeof i.moveTo !== "string") return null;
  if (!Array.isArray(i.files)) return null;
  for (const f of i.files) {
    if (typeof f?.path !== "string") return null;
    if (!isDigestOrNull(f.before) || !isDigestOrNull(f.after)) return null;
  }
  return i as CommitIntent;
}

function isDigestOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
}

/**
 * Refuse or repair before this run reads anything. Returns null when there is
 * nothing to recover.
 *
 * Repair is only ever the bytes the interrupted run already had on disk: each
 * file still in the wrong state is rewritten from the snapshot pre-image and
 * only after that pre-image's own sha256 matches the digest the record captured
 * before the crash. A file in NEITHER state was written by somebody else since,
 * so this refuses and names it rather than choosing which of two truths to
 * destroy — the same doctrine `rollbackStaged` follows when it leaves a file as
 * found.
 */
export async function recoverInterruptedCommit(docsDir: string): Promise<CommitRecovery | null> {
  const path = join(docsDir, COMMIT_INTENT);
  if (!existsSync(path)) return null;
  const intent = await readCommitIntent(docsDir);
  if (intent === null) {
    throw new InterruptedCommitError(
      `${repoPath(docsDir, path)} records a commit this loam cannot read, so it cannot tell a half-merged docs repo ` +
        `from a healthy one. Check the living docs against version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }
  const moveFrom = join(docsDir, ...intent.moveFrom.split("/"));
  const moveTo = join(docsDir, ...intent.moveTo.split("/"));
  // The move is the commit's LAST step. If it landed, every swap before it did
  // too, and only the record's own removal was lost.
  if (existsSync(moveTo) && !existsSync(moveFrom)) {
    await finishRecovery(docsDir, intent);
    return { command: intent.command, feature: intent.feature, outcome: "completed", repaired: [] };
  }

  const target = (rel: string): string => join(docsDir, ...rel.split("/"));
  const wanted = (f: CommitIntentFile): string | null => (intent.restore === "before" ? f.before : f.after);
  const other = (f: CommitIntentFile): string | null => (intent.restore === "before" ? f.after : f.before);
  const pending: CommitIntentFile[] = [];
  const unknown: string[] = [];
  for (const f of intent.files) {
    const file = target(f.path);
    const now = existsSync(file) ? sha256(await readFile(file)) : null;
    if (now === wanted(f)) continue;
    if (now === other(f)) pending.push(f);
    else unknown.push(f.path);
  }
  if (unknown.length > 0) {
    throw new InterruptedCommitError(
      `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit (pid ${intent.pid} on ${intent.host}, ` +
        `${intent.at}) and ${unknown.length} of the file(s) it was writing now hold bytes that are neither what it ` +
        `found nor what it wrote — somebody edited them since: ${unknown.join(", ")}. loam will not choose between ` +
        `those two truths. Reconcile them against version control, delete ${COMMIT_INTENT}, then re-run.`,
    );
  }
  if (pending.length === 0) {
    await finishRecovery(docsDir, intent);
    return { command: intent.command, feature: intent.feature, outcome: "consistent", repaired: [] };
  }

  // The pre-images travel inside the feature directory, so they are at one of
  // the two ends of the move depending on how far the interrupted run got.
  const roots = [join(moveFrom, SNAPSHOT_DIR, "files"), join(moveTo, SNAPSHOT_DIR, "files")];
  const repaired: string[] = [];
  for (const f of pending) {
    const file = target(f.path);
    const want = wanted(f);
    if (want === null) {
      await rm(file, { force: true });
      await quietRmdir(dirname(file));
      repaired.push(f.path);
      continue;
    }
    const source = roots.map((r) => join(r, ...f.path.split("/"))).find((p) => existsSync(p));
    if (source === undefined) {
      throw new InterruptedCommitError(
        `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit and ${f.path} is half-written, but ` +
          `the pre-image that would repair it is gone. Restore ${f.path} from version control, delete ` +
          `${COMMIT_INTENT}, then re-run.`,
      );
    }
    const bytes = await readFile(source);
    if (sha256(bytes) !== want) {
      throw new InterruptedCommitError(
        `a \`loam ${intent.command} ${intent.feature}\` was interrupted mid-commit and ${f.path} is half-written, but ` +
          `the pre-image that would repair it no longer matches the digest recorded before the commit — it has been ` +
          `edited since. Restore ${f.path} from version control, delete ${COMMIT_INTENT}, then re-run.`,
      );
    }
    await atomicWrite(file, bytes);
    repaired.push(f.path);
  }
  await finishRecovery(docsDir, intent);
  return { command: intent.command, feature: intent.feature, outcome: "repaired", repaired };
}

/**
 * Drop the record, and the staged temp files the killed run could not remove.
 *
 * Scoped to that run's own pid and its own targets — the temp name carries both
 * — so a leftover belonging to anything else is left for `doctor` to name.
 * Without this a repair that put every byte back still left the docs repo
 * dirty, which is the one thing a caller checks to decide whether it worked.
 */
async function finishRecovery(docsDir: string, intent: CommitIntent): Promise<void> {
  const dirs = new Set(intent.files.map((f) => dirname(join(docsDir, ...f.path.split("/")))));
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!TEMP_FILE_RE.test(name) || !name.includes(`.loam-${intent.pid}-`)) continue;
      await quietRm(join(dir, name));
    }
  }
  await clearCommitIntent(docsDir);
}

/** Remove `dir` if it is empty. Best effort — a directory left standing is noise, not corruption. */
async function quietRmdir(dir: string): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // Not empty, or not ours.
  }
}

/* ------------------------------------------------------------------ */
/* What a killed writer leaves behind                                  */
/* ------------------------------------------------------------------ */

/**
 * Everything in a docs repo that only a write that did not finish can produce.
 *
 * Lives here rather than in `doctor` because these are staging's own artefacts
 * and their spellings are defined a few lines up: a detector that re-spelled
 * them would go stale the first time either changed. `doctor` grades what this
 * reports.
 */
export interface WritePathResidue {
  /** A held `.loam-lock`, and whether its holder is a process that no longer exists on this host. */
  lock: { path: string; holder: string; stale: boolean } | null;
  /** An interrupted commit's intent record — present means a commit was in flight when something killed it. */
  intent: CommitIntent | null;
  /** True when `.loam-commit` exists but cannot be parsed: the worst case, because nothing can grade it. */
  intentUnreadable: boolean;
  /** Docs-repo-relative paths of orphaned `.loam-*.tmp` staging files. */
  temps: string[];
}

export async function scanWritePathResidue(docsDir: string): Promise<WritePathResidue> {
  const lockPath = join(docsDir, DOCS_LOCK);
  let lock: WritePathResidue["lock"] = null;
  if (existsSync(lockPath)) {
    lock = { path: repoPath(docsDir, lockPath), holder: await describeLock(lockPath), stale: await lockIsStale(lockPath) };
  }
  const intent = await readCommitIntent(docsDir);
  return {
    lock,
    intent,
    intentUnreadable: intent === null && existsSync(join(docsDir, COMMIT_INTENT)),
    temps: (await tempLeftovers(docsDir)).map((p) => repoPath(docsDir, p)).sort(),
  };
}

/** Does the lock name a pid on THIS host that no longer exists? Read-only twin of breakStaleLock. */
async function lockIsStale(path: string): Promise<boolean> {
  let holder: { pid?: unknown; host?: unknown };
  try {
    holder = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; host?: unknown };
  } catch {
    return false;
  }
  if (holder.host !== hostname() || typeof holder.pid !== "number") return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function tempLeftovers(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // `.git` alone can hold more files than the whole docs repo, and nothing
    // loam writes ever lands in it.
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tempLeftovers(path)));
    else if (entry.isFile() && TEMP_FILE_RE.test(entry.name)) out.push(path);
  }
  return out;
}
