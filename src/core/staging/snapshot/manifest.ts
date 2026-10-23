/**
 * Where the undo snapshot lives and what its manifest says — the half of
 * `./snapshot.ts` a command can know without being able to take a snapshot.
 *
 * Split from that module when the snapshot became a package of its own: taking
 * a snapshot (and refusing to clobber one) is a commit, and the MCP server's
 * read-only claim is DERIVED from the import graph — a served command whose
 * imports reach `./snapshot.ts` is, by that test, a command that can commit.
 * The layout below is pure naming and shape, and the readers that only need
 * to find a snapshot, or read what one recorded, import it from here.
 */
import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePortableFileInsideLexically } from "../../kernel/path-safety.js";
import { isRecord } from "../../kernel/records.js";
import { sha256 } from "../writes.js";

/** Where archive parks the pre-images, inside the feature directory so they travel with it — `./snapshot.ts`'s module doc says why. */
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
 * 4 stores each pre-image under its own name PLUS {@link PRE_IMAGE_SUFFIX}: a
 * pre-image kept under its living name is a second copy of a living document
 * that every tool reading by extension takes for one. The snapshot of a
 * landscape is a `.likec4` inside the archived feature, so a feature with its
 * own `likec4.config.json` — or rendered alone, `likec4 start
 * features/archive/<FEAT>`, as the brief recommends — loaded the map twice
 * beside the delta and failed on duplicate elements, and a fleet project that
 * did not exclude `features/` failed the same way.
 */
export const SNAPSHOT_VERSION = 4;
/**
 * Version 2 is still READ, forever: version-2 snapshots already sit inside
 * archived features, which carry them across loam upgrades, and each must keep
 * restoring — and keep being graded for staleness by a retried archive — under
 * its own literal-path rules. Only version 1 is refused (no restore digests).
 */
export const SNAPSHOT_COMPAT_VERSION = 2;
/**
 * Version 3 is read forever for the same reason, under its own rules: rows
 * keyed by `(service, artifact)` like version 4's, pre-images stored under
 * their living names. A version-3 snapshot keeps its layout — it is restored
 * from where it was written, never migrated, because rewriting a snapshot is
 * rewriting the only copy of what the living docs once said.
 */
const SNAPSHOT_KEYED_VERSION = 3;
/** Appended to every pre-image a version-4 snapshot stores; see {@link SNAPSHOT_VERSION}. */
export const PRE_IMAGE_SUFFIX = ".before";

/**
 * The layouts this loam reads, by LITERAL — never "the version this loam
 * writes". Each rule below names the version that introduced it, so the next
 * bump cannot quietly re-read an older layout under the new one's rules: the
 * key rule was spelled `version === SNAPSHOT_VERSION` until this bump, and
 * would have stopped keying every version-3 row the day the constant moved. A
 * version added to the writer and not to this union is a compile error at the
 * writer's own call to {@link preImageRel}.
 */
export type ReadableSnapshotVersion = typeof SNAPSHOT_COMPAT_VERSION | typeof SNAPSHOT_KEYED_VERSION | 4;

/** A manifest version this loam reads: the one it writes and the two it reads forever. */
export function isReadableSnapshotVersion(version: unknown): version is ReadableSnapshotVersion {
  return version === SNAPSHOT_COMPAT_VERSION || version === SNAPSHOT_KEYED_VERSION || version === 4;
}

/** Does a manifest of this version key its `services/` rows by `(service, artifact)`? Version 3 on. */
export function keysServiceRows(version: ReadableSnapshotVersion): boolean {
  return version >= SNAPSHOT_KEYED_VERSION;
}

/**
 * Where a row's pre-image sits inside `files/`, forward slashes, under the
 * layout the manifest's VERSION names — never the layout this loam would
 * write, since a snapshot is read where it was written. Suffixed from version
 * 4 on.
 */
export function preImageRel(version: ReadableSnapshotVersion, path: string): string {
  return version >= 4 ? `${path}${PRE_IMAGE_SUFFIX}` : path;
}

