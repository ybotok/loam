import type { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, saveConfig, type LoamConfig } from "../core/config.js";
import { emitJson, fail } from "../core/json.js";
import { scaffoldDocs } from "../core/docs.js";
import { AGENT_TOOLS, plannedCommandFiles, scaffoldAgentCommands } from "../core/agent.js";

interface InitOptions {
  docs: string;
  service?: string;
  /** commander's --no-commands: true unless the flag is passed. */
  commands: boolean;
  /** --tools: comma-separated AGENT_TOOLS ids, or "all". Absent = claude. */
  tools?: string;
  json?: boolean;
}

/**
 * Resolve --tools to registry ids, or null after reporting the refusal. The
 * default (claude) lives at the call site, not in commander, so an explicit
 * `--tools` is distinguishable from none — which is what lets the
 * `--no-commands` contradiction be refused instead of silently arbitrated.
 */
function resolveTools(raw: string, json: boolean): string[] | null {
  const supported = Object.keys(AGENT_TOOLS);
  if (raw === "all") return supported;
  const ids = [...new Set(raw.split(",").map((t) => t.trim()).filter((t) => t !== ""))];
  const unknown = ids.filter((t) => !(t in AGENT_TOOLS));
  if (ids.length === 0 || unknown.length > 0) {
    fail(
      json,
      "invalid-option",
      (ids.length === 0
        ? "--tools names no tool."
        : `--tools does not recognize: ${unknown.join(", ")}.`) +
        ` Supported: ${supported.join(", ")} — or "all".`,
    );
    return null;
  }
  return ids;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize loam: create/point at the shared docs repo and write local config")
    .option("--docs <dir>", "path to the shared docs repo (the source of truth)", ".loam-docs")
    .option("--service <id>", "canonical id of the service in this repo")
    .option(
      "--tools <ids>",
      `agent tools to write the slash commands for: comma-separated (${Object.keys(AGENT_TOOLS).join(", ")}) or "all"`,
    )
    .option("--no-commands", "skip the slash commands for this repo entirely")
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

      // --tools selects the command files to write; --no-commands says write
      // none. Together they contradict — refused, not arbitrated.
      if (opts.tools !== undefined && !opts.commands) {
        fail(
          json,
          "invalid-option",
          "--tools contradicts --no-commands: one selects command files, the other suppresses them.",
        );
        return;
      }
      const tools = opts.tools === undefined ? ["claude"] : resolveTools(opts.tools, json);
      if (tools === null) return;

      // `skipped` is the other half of the never-overwrite contract: the
      // scaffolds return only what they created, so what they left alone is
      // probed here, before they run — in the order they would create it, so
      // created + skipped is the same list on every repo. The docs candidates
      // mirror scaffoldDocs (its skeleton is not exported); the command files
      // come from plannedCommandFiles (the same list the scaffold writes from).
      const commandFiles = opts.commands ? plannedCommandFiles(process.cwd(), tools) : [];
      const candidates = [
        ...["architecture", "services", "features"].map((d) => join(docsDir, d)),
        join(docsDir, "AGENTS.md"),
        ...commandFiles.map((f) => f.path),
      ];
      const skipped = candidates.filter((p) => existsSync(p));

      const { created } = await scaffoldDocs(docsDir);
      if (opts.commands) created.push(...(await scaffoldAgentCommands(process.cwd(), tools)));

      const existing = await loadConfig();
      const config: LoamConfig = {
        ...existing,
        docsDir,
        ...(opts.service ? { service: opts.service } : {}),
      };
      const configFile = await saveConfig(config);

      if (json) {
        // `tools` names what the command files were generated FOR — empty
        // under --no-commands, when none were.
        emitJson({ docsDir, created, skipped, tools: opts.commands ? tools : [] });
        return;
      }

      console.log("loam initialized.");
      console.log(`  docs repo: ${docsDir}`);
      if (config.service) console.log(`  service:   ${config.service}`);
      console.log(`  config:    ${configFile}`);
      if (opts.commands) console.log(`  commands:  ${tools.join(", ")}`);
      if (created.length > 0) {
        console.log("  scaffolded:");
        for (const c of created) console.log(`    + ${c}`);
      }
    });
}
