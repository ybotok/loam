/**
 * Line surgery: insert one `Based-On:` line without touching anything else.
 *
 * `loam rebase` rewrites a pin inside a document a person wrote. Reserializing
 * through `serializeRequirements` would be simpler and would flatten every
 * section heading and paragraph the author put between requirements — so the
 * parser records the heading LINE of each requirement and this module edits
 * exactly there, leaving every other byte as found.
 */
import { REALIZES_LINE_RE, type Requirement } from "../../core/document/spec.js";

export interface LineEdit {
  /** 0-based line index, as `parseRequirements` counts lines. */
  at: number;
  /** Replace that line, or insert a new one before it. */
  mode: "replace" | "insert";
  text: string;
}

/**
 * Where this requirement's `Based-On:` line goes, and whether it replaces one.
 *
 * `headingLine` is 1-based and `text` captures every body line after it
 * contiguously (core/document/parse.ts), so body line `i` is the 0-based document line
 * `headingLine + i` — no rescan of the document, and no second opinion about
 * where a requirement begins. A new pin lands directly under `Requirement-ID:`
 * when there is one, matching what `serializeRequirements` writes, and
 * otherwise as the first body line: the two identity lines are read together,
 * so they are kept together.
 */
export function pinEdit(r: Requirement, headingLine: number, digest: string): LineEdit {
  const text = `Based-On: ${digest}`;
  const existing = r.text.findIndex((line) => /^\s*Based-On:/i.test(line));
  if (existing >= 0) return { at: headingLine + existing, mode: "replace", text };
  const afterId = r.text.findIndex((line) => /^\s*Requirement-ID:/i.test(line));
  return { at: headingLine + afterId + 1, mode: "insert", text };
}

/**
 * Rewrite one requirement's `Realizes:` line so every entry carries the pin
 * `pinned` supplies for it, or `null` when the line already reads that way.
 *
 * ALWAYS A REPLACE, never an insert, and that is the difference from `pinEdit`
 * above: a `Based-On:` line is bookkeeping loam may add to a requirement that
 * has none, while a `Realizes:` line is a claim a human made. loam re-spells
 * the claim it finds and never invents one — a requirement that realizes
 * nothing has nothing to pin, and writing a line there would be loam asserting
 * a join on somebody's behalf.
 *
 * Entry order, spacing after the colon and the author's own separator run are
 * preserved by rebuilding from the captured text rather than from the parsed
 * array: this is line surgery inside a document somebody wrote, and a
 * normalization nobody asked for would land in every diff.
 */
export function realizesPinEdit(
  r: Requirement,
  headingLine: number,
  pinned: (entry: string) => string,
): LineEdit | null {
  const at = r.text.findIndex((line) => REALIZES_LINE_RE.test(line));
  if (at < 0) return null;
  const line = r.text[at]!;
  const match = REALIZES_LINE_RE.exec(line)!;
  const rewritten = match[1]!
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      return entry.replace(trimmed, pinned(trimmed));
    })
    .join(",");
  if (rewritten === match[1]!) return null;
  return { at: headingLine + at, mode: "replace", text: line.replace(match[1]!, rewritten) };
}

/** One line of the document with the terminator it was written with. */
export interface Line {
  text: string;
  /** "\n", "\r\n", or "" for a last line the file does not terminate. */
  eol: string;
}

/**
 * Split into lines that remember their own terminator, indexed exactly as
 * `parseRequirements` counts them.
 */
export function toLines(raw: string): Line[] {
  // split with a captured separator yields [content, sep, content, sep, …, content].
  const parts = raw.split(/(\r?\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push({ text: parts[i]!, eol: parts[i + 1] ?? "" });
  return lines;
}

/**
 * Apply line edits to a document, preserving every byte they do not name.
 *
 * Each line keeps its own terminator, so a CRLF document stays CRLF and a file
 * that ends without a newline does not grow one — rejoining on a single
 * "detected" newline would rewrite the line endings of a whole file whose
 * author asked for one line to change. Edits are applied bottom-up so an
 * insertion never shifts the index of one still to come.
 */
export function applyEdits(raw: string, edits: LineEdit[]): string {
  const lines = toLines(raw);
  const eol = lines.find((line) => line.eol !== "")?.eol ?? "\n";
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    if (edit.mode === "replace") {
      lines[edit.at]!.text = edit.text;
      continue;
    }
    const before = edit.at > 0 ? lines[edit.at - 1] : undefined;
    if (before !== undefined && before.eol === "") {
      // Inserting past a file that ends without a newline: the old last line
      // needs a terminator, and the new line inherits its unterminated end so
      // the file keeps the shape its author gave it.
      before.eol = eol;
      lines.splice(edit.at, 0, { text: edit.text, eol: "" });
    } else {
      lines.splice(edit.at, 0, { text: edit.text, eol: before?.eol ?? eol });
    }
  }
  return lines.map((line) => line.text + line.eol).join("");
}
