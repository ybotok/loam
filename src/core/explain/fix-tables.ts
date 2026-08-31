/**
 * The fix-table parser: `loam explain`'s finding-code content, read at runtime
 * out of the workflow bodies the binary ships. Every protocol body in
 * `COMMANDS` is walked, so a table added to any workflow is picked up without
 * touching this parser — today the tables live in the /loam-check body
 * (src/core/agent/workflows/check.ts) and the /loam-verify body's notice
 * table (src/core/agent/workflows/closing.ts).
 *
 * A PARSER rather than a table of its own, deliberately: the /loam-check fix
 * tables are already the documentation corpus test/codes-drift.test.ts holds
 * every emitted finding code against, so they are the one place the
 * meaning-and-fix prose is guaranteed to exist and to stay current. A second
 * copy inside an `explain` registry would be exactly the hand-maintained map
 * that silently trails the binary — worse than no command. Reading the shipped
 * constant instead means `loam explain spine.op-undefined` and the /loam-check
 * page cannot disagree, because they are the same bytes.
 *
 * The same walk also STRIPS those tables (`withoutFixTables`), which is what
 * `loam instructions <workflow> --no-fix-tables` prints. One walk and not two,
 * deliberately: a stripper carrying a regex of its own would be free to
 * disagree with the parser about where a table begins and ends, and the failure
 * that produces is both silent and precisely the wrong one — a narrowed
 * protocol whose omitted rows `loam explain` cannot answer, telling an agent to
 * look up a code nothing explains. Sharing the block detection makes "what was
 * dropped" and "what can be explained" the same computation rather than two
 * that agree today.
 *
 * The row grammar this depends on (test/explain.test.ts pins it with probes
 * and a count floor, so a table reformat fails loudly instead of leaving the
 * lookup silently empty):
 *
 *   | `a.code` / `b.code` (severity note) | what it means | what to do |
 *
 * - the first cell holds one or more backticked codes and an optional trailing
 *   parenthetical severity note, printed verbatim (`(warn)`, `(error, or
 *   warn)`, `(warn, gates archive; one per service)`, `(ok)`); a row with no
 *   note is an error, the tables' own default;
 * - cells never contain the ` | ` separator today; if a meaning cell ever
 *   grows one, the probes convict the mis-split rather than letting it ship;
 * - the paragraph introducing each table (`` `--service <id>` — one service's
 *   own axes… ``) names the scope its rows are graded in, so a code that
 *   appears in two tables (`spec.merge-conflict`) explains both contexts.
 */

export interface FixRow {
  /** The backticked code(s) of the row's first cell — multi-code rows share one meaning. */
  readonly codes: readonly string[];
  /** The verbatim parenthetical from the first cell, or "error" — the tables' default. */
  readonly severityNote: string;
  /** The "what it means" cell, verbatim. */
  readonly meaning: string;
  /** The "what to do" cell, verbatim. */
  readonly fix: string;
  /** The short label of the table's introducing paragraph (`--service <id>`, `loam archive`, …). */
  readonly scope: string;
}

const CODE_SPAN = /`([a-z][a-z0-9.-]*)`/g;
const SEVERITY_NOTE = /\(([^)]+)\)\s*$/;

/**
 * The scope label: the introducing paragraph's first line up to its ` — `
 * dash, backticks stripped — "`--feature <FEAT-id>` — a change's three axes…"
 * labels its rows `--feature <FEAT-id>`. A paragraph with no dash (none exist
 * today) falls back to its whole first line minus the trailing colon.
 */
