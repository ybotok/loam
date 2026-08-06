import type { Command } from "commander";
import { PROTOCOLS, WORKFLOWS, protocolFor } from "../core/agent.js";
import { emitJson, fail } from "../core/json.js";
import { LOAM_VERSION } from "../core/version.js";

interface InstructionsOptions {
  json?: boolean;
}

/**
 * The workflow protocols, from the binary rather than from a file somebody
 * generated once.
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
    .argument("[workflow]", "workflow name (loam-adopt, loam-feature, …); omit to list them")
    .argument("[args...]", "values substituted for the protocol's $1, $2, … placeholders")
    .description("Print a workflow protocol, version-matched to this binary")
    .option("--json", "emit the machine contract instead of the human view")
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
          emitJson({ command: "instructions", version: LOAM_VERSION, workflows: WORKFLOWS });
          return;
        }
        console.log(`loam ${LOAM_VERSION} — workflows\n`);
        const width = Math.max(...WORKFLOWS.map((w) => w.name.length));
        for (const w of WORKFLOWS) {
          console.log(`  ${w.name.padEnd(width)}  ${w.description}`);
        }
        console.log(`\nloam instructions <workflow> [args...] prints one, placeholders filled in.`);
        return;
      }

      const body = protocolFor(workflow, args);
      if (body === null) {
        // `unknown-target`, the same code `show` uses for a name that resolves
        // to nothing. The known set is small and closed, so it is listed rather
        // than described: a caller that mistyped one of six names should not
        // have to run a second command to see them.
        fail(
          json,
          "unknown-target",
          `No workflow '${workflow}'. Known: ${Object.keys(PROTOCOLS).join(", ")}.`,
        );
        return;
      }

      if (json) {
        // `body` is the substituted text, not the template: a consumer that
        // asked for `loam instructions loam-adopt payment-service --json` wants
        // the protocol it is about to follow, and re-implementing the
        // substitution on the other side is a second copy of the rule.
        emitJson({ command: "instructions", version: LOAM_VERSION, workflow, args, body });
        return;
      }
      // `console.log`, like every other command, rather than a raw stdout
      // write: the test harness captures the console and a direct write is
      // invisible to it — an untestable print is how a protocol nobody notices
      // went missing would ship. The body already ends in a newline, so the
      // one console.log adds is trimmed rather than doubled.
      console.log(body.replace(/\n+$/, ""));
    });
}
