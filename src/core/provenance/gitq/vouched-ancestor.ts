/**
 * Doc-body ancestry in the DOCS repo — the two git questions behind
 * `loam vouch --pack`'s body delta: which commit last held the body a person
 * vouched for (`findVouchedAncestor`), and what the file's diff from that
 * commit to the working tree says (`bodyDiffText`). Read-only throughout:
 * `rev-parse`/`log`/`show`/`diff`, no checkout, no temp writes.
 *
 * The mechanics are `core/diff/base-git.ts`'s to the letter — literally so:
 * both import the one `gitText`/`GitAnswer`/`declineDetail` set from
 * `../git.js`, so a hardening lands in both or in neither — but the doctrine
 * is deliberately the OPPOSITE consequence. `loam diff` REFUSES when git
 * cannot answer, because a silently empty base would report the whole fleet
 * as added — a lie with a green exit code. The pack DEGRADES to "full read"
 * instead: its output is a reading list, and for a reading list the
 * conservative direction — read more, never less — is always honest, the same
 * direction as provenance's existing hash-everything fallback. The shared
 * helpers carry no verdict, so neither module can borrow the other's
 * consequence by accident; each spells its own at its own call sites.
 *
 * The walk is BOUNDED at `ANCESTOR_WALK_CAP` commits. A vouched commit pushed
 * past the cap by a very active docs repo degrades a legitimate incremental
 * read to a full read — safe direction, and the `none` reason names the cap
 * so the human understands why. Within the walk, one commit whose version of
 * the file is absent (git answering "not here") is skipped; a git that stops
 * answering mid-walk (spawn error, kill, timeout, output cap) aborts the whole
 * search as `no-git` rather than letting 200 futile spawns each wait out the
 * timeout.
 */
import { declineDetail, gitText, type GitAnswer } from "../git.js";
import { contentDigest } from "../stamp.js";

/**
 * How many commits touching the file the ancestor search will read before
 * declaring the vouched state unreachable. Past it the answer is `none` — a
 * full read — with a reason that names the cap.
 */
const ANCESTOR_WALK_CAP = 200;

/**
 * How much diff text the pack will print. A body diff past this is not a
 * reading list any more — the honest answer is "read the file", as `failed`.
 */
const MAX_DIFF_TEXT_CHARS = 1024 * 1024;

/**
 * The shared `gitText` (`../git.js`) with colour forced off. base-git's three
 * questions (`rev-parse`/`ls-tree`/`show`) never colour, but this module runs
 * `log` and `diff`, and a user's `color.ui = always` forces SGR escape
 * sequences into their output even on a pipe — which would put terminal codes
 * inside the `--json` payload's diff text and make the 40-hex-anchored log
 * walk silently match nothing on exactly that machine. The flag lives here,
 * not in the shared helper, because it is this module's need, not a property
 * of asking git a question.
 */
async function gitPlain(docsDir: string, args: string[]): Promise<GitAnswer> {
  return gitText(docsDir, ["-c", "color.ui=false", ...args]);
}

/**
 * The bytes this commit's blob would carry on a CRLF checkout. The stamped
 * `content_digest` is byte-exact over the WORKING-TREE file (stamp.ts), while
 * `git show` hands back the BLOB — and on a Windows checkout with
 * `core.autocrlf=true` the blob is LF where every working-tree byte is CRLF,
 * so the exact digest of the blob would never equal a stamp taken over the
 * same content and every vouched ancestor would be invisible on exactly those
 * machines. Same hazard, same direction as `core/verify/pins/pin.ts`'s
 * `pinnedDigest`, resolved the inverse way because the stamp's recipe is
 * published and cannot be re-normalized after the fact: instead of
 * normalizing both sides, the search hashes each candidate twice — as the
 * blob is, and as its CRLF checkout rendering — and a match on either is a
 * match. Only lone LFs are rewritten, so a blob that already carries CRLFs
 * (committed without the clean filter, hence byte-identical on disk) is
 * covered by the exact hash.
 */
function checkoutRendering(text: string): string {
  return text.replace(/(?<!\r)\n/g, "\r\n");
}

export type AncestorSearch =
  | {
      kind: "found";
      commit: string;
      /** The file exactly as that commit holds it — what the section delta reads. */
      text: string;
    }
  /** The walk completed and nothing matched — the honest verdict is a full read. */
  | { kind: "none"; reason: string }
  /** Git declined somewhere the walk could not continue past — also a full read. */
  | { kind: "no-git"; detail: string };

/**
 * The last commit in the docs repo's history whose version of `rel` (a
 * docs-relative, `/`-separated path) has a body hashing to the stamped
 * `content_digest` — newest first, because the reading list wants the
 * SHORTEST honest diff, and any older commit holding the same bytes yields
 * the same one.
 */
