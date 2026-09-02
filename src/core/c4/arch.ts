/**
 * The architecture spec axis — the grammar and resolution of `Covers:` — and
 * the same endpoint join, reused, for the steps of a use case.
 *
 * A business spec will never mention the transactional outbox; that is
 * architecture, and it lives in `arch.spec.md` — same requirement/scenario
 * grammar as spec.md, same delta algebra, same merge. What is new is the
 * `Covers:` line: where a business requirement declares the OPERATIONS it
 * governs, an architecture requirement declares the MODEL OBJECTS its
 * scenarios exercise, so coverage can be derived mechanically instead of
 * trusted to an author who was never going to write the outbox down.
 *
 * Four entry forms, resolved against the documents loam already reads:
 *
 *   paymentService.db               a C4 element id — resolved against the
 *                                   in-scope elements the way every check joins
 *                                   them: the id itself, or the service the
 *                                   element stands for (binding, then title);
 *   paymentService -> kafka         an edge — each side resolved the same way,
 *                                   against the declared relationships;
 *   alert:<id> / sli:<id>           a health signal — ids `health.yaml`
 *                                   declares (core/vocabulary/health.ts);
 *   node:<id>, node:a -> node:b     a deployment object — a node or an instance
 *                                   in the landscape's `deployment { }` model,
 *                                   matched literally. This is the form that
 *                                   lets a requirement about replication name
 *                                   the two clusters it is written about
 *                                   (ROADMAP's deployment axis).
 *
 * Resolution never reads code. An entry that resolves to nothing is the typo
 * guard (`covers.unknown`, warn); the emitters live with the other validate
 * checks, this module owns only the grammar and the matching.
 *
 * `attributeStep` used to sit at the foot of this file and now lives in
 * `./resolve/steps.ts`. It answers the same shape of question for a different
 * axis — which declared relationship backs a `dynamic view`'s hop — over the
 * same two tiers and the same cached resolver, and the seam was named here long
 * before the line limit forced it. What the two still share is
 * `./resolve/service.ts`'s `resolverFor`, which is where that cache moved with
 * it: one id→service resolver per document, serving both axes.
 */
import { type Elem, type Rel } from "./likec4.js";
import type { DeploymentModel } from "./parsed/deployment.js";
import { elementService, resolverFor } from "./resolve/service.js";
import type { HealthIds } from "../vocabulary/health.js";

export type CoversEntry =
  | { form: "element"; id: string; raw: string }
  | { form: "edge"; source: string; target: string; raw: string }
  | { form: "alert" | "sli"; id: string; raw: string }
  /**
   * A deployment object — `node:eu.dcA.k8sA`, and the edge form
   * `node:a -> node:b`. One prefix covers deployment NODES and the INSTANCES
   * inside them, because both are places on the same map and a requirement
   * about replication names an instance as readily as a datacenter. A second
   * prefix for the second kind would make an author pick between two spellings
   * for one question, and pick wrong.
   */
  | { form: "node"; id: string; raw: string }
  | { form: "node-edge"; source: string; target: string; raw: string };

/** Parse one comma-separated `Covers:` entry into its form. Never fails: an
 * unclassifiable string is an element entry that will not resolve, and the
 * covers.unknown message is a better diagnosis than a parse refusal. */
export function parseCoversEntry(raw: string): CoversEntry {
  const alert = /^alert:\s*(.+)$/.exec(raw);
  if (alert) return { form: "alert", id: alert[1]!.trim(), raw };
  const sli = /^sli:\s*(.+)$/.exec(raw);
  if (sli) return { form: "sli", id: sli[1]!.trim(), raw };
  const edge = /^(.+?)\s*->\s*(.+)$/.exec(raw);
  if (edge) {
    const source = edge[1]!.trim();
    const target = edge[2]!.trim();
    const from = nodeId(source);
    const to = nodeId(target);
    // BOTH sides, or neither. A mixed entry stays an ordinary edge whose
    // prefixed side then resolves to nothing — which is the honest answer:
    // there is no edge in any model with one endpoint in the logical map and
    // one in the deployment map, so accepting a half-prefixed line would be
    // inventing a join rather than reading one. The `->` split runs FIRST for
    // the same reason the alert/sli tests do: `node:a -> node:b` read as a
    // single id would be one entry that can never resolve.
    if (from !== undefined && to !== undefined) return { form: "node-edge", source: from, target: to, raw };
    return { form: "edge", source, target, raw };
  }
  const node = nodeId(raw);
  if (node !== undefined) return { form: "node", id: node, raw };
  return { form: "element", id: raw, raw };
}

/** The id behind a `node:` prefix, or nothing when the entry does not carry one. */
function nodeId(text: string): string | undefined {
  const m = /^node:\s*(.+)$/.exec(text);
  return m === null ? undefined : m[1]!.trim();
}

/**
 * What `Covers:` entries resolve against: every element and relationship in
 * view (a service's own model plus the landscape; for a feature, the delta
 * plus both), and the health ids of the service whose spec is being read.
 */
