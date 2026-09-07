/**
 * The fleet map's census: which drawn elements answer for a `services/<id>/`.
 *
 * Three predicates, in one place because every exemption in the fleet target,
 * the scorecard's `c4.elements` count and the kind-tag check all have to answer
 * the same question the same way — a second spelling of "is this element a
 * service" is how a map and a rollup start disagreeing about the same fleet.
 * They lived in `./landscape.ts` beside their first reader until that file hit
 * its line limit; the seam was already there, since nothing here reads a file,
 * emits a finding, or knows what a target is.
 */
import { type Elem } from "../../../core/c4/likec4.js";
import { properAncestorIds } from "../../../core/kernel/ids/fqn/ancestors.js";
import { ACTOR_KINDS, EXTERNAL_TAG, INFRA_KINDS } from "../../../core/vocabulary/maturity.js";

/**
 * Does this element stand for a `services/<id>/` directory — an explicit
 * `metadata { service }` binding, or a title naming a real one? The question
 * every exemption in `./landscape.ts`, the scorecard's census and
 * `./kind-tags.ts` all ask, exported so they cannot answer it differently.
 */
export function standsForService(e: Elem, services: ReadonlySet<string>): boolean {
  return e.service !== undefined || services.has(e.title);
}

/**
 * Service-LEVEL elements: everything not drawn inside something that is
 * already a service.
 *
 * Depth is not a fact about a service. This used to keep only top-level
 * elements (`!e.id.includes(".")`), which ordinary C4 breaks the moment it
 * groups services under a parent: every nested element was thrown away, so a
 * bound service read as unmodelled — an ERROR, on every service in the fleet
 * — and a binding written one level down was never checked at all. The tree
 * is walked instead, the way `serviceResolver` walks it for edges: a binding
 * wins at any depth, then a title naming a real services/<id>/, and what sits
 * INSIDE one of those is that service's container, not a service of its own.
 */
export function serviceLevelElements(elements: Elem[], services: ReadonlySet<string>): Elem[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  /**
   * The ancestors this document actually DECLARES, nearest first. The chain
   * itself is `core/kernel/ids/fqn/ancestors.ts`'s — the one spelling of it —
   * and the filter is this function's own: an id may name a level nothing
   * declares, and an undeclared level answers for no service.
   */
  const ancestorsOf = (e: Elem): Elem[] =>
    properAncestorIds(e.id).flatMap((id) => {
      const parent = byId.get(id);
      return parent === undefined ? [] : [parent];
    });
  return elements.filter((e) => !ancestorsOf(e).some((p) => standsForService(p, services)));
}

/**
 * The drawn SYSTEMS: service-level elements minus everything the map itself
 * says is not a service. Actor kinds model people; INFRA kinds model the
 * datastores, queues and buckets the fleet RUNS; `#external` is somebody
 * else's system; and an element that CONTAINS a service is a grouping — a
 * domain, a boundary, an enterprise — not a service nobody adopted. There is
 * nothing to bind on a grouping and nothing to tag #external, so asking for
 * either would be a warning with no correct fix; the services under it answer
 * for themselves. `validateLandscape`'s undocumented pass walks this set, and
 * the scorecard's `c4.elements` census counts it — one predicate, two readers,
 * zero drift.
 *
 * The INFRA skip is the newest and the one with a measured cost behind it. A
 * `database` the fleet OWNS and draws at fleet level is neither a person nor
 * somebody else's system, so it used to earn `landscape.service-undocumented`
 * — "bind it with `metadata { service '<id>' }`, or tag it `#external`" —
 * whose two remedies are both FALSE of it: there is no directory to bind, and
 * it is ours. Measured on a one-service fixture drawing an owned `database` at
 * fleet level (2026-09-07): that warning plus `landscape.datastore-private`
 * plus `gate.partner-undocumented` on its one consumer, three findings and no
 * correct fix, which is why both `examples/docs` and this repo's own suite
 * tagged an owned Redis `#external` to buy silence.
 *
 * `standsForService` wins over the kind, and that guard is load-bearing rather
 * than defensive: a `database` bound with `metadata { service '<id>' }`, or one
 * whose title names a real `services/<id>/`, IS an adopted service — dropping
 * it here would take it out of the scorecard's `c4.elements` denominator and
 * out of the binding passes at once. The kind is the fallback for an element
 * nothing else answers for, never an override.
 *
 * The `#external` skip here is exactly what `./kind-tags.ts` guards: read off a
 * tag a KIND declared, it can empty this census for a whole fleet at once. The
 * INFRA skip is NOT guarded there and does not need to be — a kind is what an
 * element already is, not a claim declared over the fleet, and `#infrastructure`
 * is deliberately not a tag loam grades on (`GRADED_TAGS`).
 */
export function drawnSystems(elements: Elem[], services: ReadonlySet<string>): Elem[] {
  return serviceLevelElements(elements, services).filter(
    (e) =>
      !e.tags.includes(EXTERNAL_TAG) &&
      !ACTOR_KINDS.has(e.kind.toLowerCase()) &&
      !(INFRA_KINDS.has(e.kind.toLowerCase()) && !standsForService(e, services)) &&
      !elements.some((c) => c.id.startsWith(`${e.id}.`) && standsForService(c, services)),
  );
}
