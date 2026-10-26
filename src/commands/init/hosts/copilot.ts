/**
 * `loam init --copilot-setup`: the environment Copilot's cloud agent works in.
 *
 * The cloud agent starts each task on a fresh runner holding this repository
 * and nothing else. The skills tell it to run `loam`, and loam.json points at a
 * docs repo beside this one — neither is there unless the repository's
 * `.github/workflows/copilot-setup-steps.yml` puts them there. So without this
 * file every loam skill fails at its first step in the one Copilot surface that
 * works unattended.
 *
 * OPT-IN, for the reason `--mcp` is: it is a workflow GitHub runs, and it asks
 * for a secret that can read another repository. Written once and never
 * rewritten (see ./write.ts); a team's edits to it are the point of having it.
 *
 * What it does not know is said in the file itself rather than here, because
 * the file is what a person reads: whether the agent's shell keeps the PATH the
 * job set up was not confirmed against a real run when this was written
 * (2026-10-27), and the secret has to be created by hand. GitHub's own rules
 * are stated too: the job must be named `copilot-setup-steps`, and only the
 * default branch's copy runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { LOAM_VERSION } from "../../../core/envelope/version.js";
import type { HostFile } from "./write.js";

/** The GitHub `owner/repo` a git config's `origin` remote names, or null. */
export function githubRepoOf(gitConfig: string): string | null {
  const url = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(gitConfig)?.[1];
  return url === undefined ? null : (/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null);
}

/** Where loam.json needs the docs repo, and which repository to clone there; null when the checkout brings it. */
interface DocsClone {
  dir: string;
  repo: string | null;
}

/**
 * The docs repo as the runner needs it. Inside this repository and not a
 * repository of its own, it arrives with the checkout. Anywhere else it is
 * cloned to the path loam.json spells, which is relative to this repository's
 * root — where every step of the job starts. The repository is read from the
 * docs repo's own `origin`, when it has one on GitHub; otherwise the file says
 * where to write it.
 */
function docsClone(cwd: string, docsDir: string, stored: string): DocsClone | null {
  const rel = relative(cwd, docsDir);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (rel === "" || (inside && !existsSync(join(docsDir, ".git")))) return null;
  let repo: string | null = null;
  try {
    repo = githubRepoOf(readFileSync(join(docsDir, ".git", "config"), "utf8"));
  } catch {
    // No readable git config (a worktree's `.git` is a file): the file says
    // where the repository name goes instead of guessing one.
  }
  return { dir: stored, repo };
}

/** The one file this flag writes. `stored` is loam.json's own spelling of `docsDir`. */
export function copilotSetupFile(cwd: string, docsDir: string, stored: string): HostFile {
  const path = join(cwd, ".github", "workflows", "copilot-setup-steps.yml");
  return { path, owned: [path], content: setupSteps(cwd, docsDir, stored), rerun: "loam init --copilot-setup", paste: null };
}

/** The workflow, exactly as it lands. */
function setupSteps(cwd: string, docsDir: string, stored: string): string {
  // The same question `mcpLaunch` asks: an installed devDependency is what
  // `npm ci` restores, and the agent then runs `npx loam`.
  const local = existsSync(join(cwd, "node_modules", ".bin", "loam"));
  const docs = docsClone(cwd, docsDir, stored);
  const install = local
    ? "      - name: Install loam (this repository's devDependency)\n        run: npm ci\n"
    : `      - name: Install loam\n        run: npm install --global @ybotok/loam@${LOAM_VERSION}\n`;
  const repo = docs?.repo ?? "OWNER/DOCS-REPO";
  // The token is an Agents secret, which reaches these steps as an environment
  // variable (README's "Cloud agents in a service repo"); the second command
  // takes it back out of the clone's config, so the agent never reads it there.
  const clone = docs === null
    ? ""
    : (docs.repo === null ? "      # Replace OWNER/DOCS-REPO with the docs repository.\n" : "")
      + "      - name: Check out the docs repo where loam.json points\n"
      + "        run: |\n"
      + `          git clone --depth 1 "https://x-access-token:\${LOAM_DOCS_READ_TOKEN}@github.com/${repo}.git" ${JSON.stringify(docs.dir)}\n`
      + `          git -C ${JSON.stringify(docs.dir)} remote set-url origin https://github.com/${repo}.git\n`;
  const doctor = `      - name: Check that loam answers here\n        run: ${local ? "npx loam" : "loam"} doctor\n`;
  return `# Copilot's cloud agent runs this job before it starts a task, so that what a
# loam skill needs is on the runner. Written by \`loam init --copilot-setup\`
# (loam v${LOAM_VERSION}); loam never rewrites it.
#
# Check on the first task; not confirmed against a real run when this was written:
#   - that the agent's shell keeps the PATH this job set up, so \`loam\` resolves;${docs === null ? "" : `
#   - the secret: LOAM_DOCS_READ_TOKEN has to be an Agents secret (Settings →
#     Secrets and variables → Agents) holding a token that can read the docs repo.`}
# GitHub runs only the default branch's copy, and only a job named
# copilot-setup-steps.
name: Copilot setup steps

on:
  workflow_dispatch:
  push:
    paths:
      - .github/workflows/copilot-setup-steps.yml
  pull_request:
    paths:
      - .github/workflows/copilot-setup-steps.yml

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
${install}${clone}${doctor}`;
}
