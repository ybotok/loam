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
 * and off by default precisely so the term listing and every per-code page
 * stay byte-for-byte what they were: this is an addition to the contract, not
 * a change to it, and the term listing's own footer is left alone for the same
 * reason.
 */
import type { Command } from "commander";
import { emitJson, fail } from "../../core/envelope/json.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import {
  explainSubject,
  firstSentence,
  knownSubjects,
  listCodes,
  listTerms,
  type CodeListing,
  type Explanation,
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

/** The listing printed when no subject is asked for — also where codes are said to come from. */
function printTermListing(json: boolean): void {
  const terms = listTerms();
  if (json) {
    emitJson({ command: "explain", version: LOAM_VERSION, terms: terms.map(({ term, summary }) => ({ term, description: summary })) });
    return;
  }
  console.log(`loam ${LOAM_VERSION} — the vocabulary\n`);
  const width = Math.max(...terms.map(({ term }) => term.length));
  for (const { term, summary } of terms) console.log(`  ${term.padEnd(width)}  ${summary}`);
  console.log(
    "\nFinding codes come from `loam validate` and `loam verify` output; refusal codes arrive as error.code" +
      "\nin any --json envelope. `loam explain <subject>` explains one.",
  );
}

/**
 * How much of a code's meaning the inventory shows before it stops.
 *
 * The term listing prints whole first sentences because there are six of them
 * and each is under 200 characters. The code listing prints 270-odd rows whose
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

function printText(subject: string, explanation: Explanation): void {
  if (explanation.kind === "term") {
    console.log(`${explanation.term}\n\n${explanation.paragraph}`);
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
  const severities = [...new Set(explanation.entries.map((entry) => entry.severityNote))];
  console.log(`${subject} (${severities.join("; ")})${explanation.via === undefined ? "" : ` — surfaced by \`${explanation.via}\``}`);
  for (const entry of explanation.entries) {
    console.log(`\n[${entry.scope}] (${entry.severityNote})`);
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
