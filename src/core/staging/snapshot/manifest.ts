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
import { join } from "node:path";

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
  files: SnapshotEntry[];
}

export function snapshotDir(featureDir: string): string {
  return join(featureDir, SNAPSHOT_DIR);
}
