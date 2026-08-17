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
import { AGENTS_MD } from "./agent/agents-md.js";
import { AGENTS_FILENAME } from "./repo/paths.js";

/**
 * Top-level layout of the shared docs repo, and part of its identity rather
 * than a convenience: `services/` is what makes a directory a docs repo —
 * `init` will not join one without it, and every enumerating command refuses a
 * `docsDir` that has none. So it is laid down even when nothing is in it yet.
 */
export const DOCS_SUBDIRS = ["architecture", "services", "features"] as const;

/**
 * The scaffolded directories that start out empty, and the file that keeps each
 * of them in version control. See {@link GITKEEP}. Spelled as pairs so the
 * marker's name is written once — `listServices` and `listFeatures` enumerate
 * subdirectories only, so a file here is invisible to both.
 */
const EMPTY_SUBDIRS = [
  ["services", ".gitkeep"],
  ["features", ".gitkeep"],
] as const;

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
 * A `views` block IS scaffolded — reversing the decision this comment used to
 * record, which was: no views, because computing one is superlinear in edge
 * count and a scaffolded `include *` handed every repo a fleet-sized bill for
 * the first tool that renders. That cost was real and still is; what changed
 * is the shape of the block. A fleet map stops being readable at the third
 * service unless platform infrastructure is split out, and the split's
 * `exclude element.tag = #platform` is exactly the
 * pruning that keeps the fleet view's render affordable — the scaffold now
 * pays the old objection instead of ignoring it. loam itself still reads
 * elements and relationships and never a view. The platform view's predicate
 * is scaffolded because it is the line users mistype: the obvious spelling
 * draws boxes with no edges.
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
// The \`views\` block at the bottom is for LikeC4's own tooling — loam reads
// the model and never a view. Render with \`npx likec4 start\` from the docs
// repo root, which likec4.config.json scopes to this directory. (A service
// model or a feature delta renders from its OWN directory, e.g.
// \`npx likec4 start services/<id>\`: each declares its own \`specification\`
// block, so the renderer can only be given one of them at a time.) Keep views
// scoped, because computing one is superlinear in the number of edges — the
// \`fleet\` view below stays affordable precisely because it excludes the
// platform hubs.
//
// One shape is worth getting right before the fleet is drawn: a shared broker.
// Kafka as a single element becomes the node every service points at, and any
// view over it is a star nobody can read. Model the TOPIC instead — a \`topic\`
// nested inside the broker's element, edges pointing at \`kafka.<topic>\` — which
// splits one hub of degree sixty into a dozen small ones and is the truer model
// besides. Tag the KIND, not just the broker: LikeC4 does not inherit tags, so a
// topic under an \`#external\` broker is not external itself and \`validate\` asks
// for a services/ directory nobody owes.
//
//   specification {
//     element topic {
//       #external
//       style { shape queue }
//     }
//   }

specification {
  element person
  element softwareSystem
  element container
  element database

  // Ubiquitous infrastructure — logging Kafka, auth, service discovery — takes
  // one inbound edge per service, and by the third service the fleet view is a
  // hairball. Tag those elements #platform: the fleet view excludes them
  // without losing "who depends on the Identity Provider", which the platform
  // view answers.
  tag platform
}

model {
}

views {
  view fleet {
    include *
    exclude element.tag = #platform
  }
  // The obvious spelling — \`include element.tag = #platform\` — draws the
  // platform boxes with NO edges and no consumers. The predicate that works is
  // the relationship form below.
  view platform {
    include * -> element.tag = #platform
  }
}
`;

/**
 * The LikeC4 project file, and the one thing in the docs repo loam writes for a
 * tool other than itself.
 *
 * LikeC4's workspace loader merges EVERY `.likec4` file under a directory tree
 * into one model. loam's layout is the opposite by design: the landscape,
 * each `services/<id>/model.likec4` and each `features/<FEAT>/delta.likec4` is
 * parsed in isolation (`loadSource`, one file, one throwaway workspace), so
 * every one of them legitimately declares its own `specification { … }` block
 * and re-declares the elements it needs to talk about. Point the real renderer
 * at the repository root and those declarations collide: on loam's own
 * `examples/docs` — four files — `npx likec4 start` reported 16 errors, sixteen
 * duplicate kinds and names, while `loam validate --all` reported none. Both
 * were right; only one of them was reading the tree as a workspace.
 *
 * So the root is declared as one LikeC4 project holding the landscape, and the
 * two directories whose files are meant to be read alone are excluded from it.
 * That makes `npx likec4 start` in the docs repo — the command loam's own docs
 * have always recommended — render the fleet map instead of failing. A service
 * model or a feature delta is still rendered by pointing the renderer at its own
 * directory, which is what parsing them in isolation meant all along.
 *
 * `**\/node_modules/**` is repeated because naming `exclude` replaces LikeC4's
 * default rather than adding to it. loam reads none of this file: it is written
 * once, never re-read, and a team that wants a different project layout owns it
 * like every other scaffolded file.
 */
export const LIKEC4_PROJECT_FILENAME = "likec4.config.json";

export const LIKEC4_PROJECT_CONFIG = `${JSON.stringify(
  {
    name: "fleet",
    title: "Fleet landscape",
    exclude: ["**/node_modules/**", "services/**", "features/**"],
  },
  null,
  2,
)}\n`;

/**
 * The placeholder that makes an empty scaffolded directory survive a clone.
 *
 * git tracks files, not directories, so `services/` and `features/` — created
 * empty by `loam init --create` — were absent for everyone after the first push:
 * the person who ran init had a green repo, and the second person to clone it
 * got `doctor.services-missing`, a BLOCKER, on a repository nobody had touched.
 * A repo that cannot survive being cloned is not a shared docs repo.
 */
const GITKEEP = "";

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
    [AGENTS_FILENAME, AGENTS_MD],
    [join("architecture", "landscape.likec4"), `${preamble}${LANDSCAPE_STUB}`],
    ["loam.json", DOCS_SELF_CONFIG],
    [LIKEC4_PROJECT_FILENAME, LIKEC4_PROJECT_CONFIG],
    // The two directories git would otherwise drop on the way to the next
    // clone. `architecture/` needs none — the landscape above is in it.
    ...EMPTY_SUBDIRS.map(([dir, keep]) => [join(dir, keep), GITKEEP] as [string, string]),
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
