/**
 * `architecture/` as ONE LikeC4 project — the docsDir-aware wrapper over the two
 * modules beside it — and the renderer's ROOT project's documents and views,
 * which are the evidence a link in that project is graded against
 * (`rootProjectDocuments`, `renderedViews`, `gradeLinks` below). Those live here
 * rather than beside the root `exclude` reader because they need the generated
 * documents' list this module owns, and `../root-project/` importing it back
 * would close a package cycle.
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
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { distinctErrors, type LoadedDoc } from "../likec4.js";
import { placedLinksDropped, type RenderedViews } from "../navigation/unplaced.js";
import { declaredViewsIn } from "../view-scan/declared.js";
import type { ProjectDocument } from "../splice/vocabulary/undeclared.js";
import { inOrder } from "../../kernel/concurrency.js";
import { excludingPath, readRootExclude } from "../root-project/exclude.js";
import { architectureDocuments, likec4DocumentsUnder } from "./documents.js";
import { asLoadedDoc, loadProject } from "./load.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { GENERATED_ARCHITECTURE_FILES, landscapePath, serviceViewsPath, subsystemViewsPath } from "../../repo/paths.js";
import { listFleetTree } from "../../repo/repo.js";
import { serviceViewsState, viewsState } from "../../repo/tree/render/stale.js";
import type { MapFacts } from "../../repo/tree/render/views.js";
import type { FleetTree } from "../../repo/tree/walk.js";

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
 * (`rootProjectDocuments` below). A views-only document
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
 * That project's documents OTHER than the landscape, as text, each named
 * docs-relative — what the archive proves an extending model beside, minus the
 * map the merge is computing. The landscape merge reads their specifications so
 * a kind or tag declared in, say, a palette document serves what it routes into
 * a model (`../splice/vocabulary/undeclared.ts`). A document that cannot be
 * read is left out rather than failing the merge: the model's own parse net
 * stages the same file and names it.
 */
