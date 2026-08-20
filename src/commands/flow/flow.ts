/**
 * `loam flow <verb>` — the command surface over the cross-service journeys
 * authored under `architecture/flows/`.
 *
 * ONE registration with the verbs dispatched inside the action, deliberately
 * NOT Commander subcommands, for `../subsystem/subsystem.ts`'s reason:
 * test/agents.test.ts counts the literal command-registration calls across
 * src/commands/ and asserts the count equals `buildProgram()`'s command list,
 * so nested subcommands would register as one command while counting as many
 * literals — the guard would fail in a way that reads as unrelated. (That same
 * scan is why this comment never spells the registration call with its
 * parenthesis.)
 *
 * Two verbs, and they are the two halves of the same fact. `sync` writes the
 * generated `architecture/flow-groups.likec4` — one view per group, members the
 * union of that group's flows' participants — for the LikeC4 renderer. `env`
 * answers the same union to a MACHINE, resolved to `services/<id>` directories:
 * which services must be up for a suite's flows to run.
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import { runEnv } from "./env.js";
import { runSync } from "./sync.js";

export interface FlowOptions {
  json?: boolean;
}

const VERBS = ["env", "sync"] as const;
type Verb = (typeof VERBS)[number];

/** How many names each verb takes, spelled once so the refusals agree with the dispatch. */
const NAMES: Record<Verb, { min: number; max: number; usage: string }> = {
  env: { min: 0, max: 1, usage: "flow env [group]" },
  sync: { min: 0, max: 0, usage: "flow sync" },
};

export function registerFlow(program: Command): void {
  program
    .command("flow")
    .description("Cross-service journeys: the suites their tags declare, and the environment each suite needs")
    .argument("<verb>", VERBS.join(" | "))
    .argument("[names...]", "env: the group tag to answer for (default: every group)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (verb: string, names: string[], opts: FlowOptions) => {
      const json = opts.json === true;
      if (!(VERBS as readonly string[]).includes(verb)) {
        // The same code `subsystem` gives an unknown verb: one mistake class, one code.
        fail(json, "invalid-option", `Unknown verb '${verb}'. Expected: ${VERBS.join(" | ")}.`);
        return;
      }
      const arity = NAMES[verb as Verb];
      if (names.length < arity.min || names.length > arity.max) {
        fail(json, "invalid-option", `'${verb}' takes ${arity.max === 0 ? "no" : "at most one"} name: ${arity.usage}`);
        return;
      }
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const { docsDir } = loaded.config;
      // "services": both verbs resolve a journey's participants against the
      // tree that IS the fleet, so a docsDir with no services/ is a refusal,
      // never an environment nobody has to stand up.
      if (!docsRepoReady(json, docsDir, "services")) return;
      try {
        switch (verb as Verb) {
          case "env":
            return await runEnv(docsDir, names[0], json);
          case "sync":
            return await runSync(docsDir, json);
        }
      } catch (err) {
        if (!(err instanceof DocsRepoUnavailableError)) throw err;
        reportDocsRepoError(json, err);
      }
    });
}
