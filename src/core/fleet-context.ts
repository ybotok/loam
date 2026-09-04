/**
 * Request-scoped read index for commands that walk a whole loam repository.
 *
 * The filesystem remains the source of truth.  This class deliberately has no
 * singleton/global instance: a command creates one after loading loam.json and
 * drops it when that invocation finishes.  Within that lifetime identical
 * reads share their in-flight Promise, which removes both duplicate I/O and
 * duplicate parsing without making a later CLI invocation observe stale data.
 *
 * Because every markdown artifact is read HERE, this is also where the two
 * failures a read must never swallow are answered: bytes that are not UTF-8
 * (which `readFile(path, "utf8")` silently turns into U+FFFD, so a UTF-16
 * spec.md parses as zero requirements and grades green), and git conflict
 * markers left in a living document (which parse as prose, and which the next
 * `loam archive` rewrites away). One place, so no reader can forget. Both
 * RULES live in leaves — the decode in `document-bytes.ts`, the marker scan
 * and its findings in `conflict-markers.ts` — because the parsers and graders
 * that touch a single file without an index owe the same rules, and must not
 * have to import this module — and the fleet it pulls in behind it — to obey
 * them.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readAsyncapi } from "./asyncapi/read.js";
import type { AsyncapiDoc } from "./asyncapi/model.js";
import { readCapabilityVocabulary, type CapabilityVocabulary } from "./capabilities/capabilities.js";
import { featureCapabilityDeltas } from "./capabilities/delta/tree.js";
import type { CapabilityTree } from "./capabilities/tree.js";
import { conflictMarkerLines } from "./conflict-markers.js";
import { decodeDocument } from "./kernel/document-bytes.js";
import { loadFile, type LoadedDoc } from "./c4/likec4.js";
import { loadBatch } from "./c4/workspace.js";
import { ServiceModels } from "./c4/prefetch/fleet.js";
import type { ServiceModel } from "./c4/service-model/load.js";
import type { ModelShape } from "./c4/service-model/shape.js";
import type { ServicePaths } from "./repo/paths.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "./openapi/doc.js";
import type { RawServiceId } from "./kernel/ids/service.js";
import { type FeatureEntry, type ServiceEntry } from "./repo/entries.js";
import { featureSpecServices, listFeatures, listFleetTree, serviceEntries } from "./repo/repo.js";
import type { FleetTree } from "./repo/tree/walk.js";
import { parseRequirements } from "./document/parse.js";
import { type Requirement } from "./document/spec.js";
import type { DocsDir, FeatureDir } from "./kernel/ids/dirs.js";

export interface FleetContextStats {
  serviceEnumerations: number;
  featureEnumerations: number;
  featureServiceEnumerations: number;
  textReads: number;
  requirementParses: number;
  openapiParses: number;
  /**
   * Reads of a service's `asyncapi.yaml`. Counted separately because this axis
   * is the one that makes a per-service run read the whole fleet: "does anybody
   * publish this message" has no local answer, so `spine.message-unproduced`
   * walks every service's contract. The memo is what keeps that one walk per
   * command instead of one per consuming edge.
   */
  asyncapiParses: number;
  /**
   * Reads of the capability vocabulary — `architecture/capabilities.yaml` AND
   * the `capabilities/` walk, which are one vocabulary and so one read. One per
   * invocation is the capability axis's exit criterion, and this counter is how
   * a test pins it. (Permissions predates the memo and re-parses per service —
   * do not copy that.)
   */
  capabilityParses: number;
  /**
   * Walks of ONE feature's `capabilities/` delta tree. Counted apart from
   * `capabilityParses` because it answers a different question about a
   * different directory, and because a fleet that has not adopted the business
   * axis must be able to prove it pays nothing: every feature's walk is a
   * single `existsSync` that finds no directory, so this counter rises while
   * `textReads` and `requirementParses` do not.
   */
  featureCapabilityWalks: number;
  likec4Loads: number;
  /**
   * PER-SERVICE PROJECTS parsed — the map plus one extending model, staged
   * together (`c4/service-model/`). Apart from `likec4Loads` because they are
   * different units: that counter means documents parsed alone, and a fleet
   * whose models all extend the map moves every unit to this one. One project
   * per service is the axis's exit criterion, and this is how a test pins it.
   */
  projectLoads: number;
}

