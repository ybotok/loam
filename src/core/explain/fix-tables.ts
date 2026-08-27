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
 * Every fix-table row of one workflow body, in document order.
 *
 * The scope tracking is why this walks lines rather than matching rows
 * globally: each table's introducing paragraph ends one blank line above the
 * header row, so the label is the most recently COMPLETED paragraph when a
 * table opens (or the one still being built, for a table glued directly under
 * its intro).
 */
export function parseFixRows(body: string): FixRow[] {
  const rows: FixRow[] = [];
  let paragraph: string[] = [];
  let lastParagraph: string[] = [];
  let scope = "";
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      if (paragraph.length > 0) lastParagraph = paragraph;
      paragraph = [];
      continue;
    }
    if (!line.startsWith("|")) {
      paragraph.push(line);
      continue;
    }
    const intro = paragraph.length > 0 ? paragraph : lastParagraph;
    if (intro.length > 0) {
      scope = scopeLabel(intro[0]!);
      // Consumed: the next table needs its own intro, not this one again.
      lastParagraph = [];
      paragraph = [];
    }
    const cells = splitRow(line);
    if (cells === null) continue;
    const codeCell = cells[0]!;
    const codes = [...codeCell.matchAll(CODE_SPAN)].map((m) => m[1]!);
    // The `| code | what it means | …` header row has no backticked code.
    if (codes.length === 0) continue;
    rows.push({
      codes,
      severityNote: SEVERITY_NOTE.exec(codeCell)?.[1] ?? "error",
      meaning: cells[1]!,
      fix: cells.slice(2).join(" | "),
      scope,
    });
  }
  return rows;
}
