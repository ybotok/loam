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

/**
 * The fleet map, empty but valid.
 *
 * Nobody writes this file automatically — `adopt` deliberately does not touch
 * it, because who calls whom is a human judgement and a generated landscape
 * would be a guess presented as the map. But "nobody writes it" used to mean
 * "it is simply absent", and an absent landscape is the one artifact whose
 * absence silences the fleet-wide checks entirely: every cross-service breach
 * `validate` exists to find is invisible on a repo with no landscape.
 *
 * So the scaffold lays down the empty map instead: the four element kinds a
 * fleet actually uses are declared, the model is empty, and the comments say
 * what to add and why. The first `loam adopt` then has somewhere to be drawn.
 */
const LANDSCAPE_STUB = `// The fleet map: every service in services/ appears here, and every call
// between two of them is an edge. This file is written by hand — loam never
// guesses it, because "who calls whom" is the one fact no generator can read
// off a repository.
//
// After \`loam adopt <service>\`, add the service here:
//
//   paymentService = softwareSystem 'payment-service' {
//     description 'Owns payment authorization/capture'
//     metadata { service 'payment-service' }   // binds the box to services/<id>/
//   }
//
// and give each call the operationId it uses, so requirements, C4 and OpenAPI
// can be cross-checked:
//
//   checkoutWeb -> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }

specification {
  element person
  element softwareSystem
  element container
  element database
}

model {
}

views {
  view index {
    title 'Fleet landscape'
    include *
  }
}
`;

/**
 * The docs repo's own loam.json. It makes the docs repo self-describing: a
 * command run from inside it (or from any directory under it) finds this file
 * first and resolves the fleet to the repo it is standing in, instead of
 * walking out to whatever service repo happens to be above.
 *
 * `"."` and not an absolute path for the same reason every other docsDir is
 * stored as written: this file is committed and cloned to machines whose
 * directory layout nobody here can predict.
 */
const DOCS_SELF_CONFIG = `${JSON.stringify({ docsDir: "." }, null, 2)}\n`;

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

  // Never overwritten, all three of them — a team's own house rules, their own
  // map and their own config outrank the template. The order here IS the order
  // `init` probes for what it will skip; keep the two lists in step.
  for (const [rel, content] of scaffoldFiles()) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      await writeFile(path, content, "utf8");
      created.push(path);
    }
  }

  return { root, created };
}

/**
 * The files the scaffold lays down, in creation order. Exported as paths only
 * (via `plannedDocsFiles`) so `init` can report what it will skip without
 * duplicating the skeleton — the duplicate list is exactly the drift that made
 * `created + skipped` disagree with reality.
 */
function scaffoldFiles(): Array<[string, string]> {
  return [
    // The process contract lives with the docs it describes, so an agent handed
    // only the docs repo still knows the cycle.
    ["AGENTS.md", AGENTS_MD],
    [join("architecture", "landscape.likec4"), LANDSCAPE_STUB],
    ["loam.json", DOCS_SELF_CONFIG],
  ];
}

/** Everything `scaffoldDocs(docsDir)` would create, in the order it creates it. */
export function plannedDocsFiles(docsDir: string): string[] {
  const root = resolve(docsDir);
  return [
    ...SUBDIRS.map((d) => join(root, d)),
    ...scaffoldFiles().map(([rel]) => join(root, rel)),
  ];
}
