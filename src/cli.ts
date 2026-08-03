#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerAdopt } from "./commands/adopt.js";
import { registerList } from "./commands/list.js";
import { registerNew } from "./commands/new.js";
import { registerShow } from "./commands/show.js";
import { registerDelta } from "./commands/delta.js";
import { registerArchive } from "./commands/archive.js";
import { registerUnarchive } from "./commands/unarchive.js";
import { registerValidate } from "./commands/validate.js";
import { registerVerify } from "./commands/verify.js";
import { registerVouch } from "./commands/vouch.js";

// One version string, owned by package.json. `../package.json` resolves from
// src/ in dev and from dist/ in the published layout alike.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("loam")
  .description("Architecture-first spec framework for microservice fleets")
  .version(version);

registerInit(program);
registerAdopt(program);
registerList(program);
registerNew(program);
registerShow(program);
registerDelta(program);
registerArchive(program);
registerUnarchive(program);
registerValidate(program);
registerVerify(program);
registerVouch(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // The envelope's one hard invariant is that stdout is JSON whenever --json
  // was asked for — an unexpected throw must not be the exception to it.
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ok: false, error: { code: "internal", message } }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
});
