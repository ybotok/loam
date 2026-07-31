import type { Command } from "commander";
import { resolve } from "node:path";
import { loadConfig, saveConfig, type LoamConfig } from "../core/config.js";
import { scaffoldDocs } from "../core/docs.js";

interface InitOptions {
  docs: string;
  service?: string;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize loam: create/point at the shared docs repo and write local config")
    .option("--docs <dir>", "path to the shared docs repo (the source of truth)", ".loam-docs")
    .option("--service <id>", "canonical id of the service in this repo")
    .action(async (opts: InitOptions) => {
      const docsDir = resolve(opts.docs);
      const { created } = await scaffoldDocs(docsDir);

      const existing = await loadConfig();
      const config: LoamConfig = {
        ...existing,
        docsDir,
        ...(opts.service ? { service: opts.service } : {}),
      };
      const configFile = await saveConfig(config);

      console.log("loam initialized.");
      console.log(`  docs repo: ${docsDir}`);
      if (config.service) console.log(`  service:   ${config.service}`);
      console.log(`  config:    ${configFile}`);
      if (created.length > 0) {
        console.log("  scaffolded:");
        for (const c of created) console.log(`    + ${c}`);
      }
    });
}
