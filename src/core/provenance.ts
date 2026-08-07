/**
 * Provenance checks: is this artifact anchored to anything, and has anyone
 * vouched for it?
 *
 * SCHEMA.md has declared `status` / `owner` / `sources` / `last_verified` since
 * the beginning and nothing read them. They matter more now that the prose is
 * written by an agent: coherence proves the corpus agrees with itself, and only
 * `sources` says it has anything to do with the code.
 *
 * Absence and contradiction are graded differently on purpose. A missing field
 * is incompleteness — a warning, something to work through. A field that says
 * the wrong thing (a spec claiming to be another service, a status nobody
 * defined) is a bug, and gates.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  listField,
  parseFrontmatter,
  rawBody,
  readFrontmatter,
  stringField,
  FEATURE_STATUSES,
  SERVICE_STATUSES,
  type Frontmatter,
} from "./frontmatter.js";
import type { Finding } from "./report.js";
import { featurePaths, servicePaths, SPEC_AXES } from "./repo.js";
import { isPathInside, resolveInside } from "./path-safety.js";

/** Fields every artifact is expected to carry, beyond its identity and status. */
const EXPECTED = ["owner"] as const;

export interface ProvenanceOptions {
  /**
   * The repo `sources` resolve against — the service repo loam is running in.
   * Undefined when the docs being validated describe some other repository, in
   * which case the paths are not ours to resolve and are left alone.
   */
  repoDir?: string;
}

export async function serviceProvenance(
  docsDir: string,
  service: string,
  opts: ProvenanceOptions = {},
): Promise<Finding[]> {
  const paths = servicePaths(docsDir, service);
  const findings: Finding[] = [];
  // Both requirement-carrying specs get the same pass: arch.spec.md follows
  // spec.md's frontmatter conventions exactly, so the checks are one loop —
  // only the label tells a reader which file moved. The pair comes from
  // SPEC_AXES rather than being respelled, so a third axis is graded here the
  // day it is declared instead of the day somebody notices.
  for (const { path, file } of SPEC_AXES.map((axis) => ({ path: paths[axis.key], file: axis.file }))) {
    if (!existsSync(path)) continue;
    const raw = await readFile(path, "utf8");
    const fm = parseFrontmatter(raw);
    const label = `${service}: ${file}`;
    findings.push(
      ...identityFindings(fm, {
        label,
        idField: "service",
        idValue: service,
        statuses: [...SERVICE_STATUSES],
      }),
    );
    // With no frontmatter at all, "it names no sources" says nothing the missing
    // header did not already say — and a malformed one proves nothing either:
    // `sources.absent` against a header nobody can read is the same false
    // advice as the field cascade, so frontmatter.malformed stands alone.
    if (fm.present && !fm.malformed) {
      findings.push(...(await sourceFindings(fm, service, label, opts.repoDir)));
      findings.push(...contentFindings(fm, raw, service, label));
    }
  }
  return findings;
}

export async function featureProvenance(
  featureDir: string,
  featureId: string,
): Promise<Finding[]> {
  const path = featurePaths(featureDir).intent;
  if (!existsSync(path)) return [];
  const fm = await readFrontmatter(path);
  return identityFindings(fm, {
    label: "intent.md",
    idField: "feature",
    idValue: featureId,
    statuses: [...FEATURE_STATUSES],
  });
}

interface IdentitySpec {
  label: string;
  idField: "service" | "feature";
  idValue: string;
  statuses: string[];
}

