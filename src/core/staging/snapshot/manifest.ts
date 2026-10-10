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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../kernel/records.js";

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
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(snapshotDir(featureDir), SNAPSHOT_MANIFEST), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(manifest)) return null;
  const { checklist } = manifest;
  return typeof checklist === "string" && checklist !== "" ? checklist : null;
}
