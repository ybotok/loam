/**
 * The questions this feature's own files cannot answer, each read lazily.
 *
 * Every one of them reaches outside the delta — into a living spec, the fleet
 * map, or another feature in flight — and every one of them is expensive: the
 * landscape is a full LikeC4 workspace spin-up, and the cross-feature scan is a
 * walk of every active delta. A feature whose checks never need one must not
 * pay for it, which is why these are closures over a cache rather than
 * arguments computed up front.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, serviceResolver, type LoadedDoc } from "../c4/likec4.js";
import { type PathableService } from "../kernel/ids.js";
import { landscapePath, servicePaths } from "../repo/paths.js";
import { listServices } from "../repo/repo.js";
import { activeOpAdditions } from "./pending.js";
import { parseRequirements } from "../document/parse.js";
import { type Requirement } from "../document/spec.js";
import type { FleetContext } from "../fleet-context.js";
import { type DeltaScope } from "./declared.js";

/** What the checks may ask about the world outside this feature's own files. */
export interface Lookups {
  governedByLivingSpec(service: PathableService, op: string): Promise<boolean>;
  edgeConsumers(service: string, op: string): Promise<string[]>;
  requirementConsumers(service: string, op: string): Promise<string[]>;
  definedElsewhere(service: string, op: string): Promise<string | undefined>;
}

export function coherenceLookups(scope: DeltaScope, context?: FleetContext): Lookups {
  const { docsDir, featureId } = scope;
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
      const resolve = serviceResolver(livingLandscape.elements);
      return livingLandscape.relationships
        .filter((r) => r.op === op && resolve(r.target) === service)
        .map((r) => `edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`);
    };
    const requirementConsumers = async (service: string, op: string): Promise<string[]> => {
      let others: PathableService[];
      try {
        others = (await (context === undefined ? listServices(docsDir) : context.listServices(docsDir)))
          .map((s) => s.id)
          .filter((id) => id !== service);
      } catch {
        // No enumerable services/ — validate's `services-missing` is that
        // repository's finding, not this feature's.
        return [];
      }
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
  return { governedByLivingSpec, edgeConsumers, requirementConsumers, definedElsewhere };
}
