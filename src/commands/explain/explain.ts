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
 */
import type { Command } from "commander";
import { emitJson, fail } from "../../core/envelope/json.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import { explainSubject, knownSubjects, listTerms, type Explanation } from "../../core/explain/lookup.js";
import { nearestIds } from "../../core/repo/entries.js";

interface ExplainOptions {
  json?: boolean;
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
    .action((subject: string | undefined, opts: ExplainOptions) => {
      const json = opts.json === true;
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
