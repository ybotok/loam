/**
 * What counts as a Gherkin step in a scenario body, and what counts as that
 * step's ARGUMENT — the one rule `loam gherkin` emits by and `loam validate`
 * grades by.
 *
 * It lives in a leaf of its own because both of those readers need it and they
 * sit on opposite sides of an import: `spec.ts` parses the markdown a scenario
 * is written in, `gherkin/emit.ts` renders that scenario into a `.feature` file and
 * parses requirements back out of `spec.ts` to do it. With the detector inside
 * `gherkin/emit.ts`, asking "does this scenario have any steps?" from the parser made
 * the two modules import each other, and a module-evaluation cycle is decided by
 * whichever entry point happens to be loaded first.
 *
 * Nothing here reads a file or knows what a requirement is: it is text in, shape
 * out, so both sides can depend on it and neither has to depend on the other.
 * `fenceTracker` comes from `core/kernel/`, the one package below everything, for
 * the same reason — `core/document/` already depends on this file, so borrowing
 * the fence rule from `core/document/parse.ts` would close a package cycle.
 */

import { fenceTracker } from "../kernel/fences.js";

const STEP_KEYWORD_RE = /^(given|when|then|and|but)$/i;

export interface Step {
  /** Canonical Gherkin keyword: Given / When / Then / And / But. */
  keyword: string;
  /** The rest of the line, trimmed. May be empty. */
  text: string;
}

/**
 * Is this scenario body line a step? A step is a LIST BULLET (`-`, `*`, `+`)
 * whose text opens with Given/When/Then/And/But — case-insensitive, so the
 * OpenSpec `- **WHEN** ...` convention counts — where the keyword may be
 * wrapped in `**bold**` and may carry a trailing colon. The keyword must stand
 * alone before the step text (`- Givenx` is prose). Everything that is not a
 * step stays scenario description: prose is never dropped, only steps are
 * promoted.
 */
export function stepFromLine(line: string): Step | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (!bullet) return null;
  const rest = bullet[1]!;
  const bold = /^\*\*([^*]+?)\*\*\s*(.*)$/.exec(rest);
  let lead: string;
  let tail: string;
  if (bold) {
    lead = bold[1]!.trim();
    tail = bold[2]!;
  } else {
    const sp = /^(\S+)\s*(.*)$/.exec(rest);
    if (!sp) return null;
    lead = sp[1]!;
    tail = sp[2]!;
  }
  const kw = STEP_KEYWORD_RE.exec(lead.replace(/:$/, ""));
  if (!kw) return null;
  const word = kw[1]!.toLowerCase();
  return { keyword: word[0]!.toUpperCase() + word.slice(1), text: tail.trim() };
}

/** A Gherkin `Examples` table: the column names, then one row of values per case. */
export interface Examples {
  header: string[];
  rows: string[][];
}

/**
 * A fenced block written under a step — Gherkin's docstring argument, and the
 * only way to put a request body, an expected JSON document or any other
 * multi-line literal into a scenario.
 *
 * `lines` are NOT trimmed beyond removing the fence's own indentation, and that
 * asymmetry with every other line in this module is the whole point: a payload
 * whose leading whitespace has been eaten is a payload no step definition can
 * compare against, and the loss is invisible because the file still parses.
 */
export interface DocString {
  /** The fence's info string (` ```json ` -> "json"), absent when it carried none. */
  contentType?: string;
  lines: string[];
}

/** One step as it will be emitted, with the argument written under it, if any. */
export interface EmittedStep {
  /** The rendered step line: keyword then text — `Given a payment of 100.00`. */
  text: string;
  docstring?: DocString;
  /**
   * An INDENTED markdown table written under this step, as Gherkin's data-table
   * argument: every row including the header, with the markdown separator row
   * dropped. Markdown needs the separator to render at all, Gherkin has no such
   * row, and the source stays legible in a pull request either way.
   */
  table?: string[][];
}

