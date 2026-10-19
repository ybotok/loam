/**
 * The questions the coherence checks ask lazily, each behind a per-service or
 * per-repo cache.
 *
 * All but one reach outside the delta — into a living spec, a living
 * contract, or another feature in flight — and the cross-feature scan is a
 * walk of every active delta. The exception is `undeprecatedByFeature`, which
 * reads the FEATURE's own openapi delta: it lives here anyway because it is the
 * second half of the one question `deprecatedInLiving` opens — "is this op
 * dying, and is this feature the resurrection?" — and splitting the pair across
 * modules would leave each half's cache discipline unexplained by the other. A
 * feature whose checks never need a lookup must not pay for it, which is why
 * these are closures over a cache rather than arguments computed up front.
 *
 * The one question that used to live here and does not — who still CONSUMES an
 * operation the feature takes out (`edgeConsumers`, `requirementConsumers`,
 * `governorsAfterMerge`) — is the consumer index's now (`core/consumers/`),
 * because `loam diff` and the archive planner ask it too and the three copies
 * had drifted apart in which documents they read.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type PathableService } from "../kernel/ids/service.js";
import { featureSpecPaths } from "../repo/paths.js";
import { operations } from "../openapi/doc.js";
import { locateServicePaths } from "../repo/service-target.js";
import { activeOpAdditions } from "./pending.js";
import { parseRequirements } from "../document/parse.js";
import { type Requirement } from "../document/spec.js";
import type { FleetContext } from "../fleet-context.js";
import { type DeltaScope } from "./declared.js";

/** What the checks may ask lazily — fleet questions, plus the deprecation pair. */
export interface Lookups {
  governedByLivingSpec(service: PathableService, op: string): Promise<boolean>;
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
        const p = (await locateServicePaths(docsDir, service, context)).spec;
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
        const list = await operations((await locateServicePaths(docsDir, service, context)).openapi, context);
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
  return { governedByLivingSpec, definedElsewhere, deprecatedInLiving, undeprecatedByFeature };
}
