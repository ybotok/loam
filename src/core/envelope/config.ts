import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { resolveInside } from "../kernel/path-safety.js";
import { parseServiceId, type ServiceId } from "../kernel/ids/service.js";

/** Local config, committed at the root of a service repo (or the docs repo itself). */
export const CONFIG_FILENAME = "loam.json";

export interface LoamConfig {
  /** Path to the single shared docs repo (the source of truth). Absolute or relative to the config file. */
  docsDir: string;
  /**
   * Canonical id of the service in the current repo, if this is a service repo.
   *
   * Branded because `parseConfig` below is the one place that checks it, so
   * every command reading `config.service` is reading a name that has already
   * passed the grammar — which is why the config arm of
   * `opts.service ?? config.service` needs no second parse.
   */
  service?: ServiceId;
  /**
   * Where Gherkin lives in this service repo, relative to the repo root
   * (default "features" — the cucumber convention). `loam gherkin` writes only
   * inside `<gherkinDir>/loam/`; the rest of the directory stays the team's.
   * Left unresolved on purpose: commands resolve it against the repo they run
   * in, which is where the config file lives.
   */
  gherkinDir?: string;
  /**
   * The agent tools `loam init` has written command and skill files for in this
   * repo, by AGENT_TOOLS id.
   *
   * Recorded because the two ways a generated file can be absent look identical
   * on disk: the binary grew a command nobody has re-run `init` for, or nobody
   * ever selected that tool here. Only this list tells them apart, and `loam
   * doctor` needs the difference to know which absence is worth reporting.
   *
   * ACCUMULATED, never replaced — a later `init --tools cursor` does not
   * un-write the claude files an earlier run left on disk, so the record of
   * what this repo holds has to keep them too.
   *
   * Optional, and unvalidated against the registry on purpose: a config written
   * by an older binary has no list at all, and one written by a NEWER binary
   * may name a tool this one has never heard of. Neither may refuse to load.
   */
  agentTools?: string[];
  /**
   * The directory the config was actually FOUND in — the repo root, which is
   * not necessarily the cwd now that discovery walks upward. Everything a
   * command resolves against "this repo" (gherkinDir, relative `sources:`)
   * belongs here, not against process.cwd(): running `loam gherkin` from
   * `src/deep/` must write the same files as running it from the root.
   *
   * Derived, never stored: `saveConfig` strips it, so it can never be spelled
   * in loam.json and drift from where the file really is.
   */
  root?: string;
  /**
   * `docsDir` exactly as the file spells it, before resolution. Kept because
   * "relative" and "absolute" are not recoverable from the resolved path, and
   * the difference is the whole point: an absolute docsDir in a COMMITTED
   * config is a path that only exists on the machine that ran `loam init`.
   *
   * Derived, never stored — same contract as `root`.
   */
  docsDirAsWritten?: string;
}

/**
 * A loam.json that exists but cannot be believed. Carries the field at fault
 * (null when the whole document is), because "which field" is the difference
 * between a fix and a guess — and because both `loadConfig` and `loam doctor`
 * report the same sentence from it.
 */
export class ConfigError extends Error {
  constructor(
    readonly field: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The directories a config search may look in: `start`, then each ancestor, up
 * to AND INCLUDING the git root — or the filesystem root when there is no git
 * repo above.
 *
 * The git root is the stop because it is the boundary the user already thinks
 * in: a loam.json outside it belongs to some other checkout (or, worse, to a
 * home directory), and silently adopting it would point a service repo's
 * commands at a docs repo nobody in this repo ever chose.
 */
function searchDirs(start: string): string[] {
  const out: string[] = [];
  let current = resolve(start);
  const root = parsePath(current).root;
  for (;;) {
    out.push(current);
    // `.git` is a directory in a normal clone and a FILE in a worktree or
    // submodule — existsSync answers both without caring which.
    if (existsSync(join(current, ".git"))) return out;
    const parent = dirname(current);
    if (parent === current || current === root) return out;
    current = parent;
  }
}

/** Where a config written HERE goes — never a discovered one. `init` and `saveConfig` use this. */
export function localConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILENAME);
}

/**
 * The nearest loam.json at or above `cwd`, or null. Exported because `init` has
 * to be able to ask a different question from "is there one here": a config in
 * an ancestor already governs this directory, and a second one written below it
 * would quietly shadow the first for every command run from the subtree.
 */
