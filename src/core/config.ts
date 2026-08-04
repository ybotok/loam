import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveInside } from "./path-safety.js";

/** Local config, committed at the root of a service repo (or the docs repo itself). */
export const CONFIG_FILENAME = "loam.json";

export interface LoamConfig {
  /** Path to the single shared docs repo (the source of truth). Absolute or relative to the config file. */
  docsDir: string;
  /** Canonical id of the service in the current repo, if this is a service repo. */
  service?: string;
  /**
   * Where Gherkin lives in this service repo, relative to the repo root
   * (default "features" — the cucumber convention). `loam gherkin` writes only
   * inside `<gherkinDir>/loam/`; the rest of the directory stays the team's.
   * Left unresolved on purpose: commands resolve it against the repo they run
   * in, which is where the config file lives.
   */
  gherkinDir?: string;
}

export function configPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILENAME);
}

export async function loadConfig(cwd: string = process.cwd()): Promise<LoamConfig | null> {
  const p = configPath(cwd);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, "utf8");
  try {
    const parsed = JSON.parse(raw) as LoamConfig;
    if (typeof parsed.docsDir !== "string" || parsed.docsDir === "") {
      throw new Error(`"docsDir" must be a non-empty string`);
    }
    // Same discipline as docsDir: a malformed fact refuses the whole config
    // rather than being silently defaulted over — `5` or `""` here is a typo,
    // and defaulting would send generated files somewhere nobody chose.
    if (parsed.gherkinDir !== undefined && (typeof parsed.gherkinDir !== "string" || parsed.gherkinDir === "")) {
      throw new Error(`"gherkinDir" must be a non-empty string when present`);
    }
    if (parsed.gherkinDir !== undefined) {
      // Validate the owned output directory, not merely its spelling. This also
      // catches an otherwise-contained path whose existing parent is a symlink
      // out of the service repo.
      resolveInside(dirname(p), join(parsed.gherkinDir, "loam"), `"gherkinDir"`);
    }
    // Resolve here, against the file's own directory, so the doc comment on
    // `docsDir` is true no matter where a caller later resolves the path from.
    return { ...parsed, docsDir: resolve(dirname(p), parsed.docsDir) };
  } catch (err) {
    // An unreadable config must not crash the CLI with a stack trace: report it and
    // treat it as absent — commands fail with their normal hint, and `loam init`
    // (which spreads the old config) can rewrite a corrupt file instead of dying on it.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Invalid ${CONFIG_FILENAME} at ${p}: ${msg}`);
    return null;
  }
}

export async function saveConfig(config: LoamConfig, cwd: string = process.cwd()): Promise<string> {
  const p = configPath(cwd);
  await writeFile(p, JSON.stringify(config, null, 2) + "\n", "utf8");
  return p;
}