function identityFindings(fm: Frontmatter, spec: IdentitySpec): Finding[] {
  const findings: Finding[] = [];
  if (!fm.present) {
    return [
      {
        severity: "warn",
        code: "frontmatter.missing",
        subject: spec.idValue,
        message: `${spec.label} has no frontmatter — no owner, no status, no link to the code it describes`,
      },
    ];
  }

  // One honest error instead of the cascade: with an unreadable header the
  // field checks below would grade owner/status/service "missing" and send the
  // author adding fields to a block YAML refuses to parse. Nothing can be
  // concluded from a header nobody can read — including that it lacks fields.
  if (fm.malformed) {
    return [
      {
        severity: "error",
        code: "frontmatter.malformed",
        subject: spec.idValue,
        message: `${spec.label} has frontmatter that does not parse as YAML — owner, status and sources are unreadable until the header is fixed`,
      },
    ];
  }

  const id = stringField(fm, spec.idField);
  if (id !== undefined && id !== spec.idValue) {
    findings.push({
      severity: "error",
      code: "frontmatter.field-mismatch",
      subject: spec.idValue,
      message: `${spec.label} declares ${spec.idField}: ${id}, but it lives under ${spec.idValue}`,
    });
  }

  const status = stringField(fm, "status");
  if (status !== undefined && !spec.statuses.includes(status)) {
    findings.push({
      severity: "error",
      code: "frontmatter.status-unknown",
      subject: spec.idValue,
      message: `${spec.label} has status '${status}' — expected one of ${spec.statuses.join(", ")}`,
    });
  }

  const missing = [
    ...(id === undefined ? [spec.idField] : []),
    ...(status === undefined ? ["status"] : []),
    ...EXPECTED.filter((f) => stringField(fm, f) === undefined),
  ];
  if (missing.length > 0) {
    findings.push({
      severity: "warn",
      code: "frontmatter.field-missing",
      subject: spec.idValue,
      message: `${spec.label} is missing ${missing.length} frontmatter field(s)`,
      details: missing,
      text: { detailPrefix: "- " },
    });
  }
  return findings;
}

async function sourceFindings(
  fm: Frontmatter,
  service: string,
  label: string,
  repoDir: string | undefined,
): Promise<Finding[]> {
  const sources = listField(fm, "sources");
  if (sources.length === 0) {
    return [
      {
        severity: "warn",
        code: "sources.absent",
        message: `${label} names no sources — nothing ties it to the code, so nothing can tell you when it goes out of date`,
      },
    ];
  }
  // Someone else's repository: the paths describe a tree loam is not standing in.
  if (repoDir === undefined) return [];

  // Before existence: a pattern entry would "not exist" as a literal path, and
  // grading it missing would send the author fixing the wrong thing.
  const patterns = patternSources(sources);
  if (patterns.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${patterns.length} source(s) are glob patterns — ${patterns.join(", ")}. Patterns are no longer supported: name files or directories (a directory already covers everything beneath it).`,
        details: patterns,
        text: { detailPrefix: "- " },
      },
    ];
  }

  const unsafe = unsafeSources(repoDir, sources);
  if (unsafe.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-outside",
        message: `${label}: ${unsafe.length} source(s) escape the service repo — ${unsafe.join(", ")}. Sources must be relative paths contained by this repository, including through symlinks.`,
        details: unsafe,
        text: { detailPrefix: "- " },
      },
    ];
  }

  const missing = missingSources(repoDir, sources);
  if (missing.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${missing.length} source(s) do not exist — ${missing.join(", ")}`,
        details: missing,
        text: { detailPrefix: "- " },
      },
    ];
  }
  const resolved: Finding = {
    severity: "ok",
    code: "sources.resolved",
    message: `${label}: ${sources.length} source(s) resolve`,
  };

  // The walk happens here rather than inside the staleness branch below, even
  // though only staleness needs the hashes: what the walk REFUSED to follow is
  // a hole in the tie to the code whether or not anybody has vouched yet, and
  // an unvouched service is exactly where a reader is about to decide the
  // sources list is honest.
  const { digest, files, index, skipped } = await sourcesDigest(repoDir, sources);
  const findings: Finding[] = [resolved, ...skippedFindings(skipped, label)];

  // The paths are there; the question staleness answers is whether what is AT
  // them is still what somebody read.
  const stamped = stringField(fm, "sources_digest");
  if (stamped === undefined) {
    return [
      ...findings,
      {
        severity: "warn",
        code: "sources.unvouched",
        message: `${label}: no sources_digest — nobody has vouched for this against the code, so nothing can tell you when it goes stale. Run \`loam vouch --service ${service}\`.`,
      },
    ];
  }

  const since = stringField(fm, "last_verified") ?? "it was stamped";
  if (digest === stamped) {
    return [
      ...findings,
      {
        severity: "ok",
        code: "sources.current",
        message: `${label}: sources unchanged since ${since} (${files.length} file(s), digest ${digest})`,
      },
    ];
  }

  // What MOVED, when the stamp recorded enough to say. Repeating the frontmatter's
  // own `sources` entries back at a reader — which is all this finding could do
  // before `sources_files` existed — answers a question nobody asked: they wrote
  // that list, and "one of these five directories changed somehow" is where the
  // search starts, not where it ends.
  const moved = movedSources(decodeSourceIndex(stringField(fm, "sources_files")), index);
  return [
    ...findings,
    {
      // A warning, not an error: the doc may still be right, and only a person
      // can say. What loam knows is that nobody has looked since the code moved.
      severity: "warn",
      code: "sources.stale",
      message: `${label}: sources changed since ${since}${moved.summary} — re-read them and \`loam vouch --service ${service}\``,
      details: moved.paths ?? sources,
      text: { detailPrefix: "- " },
    },
  ];
}

