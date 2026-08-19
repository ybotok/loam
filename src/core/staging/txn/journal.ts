/**
 * The version-2 `.loam-commit` journal: the record a SMALL journaled
 * transaction writes before its first rename, for the writers whose commits
 * have no snapshot and no final directory move — rebase, vouch, new, gherkin.
 *
 * Version 1 (archive/unarchive) restores from a snapshot that travels in the
 * feature directory; none of the smaller writers has one, which is exactly
 * why the roadmap says extract a smaller transaction rather than reuse — this
 * journal therefore records, per file, the digest of both states AND the
 * root-relative staged temp still holding the after-bytes, so recovery can
 * roll FORWARD from what is already durable instead of pretending pre-images
 * exist somewhere. `rerun` is the exact `loam …` line doctor prints as the
 * fix: recovery runs at the start of the next invocation of the same command.
 *
 * A txn/ sub-package importing ONLY the staging root, never `recovery/`:
 * recovery/ already imports the root and will import txn/ for dispatch, so an
 * edge back from here would be the repo's first package cycle.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, relative } from "node:path";
import { isPathInside } from "../../kernel/path-safety.js";
import { quietRm } from "../commit.js";
import { COMMIT_INTENT, writeDurable } from "../interrupted.js";
import { isDigest, sha256, type StagedWrite } from "../writes.js";

const TXN_VERSION = 2;
/**
 * The version whose records CARRY DIRECTORY MOVES — `subsystem move`'s
 * journal, the first consumer whose commit renames directories beside its one
 * staged file. A version of its own, and version 2 is still what every
 * move-less writer stamps, deliberately: an old binary must keep recovering
 * the version-2 records it always could, and it must REFUSE a record with
 * moves rather than roll the file half forward and leave the renames behind —
 * an unknown version already reads as "a commit this loam cannot read", which
 * is `doctor`'s honest blocker, not a silent half-repair.
 */
const TXN_MOVES_VERSION = 3;

/** One directory rename inside a transaction: root-relative, forward slashes. */
export interface TxnIntentMove {
  from: string;
  to: string;
}

export interface TxnIntentFile {
  /** Root-relative path, forward slashes. */
  path: string;
  /** sha256 of the bytes before the swap; null when the swap creates the file. */
  before: string | null;
  /** sha256 of the bytes the swap writes; null when the swap deletes the file. */
  after: string | null;
  /** Root-relative staged temp holding the after-bytes; null for a deletion. */
  tmp: string | null;
}

export interface TxnIntent {
  version: number;
  /** Which command was committing — a sentence a human reads, not a branch. */
  command: string;
  /** The exact `loam …` invocation whose next run recovers this journal. */
  rerun: string;
  /** What the command was committing for: a feature id, or a service. */
  target: string;
  pid: number;
  host: string;
  at: string;
  files: TxnIntentFile[];
  /**
   * Directory renames the commit performs AFTER its file swaps, in this
   * order. `[]` on every version-2 record (the reader normalises absence):
   * only `subsystem move`/`rename` write any, and their presence is what
   * bumps the record to version 3.
   */
  moves: TxnIntentMove[];
}

/** What a transaction tells the journal about itself; the caller's one spelling of its identity. */
export interface TxnSpec {
  /** The repo root the journal lives in — the docs repo, or gherkin's owned root. */
  root: string;
  command: string;
  rerun: string;
  target: string;
  /** Directory renames to perform after the swaps — ABSOLUTE paths; the journal stores them root-relative. */
  moves?: { from: string; to: string }[];
}

/** Root-relative with forward slashes — the journal must survive being read on another machine. */
function rel(root: string, abs: string): string {
  return relative(root, abs).split(/[\\/]/).join("/");
}

export async function writeTxnIntent(spec: TxnSpec, staged: StagedWrite[]): Promise<void> {
  const moves = (spec.moves ?? []).map((m) => ({ from: rel(spec.root, m.from), to: rel(spec.root, m.to) }));
  const intent: TxnIntent = {
    version: moves.length > 0 ? TXN_MOVES_VERSION : TXN_VERSION,
    command: spec.command,
    rerun: spec.rerun,
    target: spec.target,
    pid: process.pid,
    host: hostname(),
    at: new Date().toISOString(),
    files: staged.map((s) => ({
      path: rel(spec.root, s.write.path),
      before: s.before === null ? null : sha256(s.before),
      after: s.content === null ? null : sha256(s.content),
      tmp: s.tmp === null ? null : rel(spec.root, s.tmp),
    })),
    moves,
  };
  await writeDurable(join(spec.root, COMMIT_INTENT), JSON.stringify(intent, null, 2) + "\n");
}

export async function clearTxnIntent(root: string): Promise<void> {
  await quietRm(join(root, COMMIT_INTENT));
}

/**
 * The journal as written, or null when absent, unreadable, or not version 2 —
 * the same strict grading version 1 gets: a record that cannot be trusted
 * whole is not a record, and `doctor` describes the difference.
 */
export async function readTxnIntent(root: string): Promise<TxnIntent | null> {
  const path = join(root, COMMIT_INTENT);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  const i = parsed as Partial<TxnIntent>;
  if (i === null || typeof i !== "object") return null;
  if (i.version !== TXN_VERSION && i.version !== TXN_MOVES_VERSION) return null;
  if (typeof i.command !== "string" || typeof i.rerun !== "string" || typeof i.target !== "string") return null;
  if (typeof i.pid !== "number" || typeof i.host !== "string" || typeof i.at !== "string") return null;
  if (!Array.isArray(i.files)) return null;
  // A version-2 record predates the field; normalise so recovery reads one
  // shape. A version-3 record's moves are validated exactly as its files are:
  // recovery RENAMES what they name, so an entry escaping the root fails the
  // whole record closed.
  if (i.moves === undefined) i.moves = [];
  if (!Array.isArray(i.moves)) return null;
  if (i.version === TXN_VERSION && i.moves.length > 0) return null;
  for (const m of i.moves) {
    if (typeof m?.from !== "string" || typeof m?.to !== "string") return null;
    if (!insideRoot(root, m.from) || !insideRoot(root, m.to)) return null;
  }
  for (const f of i.files) {
    if (typeof f?.path !== "string") return null;
    if (!digestOrNull(f.before) || !digestOrNull(f.after)) return null;
    if (f.tmp !== null && typeof f.tmp !== "string") return null;
    // A write (after non-null) with no temp recorded could never be rolled
    // forward; refusing the whole record here keeps that impossibility a
    // `doctor` sentence instead of a mid-recovery surprise.
    if (f.after !== null && f.tmp === null) return null;
    // The journal is untrusted input — a plain file that travels in a git
    // checkout — and recovery RENAMES OVER and DELETES what these entries
    // name. An entry escaping the root (`../outside`, an absolute path) would
    // turn roll-forward into an arbitrary write anywhere on the machine, so
    // it fails the whole record closed: `doctor` grades it exactly as any
    // other unreadable journal, a blocker naming the file for a human.
    if (!insideRoot(root, f.path) || (f.tmp !== null && !insideRoot(root, f.tmp))) return null;
  }
  return i as TxnIntent;
}

function digestOrNull(value: unknown): boolean {
  return value === null || isDigest(value);
}

/** Lexical containment of a recorded root-relative path — recovery acts on the join. */
function insideRoot(root: string, rel: string): boolean {
  return isPathInside(join(root), join(root, ...rel.split("/")));
}
