/**
 * The explain lookup: one subject in — a finding code, an envelope refusal
 * code, or a concept term — one discriminated explanation out.
 *
 * Assembled ON DEMAND, never cached at module level: tests run in forked
 * processes that chdir per invocation, and a long-running host (the MCP
 * server) outlives many calls — a table built at import time is exactly the
 * module-level mutable state AGENTS.md names as a hazard. The build is a walk
 * over constants already in memory, so there is nothing worth caching anyway.
 *
 * Resolution order — finding tables first, then refusal codes, then terms —
 * IS the tie-break: a subject in two families would silently take the earlier
 * family's answer (a refusal named like a term alias would win over the
 * term). No naming convention keeps them apart — `based-on` is a dashed term
 * alias, exactly the shape a refusal code takes — so test/explain.test.ts
 * asserts the three key sets are pairwise disjoint, and the order never
 * actually decides anything.
 */
import { COMMANDS } from "../agent/protocol.js";
import { VALIDATE_CHECKS, type BriefCheck } from "../brief/checks.js";
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

export function explainSubject(subject: string): Explanation | null {
  const brief = briefFor(subject);
  // VALIDATE_CHECKS contributes `via` ONLY, never a fallback entry. An
  // earlier draft synthesized a row from the brief when the tables had none,
  // and that fallback was both unreachable (every brief check has a table
  // row, pinned by test/explain.test.ts) and wrong if ever reached: its
  // scope would have been the brief's invocation string, a spelling no
  // parsed row uses. A brief check that LOSES its table row should fail
  // loudly there — explain refusing is the tripwire — not render a
  // one-of-a-kind page nobody else prints.
  const entries: FindingEntry[] = allRows()
    .filter((row) => row.codes.includes(subject))
    .map(({ scope, severityNote, meaning, fix }) => ({ scope, severityNote, meaning, fix }));
  if (entries.length > 0) {
    return { kind: "finding", entries, ...(brief === undefined ? {} : { via: brief.via }) };
  }
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
  for (const check of VALIDATE_CHECKS) known.add(check.code);
  for (const key of Object.keys(REFUSAL_MEANINGS)) known.add(key);
  for (const entry of TERMS) {
    known.add(entry.term);
    for (const alias of entry.aliases) known.add(alias);
  }
  return [...known].sort();
}

/** The no-argument listing: each term with its paragraph's first sentence as the one-line summary. */
export function listTerms(): Array<{ term: string; summary: string }> {
  return TERMS.map(({ term, paragraph }) => {
    const cut = paragraph.indexOf(". ");
    return { term, summary: cut === -1 ? paragraph : paragraph.slice(0, cut + 1) };
  });
}
