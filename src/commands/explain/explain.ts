/**
 * `loam explain <code|term>` — what a finding code, a refusal code or a loam
 * concept means, from the binary that emits it.
 *
 * Like `loam instructions` — and for the same reason — this command reads
 * NOTHING: no `loam.json`, no docs repo, no service, and deliberately no
 * docs-repo gate (add-command invariant 3). The vocabulary wall is hit in the
 * first minute in an unfamiliar repository, before or without wiring, and an
 * explanation that refused with `no-config` would be unreachable exactly when
 * a code is first met. The content is version-matched by construction: the
 * finding prose is parsed at runtime out of the same workflow bodies this
 * binary ships (core/explain/fix-tables.ts), so what `explain` says and what
 * /loam-check teaches cannot disagree.
 *
 * `--codes` adds the missing half: per-code lookup was always cheap, but
 * nothing could discover WHICH codes exist — the ~230 finding codes and 46
 * refusal codes were enumerable only from erased TypeScript unions or by
 * parsing the 83 KB prose body of `loam instructions loam-check`. It is opt-in
 * and off by default precisely so adding it changed neither the term listing
 * nor any per-code page: it was an addition to the contract, not a change to
 * it, and the term listing's own footer was left alone for the same reason.
 *
 * The TEXT of those two views has since moved, deliberately and only as text:
 * the term listing grew from six terms to the words loam prints to a person
 * and is grouped under headings, and a finding page's scope headers say the
 * invocation that reports the code instead of a bracketed flag. Every `--json`
 * shape is what it was — the listing's flat `terms[]`, and each finding's
 * `entries[].scope` with the table's own label.
 */
import type { Command } from "commander";
import { emitJson, fail } from "../../core/envelope/json.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import {
  explainSubject,
  firstSentence,
  knownSubjects,
  listCodes,
  listTermGroups,
  listTerms,
  type CodeListing,
  type Explanation,
  type FindingEntry,
} from "../../core/explain/lookup.js";
import { nearestIds } from "../../core/repo/entries.js";

interface ExplainOptions {
  json?: boolean;
  codes?: boolean;
}

// Interpolated from the registry that owns the terms, never hand-listed: a
// copied list beside TERMS is a list that silently trails it.
const TERM_LIST = listTerms()
  .map(({ term }) => term)
  .join(", ");

/**
 * The listing printed when no subject is asked for — also where codes are said to come from.
 *
 * The text view prints the terms under their subject headings, one column wide
 * across every group so the summaries line up down the page; the `--json` view
 * stays the flat `terms[]` it has always been, because a heading is for a
 * reader scanning twenty terms and nothing a caller should branch on.
 */
function printTermListing(json: boolean): void {
  if (json) {
    const terms = listTerms();
    emitJson({ command: "explain", version: LOAM_VERSION, terms: terms.map(({ term, summary }) => ({ term, description: summary })) });
    return;
  }
  const groups = listTermGroups();
  console.log(`loam ${LOAM_VERSION} — the vocabulary`);
  const width = Math.max(...groups.flatMap(({ terms }) => terms.map(({ term }) => term.length)));
  for (const { heading, terms } of groups) {
    console.log(`\n${heading}`);
    for (const { term, summary } of terms) console.log(`  ${term.padEnd(width)}  ${summary}`);
  }
  console.log(
    "\nFinding codes come from `loam validate` and `loam verify` output; refusal codes arrive as error.code" +
      "\nin any --json envelope. `loam explain <subject>` explains one.",
  );
}

/**
 * How much of a code's meaning the inventory shows before it stops.
 *
 * The term listing prints whole first sentences because there are two dozen of
 * them, each under 200 characters. The code listing prints 270-odd rows whose
 * first sentences run to 377 characters, and a row that wraps four times is a
 * paragraph, not a line of a table — it destroys the one thing this listing is
 * for, which is scanning names. Nothing is lost: the sentence is verbatim in
 * `--json`, and `loam explain <code>` prints the whole entry.
 */
const SUMMARY_WIDTH = 72;