export interface ScenarioGherkin {
  description: string[];
  steps: EmittedStep[];
  /** The cases a `Scenario Outline` runs, or null for a plain `Scenario`. */
  examples: Examples | null;
  /**
   * A top-level table was clearly intended as `Examples` and could not be read —
   * a row whose width disagrees with the header, or a header with no rows under
   * it.
   *
   * Reported rather than guessed at. The rule this whole module holds is that
   * prose is never dropped, so a table loam cannot read stays in the scenario
   * DESCRIPTION and the emission is still valid Gherkin — which is exactly why
   * silence would be wrong: the author wrote twenty cases, cucumber runs one
   * scenario, and both the file and the report look healthy.
   */
  malformedExamples: boolean;
  /**
   * A fenced block or an indented table was written where it cannot become a
   * step argument — before the scenario's first step, or (for a table) in a
   * shape this module cannot read. It stays in the description, so nothing is
   * lost from the DOCUMENT, and everything is lost from the TEST: the payload
   * reaches no step definition and the runner sees a step with no argument.
   *
   * A separate flag from `malformedExamples` because the fixes are different —
   * one is "move it under a step", the other is "give the table equal columns" —
   * and a machine must not have to guess which was meant.
   */
  strandedBlocks: boolean;
}

/**
 * `| a | b |` -> `["a", "b"]`; null when the line is not a pipe row at all.
 *
 * The split honours markdown's `\|` escape, and that is not a nicety: a cell
 * holding a literal pipe — a regex alternation, a Kafka key template, a shell
 * snippet — otherwise splits into two, the row's width stops matching the
 * header's, and the WHOLE table is reported unreadable. The failure lands on the
 * one row that needed the escape and reads as if the author miscounted columns.
 * `\\` unescapes too, so a cell can end in a backslash without eating the
 * delimiter after it.
 */
