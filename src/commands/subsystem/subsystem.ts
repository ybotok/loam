/**
 * `loam subsystem <verb>` — the command surface over the tree under
 * `services/`.
 *
 * ONE registration with the verbs dispatched inside the action, deliberately
 * NOT Commander subcommands: test/agents.test.ts counts the literal
 * command-registration calls across src/commands/ and asserts the count
 * equals `buildProgram()`'s command list, so nested subcommands would
 * register as one command while counting as many literals — the guard would
 * fail in a way that reads as unrelated. (That same scan is why this comment
 * never spells the registration call with its parenthesis.) The option
 * superset is declared here once; each verb reads its own.
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import { runSync } from "./sync.js";

export interface SubsystemOptions {
  into?: string;
  under?: string;
  title?: string;
  description?: string;
  owner?: string;
  json?: boolean;
}

const VERBS = ["sync"] as const;

export function registerSubsystem(program: Command): void {
  program
    .command("subsystem")
    .description("Manage the subsystem tree under services/ — the grouping no identity depends on")
    .argument("<verb>", VERBS.join(" | "))
    .argument("[names...]", "the subsystem or service names the verb applies to")
    .option("--into <name>", "move: the destination subsystem, or '.' for the services/ root (unfiled)")
    .option("--under <name>", "new: the parent subsystem (default: the services/ root)")
    .option("--title <text>", "new: the subsystem's human title, kept in subsystem.yaml")
    .option("--description <text>", "new: what the group is, kept in subsystem.yaml")
    .option("--owner <name>", "new: who answers for the group, kept in subsystem.yaml")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (verb: string, names: string[], opts: SubsystemOptions) => {
      const json = opts.json === true;
      if (!(VERBS as readonly string[]).includes(verb)) {
        // The same code `list` gives a bad section: one mistake class, one code.
        fail(json, "invalid-option", `Unknown verb '${verb}'. Expected: ${VERBS.join(" | ")}.`);
        return;
      }
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const { docsDir } = loaded.config;
      // "services": every verb reads or rewrites the tree that IS the fleet,
      // so a docsDir with no services/ is a refusal, never an empty answer.
      if (!docsRepoReady(json, docsDir, "services")) return;
      void names;
      try {
        await runSync(docsDir, json);
      } catch (err) {
        if (!(err instanceof DocsRepoUnavailableError)) throw err;
        reportDocsRepoError(json, err);
      }
    });
}