/** The listing's one-line gloss: the first sentence of the meaning, cut at a word boundary if it runs long. */
function summarize(listing: CodeListing): string {
  // A code graded in two tables is glossed by the FIRST table's meaning — the
  // listing answers "what is this about", and the per-scope difference (which
  // `explain <code>` prints in full, one block per table) is exactly the
  // detail a one-line row cannot carry honestly.
  const sentence = firstSentence(listing.kind === "finding" ? listing.entries[0]!.meaning : listing.meaning);
  if (sentence.length <= SUMMARY_WIDTH) return sentence;
  const cut = sentence.lastIndexOf(" ", SUMMARY_WIDTH);
  return `${sentence.slice(0, cut === -1 ? SUMMARY_WIDTH : cut)}…`;
}

/**
 * `--codes`: the whole code vocabulary, the inventory that was previously
 * enumerable only out of TypeScript unions or the 83 KB /loam-check prose.
 * The JSON rows are the per-code answers verbatim (core/explain/lookup.ts
 * derives `CodeListing` from `Explanation`), so a consumer can build a
 * code-to-fix cache from one call instead of one call per code.
 */
function printCodeListing(json: boolean): void {
  const codes = listCodes();
  if (json) {
    emitJson({ command: "explain", version: LOAM_VERSION, codes });
    return;
  }
  const findings = codes.filter((listing) => listing.kind === "finding");
  const refusals = codes.filter((listing) => listing.kind === "refusal");
  const width = Math.max(...codes.map(({ code }) => code.length));
  const print = (group: CodeListing[]): void => {
    for (const listing of group) console.log(`  ${listing.code.padEnd(width)}  ${summarize(listing)}`);
  };
  console.log(`loam ${LOAM_VERSION} — the code vocabulary (${findings.length} finding, ${refusals.length} refusal)\n`);
  console.log("finding codes — graded by `loam validate` and `loam verify`, in their findings[]");
  print(findings);
  console.log("\nrefusal codes — the `error.code` of a --json envelope, exit 1");
  print(refusals);
  console.log("\n`loam explain <code>` prints one in full; `loam explain` with no argument lists the concept terms.");
}

/**
 * The command a fix-table scope stands for, or null when the scope is a phrase.
 *
 * The tables label their scopes the way /loam-check's prose introduces them:
 * `--service <id>`, `--feature <FEAT-id>` and `--all` for `loam validate`'s
 * three modes, and a whole invocation (`loam archive`, `loam verify`, the
 * family registry's `loam status`) for every other command. Printed as they
 * stand, in brackets, the flag forms read as optional CLI syntax — `[--feature
 * <FEAT-id>]` is how a usage line spells an optional flag — rather than as
 * "this is where it was reported". So the text view says the invocation in
 * full; the `--json` `entries[].scope` keeps the table's own label, untouched.
 *
 * Two /loam-check tables are introduced by a phrase instead ("frontmatter and
 * provenance", "confirmations"); both grade inside `loam validate`, and the
 * caller says so. test/explain.test.ts holds the premise that makes that
 * reading safe: a scope that is neither a flag nor a `loam …` invocation comes
 * from the /loam-check body and from nowhere else.
 */
function invocationOf(scope: string): string | null {
  if (scope.startsWith("--")) return `loam validate ${scope}`;
  if (scope.startsWith("loam ")) return scope;
  return null;
}

/**
 * One scope block's header, in words: which command reports the code there,
 * and at what severity.
 *
 * `step` is the family registry's note for a `next.*` code, which no command
 * grades — `loam status` recommends it — so that one header says it is a
 * recommendation instead of printing "step" where a severity belongs.
 */
function scopeHeader(entry: FindingEntry): string {
  const invocation = invocationOf(entry.scope);
  const where = invocation === null ? "`loam validate`" : `\`${invocation}\``;
  const table = invocation === null ? ` (${entry.scope})` : "";
  if (entry.severityNote === "step") return `when ${where} suggests it as a next step${table}`;
  return `when ${where} reports it${table} — ${entry.severityNote}`;
}

/**
 * The finding page's first line: what kind of code this is, and how many
 * contexts follow.
 *
 * It used to be `code (error; warn) — surfaced by …`: every scope's
 * severity joined into one parenthetical nobody could map back to a scope, and
 * the adoption brief's `via` repeating what the first block's header already
 * says. The severities now live on the block each one belongs to. The `via`
 * is kept only where no block names its invocation — a /loam-check table
 * introduced by a phrase, whose rows the brief still runs under one exact
 * command a reader would otherwise have to guess.
 */
