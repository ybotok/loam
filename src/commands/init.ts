import type { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, saveConfig, type LoamConfig } from "../core/config.js";
import { emitJson, fail } from "../core/json.js";
import { scaffoldDocs } from "../core/docs.js";
import { scaffoldAgentCommands, SLASH_COMMANDS } from "../core/agent.js";

interface InitOptions {
  docs: string;
  service?: string;
  /** commander's --no-commands: true unless the flag is passed. */
  commands: boolean;
  json?: boolean;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize loam: create/point at the shared docs repo and write local config")
    .option("--docs <dir>", "path to the shared docs repo (the source of truth)", ".loam-docs")
    .option("--service <id>", "canonical id of the service in this repo")
    .option("--no-commands", "skip the .claude/commands/ slash commands for this repo")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: InitOptions) => {
      const json = opts.json === true;
      const docsDir = resolve(opts.docs);

      // The one predictable failure: --docs naming a file. Refused here so the
      // caller gets a clean envelope/message instead of mkdir's ENOTDIR throw.
      if (existsSync(docsDir) && !statSync(docsDir).isDirectory()) {
        fail(json, "invalid-option", `--docs points at a file, not a directory: ${docsDir}`);
        return;
      }

      // `skipped` is the other half of the never-overwrite contract: the
      // scaffolds return only what they created, so what they left alone is
      // probed here, before they run — in the order they would create it, so
      // created + skipped is the same list on every repo. The docs candidates
      // mirror scaffoldDocs (its skeleton is not exported); the command files
      // come from SLASH_COMMANDS (which is).
      const candidates = [
        ...["architecture", "services", "features"].map((d) => join(docsDir, d)),
        join(docsDir, "AGENTS.md"),
        ...(opts.commands
          ? Object.keys(SLASH_COMMANDS).map((n) =>
              join(process.cwd(), ".claude", "commands", `${n}.md`),
            )
          : []),
      ];
      const skipped = candidates.filter((p) => existsSync(p));

      const { created } = await scaffoldDocs(docsDir);
      if (opts.commands) created.push(...(await scaffoldAgentCommands(process.cwd())));

      const existing = await loadConfig();
      const config: LoamConfig = {
        ...existing,
        docsDir,
        ...(opts.service ? { service: opts.service } : {}),
      };
      const configFile = await saveConfig(config);

      if (json) {
        emitJson({ docsDir, created, skipped });
        return;
      }

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
