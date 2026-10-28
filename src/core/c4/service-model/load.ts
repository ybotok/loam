/**
 * How a `model.likec4` is read — the entry point every reader of a service
 * model goes through, whichever shape the file has.
 *
 * One function rather than a branch at each call site, because the branch is
 * not local: a standalone model is a file, an extending model is a project, and
 * the six readers that open `model.likec4` (the service target, the isolation
 * scan, arch coverage, `loam show`, the adopt brief, the service's use cases)
 * all want the same thing out of either — the errors, the service's own
 * elements and relationships, and the views the file itself declares. Making
 * each of them ask "which shape is this?" is how five of them would come to
 * answer it differently.
 *
 * The FOUR arms below are the whole of the contract, and each exists because
 * one of them is a state a fleet is actually in:
 *
 *  - standalone: today's behaviour, byte for byte. The file is parsed alone.
 *  - the map does not parse: the model extends something unreadable, so it
 *    cannot be read at all. NOT an error against the model — the fleet already
 *    has `spine.landscape-invalid` for this, and a second finding here would
 *    blame every service for one broken document.
 *  - the project has errors: every one of them is this model's, including an
 *    error LikeC4 blames on the landscape. That is sound because the map was
 *    parsed alone first and came back clean — measured: a duplicate declaration
 *    is reported against BOTH files, so the map's copy of the error exists only
 *    because this model was added to the set.
 *  - clean: the model's own slice (`./slice.ts`), its own views, and the
 *    project's specification, in the shape a standalone model's `LoadedDoc`
 *    already had.
 *
 * Nothing here is memoised. `../prefetch/fleet.ts` is the request-scoped memo
 * over all of it — one instance per command invocation, owned by
 * `core/fleet-context.ts` — because a loader that caches is a loader a test
 * cannot ask twice.
 */
import { basename, relative, resolve } from "node:path";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { ServicePaths } from "../../repo/paths.js";
import type { Elem, LoadedDoc } from "../likec4.js";
import { asLoadedDoc, type ProjectDoc } from "../project/load.js";
import { gradeLinks, projectViews, renderedViews } from "../project/architecture.js";
import { loadProjectBatch, type ProjectRequest } from "../project/batch.js";
import type { RenderedViews } from "../navigation/unplaced.js";
import { modelProjectSets } from "./documents.js";
import { readInertModels, type ModelShape } from "./shape.js";
import { sliceForService } from "./slice.js";

export interface ServiceModel {
  shape: ModelShape;
  /**
   * Errors, the OWN elements and relationships, and the model file's own views
   * — what every model-dependent check reads, in the shape it read when a model
   * was always one self-contained file. For a standalone model it is exactly
   * what parsing that file returns.
   */
  doc: LoadedDoc;
  /**
   * Extending only: the whole per-service project, map and model together —
   * the scope a `Covers:` line and a use-case step resolve against, because
   * both may legitimately name an element the map declares. Null for a
   * standalone model, for a model that did not parse, and when the map itself
   * is unreadable.
   */
  project: LoadedDoc | null;
  /**
   * Extending only: the elements the model adds OUTSIDE the element that
   * resolves to it — `c4.element-unowned`, one finding each. Empty otherwise,
   * including for a standalone model, whose partner copies are a different
   * grade (`c4.declaration-diverged`) asking a different question.
   */
  unowned: Elem[];
  /**
   * The architecture project itself does not parse, so an extending model could
   * not be read at all. `doc` then carries no errors and no model, and the
   * finding is the fleet's `spine.landscape-invalid` rather than anything about
   * this service's file.
   */
  mapUnreadable: boolean;
}

export interface ServiceModelRequest {
  shape: ModelShape;
  /** The `services/<…>/<id>` directory name — what the model's elements must resolve to. */
  service: string;
  /**
   * The model's path RELATIVE TO THE DOCS ROOT, `/`-separated: the spelling
   * LikeC4 gives a view's `sourcePath` inside a project staged from that root,
   * and therefore the only spelling the views filter below can join on.
   */
  modelPath: string;
  /** Every service directory that exists, for the element→service resolver. */
  known: ReadonlySet<string>;
  /**
   * Parse the architecture documents WITHOUT this model — both the gate on
   * whether an extending model can be read and the diff's other half.
   *
   * A THUNK, like the two below, and awaited only in the extending branch. It
   * arrived as a value and every caller therefore paid for the whole
   * `architecture/` project before the shape was even consulted: `loam show` and
   * the adopt brief over a fleet whose models all stand alone spun a LikeC4
   * workspace they never read a byte of, and a `loadProject` failure in it
   * propagated out of commands whose model read is one `readFile`. A standalone
   * model is parsed alone, so the map is not part of its answer at all.
   */
  architecture: () => Promise<LoadedDoc>;
  /** Parse the model file alone. Called for a standalone model and never otherwise. */
  standalone: () => Promise<LoadedDoc>;
  /** Parse the per-service project (map + model). Memoised and batched by the caller. */
  project: () => Promise<LoadedDoc>;
}

