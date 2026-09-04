/**
 * The service's OWN part of a per-service project — derived, because LikeC4
 * does not record it.
 *
 * Measured at the 1.59.2 pin: `$data.views[id]` carries a `sourcePath` and
 * `$data.elements[fqn]` carries NO source-document field at all. So after the
 * map and one extending model have been parsed together there is nothing in the
 * parse output that says which of the two files declared a given element. The
 * answer has to be reconstructed, and this module is the reconstruction: DIFF
 * the project against the architecture-alone load, and resolve what is left
 * through the same element→service resolver every fleet check already joins on.
 *
 * Why it matters that this is exact rather than approximate: every model-
 * dependent check reads the slice as if it were the standalone file it used to
 * read — `c4.no-relationships`, `health.dependency-unmodelled`, `Covers:`
 * resolution, the attested-call scan. Too WIDE and a service is graded against
 * the whole fleet map (every service would suddenly have relationships, and
 * every dependency would resolve). Too NARROW and a service that models its
 * partners correctly is told it models nothing.
 */
import { properAncestorIds } from "../../kernel/ids/fqn/ancestors.js";
import type { Elem, LoadedDoc, Rel } from "../likec4.js";
import { serviceResolver } from "../resolve/service.js";

/** What one service owns inside a project that also holds the fleet map. */
export interface OwnSlice {
  /** The service's own elements, plus the partner elements its own edges point at. */
  elements: Elem[];
  /** Only the relationships this model added — the project's, minus the map's. */
  relationships: Rel[];
  /** Elements this model added OUTSIDE its own element: the `c4.element-unowned` set. */
  unowned: Elem[];
}

export interface SliceRequest {
  /** The per-service project: the architecture documents and this model, parsed together. */
  project: LoadedDoc;
  /** The same architecture documents parsed WITHOUT the model — the diff's other half. */
  architecture: LoadedDoc;
  /** The `services/<…>/<id>` directory name this model belongs to. */
  service: string;
  /** Every service directory that exists, so an edge into a modelled container resolves to its owner. */
  known: ReadonlySet<string>;
}

/**
 * A relationship's identity for the DIFF, and every field of it is one loam
 * already reads somewhere.
 *
 * There is no id to join on: LikeC4 mints relationship ids per parse, so the
 * same edge in two loads of overlapping document sets is two different ids.
 * Endpoints alone are not enough either — a fleet may draw two edges between
 * the same pair (`api -> kafka 'publishes'` and `api -> kafka 'consumes'`), and
 * collapsing them would let a model silently inherit one of the map's. So the
 * key is everything a check can branch on: the endpoints, the label, and the
 * three metadata keys plus the tag set, sorted because tag order is authoring
 * order and means nothing.
 */
function relKey(rel: Rel): string {
  return JSON.stringify([
    rel.source,
    rel.target,
    rel.title ?? "",
    rel.op ?? "",
    rel.publishes ?? "",
    rel.consumes ?? "",
    [...rel.tags].sort(),
  ]);
}

/**
 * The service's own slice of a per-service project.
 *
 * OWN is resolution PLUS NESTING, and the second half is not a widening for
 * convenience — it is the only thing that keeps a model's own file from being
 * filtered against it.
 *
 * Resolution first: every project element whose id resolves to this service,
 * whether the model added it or the map already declared it. The bound element
 * itself has to be in — a standalone model declared it, and every check that
 * reads "the service's elements" expects it.
 *
 * Then nesting, because resolution alone ejects a child the author wrote INSIDE
 * their own `extend` block. `serviceResolver`'s second rung answers with the
 * nearest ancestor whose TITLE names a real `services/<id>/` directory, and that
 * rung sees the child before it sees the parent: a container written as
 * `store = database 'db'` under `extend svcA { … }` resolves to a service called
 * `db` the moment some other team has adopted one, and svcA's own element is
 * bound by title only. The model then reported one element fewer than it
 * declares, a `Covers: svcA.store` line was convicted as a typo, and
 * `c4.element-unowned` told the author their own container belonged in somebody
 * else's model. A standalone model was never filtered against its own file at
 * all, so every one of those is a regression the second shape introduced.
 *
 * So: an OWN ROOT is an own element none of whose proper ancestors is own — the
 * element the author actually extended — and everything nested under one is own
 * too. Id nesting under the extended element is evidence nobody had to guess at,
 * and it outranks a title guess. It does NOT outrank an explicit
 * `metadata { service '…' }` binding, which is a claim somebody wrote down: a
 * map that nests one service's element inside another's keeps both on the right
 * side of the line.
 *
 * OWN RELATIONSHIPS are the diff: the project's edges minus the ones the
 * architecture documents already have. Resolution cannot decide this one, and
 * the reason is the whole point of the fleet map: the map is where cross-service
 * edges live, so `checkoutWeb -> paymentService` resolves to this service at one
 * end and must NOT become part of the model's own relationships — otherwise
 * every service would be graded as declaring calls it never wrote, and
 * `landscape.service-isolated` (which asks whether the map's edges and the
 * model's agree) would be answering about itself.
 *
 * The diff is a MULTISET difference, not a set one, and that distinction is the
 * whole grade for a model that agrees with the map. A model may legitimately
 * draw an edge the map also draws, spelled identically —
 * `marketplace.paymentService -> stripe 'Authorizes cards'` — and under a set
 * difference every such edge would vanish from the model's own list. Then
 * `attestedCalls` finds no attested call, `landscape.service-isolated` reports a
 * service that talks to nobody, the adopt brief's `landscape.attested` list
 * comes back empty and `c4.no-relationships` fires on a model full of edges. So
 * each structural key drops `min(architecture, project)` occurrences and the
 * rest are the model's: one copy in the map cancels exactly one copy here.
 *
 * PARTNERS are the endpoints of the model's own edges that lie outside the
 * service, AND every ancestor of such an endpoint that the project holds. The
 * ancestors are not tidiness: a standalone model had to declare `kafka` in order
 * to draw an edge at `kafka.orderEvents`, and health.yaml names the dependency
 * `kafka`. Dropping the ancestor would turn a fleet's dependency declarations
 * into `health.dependency-unmodelled` findings the day it migrated its models,
 * with nothing in the docs having changed.
 *
 * UNOWNED is what the model added outside its own element — present in the
 * project, absent from the architecture load, and resolving to somebody else. A
 * new top-level element (`ledger` beside the map's systems) and a child added
 * under another service's element both land here, and both are things the map
 * or the other service should be declaring instead.
 */
