/**
 * The stamp vocabulary: what `loam vouch` computes for a frontmatter stamp and
 * what a later check reads back out of one — `sources_digest` and the per-file
 * `sources_files` index beside it, and the local calendar day `last_verified`
 * carries. The document's own `content_digest` lived here too; it moved to
 * core/document/frontmatter.ts, beside the body cut it hashes, when the fleet
 * enumeration needed it (`contentDigest`'s docblock says why).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
/* The sources digest                                                  */
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
  /** sha256 of its bytes (CRLF read as LF in a text file), truncated the way `sources_digest` is. */
  sha: string;
  /** The same sha256 in full — what the outer digest is fed. */
  hex: string;
  /**
   * The full sha256 of its RAW bytes, only where that differs from `hex` (a
   * text file carrying a CRLF): the recipe loam stamped before line endings
   * were folded. Never written; read by `holdsSourcesStamp` and `sourceDelta`,
   * so a stamp made that way still reads current where it was made.
   */
  rawHex?: string;
}

/** How far into a file git looks for a NUL before it calls the file binary. */
const TEXT_SNIFF_BYTES = 8000;

const CRLF = Buffer.from("\r\n");

/**
 * The bytes a digest hashes for one file: a text file with every CRLF read as
 * LF, anything else exactly as it is. "Text" is git's own heuristic — no NUL
 * in the first 8000 bytes — because git is what rewrites the line endings:
 * Git for Windows checks out with `core.autocrlf=true` by default, so the same
 * commit is LF on the machine that vouched and CRLF on the one that checks,
 * and a raw-bytes digest read every vouched file as moved with no edit. A
 * binary file git never converts, so it keeps its bytes and its exact identity.
 * Only CRLF pairs are folded; a lone CR is content, and git leaves it alone too.
 */
export function digestBytes(bytes: Buffer): Buffer {
  const first = bytes.indexOf(CRLF);
  if (first === -1 || bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0)) return bytes;
  // Copy the runs between CRs, keeping each LF: a segment per line ending
  // rather than a byte loop, since a `sources: [src/]` is thousands of files.
  const runs: Buffer[] = [];
  let from = 0;
  for (let at = first; at !== -1; at = bytes.indexOf(CRLF, from)) {
    runs.push(bytes.subarray(from, at));
    from = at + 1;
  }
  runs.push(bytes.subarray(from));
  return Buffer.concat(runs);
}

/**
 * Does this stamped `sources_digest` still describe the files? Either recipe
 * is an answer: the folded one every vouch now writes, or the raw-bytes one
 * written before — so no stamp loam ever made goes stale by this change, and
 * a stamp made on a CRLF checkout before it reads current where it was made.
 * One spelling for `sources.stale` and the re-vouch pack, which must not
 * disagree about whether the sources moved.
 *
 * The raw recipe is rebuilt file by file rather than taken whole, because a
 * raw stamp's files need not all have moved together. One made on an LF
 * checkout over a file committed CRLF (`*.bat eol=crlf`) and read on an
 * autocrlf clone has the LF files now CRLF and the CRLF one untouched: every
 * file is unchanged, yet neither whole recipe reproduces the stamp. So each
 * file contributes its raw hash — unless the stamp's own `sources_files`
 * (`recorded`) shows it was stamped as it now folds, which is what an LF file
 * raw-hashed on an LF checkout looks like from a CRLF one. Still the exact
 * outer recipe, path and full hash per file: a real edit matches neither.
 */
export function holdsSourcesStamp(
  now: Pick<SourcesDigest, "digest" | "index">,
  stamped: string,
  recorded: StampedIndex,
): boolean {
  if (stamped === now.digest) return true;
  const raw = createHash("sha256");
  for (const e of now.index) {
    const folded = e.rawHex === undefined || recorded.entries?.get(e.path) === e.sha;
    raw.update(`${e.path}\0${folded ? e.hex : e.rawHex}\n`);
  }
  return raw.digest("hex").slice(0, DIGEST_LENGTH) === stamped;
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
 *   2. per file, `sha256(bytes)` — with every CRLF read as LF when the file
 *      is text by git's heuristic (`digestBytes`);
 *   3. feed `<path>\0<hex>\n` for each file, in that order, into an outer
 *      sha256;
 *   4. keep the first 16 hex characters.
 *
 * Content, not mtime: git does not preserve modification times, so after a
 * fresh clone every file looks changed and the check would be false positives
 * end to end. Content survives the clone; raw BYTES do not — git rewrites a
 * text file's line endings on checkout under `core.autocrlf`, Git for Windows'
 * default, and also on a plain `git checkout <rev> -- <file>` over a file an
 * agent wrote LF. Step 2's normalisation is what makes the stamp mean the
 * content rather than one checkout's rendering of it. Hashing the path
 * alongside the content means a rename registers, which is what a reader of
 * the doc would want.
 *
 * Before the normalisation step 2 was raw bytes, and stamps written that way
 * stay readable: each entry's `rawHex` is that recipe, and the readers accept
 * either (`holdsSourcesStamp`, `sourceDelta`). It costs no second hash over a
 * file without a CRLF, where both recipes are one value.
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
      found.slice(start, start + DIGEST_READ_BATCH).map(async (file) => {
        const bytes = await readFile(file.abs);
        const normal = digestBytes(bytes);
        const content = createHash("sha256").update(normal).digest("hex");
        return {
          rel: file.rel,
          content,
          raw: normal === bytes ? content : createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    for (const { rel, content, raw } of hashed) {
      outer.update(`${rel}\0${content}\n`);
      index.push({
        path: rel,
        sha: content.slice(0, DIGEST_LENGTH),
        hex: content,
        ...(raw === content ? {} : { rawHex: raw }),
      });
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
 * nothing moved. (A raw-bytes stamp over files whose line endings moved
 * unevenly is not a third cause: `holdsSourcesStamp` rebuilds it file by file
 * from this same index, so an index that agrees reproduces the stamp.)
 * Callers that need the counts anyway read `stamp.count`.
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
  const current = new Map(now.map((e) => [e.path, e]));
  for (const [path, entry] of current) {
    const before = stamp.entries.get(path);
    // Either recipe's sha is the file unchanged — `SourceIndexEntry.rawHex`.
    if (before === undefined) added.push(path);
    else if (before !== entry.sha && before !== entry.rawHex?.slice(0, DIGEST_LENGTH)) changed.push(path);
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
