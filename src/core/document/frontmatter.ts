/**
 * YAML frontmatter — the provenance of an artifact.
 *
 * `status` says whether a human has vouched for the document, `sources` says
 * which code it was written from. When the prose is written by an agent, these
 * are the only deterministic tie to reality: everything else loam checks is
 * internal consistency, which a fluent enough fiction satisfies perfectly.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isMap, parse, parseDocument } from "yaml";
import { decodeDocument, NotUtf8DocumentError } from "../kernel/document-bytes.js";

export interface Frontmatter {
  /** True when a terminated `---` block was found, even if it was empty. */
  present: boolean;
  /**
   * True when the block was found but its YAML cannot be read as a mapping —
   * a parse error, or a scalar/sequence document. `data` is then {}, which is
   * NOT the same fact as an empty header: the fields are unreadable, not
   * absent, and a checker that grades them "missing" sends the author adding
   * lines to a block YAML refuses to parse. Validate turns this flag into
   * `frontmatter.malformed`; the writer (withFrontmatterFields) has its own
   * replace-don't-merge rule for the same state.
   */
  malformed: boolean;
  /**
   * Why the FILE could not be read as text at all, or absent when it could —
   * set only by `readFrontmatter`, since a caller that already holds a string
   * has nothing left to decode.
   *
   * A third state, not a shade of the other two: `present: false` here means
   * nobody could look, where everywhere else it means nobody wrote a header.
   * A checker must ask this first, or it reports "owner/status/sources missing"
   * over a file whose lines are right there — the same false cascade
   * `malformed` exists to stop, one layer lower down.
   */
  unreadable?: string;
  /** The parsed mapping, or {} when absent or malformed. */
  data: Record<string, unknown>;
  /** The document with the frontmatter removed. */
  body: string;
}

/** Where the header sits in the raw text. */
interface Bounds {
  /** First character of the YAML text. */
  start: number;
  /** One past its last character — the newline before the closing fence included. */
  end: number;
  /** First character of the body. */
  bodyStart: number;
}

/**
 * Drop a leading byte-order mark.
 *
 * With one in front, the opening `---` is no longer at position 0, so the whole
 * header reads as absent: a documented artifact silently becomes an
 * undocumented one — no owner, no status, no `sources` — and nothing says why.
 * The same blindness `spec.ts` had at `^##`.
 *
 * Only at position 0: elsewhere U+FEFF is a zero-width no-break space and is the
 * author's content. Callers strip before measuring, so the offsets `bounds`
 * returns index the same string the caller then slices.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * A fence is a LINE of exactly three dashes. Trailing whitespace is tolerated
 * (`\s` also swallows the CR of a CRLF file), trailing text is not: `--- title`
 * is prose, `----` is a horizontal rule. Matching the substring `---` instead —
 * as this used to — made both of those fences, so a stray rule closed the
 * header early and a `--- note` closer silently ate its own trailing text.
 */
const FENCE_RE = /^---\s*$/;

/**
 * Locate the frontmatter block. The opener is the very first line, the closer
 * the first subsequent fence line — a later horizontal rule is body, not a
 * second fence. No closer means an unterminated opener: not frontmatter at all.
 *
 * The reader and the writer both go through this, so they can never disagree
 * about which bytes are the header — the writer's promise to leave the body
 * untouched depends on that being one decision, not two.
 */
function bounds(md: string): Bounds | null {
  const firstNl = md.indexOf("\n");
  if (!FENCE_RE.test(firstNl === -1 ? md : md.slice(0, firstNl))) return null;
  // A lone `---` with nothing after it is an unterminated opener.
  if (firstNl === -1) return null;
  const start = firstNl + 1;
  for (let lineStart = start; ; ) {
    const nl = md.indexOf("\n", lineStart);
    const line = nl === -1 ? md.slice(lineStart) : md.slice(lineStart, nl);
    if (FENCE_RE.test(line)) {
      // An empty block (`---\n---`) has no text between the fences: start === end.
      return { start, end: lineStart, bodyStart: nl === -1 ? md.length : nl + 1 };
    }
    if (nl === -1) return null;
    lineStart = nl + 1;
  }
}

/**
 * Split a markdown document into its frontmatter and body. A document with no
 * frontmatter is returned whole rather than truncated.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const md = stripBom(source);
  const at = bounds(md);
  if (at === null) return { present: false, malformed: false, data: {}, body: md };

  const yamlText = md.slice(at.start, at.end);
  const body = md.slice(at.bodyStart).trimStart();

  let data: Record<string, unknown> = {};
  let malformed = false;
  try {
    const parsed: unknown = parse(yamlText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    } else if (parsed !== null) {
      // A scalar or sequence header holds no fields to read — as unreadable as
      // broken YAML. null is the empty block (`---\n---`): legal, and empty.
      malformed = true;
    }
  } catch {
    // A bad header must not make the document unreadable (the body is still the
    // body, and never crashes a command) — but the failure travels as a flag,
    // so the caller can say `frontmatter.malformed` instead of the false
    // cascade "owner/status missing" the silent {} used to produce.
    malformed = true;
  }
  return { present: true, malformed, data, body };
}

/** A field as text. Non-string scalars (a bare date, a number) are stringified. */
export function stringField(fm: Frontmatter, key: string): string | undefined {
  const v = fm.data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return undefined;
}

/** A field as a list. A lone scalar counts as a list of one. */
export function listField(fm: Frontmatter, key: string): string[] {
  const v = fm.data[key];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  const one = stringField(fm, key);
  return one === undefined ? [] : [one];
}

