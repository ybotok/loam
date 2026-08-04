/**
 * Request-scoped read index for commands that walk a whole loam repository.
 *
 * The filesystem remains the source of truth.  This class deliberately has no
 * singleton/global instance: a command creates one after loading loam.json and
 * drops it when that invocation finishes.  Within that lifetime identical
 * reads share their in-flight Promise, which removes both duplicate I/O and
 * duplicate parsing without making a later CLI invocation observe stale data.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadFile, type LoadedDoc } from "./likec4.js";
import {
  readOpenapi,
  type OpenapiDoc,
  type Operation,
} from "./openapi.js";
import {
  featureSpecServices,
  listFeatures,
  listServices,
  type FeatureEntry,
  type ServiceEntry,
} from "./repo.js";
import { featureSpecPaths, servicePaths } from "./repo.js";
import { parseRequirements, type Requirement } from "./spec.js";

export interface FleetContextStats {
  serviceEnumerations: number;
  featureEnumerations: number;
  featureServiceEnumerations: number;
  textReads: number;
  requirementParses: number;
  openapiParses: number;
  likec4Loads: number;
}

function key(path: string): string {
  return resolve(path);
}

/** One coherent filesystem snapshot for one command invocation. */
export class FleetContext {
  private readonly services = new Map<string, Promise<ServiceEntry[]>>();
  private readonly features = new Map<string, Promise<FeatureEntry[]>>();
  private readonly featureServices = new Map<string, Promise<string[]>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();
  private readonly openapis = new Map<string, Promise<OpenapiDoc>>();
  private readonly likec4 = new Map<string, Promise<LoadedDoc>>();

  private readonly counts: FleetContextStats = {
    serviceEnumerations: 0,
    featureEnumerations: 0,
    featureServiceEnumerations: 0,
    textReads: 0,
    requirementParses: 0,
    openapiParses: 0,
    likec4Loads: 0,
  };

  /** A copy suitable for diagnostics/tests; callers cannot mutate the counters. */
  stats(): Readonly<FleetContextStats> {
    return { ...this.counts };
  }

  listServices(docsDir: string): Promise<ServiceEntry[]> {
    const k = key(docsDir);
    let pending = this.services.get(k);
    if (pending === undefined) {
      this.counts.serviceEnumerations += 1;
      pending = listServices(docsDir);
      this.services.set(k, pending);
    }
    return pending;
  }

  listFeatures(docsDir: string, opts: { includeArchived?: boolean } = {}): Promise<FeatureEntry[]> {
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

  featureSpecServices(featureDir: string): Promise<string[]> {
    const k = key(featureDir);
    let pending = this.featureServices.get(k);
    if (pending === undefined) {
      this.counts.featureServiceEnumerations += 1;
      pending = featureSpecServices(featureDir);
      this.featureServices.set(k, pending);
    }
    return pending;
  }

  readText(path: string): Promise<string> {
    const k = key(path);
    let pending = this.texts.get(k);
    if (pending === undefined) {
      this.counts.textReads += 1;
      pending = readFile(path, "utf8");
      this.texts.set(k, pending);
    }
    return pending;
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

  async operations(path: string): Promise<Operation[]> {
    return (await this.readOpenapi(path)).ops;
  }

  async operationIds(path: string): Promise<string[]> {
    return (await this.readOpenapi(path)).ops.map((op) => op.id);
  }

  async serviceOperationIds(docsDir: string, service: string, featureDir?: string): Promise<string[]> {
    const ids = new Set<string>();
    if (featureDir !== undefined) {
      for (const id of await this.operationIds(featureSpecPaths(featureDir, service).openapi)) ids.add(id);
    }
    for (const id of await this.operationIds(servicePaths(docsDir, service).openapi)) ids.add(id);
    return [...ids];
  }

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
}