function findingHeadline(subject: string, finding: Extract<Explanation, { kind: "finding" }>): string {
  const { entries, via } = finding;
  if (entries.every((entry) => entry.severityNote === "step")) {
    return `${subject} — a next-step code: a recommendation \`loam status\` makes, not a finding`;
  }
  const places = entries.length > 1 ? `, reported in ${entries.length} places` : "";
  const unnamed = via !== undefined && !entries.some((entry) => invocationOf(entry.scope) === via);
  return `${subject} — a finding code${places}${unnamed ? `; \`${via}\` reports it` : ""}`;
}

function printText(subject: string, explanation: Explanation): void {
  if (explanation.kind === "term") {
    // An alias is answered by its term's entry, and the name printed on top is
    // the term's — so a reader who asked for `partial` and got `maturity` is
    // told that is the entry their word belongs to, not left to wonder.
    const asked = subject.toLowerCase() === explanation.term ? "" : ` — the entry for '${subject}'`;
    console.log(`${explanation.term}${asked}\n\n${explanation.paragraph}`);
    return;
  }
  if (explanation.kind === "refusal") {
    console.log(`${subject} — a refusal code (error.code in the --json envelope, exit 1)\n\n${explanation.meaning}`);
    return;
  }
  // A finding: one block per table the code appears in, under the table's own
  // column names, so the page reads as the /loam-check row it is. The
  // severity note repeats on each scope block because it is a PER-TABLE fact:
  // `openapi.ref-unresolved` is a warn under `--service` and an error at
  // archive plan time, and a reader asking "does this block my archive?" must
  // not have to guess which note belongs to which context.
  console.log(findingHeadline(subject, explanation));
  for (const entry of explanation.entries) {
    console.log(`\n${scopeHeader(entry)}`);
    console.log(`  what it means: ${entry.meaning}`);
    if (entry.fix !== "") console.log(`  what to do: ${entry.fix}`);
  }
}

export function registerExplain(program: Command): void {
  program
    .command("explain")
    .argument(
      "[subject]",
      `a finding code (spine.op-undefined), a refusal code (docs-busy), or a concept term (${TERM_LIST}); omit to list the terms`,
    )
    .description("Explain a finding code, refusal code or concept term, version-matched to this binary")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--codes", "list every finding and refusal code this binary can explain")
    .action((subject: string | undefined, opts: ExplainOptions) => {
      const json = opts.json === true;
      if (opts.codes === true) {
        // Refused rather than quietly preferring one: `loam explain
        // spine.op-undefined --codes` asks two different questions, and a
        // caller who typed both wanted whichever one this run did NOT pick.
        if (subject !== undefined) {
          fail(
            json,
            "invalid-option",
            `--codes lists the whole vocabulary and takes no subject — drop '${subject}' for the inventory, or drop --codes to explain that one.`,
          );
          return;
        }
        printCodeListing(json);
        return;
      }
      if (subject === undefined) {
        printTermListing(json);
        return;
      }
      const explanation = explainSubject(subject);
      if (explanation === null) {
        // The same code `show` and `instructions` use for a name that resolves
        // to nothing, with `nearestIds` suggestions because the known set here
        // is ~200 strings — a caller one typo away should not have to diff the
        // whole vocabulary to find it.
        const near = nearestIds(subject, knownSubjects());
        fail(
          json,
          "unknown-target",
          `Nothing named '${subject}' — not a finding code, a refusal code, or a concept term.` +
            (near.length > 0 ? ` Close: ${near.join(", ")}.` : "") +
            " Run `loam explain` with no argument for the concept list; finding codes appear in `loam validate` and `loam verify` output.",
        );
        return;
      }
      if (json) {
        emitJson({
          command: "explain",
          version: LOAM_VERSION,
          subject,
          kind: explanation.kind,
          ...(explanation.kind === "finding"
            ? { entries: explanation.entries, ...(explanation.via === undefined ? {} : { via: explanation.via }) }
            : explanation.kind === "refusal"
              ? { meaning: explanation.meaning }
              : { term: explanation.term, paragraph: explanation.paragraph }),
        });
        return;
      }
      printText(subject, explanation);
    });
}
