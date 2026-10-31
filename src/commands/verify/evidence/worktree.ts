/**
 * The working tree an attestation is recorded from, against the commit it
 * names.
 *
 * `--service` binds every answer to this repository's HEAD
 * (`repositoryCommit`), but a suite runs against the WORKING TREE, and the two
 * are the same code only when nothing is uncommitted. Nothing asked: a run
 * over six modified files and four untracked directories recorded "attested
 * at <the pre-feature commit>" and `verified`, without a word, naming a commit
 * that did not contain one line of the code its report was about. The
 * existing binding (`committedFile`) covers only the files the evidence cites
 * and a committed report — never the code under test.
 *
 * This is the first step of the agreed fix: the record says so — `dirty: true`
 * and the paths, on the attestation — and the run warns. Refusing is the
 * second step and a contract change (exit behaviour), so it is not taken here.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loamOwnedFiles, type LoamConfig } from "../../../core/envelope/config.js";
import { gherkinRoot } from "../../../core/gherkin/stamp.js";
import { gitText } from "../../../core/provenance/git.js";
import { gitDirtyPaths } from "../../../core/provenance/gitq/moves.js";
import type { ConsumedReports } from "../../../core/verify/record.js";

/**
 * What loam itself writes or carries in the service repository, none of which
 * is the code under test: loam.json and the agent files it records, the
 * generated suite under `<gherkinDir>/loam/` (written by `loam gherkin`, read
 * by the run), and the docs repo when it lives inside the service repo — the
 * single-repo layout, where `verify` writes its own record into the same tree
 * it is about to check. Without these the check would fire on every run that
 * followed a `loam gherkin` or a docs edit, and a warning that always fires is
 * one a team learns to skip.
 *
 * An unsafe `gherkinDir` is `loam gherkin`'s refusal to make, not this one's:
 * it is left out of the list and the check stays conservative.
 */
export function loamCarried(config: LoamConfig, repoDir: string): string[] {
  return [...loamOwnedFiles(config), config.docsDir, ...generatedSuite(repoDir, config.gherkinDir)];
}

function generatedSuite(repoDir: string, gherkinDir: string | undefined): string[] {
  try {
    return [gherkinRoot(repoDir, gherkinDir)];
  } catch {
    return [];
  }
}

/** This run's own inputs: the reports it read (repo-relative) and the answers file (cwd-relative). */
export interface RunInputs {
  reports: ConsumedReports;
  answers?: string;
}

/**
 * What `git status --porcelain` reports under the service root — untracked
 * files included, since an untracked file is exactly code no commit records —
 * minus `carried` and this run's inputs (paths absolute or repo-relative; one
 * outside the repository excludes nothing): a report written by the run and
 * the answers file beside it are what the attestation reads, not code it is
 * about. Repo-relative, `/`-separated, sorted. `.gitignore`d paths never
 * appear: git leaves them out, so build output does not trip it.
 *
 * Null when git will not say (`gitDirtyPaths`' doctrine). The caller reads
 * that the conservative way, as `verify`'s other binding checks do: an
 * unanswered check is not a passed one.
 *
 * Scoped to the service root (`.`), not the whole repository: in a monorepo
 * whose loam.json sits in a subdirectory, an edit in a neighbouring service is
 * not this attestation's business, exactly as its evidence must resolve inside
 * the same root. Git spells every path from the repository's top, so the
 * root's own prefix is cut back off.
 */
export async function uncommittedPaths(
  repoDir: string,
  carried: readonly string[],
  run: RunInputs,
): Promise<string[] | null> {
  const inputs = [
    ...[run.reports.results, run.reports.contract].flatMap((r) => (r === undefined ? [] : [r.path])),
    ...(run.answers === undefined ? [] : [resolve(process.cwd(), run.answers)]),
  ];
  const excluded = [...carried, ...inputs].flatMap((path) => {
    const rel = relative(repoDir, resolve(repoDir, path));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return [];
    // `literal`: a loam path is a name, never a pattern for git to expand.
    return [`:(exclude,literal)${rel.split(sep).join("/")}`];
  });
  const dirty = await gitDirtyPaths(repoDir, [".", ...excluded]);
  if (dirty === null || dirty.length === 0) return dirty;
  const where = await gitText(repoDir, ["rev-parse", "--show-prefix"]);
  const prefix = where.code === 0 ? where.out.trim() : "";
  return [...new Set(dirty.map((p) => (prefix !== "" && p.startsWith(prefix) ? p.slice(prefix.length) : p)))].sort();
}
