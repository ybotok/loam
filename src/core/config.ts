import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Local config, committed at the root of a service repo (or the docs repo itself). */
export const CONFIG_FILENAME = "loam.json";

export interface LoamConfig {
  /** Path to the single shared docs repo (the source of truth). Absolute or relative to the config file. */
  docsDir: string;
  /** Canonical id of the service in the current repo, if this is a service repo. */
  service?: string;
}

export function configPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILENAME);
}

export async function loadConfig(cwd: string = process.cwd()): Promise<LoamConfig | null> {
  const p = configPath(cwd);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw) as LoamConfig;
}

export async function saveConfig(config: LoamConfig, cwd: string = process.cwd()): Promise<string> {
  const p = configPath(cwd);
  await writeFile(p, JSON.stringify(config, null, 2) + "\n", "utf8");
  return p;
}
