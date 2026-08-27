/**
 * Git-at-a-ref reader for the DOCS repo — the base side of `loam diff`.
 *
 * Three questions, all read-only: does this docs directory sit in a git
 * repository and where (`resolveBase`), what did `services/` hold at the base
 * commit (`listBaseTree`), and what were one file's bytes there
 * (`showBaseFile`). No checkout, no temp writes — the base state is read
 * straight out of the object store with `rev-parse`/`ls-tree`/`show`.
 *
 * The doctrine here is deliberately NOT provenance's. `../provenance/git.ts`
 * answers every git decline with "git will not say" — null, no finding —
 * because provenance has no denominator without git and nothing to report.
 * Diff is the opposite case: without the base there is no honest diff at all,
 * and a silently empty base would report the whole fleet as ADDED — the exact
 * "green over zero services" failure `docsRepoReady` exists to prevent, one
 * step later. So every decline travels as a typed outcome the command REFUSES
 * on, carrying git's own words (bounded) so the refusal can say why.
 *
 * What is shared with provenance is the mechanics: the one timeout and the
 * capped stdout reader, so rule 20 (every child spawn bounded) holds by
 * construction.
 */
import { spawn } from "node:child_process";
import { collectStderr, declineDetail, GIT_TIMEOUT_MS, gitSaid, gitText } from "../provenance/git.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/**
 * How many bytes one base file may be — the same generosity as
 * `../provenance/git.ts`'s stdout cap, restated here because that constant is
 * private to its module and this one collects BYTES, not text (a base
 * contract's UTF-8-ness is a fact to grade, and `setEncoding("utf8")` would
 * substitute U+FFFD before anyone could check). Past the cap the child is
 * killed and the file reads as unreadable for its subject, never truncated.
 *
 * The question-asking mechanics — `gitText`, `GitAnswer`, `gitSaid`,
 * `declineDetail`, `collectStderr` — are the shared set exported beside
 * `collectStdout`: `../provenance/gitq/vouched-ancestor.ts` asks with the
 * same shapes and the opposite consequence (it degrades to "full read" where
 * this module's callers REFUSE), and the helpers stay verdict-free so the two
 * doctrines cannot bleed into each other through a shared line.
 */
const MAX_BASE_FILE_BYTES = 64 * 1024 * 1024;

export type BaseResolution =
  | { kind: "no-git"; detail: string }
  | { kind: "no-ref"; detail: string }
  | { kind: "ok"; commit: string; prefix: string };

/**
 * Resolve the base: is `docsDir` inside a git work tree, where does it sit in
 * that repository, and which commit does `ref` name?
 *
 * `--show-prefix` is asked FIRST and is not decoration: a docs repo checked
 * out as a subdirectory of a larger repository (a monorepo's `docs/`) answers
 * every later `ls-tree`/`show` only under that prefix. Dropping it makes every
 * path miss, and a diff whose base paths all miss reports the whole fleet as
 * added — silently, in exactly the repositories big enough to care.
 */
export async function resolveBase(docsDir: DocsDir, ref: string): Promise<BaseResolution> {
  const where = await gitText(docsDir, ["rev-parse", "--show-prefix"]);
  if (where.spawnError !== undefined || where.code !== 0) {
    return { kind: "no-git", detail: declineDetail(where) };
  }
  // A ref spelled like an option would be parsed as one by git, not resolved
  // as a revision — refuse it before it reaches an argv. Same reason the MCP
  // argv boundary refuses '-'-prefixed strings.
  const spelled = ref.trim();
  if (spelled === "" || spelled.startsWith("-")) {
    return { kind: "no-ref", detail: "a ref must be a revision name, not empty and not option-shaped." };
  }
  // `^{commit}` peels an annotated tag to the commit it tags, and refuses a
  // ref that names any other object kind — a tree or blob sha is not a base
  // state to diff against.
  const verified = await gitText(docsDir, ["rev-parse", "--verify", `${spelled}^{commit}`]);
  const commit = verified.out.trim();
  if (verified.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    const said = gitSaid(verified);
    return { kind: "no-ref", detail: said === "" ? "" : `git said: ${said}` };
  }
  return { kind: "ok", commit, prefix: where.out.trim() };
}

/** The resolved base every later question is asked against. */
export interface ResolvedBase {
  docsDir: DocsDir;
  commit: string;
  /** The docs repo's path inside its repository, `""` or `"docs/"`-shaped — `rev-parse --show-prefix`'s answer. */
  prefix: string;
}

export type BaseTreeListing =
  | { kind: "ok"; paths: string[] }
  | { kind: "failed"; detail: string };

/**
 * Every file path under `services/` at the base commit, DOCS-RELATIVE
 * (`services/...`, prefix already stripped). `--full-tree` anchors both the
 * pathspec and the output at the repository root regardless of cwd, so the
 * one prefix from `resolveBase` is the whole story; `-z` because git quotes
 * non-ASCII paths in line output. An empty answer is git ANSWERING — the base
 * commit simply has no `services/` — and only a non-zero exit is a failure.
 */
export async function listBaseTree(base: ResolvedBase): Promise<BaseTreeListing> {
  const answer = await gitText(base.docsDir, [
    "ls-tree", "-r", "-z", "--name-only", "--full-tree", base.commit, "--", `${base.prefix}services`,
  ]);
  if (answer.spawnError !== undefined || answer.code !== 0 || answer.overflowed) {
    return {
      kind: "failed",
      detail: answer.overflowed
        ? "the base tree listing exceeded the output cap."
        : declineDetail(answer),
    };
  }
  return {
    kind: "ok",
    paths: answer.out
      .split("\0")
      .filter((p) => p.startsWith(base.prefix) && p !== "")
      .map((p) => p.slice(base.prefix.length)),
  };
}

export type BaseFileRead =
  | { kind: "ok"; bytes: Buffer }
  | { kind: "failed"; detail: string };

/**
 * One base file's bytes, by docs-relative path. Callers only ask for paths
 * `listBaseTree` returned, so there is no "absent" arm: a decline here is
 * abnormal and travels as `failed` for per-subject containment — that one
 * subject degrades with the detail, never the whole diff.
 */
export async function showBaseFile(base: ResolvedBase, rel: string): Promise<BaseFileRead> {
  return new Promise<BaseFileRead>((done) => {
    const child = spawn("git", ["show", `${base.commit}:${base.prefix}${rel}`], {
      cwd: base.docsDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
    // Bytes, not text: `collectStdout` decodes as UTF-8, and a base contract
    // whose bytes are NOT UTF-8 must arrive intact so base-state can grade it
    // unreadable instead of parsing a document nobody wrote.
    const chunks: Buffer[] = [];
    let held = 0;
    let overflowed = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      if (held + chunk.length > MAX_BASE_FILE_BYTES) {
        overflowed = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
      held += chunk.length;
    });
    const err = collectStderr(child);
    child.on("error", (e) => done({ kind: "failed", detail: `git could not be started: ${e.message}.` }));
    child.on("close", (code) => {
      if (code !== 0 || overflowed) {
        done({
          kind: "failed",
          detail: overflowed
            ? "the file exceeds the base-read byte cap."
            : declineDetail({ code, out: "", err: err(), overflowed }),
        });
        return;
      }
      done({ kind: "ok", bytes: Buffer.concat(chunks) });
    });
  });
}
