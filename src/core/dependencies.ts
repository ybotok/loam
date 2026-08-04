/**
 * A read-only dependency/conflict index for active features.
 *
 * This is deliberately derived from parsed artifacts rather than validation
 * messages: issue prose is for people and is not an API.  The graph answers a
 * narrower question — which in-flight change must land before another because
 * it introduces an identity or operation the latter already refers to.
 */
import { existsSync } from "node:fs";
import { FleetContext } from "./fleet-context.js";
import { operations } from "./openapi.js";
import {
  SPEC_AXES,
  compareIds,
  featureSpecPaths,
  listFeatures,
  type FeatureEntry,
  type SpecAxis,
} from "./repo.js";
import type { Requirement } from "./spec.js";

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

function reqIndexKey(service: string, axis: string, identity: string): string {
  return `${service}\0${axis}\0${identity}`;
}

function opIndexKey(service: string, operationId: string): string {
  return `${service}\0${operationId}`;
}

function addOwner(index: Map<string, Set<string>>, key: string, feature: string): void {
  const owners = index.get(key) ?? new Set<string>();
  owners.add(feature);
  index.set(key, owners);
}

async function readFacts(feature: FeatureEntry, context: FleetContext): Promise<FeatureFacts> {
  const addedRequirements: FeatureFacts["addedRequirements"] = [];
  const changedRequirements: FeatureFacts["changedRequirements"] = [];
  const introducedOperations: FeatureFacts["introducedOperations"] = [];
  const requiredOperations: FeatureFacts["requiredOperations"] = [];

  for (const service of feature.services) {
    const paths = featureSpecPaths(feature.dir, service);
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
          requiredOperations.push({ service, operationId });
        }
      }
    }

    if (existsSync(paths.openapi)) {
      const featureOperations = await operations(paths.openapi, context);
      for (const operation of featureOperations) {
        if (operation.remove) requiredOperations.push({ service, operationId: operation.id });
        else introducedOperations.push({ service, operationId: operation.id });
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
  const facts = await Promise.all(features.map((feature) => readFacts(feature, context)));
  const requirementOwners = new Map<string, Set<string>>();
  const operationOwners = new Map<string, Set<string>>();

  for (const fact of facts) {
    for (const added of fact.addedRequirements) {
      for (const identity of reqKeys(added.requirement)) {
        addOwner(requirementOwners, reqIndexKey(added.service, added.axis, identity), fact.feature.id);
      }
    }
    for (const operation of fact.introducedOperations) {
      addOwner(operationOwners, opIndexKey(operation.service, operation.operationId), fact.feature.id);
    }
  }

  const edgeMap = new Map<string, DependencyEdge>();
  for (const fact of facts) {
    for (const changed of fact.changedRequirements) {
      for (const identity of reqKeys(changed.requirement)) {
        for (const owner of requirementOwners.get(reqIndexKey(changed.service, changed.axis, identity)) ?? []) {
          appendReason(edgeMap, fact.feature.id, owner, {
            kind: "requirement",
            service: changed.service,
            axis: changed.axis,
            identity,
          });
        }
      }
    }
    for (const required of fact.requiredOperations) {
      for (const owner of operationOwners.get(opIndexKey(required.service, required.operationId)) ?? []) {
        appendReason(edgeMap, fact.feature.id, owner, {
          kind: "operation",
          service: required.service,
          operationId: required.operationId,
        });
      }
    }
  }

  let edges = [...edgeMap.values()]
    .map((edge) => ({ ...edge, reasons: edge.reasons.sort(compareReasons) }))
    .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to));

  const conflicts: FeatureConflict[] = [];
  for (const [key, owners] of requirementOwners) {
    if (owners.size < 2) continue;
    const [service, axis, identity] = key.split("\0") as [string, SpecAxis["file"], string];
    conflicts.push({
      kind: "requirement",
      service,
      axis,
      identity,
      features: [...owners].sort(compareIds),
    });
  }
  for (const [key, owners] of operationOwners) {
    if (owners.size < 2) continue;
    const [service, identity] = key.split("\0") as [string, string];
    conflicts.push({
      kind: "operation",
      service,
      identity,
      features: [...owners].sort(compareIds),
    });
  }
  conflicts.sort((a, b) =>
    compareIds(a.kind, b.kind)
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
