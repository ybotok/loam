/**
 * The explain lookup: one subject in — a finding code, an envelope refusal
 * code, or a concept term — one discriminated explanation out. It also answers
 * the two listings the command prints with no subject: `listTerms` for the
 * concept vocabulary and `listCodes` for the code vocabulary, the latter built
 * from the same `findingIn` the per-code answer uses so the inventory cannot
 * describe a code differently from the page about it.
 *
 * Assembled ON DEMAND, never cached at module level: tests run in forked
 * processes that chdir per invocation, and a long-running host (the MCP
 * server) outlives many calls — a table built at import time is exactly the
 * module-level mutable state AGENTS.md names as a hazard. The build is a walk
 * over constants already in memory, so there is nothing worth caching anyway.
 *
 * Resolution order — finding tables first, then the family registry, then
 * refusal codes, then terms — IS the tie-break: a subject in two families
 * would silently take the earlier family's answer (a refusal named like a term
 * alias would win over the term). No naming convention keeps them apart —
 * `based-on` is a dashed term alias, exactly the shape a refusal code takes —
 * so test/explain.test.ts asserts the key sets are pairwise disjoint, and the
 * order never actually decides anything.
 *
 * The one place that order is load-bearing anyway is the fix tables against
 * ./families.ts: the tables are PARSED from the bytes the binary ships and the
 * registry is written by hand, so where both could answer, the parsed prose has
 * to win and the hand-written row must never silently shadow it. It is written
 * first here and asserted disjoint there, which makes the precedence a fact
 * about the code as well as a fact about the data.
 */
import { COMMANDS } from "../agent/protocol.js";
import { VALIDATE_CHECKS, type BriefCheck } from "../brief/checks.js";
import { familyCodes, familyFinding } from "./families.js";
import { parseFixRows, type FixRow } from "./fix-tables.js";
import { REFUSAL_MEANINGS } from "./refusals.js";
import { TERMS, type TermEntry } from "./terms.js";

export interface FindingEntry {
  /** Which table graded it — `--service <id>`, `--feature <FEAT-id>`, `--all`, `loam archive`, … */
  readonly scope: string;
  /** The table's verbatim parenthetical, or "error" — its default. */
  readonly severityNote: string;
  readonly meaning: string;
  readonly fix: string;
}

export type Explanation =
  | { readonly kind: "finding"; readonly entries: readonly FindingEntry[]; readonly via?: string }
  | { readonly kind: "refusal"; readonly meaning: string }
  | { readonly kind: "term"; readonly term: string; readonly paragraph: string };

/** Every fix-table row shipped in the workflow bodies, in protocol order. */
function allRows(): FixRow[] {
  return COMMANDS.flatMap((command) => parseFixRows(command.body));
}

function briefFor(subject: string): BriefCheck | undefined {
  return VALIDATE_CHECKS.find((check) => check.code === subject);
}

/** Terms match case-insensitively, by name or alias — codes stay exact, they are already lowercase by grammar. */
function termFor(subject: string): TermEntry | undefined {
  const wanted = subject.toLowerCase();
  return TERMS.find((entry) => entry.term === wanted || entry.aliases.includes(wanted));
}

/**
 * The finding answer for one subject out of rows ALREADY parsed, or null when
 * no table grades it.
 *
 * Split out of `explainSubject` so `listCodes` builds its rows through the
 * very same function rather than a parallel one: the inventory's per-code
 * payload is then the per-code answer by construction, not by two pieces of
 * code agreeing. It also keeps the inventory's cost linear — `explainSubject`
 * re-parses every workflow body on each call, and calling it 270 times to
 * enumerate the vocabulary would re-walk the whole corpus 270 times.
 */
function findingIn(rows: readonly FixRow[], subject: string): Extract<Explanation, { kind: "finding" }> | null {
  const brief = briefFor(subject);
  // VALIDATE_CHECKS contributes `via` ONLY, never a fallback entry. An
  // earlier draft synthesized a row from the brief when the tables had none,
  // and that fallback was both unreachable (every brief check has a table
  // row, pinned by test/explain.test.ts) and wrong if ever reached: its
  // scope would have been the brief's invocation string, a spelling no
  // parsed row uses. A brief check that LOSES its table row should fail
  // loudly there — explain refusing is the tripwire — not render a
  // one-of-a-kind page nobody else prints.
  const entries: FindingEntry[] = rows
    .filter((row) => row.codes.includes(subject))
    .map(({ scope, severityNote, meaning, fix }) => ({ scope, severityNote, meaning, fix }));
  if (entries.length === 0) return null;
  return { kind: "finding", entries, ...(brief === undefined ? {} : { via: brief.via }) };
}

/**
 * The finding answer from EITHER source, tables first.
 *
 * One function rather than two call sites choosing an order, because the order
 * is the precedence rule: a code a fix table grades is answered from the bytes
 * the binary ships, and ./families.ts only ever answers codes no table reaches.
 * `via` is a fix-table-only fact — it comes from a `VALIDATE_CHECKS` entry, and
 * no brief check names a `doctor.*`, `next.*`, `diff.*` or `gate.*` code — so a
 * registry answer carries a single entry and nothing else, which is the same
 * shape a one-table code already returns.
 */