const key = (path: string): string => resolve(path);

/** One coherent filesystem snapshot for one command invocation. */
export class FleetContext {
  private readonly trees = new Map<string, Promise<FleetTree>>();
  private readonly services = new Map<string, Promise<ServiceEntry[]>>();
  private readonly features = new Map<string, Promise<FeatureEntry[]>>();
  private readonly featureServices = new Map<string, Promise<RawServiceId[]>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();
  private readonly openapis = new Map<string, Promise<OpenapiDoc>>();
  private readonly asyncapis = new Map<string, Promise<AsyncapiDoc>>();
  private readonly capabilityVocabularies = new Map<string, Promise<CapabilityVocabulary>>();
  private readonly featureCapabilities = new Map<string, Promise<CapabilityTree>>();
  private readonly likec4 = new Map<string, Promise<LoadedDoc>>();
  /**
   * The service-model axis's own memos, one object because the rules they
   * encode are `c4/prefetch/fleet.ts`'s rather than this class's. It counts
   * through this instance's counter, so `stats()` stays the one place a caller
   * reads what an invocation cost.
   */
  private readonly models = new ServiceModels({
    onProjectLoad: () => {
      this.counts.projectLoads += 1;
    },
    known: async (docsDir) => new Set((await this.listServices(docsDir)).map((s) => s.id)),
    standalone: (path) => this.loadLikeC4(path),
  });

  private readonly counts: FleetContextStats = {
    serviceEnumerations: 0,
    featureEnumerations: 0,
    featureServiceEnumerations: 0,
    textReads: 0,
    requirementParses: 0,
    openapiParses: 0,
    asyncapiParses: 0,
    capabilityParses: 0,
    featureCapabilityWalks: 0,
    likec4Loads: 0,
    projectLoads: 0,
  };

  /** A copy suitable for diagnostics/tests; callers cannot mutate the counters. */
  stats(): Readonly<FleetContextStats> {
    return { ...this.counts };
  }

  /**
   * The classified `services/` tree — the ONE enumeration this invocation
   * performs. `listServices` below derives its entries from this memo, so a
   * command that asks for both the fleet and the tree's findings (`validate
   * --all` does) still walks the directories exactly once. The counter keeps
   * its historical meaning — walks of `services/` — it just counts the walk
   * where the walk now happens.
   */
  fleetTree(docsDir: DocsDir): Promise<FleetTree> {
    const k = key(docsDir);
    let pending = this.trees.get(k);
    if (pending === undefined) {
      this.counts.serviceEnumerations += 1;
      pending = listFleetTree(docsDir);
      this.trees.set(k, pending);
    }
    return pending;
  }

  listServices(docsDir: DocsDir): Promise<ServiceEntry[]> {
    const k = key(docsDir);
    let pending = this.services.get(k);
    if (pending === undefined) {
      pending = this.fleetTree(docsDir).then(serviceEntries);
      this.services.set(k, pending);
    }
    return pending;
  }

  listFeatures(docsDir: DocsDir, opts: { includeArchived?: boolean } = {}): Promise<FeatureEntry[]> {
    const k = `${key(docsDir)}\0${opts.includeArchived === true ? "all" : "active"}`;
    let pending = this.features.get(k);
    if (pending === undefined) {
      this.counts.featureEnumerations += 1;
      pending = listFeatures(docsDir, opts).then((entries) => {
        // listFeatures has already enumerated every feature's specs/ directory;
        // seed the narrower lookup so validation/coherence do not read it again.
        for (const entry of entries) {
          const featureKey = key(entry.dir);
          if (!this.featureServices.has(featureKey)) {
            this.featureServices.set(featureKey, Promise.resolve(entry.services));
          }
        }
        return entries;
      });
      this.features.set(k, pending);
    }
    return pending;
  }

