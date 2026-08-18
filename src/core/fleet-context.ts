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
import { readAsyncapi, type AsyncapiDoc } from "./asyncapi/read.js";
import { conflictMarkerLines } from "./conflict-markers.js";
import { decodeDocument } from "./kernel/document-bytes.js";
import { loadFile, type LoadedDoc } from "./c4/likec4.js";
import { loadBatch } from "./c4/workspace.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "./openapi/doc.js";
import type { RawServiceId } from "./kernel/ids/service.js";
import { type FeatureEntry, type ServiceEntry } from "./repo/entries.js";
import { featureSpecServices, listFeatures, listServices } from "./repo/repo.js";
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
  likec4Loads: number;
}

function key(path: string): string {
  return resolve(path);
}

/** One coherent filesystem snapshot for one command invocation. */
export class FleetContext {
  private readonly services = new Map<string, Promise<ServiceEntry[]>>();
  private readonly features = new Map<string, Promise<FeatureEntry[]>>();
  private readonly featureServices = new Map<string, Promise<RawServiceId[]>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();
  private readonly openapis = new Map<string, Promise<OpenapiDoc>>();
  private readonly asyncapis = new Map<string, Promise<AsyncapiDoc>>();
  private readonly likec4 = new Map<string, Promise<LoadedDoc>>();

  private readonly counts: FleetContextStats = {
    serviceEnumerations: 0,
    featureEnumerations: 0,
    featureServiceEnumerations: 0,
    textReads: 0,
    requirementParses: 0,
    openapiParses: 0,
    asyncapiParses: 0,
    likec4Loads: 0,
  };

  /** A copy suitable for diagnostics/tests; callers cannot mutate the counters. */
  stats(): Readonly<FleetContextStats> {
    return { ...this.counts };
  }

  listServices(docsDir: DocsDir): Promise<ServiceEntry[]> {
    const k = key(docsDir);
    let pending = this.services.get(k);
    if (pending === undefined) {
      this.counts.serviceEnumerations += 1;
      pending = listServices(docsDir);
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
}
