/**
 * Every service model ONE command invocation has read, memoised — the fleet
 * map, each model's shape, each per-service project, and each assembled
 * `ServiceModel`.
 *
 * A package of its own rather than four more maps on `core/fleet-context.ts`,
 * and the seam is the one that module's banner already states for its leaves:
 * the rules being memoised here are `../service-model/`'s (which shape a file
 * has, which documents its project holds, how a failed batch degrades), and a
 * memo whose rules live an import away is a memo somebody fills under the wrong
 * key. The read index keeps what it owns — the document parses, the
 * enumerations — and hands them in. It also keeps that file under its line
 * limit, which is the honest second reason: this axis is four memos and a batch
 * plan, and it arrived at a module that was already 336 lines of other axes.
 *
 * The direction is one-way and load-bearing: `fleet-context.ts` imports this,
 * never the reverse. Everything this class needs from the read index arrives as
 * a function on the request (`ModelRead`), so nothing here knows that a
 * FleetContext exists — which is what keeps `core/` → `core/c4/` acyclic.
 *
 * REQUEST-SCOPED exactly as `FleetContext` is: one instance per invocation,
 * dropped when the command finishes. No module-level state, so a later run
 * cannot observe an earlier one's answer, and a `chdir` between two tests
 * cannot leak one docs repo into the next.
 */
import { resolve } from "node:path";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { ServicePaths } from "../../repo/paths.js";
import type { LoadedDoc } from "../likec4.js";
import { loadArchitecture } from "../project/architecture.js";
import { asLoadedDoc, loadProject } from "../project/load.js";
import { modelProjectDocuments } from "../service-model/documents.js";
import {
  batchServiceProjects,
  serviceModelAt,
  type ServiceModel,
} from "../service-model/load.js";
import { readModelShape, readModelShapes, type ModelShape } from "../service-model/shape.js";

/**
 * The three things this memo cannot know for itself, supplied once by whoever
 * owns it. Functions rather than values because each is itself memoised on the
 * caller's side: asking again is what makes an answer shared rather than
 * copied.
 */
export interface ModelDeps {
  /** Fires once per per-service project actually parsed, batched or not — the caller owns its counters. */
  onProjectLoad: () => void;
  /** The service directories that exist — the caller has enumerated them; this package must not enumerate them again. */
  known: (docsDir: DocsDir) => Promise<ReadonlySet<string>>;
  /** Parse one `.likec4` document ALONE, through the caller's own document memo, so a prefetched parse is a hit. */
  standalone: (path: string) => Promise<LoadedDoc>;
}

/** One in-flight promise per key, created on first ask — the memo idiom, once. */
function memo<T>(store: Map<string, Promise<T>>, k: string, make: () => Promise<T>): Promise<T> {
  let pending = store.get(k);
  if (pending === undefined) {
    pending = make();
    store.set(k, pending);
  }
  return pending;
}

export class ServiceModels {
  private readonly architectures = new Map<string, Promise<LoadedDoc>>();
  private readonly shapeOf = new Map<string, Promise<ModelShape>>();
  private readonly projects = new Map<string, Promise<LoadedDoc>>();
  private readonly models = new Map<string, Promise<ServiceModel>>();

  constructor(private readonly deps: ModelDeps) {}

  /**
   * The fleet map as the PROJECT it is (`../project/architecture.ts`). Read
   * twice over for every service now rather than once for the run — it is the
   * gate on whether an extending model can be read at all, and the other half
   * of the diff that decides what such a model actually declares — so the memo
   * is what keeps a fleet run to one parse of it.
   *
   * Filled ONLY when somebody asks. `model` below hands `loadServiceModel` a
   * thunk rather than an awaited value, so a fleet whose models all stand alone
   * never parses this project at all — a standalone model is read as one file,
   * and paying for the map (and inheriting its failures) for `loam show` or the
   * adopt brief was cost and risk for an answer nobody used.
   */
  architecture(docsDir: DocsDir): Promise<LoadedDoc> {
    return memo(this.architectures, resolve(docsDir), () => loadArchitecture(docsDir));
  }

  /**
   * Which shape each model has, keyed by resolved path — ONE read of each
   * file's bytes per invocation, however many questions are asked of it.
   *
   * The bulk form is the primary one because every caller asks in bulk: the
   * fleet target needs the shapes of the WHOLE enumeration before it can grade
   * a single renderer-file finding, and the prefetch needs them before it can
   * decide which workspace each model belongs in.
   */
  async shapes(paths: readonly string[]): Promise<Map<string, ModelShape>> {
    const keys = [...new Set(paths.map((path) => resolve(path)))];
    const missing = keys.filter((k) => !this.shapeOf.has(k));
    for (const [k, shape] of await readModelShapes(missing)) {
      // A concurrent read's promise stays authoritative — it is the one another
      // caller is already holding — so a second scan of the same bytes can
      // never replace it with a duplicate.
      if (!this.shapeOf.has(k)) this.shapeOf.set(k, Promise.resolve(shape));
    }
    const answered = await Promise.all(keys.map(async (k) => [k, await this.shape(k)] as const));
    return new Map(answered);
  }

  /** One model's shape, out of the same memo the bulk form fills. */
  shape(modelPath: string): Promise<ModelShape> {
    return memo(this.shapeOf, resolve(modelPath), () => readModelShape(modelPath));
  }

  /** A service's model, read the way its own shape demands. Memoised per model PATH, which is what identifies the file. */
  model(docsDir: DocsDir, paths: ServicePaths): Promise<ServiceModel> {
    return memo(this.models, resolve(paths.model), async () =>
      serviceModelAt({
        docsDir,
        paths,
        shape: await this.shape(paths.model),
        known: await this.deps.known(docsDir),
        // A thunk, so a standalone model never spins the map's workspace: the
        // memo makes the extending case one parse for the run either way.
        architecture: () => this.architecture(docsDir),
        standalone: () => this.deps.standalone(paths.model),
        project: () => this.project(docsDir, paths.model),
      }),
    );
  }

  /**
   * Prepare every EXTENDING model's project in one workspace, and answer with
   * the STANDALONE models' paths for the caller to prefetch through its own
   * document batch — the two shapes need different workspaces, and only the
   * caller has the memo the second one seeds.
   *
   * Purely an accelerator: a batch that could not be created seeds nothing and
   * every reader falls back to its own load, so findings can never change
   * because of a tmpdir — only the speed can.
   */
  async prefetch(docsDir: DocsDir, paths: readonly ServicePaths[]): Promise<string[]> {
    const shapes = await this.shapes(paths.map((p) => p.model));
    const models = (shape: ModelShape): string[] =>
      [...shapes].filter(([, found]) => found === shape).map(([model]) => model);
    const extending = models("extending").filter((model) => !this.projects.has(model));
    for (const [k, doc] of await batchServiceProjects(docsDir, extending)) {
      // A concurrent load's promise stays authoritative: it is the one every
      // reader is already holding, and replacing it would count the parse twice.
      if (this.projects.has(k)) continue;
      this.deps.onProjectLoad();
      this.projects.set(k, Promise.resolve(doc));
    }
    return models("standalone");
  }

  /**
   * One service's project — the architecture documents and its model, parsed
   * together. Keyed on the model, which is what `prefetch` seeds above, so a
   * batched fleet run and a single-service run answer out of the same memo.
   */
  private project(docsDir: DocsDir, modelPath: string): Promise<LoadedDoc> {
    return memo(this.projects, resolve(modelPath), async () => {
      this.deps.onProjectLoad();
      return asLoadedDoc(await loadProject(docsDir, await modelProjectDocuments(docsDir, modelPath)));
    });
  }
}
