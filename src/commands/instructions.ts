import type { Command } from "commander";
import {
  PROTOCOLS,
  REFERENCE_PAGES,
  SUPPORT_PAGES,
  WORKFLOWS,
  placeholderProblems,
  protocolFor,
} from "../core/agent/protocol.js";
import { emitJson, fail } from "../core/envelope/json.js";
import { LOAM_VERSION } from "../core/envelope/version.js";
import { printedPage } from "../core/explain/fix-tables.js";

interface InstructionsOptions {
  json?: boolean;
  /**
   * Three states, and the third is the point: `--fix-tables` makes it `true`,
   * `--no-fix-tables` `false`, and neither leaves it undefined — which is the
   * page's own default (`printedPage`). Commander gives a `--no-` option a
   * `true` default only when it is declared alone; declared after its positive
   * twin, it leaves the default unset, which is what lets a page whose default
   * is narrow tell "nobody asked" from "asked for the tables".
   */
  fixTables?: boolean;
}

/**
 * The workflow protocols and the reference pages, from the binary rather than
 * from a file somebody generated once.
 *
 * The pages are the newer half and the reason this command now has two lists.
 * They are the sections that left the scaffolded AGENTS.md — a file every
 * agents.md-aware host auto-loads on every session, which two hosts truncate
 * silently — and they are printed here instead. That trade only works if they
 * can be FOUND, so the bare menu names them; `core/agent/workflows/reference/
 * reference.ts` carries the rest of the argument.
 *
 * This is the only command in loam that reads nothing: no `loam.json`, no docs
 * repo, no service. That is deliberate and it is the point — an agent runs this
 * BEFORE the repository is wired, and a protocol that refused with `no-config`
 * would be unreachable exactly when it is most needed, which is the first
 * minute in an unfamiliar repository. `loam-adopt`'s own first step is to run
 * `loam init` when there is no config, and it cannot be the step that requires
 * one.
 */
