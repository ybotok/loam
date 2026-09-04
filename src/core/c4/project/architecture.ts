/**
 * `architecture/` as ONE LikeC4 project — the docsDir-aware wrapper over the two
 * modules beside it.
 *
 * It lived in `commands/validate/fleet/load.ts` until the use-case axis grew a
 * second reader. That was the right home while `validate --all` was the only
 * caller: the command layer is where a `DocsDir` becomes paths. It stopped being
 * the right home the moment `core/usecases/fleet.ts` needed the same load —
 * `core/` may not import from `commands/` (AGENTS.md), so the choice was a second
 * copy of the two-line composition or one copy one level down. A second copy is
 * the copy that drifts, and the thing that would drift is which documents are in
 * the project: the generated `architecture/subsystems.likec4` exclusion is a
 * correctness rule (see `./documents.ts`), not a preference, and a reader that
 * forgot it would blank a fleet's whole map over a stale generated file.
 *
 * So the wrapper moved here and `validate`'s own module kept the landscape
 * CONTAINMENT — `readLandscape` / `unreadableLandscape` — which is genuinely
 * command-layer business: it is about which validate target a failed read is
 * filed against.
 */
import { join, relative, resolve } from "node:path";
import type { LoadedDoc } from "../likec4.js";
import { excludingPath, readRootExclude } from "../root-project/exclude.js";
import { architectureDocuments } from "./documents.js";
import { asLoadedDoc, loadProject } from "./load.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { landscapePath, subsystemViewsPath } from "../../repo/paths.js";

/** `<docsDir>/architecture` — the LikeC4 project root, spelled once. */
export function architectureDir(docsDir: DocsDir): string {
  return join(docsDir, "architecture");
}

/**
 * Exactly the documents `loadArchitecture` puts in the fleet map's project, as
 * one named answer.
 *
 * It exists because a SECOND project now has to contain the same set: a service
 * model that extends the map is parsed beside it (`c4/service-model/`), and the
 * set it must be staged with is this one plus the model. Two spellings of "the
 * architecture project's documents" would be two chances to forget the
 * generated `subsystems.likec4` exclusion — a correctness rule, not an
 * optimisation (`./documents.ts` says what it prevents) — and the reader that
 * forgot it would blank a service's whole model over a stale generated file it
 * has nothing to do with.
 *
 * THE ROOT `exclude` IS HONOURED HERE, and that is the second correctness rule
 * this one list carries. A `.likec4` under `architecture/` that the root project
 * excludes is a document the RENDERER never loads, so a global style group
 * declared in one is a name the fleet project cannot resolve — and until this
 * filter existed the generated subsystem views referenced it anyway: `likec4
 * validate` Invalid on every run, `loam validate --all` at 0 errors, `doctor`
 * healthy and `sync` "current" (verification 2026-09-04, W5). A root config loam
 * cannot read an `exclude` list out of filters nothing: asserting an exclusion on
 * evidence loam does not have is worse than loading one document too many.
 *
 * THE MAP ITSELF IS THE FLOOR, and it is not a special case for tidiness. The
 * filter had none, so an entry covering `architecture/landscape.likec4` — an
 * `architecture/*.likec4` a team wrote for a palette, say — left this list
 * EMPTY, and an empty project parses with zero errors. Every reader then took
 * that for "the map declares nothing": `validate --all` reported
 * `landscape.service-unmodelled` naming the very file that models the service
 * and `c4.invalid` on every extending model, `subsystem sync` rewrote a good
 * generated file down to a title, and nothing in either run mentioned the
 * `exclude` entry that caused it (verification 2026-09-04, review C). Keeping
 * the landscape is the tolerant direction this same banner already chooses for
 * an unreadable config: loam grades one document the renderer may skip, rather
 * than asserting a fleet's whole architecture says nothing. The entry is NAMED
 * to its author one target over — `landscape.excluded`, in
 * `commands/validate/fleet/views/projects.ts`, which reads this same list
 * through this same matcher so the two can never disagree about which file the
 * renderer drops.
 */
export async function architectureProjectDocuments(docsDir: DocsDir): Promise<string[]> {
  const paths = await architectureDocuments(architectureDir(docsDir), [subsystemViewsPath(docsDir)]);
  const exclude = await readRootExclude(docsDir);
  if (exclude === null || exclude.length === 0) return paths;
  const map = resolve(landscapePath(docsDir));
  return paths.filter((path) => resolve(path) === map || excludingPath(exclude, relative(docsDir, path)) === null);
}

/**
 * The fleet map, read as the PROJECT it actually is.
 *
 * `architecture/landscape.likec4` plus every `architecture/usecases/*.likec4`,
 * merged the way the renderer merges them — because a use case declares views
 * over the landscape's elements and does not parse standalone (measured: five
 * errors). `architectureDocuments` owns which files are in and why the
 * generated one is not.
 *
 * A fleet with no use cases loads exactly the landscape and behaves as it
 * always did, which is what keeps this a widening rather than a change.
 */
export async function loadArchitecture(docsDir: DocsDir): Promise<LoadedDoc> {
  return asLoadedDoc(await loadProject(architectureDir(docsDir), await architectureProjectDocuments(docsDir)));
}