export interface SnapshotEntry {
  /**
   * Docs-repo-relative path, forward slashes, AS ARCHIVED — where the archive
   * left the bytes. Load-bearing even beside the key below: it names the
   * pre-image under `.loam-before/files/` (through {@link preImageRel}), and
   * it is the literal fallback when the id stops being enumerated.
   *
   * For the feature's OWN documents — the ones the archive relinks for the
   * move (`commands/archive/plan/document/links.ts`) — that is inside
   * `features/archive/<FEAT>/`, not where they were written: the rename
   * carried them there, and that is where `unarchive` finds and restores them
   * before it moves the directory back. Recorded that way, every reader of
   * this layout restores them by its literal-path rule with nothing new to
   * learn, which is why the rows needed no version of their own; the two
   * readers that meet a snapshot before its feature moved — the clobber guard
   * and the crash repair — look across the move for them.
   */
  path: string;
  /**
   * For a `services/` entry: the service id (the leaf directory name — the one
   * thing a re-cut never changes) and the artifact's path inside its directory,
   * resolved through the CURRENT enumeration at restore time. Absent on
   * landscape and `features/` entries: the landscape does not move, and a
   * feature's own documents move only with the feature, which `path` already
   * says.
   */
  service?: string;
  artifact?: string;
  /** False when archive CREATED the file: restoring it means deleting it again. */
  existed: boolean;
  /**
   * sha256 of what archive wrote, so unarchive can tell its own merge from later
   * edits — the digest of NO bytes on a `removed` row, which is how every row
   * has always been spelled and so is not, alone, a sign of a delete.
   */
  after: string;
  /**
   * True when archive DELETED the file — a feature retiring a service flow
   * (`core/usecases/delta/service/slot.ts`): what it left is absence, and
   * restoring means writing the pre-image back. Additive and omitted on every
   * other row, so the layout version does not move; an older loam reads such a
   * row as a file changed since the archive and refuses the undo without
   * `--force` — a refusal, never a wrong restore. Only ever on a row that
   * `existed`: an archive deletes nothing that was not there.
   */
  removed?: true;
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

export interface SnapshotManifest {
  version: number;
  feature: string;
  dirName: string;
  archivedAt: string;
  /**
   * The digest of the checklist a fresh `loam verify` derived for the feature
   * just before this merge — present when the feature carried a record then,
   * absent otherwise and in every manifest an older loam wrote. Additive, so
   * the layout version does not move: `unarchive` never reads it, and a reader
   * that predates it ignores it. See {@link readSnapshotChecklist}.
   */
  checklist?: string;
  files: SnapshotEntry[];
}

export function snapshotDir(featureDir: string): string {
  return join(featureDir, SNAPSHOT_DIR);
}

/**
 * The checklist digest an archived feature's snapshot captured as it merged,
 * or null when it carries none.
 *
 * It lives in the manifest because the manifest is the one file `archive`
 * already writes into the feature at the moment of the merge, travels with it
 * into `features/archive/`, and is taken away by `unarchive` — so a feature
 * archived again gets a fresh one, captured against what it then asked. A
 * frozen verification record cannot be judged against a checklist re-derived
 * after the merge (the merge moved the feature's operations into the living
 * contract, so the derivation can only mismatch); this is the question as it
 * stood when the feature shipped, which is what `loam gate --since` holds the
 * record to. Here rather than beside the writer for the reason this module
 * exists: the gate is a read-only command, served over MCP as one.
 *
 * Tolerant to the last byte, and every failure is "none captured": a manifest
 * an older loam wrote, a feature archived with no record, a manifest that is
 * missing or does not parse. The reader that grades on it reads null as the
 * frozen history it always read, and says so — it never refuses a deploy
 * question over bookkeeping.
 */
export async function readSnapshotChecklist(featureDir: string): Promise<string | null> {
  const manifest = await manifestRecord(featureDir);
  if (manifest === null) return null;
  const { checklist } = manifest;
  return typeof checklist === "string" && checklist !== "" ? checklist : null;
}

/**
 * What a snapshot says about one service artifact as this feature's merge found
 * it. `held` is the pre-image itself. The other two are answers too, and the
 * same one for the question the reader asks — what did the merge take OUT of
 * the artifact: nothing. `created` is a row archive wrote for a file it
 * created (there was nothing before it); `unwritten` is an intact manifest
 * with no row for the artifact at all — archive records every file it writes,
 * so the artifact is what the merge found. Only the EVENT merge leaves a
 * contract unwritten: it returns no text when it changes nothing
 * (asyncapi/merge/merge.ts, `text: null` — a delta whose every marker missed
 * its target is exactly that). The OpenAPI merge returns text whenever the
 * delta has a path entry, so its no-op is an ordinary row whose pre-image
 * equals what it wrote — `held`, which answers the same question the same
 * way: every marker misses against it again.
 */
export type SnapshotPreImage =
  | { kind: "held"; text: string }
  | { kind: "created" }
  | { kind: "unwritten" };

/**
 * The bytes one service artifact held the moment this feature merged — the
 * pre-image the snapshot parked under `files/` — or one of the two answers
 * that say the merge took nothing out of it ({@link SnapshotPreImage}), or
 * null when there is nothing to trust.
 *
 * Read for the questions only the pre-image can answer, both asked by the
 * retired-operation revival check (core/coherence/retired/): what a merge TOOK
 * that its delta never spelled — a channel-slot removal in an asyncapi delta is
 * a bare marker, while the messages it retired with the channel are written in
 * the living contract it merged into and nowhere else — and whether a removal
 * marker took anything at all, since the merge deletes only what it finds at
 * the marker's slot. Here, beside `readSnapshotChecklist`, for that reader's
 * reason: the readers are read-only commands, and this module is the half of
 * the snapshot they may import.
 *
 * The entry is found by `(service, artifact)` on a keyed (version 3 or 4) manifest — the
 * key that survives a subsystem re-cut — and by the literal path's last two
 * segments on a version-2 one, which recorded nothing else. Tolerant to the
 * last byte, like the checklist reader: no manifest, a layout this loam would
 * have to guess at, no row for the artifact while some row cannot be read (it
 * might have been this one's, so absence cannot be concluded past it), a path
 * that does not stay inside `files/`, a pre-image that no longer hashes to the digest
 * the manifest recorded for it, or bytes that are not UTF-8 — every one is
 * null, and the caller grades without it. An edited pre-image is refused
 * rather than read for the reason `unarchive` refuses to restore one: its
 * bytes are no longer what the merge saw.
 */
export async function readSnapshotPreImage(
  featureDir: string,
  key: { service: string; artifact: string },
): Promise<SnapshotPreImage | null> {
  const manifest = await manifestRecord(featureDir);
  if (manifest === null || !Array.isArray(manifest.files)) return null;
  const { version } = manifest;
  if (!isReadableSnapshotVersion(version)) return null;
  // `Array.isArray` narrows to `any[]`; naming the element type keeps that
  // `any` from spreading past the row being read (snapshot.ts's reason).
  const rows: unknown[] = manifest.files;
  const entry = rows.find((row) => isRecord(row) && entryIs(row, key));
  if (entry === undefined) {
    // Absence is an answer only when every row could be read: a row that is
    // not a record with a path might have been this artifact's.
    return rows.every((row) => isRecord(row) && typeof row.path === "string") ? { kind: "unwritten" } : null;
  }
  if (!isRecord(entry) || typeof entry.path !== "string") return null;
  if (entry.existed === false && entry.before === null) return { kind: "created" };
  if (typeof entry.before !== "string") return null;
  let bytes: Buffer;
  try {
    // The manifest is data and this path is one we go and read: the lexical
    // containment `unarchive` and the staleness check apply to the same field.
    bytes = await readFile(
      resolvePortableFileInsideLexically(
        join(snapshotDir(featureDir), "files"),
        preImageRel(version, entry.path),
        "snapshot pre-image",
      ),
    );
  } catch {
    return null;
  }
  if (sha256(bytes) !== entry.before || !isUtf8(bytes)) return null;
  return { kind: "held", text: bytes.toString("utf8") };
}

/** Does this manifest row record `key`'s artifact? The `(service, artifact)` key when it has one, the literal path otherwise. */
function entryIs(row: Record<string, unknown>, key: { service: string; artifact: string }): boolean {
  if (typeof row.service === "string" && typeof row.artifact === "string") {
    return row.service === key.service && row.artifact === key.artifact;
  }
  if (typeof row.path !== "string") return false;
  const parts = row.path.split("/");
  return parts.length >= 3 && parts[0] === "services" && parts.at(-2) === key.service && parts.at(-1) === key.artifact;
}

/** The manifest as a record, or null — the one tolerant read behind both readers above. */
async function manifestRecord(featureDir: string): Promise<Record<string, unknown> | null> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(snapshotDir(featureDir), SNAPSHOT_MANIFEST), "utf8"));
  } catch {
    return null;
  }
  return isRecord(manifest) ? manifest : null;
}
