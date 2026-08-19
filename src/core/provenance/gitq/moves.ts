/**
 * The subsystem surface's git questions, beside the provenance ones
 * (`../git.ts`) whose timeout and capped stdout reader they share. A package
 * of their own because `git.ts` sits against the 300-line limit and these
 * three are one subject: what a `subsystem move` must know before renaming
 * (`gitDirtyPaths`), what `subsystem history` asks after (`gitRenameHops`),
 * and the ONE write the roadmap blesses (`gitStageRenames` — "move stages
 * renames without committing"). The doctrine is unchanged: every way git can
 * decline reads as "git will not say", never as an error a caller must
 * handle.
 */
import { spawn } from "node:child_process";
import { collectStdout, GIT_TIMEOUT_MS } from "../git.js";

/**
 * Which of these repo-relative paths carry UNCOMMITTED work — anything
 * `git status --porcelain` reports beneath them, untracked files included: an
 * untracked file is exactly a change no commit records. Null for every way
 * git declines (not a repository, not installed, a timeout, a non-zero exit),
 * and the one caller — `subsystem move`'s only refusal — treats null as
 * "proceed": a refusal needs positive evidence, and a fleet that does not use
 * git must not be refused a move over it.
 *
 * `-z` for the same reason `gitTrackedFiles` uses it: line output QUOTES
 * paths with spaces or non-ASCII bytes. A rename entry (`R ` when something
 * is already staged) carries a second NUL-separated path; both belong in the
 * answer.
 */
export async function gitDirtyPaths(repoDir: string, rels: string[]): Promise<string[] | null> {
  if (rels.length === 0) return [];
  return new Promise<string[] | null>((done) => {
    const child = spawn("git", ["status", "--porcelain", "-z", "--", ...rels], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    const out = collectStdout(child);
    child.on("error", () => done(null));
    child.on("close", (code) => {
      if (code !== 0 || out.overflowed()) {
        done(null);
        return;
      }
      const tokens = out.text().split("\0").filter((t) => t !== "");
      const paths: string[] = [];
      for (let i = 0; i < tokens.length; i += 1) {
        const entry = tokens[i]!;
        // "XY <path>" — two status letters and a space. A rename/copy entry's
        // ORIGINAL path follows as its own NUL token; take it too.
        paths.push(entry.slice(3));
        if (entry.startsWith("R") || entry.startsWith("C")) {
          i += 1;
          if (tokens[i] !== undefined) paths.push(tokens[i]!);
        }
      }
      done(paths);
    });
  });
}

/** One hop of a path's rename history: the commit, and the path either side of it. */
export interface RenameHop {
  commit: string;
  from: string;
  to: string;
}

/**
 * How this file moved over time, OLDEST hop first — or null when git will not
 * say. The question follows one FILE deliberately: `git log --follow` is
 * defined for a single file and prints NOTHING for a directory path, so
 * `subsystem history` follows a representative file inside the directory it
 * is asked about (a service's spec.md, a subsystem's marker) and reads each
 * hop's directories off the file's own rename record. An empty array is git
 * ANSWERING "never renamed"; null is git declining — the caller renders the
 * two differently and exits 0 for both, per the doctrine above.
 *
 * Output shape under `-z --format=%H`: `<hash>\0\nR<score>\0<old>\0<new>\0…`,
 * newest commit first — the token walk below is anchored on the two shapes a
 * token can have (a 40-hex hash, an R-status) so an unexpected shape yields
 * fewer hops, never a wrong pairing.
 */
export async function gitRenameHops(repoDir: string, rel: string): Promise<RenameHop[] | null> {
  return new Promise<RenameHop[] | null>((done) => {
    const child = spawn(
      "git",
      ["log", "--follow", "--diff-filter=R", "--name-status", "-z", "--format=%H", "--", rel],
      { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS },
    );
    const out = collectStdout(child);
    child.on("error", () => done(null));
    child.on("close", (code) => {
      if (code !== 0 || out.overflowed()) {
        done(null);
        return;
      }
      const tokens = out.text().split("\0").map((t) => (t.startsWith("\n") ? t.slice(1) : t));
      const hops: RenameHop[] = [];
      let commit = "";
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]!;
        if (/^[0-9a-f]{40}$/.test(token)) commit = token;
        else if (/^R\d*$/.test(token) && tokens[i + 1] !== undefined && tokens[i + 2] !== undefined) {
          hops.push({ commit, from: tokens[i + 1]!, to: tokens[i + 2]! });
          i += 2;
        }
      }
      done(hops.reverse());
    });
  });
}

/**
 * Best-effort `git add -A` over these repo-relative paths — the ONE write
 * (module banner): after a `subsystem move` lands its renames, staging the
 * delete-side and add-side together is what lets git record the pair as a
 * rename, which is what keeps `subsystem history` answerable after the user
 * commits. Failure-silent in every direction: a fleet without git, an index
 * lock, a timeout — the move already succeeded, and nothing here may turn it
 * into an error.
 */
export async function gitStageRenames(repoDir: string, rels: string[]): Promise<void> {
  if (rels.length === 0) return;
  return new Promise<void>((done) => {
    const child = spawn("git", ["add", "-A", "--", ...rels], {
      cwd: repoDir,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    child.on("error", () => done());
    child.on("close", () => done());
  });
}