  featureSpecServices(featureDir: FeatureDir): Promise<RawServiceId[]> {
    const k = key(featureDir);
    let pending = this.featureServices.get(k);
    if (pending === undefined) {
      this.counts.featureServiceEnumerations += 1;
      pending = featureSpecServices(featureDir);
      this.featureServices.set(k, pending);
    }
    return pending;
  }

  /**
   * A markdown artifact as text. Bytes in, decoded once, and refused rather
   * than degraded when they are not UTF-8 — see NotUtf8DocumentError.
   */
  readText(path: string): Promise<string> {
    const k = key(path);
    let pending = this.texts.get(k);
    if (pending === undefined) {
      this.counts.textReads += 1;
      pending = readFile(path).then((bytes) => decodeDocument(bytes, path));
      this.texts.set(k, pending);
    }
    return pending;
  }

  /**
   * Git conflict markers in an already-read document, by line. Free for any
   * caller that was going to read the file anyway — which is every caller,
   * which is the point: the marker check used to cost a whole extra read of one
   * hand-picked file, so it was done for one hand-picked file.
   */
  async conflictMarkers(path: string): Promise<number[]> {
    return conflictMarkerLines(await this.readText(path));
  }

  readRequirements(path: string): Promise<Requirement[]> {
    const k = key(path);
    let pending = this.requirements.get(k);
    if (pending === undefined) {
      this.counts.requirementParses += 1;
      pending = this.readText(path).then(parseRequirements);
      this.requirements.set(k, pending);
    }
    return pending;
  }

  readOpenapi(path: string): Promise<OpenapiDoc> {
    const k = key(path);
    let pending = this.openapis.get(k);
    if (pending === undefined) {
      this.counts.openapiParses += 1;
      pending = readOpenapi(path);
      this.openapis.set(k, pending);
    }
    return pending;
  }

  readAsyncapi(path: string): Promise<AsyncapiDoc> {
    const k = key(path);
    let pending = this.asyncapis.get(k);
    if (pending === undefined) {
      this.counts.asyncapiParses += 1;
      pending = readAsyncapi(path);
      this.asyncapis.set(k, pending);
    }
    return pending;
  }

  /**
   * The capability vocabulary, read once per invocation. Direction rule,
   * load-bearing: this file imports `capabilities/capabilities.js`, so nothing
   * under src/core/capabilities/ may import this module back — that edge is a
   * core-root↔capabilities package cycle `import/no-cycle` cannot see, which is
   * why the functions there take plain data or a `read` function, never a FleetContext.
   */
  capabilities(docsDir: DocsDir): Promise<CapabilityVocabulary> {
    const k = key(docsDir);
    let pending = this.capabilityVocabularies.get(k);
    if (pending === undefined) {
      this.counts.capabilityParses += 1;
      pending = readCapabilityVocabulary(docsDir);
      this.capabilityVocabularies.set(k, pending);
    }
    return pending;
  }

  /**
   * One feature's `capabilities/` delta tree, walked once per invocation. Two
   * readers ask for it in the same run — the delta-shape walk
   * (`core/delta/delta.ts`) and the capability overlay
   * (`core/coherence/declared.ts`) — and without the memo a feature carrying
   * three capability deltas paid the readdirs twice.
   *
   * The direction rule stated on `capabilities()` above applies verbatim: the
   * function this stands in front of takes a plain `FeatureDir`, never a
   * FleetContext, so `src/core/capabilities/` never imports this module back.
   */
  featureCapabilityDeltas(featureDir: FeatureDir): Promise<CapabilityTree> {
    const k = key(featureDir);
    let pending = this.featureCapabilities.get(k);
    if (pending === undefined) {
      this.counts.featureCapabilityWalks += 1;
      pending = featureCapabilityDeltas(featureDir);
      this.featureCapabilities.set(k, pending);
    }
    return pending;
  }

  async operations(path: string): Promise<Operation[]> {
    return (await this.readOpenapi(path)).ops;
  }

  async operationIds(path: string): Promise<string[]> {
    return (await this.readOpenapi(path)).ops.map((op) => op.id);
  }

