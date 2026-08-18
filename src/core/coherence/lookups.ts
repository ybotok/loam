/**
 * The questions the coherence checks ask lazily, each behind a per-service or
 * per-repo cache.
 *
 * All but one reach outside the delta — into a living spec, the fleet map, or
 * another feature in flight — and those are expensive: the landscape is a full
 * LikeC4 workspace spin-up, and the cross-feature scan is a walk of every
 * active delta. The exception is `undeprecatedByFeature`, which reads the
 * FEATURE's own openapi delta: it lives here anyway because it is the second
 * half of the one question `deprecatedInLiving` opens — "is this op dying, and
 * is this feature the resurrection?" — and splitting the pair across modules
 * would leave each half's cache discipline unexplained by the other. A feature
 * whose checks never need a lookup must not pay for it, which is why these are
 * closures over a cache rather than arguments computed up front.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, serviceResolver, type LoadedDoc } from "../c4/likec4.js";
import { type PathableService } from "../kernel/ids/service.js";
import { featureSpecPaths, landscapePath, servicePaths } from "../repo/paths.js";
import { operations } from "../openapi/doc.js";
import { enumeratedServiceIds } from "../repo/service-target.js";
import { activeOpAdditions } from "./pending.js";
import { parseRequirements } from "../document/parse.js";
import { type Requirement } from "../document/spec.js";
import type { FleetContext } from "../fleet-context.js";
import { type DeltaScope } from "./declared.js";

/** What the checks may ask lazily — fleet questions, plus the deprecation pair. */
export interface Lookups {
  governedByLivingSpec(service: PathableService, op: string): Promise<boolean>;
  edgeConsumers(service: string, op: string): Promise<string[]>;
  requirementConsumers(service: string, op: string): Promise<string[]>;
  definedElsewhere(service: string, op: string): Promise<string | undefined>;
  deprecatedInLiving(service: PathableService, op: string): Promise<boolean>;
  undeprecatedByFeature(service: PathableService, op: string): Promise<boolean>;
}

