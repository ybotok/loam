/**
 * The undo snapshot: the bytes `archive` is about to overwrite, parked inside
 * the feature directory so they travel with it into `features/archive/`.
 *
 * Separate from the commit because the merge is not invertible — a MODIFIED
 * requirement's previous text appears nowhere in the delta, and a landscape
 * rewritten by hand since cannot be un-rewritten by re-reading one. `unarchive`
 * puts bytes back; it does not recompute them. Nothing on the commit path reads
 * this module: only `archive` writes a snapshot and only `unarchive` honours one.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoPath } from "../envelope/json.js";
import { resolvePortableFileInsideLexically, UnsafePathError } from "../kernel/path-safety.js";
// Every `isRecord` below guards a record loam itself wrote and is reading back
// — the lock, the snapshot manifest — whose fields are asked for on the very
// next line, inside a REFUSAL path. `JSON.parse` answers with any JSON value,
// not with an object, and that is where a thrown `TypeError` costs the most: it
// does not make the command fail safely, it replaces a designed refusal with
// `internal`.
import { isRecord } from "../kernel/records.js";
import { isDigest, sha256, type StagedWrite } from "./writes.js";
import { message, quietRm } from "./commit.js";

/** Where archive parks the pre-images, inside the feature directory so they travel with it — the module doc above says why. */
export const SNAPSHOT_DIR = ".loam-before";
export const SNAPSHOT_MANIFEST = "manifest.json";
/**
 * Bumped only when the layout changes in a way `unarchive` must refuse to guess
 * at. 2 added `before`: a version-1 snapshot says nothing about the bytes it
 * would RESTORE, so an edited pre-image read back as an intact one. 3 re-keys
 * `services/` entries by `(service, artifact)`: a literal path pins the service
 * directory where it stood on the day of the archive, and once the subsystem
 * tree lets it move — re-cutting is expected to be routine — an undo addressed
 * by path restores into a location that is gone. The service id never moves.
 */
export const SNAPSHOT_VERSION = 3;
/**
 * Version 2 is still READ, forever: version-2 snapshots already sit inside
 * archived features, which carry them across loam upgrades, and each must keep
 * restoring — and keep being graded for staleness by a retried archive — under
 * its own literal-path rules. Only version 1 is refused (no restore digests).
 */
export const SNAPSHOT_COMPAT_VERSION = 2;

