/**
 * What one feature ADDS and what it NEEDS, read out of its own delta.
 *
 * The whole graph is built from these five lists and nothing else, which is why
 * they are computed once per feature and indexed rather than re-derived per
 * edge: a feature is a node here only because some other feature's requirement
 * or operation resolves into it, and answering that per pair would be a fleet
 * walk per pair.
 *
 * `reqKeys` returns BOTH spellings of a requirement's identity — the stable
 * `Requirement-ID` and the exact heading — because a legacy requirement has only
 * the second, and an edge that existed under one spelling and not the other
 * would make the graph depend on when the corpus was migrated.
 */
import { existsSync } from "node:fs";
import type { PathableService } from "../kernel/ids.js";
import { FleetContext } from "../fleet-context.js";
import { serviceResolver } from "../c4/likec4.js";
import { operations } from "../openapi/doc.js";
import { type FeatureEntry } from "../repo/entries.js";
import { SPEC_AXES, featurePaths, featureSpecPaths, servicePaths, type SpecAxis } from "../repo/paths.js";
import { enumeratedServiceIds, enumeratedServiceIndex } from "../repo/service-target.js";
import type { Requirement } from "../document/spec.js";

export type DependencyReason =
  | {
      kind: "requirement";
      service: string;
      axis: SpecAxis["file"];
      identity: string;
    }
  | { kind: "operation"; service: string; operationId: string };

export interface DependencyEdge {
  /** The feature that consumes/modifies something. */
  from: string;
  /** The feature that introduces it and therefore has to land first. */
  to: string;
  reasons: DependencyReason[];
}

export interface FeatureConflict {
  kind: "requirement" | "operation";
  /**
   * How the owners collide.
   *
   * `added` — two features ADD the same identity (or define the same
   * operationId): whichever archives second replaces the first outright.
   *
   * `changed` — two features MODIFY or REMOVE the same living requirement.
   * That collision was invisible until now, and it is the more common one on a
   * fleet: nobody adds "Cancel an order" twice, but two teams editing its text
   * in the same week is a Tuesday. A MODIFIED requirement carries its FULL new
   * text, so the second archive does not merge the first one's wording — it
   * overwrites it, silently and completely.
   */
  change: "added" | "changed";
  service: string;
  axis?: SpecAxis["file"];
  identity: string;
  features: string[];
}

export interface DependencyNode {
  id: string;
  dirName: string;
  services: string[];
  dependsOn: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  conflicts: FeatureConflict[];
  /** Dependencies precede their consumers; cyclic members remain deterministic. */
  order: string[];
  /** Strongly connected components with more than one node (or a self-loop). */
  cycles: string[][];
}

export interface FeatureFacts {
  feature: FeatureEntry;
  addedRequirements: Array<{
    service: string;
    axis: SpecAxis["file"];
    requirement: Requirement;
  }>;
  changedRequirements: Array<{
    service: string;
    axis: SpecAxis["file"];
    requirement: Requirement;
  }>;
  introducedOperations: Array<{ service: string; operationId: string }>;
  requiredOperations: Array<{ service: string; operationId: string }>;
}

export function reqKeys(requirement: Pick<Requirement, "id" | "name">): string[] {
  return [
    ...(requirement.id === undefined ? [] : [`id:${requirement.id}`]),
    `name:${requirement.name}`,
  ];
}

/**
 * WHERE a collision happens, kept as fields rather than as a string.
 *
 * An index needs one scalar per entry to hash on, so the fields get NUL-joined
 * into a key — but the conflict records want those fields back, and splitting
 * the key apart again means asserting the pieces back into their types. That
 * assertion is a claim about data loam does not own: a service directory or a
 * requirement name containing a NUL would hand `axis` a fragment of an identity
 * with nothing to notice. Carrying the structured value beside the owner set
 * means the key is only ever a key, and the record is read, not reconstructed.
 */
export interface ReqAt {
  service: string;
  axis: SpecAxis["file"];
  identity: string;
}

export interface OpAt {
  service: string;
  operationId: string;
}

export interface Owners<T> {
  readonly at: T;
  readonly features: Set<string>;
}

export function reqIndexKey(at: ReqAt): string {
  return `${at.service}\0${at.axis}\0${at.identity}`;
}

export function opIndexKey(at: OpAt): string {
  return `${at.service}\0${at.operationId}`;
}

export function addOwner<T>(index: Map<string, Owners<T>>, key: string, at: T, feature: string): void {
  const owners = index.get(key) ?? { at, features: new Set<string>() };
  owners.features.add(feature);
  index.set(key, owners);
}