/**
 * The DOCS-REPO facts a request is derived from, for the caller that holds
 * paths rather than the derived spellings.
 */
export interface ServiceModelSources {
  docsDir: DocsDir;
  paths: ServicePaths;
  shape: ModelShape;
  known: ReadonlySet<string>;
  architecture: () => Promise<LoadedDoc>;
  standalone: () => Promise<LoadedDoc>;
  project: () => Promise<LoadedDoc>;
}

/**
 * `loadServiceModel` addressed by a service's paths — the two derivations that
 * decide whether the slice and the views filter find anything at all, spelled
 * here rather than at the caller.
 *
 * The SERVICE is the leaf directory name, which `ServiceEntry` defines as the
 * canonical id at whatever depth the tree walk found the service; it is what an
 * element's `metadata { service '…' }` binding names and what the element→
 * service resolver answers, so a slice keyed on anything else is empty.
 *
 * The MODEL PATH is made docs-relative and `/`-separated, because that is how
 * LikeC4 spells a view's `sourcePath` inside a project staged from the docs
 * root — on Windows the native separator would miss every view, silently
 * turning "this model declares no diagrams" into a fact about the operating
 * system.
 */
export function serviceModelAt(sources: ServiceModelSources): Promise<ServiceModel> {
  return loadServiceModel({
    shape: sources.shape,
    service: basename(sources.paths.dir),
    modelPath: relative(sources.docsDir, sources.paths.model).split(/[\\/]/).join("/"),
    known: sources.known,
    architecture: sources.architecture,
    // A standalone model is a project of its own — its directory — so its
    // links are graded against the views declared there and nowhere else: a
    // link into a sibling flow file resolves for the renderer, and a link to a
    // view nobody declares stays the `c4.invalid` it always was
    // (`../navigation/unplaced.ts`).
    standalone: async () => gradeLinks(await sources.standalone(), () => projectViews(sources.paths.dir)),
    project: sources.project,
  });
}

/**
 * A `LoadedDoc` carrying nothing — the shape a model that could not be read
 * answers with. A FUNCTION rather than a shared constant: the arrays reach
 * every caller, and one that pushed a finding into a module-level literal would
 * corrupt the answer for every other service in the run.
 */
function noModel(): LoadedDoc {
  return { errors: [], elements: [], relationships: [] };
}

export async function loadServiceModel(req: ServiceModelRequest): Promise<ServiceModel> {
  if (req.shape === "standalone") {
    // Before the map is asked for, deliberately: a standalone model is a file
    // parsed alone, so a reader of one must not pay for the `architecture/`
    // project — nor inherit its failures.
    return { shape: req.shape, doc: await req.standalone(), project: null, unowned: [], mapUnreadable: false };
  }
  const architecture = await req.architecture();
  if (architecture.errors.length > 0) {
    return { shape: req.shape, doc: noModel(), project: null, unowned: [], mapUnreadable: true };
  }
  const project = await req.project();
  if (project.errors.length > 0) {
    // Every error, not the ones whose path is the model's. The map parsed alone
    // and came back clean, so an error now blamed on the landscape exists only
    // because this model joined the set — and dropping it would grade the model
    // valid while the renderer, reading the same two documents together,
    // refuses to draw anything.
    return {
      shape: req.shape,
      doc: { errors: project.errors, elements: [], relationships: [] },
      project: null,
      unowned: [],
      mapUnreadable: false,
    };
  }
  const slice = sliceForService({
    project,
    architecture,
    service: req.service,
    known: req.known,
  });
  return {
    shape: req.shape,
    doc: {
      errors: [],
      elements: slice.elements,
      relationships: slice.relationships,
      // The model file's OWN views, by the file each was written in. A service
      // renders its own diagrams and the fleet's use cases are drawn over the
      // same elements, so without the filter every service in the fleet would
      // report every fleet-level view as one of its own.
      views: (project.views ?? []).filter((view) => view.sourcePath === req.modelPath),
      // The PROJECT's specification, deliberately: an extending model takes the
      // map's kinds and tags, so "what this model can use" is the project's
      // table, and a tags-only block of its own has already been merged into it.
      ...(project.specification === undefined ? {} : { specification: project.specification }),
    },
    project,
    unowned: slice.unowned,
    mapUnreadable: false,
  };
}