/**
 * The paths the digest walk would not follow. Never silent: a symlink dropped
 * on the floor is a file whose content nobody is watching, while the document
 * beside it says `verified` — the digest cannot go stale over bytes it never
 * hashed, so the one thing the stamp promises is quietly untrue for them.
 *
 * A warning, not an error, and for the same reason staleness is: the doc may be
 * perfectly right about the code behind that link. What loam can say is that it
 * is not watching it.
 */
function skippedFindings(skipped: SkippedSource[], label: string): Finding[] {
  if (skipped.length === 0) return [];
  return [
    {
      severity: "warn",
      code: "sources.skipped",
      message: `${label}: ${skipped.length} path(s) under the listed sources were not hashed — the digest says nothing about what is behind them`,
      details: skipped.map((s) => `${s.path} — ${s.reason}`),
      text: { detailPrefix: "- " },
    },
  ];
}

/**
 * The doc-side half of the freshness check. `sources_digest` says whether the
 * CODE moved since a person looked, and only that service's repo can recompute
 * it; `content_digest` says whether the DOCUMENT did, and needs nothing but
 * the document — so this runs wherever the spec is readable, `--service` and
 * `--all` alike. Without it, editing a spec after it was vouched left
 * `status: verified` standing over words nobody read — forged freshness, in
 * the exact agent-written-prose threat model this layer exists for.
 */
function contentFindings(fm: Frontmatter, raw: string, service: string, label: string): Finding[] {
  if (stringField(fm, "status") !== "verified") return [];
  const stamped = stringField(fm, "content_digest");
  // A verified doc with no stamp predates the field. Quiet on purpose: the fix
  // is re-vouching, and grading years of pre-feature vouches as suspect would
  // drown the fleet in warnings nobody chose.
  if (stamped === undefined) return [];
  if (contentDigest(raw) === stamped) return [];
  const since = stringField(fm, "last_verified") ?? "it was vouched";
  return [
    {
      // A warning, not an error — the sources.stale doctrine: the doc changed
      // since it was vouched, and only a person can say whether verified still
      // holds of the new words.
      severity: "warn",
      code: "content.stale",
      message: `${label} changed since ${since} — the doc moved under its vouch, and only a person can say whether 'verified' still holds. Re-read it and \`loam vouch --service ${service}\`.`,
    },
  ];
}

/**
 * The local calendar day, for the two commands that date a stamp. A vouch or a
 * verification record is a person saying "today I read this", so it is their
 * date, not UTC's — `toISOString` files an evening in the Americas under
 * tomorrow. It sits here because this module already owns the stamp vocabulary
 * the date is written into.
 */