export interface CoverageScope {
  elements: Elem[];
  relationships: Rel[];
  /**
   * The fleet's topology, for the `node:` forms — the LANDSCAPE's deployment
   * model and no other, even though a service's own `model.likec4` may legally
   * declare one. Topology is a fleet-level fact for the reason a cross-service
   * flow is: `architecture/` is the one place that already holds every edge
   * crossing two services, and a per-service deployment block would let two
   * documents disagree about where one container runs with nothing able to say
   * which is right. Absent for every fleet that draws none, which is what makes
   * a `node:` entry there resolve to nothing and report the typo.
   */
  deployment?: DeploymentModel;
  health: HealthIds;
  /**
   * The enumerated fleet (plus the feature's own `specs/` names, where the
   * caller has them). The Covers matcher resolves edge ENDPOINTS with it, and
   * it must be the SAME set the caller's own findings resolve with: the finding
   * says "write `Covers: checkout-web -> payment-service`" with the fleet in
   * hand, and a matcher resolving without it answered that exact line with
   * `covers.unknown` whenever the edge landed on a modelled container.
   */
  known?: ReadonlySet<string>;
}

/** Does an element entry name this element? Its id, or the service it stands for. */
function namesElement(name: string, e: Elem): boolean {
  return e.id === name || elementService(e) === name;
}

/** Does an edge entry's side name this relationship endpoint? */
function namesEndpoint(
  name: string,
  endpointId: string,
  elements: Elem[],
  known?: ReadonlySet<string>,
): boolean {
  return endpointId === name || resolverFor(elements, known)(endpointId) === name;
}

/** Does a Covers entry match this element? (Only element entries can.) */
export function coversElement(entry: CoversEntry, e: Elem): boolean {
  return entry.form === "element" && namesElement(entry.id, e);
}

/** Does a Covers entry match this relationship? Endpoints resolved within `elements`, through `known` where the caller has the fleet. */
export function coversEdge(entry: CoversEntry, r: Rel, elements: Elem[], known?: ReadonlySet<string>): boolean {
  return (
    entry.form === "edge" &&
    namesEndpoint(entry.source, r.source, elements, known) &&
    namesEndpoint(entry.target, r.target, elements, known)
  );
}

/** Does the entry resolve to ANYTHING in scope? False is `covers.unknown`. */
export function entryResolves(entry: CoversEntry, scope: CoverageScope): boolean {
  switch (entry.form) {
    case "alert":
      return scope.health.alerts.includes(entry.id);
    case "sli":
      return scope.health.slis.includes(entry.id);
    case "edge":
      return scope.relationships.some((r) => coversEdge(entry, r, scope.elements, scope.known));
    case "element":
      return scope.elements.some((e) => coversElement(entry, e));
    case "node":
      return deployedIds(scope).includes(entry.id);
    case "node-edge":
      // Endpoints matched literally, and only literally. The logical forms
      // resolve a name through `serviceResolver` because an author writes
      // `checkout-web -> payment-service` about an edge the model draws between
      // two containers; a deployment id is already the exact path to one place
      // on the map, there is no coarser name for it, and inventing one would
      // make `node:eu.dcA` silently match an edge between two clusters inside
      // it.
      return (scope.deployment?.relationships ?? []).some(
        (r) => r.source === entry.source && r.target === entry.target,
      );
  }
}

/** Every deployment object a `node:` entry may name: the nodes, and the instances in them. */
function deployedIds(scope: CoverageScope): string[] {
  const d = scope.deployment;
  if (d === undefined) return [];
  return [...d.nodes.map((n) => n.id), ...d.instances.map((i) => i.id)];
}

/** Ids a covers.unknown hint may offer for a mistyped entry — always real ones. */
export function coversCandidates(entry: CoversEntry, scope: CoverageScope): string[] {
  switch (entry.form) {
    case "alert":
      return closeIds(entry.id, scope.health.alerts).map((id) => `alert:${id}`);
    case "sli":
      return closeIds(entry.id, scope.health.slis).map((id) => `sli:${id}`);
    case "edge":
    case "node-edge":
      // Cheap on purpose: no pairwise edge fuzzing — the sides are element
      // names, so the element hint is the useful one.
      return [];
    case "element":
      return closeIds(entry.id, [...new Set(scope.elements.map((e) => e.id))]);
    case "node":
      // Offered WITH the prefix, because that is the line the author has to
      // type. A hint spelling an id the grammar would then read as an element
      // entry is a hint that sends the reader round the loop a second time.
      return closeIds(entry.id, [...new Set(deployedIds(scope))]).map((id) => `node:${id}`);
  }
}

/**
 * Existing ids near a misspelling — substring containment either way, else a
 * shared 3-character prefix. Deliberately dumb: no fuzzy library for one hint,
 * and every id offered is real, so the hint can never point at the typo itself.
 * (Moved here from validate.ts once `covers.unknown` became its second user.)
 */
export function closeIds(typo: string, ids: readonly string[]): string[] {
  const t = typo.toLowerCase();
  return ids
    .filter((id) => {
      const i = id.toLowerCase();
      return i.includes(t) || t.includes(i) || (t.length >= 3 && i.startsWith(t.slice(0, 3)));
    })
    .slice(0, 5);
}

