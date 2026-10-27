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
  const body = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  return (body.match(OPEN_QUESTIONS_SECTION) ?? []).flatMap(questionsIn);
}

function questionsIn(section: string): string[] {
  const out: string[] = [];
  // Every table opens with a header row; a line that is not a table row closes
  // the table, so a second table further down gets its own header skipped.
  let header = true;
  // The column the open question's text starts at. A line indented that far is
  // inside it; any other non-blank line closes it.
  let inside = Infinity;
  for (const line of section.split("\n").slice(1)) {
    const row = line.trim();
    if (row !== "" && line.length - line.trimStart().length < inside) inside = Infinity;
    if (row.startsWith("|")) {
      if (TABLE_SEPARATOR.test(row)) continue;
      if (header) header = false;
      else out.push(row);
      continue;
    }
    header = true;
    const item = inside === Infinity ? LIST_ITEM.exec(line) : null;
    if (item === null) continue;
    out.push(row);
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
