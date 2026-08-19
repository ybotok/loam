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
 * superset is declared here once; the arity table below refuses a flag on a
 * verb that does not read it, because a silently ignored `--into` is a move
 * that did not happen.
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import { runNew, runRm } from "./edit.js";
import { runMove, runRename } from "./move.js";
import { runHistory, runList } from "./query.js";
import { runSync } from "./sync.js";

export interface SubsystemOptions {
  into?: string;
  under?: string;
  title?: string;
  description?: string;
  owner?: string;
  json?: boolean;
}

const VERBS = ["new", "move", "rename", "rm", "list", "history", "sync"] as const;
type Verb = (typeof VERBS)[number];

/** How many names each verb takes, spelled once so the refusals agree with the dispatch. */
const NAMES: Record<Verb, { min: number; max: number; usage: string }> = {
  new: { min: 1, max: 1, usage: "subsystem new <name> [--under <sub>] [--title <text>] [--description <text>] [--owner <name>]" },
  move: { min: 1, max: Infinity, usage: "subsystem move <name>... --into <sub|.>" },
  rename: { min: 2, max: 2, usage: "subsystem rename <old> <new>" },
  rm: { min: 1, max: 1, usage: "subsystem rm <name>" },
  list: { min: 0, max: 0, usage: "subsystem list" },
  history: { min: 1, max: 1, usage: "subsystem history <name>" },
  sync: { min: 0, max: 0, usage: "subsystem sync" },
};

/** The flag/verb contradictions worth refusing: an ignored flag is a lie about what ran. */
function flagMisuse(verb: Verb, opts: SubsystemOptions): string | null {
  if (opts.into !== undefined && verb !== "move") return `--into belongs to 'move' (${NAMES.move.usage}).`;
  if (opts.into === undefined && verb === "move") return `'move' needs a destination: ${NAMES.move.usage} ('.' unfiles).`;
  for (const [flag, value] of [
    ["--under", opts.under],
    ["--title", opts.title],
    ["--description", opts.description],
    ["--owner", opts.owner],
  ] as const) {
    if (value !== undefined && verb !== "new") return `${flag} belongs to 'new' (${NAMES.new.usage}).`;
  }
  return null;
}

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
      const arity = NAMES[verb as Verb];
      if (names.length < arity.min || names.length > arity.max) {
        fail(json, "invalid-option", `'${verb}' takes ${arity.min === arity.max ? arity.min : `${arity.min}+`} name(s): ${arity.usage}`);
        return;
      }
      const misuse = flagMisuse(verb as Verb, opts);
      if (misuse !== null) {
        fail(json, "invalid-option", misuse);
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
      try {
        switch (verb as Verb) {
          case "new":
            return await runNew(docsDir, names[0]!, opts, json);
          case "move":
            return await runMove(docsDir, names, opts.into!, json);
          case "rename":
            return await runRename(docsDir, [names[0]!, names[1]!], json);
          case "rm":
            return await runRm(docsDir, names[0]!, json);
          case "list":
            return await runList(docsDir, json);
          case "history":
            return await runHistory(docsDir, names[0]!, json);
          case "sync":
            return await runSync(docsDir, json);
        }
      } catch (err) {
        if (!(err instanceof DocsRepoUnavailableError)) throw err;
        reportDocsRepoError(json, err);
      }
    });
}