export async function readFacts(
  docsDir: string,
  feature: FeatureEntry,
  context: FleetContext,
): Promise<FeatureFacts> {
  const addedRequirements: FeatureFacts["addedRequirements"] = [];
  const changedRequirements: FeatureFacts["changedRequirements"] = [];
  const introducedOperations: FeatureFacts["introducedOperations"] = [];
  const requiredOperations: FeatureFacts["requiredOperations"] = [];

  /**
   * The operationIds a service ALREADY has, per service.
   *
   * This is the whole difference between a dependency graph and a rumour mill.
   * A feature's `openapi.yaml` is a COMPLETE document, not a patch — authors
   * restate the living API around the slot they are changing — so every feature
   * that so much as mentions `authorizePayment` used to be recorded as
   * INTRODUCING it, and every other feature governing it as REQUIRING it. Two
   * features quoting the same living operation therefore depended on each other
   * in both directions: an invented cycle, an invented conflict, and an ordering
   * for work that had none. `loam validate`'s coherence pass already subtracts
   * the living contract this way (core/coherence/coherence.ts); this is the
   * same subtraction, so the two cannot disagree about what "new" means.
   *
   * Cached per service inside the call and, through the FleetContext, across
   * features: a fleet-wide graph asks about the same ten services N times.
   */
  const livingByService = new Map<string, Set<string>>();
  const living = async (service: PathableService): Promise<Set<string>> => {
    let ids = livingByService.get(service);
    if (ids === undefined) {
      ids = new Set(
        (await operations(servicePaths(docsDir, service).openapi, context))
          .filter((op) => !op.remove)
          .map((op) => op.id),
      );
      livingByService.set(service, ids);
    }
    return ids;
  };

  for (const service of feature.services) {
    const paths = featureSpecPaths(feature.dir, service);
    const livingIds = await living(service);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      const requirements = await context.readRequirements(path);
      for (const requirement of requirements) {
        const fact = { service, axis: axis.file, requirement };
        if (requirement.kind === "ADDED") addedRequirements.push(fact);
        if (requirement.kind === "MODIFIED" || requirement.kind === "REMOVED") {
          changedRequirements.push(fact);
        }
        for (const operationId of requirement.operations) {
          // Governing an operation the service already provides is not a
          // dependency on anybody: the contract it needs is already merged.
          if (livingIds.has(operationId)) continue;
          requiredOperations.push({ service, operationId });
        }
      }
    }

    if (existsSync(paths.openapi)) {
      const featureOperations = await operations(paths.openapi, context);
      for (const operation of featureOperations) {
        if (livingIds.has(operation.id)) continue;
        if (operation.remove) requiredOperations.push({ service, operationId: operation.id });
        else introducedOperations.push({ service, operationId: operation.id });
      }
    }
  }

  // The C4 delta is the FOURTH place a feature names an operation, and it was
  // the one the graph could not see: an edge carrying `metadata { op 'x' }` is
  // a call this feature builds on `x`, which is exactly the "must land first"
  // relation this module exists to compute. Validate already says so — it
  // reports `c4-api.op-pending` when the op is defined by another feature in
  // flight — so the graph disagreeing with the validator about the same pair of
  // features was the graph being wrong, not quiet.
  //
  // Endpoints resolve through `serviceResolver` — the element's
  // `metadata { service }` binding, title as fallback — the same join every
  // other check uses, so renaming a box in a diagram cannot silently unhook it
  // here either.
  const deltaPath = featurePaths(feature.dir).delta;
  if (existsSync(deltaPath)) {
    const doc = await context.loadLikeC4(deltaPath);
    // A delta that does not parse proves nothing about who depends on whom.
    // `loam validate` owns that diagnosis (`delta.invalid`); inventing edges out
    // of a half-read document would be worse than the silence.
    if (doc.errors.length === 0) {
      // One resolver for the whole delta: `serviceOf` rebuilds its id map on
      // every call, and this loop asks once per edge. The enumerated fleet —
      // `services/` plus this feature's own `specs/` directories, the same
      // union `enumeratedTarget` probes below — rides into the resolver so a
      // delta that models CONTAINERS keeps its edges attached: without it, an
      // edge into `payment.api` resolves to a service called "api" that has
      // never existed, the op lookup misses the living contract, and the graph
      // invents a dependency (or orders two features that share nothing). An
      // unenumerable services/ falls back to the feature's own names — every
      // living probe would have found nothing there anyway.
      const fleetIds = await enumeratedServiceIds(docsDir, context);
      const svcOf = serviceResolver(doc.elements, new Set([...fleetIds, ...feature.services]));
      // The resolver answers with document text and `living` builds a path, so
      // the name crosses through the enumeration — coherence.ts grades its
      // edges through the same bridge. A name no enumeration vouches for has
      // no living contract anywhere: the op is required, exactly what the
      // probe answered for an absent service.
      const enumeratedTarget = enumeratedServiceIndex(docsDir, feature.services, context);
      for (const rel of doc.relationships) {
        if (rel.op === undefined) continue;
        const service = svcOf(rel.target);
        const pathable = await enumeratedTarget(service);
        if (pathable !== undefined && (await living(pathable)).has(rel.op)) continue;
        requiredOperations.push({ service, operationId: rel.op });
      }
    }
  }

  return {
    feature,
    addedRequirements,
    changedRequirements,
    introducedOperations,
    requiredOperations,
  };
}