export function registerInstructions(program: Command): void {
  program
    .command("instructions")
    // Still spelled `workflow`, not `page`: the positional is in every
    // generated command file loam has ever written (`loam instructions
    // loam-adopt $1`) and in `--help` output people have copied. Renaming it
    // buys a more accurate word in one usage line and costs nothing anywhere
    // the rename would be visible, so the accuracy goes in the menu text instead.
    .argument("[workflow]", "workflow or reference page (loam-adopt, loam-codes, …); omit to list them")
    .argument("[args...]", "values substituted for the protocol's $1, $2, … placeholders")
    .description("Print a workflow protocol or reference page, version-matched to this binary")
    .option("--json", "emit the machine contract instead of the human view")
    // The one protocol these are about is /loam-check, whose fix tables are
    // 134 KB of the 138 it prints — a third of a 100k-token window spent before
    // the first check has run — while `loam explain <code>` answers any one of
    // those rows in under 500 bytes. The narrowed page keeps every paragraph
    // that INTRODUCES a table, because that sentence is what says which scope a
    // code was graded in; only the rows go.
    //
    // /loam-check is printed narrow unless `--fix-tables` asks for the rows
    // (since 0.2.0-alpha.15; `printedPage` says why). `--no-fix-tables` came
    // first, as an opt-in that left every default page byte-identical, and it
    // stays: every pointer since 0.2.0-alpha.1 passes it, and on the other
    // pages it still narrows. Declared in this order on purpose — see
    // `InstructionsOptions.fixTables`.
    .option("--fix-tables", "print the per-code fix tables; loam-check omits them unless asked")
    .option(
      "--no-fix-tables",
      "drop the per-code fix tables; `loam explain <code>` answers any code a run reports",
    )
    // Every positional here is DATA — a feature id, a service id, a validate
    // target — and one of those targets is spelled `--all`. Without this,
    // commander reads a leading-dash argument as an option it does not have and
    // refuses the whole invocation, so `/loam-check --all` (the first form the
    // command file's own argument hint offers) got a usage error instead of the
    // protocol. `--json` still parses as the flag it is, because it is declared.
    .allowUnknownOption()
    .action((workflow: string | undefined, args: string[], opts: InstructionsOptions) => {
      const json = opts.json === true;

      if (workflow === undefined) {
        if (json) {
          // `support` and `references` are ADDITIVE beside the `workflows` key
          // a consumer already reads. Appending either kind to `workflows`
          // would have been the smaller diff and the wrong one: a caller
          // iterating that array to drive the cycle would start running
          // diagnostics or documentation as steps.
          emitJson({
            command: "instructions",
            version: LOAM_VERSION,
            workflows: WORKFLOWS,
            support: SUPPORT_PAGES,
            references: REFERENCE_PAGES,
          });
          return;
        }
        // One column width across all three lists, so the blocks line up as one
        // menu — they are separate KINDS, not separate tables.
        const width = Math.max(
          ...[...WORKFLOWS, ...SUPPORT_PAGES, ...REFERENCE_PAGES].map((w) => w.name.length),
        );
        console.log(`loam ${LOAM_VERSION} — workflows\n`);
        for (const w of WORKFLOWS) {
          console.log(`  ${w.name.padEnd(width)}  ${w.description}`);
        }
        console.log(`\nsupport — use when a run or agent integration behaves unexpectedly\n`);
        for (const s of SUPPORT_PAGES) {
          console.log(`  ${s.name.padEnd(width)}  ${s.description}`);
        }
        // Under their own heading, and never merged into the six above. A page
        // has no steps and is not part of the cycle; a flat list of ten would
        // read as a ten-step process, which is the one thing the cycle must not
        // be confused with. The sentence says what they are FOR, because a name
        // alone does not distinguish "reference" from "seventh step".
        console.log(`\nreference pages — printed whole, no arguments\n`);
        for (const r of REFERENCE_PAGES) {
          console.log(`  ${r.name.padEnd(width)}  ${r.description}`);
        }
        console.log(
          `\nloam instructions <workflow> [args...] prints one, placeholders filled in.` +
            `\nloam instructions loam-report prints the local incident-reporting protocol.` +
            `\nloam instructions <page> prints a reference page. The pages carry what AGENTS.md` +
            `\nleaves out; \`loam explain <code>\` answers a single code without opening one.`,
        );
        return;
      }

      // Before the substitution, not after: a rendered protocol is a page of
      // instructions an agent acts on, and a `$1` that cannot be a service id
      // makes every command on that page unrunnable. The refusal reaches the
      // caller in the same shape a mistyped workflow name does.
      const problems = placeholderProblems(workflow, args);
      if (problems !== null) {
        fail(
          json,
          "invalid-option",
          `${problems.join(" ")} Nothing was printed: every command in the ${workflow} protocol ` +
            "interpolates that value, so the page would name a target no loam command can accept.",
        );
        return;
      }

      const body = protocolFor(workflow, args);
      if (body === null) {
        // `unknown-target`, the same code `show` uses for a name that resolves
        // to nothing. The known set is small and closed, so it is listed rather
        // than described: a caller that mistyped a known name should not have
        // to run a second command to see the choices.
        fail(
          json,
          "unknown-target",
          `No workflow '${workflow}'. Known: ${Object.keys(PROTOCOLS).join(", ")}.`,
        );
        return;
      }

      // The narrowing composes with `--json` rather than forking the envelope:
      // the shorter page rides in the same `body` field, so no key is added or
      // renamed. `--json` is the larger of the two views (the whole table is
      // one JSON string), which is exactly why it needs this too.
      const page = printedPage(workflow, body, opts.fixTables);

      if (json) {
        // `body` is the substituted text, not the template: a consumer that
        // asked for `loam instructions loam-adopt payment-service --json` wants
        // the protocol it is about to follow, and re-implementing the
        // substitution on the other side is a second copy of the rule.
        emitJson({ command: "instructions", version: LOAM_VERSION, workflow, args, body: page });
        return;
      }
      // `console.log`, like every other command, rather than a raw stdout
      // write: the test harness captures the console and a direct write is
      // invisible to it — an untestable print is how a protocol nobody notices
      // went missing would ship. The body already ends in a newline, so the
      // one console.log adds is trimmed rather than doubled.
      console.log(page.replace(/\n+$/, ""));
    });
}