export async function findVouchedAncestor(
  docsDir: string,
  rel: string,
  stampedDigest: string,
): Promise<AncestorSearch> {
  // Belt to the callers' braces: `rel` is derived from loam's own path
  // spelling, never argv, but every spelled pathspec below rides an argv, so
  // an option-shaped or empty value is refused here rather than parsed by
  // git as a flag. Same reason base-git.ts refuses option-shaped refs.
  if (rel.trim() === "" || rel.startsWith("-")) {
    return { kind: "no-git", detail: `'${rel}' is not a path git can be asked about.` };
  }
  // `--show-prefix` first, and not decoration (base-git.ts proved this): a
  // docs repo checked out as a subdirectory of a larger repository answers
  // `show` only under that prefix, and a walk whose paths all miss would
  // report "no vouched ancestor" about a history that holds one.
  const where = await gitPlain(docsDir, ["rev-parse", "--show-prefix"]);
  if (where.spawnError !== undefined || where.code !== 0) {
    return { kind: "no-git", detail: declineDetail(where) };
  }
  const prefix = where.out.trim();

  // The pathspec is cwd-relative (no prefix — `log` resolves it against the
  // cwd, unlike `show`'s repo-root spelling below). `-n` is the walk's bound.
  const log = await gitPlain(docsDir, [
    "log", "-n", String(ANCESTOR_WALK_CAP), "--format=%H", "--", rel,
  ]);
  if (log.spawnError !== undefined || log.code !== 0 || log.overflowed) {
    return { kind: "no-git", detail: declineDetail(log) };
  }
  // Only shas shaped like shas walk on — an unexpected line yields a shorter
  // walk, never a malformed argv (the gitq/moves.ts token-anchoring rule).
  const commits = log.out.split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{40}$/.test(l));
  // Sequential on purpose: newest-first order is the answer's definition, and
  // the walk stops at the first match — a fan-out would read history it does
  // not need and could answer with an older commit than the newest match.
  for (const commit of commits) {
    const shown = await gitPlain(docsDir, ["show", `${commit}:${prefix}${rel}`]);
    if (shown.spawnError !== undefined || shown.code === null) {
      // Git stopped answering (not installed mid-walk, killed, timed out, or
      // the output cap fired on a monstrous version). Abort rather than walk
      // on: each further spawn could wait out the whole timeout, and a "none"
      // built over commits nobody read would claim the history was searched.
      return {
        kind: "no-git",
        detail: shown.overflowed
          ? `the file at ${commit.slice(0, 12)} exceeds the git output cap.`
          : declineDetail(shown),
      };
    }
    // A real non-zero exit is git ANSWERING — the file is absent at this
    // commit (renamed since, or the commit only deleted it). Skip it.
    if (shown.code !== 0) continue;
    if (
      contentDigest(shown.out) === stampedDigest ||
      contentDigest(checkoutRendering(shown.out)) === stampedDigest
    ) {
      return { kind: "found", commit, text: shown.out };
    }
  }
  return {
    kind: "none",
    reason:
      commits.length < ANCESTOR_WALK_CAP
        ? "body has no vouched ancestor in history"
        : `body has no vouched ancestor in history — only the last ${ANCESTOR_WALK_CAP} commits touching the file were walked, and the vouched state may lie beyond them`,
  };
}

export type BodyDiff =
  | { kind: "ok"; diff: string }
  /** No diff to print — the honest degrade is a full read, with this reason. */
  | { kind: "failed"; reason: string };

/**
 * The file's diff from its last vouched state: `git diff <commit> -- <rel>`,
 * commit-to-working-tree, in the docs repo. The output is git's own — when a
 * hand edit touched the frontmatter after the vouch, its hunks ride along,
 * which is why the pack's prose says "the file's diff", never "the body's".
 */
export async function bodyDiffText(docsDir: string, commit: string, rel: string): Promise<BodyDiff> {
  // The commit came out of `findVouchedAncestor`'s own regex-vetted walk, but
  // this function is exported API: re-vet, so no future caller can place an
  // option-shaped string in the one argv slot that is not behind `--`.
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    return { kind: "failed", reason: `'${commit}' is not a commit this diff can be asked about.` };
  }
  if (rel.trim() === "" || rel.startsWith("-")) {
    return { kind: "failed", reason: `'${rel}' is not a path git can be asked about.` };
  }
  // `--no-optional-locks`: a commit-to-worktree diff may opportunistically
  // refresh `.git/index`'s stat cache, which is a WRITE — small, benign, and
  // exactly what a command documented as "writes nothing" must not do. The
  // global flag tells git to skip any operation that would take a lock it
  // does not strictly need. `--no-ext-diff --no-textconv` close the rest of
  // the config surface: `diff.external` / a `.gitattributes` diff driver make
  // `git diff` EXECUTE a user-configured program instead of printing a diff —
  // an arbitrary write hazard on a read-only path, and output no machine
  // consumer of `body.diff` could parse. The pack's diff is a machine
  // artifact, not a terminal rendering; git's own plumbing flags say so.
  const answer = await gitPlain(docsDir, [
    "--no-optional-locks", "diff", "--no-ext-diff", "--no-textconv", commit, "--", rel,
  ]);
  if (answer.spawnError !== undefined || answer.code !== 0 || answer.overflowed) {
    return { kind: "failed", reason: declineDetail(answer) };
  }
  if (answer.out.length > MAX_DIFF_TEXT_CHARS) {
    return { kind: "failed", reason: "the body diff exceeds the pack's print cap — read the file" };
  }
  return { kind: "ok", diff: answer.out };
}
