import type { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { loadFile } from "../core/likec4.js";

const MODEL_FILE = "model.likec4";

interface ValidateOptions {
  service?: string;
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .description("Validate a service's C4 model (LikeC4 parse + validation)")
    .option("--service <id>", "service to validate (defaults to the configured service)")
    .action(async (opts: ValidateOptions) => {
      const config = await loadConfig();
      if (!config) {
        console.error("No loam.json found. Run `loam init --docs <dir>` first.");
        process.exitCode = 1;
        return;
      }
      const service = opts.service ?? config.service;
      if (!service) {
        console.error("No service. Pass --service <id> or set it in loam.json.");
        process.exitCode = 1;
        return;
      }
      const modelPath = join(config.docsDir, "services", service, MODEL_FILE);
      if (!existsSync(modelPath)) {
        console.error(`No C4 model at ${modelPath}. Run \`loam adopt\` for '${service}' first.`);
        process.exitCode = 1;
        return;
      }

      const { errors, elements, relationships } = await loadFile(modelPath);
      if (errors.length > 0) {
        console.error(`✗ ${service}: C4 model has ${errors.length} error(s)`);
        for (const e of errors) {
          const loc = typeof e.line === "number" ? `:${e.line}` : "";
          console.error(`    ${MODEL_FILE}${loc}  ${e.message}`);
        }
        process.exitCode = 1;
        return;
      }
      console.log(`✓ ${service}: C4 model valid (${modelPath})`);
      console.log(`  ${elements.length} elements · ${relationships.length} relationships`);
    });
}
