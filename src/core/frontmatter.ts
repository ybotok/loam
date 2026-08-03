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

export interface Frontmatter {
  /** True when a terminated `---` block was found, even if it was empty. */
  present: boolean;
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
 * Locate the frontmatter block. The block must open on the very first line and
 * is closed by the FIRST `\n---` — a later horizontal rule is body, not a second
 * fence. An unterminated opener is not frontmatter at all.
 *
 * The reader and the writer both go through this, so they can never disagree
 * about which bytes are the header — the writer's promise to leave the body
 * untouched depends on that being one decision, not two.
 */
function bounds(md: string): Bounds | null {
  if (!md.startsWith("---")) return null;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return null;
  const firstNl = md.indexOf("\n");
  // An empty block (`---\n---`) has no text between the fences: start === end.
  const start = firstNl !== -1 && firstNl < close ? firstNl + 1 : close + 1;
  const afterFence = md.indexOf("\n", close + 1);
  return { start, end: close + 1, bodyStart: afterFence === -1 ? md.length : afterFence + 1 };
}

/**
 * Split a markdown document into its frontmatter and body. A document with no
 * frontmatter is returned whole rather than truncated.
 */
export function parseFrontmatter(md: string): Frontmatter {
  const at = bounds(md);
  if (at === null) return { present: false, data: {}, body: md };

  const yamlText = md.slice(at.start, at.end);
  const body = md.slice(at.bodyStart).trimStart();

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parse(yamlText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter is reported by the caller as missing fields, not by
    // crashing the command — a bad header must not make the document unreadable.
  }
  return { present: true, data, body };
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
 */
export function withFrontmatterFields(md: string, fields: Record<string, string>): string {
  const at = bounds(md);
  const parsed = parseDocument(at === null ? "" : md.slice(at.start, at.end));
  const editable = parsed.errors.length === 0 && (parsed.contents === null || isMap(parsed.contents));
  const doc = editable ? parsed : parseDocument("");

  for (const [key, value] of Object.entries(fields)) doc.set(key, value);
  const yamlText = doc.toString();

  if (at === null) return `---\n${yamlText}---\n\n${md}`;
  return md.slice(0, at.start) + yamlText + md.slice(at.end);
}

/** Read a markdown file's frontmatter; a missing file reads as absent. */
export async function readFrontmatter(path: string): Promise<Frontmatter> {
  if (!existsSync(path)) return { present: false, data: {}, body: "" };
  return parseFrontmatter(await readFile(path, "utf8"));
}

/** The statuses each kind of artifact may carry. */
export const SERVICE_STATUSES = ["draft", "verified"] as const;
export const FEATURE_STATUSES = ["proposed", "in_progress", "built", "done"] as const;
