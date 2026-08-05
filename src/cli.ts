#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerInit } from "./commands/init.js";
import { registerAdopt } from "./commands/adopt.js";
import { registerList } from "./commands/list.js";
import { registerNew } from "./commands/new.js";
import { registerShow } from "./commands/show.js";
import { registerStatus } from "./commands/status.js";
import { registerDelta } from "./commands/delta.js";
import { registerGherkin } from "./commands/gherkin.js";
import { registerRebase } from "./commands/rebase.js";
import { registerArchive } from "./commands/archive.js";
import { registerUnarchive } from "./commands/unarchive.js";
import { registerValidate } from "./commands/validate.js";
import { registerVerify } from "./commands/verify.js";
import { registerVouch } from "./commands/vouch.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerDependencies } from "./commands/dependencies.js";
import { registerMigrateOpenSpec } from "./commands/migrate-openspec.js";
import { emitJsonError } from "./core/json.js";
import { LOAM_VERSION } from "./core/version.js";

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
registerNew(program);
registerShow(program);
registerStatus(program);
registerDelta(program);
registerGherkin(program);
registerRebase(program);
registerArchive(program);
registerUnarchive(program);
registerValidate(program);
registerVerify(program);
registerVouch(program);
registerDoctor(program);
registerDependencies(program);
registerMigrateOpenSpec(program);

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
function jsonRequested(): boolean {
  if (parsedJson !== undefined) return parsedJson;
  const argv = process.argv.slice(2);
  const terminator = argv.indexOf("--");
  return (terminator === -1 ? argv : argv.slice(0, terminator)).includes("--json");
}

/** CommanderError codes whose output (already printed) is the point, not a failure to wrap. */
const PASS_THROUGH = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

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