  /*
   * Deliberately no `serviceOperationIds` here. The living-plus-feature union is
   * a RULE — every removal applied before any upsert — not a read, and a second
   * copy of a rule is a second chance to spell it differently. This one did: it
   * interleaved removals with upserts, so a relocated operation answered
   * "defined" through `archive` (no context) and "gone" through `validate` and
   * `status` (context), or the reverse, depending on the order the feature's
   * YAML happened to spell the two slots in. `core/openapi/doc.ts` owns the rule and
   * threads a context through the reads underneath it, which is the only part
   * this class was ever needed for.
   */

  loadLikeC4(path: string): Promise<LoadedDoc> {
    const k = key(path);
    let pending = this.likec4.get(k);
    if (pending === undefined) {
      this.counts.likec4Loads += 1;
      pending = loadFile(path);
      this.likec4.set(k, pending);
    }
    return pending;
  }

  /**
   * Parse many `.likec4` documents through ONE shared workspace (`loadBatch`)
   * and seed the memo above, so every later `loadLikeC4` in this invocation is
   * a hit. Purely an accelerator: the cache is still this instance's — one
   * invocation, one snapshot, no module state — and the counter still means
   * "documents parsed via LikeC4", incremented once per batch-parsed document.
   *
   * The failure story is the contract here. A batch-INFRASTRUCTURE failure —
   * a sandboxed runner denying tmpdir writes is the environment class ROADMAP
   * documents — degrades to today's per-path loads by seeding nothing: never
   * an error, and never fewer findings, only the old speed. A path the batch
   * could not stage (missing, unreadable) is simply absent from the result, so
   * the later `loadLikeC4` reproduces today's per-path error exactly. And
   * fewer than two misses returns without a workspace at all: one document
   * gains nothing from batch isolation it already has.
   */
  async prefetchLikeC4(paths: string[]): Promise<void> {
    const missing = [...new Set(paths.map(key))].filter((k) => !this.likec4.has(k));
    if (missing.length < 2) return;
    let docs: Map<string, LoadedDoc>;
    try {
      docs = await loadBatch(missing);
    } catch {
      return;
    }
    for (const [k, doc] of docs) {
      // Keyed by the same `key()` as loadLikeC4 — loadBatch resolves paths the
      // identical way, and `missing` was already resolved, so this holds by
      // construction; the has() guard keeps a concurrent load's promise
      // authoritative rather than double-counting the parse.
      if (this.likec4.has(k)) continue;
      this.counts.likec4Loads += 1;
      this.likec4.set(k, Promise.resolve(doc));
    }
  }

  /** The fleet map as the PROJECT it is — landscape plus use cases, minus the generated views file. */
  architecture(docsDir: DocsDir): Promise<LoadedDoc> {
    return this.models.architecture(docsDir);
  }

  /**
   * Which shape each of these models has, keyed by resolved path — one read of
   * each file's bytes per invocation. Ask over the FULL enumeration, never a
   * narrowed run's subset: shapes decide which directories are owed a
   * per-service `likec4.config.json`, and a partial map answers "not
   * standalone" for every service outside it.
   */
  modelShapes(paths: readonly string[]): Promise<Map<string, ModelShape>> {
    return this.models.shapes(paths);
  }

  /**
   * A service's C4 model, read the way its own SHAPE demands — the one entry
   * point for every reader of `model.likec4`, standalone or extending
   * (`c4/service-model/load.ts` states the four arms and why each exists).
   */
  serviceModel(docsDir: DocsDir, paths: ServicePaths): Promise<ServiceModel> {
    return this.models.model(docsDir, paths);
  }

  /**
   * Every service's model prepared in two workspaces whatever the fleet's mix:
   * the extending ones as one project each in one of them, the standalone ones
   * through the document batch above. An accelerator with `prefetchLikeC4`'s
   * failure story exactly — a batch that could not be created seeds nothing, so
   * findings never change because of a tmpdir, only the speed does.
   */
  async prefetchServiceModels(docsDir: DocsDir, paths: readonly ServicePaths[]): Promise<void> {
    await this.prefetchLikeC4(await this.models.prefetch(docsDir, paths));
  }
}
