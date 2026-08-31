/**
 * `loam init --mcp`: the one MACHINE delivery `init` makes.
 *
 * Every other thing init writes is prose an agent reads — command files and
 * Agent Skills, twenty tools' worth of dialects, all of them pointers at
 * `loam instructions`. The MCP facade is the opposite: fourteen typed tools,
 * each declaring `readOnlyHint`, each result carrying the `--json` envelope as
 * `structuredContent`. It was also the only delivery that required a human to
 * hand-edit a JSON file before anything could reach it — the generated
 * AGENTS.md said no more than "configure the host to launch `loam mcp` in the
 * repository the tools should answer for", so a scaffolded repository reliably
 * got the prose deliveries and never the typed one.
 *
 * OPT-IN, and that is not timidity. `.mcp.json` at the repo root is a file a
 * host reads and then STARTS A PROCESS from, for everyone who checks the
 * repository out. Writing one by default would mean `loam init` silently
 * arranging for a binary to be launched on a teammate's machine, which is a
 * decision that belongs to whoever runs the command, not to us.
 *
 * ## Why only the repo-root `.mcp.json`
 *
 * loam knows twenty agent tools and several of them read MCP configuration
 * from a file of their own. None of the others is written here, and a future
 * reader who wants to add them should meet the argument first:
 *
 *   - `.github/.mcp.json` is already in the registry as a Copilot DETECTION
 *     marker (tools/registry.ts). Writing it would make the next `init` detect
 *     Copilot in a repository that has none, because we put the marker there —
 *     a scan reporting its own output back to itself.
 *   - `.cursor/mcp.json` and `.vscode/mcp.json` carry different schemas
 *     (`servers` rather than `mcpServers`, plus per-host keys), so a single set
 *     of bytes cannot serve all three, and one template per host is one more
 *     thing to keep true across releases of somebody else's product.
 *   - `.gemini/settings.json` is a GENERAL settings file. Its MCP block is one
 *     key among many, so loam could only land it by merging into a file the
 *     user owns — and merging into a file a human owns is the one thing every
 *     init delivery is built not to do.
 *
 * The repo-root `.mcp.json` is the form with none of those problems: it is a
 * dedicated file, it is nobody's detection marker, and it is read by the hosts
 * that matter without being owned by any of them.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stageWrites } from "../../core/staging/commit.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { planWrite } from "../../core/staging/writes.js";

export const MCP_CONFIG_FILENAME = ".mcp.json";

/** The one file this delivery writes, so init's `skipped` probe and the writer cannot disagree. */
export function mcpConfigPath(cwd: string): string {
  return join(cwd, MCP_CONFIG_FILENAME);
}

/** What a host is told to run: the `command`/`args` pair of the `loam` server entry. */
export interface McpLaunch {
  command: string;
  args: string[];
}

/**
 * How `loam` is launched HERE, decided from how it is installed here.
 *
 * A fixed `"command": "loam"` would be an unlaunchable entry in exactly the
 * repositories README tells people to make: the documented install is a
 * per-repo devDependency, which puts the binary in `node_modules/.bin/` and on
 * no PATH an MCP host inherits. So the local bin decides — `npx --no` when it
 * is there, the bare name when it is not.
 *
 * `--no` and not a bare `npx loam mcp`: without it npx will FETCH `loam` from
 * the registry when the local resolution misses, which turns a stale checkout
 * into a silent download of a package with a name loam does not own. With it,
 * a missing local binary is an error the host reports.
 *
 * The probe is the extensionless name on both platforms deliberately: npm's
 * shim writer lays down `loam`, `loam.cmd` and `loam.ps1` together on Windows,
 * the first of them for the POSIX shells that run there, so its presence is the
 * portable question "is loam installed into this project".
 */
export function mcpLaunch(cwd: string): McpLaunch {
  const localBin = join(cwd, "node_modules", ".bin", "loam");
  return existsSync(localBin)
    ? { command: "npx", args: ["--no", "loam", "mcp"] }
    : { command: "loam", args: ["mcp"] };
}

/** The whole file, exactly as it lands. */
export function mcpConfigContent(cwd: string): string {
  return `${JSON.stringify({ mcpServers: { loam: mcpLaunch(cwd) } }, null, 2)}\n`;
}

/**
 * The `"loam": { … }` entry alone, as lines — what init prints when the file
 * is already there so a person can paste the one key into their own
 * `mcpServers` object.
 *
 * Sliced out of the same object the file is made of rather than spelled a
 * second time: a snippet that drifts from the bytes is worse than no snippet,
 * because the reader has no way to tell which of the two is current.
 */
export function mcpServerSnippet(cwd: string): string[] {
  return JSON.stringify({ loam: mcpLaunch(cwd) }, null, 2)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.slice(2));
}

/**
 * What happened to `.mcp.json` on this run. `skipped` is the never-overwrite
 * contract every other init delivery follows, and for the same reason: loam
 * does not merge into a file a human owns, so an existing `.mcp.json` is
 * reported and left byte-for-byte alone — no parse, no key merge, no rewrite.
 */
export type McpWrite =
  | { kind: "created" }
  | { kind: "skipped" }
  | { kind: "failed"; code: "merge-failed" | "rollback-incomplete"; message: string };

/**
 * Write `.mcp.json`, or report why not.
 *
 * Through the journaled transaction every other loam writer uses, not a bare
 * `writeFile`: the write is an exclusive create (the existsSync above proves
 * the path is free), so two inits racing for the same repository serialise
 * into the same "already there, left alone" answer instead of one of them
 * silently burying the other's bytes. `root` is the repository being
 * scaffolded, which is where a killed run's `.loam-commit` belongs — the same
 * place `gherkin` journals its own writes into a service repo.
 */
export async function writeMcpConfig(cwd: string): Promise<McpWrite> {
  const path = mcpConfigPath(cwd);
  if (existsSync(path)) return { kind: "skipped" };

  const staged = await stageWrites([planWrite(path, mcpConfigContent(cwd))]);
  const committed = await commitStaged(
    { root: cwd, command: "init", rerun: "loam init --mcp", target: MCP_CONFIG_FILENAME },
    staged,
    "written",
  );
  if (committed.ok) return { kind: "created" };
  // A lost exclusive create is the never-overwrite contract firing one layer
  // down — somebody else's `.mcp.json` is there now, and "present, so skipped"
  // is the answer the probe above would have given a moment later. Nothing of
  // ours went in; there is no half-state to report.
  if (committed.raced) return { kind: "skipped" };
  return { kind: "failed", code: committed.code, message: committed.message };
}
