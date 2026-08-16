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
import { DOCS_LOCK, describeLock, lockIsStale } from "../lock.js";
import { TEMP_FILE_RE } from "../commit.js";
import { readCommitIntent, COMMIT_INTENT, type CommitIntent } from "./intent.js";

/** The four shapes an unfinished write leaves behind, each named by its cause. */
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

