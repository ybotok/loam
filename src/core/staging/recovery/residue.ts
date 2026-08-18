/**
 * Everything in a docs repo that only a write which did not finish can produce,
 * gathered for `doctor` to grade.
 *
 * It lives beside the write path rather than in `doctor` because these are
 * staging's own artefacts and it does not re-spell any of them: `.loam-lock`
 * comes from `../lock.ts`, `.loam-commit` from `./intent.ts`, and the temp-file
 * pattern from `../commit.ts`. A detector that spelled them a second time would
 * go stale the first time any of the three changed. This module reports;
 * `doctor` decides what the report means.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { repoPath } from "../../envelope/json.js";
import { DOCS_LOCK, lockResidue } from "../lock.js";
import { TEMP_FILE_RE } from "../commit.js";
import { COMMIT_INTENT } from "../interrupted.js";
import { readTxnIntent, type TxnIntent } from "../txn/journal.js";
import { readCommitIntent, type CommitIntent } from "./intent.js";

/** The four shapes an unfinished write leaves behind, each named by its cause. */
export interface WritePathResidue {
  /**
   * A held `.loam-lock`; whether its holder is a process that no longer exists
   * on this host; and whether the file cannot name a holder at all — in which
   * case nothing will ever release it and `stale` is meaningless.
   */
  lock: { path: string; holder: string; stale: boolean; unreadable: boolean } | null;
  /**
   * An interrupted commit's intent record — present means a commit was in
   * flight when something killed it. Either journal version: the consumer
   * tells them apart by shape (`rerun` exists only on version 2).
   */
  intent: CommitIntent | TxnIntent | null;
  /** True when `.loam-commit` exists but cannot be parsed: the worst case, because nothing can grade it. */
  intentUnreadable: boolean;
  /** Docs-repo-relative paths of orphaned `.loam-*.tmp` staging files. */
  temps: string[];
}

export async function scanWritePathResidue(docsDir: string): Promise<WritePathResidue> {
  const lockPath = join(docsDir, DOCS_LOCK);
  // One read decides everything about the lock. An exists-then-describe-then-
  // grade sequence read the file up to four times, and a lock released between
  // reads — the ordinary sub-second commit window of a healthy archive — could
  // be reported in a state no single moment ever had.
  const residue = await lockResidue(lockPath);
  const lock: WritePathResidue["lock"] =
    residue === null ? null : { path: repoPath(docsDir, lockPath), ...residue };
  // Both journal versions wear the same filename; a version-2 record must
  // not be graded "unreadable" merely because the version-1 reader rejects
  // its version field.
  const intent = (await readCommitIntent(docsDir)) ?? (await readTxnIntent(docsDir));
  return {
    lock,
    intent,
    intentUnreadable: intent === null && existsSync(join(docsDir, COMMIT_INTENT)),
    temps: (await tempLeftovers(docsDir)).map((p) => repoPath(docsDir, p)).sort(),
  };
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

