/**
 * Scaffolding for the shared docs repo.
 *
 * There is deliberately no manifest. `init` used to write a `loam.docs.json`
 * listing the repo's services; nothing ever read it — `repo.ts` enumerates from
 * the filesystem, because files are the source of truth — and nothing ever
 * updated it, so it named an empty fleet forever. A second list of services is
 * exactly the drift `loam validate` now cross-checks the landscape for; the
 * cheapest way to keep it honest is not to have it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENTS_MD } from "./agent.js";

/** Top-level layout of the shared docs repo. */
const SUBDIRS = ["architecture", "services", "features"] as const;

export interface ScaffoldResult {
  root: string;
  created: string[];
}

/** Idempotently create the docs-repo skeleton. Existing files/dirs are left untouched. */
export async function scaffoldDocs(docsDir: string): Promise<ScaffoldResult> {
  const root = resolve(docsDir);
  const created: string[] = [];

  await mkdir(root, { recursive: true });

  for (const dir of SUBDIRS) {
    const p = join(root, dir);
    if (!existsSync(p)) {
      await mkdir(p, { recursive: true });
      created.push(p);
    }
  }

  // The process contract lives with the docs it describes, so an agent handed
  // only the docs repo still knows the cycle. Never overwritten — a team's own
  // house rules outrank the template.
  const agentsPath = join(root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    await writeFile(agentsPath, AGENTS_MD, "utf8");
    created.push(agentsPath);
  }

  return { root, created };
}