export function findConfigPath(cwd: string = process.cwd()): string | null {
  for (const dir of searchDirs(cwd)) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The config that governs `cwd`: the discovered one, or — when there is none —
 * where it would have to be written. The fallback keeps this total, which is
 * what lets a caller distinguish "absent" from "present but unloadable" with a
 * single existsSync (see `reportNoConfig`).
 */
export function configPath(cwd: string = process.cwd()): string {
  return findConfigPath(cwd) ?? localConfigPath(cwd);
}

/**
 * THE config validator. One implementation, because two of them are two
 * opinions: `loam doctor` used to carry its own copy, and a config doctor
 * called healthy could still be one every other command refused to load.
 *
 * `configDir` is the directory the file lives in — every relative path in the
 * document is resolved against it, so the doc comments above stay true no
 * matter where the caller happens to be standing.
 */
export function parseConfig(raw: string, configDir: string): LoamConfig {
  const file = join(configDir, CONFIG_FILENAME);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(null, `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Checked before any field access: `JSON.parse("null")` and `JSON.parse("5")`
  // are valid JSON, and reaching for `.docsDir` on them is how a config typo
  // used to surface as a raw Node TypeError instead of a named field.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(null, `${file} must contain a JSON object.`);
  }
  const record = value as Record<string, unknown>;

  if (typeof record.docsDir !== "string" || record.docsDir === "") {
    throw new ConfigError("docsDir", `${file}: "docsDir" must be a non-empty string.`);
  }
  // Same discipline as docsDir: a malformed fact refuses the whole config
  // rather than being silently defaulted over — `5` or `""` here is a typo,
  // and defaulting would send generated files somewhere nobody chose.
  // `parseServiceId` rather than a bare check: the same call both refuses the
  // malformed value and produces the branded one below, so there is no window
  // in which a checked name is still typed as an unchecked string. It takes a
  // `string`, hence the shape guard first — the id grammar's own message is
  // about spelling, and `5` is not a spelling.
  let service: ServiceId | undefined;
  if (record.service !== undefined) {
    if (typeof record.service !== "string") {
      throw new ConfigError("service", `${file}: "service" must be a string.`);
    }
    const parsed = parseServiceId(record.service, '"service"');
    if (!parsed.ok) throw new ConfigError("service", `${file}: ${parsed.problem}`);
    service = parsed.id;
  }
  if (record.gherkinDir !== undefined
    && (typeof record.gherkinDir !== "string" || record.gherkinDir === "")) {
    throw new ConfigError("gherkinDir", `${file}: "gherkinDir" must be a non-empty string when present.`);
  }
  // Shape only. Which ids are legal is the registry's question, and asking it
  // here would make a config written by a newer binary — one that knows a tool
  // this one does not — unloadable for every command, not just for `init`.
  if (record.agentTools !== undefined
    && (!Array.isArray(record.agentTools)
      || record.agentTools.some((t) => typeof t !== "string" || t === ""))) {
    throw new ConfigError(
      "agentTools",
      `${file}: "agentTools" must be an array of non-empty strings when present.`,
    );
  }
  if (typeof record.gherkinDir === "string") {
    // Validate the owned output directory, not merely its spelling. This also
    // catches an otherwise-contained path whose existing parent is a symlink
    // out of the service repo.
    try {
      resolveInside(configDir, join(record.gherkinDir, "loam"), `"gherkinDir"`);
    } catch (err) {
      throw new ConfigError("gherkinDir", `${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    // Resolved here, against the file's own directory, so the doc comment on
    // `docsDir` is true no matter where a caller later resolves the path from.
    docsDir: resolve(configDir, record.docsDir),
    ...(service === undefined ? {} : { service }),
    ...(record.gherkinDir === undefined ? {} : { gherkinDir: record.gherkinDir as string }),
    ...(record.agentTools === undefined ? {} : { agentTools: record.agentTools as string[] }),
    root: resolve(configDir),
    docsDirAsWritten: record.docsDir,
  };
}

/**
 * Every way asking for the config can come out, as data. It used to be
 * `LoamConfig | null` with a `console.error` on the invalid arm — core's one
 * print outside the envelope adapter, and a null that collapsed "no config"
 * and "a config nobody can read" into one answer `reportNoConfig` then had to
 * re-derive from the filesystem (a TOCTOU: the file could change between the
 * load and the re-check). The union says which case it is, carries the parse
 * problem for the command layer to render, and prints nothing.
 */
export type ConfigLoad =
  | { kind: "loaded"; config: LoamConfig }
  | { kind: "absent" }
  | { kind: "invalid"; path: string; problem: string };

export async function loadConfig(cwd: string = process.cwd()): Promise<ConfigLoad> {
  const p = findConfigPath(cwd);
  if (p === null) return { kind: "absent" };
  try {
    // The read belongs INSIDE the try: `existsSync` only says the name is
    // taken, not that it names a file this process can read. A loam.json that
    // is a directory (EISDIR), one whose permissions refuse us (EACCES), or one
    // deleted between the search and the read (ENOENT) all fail here rather
    // than in `parseConfig` — and read outside, each of them escaped every
    // command as an `internal` crash carrying a bare errno. Caught here they
    // join the same "exists but cannot be believed" arm the parse failures take.
    return { kind: "loaded", config: parseConfig(await readFile(p, "utf8"), dirname(p)) };
  } catch (err) {
    return { kind: "invalid", path: p, problem: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Write the config for the repo rooted at `cwd`. The derived fields are dropped
 * on the way out: they are facts about where the file was found and how it was
 * spelled, and a stored copy could only ever disagree with the file itself.
 */
export async function saveConfig(config: LoamConfig, cwd: string = process.cwd()): Promise<string> {
  const p = localConfigPath(cwd);
  const { root: _root, docsDirAsWritten: _asWritten, ...stored } = config;
  await writeFile(p, JSON.stringify(stored, null, 2) + "\n", "utf8");
  return p;
}