function cellsOf(line: string): string[] | null {
  const t = line.trim();
  if (!/^\|.*\|$/.test(t)) return null;
  const cells: string[] = [];
  let cur = "";
  for (let i = 1; i < t.length - 1; i += 1) {
    const c = t[i]!;
    if (c === "\\" && (t[i + 1] === "|" || t[i + 1] === "\\")) {
      cur += t[i + 1]!;
      i += 1;
      continue;
    }
    if (c === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** `|---|:--:|` — the row markdown puts under a table header. */
function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** One run of source lines, already classified by {@link blocksOf}. */
type Block =
  | { kind: "line"; text: string }
  | { kind: "fence"; indent: number; contentType?: string; lines: string[] }
  | { kind: "table"; indent: number; rows: string[][] | null; lines: string[] };

/**
 * The scenario body split into fenced blocks, markdown tables and plain lines,
 * in source order.
 *
 * Fences are recognised FIRST and win outright, which is what stops a pipe row
 * inside a JSON payload from being hoisted out of it. That ordering is not a
 * nicety: before it existed, a scenario carrying a fenced payload that happened
 * to contain a table emitted the payload as trimmed prose and the payload's own
 * table as the scenario's `Examples`, turning one data pass into an outline
 * parameterized by the contents of its own request body — and `loam validate`
 * graded it green, because steps existed and no table was malformed.
 */
function blocksOf(lines: string[]): Block[] {
  const out: Block[] = [];
  const fenced = fenceTracker();
  let open: { indent: number; contentType?: string; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const inFence = fenced(line);
    const marker = /^(\s*)(```|~~~)(.*)$/.exec(line);
    if (inFence && marker && open === null) {
      const info = marker[3]!.trim();
      open = { indent: marker[1]!.length, lines: [], ...(info.length > 0 ? { contentType: info } : {}) };
      continue;
    }
    if (open !== null) {
      // The tracker still reports the CLOSING marker as fenced content, so the
      // marker line is what ends the block rather than the first unfenced line
      // after it — reading it the other way swallows the line following the
      // fence into the payload.
      if (marker) {
        out.push({ kind: "fence", ...open });
        open = null;
        continue;
      }
      open.lines.push(line);
      continue;
    }
    const table = tableAt(lines, i);
    if (table !== null) {
      out.push({ kind: "table", indent: table.indent, rows: table.rows, lines: lines.slice(i, table.end + 1) });
      i = table.end;
      continue;
    }
    out.push({ kind: "line", text: line });
  }
  // An unterminated fence is the author's typo, not a reason to lose the text:
  // its lines go back as plain lines and land in the description.
  if (open !== null) for (const l of open.lines) out.push({ kind: "line", text: l });
  return out;
}

/**
 * The markdown table starting at `lines[i]`, or null when none does.
 * `rows` is null when a table was clearly intended and its shape cannot be read.
 */
function tableAt(lines: string[], i: number): { indent: number; end: number; rows: string[][] | null } | null {
  const header = cellsOf(lines[i] ?? "");
  // An unnamed column cannot be referenced by a `<placeholder>`, so a header
  // with an empty cell is not a header — it is prose that contains pipes.
  if (header === null || header.length === 0 || header.some((c) => c.length === 0)) return null;
  const sep = cellsOf(lines[i + 1] ?? "");
  if (sep === null || !isSeparator(sep)) return null;
  const indent = /^\s*/.exec(lines[i]!)![0]!.length;
  if (sep.length !== header.length) return { indent, end: i + 1, rows: null };
  const rows: string[][] = [];
  let end = i + 1;
  for (let j = i + 2; j < lines.length; j += 1) {
    const row = cellsOf(lines[j]!);
    if (row === null) break;
    end = j;
    if (row.length !== header.length) return { indent, end, rows: null };
    rows.push(row);
  }
  // A header and a separator with nothing under them is a table that carries
  // zero cases — worse than no table, because it reads as coverage.
  if (rows.length === 0) return { indent, end, rows: null };
  return { indent, end, rows: [header, ...rows] };
}

/**
 * A scenario body split for rendering: bullet lines that read as steps become
 * steps, a fenced block or an INDENTED table under a step becomes that step's
 * argument, a table at the body's own left margin becomes the `Examples` of a
 * `Scenario Outline`, and every other non-blank line is kept (edge-trimmed) as
 * the scenario's description. Description renders BEFORE the steps whatever the
 * source order — Gherkin's grammar ends a description at the first step keyword
 * — so prose survives verbatim but interleaving does not.
 *
 * INDENTATION IS THE WHOLE DISAMBIGUATION, and it is one rule an author can
 * hold in their head: a table written under a step, indented the way markdown
 * already asks you to indent anything belonging to a list item, is that step's
 * data table; a table at the margin is the scenario's case matrix. Before this
 * rule existed there was only the second reading, so `Then the ledger holds:`
 * followed by its expected rows silently became a two-case outline and the step
 * reached the runner with no argument at all.
 *
 * The table matters more than it looks in both roles. A permission matrix, a
 * validation matrix, a status-code table — the shape most of a service's
 * decision layer actually has — is one parameterized test in the code it came
 * from and one outline here. And an expected-state table is how a component
 * test says what a row, a topic or an outbox must hold after one data pass;
 * without it that assertion is prose, and prose asserts nothing.
 *
 * ONLY THE FIRST top-level table is `Examples`. Gherkin permits several
 * `Examples` blocks per outline, and supporting them would make "which table is
 * the outline's" a question with no answer in markdown; a second one keeps its
 * prose exactly as it reads today.
 */
export function scenarioGherkin(lines: string[]): ScenarioGherkin {
  const description: string[] = [];
  const steps: EmittedStep[] = [];
  let examples: Examples | null = null;
  let malformedExamples = false;
  let strandedBlocks = false;
  const keep = (raw: string[]): void => {
    for (const l of raw) if (l.trim().length > 0) description.push(l.trim());
  };
  for (const block of blocksOf(lines)) {
    if (block.kind === "line") {
      if (block.text.trim().length === 0) continue;
      const step = stepFromLine(block.text);
      if (step) steps.push({ text: step.text.length > 0 ? `${step.keyword} ${step.text}` : step.keyword });
      else description.push(block.text.trim());
      continue;
    }
    const last = steps[steps.length - 1];
    if (block.kind === "fence") {
      if (last === undefined) {
        strandedBlocks = true;
        keep(block.lines);
        continue;
      }
      last.docstring = {
        ...(block.contentType === undefined ? {} : { contentType: block.contentType }),
        lines: block.lines.map((l) => l.slice(0, block.indent).trim().length === 0 ? l.slice(block.indent) : l.trimStart()),
      };
      continue;
    }
    // A table at the margin answers to the scenario; an indented one answers to
    // the step above it. Either can be unreadable, and an unreadable one keeps
    // its prose rather than being guessed at.
    if (block.indent === 0 && examples === null && !malformedExamples) {
      if (block.rows === null) {
        malformedExamples = true;
        keep(block.lines);
      } else examples = { header: block.rows[0]!, rows: block.rows.slice(1) };
      continue;
    }
    if (block.indent > 0 && block.rows !== null && last !== undefined) {
      last.table = block.rows;
      continue;
    }
    if (block.indent > 0) strandedBlocks = true;
    keep(block.lines);
  }
  return { description, steps, examples, malformedExamples, strandedBlocks };
}
