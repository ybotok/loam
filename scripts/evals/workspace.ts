/**
 * One scratch workspace per run: a copy of `examples/docs`, the scenario's own
 * setup on top, and the agent surface of the ARM under test.
 *
 *  - `loam`: what `loam init` lays down for Claude Code — the generated command
 *    and skill files for the repo's profile — beside the docs repo's AGENTS.md.
 *  - `baseline`: AGENTS.md alone, in the directory the agent starts in. No
 *    skills, no commands, no MCP. The question the evals answer is what the
 *    rest of the surface buys over the one file every host reads.
 *
 * `loam` itself is on the agent's PATH through a shim in `<root>/bin`, running
 * THIS checkout — the built `dist/cli.js` when it is newer than every file under
 * `src/`, else the source through tsx — so a run grades the tree it was started
 * from, never a stale build and never whatever version npm would fetch.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_MD } from "../../src/core/agent/agents-md.js";
import { DELIVERIES, plannedCommandFiles, type AgentProfile } from "../../src/core/agent/scaffold.js";
import { type Workspace } from "./graders.js";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE = join(REPO, "examples", "docs");
export const FIXTURES = join(REPO, "scripts", "evals", "fixtures");

export type Arm = "loam" | "baseline";
export const ARMS: readonly Arm[] = ["loam", "baseline"];

/** What a scenario's setup is handed: where things are, and a way to run this loam. */
export interface Setup {
  root: string;
  docs: string;
  /** Run `loam <args>` in `cwd` through the shim; throws on a non-zero exit. */
  loam(cwd: string, ...args: string[]): string;
}

/** The newest modification time of any file under `dir`. */
function newestUnder(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    newest = Math.max(newest, stat.isDirectory() ? newestUnder(path) : stat.mtimeMs);
  }
  return newest;
}

/** A shim that runs this checkout's loam, so the agent's `loam` is the tree under test. */
function writeShim(bin: string): void {
  mkdirSync(bin, { recursive: true });
  const dist = join(REPO, "dist", "cli.js");
  const target = existsSync(dist) && statSync(dist).mtimeMs >= newestUnder(join(REPO, "src"))
    ? `exec "${process.execPath}" "${dist}" "$@"`
    : `exec "${join(REPO, "node_modules", ".bin", "tsx")}" "${join(REPO, "src", "cli.ts")}" "$@"`;
  writeFileSync(join(bin, "loam"), `#!/bin/sh\n${target}\n`, "utf8");
  chmodSync(join(bin, "loam"), 0o755);
}

/** The PATH a run's processes get: the shim first. */
export function pathWith(root: string): string {
  return `${join(root, "bin")}:${process.env["PATH"] ?? ""}`;
}

/**
 * Lay the workspace down, run the scenario's setup, and write the arm's agent
 * surface last — so nothing the setup's own `loam` calls do can disturb it.
 * Returns the workspace; `before` is filled by the caller once setup has run.
 */
export function makeWorkspace(
  arm: Arm,
  scenario: { cwd: (root: string) => string; profile: AgentProfile; setup: (s: Setup) => void },
): Omit<Workspace, "before"> {
  const root = mkdtempSync(join(tmpdir(), "loam-eval-"));
  const docs = join(root, "docs");
  cpSync(EXAMPLE, docs, { recursive: true });
  writeFileSync(join(docs, "AGENTS.md"), AGENTS_MD, "utf8");
  writeShim(join(root, "bin"));
  const loam = (cwd: string, ...args: string[]): string =>
    execFileSync(join(root, "bin", "loam"), args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: pathWith(root) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  scenario.setup({ root, docs, loam });
  const cwd = scenario.cwd(root);
  if (arm === "loam") {
    for (const file of plannedCommandFiles(cwd, ["claude"], DELIVERIES, { profile: scenario.profile, docsRepo: cwd === docs })) {
      mkdirSync(join(file.path, ".."), { recursive: true });
      writeFileSync(file.path, file.content, "utf8");
    }
  } else if (cwd !== docs) {
    // The one file every host reads, where the agent starts. A service repo
    // carries no AGENTS.md of its own (loam writes it in the docs repo only),
    // so the baseline is handed the docs repo's.
    writeFileSync(join(cwd, "AGENTS.md"), AGENTS_MD, "utf8");
  }
  return { root, cwd, docs };
}

/** A service repo beside the docs repo: the fixture's code, if any, and a loam.json binding it. */
export function serviceRepo(root: string, service: string, opts: { fixture?: string; gherkinDir?: string } = {}): string {
  const dir = join(root, service);
  if (opts.fixture !== undefined) cpSync(join(FIXTURES, opts.fixture), dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  const config = { docsDir: "../docs", service, ...(opts.gherkinDir === undefined ? {} : { gherkinDir: opts.gherkinDir }) };
  writeFileSync(join(dir, "loam.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dir;
}
