/**
 * The subsystem surface's git questions, beside the provenance ones
 * (`../git.ts`) whose `gitText` — one spawn, its timeout and its capped
 * stdout reader — they ask through. A package of their own because `git.ts`
 * sat against the then 300-line limit and these three are one subject: what a
 * `subsystem move` must know before renaming (`gitDirtyPaths`), what
 * `subsystem history` asks after (`gitRenameHops`), and the ONE write the
 * roadmap blesses (`gitStageRenames` — "move stages renames without
 * committing"). `verify --service` asks `gitDirtyPaths` too, about the tree
 * an attestation is recorded from. The doctrine is unchanged: every way git
 * can decline reads as "git will not say", never as an error a caller must
 * handle — and what that MEANS is each caller's to say.
 */
import { gitText } from "../git.js";

/**
 * Which paths under these pathspecs (cwd-relative, magic allowed — verify
 * passes `.` and `:(exclude,literal)…`) carry UNCOMMITTED work — anything
 * `git status --porcelain` reports beneath them, untracked files included: an
 * untracked file is exactly a change no commit records. Paths come back as
 * git spells them, from the repository's top. Null for every way git declines
 * (not a repository, not installed, a timeout, a non-zero exit), and the two
 * callers read null in opposite directions on purpose: `subsystem move`'s
 * only refusal proceeds (a refusal needs positive evidence, and a fleet that
 * does not use git must not be refused a move over it), while
 * `verify --service` flags the attestation (a binding check that could not
 * run is not a passed one).
 *
 * `--untracked-files=normal` is spelled, not defaulted: porcelain v1 obeys
 * the user's `status.showUntrackedFiles`, and `no` — a common speed setting
 * in a large monorepo — made a tree of new, untracked code read as clean to
 * both callers.
 *
 * `-z` for the same reason `gitTrackedFiles` uses it: line output QUOTES
 * paths with spaces or non-ASCII bytes. A rename entry (`R ` when something
 * is already staged) carries a second NUL-separated path; both belong in the
 * answer.
 */
export async function gitDirtyPaths(repoDir: string, rels: string[]): Promise<string[] | null> {
  if (rels.length === 0) return [];
  const a = await gitText(repoDir, ["status", "--porcelain", "-z", "--untracked-files=normal", "--", ...rels]);
  if (a.code !== 0 || a.overflowed) return null;
  const tokens = a.out.split("\0").filter((t) => t !== "");
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
  return paths;
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
  const a = await gitText(repoDir, ["log", "--follow", "--diff-filter=R", "--name-status", "-z", "--format=%H", "--", rel]);
  if (a.code !== 0 || a.overflowed) return null;
  const tokens = a.out.split("\0").map((t) => (t.startsWith("\n") ? t.slice(1) : t));
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
  return hops.reverse();
}

/**
 * Was the rename record that produced a hop into `dest` at `commit` a GUESS?
 * `git log --follow` pairs old and new paths by CONTENT similarity, and two
 * identical files moved (or one moved while its twin is created or deleted)
 * in the same commit give it a coin to flip — subsystem markers are routinely
 * byte-identical (often empty), so a multi-directory move can report a hop
 * from a directory the followed file never occupied. The cross-check asks the
 * commit itself: if two or more of its diff entries carry the same blob as
 * the one `dest` received, the pairing chose between equals and the hop is
 * not evidence. `false` = unambiguous; `true` = a guess; null = git will not
 * say — and the caller must treat BOTH non-false answers as "will not say",
 * because repeating a maybe-phantom hop is worse than answering nothing.
 */
export async function gitRenamePairingAmbiguous(
  repoDir: string,
  commit: string,
  dest: string,
): Promise<boolean | null> {
  const a = await gitText(repoDir, ["diff-tree", "-r", "-M", "-z", commit]);
  if (a.code !== 0 || a.overflowed) return null;
  // `-z` raw form: `:<mode> <mode> <sha> <sha> <status>` NUL, then one
  // path token — two for a rename/copy. The leading token is the commit.
  const tokens = a.out.split("\0").filter((t) => t !== "");
  const entries: { srcSha: string; dstSha: string; status: string; paths: string[] }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!token.startsWith(":")) continue;
    const fields = token.slice(1).split(" ");
    const status = fields[4] ?? "";
    const paths = status.startsWith("R") || status.startsWith("C") ? [tokens[i + 1], tokens[i + 2]] : [tokens[i + 1]];
    entries.push({
      srcSha: fields[2] ?? "",
      dstSha: fields[3] ?? "",
      status,
      paths: paths.filter((p): p is string => p !== undefined),
    });
    i += paths.length;
  }
  const own = entries.find((e) => e.status.startsWith("R") && e.paths[1] === dest);
  // The hop's own rename is not in the commit's record — an answer this
  // check cannot ground is an answer git will not give.
  if (own === undefined) return null;
  const twins = entries.filter((e) => e.srcSha === own.dstSha || e.dstSha === own.dstSha);
  return twins.length > 1;
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
  await gitText(repoDir, ["add", "-A", "--", ...rels]);
}
