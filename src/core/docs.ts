import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENTS_MD } from "./agent.js";

/** Manifest at the root of the shared docs repo. */
export const DOCS_MANIFEST = "loam.docs.json";

export interface DocsManifest {
  version: string;
  /** Canonical service ids known to the docs repo. */
  services: string[];
}

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

  const manifestPath = join(root, DOCS_MANIFEST);
  if (!existsSync(manifestPath)) {
    const manifest: DocsManifest = { version: "0", services: [] };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    created.push(manifestPath);
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
