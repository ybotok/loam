import type { Command } from "commander";
import { loadConfig } from "../core/config.js";

interface DeltaOptions {
  service?: string;
}

export function registerDelta(program: Command): void {
  program
    .command("delta")
    .argument("<featureId>", "feature id, e.g. FEAT-123")
    .description("Project a feature's C4 delta onto a service: what to build here + generated Gherkin")
    .option("--service <id>", "service to project onto (defaults to the configured service)")
    .action(async (featureId: string, opts: DeltaOptions) => {
      const config = await loadConfig();
      if (!config) {
        console.error("No loam.json found. Run `loam init --docs <dir>` first.");
        process.exitCode = 1;
        return;
      }
      const service = opts.service ?? config.service ?? "<service>";

      console.log(`delta ${featureId} — not yet implemented.`);
      console.log("Planned contract:");
      console.log(`  - read the feature's C4 delta from ${config.docsDir}/features/${featureId}/`);
      console.log(`  - filter it to service '${service}'`);
      console.log("  - print this service's slice: new/changed endpoints, events, dependencies");
      console.log("  - emit generated Gherkin stubs (one per new/changed delta edge)");
      console.log("  - this output doubles as the task for a coding agent");
    });
}