/**
 * Every extending model's per-service project, parsed in ONE workspace — the
 * engine under `../prefetch/fleet.ts`'s `prefetch`.
 *
 * Keyed by the RESOLVED model path, which is the key that memo files
 * per-service projects under; a second spelling would be a memo the prefetch
 * fills and no reader ever hits.
 *
 * A batch-infrastructure failure answers with an EMPTY map rather than
 * rejecting: the prefetch is an accelerator and nothing more, so a workspace
 * that could not be created must cost the run its speed and never one finding
 * (`FleetContext.prefetchLikeC4` has behaved this way since the batch loader
 * landed, and the two must not differ — a run that degrades one way and not the
 * other is a run whose report depends on the tmpdir).
 */
export async function batchServiceProjects(docsDir: DocsDir, models: readonly string[]): Promise<ProjectBatch> {
  const out = new Map<string, LoadedDoc>();
  if (models.length === 0) return { projects: out, parses: 0 };
  const sets = await modelProjectSets(docsDir, models);
  // A model that declares nothing adds nothing to its project, so every such
  // model's project is the same one: the architecture documents alone, staged
  // from the same root (`./shape.ts`'s `modelInert` says why that is exact).
  // Parsed ONCE rather than once per model — on a fleet whose map is thousands
  // of lines and whose models are mostly placeholders, the per-model copies
  // were most of the run (docs/BENCHMARKS.md, "A fleet whose weight is in the
  // map").
  const inert = await readInertModels(models);
  const shared = sets.find((set) => inert.has(resolve(set.model)));
  const requests: ProjectRequest[] = sets
    .filter((set) => !inert.has(resolve(set.model)))
    .map((set) => ({ key: resolve(set.model), base: docsDir, paths: set.paths }));
  if (shared !== undefined) {
    // The architecture set is the inert set minus its model, by construction
    // of `modelProjectSets` — so the shared project cannot drift from the
    // per-model one it stands for.
    requests.push({ key: INERT, base: docsDir, paths: shared.paths.filter((path) => path !== shared.model) });
  }
  let loaded: Map<string, ProjectDoc>;
  try {
    // Every project is graded against the renderer's views, asked at most once
    // for the whole batch: each is a slice of the same root project, and a map
    // whose one link names a model's view leaves that link unresolved in every
    // project but one.
    let views: Promise<RenderedViews> | undefined;
    loaded = await loadProjectBatch(requests, () => (views ??= renderedViews(docsDir)));
  } catch {
    // Unreadable is not invalid: the caller seeds nothing and every reader
    // falls back to its own per-project load.
    return { projects: new Map(), parses: 0 };
  }
  for (const [key, doc] of loaded) if (key !== INERT) out.set(key, asLoadedDoc(doc));
  const common = loaded.get(INERT);
  // A shared project that could not be staged leaves every inert model absent,
  // which sends each to its own load — the batch's ordinary failure story.
  if (common !== undefined) for (const model of inert) out.set(model, inertCopy(common));
  return { projects: out, parses: loaded.size };
}

/** What `batchServiceProjects` prepared: a project per model, and how many parses that took. */
export interface ProjectBatch {
  projects: Map<string, LoadedDoc>;
  /** One per project actually staged — the inert models share one, however many there are. */
  parses: number;
}

/**
 * The shared project's key in the batch. NUL cannot occur in a path, so it can
 * never collide with a model's resolved path, which is every other key.
 */
const INERT = "\0inert";

/**
 * One inert model's own copy of the shared project. A COPY, because every
 * other model's `LoadedDoc` is a value of its own — a reader that sorted or
 * extended one model's arrays in place would otherwise be editing every
 * placeholder service's answer at once.
 */
export function inertCopy(common: ProjectDoc): LoadedDoc {
  return structuredClone(asLoadedDoc(common));
}