export function today(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ------------------------------------------------------------------ */
/* The content digest                                                  */
/* ------------------------------------------------------------------ */

/** How much of the sha256 is written into the document. */
const DIGEST_LENGTH = 16;

/** How many source files the digest reads at once — see `sourcesDigest`. */
const DIGEST_READ_BATCH = 32;

export interface SourcesDigest extends SourcesExpansion {
  /** The stamp that goes in `sources_digest`. */
  digest: string;
  /**
   * Per file, its own short sha — the record `sources_files` carries so a later
   * `sources.stale` can name what moved instead of guessing. Same order as `files`.
   */
  index: SourceIndexEntry[];
}

/** One file's share of the stamp: what it is called, and what it said. */
export interface SourceIndexEntry {
  /** Repo-relative, `/`-separated. */
  path: string;
  /** sha256 of its bytes, truncated the way `sources_digest` is. */
  sha: string;
}

/** A path the walk found but would not hash, and the reason a reader needs. */
export interface SkippedSource {
  /** Repo-relative, `/`-separated. */
  path: string;
  /** Why it was left out — the half of the sentence after the path. */
  reason: string;
}

/** What a `sources` list covers, and what it does not. */
export interface SourcesExpansion {
  /** Repo-relative paths, sorted — exactly what a digest would hash. */
  files: string[];
  /** Everything the walk refused to follow. Empty in the ordinary case. */
  skipped: SkippedSource[];
  /**
   * Set only when `files` is empty: the one sentence that says the list covers
   * nothing. `loam vouch` refuses with it, `loam validate` grades it — see
   * emptySourcesMessage for why they must be the same words.
   */
  empty?: string;
}

/**
 * Digest the CONTENT of the files `sources` names. The recipe is spelled out
 * because the value is written into documents, and anything reading them has to
 * be able to reproduce it:
 *
 *   1. expand each entry to repo-relative file paths (`/` separators) — a file
 *      is itself, a directory everything beneath it, minus what the repository
 *      does not consider its own (see collectSources) — sorted and de-duplicated;
 *   2. per file, `sha256(bytes)`;
 *   3. feed `<path>\0<hex>\n` for each file, in that order, into an outer
 *      sha256;
 *   4. keep the first 16 hex characters.
 *
 * Content, not mtime: git does not preserve modification times, so after a
 * fresh clone every file looks changed and the check would be false positives
 * end to end. Bytes survive the clone. Hashing the path alongside the content
 * means a rename registers, which is what a reader of the doc would want.
 *
 * 64 bits is a change detector, not a seal — it answers "did this move?", and
 * an adversary who wants a collision can have one.
 */
export async function sourcesDigest(repoDir: string, sources: string[]): Promise<SourcesDigest> {
  const { found, skipped } = await collectSources(repoDir, sources);
  const outer = createHash("sha256");
  const index: SourceIndexEntry[] = [];
  // Read in fixed batches, hash in array order. `found` is already sorted and
  // every file's own sha depends on nothing but its own bytes, so the sequence
  // fed to `outer` — and therefore the digest — is unchanged by construction;
  // only the waiting overlaps. A `sources: [src/]` over a real service repo is
  // thousands of files, and one-await-per-file spent nearly all of its time
  // idle. The batch is bounded rather than a single `Promise.all` over the
  // whole list because an unbounded fan-out over a source tree runs the process
  // out of file descriptors, which would turn a stamp into an EMFILE.
  for (let start = 0; start < found.length; start += DIGEST_READ_BATCH) {
    const hashed = await Promise.all(
      found.slice(start, start + DIGEST_READ_BATCH).map(async (file) => ({
        rel: file.rel,
        content: createHash("sha256").update(await readFile(file.abs)).digest("hex"),
      })),
    );
    for (const { rel, content } of hashed) {
      outer.update(`${rel}\0${content}\n`);
      index.push({ path: rel, sha: content.slice(0, DIGEST_LENGTH) });
    }
  }
  // `empty` is deliberately not set here: it is a sentence about a named
  // document, and a digest has no name to put in it. Callers that need it say
  // emptySourcesMessage(label, sources) — the same words, from one definition.
  return { digest: outer.digest("hex").slice(0, DIGEST_LENGTH), files: index.map((e) => e.path), index, skipped };
}

/**
 * What a `sources` list actually covers — the digest's file set without the
 * hashing.
 *
 * Exported because two commands must give the SAME answer to "does this list
 * cover anything?". `loam vouch` refuses to stamp an expansion that covers no
 * files (a digest over nothing never changes, so the stamp would read as
 * current forever), and until `loam validate` could say the same thing in the
 * same words, an author got a green validate followed by a vouch that refused —
 * two commands contradicting each other about one document, with nothing in the
 * green run hinting at it.
 */
export async function expandSourceFiles(
  repoDir: string,
  sources: string[],
  label: string,
): Promise<SourcesExpansion> {
  const { found, skipped } = await collectSources(repoDir, sources);
  const files = found.map((f) => f.rel);
  return { files, skipped, ...(files.length === 0 ? { empty: emptySourcesMessage(label, sources) } : {}) };
}

/**
 * The one sentence for "these paths exist and cover no file". One definition,
 * because `vouch`'s refusal and `validate`'s finding are the same diagnosis
 * about the same document and must not drift into two descriptions of it — the
 * author fixes it once, in the sources list.
 */
export function emptySourcesMessage(label: string, sources: string[]): string {
  return `${label}: the sources listed match no files — ${sources.join(", ")}. A digest over nothing would read as current forever.`;
}

/**
 * The stamp `loam vouch` writes into `content_digest`: sha256 of the
 * document's own BODY — every byte after the frontmatter block (below the
 * closing `---` line and its newline; `rawBody` is the one definition of that
 * cut) — first 16 hex characters, the sources recipe's length.
 *
 * Byte-exact, no normalization. Body-only is load-bearing: vouch itself
 * rewrites the frontmatter as it stamps, and a later frontmatter-only edit
 * (another vouch, a corrected owner) must not read as the document moving.
 */
export function contentDigest(source: string): string {
  return createHash("sha256").update(rawBody(source), "utf8").digest("hex").slice(0, DIGEST_LENGTH);
}

interface SourceFile {
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
async function collectSources(
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

/** How long the digest waits on git before deciding it learned nothing. */
const GIT_TIMEOUT_MS = 10_000;

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
async function gitIgnoredPaths(repoDir: string, rels: string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  return new Promise<Set<string>>((done) => {
    const child = spawn("git", ["check-ignore", "--stdin", "-z"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => done(new Set()));
    child.on("close", (code) => {
      // 0: some paths are ignored and are on stdout. 1: none are — an empty
      // answer, not a failure. Anything else: we learned nothing.
      done(code === 0 || code === 1 ? new Set(out.split("\0").filter((s) => s.length > 0)) : new Set());
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
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => done(null));
    child.on("close", (code) => {
      const value = out.trim();
      done(code === 0 && value !== "" ? value : null);
    });
  });
}

/* ------------------------------------------------------------------ */
/* The per-file index: what `sources.stale` names                      */
/* ------------------------------------------------------------------ */

/**
 * How many files `sources_files` will list one by one before it gives up and
 * records only how many there were.
 *
 * A readability budget, not a correctness one: the index lives in the header of
 * a document a person reads, and a `sources: [src/]` over a legacy service can
 * expand to thousands of files. Past the limit `sources.stale` falls back to
 * repeating the `sources` entries — worse advice, but a spec.md whose
 * frontmatter is longer than its requirements is worse still.
 */
const SOURCE_INDEX_LIMIT = 100;

/**
 * The `sources_files` value `loam vouch` stamps beside `sources_digest`: one
 * `<sha>  <path>` line per file (sha256sum's layout, and its column order, so
 * the path may contain spaces), or just the file count once the list would run
 * past SOURCE_INDEX_LIMIT.
 *
 * Its whole purpose is the next `sources.stale`. `sources_digest` can say THAT
 * the code moved and never which part of it; with the index a reader gets the
 * added, removed and changed paths, which is the difference between re-reading
 * one file and re-reading a directory. It is also a readable git diff in the
 * docs repo: the vouch commit shows exactly which source files the stamp now
 * stands over.
 */
export function encodeSourceIndex(index: SourceIndexEntry[]): string {
  if (index.length > SOURCE_INDEX_LIMIT) return String(index.length);
  return index.map((e) => `${e.sha}  ${e.path}`).join("\n");
}

/** What a stamped `sources_files` says: the per-file shas, the count, or nothing. */
interface StampedIndex {
  /** path -> sha, or null when the stamp did not record them. */
  entries: Map<string, string> | null;
  /** How many files the stamp covered, when that is knowable. */
  count?: number;
}

/**
 * Read back what `encodeSourceIndex` wrote. Anything unrecognised reads as "the
 * stamp said nothing" rather than as an empty index: a header nobody can parse
 * must not turn into a `sources.stale` claiming every file was deleted.
 */
function decodeSourceIndex(stamped: string | undefined): StampedIndex {
  if (stamped === undefined) return { entries: null };
  const text = stamped.trim();
  if (text.length === 0) return { entries: null };
  if (/^\d+$/.test(text)) return { entries: null, count: Number(text) };

  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{16})\s+(.+)$/.exec(line.trim());
    if (match === null) return { entries: null };
    entries.set(match[2]!, match[1]!);
  }
  return { entries, count: entries.size };
}

/** The paths that moved between a stamp and now, with a phrase for the message. */
interface MovedSources {
  /** Annotated paths, or undefined when the stamp did not record enough to say. */
  paths?: string[];
  /** Appended to the `sources.stale` message; empty when there is nothing to add. */
  summary: string;
}

/**
 * added / removed / changed, from the stamped index against the current one.
 * The annotation travels IN the detail line rather than in three separate
 * lists: a reader scanning a stale report wants the paths in one column, and
 * "which of the three" is one word wide.
 */
function movedSources(stamp: StampedIndex, now: SourceIndexEntry[]): MovedSources {
  if (stamp.entries === null) {
    // No index, but the count alone still beats silence: "12 files then, 14
    // now" tells a reader to go looking for two new files.
    return {
      summary: stamp.count === undefined ? "" : ` (${stamp.count} file(s) then, ${now.length} now)`,
    };
  }
  const paths: string[] = [];
  const current = new Map(now.map((e) => [e.path, e.sha]));
  for (const [path, sha] of current) {
    const before = stamp.entries.get(path);
    if (before === undefined) paths.push(`added    ${path}`);
    else if (before !== sha) paths.push(`changed  ${path}`);
  }
  for (const path of stamp.entries.keys()) if (!current.has(path)) paths.push(`removed  ${path}`);
  paths.sort();
  // An index that agrees with the current tree while the digest does not is a
  // contradiction (a truncation collision, or a hand-edited header). Say
  // nothing rather than print an empty list under a staleness warning.
  if (paths.length === 0) return { summary: "" };
  return { paths, summary: ` (${paths.length} path(s) moved)` };
}

/** The characters that made an entry a pattern under the glob dialect loam no longer ships. */
const PATTERN_CHARS = /[*?[]/;

/**
 * The `sources` entries that look like glob patterns — anything containing
 * `*`, `?` or `[`. Patterns are refused loudly everywhere sources are consumed
 * (`loam vouch` refuses the run, `loam validate` grades an error), never
 * resolved: the glob dialect loam used to ship silently differed from the
 * gitignore/minimatch conventions authors assume — bracket classes literal,
 * its own `**` handling — so a pattern quietly digested a different file set
 * than intended, corrupting the staleness signal in both directions. A
 * directory already means "everything beneath it", so the fix is to name one.
 *
 * The cost accepted with the rule: a real file with `[` in its name (a Next.js
 * route, say) cannot be listed on its own — its parent directory covers it.
 */
export function patternSources(sources: string[]): string[] {
  return sources.filter((s) => PATTERN_CHARS.test(s.trim()));
}

/** The `sources` entries that resolve to nothing in this repo. */
export function missingSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((s) => !sourceExists(repoDir, s));
}

/** Entries that are absolute, traverse upward, or escape through a symlink. */
export function unsafeSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((source) => {
    const cleaned = source.trim();
    if (cleaned.length === 0) return false;
    try {
      resolveInside(repoDir, cleaned, `source '${source}'`);
      return false;
    } catch {
      return true;
    }
  });
}

/** Does a `sources` entry point at something real? Literal paths only, checked exactly. */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  try {
    return existsSync(resolveInside(repoDir, cleaned, `source '${source}'`));
  } catch {
    return false;
  }
}
