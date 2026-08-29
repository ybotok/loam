#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerInit } from "./commands/init/init.js";
import { registerAdopt } from "./commands/adopt/adopt.js";
import { registerList } from "./commands/list/list.js";
import { registerNew } from "./commands/new/new.js";
import { registerSeed } from "./commands/seed/seed.js";
import { registerShow } from "./commands/show/show.js";
import { registerStatus } from "./commands/status/status.js";
import { registerSubsystem } from "./commands/subsystem/subsystem.js";
import { registerDelta } from "./commands/delta/delta.js";
import { registerDiff } from "./commands/diff/diff.js";
import { registerGherkin } from "./commands/gherkin/gherkin.js";
import { registerRebase } from "./commands/rebase/rebase.js";
import { registerArchive } from "./commands/archive/archive.js";
import { registerUnarchive } from "./commands/unarchive/unarchive.js";
import { registerValidate } from "./commands/validate/validate.js";
import { registerVerify } from "./commands/verify/verify.js";
import { registerVouch } from "./commands/vouch/vouch.js";
import { registerGate } from "./commands/gate/gate.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerDependencies } from "./commands/dependencies.js";
import { registerSteps } from "./commands/steps/steps.js";
import { registerExplore } from "./commands/explore.js";
import { registerContext } from "./commands/context/context.js";
import { registerMcp } from "./commands/mcp/mcp.js";
import { registerOpen } from "./commands/open.js";
import { registerInstructions } from "./commands/instructions.js";
import { registerExplain } from "./commands/explain/explain.js";
import { registerMigrateOpenSpec } from "./commands/migrate-openspec/migrate-openspec.js";
import { emitJsonError } from "./core/envelope/json.js";
import { LOAM_VERSION } from "./core/envelope/version.js";

/**
 * The whole CLI surface, as a program nobody has parsed yet.
 *
 * Exported because loam PRINTS commands — every `loam …` in AGENTS.md, in the
 * generated command and skill bodies, in a `doctor` finding's `fix` and in a
 * `status` next[] step is an instruction somebody (usually an agent) will type
 * back. The only way to prove one of those parses is to hand it to the program
 * that would receive it; a second copy of the registrations in a test agrees
 * with itself and with nothing else, which is exactly how
 * `Run \`loam adopt <id>\`` shipped as the first instruction a bound service
 * repo received. `test/agent-commands-runnable.test.ts` is the consumer.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("loam")
    .description("Architecture-first spec framework for microservice fleets")
    .version(LOAM_VERSION);

  // Make commander throw a CommanderError instead of process.exit()ing, so a
  // usage error (mistyped flag, unknown command) can still honour the envelope
  // invariant in the catch below instead of dying with an empty stdout.
  program.exitOverride();

  registerInit(program);
  registerAdopt(program);
  registerList(program);
  registerExplore(program);
  registerContext(program);
  registerNew(program);
  registerSeed(program);
  registerShow(program);
  registerStatus(program);
  registerSubsystem(program);
  registerDelta(program);
  registerDiff(program);
  registerGherkin(program);
  registerRebase(program);
  registerArchive(program);
  registerUnarchive(program);
  registerValidate(program);
  registerVerify(program);
  registerVouch(program);
  registerGate(program);
  registerDoctor(program);
  registerDependencies(program);
  registerSteps(program);
  registerMcp(program);
  registerInstructions(program);
  registerExplain(program);
  registerOpen(program);
  registerMigrateOpenSpec(program);

  groupCommands(program);

  return program;
}

/**
 * Which heading each command sits under in `loam --help`.
 *
 * The order is the order of the work: wire the repo, read the fleet, adopt what
 * exists, change it, check it, ship it. It mirrors the six shipped workflow
 * protocols (`loam instructions`) rather than inventing a second taxonomy, so a
 * reader who has met one has met the other.
 *
 * Twenty-eight commands printed as one flat registration-ordered list tells a
 * new reader nothing about which four to run first. NOTHING IS HIDDEN — a
 * hidden command is a command an agent cannot discover, and every one of these
 * still parses, still appears, and still carries the same flags. This is
 * typography, not surface.
 */