function findingFor(rows: readonly FixRow[], subject: string): Extract<Explanation, { kind: "finding" }> | null {
  const table = findingIn(rows, subject);
  if (table !== null) return table;
  const family = familyFinding(subject);
  return family === null ? null : { kind: "finding", entries: [family] };
}

export function explainSubject(subject: string): Explanation | null {
  const finding = findingFor(allRows(), subject);
  if (finding !== null) return finding;
  // Through Object.entries rather than an indexed read: the record's keys are
  // `ErrorCode`, `subject` is an arbitrary string, and the Map lookup needs
  // neither a key cast nor a hasOwn pre-check.
  const refusal = new Map<string, string>(Object.entries(REFUSAL_MEANINGS)).get(subject);
  if (refusal !== undefined) return { kind: "refusal", meaning: refusal };
  const term = termFor(subject);
  if (term !== undefined) return { kind: "term", term: term.term, paragraph: term.paragraph };
  return null;
}

/**
 * Every subject `explainSubject` can answer — for the unknown-subject
 * refusal's close-match suggestions. Sorted, so suggestion ties break the
 * same way on every machine.
 */
export function knownSubjects(): string[] {
  const known = new Set<string>();
  for (const row of allRows()) for (const rowCode of row.codes) known.add(rowCode);
  for (const familyCode of familyCodes()) known.add(familyCode);
  for (const check of VALIDATE_CHECKS) known.add(check.code);
  for (const key of Object.keys(REFUSAL_MEANINGS)) known.add(key);
  for (const entry of TERMS) {
    known.add(entry.term);
    for (const alias of entry.aliases) known.add(alias);
  }
  return [...known].sort();
}

/**
 * A paragraph's first sentence — the one-line summary form both listings
 * print. One definition rather than two: the term listing and the code
 * listing must cut prose the same way, or the same sentence reads as two
 * different summaries depending on which command printed it.
 */
export function firstSentence(text: string): string {
  const cut = text.indexOf(". ");
  return cut === -1 ? text : text.slice(0, cut + 1);
}

/** The no-argument listing: each term with its paragraph's first sentence as the one-line summary. */
export function listTerms(): Array<{ term: string; summary: string }> {
  return TERMS.map(({ term, paragraph }) => ({ term, summary: firstSentence(paragraph) }));
}

/**
 * One row of the code inventory: the per-code answer with its code attached.
 *
 * DERIVED from `Explanation` rather than restated, so `loam explain <code>
 * --json` and `loam explain --codes --json` cannot describe the same code with
 * two different key sets — a caching consumer reads one and looks up the other.
 * The `term` arm is excluded on purpose: a concept term is a different kind of
 * subject, and the bare `loam explain` listing keeps them.
 *
 * There is deliberately NO `severity` or `gates` key here, and adding one
 * would be a defect rather than an improvement. A fix table carries only the
 * verbatim parenthetical its author wrote (`warn, gates archive; one per
 * service`), which is prose about a scope, while the answer a caller would
 * actually branch on is computed per ISSUE at runtime by `gatesArchive()` and
 * `approveOverrides()` in core/vocabulary/issue.ts — from `severity`, an
 * optional per-issue `gates`, and a never-overridable code set. A severity
 * derived from the parenthetical here would be a second answer to a question
 * that already has one, free to disagree with the binary's own gate.
 */
export type CodeListing = { readonly code: string } & Exclude<Explanation, { kind: "term" }>;

/**
 * Every code `explainSubject` can answer — the machine-readable inventory of
 * the vocabulary, which is otherwise discoverable only by parsing the 83 KB
 * prose body of `loam instructions loam-check` or by reading TypeScript
 * unions that are erased at runtime.
 *
 * Sorted within each kind rather than left in document order: the fix tables
 * are ordered by scope for somebody working through one table, but an
 * inventory is read by name and diffed between binaries, and document order
 * would reshuffle on an unrelated table edit.
 */
export function listCodes(): CodeListing[] {
  const rows = allRows();
  // One sorted finding group over BOTH sources rather than a third listing
  // heading. A caller building a code-to-fix cache asks "what does this binary
  // explain", and a `doctor.*` row that arrived from ./families.ts rather than
  // from a parsed table is the same answer to that question — the row it gets
  // is `explain <code> --json`'s payload either way. Splitting them would put
  // the provenance of the prose into the machine contract, where nothing
  // branches on it.
  const findings: CodeListing[] = [...new Set([...rows.flatMap((row) => row.codes), ...familyCodes()])]
    .sort()
    // Non-null: the code came out of `rows` or out of the registry, and
    // `findingFor` reads exactly those two.
    .map((code) => ({ code, ...findingFor(rows, code)! }));
  // Through a Map for the same reason `explainSubject` reads one: the record's
  // keys are `ErrorCode` and this listing's are plain strings. Plain `.sort()`
  // throughout, never `localeCompare` — the order is part of the machine
  // contract and must not depend on the host's ICU locale.
  const meanings = new Map<string, string>(Object.entries(REFUSAL_MEANINGS));
  const refusals: CodeListing[] = [...meanings.keys()]
    .sort()
    .map((code) => ({ code, kind: "refusal" as const, meaning: meanings.get(code)! }));
  return [...findings, ...refusals];
}
