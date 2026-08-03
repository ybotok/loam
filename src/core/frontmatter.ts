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
import { parse } from "yaml";

export interface Frontmatter {
  /** True when a terminated `---` block was found, even if it was empty. */
  present: boolean;
  /** The parsed mapping, or {} when absent or malformed. */
  data: Record<string, unknown>;
  /** The document with the frontmatter removed. */
  body: string;
}

/**
 * Split a markdown document into its frontmatter and body. The block must open
 * on the very first line and is closed by the FIRST `\n---` — a later horizontal
 * rule is body, not a second fence. An unterminated opener is not frontmatter at
 * all, and the document is returned whole rather than truncated.
 */
export function parseFrontmatter(md: string): Frontmatter {
  if (!md.startsWith("---")) return { present: false, data: {}, body: md };
  const close = md.indexOf("\n---", 3);
  if (close === -1) return { present: false, data: {}, body: md };

  const firstNl = md.indexOf("\n");
  const yamlText = firstNl === -1 || firstNl > close ? "" : md.slice(firstNl + 1, close);
  const afterFence = md.indexOf("\n", close + 1);
  const body = afterFence === -1 ? "" : md.slice(afterFence + 1).trimStart();

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

/** Read a markdown file's frontmatter; a missing file reads as absent. */
export async function readFrontmatter(path: string): Promise<Frontmatter> {
  if (!existsSync(path)) return { present: false, data: {}, body: "" };
  return parseFrontmatter(await readFile(path, "utf8"));
}

/** The statuses each kind of artifact may carry. */
export const SERVICE_STATUSES = ["draft", "verified"] as const;
export const FEATURE_STATUSES = ["proposed", "in_progress", "built", "done"] as const;
