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
 * have always recommended — render the fleet map instead of failing. What the
 * exclusion cost went unstated for a release: every adopted service was then a
 * box on that map with nothing renderable inside it. A service model renders
 * from the SAME root once `loam subsystem sync` has written a project file of
 * its own beside it — `repo/tree/render/projects.ts` records the measurement
 * and the rule — and only a feature's `delta.likec4`, which is transient, is
 * still rendered by pointing the renderer at its own directory.
 *
 * `**\/node_modules/**` is repeated because naming `exclude` replaces LikeC4's
 * default rather than adding to it. loam reads none of this file: it is written
 * once, never re-read, and a team that wants a different project layout owns it
 * like every other scaffolded file. The filename and the root project's name
 * are spelled in `repo/paths.ts`, beside every other file loam writes.
 */
export const LIKEC4_PROJECT_CONFIG = `${JSON.stringify(
  {
    name: LIKEC4_ROOT_PROJECT,
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
