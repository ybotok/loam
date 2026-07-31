import type { Command } from "commander";
import { loadConfig } from "../core/config.js";

interface AdoptOptions {
  service?: string;
}

export function registerAdopt(program: Command): void {
  program
    .command("adopt")
    .description("Reverse-engineer this service's baseline (C4 + spec) from its code into the docs repo")
    .option("--service <id>", "canonical id for this service")
    .action(async (opts: AdoptOptions) => {
      const config = await loadConfig();
      if (!config) {
        console.error("No loam.json found. Run `loam init --docs <dir>` first.");
        process.exitCode = 1;
        return;
      }
      const service = opts.service ?? config.service ?? "<service>";

      console.log("adopt — not yet implemented.");
      console.log("Planned contract:");
      console.log("  - read this repo's code; an LLM produces a draft baseline under");
      console.log(`      ${config.docsDir}/services/${service}/`);
      console.log("        model.likec4 · spec.md · openapi.yaml · adrs/ · runbook.md · health.yaml");
      console.log("  - everything as status: draft; reconcile with existing hand docs (diff, do not overwrite)");
    });
}
