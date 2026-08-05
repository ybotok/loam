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

/**
 * Top-level layout of the shared docs repo, and part of its identity rather
 * than a convenience: `services/` is what makes a directory a docs repo —
 * `init` will not join one without it, and every enumerating command refuses a
 * `docsDir` that has none. So it is laid down even when nothing is in it yet.
 */
export const DOCS_SUBDIRS = ["architecture", "services", "features"] as const;

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
 *
 * No `views` block, deliberately. loam reads elements and relationships and
 * never a view, so the scaffolded `view index { include * }` was a diagram loam
 * planted on every repo and then never drew — and views are the expensive half
 * of LikeC4: computing them is superlinear in edge count (120 services / 300
 * calls does not finish in three minutes; parsing the same file takes 11 ms).
 * loam stopped computing views, so the block is free for loam itself now, but
 * scaffolding one still hands the user a fleet-sized bill for the first tool
 * that does compute it. Teams who want diagrams declare their own.
 */
const LANDSCAPE_STUB = `// The fleet map: every service in services/ appears here, and every call
// between two of them is an edge. This file is written by hand — loam never
// guesses it, because "who calls whom" is the one fact no generator can read
// off a repository.
//
// After \`loam adopt --service <id>\`, add the service here:
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
//
// There is no \`views\` block, on purpose: loam reads the model and never a
// view, so it would draw nothing. Add views here if you want diagrams, and
// render them with LikeC4's own tooling (\`npx likec4 start\`) — but scope them,
// because computing a view is superlinear in the number of edges and an
// \`include *\` over a whole fleet takes minutes.

specification {
  element person
  element softwareSystem
  element container
  element database
}

model {
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

  for (const dir of DOCS_SUBDIRS) {
    const p = join(root, dir);
    if (!existsSync(p)) {
      await mkdir(p, { recursive: true });
      created.push(p);
    }
  }

  // Never overwritten, all three of them — a team's own house rules, their own
  // map and their own config outrank the template. The order here IS the order
  // `init` probes for what it will skip; keep the two lists in step.
  for (const [rel, content] of docsRepoFiles()) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      await writeFile(path, content, "utf8");
      created.push(path);
    }
  }

  return { root, created };
}

export interface DocsRepoFileOptions {
  /**
   * Comment lines prepended to the landscape stub, for a scaffold with a reason
   * of its own to hand over an empty map — `migrate-openspec` stages a docs repo
   * out of a corpus that HAS no topology, and says so where the migrator reads.
   *
   * A parameter and not a second template on purpose. The rest of the stub —
   * how to declare a service, how to bind an edge to an operationId, why there
   * is no `views` block — is the same advice however the repo came to exist, and
   * the migration used to carry its own shorter copy of it: two files that were
   * both correct on the day they were written and could only diverge after.
   */
  landscapePreamble?: string;
}

/**
 * The files every docs repo starts with, relative to its root, in creation
 * order. `init` scaffolds them directly; `migrate-openspec` stages the same
 * bytes into its target, because the whole point of migrating into a docs repo
 * is that it be the docs repo `loam init` makes.
 *
 * Exported as paths only (via `plannedDocsFiles`) where `init` reports what it
 * will skip — a duplicate list is exactly the drift that made `created +
 * skipped` disagree with reality.
 */
export function docsRepoFiles(opts: DocsRepoFileOptions = {}): Array<[string, string]> {
  const preamble = opts.landscapePreamble === undefined ? "" : `${opts.landscapePreamble.trimEnd()}\n//\n`;
  return [
    // The process contract lives with the docs it describes, so an agent handed
    // only the docs repo still knows the cycle.
    ["AGENTS.md", AGENTS_MD],
    [join("architecture", "landscape.likec4"), `${preamble}${LANDSCAPE_STUB}`],
    ["loam.json", DOCS_SELF_CONFIG],
  ];
}

/** Everything `scaffoldDocs(docsDir)` would create, in the order it creates it. */
export function plannedDocsFiles(docsDir: string): string[] {
  const root = resolve(docsDir);
  return [
    ...DOCS_SUBDIRS.map((d) => join(root, d)),
    ...docsRepoFiles().map(([rel]) => join(root, rel)),
  ];
}
