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
import { LANDSCAPE_STUB } from "./scaffold/landscape.js";
import { README_FILENAME, README_MD } from "./scaffold/readme.js";
import { AGENTS_FILENAME, LIKEC4_PROJECT_FILENAME, LIKEC4_ROOT_PROJECT } from "./repo/paths.js";

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
 * The LikeC4 project file, and the one thing in the docs repo loam writes for a
 * tool other than itself.
 *
 * LikeC4's workspace loader merges EVERY `.likec4` file under a directory tree
 * into one model, and whether that is what loam wants depends on the document.
 * A feature's `features/<FEAT>/delta.likec4` is parsed in isolation and declares
 * its own `specification { … }` block, so merging it into the root would report
 * every declaration as a duplicate — measured on loam's own `examples/docs`:
 * `npx likec4 start` reported 16 errors, sixteen duplicate kinds and names,
 * while `loam validate --all` reported none. Both were right; only one of them
 * was reading the tree as a workspace. That directory is therefore excluded
 * here, permanently.
 *
 * `services/**` is NOT, and that is this file's one substantive change since the
 * axis that let a model EXTEND the fleet map. A model written that way declares
 * no kinds of its own and says what is inside an element the map already draws,
 * so the root project is the only place it parses — and excluding it renders the
 * service as a box with nothing inside. A model that STANDS ALONE still has to
 * be excluded, and `loam subsystem sync` is what adds `services/<tree>/**` for
 * each one and removes the entry again when a model migrates. A fresh repo's
 * models are extending, so the scaffold starts with no `services/` entry at all.
 *
 * `**\/node_modules/**` is repeated because naming `exclude` replaces LikeC4's
 * default rather than adding to it.
 *
 * OWNERSHIP, corrected. This file is still the team's — written once by
 * `loam init --create`, never regenerated, and a team that wants a different
 * project layout keeps it. But loam is no longer blind to it: it reads ONE
 * literal fact out of it (`core/c4/root-project/exclude.ts`, `readRootExclude`
 * — the `exclude` list and nothing else), because that list decides whether an
 * extending model is renderable at all, and it MAINTAINS the `services/` entries
 * in it through `loam subsystem sync`. Every other key, and every entry that is
 * not about `services/`, is left exactly as written. The filename and the root
 * project's name are spelled in `repo/paths.ts`, beside every other file loam
 * writes.
 */
export const LIKEC4_PROJECT_CONFIG = `${JSON.stringify(
  {
    name: LIKEC4_ROOT_PROJECT,
    title: "Fleet landscape",
    exclude: ["**/node_modules/**", "features/**"],
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
    // The one file addressed to a person, first because a forge renders it as
    // the landing page and a reader meets it before anything else here.
    [README_FILENAME, README_MD],
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
