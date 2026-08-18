/**
 * The active-feature dependency graph: who has to archive before whom.
 *
 * A feature depends on another when it MODIFIES or REMOVES a requirement the
 * other adds, or calls an operation the other introduces — the two ways one
 * delta can only apply after another has landed. This module is the walk that
 * puts `./facts.ts` and `./graph.ts` together; the reasons it attaches to each
 * edge are what makes the answer explainable rather than merely true.
 */
import { inOrder } from "../kernel/concurrency.js";
import { FleetContext } from "../fleet-context.js";
import { compareIds } from "../repo/entries.js";
import { listFeatures } from "../repo/repo.js";
import {
  addOwner,
  opIndexKey,
  readFacts,
  reqIndexKey,
  reqKeys,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyNode,
  type FeatureConflict,
  type OpAt,
  type Owners,
  type ReqAt,
} from "./facts.js";
import { appendReason, compareReasons, dependencyFirstOrder, stronglyConnected } from "./graph.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** Derive the complete active-feature graph, or one feature and its transitive prerequisites. */
export async function analyzeDependencies(
  docsDir: DocsDir,
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

  // `Set<string>`, not the ids' own brand: `DependencyEdge.from`/`to` are plain
  // strings, and the reassignment below rebuilds the set from a caller's
  // argument.
  let selected = new Set<string>(features.map((feature) => feature.id));
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
