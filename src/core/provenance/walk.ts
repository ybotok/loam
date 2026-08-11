/**
 * The source walk: expanding a `sources` list to the concrete files it covers
 * — found and skipped. What the walk refuses to follow is reported, never
 * dropped, because the digest downstream cannot go stale over bytes it never
 * hashed; the skipped list is how that hole stays visible.
 */
import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isPathInside, resolveInside } from "../kernel/path-safety.js";
import { gitIgnoredPaths } from "./git.js";

/** A path the walk found but would not hash, and the reason a reader needs. */
export interface SkippedSource {
  /** Repo-relative, `/`-separated. */
  path: string;
  /** Why it was left out — the half of the sentence after the path. */
  reason: string;
}

export interface SourceFile {
  /** Repo-relative, `/`-separated — the spelling that goes into the hash. */
  rel: string;
  abs: string;
}

/**
 * The files a `sources` list names: a file is itself, a directory is everything
 * beneath it. Nothing else — glob patterns used to be matched here, by a
 * hand-rolled dialect that silently differed from the gitignore/minimatch
 * conventions authors assume, so a pattern quietly digested a DIFFERENT file
 * set than its author intended. Pattern-looking entries are now refused loudly
 * upstream (see patternSources); this function only ever sees literal paths.
 *
 * Three exclusions, all part of the digest recipe's contract:
 *
 *  - dot-entries are skipped while walking — `.git` is not what the doc was
 *    written from — though a path naming one outright is still honoured;
 *  - `node_modules` is skipped the same way, unconditionally: it is the one
 *    build input every ecosystem agrees is not source, and it is the one that
 *    makes the walk take minutes;
 *  - anything the repository's own `.gitignore` covers is dropped, when the
 *    repo is a git checkout and git is on the PATH (see gitIgnoredPaths).
 *
 * The third is the one worth stating a reason for. `sources_digest` answers
 * "did the code move since a person read it", and BUILD OUTPUT moves on every
 * CI run without anybody touching the code — a `sources: [src/]` over a repo
 * that compiles into `src/generated/` went stale on a schedule, so the warning
 * that means "re-read this" arrived when nothing had been written. A signal
 * that fires every night is a signal people learn to close. Git's answer is
 * used rather than a list of our own because it is the answer the repository
 * already gives every other tool, and it is the author's to change.
 *
 * The fallback is deliberate: no git, no checkout, a git that errors — hash
 * everything. Missing an exclusion costs noise; inventing one costs a file the
 * stamp silently stops watching, and this walk exists to have nothing in that
 * category.
 */
export async function collectSources(
  repoDir: string,
  sources: string[],
): Promise<{ found: SourceFile[]; skipped: SkippedSource[] }> {
  const found = new Map<string, string>();
  const skipped = new Map<string, string>();
  const relOf = (abs: string): string => relative(repoDir, abs).split(sep).join("/");

  // realpath once, up front: every containment question below is asked against
  // the resolved root, so a repo reached through a symlink (a worktree under
  // /var -> /private/var on macOS, say) does not make its own files look external.
  const repoReal = await realpath(repoDir).catch(() => resolve(repoDir));
  // The realpaths of the directories currently being walked — the cycle guard.
  // A STACK rather than a set of everything ever entered, because the two rules
  // answer different questions: a directory reachable by two spellings (a
  // `current -> versions/3` link beside the real tree) is content under both
  // names and belongs in the digest twice, while a directory reachable from
  // INSIDE itself is a loop. A global visited-set conflates them, and then which
  // spelling survives depends on the order readdir happened to return — a
  // digest that differs between two machines holding identical bytes.
  const walking: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    // Sorted, so a tree walks the same way on every filesystem.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) await enterDir(child);
      else if (entry.isFile()) found.set(relOf(child), child);
      // readdir reports symlinks by lstat, so isDirectory() and isFile() are
      // BOTH false for one: before this branch existed a symlinked file, and a
      // whole subtree behind a symlinked directory, fell between the two arms
      // and left the digest without a word said. That is the failure this
      // module is here to prevent, arriving through its own walk.
      else if (entry.isSymbolicLink()) await follow(child);
    }
  };

  const enterDir = async (dir: string): Promise<void> => {
    const real = await realpath(dir).catch(() => null);
    if (real === null || walking.includes(real)) return;
    walking.push(real);
    try {
      await walk(dir);
    } finally {
      walking.pop();
    }
  };

  const follow = async (link: string): Promise<void> => {
    const real = await realpath(link).catch(() => null);
    if (real === null) {
      skipped.set(relOf(link), "a symlink that does not resolve");
      return;
    }
    // Outside the repo the file is not this service's to vouch for, and the
    // same rule already refuses it as a top-level `sources` entry
    // (sources.path-outside). Reported rather than dropped: an author who
    // vendored a sibling repo through a symlink needs to know the stamp stops
    // at the link.
    if (!isPathInside(repoReal, real)) {
      skipped.set(relOf(link), "a symlink whose target is outside this repository");
      return;
    }
    const info = await stat(link).catch(() => null);
    if (info === null) {
      skipped.set(relOf(link), "a symlink that does not resolve");
      return;
    }
    // A link's own spelling is what the doc's author wrote, so that is the path
    // that goes into the digest — the content comes from the target either way.
    if (info.isFile()) found.set(relOf(link), link);
    // A link that closes a loop is not reported: everything behind it is already
    // in the digest under the spelling it was reached by, so nothing has stopped
    // being watched. Only unhashed CONTENT is worth a warning.
    else if (info.isDirectory()) await enterDir(link);
    else skipped.set(relOf(link), "a symlink to neither a file nor a directory");
  };

  for (const source of sources) {
    const cleaned = source.trim();
    if (cleaned.length === 0) continue;
    const root = resolveInside(repoDir, cleaned, `source '${source}'`);
    const info = await stat(root).catch(() => null);
    if (info === null) continue;
    if (info.isFile()) found.set(relOf(root), root);
    else if (info.isDirectory()) await enterDir(root);
  }

  // One git invocation for the whole expansion, not one per file: the skipped
  // list rides along so an ignored symlink does not warn about a path the
  // repository already says is not its own.
  const ignored = await gitIgnoredPaths(repoDir, [...found.keys(), ...skipped.keys()]);
  for (const rel of ignored) {
    found.delete(rel);
    skipped.delete(rel);
  }

  return {
    // Plain codepoint order, not locale order: the digest has to be the same
    // everywhere it is computed.
    found: [...found.entries()]
      .map(([rel, abs]) => ({ rel, abs }))
      .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)),
    skipped: [...skipped.entries()]
      .map(([path, reason]) => ({ path, reason }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}
