/**
 * The `.loam-commit` journal — written before the first swap, cleared after the
 * last — and the record that makes an interrupted commit detectable at all.
 *
 * Reading and writing the record is kept apart from acting on it
 * (`./recover.ts`) because a corrupt record has to stay describable: `doctor`
 * reports a `.loam-commit` it cannot parse, and a module that parsed and
 * repaired in one step would have no way to say that without also attempting
 * the repair.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { repoPath } from "../../envelope/json.js";
import { isPathInside } from "../../kernel/path-safety.js";
import { COMMIT_INTENT, writeDurable } from "../interrupted.js";
import { isDigest, sha256, type StagedWrite } from "../writes.js";
import { quietRm } from "../commit.js";

/** The version-1 record: archive's and unarchive's snapshot-backed journal. */
const COMMIT_INTENT_VERSION = 1;

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
  await writeDurable(join(docsDir, COMMIT_INTENT), JSON.stringify(intent, null, 2) + "\n");
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
  // The journal is untrusted input, and recovery writes over what it names —
  // the same containment the version-2 reader enforces, because an entry
  // escaping the docs repo would turn repair into an arbitrary write.
  const inside = (rel: string): boolean => isPathInside(join(docsDir), join(docsDir, ...rel.split("/")));
  if (!inside(i.moveFrom) || !inside(i.moveTo)) return null;
  for (const f of i.files) {
    if (typeof f?.path !== "string") return null;
    if (!isDigestOrNull(f.before) || !isDigestOrNull(f.after)) return null;
    if (!inside(f.path)) return null;
  }
  return i as CommitIntent;
}

function isDigestOrNull(value: unknown): boolean {
  return value === null || isDigest(value);
}