export function sliceForService(input: SliceRequest): OwnSlice {
  const resolve = serviceResolver(input.project.elements, input.known);
  const byId = new Map(input.project.elements.map((e) => [e.id, e]));
  const ownIds = new Set(
    input.project.elements.filter((e) => resolve(e.id) === input.service).map((e) => e.id),
  );
  // The elements the author extended: own, with nothing own above them. Frozen
  // before the loop below adds anything, so a child pulled in by nesting cannot
  // itself become a root and widen the set a second time.
  const roots = [...ownIds].filter((id) => !properAncestorIds(id).some((up) => ownIds.has(up)));
  for (const element of input.project.elements) {
    if (ownIds.has(element.id)) continue;
    if (!roots.some((root) => element.id.startsWith(`${root}.`))) continue;
    // The one thing nesting does not outrank. An explicit binding anywhere at or
    // above this element names its service outright, and a map that files one
    // service's element under another's would otherwise hand the outer service
    // every element of the inner one.
    if (boundServiceOf(element.id, byId) !== undefined) continue;
    ownIds.add(element.id);
  }

  // One budget per structural key: the map's copies cancel the project's, one
  // for one, and what the budget does not cover is the model's own.
  const budget = new Map<string, number>();
  for (const rel of input.architecture.relationships) {
    const k = relKey(rel);
    budget.set(k, (budget.get(k) ?? 0) + 1);
  }
  const relationships = input.project.relationships.filter((rel) => {
    const k = relKey(rel);
    const left = budget.get(k) ?? 0;
    if (left === 0) return true;
    budget.set(k, left - 1);
    return false;
  });

  const partnerIds = new Set<string>();
  for (const rel of relationships) {
    for (const endpoint of [rel.source, rel.target]) {
      if (ownIds.has(endpoint)) continue;
      for (const id of [endpoint, ...properAncestorIds(endpoint)]) {
        if (byId.has(id) && !ownIds.has(id)) partnerIds.add(id);
      }
    }
  }

  // Project order for both lists, never the order ids happened to be
  // discovered in: the elements of a service are printed, counted and diffed,
  // and a set that reorders itself between two runs of the same command is a
  // diff nobody can read.
  const archElementIds = new Set(input.architecture.elements.map((e) => e.id));
  return {
    elements: input.project.elements.filter((e) => ownIds.has(e.id) || partnerIds.has(e.id)),
    relationships,
    unowned: input.project.elements.filter((e) => !archElementIds.has(e.id) && !ownIds.has(e.id)),
  };
}

/**
 * The nearest explicit `metadata { service '…' }` binding at or above an id, or
 * undefined when nothing on the chain declares one.
 *
 * `serviceResolver`'s first rung, asked on its own — because the caller above
 * needs to tell that rung's answer apart from the two guesses below it, and the
 * resolver returns one `DeclaredService` for all three. A binding is a claim
 * somebody wrote down; a title match is evidence, and a bare title is a guess.
 */
function boundServiceOf(id: string, byId: ReadonlyMap<string, Elem>): string | undefined {
  for (const candidate of [id, ...properAncestorIds(id)]) {
    const bound = byId.get(candidate)?.service;
    if (bound !== undefined) return bound;
  }
  return undefined;
}
