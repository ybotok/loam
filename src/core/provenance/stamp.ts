/**
 * The stamp vocabulary: what `loam vouch` computes for a frontmatter stamp and
 * what a later check reads back out of one — `sources_digest` and the per-file
 * `sources_files` index beside it, the document's own `content_digest`, and
 * the local calendar day `last_verified` carries.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { rawBody } from "../document/frontmatter.js";
import { collectSources, type SkippedSource } from "./walk.js";

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
export function decodeSourceIndex(stamped: string | undefined): StampedIndex {
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
 * The structured half of the answer: which paths were added, changed and
 * removed between a stamp and the current index — or null when the stamp
 * cannot say. Null covers two distinct silences on purpose, both of which mean
 * "do not print a path list": a stamp that recorded no per-file entries (the
 * count-only >100-file fallback, or a header nobody could parse), and an index
 * that AGREES with the current tree while the caller's digest comparison said
 * stale — a contradiction (a truncation collision, or a hand-edited header),
 * where an empty delta under a staleness warning would read as proof that
 * nothing moved. Callers that need the counts anyway read `stamp.count`.
 *
 * Extracted from `movedSources` (which now consumes it) when the re-vouch
 * reading pack became a second reader: the pack wants the three lists as
 * data, the stale finding wants them annotated in one column.
 */
export function sourceDelta(
  stamp: StampedIndex,
  now: SourceIndexEntry[],
): { added: string[]; changed: string[]; removed: string[] } | null {
  if (stamp.entries === null) return null;
  const added: string[] = [];
  const changed: string[] = [];
  const current = new Map(now.map((e) => [e.path, e.sha]));
  for (const [path, sha] of current) {
    const before = stamp.entries.get(path);
    if (before === undefined) added.push(path);
    else if (before !== sha) changed.push(path);
  }
  const removed = [...stamp.entries.keys()].filter((path) => !current.has(path));
  if (added.length + changed.length + removed.length === 0) return null;
  added.sort();
  changed.sort();
  removed.sort();
  return { added, changed, removed };
}

/**
 * added / removed / changed, from the stamped index against the current one.
 * The annotation travels IN the detail line rather than in three separate
 * lists: a reader scanning a stale report wants the paths in one column, and
 * "which of the three" is one word wide.
 */
export function movedSources(stamp: StampedIndex, now: SourceIndexEntry[]): MovedSources {
  const delta = sourceDelta(stamp, now);
  if (delta === null) {
    // A recorded index that came back null is the contradiction case — say
    // nothing rather than print an empty list under a staleness warning. With
    // no index at all, the count alone still beats silence: "12 files then,
    // 14 now" tells a reader to go looking for two new files.
    return {
      summary:
        stamp.entries !== null || stamp.count === undefined
          ? ""
          : ` (${stamp.count} file(s) then, ${now.length} now)`,
    };
  }
  const paths = [
    ...delta.added.map((path) => `added    ${path}`),
    ...delta.changed.map((path) => `changed  ${path}`),
    ...delta.removed.map((path) => `removed  ${path}`),
  ].sort();
  return { paths, summary: ` (${paths.length} path(s) moved)` };
}
