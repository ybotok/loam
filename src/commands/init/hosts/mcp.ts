/**
 * `loam init --mcp`: the one MACHINE delivery `init` makes.
 *
 * Every other thing init writes is prose an agent reads — command files and
 * Agent Skills, twenty tools' worth of dialects, all of them pointers at
 * `loam instructions`. The MCP facade is the opposite: a typed read surface,
 * four bounded authoring entries under `--author`, version-matched resources,
 * and every result carrying the `--json` envelope as `structuredContent`. It
 * was also the only delivery that required a human to hand-edit a JSON file
 * before anything could reach it — the generated
 * AGENTS.md said no more than "configure the host to launch `loam mcp` in the
 * repository the tools should answer for", so a scaffolded repository reliably
 * got the prose deliveries and never the typed one.
 *
 * OPT-IN, and that is not timidity. An MCP config is a file a host reads and
 * then STARTS A PROCESS from, for everyone who checks the repository out.
 * Writing one by default would mean `loam init` silently arranging for a
 * binary to be launched on a teammate's machine, which is a decision that
 * belongs to whoever runs the command, not to us.
 *
 * ## Which files
 *
 * The repo-root `.mcp.json`, always: Claude Code reads it, and so do Copilot's
 * CLI and VS Code's Copilot harness. It is a dedicated file and nobody's
 * detection marker. Beside it, one file per selected host that reads none of
 * it — each checked against that host's docs on 2026-10-27:
 *
 *   - Codex reads MCP servers from `.codex/config.toml`, `[mcp_servers.<name>]`,
 *     and only in a project the user has trusted.
 *   - OpenCode reads them from `opencode.json`, under `mcp`, as
 *     `{ "type": "local", "command": [...] }`; both of its release lines read
 *     that shape.
 *   - Copilot's cloud agent reads no file at all: its MCP servers live in the
 *     repository's settings. That one is printed for a person to paste.
 *
 * The Codex and OpenCode files are GENERAL config, which is what kept them out
 * of this delivery before: loam could only land an MCP block in one by merging
 * into a file the user owns, and that is the one thing every init delivery is
 * built not to do. It still never does. A host's file is CREATED when there is
 * none — then it holds nothing but loam's entry — and when there is one, init
 * leaves it byte-for-byte alone and prints the entry to paste. Each is written
 * only for a host the run selected, so none of them can become a detection
 * marker for a tool the repository does not use.
 *
 * Still not written, for the reasons that held before: `.cursor/mcp.json` and
 * `.vscode/mcp.json` carry another schema (`servers`, plus per-host keys), and
 * `.gemini/settings.json` is a settings file a team is likely to have already.
 * `.github/mcp.json` (no dot) is the Copilot CLI's own, and stays a detection
 * marker only: the CLI reads the root `.mcp.json` this writes anyway.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HostFile } from "./write.js";

export const MCP_CONFIG_FILENAME = ".mcp.json";

/** The one file this delivery always writes, so init's `skipped` probe and the writer cannot disagree. */
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
export function mcpLaunch(cwd: string, author = false): McpLaunch {
  const localBin = join(cwd, "node_modules", ".bin", "loam");
  const args = ["mcp", ...(author ? ["--author"] : [])];
  return existsSync(localBin)
    ? { command: "npx", args: ["--no", "loam", ...args] }
    : { command: "loam", args };
}

/** A JSON object's members as lines, its braces cut off — what a person pastes into their own object. */
const members = (value: Record<string, unknown>): string[] =>
  JSON.stringify(value, null, 2).split("\n").slice(1, -1).map((line) => line.slice(2));

/**
 * The `.mcp.json` entry. `type` is spelled although `stdio` is the default
 * everywhere: Copilot's CLI documents it, and an explicit type is what a
 * reader of the file, or a stricter host, does not have to guess.
 */
const stdioEntry = (launch: McpLaunch): Record<string, unknown> => ({ type: "stdio", ...launch });

/** The repo-root `.mcp.json`, exactly as it lands. */
export function mcpConfigContent(cwd: string, author = false): string {
  return `${JSON.stringify({ mcpServers: { loam: stdioEntry(mcpLaunch(cwd, author)) } }, null, 2)}\n`;
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
export function mcpServerSnippet(cwd: string, author = false): string[] {
  return members({ loam: stdioEntry(mcpLaunch(cwd, author)) });
}

/** A TOML basic string: the launch values are plain ASCII, where JSON's spelling is TOML's. */
const toml = (s: string): string => JSON.stringify(s);

function codexTable(launch: McpLaunch): string[] {
  return ["[mcp_servers.loam]", `command = ${toml(launch.command)}`, `args = [${launch.args.map(toml).join(", ")}]`];
}

/**
 * Every MCP config file this run writes, for the hosts it selected: the root
 * `.mcp.json` first, as it always was, then Codex's and OpenCode's.
 */
export function mcpHostFiles(cwd: string, tools: readonly string[], author: boolean): HostFile[] {
  const launch = mcpLaunch(cwd, author);
  const rerun = author ? "loam init --mcp-author" : "loam init --mcp";
  const files: HostFile[] = [{
    path: mcpConfigPath(cwd),
    owned: [mcpConfigPath(cwd)],
    content: mcpConfigContent(cwd, author),
    rerun,
    paste: { into: `its "mcpServers" object`, lines: mcpServerSnippet(cwd, author) },
  }];
  if (tools.includes("codex")) {
    const path = join(cwd, ".codex", "config.toml");
    files.push({
      path,
      owned: [path],
      content:
        "# loam's MCP server, written by `loam init --mcp`. Codex reads a project's\n"
        + "# .codex/config.toml only once the project is trusted.\n"
        + `${codexTable(launch).join("\n")}\n`,
      rerun,
      paste: { into: "it, as a table of its own", lines: codexTable(launch) },
    });
  }
  if (tools.includes("opencode")) {
    const path = join(cwd, "opencode.json");
    const entry = { loam: { type: "local", command: [launch.command, ...launch.args], enabled: true } };
    files.push({
      path,
      owned: [path, join(cwd, "opencode.jsonc")],
      content: `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: entry }, null, 2)}\n`,
      rerun,
      paste: { into: `its "mcp" object`, lines: members(entry) },
    });
  }
  return files;
}

/**
 * Copilot's cloud agent reads its MCP servers from the repository's settings
 * and from no file, so when Copilot is selected its JSON is printed every time.
 * `tools` is required there, and `["*"]` is right for loam: its server only
 * reads unless it was started with `--author`.
 */
export function copilotCloudNote(launch: McpLaunch): string[] {
  const cloud = { mcpServers: { loam: { type: "local", ...launch, tools: ["*"] } } };
  return [
    "  copilot:   the cloud agent reads no MCP file; paste this into the repository's",
    "             Settings → Copilot → Cloud agent → MCP configuration:",
    ...JSON.stringify(cloud, null, 2).split("\n").map((line) => `               ${line}`),
    "             loam has to be installed where the agent runs: `loam init --copilot-setup`.",
  ];
}