export async function projectDocumentsBesideMap(docsDir: DocsDir): Promise<ProjectDocument[]> {
  const map = resolve(landscapePath(docsDir));
  const others = (await architectureProjectDocuments(docsDir)).filter((path) => resolve(path) !== map);
  const read = await inOrder(others, async (path): Promise<ProjectDocument | null> => {
    const text = await readFile(path, "utf8").catch(() => null);
    return text === null ? null : { path: relative(docsDir, path).split(/[\\/]/).join("/"), text };
  });
  return read.filter((doc): doc is ProjectDocument => doc !== null);
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
 *
 * Its LINKS are graded against `renderedViews`. The project is narrower than
 * the renderer's — no extending model, no generated view — so a `navigateTo`
 * naming a view one of those declares cannot resolve here, and it used to fail
 * the whole map (report 042: `landscape.invalid` and one
 * `spine.landscape-invalid` per service, while `likec4 validate` said Valid).
 * Graded, such a link is no fault and a link to a view declared nowhere the
 * renderer reads is still `landscape.invalid` (`../navigation/unplaced.ts`).
 */
export async function loadArchitecture(docsDir: DocsDir): Promise<LoadedDoc> {
  const documents = await architectureProjectDocuments(docsDir);
  return asLoadedDoc(await loadProject(architectureDir(docsDir), documents, () => renderedViews(docsDir)));
}

/**
 * The documents the RENDERER's root project loads, enumerated the way the
 * renderer enumerates them: everything under the docs root that the root
 * `likec4.config.json` does not exclude.
 *
 * It exists because `commands/validate/fleet/views/fleet-project.ts` used to
 * build the set BY SHAPE — the `architecture/` project, each extending
 * `model.likec4`, and every `.likec4` inside a service directory — and that is
 * three roots, not a tree. A `.likec4` one directory ABOVE a service
 * (`services/platform/notes.likec4`, the parent of service directories) was in
 * none of them: `loam validate --all` came back byte-identical to baseline and
 * never named the file, while `npx likec4 validate --project fleet .` reported
 * Invalid over nine files and thirteen errors (verification 2026-09-04, R2). The
 * same file one directory lower was a loud error. SCHEMA, `loam-codes` and
 * `explain` all said loam loads "every `.likec4` the root project reads"; this
 * is that sentence, executed. It moved here from beside that check when the
 * map's own grade needed the same walk (`renderedViews` below) — `core/` may
 * not import from `commands/`.
 *
 * FOUR THINGS COME OUT, and each is a rule rather than a filter of convenience:
 *
 *  - Every GENERATED `architecture/` document — `subsystems.likec4` and
 *    `services.likec4`, taken from the ONE list every project read shares
 *    (`generatedArchitectureDocuments` above) — for `./documents.ts`'s reason:
 *    docs/DESIGN.md rule 26 makes their staleness a byte compare, and a stale
 *    one naming a removed element would blank this load and report a cascade
 *    whose repair is `loam subsystem sync`. The renderer DOES load them, which
 *    is why `renderedViews` reads them back in: a view id they declare is one
 *    a link can land on.
 *  - Anything the root `exclude` covers, read through `../root-project/exclude.ts`
 *    — the renderer does not load it, so grading it would be loam reporting a
 *    failure nobody can see. A root config loam cannot read an `exclude` list out
 *    of covers nothing: guessing an exclusion is worse than loading one document
 *    too many.
 *  - Every STANDALONE service directory. Such a model declares its own kinds, so
 *    the root project must exclude it and `service.model-unexcluded` is the grade
 *    for a root that does not — one finding naming the entry to add, rather than
 *    a duplicate-kind cascade under a second code.
 *  - `features/`. A feature's `delta.likec4` carries a `specification` block of
 *    its own and the directory is transient — the scaffolded root config excludes
 *    it for exactly that reason, and a fleet mid-feature would otherwise read as
 *    a fleet whose map is declared twice. loam drops it whether or not the entry
 *    is still there; `loam validate --feature` is where a delta is graded.
 *
 * Dot-directories and `node_modules` are not walked at all. Those are loam's own
 * machinery and a package tree, never authored documents — the same thing the
 * scaffold's own `node_modules` glob says. `.loam-before` is the case that
 * proved it: a snapshot written before layout version 4 holds a verbatim copy
 * of the landscape under its living name, which would read as the map declared
 * twice. Version 4 suffixes every pre-image so the RENDERER cannot take one for
 * a document either (`core/staging/snapshot/manifest.ts`), but the older
 * snapshots are read forever and never migrated, so this walk keeps the rule.
 *
 * Absolute and sorted. `standalone` is each standalone service's directory, absolute.
 */
export async function rootProjectDocuments(docsDir: DocsDir, standalone: readonly string[]): Promise<string[]> {
  const generated = new Set(generatedArchitectureDocuments(docsDir).map((path) => resolve(path)));
  return (await rendererDocuments(docsDir, standalone)).filter((path) => !generated.has(resolve(path)));
}

/** The directory name loam never walks, beside every dot-directory. */
const PACKAGES = "node_modules";

/** The one subtree loam drops whatever the root config says — see `rootProjectDocuments`. */
const FEATURES = "features";

/** `rootProjectDocuments` with the generated documents still in — the renderer's own set. */
async function rendererDocuments(docsDir: DocsDir, standalone: readonly string[]): Promise<string[]> {
  const exclude = await readRootExclude(docsDir);
  const excluded = standalone.map((dir) => `${resolve(dir)}${sep}`);
  const root = resolve(docsDir);
  const keeps = (path: string): boolean => {
    if (excluded.some((dir) => resolve(path).startsWith(dir))) return false;
    const rel = relative(root, path).split(/[\\/]/);
    if (rel[0] === FEATURES) return false;
    return exclude === null || excludingPath(exclude, rel.join("/")) === null;
  };
  // An unreadable directory contributes nothing — `likec4DocumentsUnder`
  // records why a grade inside `validate --all` may never fail the run.
  return likec4DocumentsUnder(root, {
    enters: (name) => !name.startsWith(".") && name !== PACKAGES,
    keeps,
  });
}

/**
 * Every view the renderer's root project declares — the evidence a map's or an
 * extending model's `navigateTo` is graded against (`../navigation/unplaced.ts`),
 * read from the documents' text by `../view-scan/declared.ts`, which says why
 * text. The generated documents are IN, because the renderer loads them.
 *
 * Standalone service directories are not passed out: the renderer reads one the
 * root `exclude` does not cover, and `service.model-unexcluded` is that finding.
 */
export async function renderedViews(docsDir: DocsDir): Promise<RenderedViews> {
  return declaredViewsIn(await rendererDocuments(docsDir, []));
}

/**
 * Every view a project rooted at `dir` declares — a STANDALONE service's own
 * project, which is its directory: the root project excludes it, and its model
 * links into its own documents and nowhere else.
 */
export async function projectViews(dir: string): Promise<RenderedViews> {
  return declaredViewsIn(await likec4DocumentsUnder(dir, {}));
}

/**
 * What a FEATURE's links will land on once it archives: the renderer's views,
 * and the views the feature's own documents bring with them (its use cases,
 * its service flows). A link from the delta into a view the archive does not
 * land stays an error at the feature gate — the archive would write it into
 * the living map, and the next `validate --all` would be red.
 */
export async function featureViews(docsDir: DocsDir, featureDir: string): Promise<RenderedViews> {
  const [rendered, own] = await Promise.all([renderedViews(docsDir), projectViews(featureDir)]);
  return new Map([...own, ...rendered]);
}

/**
 * A document load's set-aside links, graded: the ones naming a view `rendered`
 * declares stay dropped, and any other goes back among the errors — where it
 * was before links were set aside, and with `loadSource`'s rule that errors
 * mean no model. A document with nothing set aside comes back unchanged, and
 * `rendered` is never asked.
 *
 * For the readers that hold a document LOAD rather than a project — the
 * feature gate's delta, `doctor`'s map, a standalone model — and know which
 * project it renders in (`LoadedDoc.unplaced` says why the load cannot).
 */
export async function gradeLinks(doc: LoadedDoc, rendered: () => Promise<RenderedViews>): Promise<LoadedDoc> {
  if (doc.unplaced === undefined) return doc;
  const dangling = await placedLinksDropped(doc.unplaced, rendered);
  if (dangling.length === 0) return doc;
  return { errors: distinctErrors([...doc.errors, ...dangling]), elements: [], relationships: [] };
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
 * rule 5 forbids. `commands/archive/run.ts` carried its own copy of these lines
 * until the dry run needed the same compare against a predicted map
 * (`./staged.ts`, `staleViewsAfterMerge`); both now come through `staleAgainst`.
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
    return await staleAgainst(docsDir, doc, await listFleetTree(docsDir));
  } catch {
    return [];
  }
}

/**
 * The generated documents on disk that do not match what this tree and this
 * map would generate — the compare itself, for a map and a tree the caller
 * already holds: the living ones above, or the ones an archive would leave
 * (`./staged.ts`). BOTH files, because a map change moves the per-service
 * overviews in a way it does not move the subsystem views: one edge changes
 * one service's peer set, and one newly bound element adds a whole view.
 */
export async function staleAgainst(docsDir: DocsDir, map: MapFacts, tree: FleetTree): Promise<string[]> {
  const stale: string[] = [];
  if (!(await viewsState(subsystemViewsPath(docsDir), tree, map)).agrees) stale.push("architecture/subsystems.likec4");
  if (!(await serviceViewsState(serviceViewsPath(docsDir), tree, map)).agrees) stale.push("architecture/services.likec4");
  return stale.sort();
}
