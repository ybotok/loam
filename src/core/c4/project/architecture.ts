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
 * the project: the GENERATED documents' exclusion is a correctness rule (see
 * `./documents.ts`), not a preference, and a reader that forgot it would blank a
 * fleet's whole map over a stale generated file.
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
import { GENERATED_ARCHITECTURE_FILES, landscapePath, serviceViewsPath, subsystemViewsPath } from "../../repo/paths.js";
import { listFleetTree } from "../../repo/repo.js";
import { serviceViewsState, viewsState } from "../../repo/tree/render/stale.js";

/** `<docsDir>/architecture` — the LikeC4 project root, spelled once. */
export function architectureDir(docsDir: DocsDir): string {
  return join(docsDir, "architecture");
}

/**
 * Every document inside `architecture/` that LOAM GENERATES, absolute — the ONE
 * answer four project reads have to agree on, and the reason it is a SET rather
 * than the single path it used to be.
 *
 * There are two generated files now (`subsystems.likec4` and `services.likec4`,
 * both written by `loam subsystem sync`), and every one of these readers must
 * drop BOTH: this module's own project list, the merge-preview staging beside it
 * (`./staged.ts`), and the renderer's-eye load `c4.fleet-project-invalid` builds
 * (`commands/validate/fleet/views/root-documents.ts`). A views-only document
 * does not parse standalone — its `include` lines name elements the landscape
 * declares — so a reader that keeps one loads a document whose only fault may be
 * that `sync` has not run yet, and ONE parse error in a project blanks the model
 * for every document in it. A file listed by one reader and forgotten by another
 * fails silently in exactly that direction, which is why the NAMES live in one
 * table (`repo/paths.ts`'s `GENERATED_ARCHITECTURE_FILES`) and the join to a
 * docsDir lives here, once, rather than as one `…ViewsPath(docsDir)` call per
 * reader that somebody has to remember to extend.
 */
export function generatedArchitectureDocuments(docsDir: DocsDir): string[] {
  return Object.keys(GENERATED_ARCHITECTURE_FILES).map((name) => join(architectureDir(docsDir), name));
}

/**
 * Exactly the documents `loadArchitecture` puts in the fleet map's project, as
 * one named answer.
 *
 * It exists because a SECOND project now has to contain the same set: a service
 * model that extends the map is parsed beside it (`c4/service-model/`), and the
 * set it must be staged with is this one plus the model. Two spellings of "the
 * architecture project's documents" would be two chances to forget the
 * generated documents' exclusion — a correctness rule, not an optimisation
 * (`./documents.ts` says what it prevents) — and the reader that forgot it would
 * blank a service's whole model over a stale generated file it has nothing to do
 * with.
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
  const paths = await architectureDocuments(architectureDir(docsDir), generatedArchitectureDocuments(docsDir));
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

/**
 * Which generated documents would the next `validate --all` report
 * `subsystem.views-stale` on? Docs-relative paths, sorted, empty for none.
 *
 * Asked by the two writers that change the map without owning these files —
 * `archive` merges into it, `unarchive` puts the pre-archive map back — so
 * neither reports a repo as current when the very next `validate --all` will
 * call it stale. Here, beside the list of generated documents, because it is
 * the second caller that made it shared (docs/DESIGN.md rule 8), and an undo
 * importing it from the merge would be the second command-to-command import
 * rule 5 forbids. `commands/archive/run.ts` still carries its own copy of these
 * lines, and is the one caller left to point here.
 *
 * Asked through validate's OWN state functions (`repo/tree/render/stale.ts`,
 * the ones `commands/validate/fleet/views/stale.ts` grades with) rather than a
 * second compare, so the warning a writer prints and the error validate raises
 * can never disagree — including about the gate validate holds: a map that does
 * not parse is `landscape.invalid`'s business, and grading a generated file
 * against a map nobody can read would cascade a second complaint behind the
 * first. An unreadable map therefore answers "no claim", exactly as validate
 * does.
 *
 * Tolerant to the last byte: it is asked AFTER a commit that already
 * succeeded, so nothing here may turn a landed write into a non-zero exit — a
 * docs repo with no `services/` at all still archives a landscape-only feature.
 */
export async function staleGeneratedViews(docsDir: DocsDir): Promise<string[]> {
  try {
    const doc = await loadArchitecture(docsDir);
    if (doc.errors.length > 0) return [];
    const tree = await listFleetTree(docsDir);
    const stale: string[] = [];
    if (!(await viewsState(subsystemViewsPath(docsDir), tree, doc)).agrees) stale.push("architecture/subsystems.likec4");
    if (!(await serviceViewsState(serviceViewsPath(docsDir), tree, doc)).agrees) {
      stale.push("architecture/services.likec4");
    }
    return stale.sort();
  } catch {
    return [];
  }
}
