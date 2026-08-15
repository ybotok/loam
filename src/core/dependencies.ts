/**
 * A read-only dependency/conflict index for active features.
 *
 * This is deliberately derived from parsed artifacts rather than validation
 * messages: issue prose is for people and is not an API.  The graph answers a
 * narrower question — which in-flight change must land before another because
 * it introduces an identity or operation the latter already refers to.
 */
import { existsSync } from "node:fs";
import { inOrder } from "./kernel/concurrency.js";
import { FleetContext } from "./fleet-context.js";
import { serviceResolver } from "./c4/likec4.js";
import { operations } from "./openapi.js";
import { compareIds, type FeatureEntry } from "./repo/entries.js";
import { SPEC_AXES, featurePaths, featureSpecPaths, servicePaths, type SpecAxis } from "./repo/paths.js";
import { listFeatures } from "./repo/repo.js";
import type { Requirement } from "./document/spec.js";

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

interface FeatureFacts {
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

function reqKeys(requirement: Pick<Requirement, "id" | "name">): string[] {
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
interface ReqAt {
  service: string;
  axis: SpecAxis["file"];
  identity: string;
}

interface OpAt {
  service: string;
  operationId: string;
}

interface Owners<T> {
  readonly at: T;
  readonly features: Set<string>;
}

function reqIndexKey(at: ReqAt): string {
  return `${at.service}\0${at.axis}\0${at.identity}`;
}

function opIndexKey(at: OpAt): string {
  return `${at.service}\0${at.operationId}`;
}

function addOwner<T>(index: Map<string, Owners<T>>, key: string, at: T, feature: string): void {
  const owners = index.get(key) ?? { at, features: new Set<string>() };
  owners.features.add(feature);
  index.set(key, owners);
}

async function readFacts(
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
  const living = async (service: string): Promise<Set<string>> => {
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
      // every call, and this loop asks once per edge.
      const svcOf = serviceResolver(doc.elements);
      for (const rel of doc.relationships) {
        if (rel.op === undefined) continue;
        const service = svcOf(rel.target);
        if ((await living(service)).has(rel.op)) continue;
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

function compareReasons(a: DependencyReason, b: DependencyReason): number {
  const ak = a.kind === "requirement"
    ? `${a.kind}\0${a.service}\0${a.axis}\0${a.identity}`
    : `${a.kind}\0${a.service}\0${a.operationId}`;
  const bk = b.kind === "requirement"
    ? `${b.kind}\0${b.service}\0${b.axis}\0${b.identity}`
    : `${b.kind}\0${b.service}\0${b.operationId}`;
  return compareIds(ak, bk);
}

function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function appendReason(
  edges: Map<string, DependencyEdge>,
  from: string,
  to: string,
  reason: DependencyReason,
): void {
  if (from === to) return;
  const key = edgeKey(from, to);
  const edge = edges.get(key) ?? { from, to, reasons: [] };
  const encoded = JSON.stringify(reason);
  if (!edge.reasons.some((item) => JSON.stringify(item) === encoded)) edge.reasons.push(reason);
  edges.set(key, edge);
}

function stronglyConnected(ids: string[], edges: DependencyEdge[]): string[][] {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
  for (const targets of adjacency.values()) targets.sort(compareIds);

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    indices.set(id, nextIndex);
    low.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort(compareIds);
    const selfLoop = component.length === 1
      && (adjacency.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || selfLoop) components.push(component);
  };

  for (const id of [...ids].sort(compareIds)) if (!indices.has(id)) visit(id);
  return components.sort((a, b) => compareIds(a[0]!, b[0]!));
}

function dependencyFirstOrder(ids: string[], edges: DependencyEdge[]): string[] {
  const deps = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) deps.get(edge.from)?.push(edge.to);
  for (const values of deps.values()) values.sort(compareIds);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dependency of deps.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...ids].sort(compareIds)) visit(id);
  return order;
}

/** Derive the complete active-feature graph, or one feature and its transitive prerequisites. */
export async function analyzeDependencies(
  docsDir: string,
  featureId?: string,
  context = new FleetContext(),
): Promise<DependencyGraph> {
  const features = await listFeatures(docsDir, {}, context);
  // Bounded, not `Promise.all`: `readFacts` loads the feature's delta.likec4,
  // and each of those is a whole Langium workspace held open until the read
  // finishes — the same resource `validate --all` rations for the same measured
  // reason (see core/kernel/concurrency.ts). This module fanned out over every active
  // feature at once, and it is not only `loam dependencies` that pays: the fleet
  // form of `loam status` calls in here too. `inOrder` returns results in input
  // order, so the graph, the conflict list and their ordering are unchanged.
  const facts = await inOrder(features, (feature) => readFacts(docsDir, feature, context));
  const requirementOwners = new Map<string, Owners<ReqAt>>();
  // The second index over the SAME identity: who MODIFIES or REMOVES it. Only
  // the first index existed, so the graph could see "two features add the same
  // requirement" and was blind to "two features rewrite the same requirement" —
  // the collision that actually happens on a fleet, and the one whose loser
  // loses their whole authored text without a word from any command.
  const changedOwners = new Map<string, Owners<ReqAt>>();
  const operationOwners = new Map<string, Owners<OpAt>>();

  for (const fact of facts) {
    for (const added of fact.addedRequirements) {
      for (const identity of reqKeys(added.requirement)) {
        const at: ReqAt = { service: added.service, axis: added.axis, identity };
        addOwner(requirementOwners, reqIndexKey(at), at, fact.feature.id);
      }
    }
    for (const changed of fact.changedRequirements) {
      for (const identity of reqKeys(changed.requirement)) {
        const at: ReqAt = { service: changed.service, axis: changed.axis, identity };
        addOwner(changedOwners, reqIndexKey(at), at, fact.feature.id);
      }
    }
    for (const operation of fact.introducedOperations) {
      addOwner(operationOwners, opIndexKey(operation), operation, fact.feature.id);
    }
  }

  const edgeMap = new Map<string, DependencyEdge>();
  for (const fact of facts) {
    for (const changed of fact.changedRequirements) {
      for (const identity of reqKeys(changed.requirement)) {
        const at: ReqAt = { service: changed.service, axis: changed.axis, identity };
        for (const owner of requirementOwners.get(reqIndexKey(at))?.features ?? []) {
          appendReason(edgeMap, fact.feature.id, owner, { kind: "requirement", ...at });
        }
      }
    }
    for (const required of fact.requiredOperations) {
      for (const owner of operationOwners.get(opIndexKey(required))?.features ?? []) {
        appendReason(edgeMap, fact.feature.id, owner, { kind: "operation", ...required });
      }
    }
  }

  let edges = [...edgeMap.values()]
    .map((edge) => ({ ...edge, reasons: edge.reasons.sort(compareReasons) }))
    .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));

  const conflicts: FeatureConflict[] = [];
  for (const [index, change] of [
    [requirementOwners, "added"],
    [changedOwners, "changed"],
  ] as const) {
    for (const { at, features } of index.values()) {
      if (features.size < 2) continue;
      conflicts.push({
        kind: "requirement",
        change,
        service: at.service,
        axis: at.axis,
        identity: at.identity,
        features: [...features].sort(compareIds),
      });
    }
  }
  for (const { at, features } of operationOwners.values()) {
    if (features.size < 2) continue;
    conflicts.push({
      kind: "operation",
      // Two features DEFINING the same operationId — the only way an operation
      // collides, since removals address a living slot rather than claim one.
      change: "added",
      service: at.service,
      identity: at.operationId,
      features: [...features].sort(compareIds),
    });
  }
  conflicts.sort((a, b) =>
    compareIds(a.kind, b.kind)
    || compareIds(a.change, b.change)
    || compareIds(a.service, b.service)
    || compareIds(a.axis ?? "", b.axis ?? "")
    || compareIds(a.identity, b.identity));

  let selected = new Set(features.map((feature) => feature.id));
  if (featureId !== undefined) {
    selected = new Set<string>([featureId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (selected.has(edge.from) && !selected.has(edge.to)) {
          selected.add(edge.to);
          changed = true;
        }
      }
    }
    edges = edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to));
  }

  const selectedFeatures = features.filter((feature) => selected.has(feature.id));
  const ids = selectedFeatures.map((feature) => feature.id);
  const nodes = selectedFeatures.map((feature): DependencyNode => ({
    id: feature.id,
    dirName: feature.dirName,
    services: [...feature.services],
    dependsOn: edges.filter((edge) => edge.from === feature.id).map((edge) => edge.to).sort(compareIds),
  }));

  return {
    nodes,
    edges,
    conflicts: conflicts.filter((conflict) => conflict.features.some((id) => selected.has(id))),
    order: dependencyFirstOrder(ids, edges),
    cycles: stronglyConnected(ids, edges),
  };
}
