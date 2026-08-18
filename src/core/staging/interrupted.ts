/**
 * The vocabulary every journaled commit shares, whichever journal version
 * wrote it: the record's filename, the refusal an interrupted commit raises,
 * the recovery report a caller prints, and the two disk disciplines (durable
 * write, pid-scoped temp sweep) that recovery rests on.
 *
 * A staging-ROOT module, deliberately: `recovery/` (the version-1 undo path)
 * and `txn/` (the version-2 roll-forward path) both need these VALUES, and a
 * value import between those two packages in either direction would be the
 * repo's first package cycle — `recovery/` already imports the staging root,
 * and `txn/` must too. Shared values live where both edges already point.
 */
import { readdir, open } from "node:fs/promises";
import { join } from "node:path";
import { quietRm, TEMP_FILE_RE } from "./commit.js";

/**
 * The journal that makes an interrupted commit detectable.
 *
 * `swapStaged` is N renames, and only each ONE of them is atomic. A kill
 * between two of them leaves the tree half-merged — and nothing could see it:
 * `doctor` and `status` called the repo healthy, `validate --all` blamed the
 * delta, and the next archive cleared the one snapshot that could have
 * repaired it. So every commit's swap loop runs inside a record written and
 * fsynced BEFORE the first rename and removed after the last step: its mere
 * presence says a commit was in flight, and its per-path digests say, file by
 * file, whether that file's rename landed.
 *
 * It is deliberately NOT a source of truth and never disagrees with the
 * files: every judgement it supports is made by re-reading the bytes and
 * comparing digests, and every byte a repair writes is verified against the
 * digest recorded before the crash. Outside the commit window it does not
 * exist — except after a rollback that could not finish, where it is kept on
 * purpose as the one durable record of which files need a human. Version 1
 * (archive/unarchive) restores from a snapshot; version 2 (the smaller
 * transaction) rolls forward from the staged temps. Both wear this name so
 * one `doctor` scan finds either.
 */
export const COMMIT_INTENT = ".loam-commit";

/** An interrupted commit this loam must not silently write over. */
export class InterruptedCommitError extends Error {
  override readonly name = "InterruptedCommitError";
}

/** What recovery did, for the caller to print and put in `--json`. */
export interface CommitRecovery {
  /** Which command's commit was recovered — a sentence a human reads, not a branch. */
  command: string;
  /**
   * What that command was committing FOR: a feature id for archive, unarchive
   * and rebase; a service for vouch and gherkin. The field keeps archive's
   * original name because its `--json` shape shipped first.
   */
  feature: string;
  /**
   * `completed` — every step but the record's own removal landed;
   * `consistent` — no file was left in the other state;
   * `repaired` — files were put back (v1) or carried forward (v2), byte for byte.
   */
  outcome: "completed" | "consistent" | "repaired";
  /** Repo-relative paths this recovery rewrote or removed. */
  repaired: string[];
}

/**
 * Write `text` to `path` and get it onto the DISK, not just into the page
 * cache: a journal that dies with the machine describes nothing. The
 * directory entry is fsynced too where the platform allows opening a
 * directory — without that the file's bytes can be durable while its name is
 * not.
 */
export async function writeDurable(path: string, text: string): Promise<void> {
  const handle = await open(path, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const dir = await open(join(path, ".."), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // Not every platform lets a directory be opened; the file's own bytes are
    // flushed either way, which is the part that carries the digests.
  }
}

/**
 * Drop the staged temp files a killed run could not remove — scoped to that
 * run's own pid and its own target directories, both carried in the temp
 * name, so a leftover belonging to anything else is left for `doctor` to
 * name. Without this a repair that put every byte back still left the repo
 * dirty, which is the one thing a caller checks to decide whether it worked.
 */
export async function sweepPidTemps(dirs: Iterable<string>, pid: number): Promise<void> {
  for (const dir of new Set(dirs)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!TEMP_FILE_RE.test(name) || !name.includes(`.loam-${pid}-`)) continue;
      await quietRm(join(dir, name));
    }
  }
}
