#!/usr/bin/env node
import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerAdopt } from "./commands/adopt.js";
import { registerList } from "./commands/list.js";
import { registerNew } from "./commands/new.js";
import { registerShow } from "./commands/show.js";
import { registerDelta } from "./commands/delta.js";
import { registerArchive } from "./commands/archive.js";
import { registerValidate } from "./commands/validate.js";
import { registerVouch } from "./commands/vouch.js";

const program = new Command();

program
  .name("loam")
  .description("Architecture-first spec framework for microservice fleets")
  .version("0.0.0");

registerInit(program);
registerAdopt(program);
registerList(program);
registerNew(program);
registerShow(program);
registerDelta(program);
registerArchive(program);
registerValidate(program);
registerVouch(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