export function coherenceLookups(scope: DeltaScope, context?: FleetContext): Lookups {
  const { docsDir, featureDir, featureId } = scope;
    const livingReqs = new Map<string, Requirement[]>();
    const livingRequirements = async (service: PathableService): Promise<Requirement[]> => {
      let reqs = livingReqs.get(service);
      if (reqs === undefined) {
        const p = servicePaths(docsDir, service).spec;
        reqs = existsSync(p)
          ? context === undefined
            ? parseRequirements(await readFile(p, "utf8"))
            : await context.readRequirements(p)
          : [];
        livingReqs.set(service, reqs);
      }
      return reqs;
    };
    const governedByLivingSpec = async (service: PathableService, op: string): Promise<boolean> => {
      return (await livingRequirements(service)).some((r) => r.operations.includes(op));
    };

    // The enumerated fleet, read once and shared by both consumer scans below.
    let serviceIds: PathableService[] | undefined;
    const enumeratedServices = async (): Promise<PathableService[]> =>
      (serviceIds ??= await enumeratedServiceIds(docsDir, context));

    // --- retiring an operation the fleet still calls ---
    //
    // A removal marker is checked against the living CONTRACT (does the slot
    // exist) and the feature's own requirements (is the retirement governed).
    // Neither question asks the one that matters to the other ninety-nine repos:
    // is anybody still calling it? The living landscape is the fleet's own answer
    // — an edge with `metadata { op }` is a consumer somebody drew — and another
    // service's living requirements naming the operation are a second. Both are
    // gating: the merge deletes the operation from the contract while the edge
    // and the requirement stay, so the very next `validate --all` reports a
    // broken contract on a repository whose author was never in this feature.
    //
    // Lazy on purpose: the landscape is a full LikeC4 workspace spin-up and the
    // requirement scan reads every service's living spec, and a feature that
    // removes nothing must pay for neither.
    let livingLandscape: LoadedDoc | null | undefined;
    const edgeConsumers = async (service: string, op: string): Promise<string[]> => {
      if (livingLandscape === undefined) {
        const path = landscapePath(docsDir);
        livingLandscape = existsSync(path)
          ? context === undefined
            ? await loadFile(path)
            : await context.loadLikeC4(path)
          : null;
      }
      // An unreadable landscape proves nothing either way; `landscape.invalid`
      // is validate's finding to make, and inventing a removal refusal out of a
      // parse error would point the author at the wrong file.
      if (livingLandscape === null || livingLandscape.errors.length > 0) return [];
      // The enumerated fleet rides along so a landscape that models CONTAINERS
      // stays visible: without it, an edge into `payment.api` resolves to a
      // service called "api" that has never existed, the `=== service` join
      // below finds nothing, and the one check standing between a removal and
      // its last consumer answers "nobody calls it".
      const resolve = serviceResolver(livingLandscape.elements, new Set(await enumeratedServices()));
      return livingLandscape.relationships
        .filter((r) => r.op === op && resolve(r.target) === service)
        .map((r) => `edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`);
    };
    const requirementConsumers = async (service: string, op: string): Promise<string[]> => {
      const others = (await enumeratedServices()).filter((id) => id !== service);
      const out: string[] = [];
      for (const other of others) {
        for (const r of await livingRequirements(other)) {
          if (r.operations.includes(op)) out.push(`${other}'s living requirement '${r.name}'`);
        }
      }
      return out;
    };

    // What OTHER features in flight define, per (service, op). Cross-service work
    // normally lands as feature A calling an op that in-flight feature B introduces;
    // that is an ordering dependency, not a broken contract, and the requirements
    // axis already grades the same shape as a warn (delta.modified-pending). Lazy
    // like delta.ts's activeAdditions — the common case (op resolves) never pays
    // for the fleet scan.
    let inFlightOps: Map<string, string> | null = null;
    const definedElsewhere = async (service: string, op: string): Promise<string | undefined> => {
      inFlightOps ??= await activeOpAdditions(docsDir, featureId, context);
      return inFlightOps.get(`${service} ${op}`);
    };

    // What the LIVING provider contracts mark `deprecated: true`, read lazily
    // per service. Living only, on purpose: the feature's own openapi delta
    // restates the full API, and the question here is whether the fleet as
    // shipped is already retiring the op this feature starts leaning on.
    const livingDeprecated = new Map<string, Set<string>>();
    const deprecatedInLiving = async (service: PathableService, op: string): Promise<boolean> => {
      let set = livingDeprecated.get(service);
      if (!set) {
        const list = await operations(servicePaths(docsDir, service).openapi, context);
        set = new Set(list.filter((o) => o.deprecated).map((o) => o.id));
        livingDeprecated.set(service, set);
      }
      return set.has(op);
    };

    // ...unless this feature IS the un-deprecation: an openapi delta that
    // restates the op WITHOUT `deprecated: true` retires the flag on archive
    // (the path-item overwrite is wholesale), so "prefer the replacement
    // operation" would point the author away from the exact change they are
    // shipping. A delta that restates the op still deprecated — or has no
    // delta for the service at all — keeps the warning. The one lookup here
    // that reads the delta's own files rather than the world outside it (the
    // header says why it lives beside its living twin regardless).
    const featureUndeprecated = new Map<string, Set<string>>();
    const undeprecatedByFeature = async (service: PathableService, op: string): Promise<boolean> => {
      let set = featureUndeprecated.get(service);
      if (!set) {
        const list = await operations(featureSpecPaths(featureDir, service).openapi, context);
        set = new Set(list.filter((o) => !o.deprecated).map((o) => o.id));
        featureUndeprecated.set(service, set);
      }
      return set.has(op);
    };
  return {
    governedByLivingSpec, edgeConsumers, requirementConsumers, definedElsewhere,
    deprecatedInLiving, undeprecatedByFeature,
  };
}
