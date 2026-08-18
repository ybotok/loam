/**
 * Subprocess questions to git: what the repository tracks, what it ignores,
 * and who is working in it. Four spawns, one timeout, one doctrine — every way
 * git can decline to answer (not a repository, not installed, a non-zero exit,
 * a timeout) reads as "git will not say", never as an error a caller must
 * handle. No denominator, no finding.
 */
import { spawn } from "node:child_process";

/** How long the digest waits on git before deciding it learned nothing. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * How much a git answer may SAY. The three streamed reads below accumulated
 * without bound — a fleet repo's ls-files fits in single-digit MiB, so the
 * cap is generous, and past it the child is killed and the doctrine answers
 * exactly as for any other way git declines: null, or the empty set — "git
 * will not say", never a truncated denominator presented as the whole one.
 */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Accumulate a child's stdout up to the cap; past it, kill the child and
 * remember why. One helper because the three readers below had three copies
 * of the same `out += chunk` line, which is where an unbounded buffer hides.
 */
function collectStdout(child: import("node:child_process").ChildProcess): { text: () => string; overflowed: () => boolean } {
  let out = "";
  let overflowed = false;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (overflowed) return;
    if (out.length + chunk.length > MAX_GIT_OUTPUT_BYTES) {
      overflowed = true;
      child.kill();
      return;
    }
    out += chunk;
  });
  return { text: () => out, overflowed: () => overflowed };
}

/**
 * What this repository considers its own, as repo-relative paths — or null for
 * every way git can decline to say: not a repository, not installed, a timeout,
 * a non-zero exit. The caller distinguishes none of them, exactly as
 * `gitConfig` does not, because they all mean the same thing: there is no
 * denominator here, so there is nothing to report.
 *
 * `-z` rather than the default line output: git QUOTES paths containing spaces
 * or non-ASCII bytes when it is writing lines, so a service with one such file
 * would have had a phantom top-level directory named `"src` in its untouched
 * list.
 */
export async function gitTrackedFiles(repoDir: string): Promise<string[] | null> {
  return new Promise<string[] | null>((done) => {
    const child = spawn("git", ["ls-files", "-z", "--cached", "--exclude-standard"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    const out = collectStdout(child);
    child.on("error", () => done(null));
    child.on("close", (code) => {
      done(code === 0 && !out.overflowed() ? out.text().split("\0").filter((p) => p !== "") : null);
    });
  });
}

/**
 * Which of these repo-relative paths the repository ignores, asked once for the
 * whole list. `git check-ignore` is the authority on purpose — it reads
 * `.gitignore` at every level, `.git/info/exclude` and the user's global
 * excludes, and it already knows that a TRACKED file is not ignored no matter
 * what a pattern says, which is the distinction a re-implementation always gets
 * wrong.
 *
 * Every failure answers "nothing is ignored": exit 1 is git saying so, exit 128
 * is "not a git repository", a spawn error is git not being installed, and a
 * timeout is a repository too strange to wait for. None of them justify
 * dropping a file from a digest a person is going to sign.
 */
export async function gitIgnoredPaths(repoDir: string, rels: string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  return new Promise<Set<string>>((done) => {
    const child = spawn("git", ["check-ignore", "--stdin", "-z"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    const out = collectStdout(child);
    child.on("error", () => done(new Set()));
    child.on("close", (code) => {
      // 0: some paths are ignored and are on stdout. 1: none are — an empty
      // answer, not a failure. Anything else, the overflow included: we
      // learned nothing, and nothing is ignored.
      done(
        (code === 0 || code === 1) && !out.overflowed()
          ? new Set(out.text().split("\0").filter((s) => s.length > 0))
          : new Set(),
      );
    });
    // A git that died before reading its input hands us EPIPE; the close
    // handler above is what decides the outcome either way.
    child.stdin.on("error", () => undefined);
    child.stdin.end(rels.join("\0") + "\0");
  });
}

/**
 * Who git says is working in this repository — `Name <email>`, or null when git
 * cannot answer.
 *
 * This is the only identity loam has, and it is deliberately a weak one: git
 * config is a text file anybody can edit, so `vouched_by` is a name, not a
 * signature, and it proves nothing cryptographically. What it does is make the
 * claim ATTRIBUTABLE — a `status: verified` with nobody's name against it says
 * only that some process wrote the word, which is exactly the state that let a
 * vouch be indistinguishable from an agent's own draft. A reviewer reading the
 * frontmatter, or `git log` on the docs repo, can now ask a specific person what
 * they read. Signing is the real answer and it is not this one; nothing here
 * pretends otherwise.
 *
 * `user.email` is what is required — it is the field git itself refuses to
 * commit without, so a repository where a person has ever committed has one —
 * and `user.name` rides along when it is set.
 */
export async function gitIdentity(repoDir: string): Promise<string | null> {
  // The environment first, because that is git's own precedence: GIT_COMMITTER_*
  // overrides `user.*` for the identity git records, and GIT_AUTHOR_* behind it.
  // Reading them is loam agreeing with git rather than inventing a second rule —
  // and it is the only identity a CI job or a container has, where there is no
  // `user.email` anywhere and running `git config --global` first would be a
  // step nobody documents.
  const fromEnv = identity(
    process.env.GIT_COMMITTER_NAME ?? process.env.GIT_AUTHOR_NAME,
    process.env.GIT_COMMITTER_EMAIL ?? process.env.GIT_AUTHOR_EMAIL,
  );
  if (fromEnv !== null) return fromEnv;
  const [name, email] = await Promise.all([
    gitConfig(repoDir, "user.name"),
    gitConfig(repoDir, "user.email"),
  ]);
  return identity(name ?? undefined, email ?? undefined);
}

/** `Name <email>`, or the bare email, or null — the one spelling of the stamp. */
function identity(name: string | undefined, email: string | undefined): string | null {
  const e = email?.trim();
  if (e === undefined || e === "") return null;
  const n = name?.trim();
  return n === undefined || n === "" ? e : `${n} <${e}>`;
}

/**
 * One `git config --get` value, or null for every way it can fail to be one:
 * unset (exit 1), not a repository, git not installed, a timeout. The caller
 * distinguishes none of them, and should not — they all mean "git will not tell
 * us who this is", and the fix is the same sentence in each case.
 */
async function gitConfig(repoDir: string, key: string): Promise<string | null> {
  return new Promise<string | null>((done) => {
    const child = spawn("git", ["config", "--get", key], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    const out = collectStdout(child);
    child.on("error", () => done(null));
    child.on("close", (code) => {
      const value = out.text().trim();
      done(code === 0 && !out.overflowed() && value !== "" ? value : null);
    });
  });
}
