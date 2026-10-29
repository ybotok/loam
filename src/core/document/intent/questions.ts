/**
 * The questions a feature's intent.md leaves open: the rows or bullets under its
 * `## Open questions`, where loam-feature's analyze step writes and a person
 * answers.
 *
 * Counted for the views a person reads — `loam status <FEAT>`, `loam show
 * <FEAT>`, the archive plan, `loam delta --service` — and never graded. An open
 * question is the honest state of a design, not a defect in it; what the views
 * owed the reader was the number, because a feature reading `ready` over
 * twenty-five unanswered questions said more than loam had checked.
 */
import { readFile } from "node:fs/promises";
import { decodeDocument } from "../../kernel/document-bytes.js";

/**
 * The scaffold's `## Open questions` section, up to the next heading of its
 * level or above — one spelling for both readers: this module counts what is
 * in it, and `core/coherence/authoring/scaffold.ts` keeps it out of the Why
 * the `intent.empty` gate asks for (prose in it is an agent's questions about
 * the feature, never the reason it exists).
 */
export const OPEN_QUESTIONS_SECTION = /^##[ \t]+open questions[ \t]*\n[\s\S]*?(?=^#{1,2}[ \t]|(?![\s\S]))/gim;

/** A table's separator row — `|---|:--:|` — which is no question. */
const TABLE_SEPARATOR = /^\|[\s:|-]+\|?$/;

/**
 * A list item: a bullet or a number, indented less than a code block. Whether
 * it is top-level is the open item's call, not the indent's — `- Q3` puts its
 * text at column 2, so `  - detail` is inside it.
 */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]+\S/;

/**
 * Every open question in an intent.md's text, one string per question, in
 * document order.
 *
 * Both shapes a question is written in count: the authoring page asks for a
 * table (`| ID | Question | Blocks | Owner | Current default |`), and a feature
 * written before it — or by hand — has bullets. A table's first row is its
 * header and its separator is layout; every other row is one question. Nested
 * bullets are detail under a question, not questions of their own, and HTML
 * comments — the scaffold's hint text — are nobody's question.
 */
export function openQuestions(text: string): string[] {
  return openQuestionRows(text).map((row) => row.text);
}

/** One open question, and the 1-based line of `text` it was read from. */
export interface QuestionRow {
  text: string;
  line: number;
}

/**
 * `openQuestions`, each with the line it sits on in the text it was read from —
 * which is the FILE's line when the caller hands in the whole file, frontmatter
 * included, as `--intent-ref` does: a reference is only useful if an editor or
 * `sed -n` opens the line it names.
 *
 * The comments are cut exactly as before, so the questions are the same
 * strings; the cut only also remembers, for every line left, the line it began
 * on, because a comment spanning lines would otherwise shift every question
 * below it.
 */
export function openQuestionRows(text: string): QuestionRow[] {
  const { body, origin } = uncommented(text.replace(/^﻿/, "").replace(/\r\n/g, "\n"));
  const rows: QuestionRow[] = [];
  for (const match of body.matchAll(OPEN_QUESTIONS_SECTION)) {
    const heading = body.slice(0, match.index).split("\n").length - 1;
    for (const { text: row, offset } of questionsIn(match[0])) rows.push({ text: row, line: origin[heading + offset]! });
  }
  return rows;
}

/**
 * `text` without its HTML comments, and `origin[i]`: the 1-based line of `text`
 * that line `i` of the result is read from — where its first non-blank
 * character sits, which is not where the line starts when a comment spanning
 * lines was cut from its front: `<!-- hint\nmore -->- the question` is read as
 * one line beginning on the comment's line, and the question is on the next.
 */
function uncommented(text: string): { body: string; origin: number[] } {
  const kept: string[] = [];
  const origin = [1];
  let line = 1;
  let from = 0;
  // Whether the current result line has met its first non-blank character yet.
  let placed = false;
  const keep = (chunk: string): void => {
    kept.push(chunk);
    for (const ch of chunk) {
      if (ch === "\n") {
        origin.push(++line);
        placed = false;
      } else if (!placed && ch.trim() !== "") {
        origin[origin.length - 1] = line;
        placed = true;
      }
    }
  };
  for (const comment of text.matchAll(/<!--[\s\S]*?-->/g)) {
    keep(text.slice(from, comment.index));
    line += comment[0].split("\n").length - 1;
    from = comment.index + comment[0].length;
  }
  keep(text.slice(from));
  return { body: kept.join(""), origin };
}

/** Each question of one section, with its line counted from the section's heading (0). */
function questionsIn(section: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  // Every table opens with a header row; a line that is not a table row closes
  // the table, so a second table further down gets its own header skipped.
  let header = true;
  // The column the open question's text starts at. A line indented that far is
  // inside it; any other non-blank line closes it.
  let inside = Infinity;
  for (const [offset, line] of section.split("\n").entries()) {
    if (offset === 0) continue; // the heading
    const row = line.trim();
    if (row !== "" && line.length - line.trimStart().length < inside) inside = Infinity;
    if (row.startsWith("|")) {
      if (TABLE_SEPARATOR.test(row)) continue;
      if (header) header = false;
      else out.push({ text: row, offset });
      continue;
    }
    header = true;
    const item = inside === Infinity ? LIST_ITEM.exec(line) : null;
    if (item === null) continue;
    out.push({ text: row, offset });
    inside = item[0].length - 1;
  }
  return out;
}

/**
 * The questions that name one service by its id — what `loam delta --service`
 * counts for the team that owns it. A word match, hyphens included, so
 * `payment-service` is not found inside `payment-service-v2`.
 */
export function questionsNaming(questions: readonly string[], service: string): string[] {
  const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
  return questions.filter((q) => word.test(q));
}

/**
 * The open questions of the intent.md at `path` — none when it is absent or
 * does not decode. Whether intent.md is owed, and readable, is `status`'s and
 * `validate`'s question; a count must never be the thing that fails a view.
 */
export async function readOpenQuestions(path: string): Promise<string[]> {
  try {
    return openQuestions(decodeDocument(await readFile(path), path));
  } catch {
    return [];
  }
}