/**
 * Return `md` with these frontmatter fields set and everything below the closing
 * fence byte-identical.
 *
 * The header is edited through yaml's document model rather than rebuilt from
 * the parsed data: keys keep their order and their comments, fields nobody named
 * are left exactly as they were, and a value that would read back as something
 * else — a digest of all digits, say — gets quoted for us. Stamping a document
 * is not a licence to reformat it: the diff a reviewer sees should be the lines
 * that changed, and nothing else.
 *
 * A document with no frontmatter gets one, and the text that was there becomes
 * the body. A header that does not parse (or is not a mapping) is replaced
 * rather than merged into — it cannot be edited without guessing what it meant.
 *
 * Keys named in `remove` are DELETED. That is not a convenience: `loam vouch`
 * stamps `vouch_scope` when a person read only a sample of the document, and
 * a full vouch afterwards has to take that claim back out. Left behind, a
 * stale scope would keep a fully-read document reading as sampled forever —
 * on `loam list`, in `loam validate`'s `sources.sampled-vouch`, and in the
 * frontmatter a person opens — which is the same class of lie as a stamp with
 * nothing behind it, pointing the other way.
 *
 * Deletion is a separate LIST rather than a null value in `fields`, and the
 * difference is the compiler's: `string | null` is the most common field shape
 * in this codebase (`stringField(fm, k) ?? null` appears in a dozen readers),
 * so a writer that stamped a field it had just read back — `{ owner }` — would
 * silently delete `owner` on every document that never had one, where today
 * that line does not compile. Clearing a key is something a call site says,
 * never something a value happens to be.
 */
export function withFrontmatterFields(
  source: string,
  fields: Record<string, string>,
  remove: readonly string[] = [],
): string {
  // Stamping a BOM-prefixed document drops the BOM. It sits above the header, so
  // the promise about the body still holds — and leaving it would re-break the
  // file for every parser anchored at position 0, including ours.
  const md = stripBom(source);
  const at = bounds(md);
  const parsed = parseDocument(at === null ? "" : md.slice(at.start, at.end));
  const editable = parsed.errors.length === 0 && (parsed.contents === null || isMap(parsed.contents));
  const doc = editable ? parsed : parseDocument("");

  for (const [key, value] of Object.entries(fields)) doc.set(key, value);
  // Guarded, not because a missing key is a problem — deleting one that is not
  // there is a no-op — but because yaml's `Document.delete` THROWS ("Expected
  // a YAML collection as document contents") when the document has no mapping
  // at all: the empty header of a document that had none, and the replacement
  // built for a header that would not parse. Both are states this writer
  // reaches on purpose, and in both there is nothing to clear.
  if (isMap(doc.contents)) for (const key of remove) doc.delete(key);
  const yamlText = doc.toString();

  if (at === null) return `---\n${yamlText}---\n\n${md}`;
  return md.slice(0, at.start) + yamlText + md.slice(at.end);
}

/**
 * The document's body, byte-exact: everything after the frontmatter block —
 * the closing `---` line and its newline belong to the HEADER, every byte
 * after them (blank lines included) is body. A document with no frontmatter is
 * all body. This is what `content_digest` hashes, and it deliberately does NOT
 * go through `parseFrontmatter` (whose `body` is trimmed for callers that want
 * text): the digest's writer and its checker must slice the same bytes, so
 * both go through here.
 */
export function rawBody(source: string): string {
  const md = stripBom(source);
  const at = bounds(md);
  return at === null ? md : md.slice(at.bodyStart);
}

/**
 * Read a markdown file's frontmatter; a missing file reads as absent.
 *
 * Bytes in, decoded through `decodeDocument`, because `readFile(path, "utf8")`
 * turns a UTF-16 spec.md into mojibake whose opening `---` is no longer at
 * position 0 — so the header reads as ABSENT, and `status`, `owner` and
 * `sources` all come back missing over a file that spells every one of them.
 * The same blindness `stripBom` exists to stop, one encoding wider.
 *
 * The failure travels as a FLAG rather than an exception, which is how every
 * reader here degrades (`readOpenapi`'s `unreadable`) and is load-bearing at
 * exactly this call: this is the read behind the fleet ENUMERATION
 * (repo.ts `listServices`), so throwing would turn one PowerShell-saved file
 * into a `loam list` that reports nothing about the other 119 services.
 * Parsers never diagnose; a checker grades the flag.
 */
export async function readFrontmatter(path: string): Promise<Frontmatter> {
  if (!existsSync(path)) return { present: false, malformed: false, data: {}, body: "" };
  let text: string;
  try {
    text = decodeDocument(await readFile(path), path);
  } catch (err) {
    if (!(err instanceof NotUtf8DocumentError)) throw err;
    return { present: false, malformed: false, unreadable: err.message, data: {}, body: "" };
  }
  return parseFrontmatter(text);
}

/** The statuses each kind of artifact may carry. */
export const SERVICE_STATUSES = ["draft", "verified"] as const;
export const FEATURE_STATUSES = ["proposed", "in_progress", "built", "done"] as const;

/**
 * A document's prose with any leading frontmatter block dropped — what
 * `loam delta` and `loam context` print as a feature's intent.
 *
 * Moved verbatim from `commands/delta/slices.ts` when the context pack became
 * its second caller. It deliberately keeps its own, looser fence rule
 * (`\n---` as a substring, not `bounds()`'s line-exact match) rather than
 * delegating to `parseFrontmatter(md).body`: the two agree on every header
 * loam writes, but the delta brief's output is pinned byte-for-byte by its
 * tests, and unifying the rules is a behaviour change to make deliberately,
 * not as a side effect of a move.
 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return md;
  const nl = md.indexOf("\n", close + 1);
  return nl === -1 ? "" : md.slice(nl + 1).trimStart();
}
