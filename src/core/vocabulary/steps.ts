/**
 * What counts as a Gherkin step in a scenario body — the one rule `loam gherkin`
 * emits by and `loam validate` grades by.
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
 */

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

export interface ScenarioGherkin {
  description: string[];
  steps: string[];
  /** The cases a `Scenario Outline` runs, or null for a plain `Scenario`. */
  examples: Examples | null;
  /**
   * A table was clearly intended and could not be read — a row whose width
   * disagrees with the header, or a header with no rows under it.
   *
   * Reported rather than guessed at. The rule this whole module holds is that
   * prose is never dropped, so a table loam cannot read stays in the scenario
   * DESCRIPTION and the emission is still valid Gherkin — which is exactly why
   * silence would be wrong: the author wrote twenty cases, cucumber runs one
   * scenario, and both the file and the report look healthy.
   */
  malformedExamples: boolean;
}

/** `| a | b |` -> `["a", "b"]`; null when the line is not a pipe row at all. */
function cellsOf(line: string): string[] | null {
  const m = /^\|(.*)\|$/.exec(line.trim());
  if (!m) return null;
  return m[1]!.split("|").map((c) => c.trim());
}

/** `|---|:--:|` — the row markdown puts under a table header. */
function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * The first markdown table in a scenario body, as the span it occupies and the
 * `Examples` it yields — `examples: null` when the shape is broken.
 *
 * The FIRST only. Gherkin permits several `Examples` blocks per outline, and
 * supporting them here would make "which table is the outline's" a question
 * with no answer in markdown; one table is a rule an author can hold in their
 * head, and a second one keeps its prose exactly as it reads today.
 */
function findTable(lines: string[]): { start: number; end: number; examples: Examples | null } | null {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const header = cellsOf(lines[i]!);
    // An unnamed column cannot be referenced by a `<placeholder>`, so a header
    // with an empty cell is not a header — it is prose that contains pipes.
    if (header === null || header.length === 0 || header.some((c) => c.length === 0)) continue;
    const sep = cellsOf(lines[i + 1]!);
    if (sep === null || !isSeparator(sep)) continue;
    if (sep.length !== header.length) return { start: i, end: i + 1, examples: null };
    const rows: string[][] = [];
    let end = i + 1;
    for (let j = i + 2; j < lines.length; j += 1) {
      const row = cellsOf(lines[j]!);
      if (row === null) break;
      end = j;
      if (row.length !== header.length) return { start: i, end, examples: null };
      rows.push(row);
    }
    // A header and a separator with nothing under them is an outline that runs
    // zero cases — worse than a plain scenario, because it reads as coverage.
    if (rows.length === 0) return { start: i, end, examples: null };
    return { start: i, end, examples: { header, rows } };
  }
  return null;
}

/**
 * A scenario body split for rendering: bullet lines that read as steps become
 * steps, a markdown table becomes the `Examples` of a `Scenario Outline`, and
 * every other non-blank line is kept (edge-trimmed) as the scenario's
 * description. Description renders BEFORE the steps whatever the source order —
 * Gherkin's grammar ends a description at the first step keyword — so prose
 * survives verbatim but interleaving does not.
 *
 * The table matters more than it looks. A permission matrix, a validation
 * matrix, a status-code table — the shape most of a service's decision layer
 * actually has — is one parameterized test in the code it came from and one
 * outline here. Without this it is N near-identical scenarios, which is the
 * cost at which an author stops enumerating and starts summarising.
 */
export function scenarioGherkin(lines: string[]): ScenarioGherkin {
  const table = findTable(lines);
  const inTable = (i: number): boolean =>
    table !== null && table.examples !== null && i >= table.start && i <= table.end;
  const description: string[] = [];
  const steps: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (inTable(i) || line.trim().length === 0) continue;
    const step = stepFromLine(line);
    if (step) steps.push(step.text.length > 0 ? `${step.keyword} ${step.text}` : step.keyword);
    else description.push(line.trim());
  }
  return {
    description,
    steps,
    examples: table?.examples ?? null,
    malformedExamples: table !== null && table.examples === null,
  };
}