function scopeLabel(firstLine: string): string {
  const head = firstLine.split(" — ")[0] ?? firstLine;
  return head.replace(/`/g, "").replace(/:$/, "").trim();
}

/**
 * Split one table row into its cells, or null for a line that is not a
 * three-cell row (the `|---|---|---|` separator has no ` | ` and yields one
 * cell). More than three cells re-joins the tail into the fix column — the
 * meaning cell is the split's second field either way, and the probe tests
 * are what convict a cell that ever grows a ` | ` of its own.
 */
function splitRow(line: string): string[] | null {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  const cells = line.slice(1, -1).split(" | ").map((cell) => cell.trim());
  return cells.length >= 3 ? cells : null;
}

/**
 * One fix table as it sits in a body: which lines it occupies, and the rows
 * read out of them.
 *
 * The line span is what makes the stripper possible without a second notion of
 * where a table is. `start` is the header row (`| code | what it means | …`)
 * and `end` is one PAST the last table line, so `lines.slice(start, end)` is
 * exactly the block and `lines.slice(end)` is exactly what follows it — the
 * blank line and the next paragraph included, which is why the introducing
 * paragraph survives a strip.
 */
interface TableBlock {
  readonly start: number;
  readonly end: number;
  readonly rows: readonly FixRow[];
}

/**
 * Every fix table of one workflow body, in document order, each with its rows.
 *
 * The scope tracking is why this walks lines rather than matching rows
 * globally: each table's introducing paragraph ends one blank line above the
 * header row, so the label is the most recently COMPLETED paragraph when a
 * table opens (or the one still being built, for a table glued directly under
 * its intro).
 *
 * A run of consecutive `|` lines is one block, and the first line that is not
 * one closes it. That is the whole grammar — markdown gives a table no other
 * terminator — and it is why the blank line after a table belongs to what
 * follows rather than to the block.
 */
function fixTableBlocks(body: string): TableBlock[] {
  const lines = body.split("\n");
  const blocks: TableBlock[] = [];
  let paragraph: string[] = [];
  let lastParagraph: string[] = [];
  let scope = "";
  let open: { start: number; rows: FixRow[] } | null = null;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (!line.startsWith("|")) {
      if (open !== null) {
        blocks.push({ start: open.start, end: index, rows: open.rows });
        open = null;
      }
      if (line === "") {
        if (paragraph.length > 0) lastParagraph = paragraph;
        paragraph = [];
      } else {
        paragraph.push(line);
      }
      continue;
    }
    const intro = paragraph.length > 0 ? paragraph : lastParagraph;
    if (intro.length > 0) {
      scope = scopeLabel(intro[0]!);
      // Consumed: the next table needs its own intro, not this one again.
      lastParagraph = [];
      paragraph = [];
    }
    if (open === null) open = { start: index, rows: [] };
    const cells = splitRow(line);
    if (cells === null) continue;
    const codeCell = cells[0]!;
    const codes = [...codeCell.matchAll(CODE_SPAN)].map((m) => m[1]!);
    // The `| code | what it means | …` header row has no backticked code.
    if (codes.length === 0) continue;
    open.rows.push({
      codes,
      severityNote: SEVERITY_NOTE.exec(codeCell)?.[1] ?? "error",
      meaning: cells[1]!,
      fix: cells.slice(2).join(" | "),
      scope,
    });
  }
  // A body ending mid-table has no closing line to end the block; today every
  // body ends in prose, and a table that is the last thing in one must still
  // be seen rather than silently dropped from the lookup.
  if (open !== null) blocks.push({ start: open.start, end: lines.length, rows: open.rows });
  return blocks;
}

/** Every fix-table row of one workflow body, in document order. */
export function parseFixRows(body: string): FixRow[] {
  return fixTableBlocks(body).flatMap((block) => [...block.rows]);
}

/**
 * The same body with every fix table collapsed to one line naming what was
 * dropped and how to get it back.
 *
 * What this is FOR: /loam-check's body is 83 KB, about a fifth of a 100k-token
 * window, and every generated command and skill file opens by telling an agent
 * to run it. The rows are the whole of that weight and almost none of them are
 * about the run in hand — `loam explain <code>` answers one row in 473 bytes,
 * which is the lazy path this makes payable.
 *
 * The introducing PARAGRAPH stays, and that is not a formatting nicety. It is
 * the sentence that says which scope a code was graded in (`--service <id>`,
 * `--feature <FEAT-id>`, `loam archive`), and the same code means different
 * things in two of them — `spec.merge-conflict` is graded on a living document
 * and on a delta of it. Drop the intro and the remaining prose stops saying
 * which run it is describing.
 */
export function withoutFixTables(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let at = 0;
  for (const { start, end, rows } of fixTableBlocks(body)) {
    // A block with no parsed rows is not a fix table — a two-column table, or
    // a row grammar that has moved. Left standing rather than replaced by a
    // line claiming rows nobody can look up.
    if (rows.length === 0) continue;
    out.push(...lines.slice(at, start));
    out.push(
      `(${rows.length} row${rows.length === 1 ? "" : "s"} omitted — ` +
        `run \`loam explain <code>\` on any code this run reports.)`,
    );
    at = end;
  }
  out.push(...lines.slice(at));
  return out.join("\n");
}