const HELP_GROUPS: Record<string, string> = {
  init: "Set up", seed: "Set up", doctor: "Set up", open: "Set up", mcp: "Set up",
  list: "Read the fleet", status: "Read the fleet", show: "Read the fleet",
  explore: "Read the fleet", context: "Read the fleet", dependencies: "Read the fleet",
  explain: "Read the fleet", instructions: "Read the fleet", steps: "Read the fleet",
  adopt: "Adopt what exists", vouch: "Adopt what exists",
  new: "Change it", delta: "Change it", gherkin: "Change it", rebase: "Change it",
  subsystem: "Change it",
  validate: "Check it", diff: "Check it", verify: "Check it", gate: "Check it",
  archive: "Ship it", unarchive: "Ship it",
  "audit-openspec": "Migrate", "migrate-openspec": "Migrate",
};

/**
 * Apply {@link HELP_GROUPS}, and FAIL CLOSED on a command it does not name.
 *
 * The throw is the point. A twenty-ninth command added without a heading would
 * otherwise land silently in an "unclassified" bucket at the bottom of the
 * page, which is the drift this whole file's neighbours are written to prevent;
 * `test/help-groups.test.ts` catches it at gate time, and this catches it the
 * first time anybody runs the binary. Same discipline as
 * `test/codes-drift.test.ts` applies to codes.
 */
function groupCommands(program: Command): void {
  for (const command of program.commands) {
    const group = HELP_GROUPS[command.name()];
    if (group === undefined) {
      throw new Error(`cli: command '${command.name()}' has no HELP_GROUPS heading — add one in src/cli.ts`);
    }
    command.helpGroup(group);
  }
}

/** CommanderError codes whose output (already printed) is the point, not a failure to wrap. */
const PASS_THROUGH = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

function main(): void {
  const program = buildProgram();

  // Set once a command's action actually runs: every subcommand declares its own
  // `--json`, so past that point the parsed option is the authoritative answer.
  let parsedJson: boolean | undefined;
  program.hook("preAction", (_thisCommand, actionCommand) => {
    parsedJson = Boolean((actionCommand.optsWithGlobals() as { json?: boolean }).json);
  });

  /**
   * Did this invocation ask for --json? Prefers the parsed option once an action
   * has run; before that (commander usage errors abort mid-parse) falls back to
   * scanning raw argv. The scan is a heuristic and cannot be made exact: a token
   * spelled `--json` that was meant as an option VALUE (e.g. --title "--json")
   * is indistinguishable from the flag in raw argv. It gets the common cases
   * right: a `--json` token anywhere before a `--` terminator counts, and tokens
   * after `--` never do.
   */
  const jsonRequested = (): boolean => {
    if (parsedJson !== undefined) return parsedJson;
    const argv = process.argv.slice(2);
    const terminator = argv.indexOf("--");
    return (terminator === -1 ? argv : argv.slice(0, terminator)).includes("--json");
  };

  program.parseAsync(process.argv).catch((err: unknown) => {
    if (err instanceof CommanderError) {
      // Help/version output was already written by commander — pass it through
      // untouched with the exit code it always had.
      //
      // Anything else is a usage error (unknown option/command, missing or
      // invalid argument). Commander has already printed its diagnostic to
      // stderr, and that line stays: the invariant below is about stdout only.
      if (!PASS_THROUGH.has(err.code) && jsonRequested()) {
        emitJsonError("invalid-option", err.message.replace(/^error: /, ""));
      }
      process.exitCode = err.exitCode;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    // The envelope's one hard invariant is that stdout is JSON whenever --json
    // was asked for — an unexpected throw must not be the exception to it.
    if (jsonRequested()) {
      emitJsonError("internal", message);
    } else {
      console.error(message);
      process.exitCode = 1;
    }
  });
}

/**
 * Was this file run, or merely imported? Realpath on both sides because the
 * installed entry point is reached through a symlink (`node_modules/.bin/loam`)
 * on every platform that has them, and a string compare against the link would
 * make the binary a no-op. A failure to resolve reads as "not the entry" only
 * for the import side; `process.argv[1]` that cannot be realpath'd is not a
 * loam invocation either.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