export interface SnapshotEntry {
  /**
   * Docs-repo-relative path, forward slashes, AS ARCHIVED. Load-bearing even
   * beside the key below: it names the pre-image under `.loam-before/files/`,
   * and it is the literal fallback when the id stops being enumerated.
   */
  path: string;
  /**
   * For a `services/` entry: the service id (the leaf directory name — the one
   * thing a re-cut never changes) and the artifact's path inside its directory,
   * resolved through the CURRENT enumeration at restore time. Absent on
   * landscape and `features/` entries, which do not move.
   */
  service?: string;
  artifact?: string;
  /** False when archive CREATED the file: restoring it means deleting it again. */
  existed: boolean;
  /** sha256 of what archive wrote, so unarchive can tell its own merge from later edits. */
  after: string;
  /**
   * sha256 of the pre-image beside this manifest — the bytes `unarchive` will
   * RESTORE. Null when archive created the file (there is no pre-image).
   * `after` only describes what archive wrote; while nothing described the
   * restore source, a pre-image edited in the archived feature directory — a
   * bad merge, a rebase, a stray editor — was written back verbatim and every
   * loam surface certified the result.
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

/** The (service, artifact) key a `services/` path decomposes into. */
export interface ServiceKey {
  service: string;
  artifact: string;
}

/**
 * Everything `writeSnapshot` needs, as one object. The resolvers are INJECTED
 * by the caller — `archive` builds them from its view of the tree — because
 * how a path decomposes into a service identity is repo-layout knowledge, and
 * this module's subject is parking and checking bytes.
 */
export interface SnapshotRequest {
  featureDir: string;
  docsDir: string;
  feature: { featureId: string; dirName: string };
  staged: StagedWrite[];
  /** Docs-relative path → the service it belongs to; null for landscape/features paths. */
  serviceKeyOf: (rel: string) => ServiceKey | null;
  /** Service id → its CURRENT docs-relative directory; null when not enumerated. */
  serviceDirOf: (service: string) => string | null;
}

export async function writeSnapshot(request: SnapshotRequest): Promise<void> {
  const { featureDir, docsDir, staged } = request;
  const { featureId, dirName } = request.feature;
  const dir = snapshotDir(featureDir);
  await assertSnapshotReplaceable(dir, docsDir, request.serviceDirOf);
  // A leftover from a rolled-back run would describe a merge that never happened.
  await quietRm(dir);

  const files: SnapshotEntry[] = [];
  for (const s of staged) {
    const rel = repoPath(docsDir, s.write.path);
    // services/ entries are re-keyed by (service, artifact) so they survive the
    // service directory moving between archive and unarchive; the literal path
    // is still recorded — it keys the pre-image below, and it is the fallback.
    const key = request.serviceKeyOf(rel);
    files.push({
      path: rel,
      ...key,
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
 *
 * Version 2 manifests are graded by the same staleness question over their
 * literal paths — refusing them as "a different loam" would turn every leftover
 * version-2 snapshot into a permanent archive refusal on upgrade.
 */
async function assertSnapshotReplaceable(
  dir: string,
  docsDir: string,
  serviceDirOf: (service: string) => string | null,
): Promise<void> {
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
  // The cast that used to stand here asserted the shape rather than checking
  // it: well-formed JSON that is not an object answered `undefined` to every
  // field below and slipped through as "a different loam", and a bare `null`
  // threw a TypeError out of the refusal itself. Both left this directory —
  // which may hold the only copies of what the living docs said — one step from
  // being replaced, without the staleness question ever having been asked.
  if (!isRecord(manifest)) {
    throw new SnapshotClobberError(dir, `${SNAPSHOT_MANIFEST} cannot be read, so nothing can say whether it is stale`);
  }
  if (
    (manifest.version !== SNAPSHOT_VERSION && manifest.version !== SNAPSHOT_COMPAT_VERSION) ||
    !Array.isArray(manifest.files)
  ) {
    throw new SnapshotClobberError(dir, `it was written by a different loam and cannot be checked against the living docs`);
  }
  // `Array.isArray` narrows to `any[]`; naming the element type here is what
  // keeps that `any` from spreading past the one row being read.
  const rows: unknown[] = manifest.files;
  const landed: string[] = [];
  for (const row of rows) {
    const entry = readSnapshotClaim(row);
    if (entry === null) {
      throw new SnapshotClobberError(dir, `${SNAPSHOT_MANIFEST} is malformed, so nothing can say whether it is stale`);
    }
    let target: string;
    try {
      // These paths are data, and they are the ones this function goes and
      // reads. They name living documents, so containment is lexical: a docs
      // repo may legitimately mount a service directory through a symlink, and
      // `unarchive` resolves the same field the same way before it writes back.
      target = resolvePortableFileInsideLexically(docsDir, entry.path, `snapshot path '${entry.path}'`);
      // A re-keyed entry's CURRENT location is wherever the enumeration says
      // its service lives today — grading staleness at the old address would
      // call a merely-moved file a landed merge. The literal path was still
      // resolved above on purpose: its containment is part of what "loam wrote
      // this manifest" means, and it stays the pre-image's key. An id the
      // enumeration no longer answers falls back to that literal path.
      if (entry.service !== undefined && entry.artifact !== undefined) {
        const current = serviceDirOf(entry.service);
        if (current !== null) {
          target = resolvePortableFileInsideLexically(
            docsDir,
            `${current}/${entry.artifact}`,
            `snapshot path '${entry.path}'`,
          );
        }
      }
    } catch (err) {
      if (!(err instanceof UnsafePathError)) throw err;
      throw new SnapshotClobberError(dir, `${message(err)}, so nothing can say whether it is stale`);
    }
    const now = existsSync(target) ? sha256(await readFile(target)) : null;
    // `existed: false` means archive created the file, so "nothing landed"
    // means it is still absent.
    const untouched = entry.existed ? now === entry.before : now === null;
    if (!untouched) landed.push(entry.path);
  }
  if (landed.length > 0) throw new SnapshotClobberError(dir, `${landed.length} file(s) already carry that merge: ${landed.join(", ")}`);
}

/**
 * One manifest row read back as the record `writeSnapshot` wrote, or null when
 * the file does not actually say.
 *
 * Every field the staleness question consumes is checked, because an unchecked
 * field does not read as missing here — it reads as an ANSWER. An `existed`
 * that is not a boolean is falsy, and a `false` claim is graded by asking
 * whether the file is ABSENT: a manifest recording a pre-image for a deleted
 * file therefore graded as stale bookkeeping and was cleared, taking the only
 * copy of that pre-image with it. A `before` of the wrong type equals no digest
 * at all, so the opposite row accused an untouched file of carrying a merge.
 *
 * `unarchive` asks a stricter version of the same question of the same file
 * (`after`, `archivedAt`, the feature name, no duplicates) because it is about
 * to write THROUGH it; that check stays where it is, with its own refusals.
 *
 * `service`/`artifact` are read when present (a version-3 `services/` row) and
 * must arrive as a pair: half a key is a manifest that does not say where the
 * file lives, and grading through the literal path anyway would be a guess.
 */
interface SnapshotClaim {
  path: string;
  existed: boolean;
  before: string | null;
  service?: string;
  artifact?: string;
}

function readSnapshotClaim(value: unknown): SnapshotClaim | null {
  if (!isRecord(value)) return null;
  const { path, existed, before, service, artifact } = value;
  if (typeof path !== "string" || typeof existed !== "boolean") return null;
  let key: { service: string; artifact: string } | Record<string, never>;
  if (service === undefined && artifact === undefined) key = {};
  else if (typeof service === "string" && typeof artifact === "string") key = { service, artifact };
  else return null;
  if (existed) return isDigest(before) ? { path, existed, before, ...key } : null;
  return before === null ? { path, existed, before, ...key } : null;
}

