/**
 * Small shaping helpers for the renderers.
 *
 * They live in `commands/` and not in `core/`: nothing here computes an answer,
 * it only decides how an answer READS. That was for a long time true of people
 * only — the header used to say "the `--json` payloads never touch this file",
 * and `fixesFor` below is the exception that retired the sentence. It is here
 * for the same reason the rest is: a fix string is not a verdict, it is the
 * shaping of one that has already been decided, and the module that owns the
 * text pointer to `loam explain` should own its machine form too, or the two
 * drift the way every second copy in this codebase eventually has.
 */
import { explainSubject } from "../../core/explain/lookup.js";
import { type DiscardedAnswer } from "../../core/verify/build.js";

/**
 * "1 service", "2 services". The regular English plural, spelled once because
 * five renderers had drifted into five copies of the same ternary and a sixth
 * would have been written the next time somebody counted something. A noun with
 * an irregular plural does not belong here — say both forms at the call site.
 */
/**
 * The one spelling of "this run first recovered a predecessor's commit" — it
 * existed in three copies (rebase, gherkin, verify --record) before vouch and
 * new needed a fourth and fifth, which is the extraction rule's third strike
 * twice over. Reported at all because docs changing beyond the command's own
 * writes would otherwise read as its doing.
 */
export function sayRecovered(r: { command: string; outcome: string; repaired: string[] }): string {
  return (
    `recovered an interrupted \`loam ${r.command}\` first (${r.outcome}` +
    `${r.repaired.length === 0 ? "" : `: ${r.repaired.join(", ")}`}).`
  );
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The one spelling of the vocabulary pointer `validate` and `verify` append to
 * a TEXT report that printed findings — one string here rather than one per
 * renderer, because a hand-written second copy is exactly the drift the
 * pointer's target exists to prevent.
 *
 * It used to open with "codes ride in `--json`", and that clause existed for
 * one reason only: validate's text lines carried messages and no code strings,
 * so a footer asking the reader to explain "a code above" would have asked for
 * something never on their screen. That is no longer true — validate appends
 * the code to every non-`ok` finding and verify's notices have always led with
 * theirs (validate/report.ts, verify/report.ts) — so the clause has been
 * dropped rather than reworded: telling a reader to go re-run the command with
 * `--json` to find what is already two words to the left is worse than saying
 * nothing.
 *
 * Text mode only, and still: this SENTENCE never enters a payload. What
 * `--json` carries instead is the answer the sentence points at — `fixesFor`
 * below — because a machine reader has no use for being told a second command
 * exists, only for what it would have said.
 */
export const EXPLAIN_FOOTER =
  "→ `loam explain <code>` says what a code means and how to fix it";

/**
 * The machine form of the footer above: the codes a run actually raised,
 * resolved to what their fix tables say to do about them.
 *
 * The footer tells a PERSON that `loam explain <code>` exists. A `--json`
 * consumer got no such sentence — the payload is codes and prose messages, and
 * nothing in a finding says a fix is a lookup away — so an agent holding
 * `validate --all --json` either had the (now narrowable) /loam-check fix
 * tables in context already or spawned one `loam explain` process per code,
 * having first guessed that it could. This closes the gap by answering the
 * lookup in the same envelope.
 *
 * Resolved through `explainSubject` — the very function `loam explain <code>`
 * calls — and NOT through a second table, so the two surfaces cannot disagree
 * about what to do about a code. The cost is one walk of the shipped workflow
 * bodies per DISTINCT code (measured: 0.43ms each, so ~4ms for the nine codes
 * a fleet run typically raises). `listCodes()` would do one walk for all of
 * them, and was not used: it builds 227 answers to spend nine, and it would
 * only start paying off on a run that raised most of the vocabulary — which
 * is a repo with worse problems than the cost of its report.
 *
 * A code the tables do not grade is simply ABSENT from the result. There is no
 * placeholder string and there must not be one: the named backlog in
 * test/explain.test.ts is the record of which code families still have no row,
 * and a fabricated "no fix recorded" here would satisfy the eye at exactly the
 * place that record is supposed to itch.
 *
 * Two shaping rules, both forced by the tables rather than chosen:
 * - Keys are sorted and deduplicated, so two runs over the same findings
 *   produce byte-identical maps and a diff of two reports shows only what
 *   moved.
 * - Ten of the 227 finding codes are graded by more than one table, and nine
 *   of those ten say something DIFFERENT to do depending on the scope
 *   (`openapi.ref-unresolved` is one thing under `--service` and another at
 *   archive plan time). A single-fix code is emitted verbatim; a code whose
 *   tables disagree is emitted as its scope-labelled blocks, in table order,
 *   the same way `loam explain` prints it. Picking the first table's fix would
 *   be shorter and would sometimes be the wrong instruction, which is the one
 *   thing a fix string may not be.
 */
export function fixesFor(codes: readonly string[]): Record<string, string> {
  const fixes: Record<string, string> = {};
  for (const code of [...new Set(codes)].sort()) {
    const explanation = explainSubject(code);
    // Only the finding arm contributes. A refusal code is an `error.code` and
    // never appears in a findings array, and a concept term is not a code at
    // all — the three key sets are pinned pairwise disjoint by
    // test/explain.test.ts, so this narrowing is a type guard, not a policy.
    if (explanation === null || explanation.kind !== "finding") continue;
    // Keyed by the fix so a code graded identically by two tables says it
    // once, and valued by the FIRST scope that gave it so the labelled form
    // reads in table order.
    const byFix = new Map<string, string>();
    for (const entry of explanation.entries) {
      // A row whose "what to do" cell is empty states a consequence, not an
      // action; it contributes nothing a caller could act on.
      if (entry.fix !== "" && !byFix.has(entry.fix)) byFix.set(entry.fix, entry.scope);
    }
    const distinct = [...byFix];
    if (distinct.length === 0) continue;
    fixes[code] =
      distinct.length === 1
        ? distinct[0]![0]
        : distinct.map(([fix, scope]) => `[${scope}] ${fix}`).join(" ");
  }
  return fixes;
}

/**
 * What the previous record answered and the new one does not — printed, never
 * decided here (`buildFederatedVerification` decides; `verify --record`
 * reports). A federated write is a partial write, so the first one over an
 * all-at-once record drops every answer it cannot attribute to a commit —
 * correct, but silence there reads as loam having lost the answers, and nobody
 * goes looking for what to re-record. It lives beside `sayRecovered` because
 * it is the same kind of helper: one spelling of an account the command owes a
 * person about something the run did beyond its own answer.
 */
export function sayDiscarded(discarded: DiscardedAnswer[], recordPath: string, feature: string): void {
  if (discarded.length === 0) return;
  const off = discarded.filter((d) => d.reason === "off-checklist").length;
  console.log(
    `\n  ${plural(discarded.length, "earlier answer")} from ${recordPath} ${discarded.length === 1 ? "is" : "are"} not carried into this record:`,
  );
  for (const d of discarded) {
    console.log(
      `    - ${d.id}${d.subject === undefined ? "" : ` [${d.subject}]`}  ${d.claim}` +
        (d.reason === "off-checklist"
          ? "  (the feature changed; nothing asks this any more)"
          : "  (no commit attestation binds it — its service must record it again)"),
    );
  }
  if (discarded.length > off) {
    console.log(
      `    Each owning service records its own with \`loam verify ${feature} --record answers.json --service <svc>\` in its repo.`,
    );
  }
}
