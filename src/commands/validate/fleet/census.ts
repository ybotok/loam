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
import { ACTOR_KINDS, EXTERNAL_TAG } from "../../../core/vocabulary/maturity.js";

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
  /** Declared ancestors of an element, nearest first. */
  const ancestorsOf = (e: Elem): Elem[] => {
    const out: Elem[] = [];
    for (let dot = e.id.lastIndexOf("."); dot !== -1; dot = e.id.lastIndexOf(".", dot - 1)) {
      const parent = byId.get(e.id.slice(0, dot));
      if (parent !== undefined) out.push(parent);
    }
    return out;
  };
  return elements.filter((e) => !ancestorsOf(e).some((p) => standsForService(p, services)));
}

/**
 * The drawn SYSTEMS: service-level elements minus everything the map itself
 * says is not a service. Actor kinds model people; `#external` is somebody
 * else's system; and an element that CONTAINS a service is a grouping — a
 * domain, a boundary, an enterprise — not a service nobody adopted. There is
 * nothing to bind on a grouping and nothing to tag #external, so asking for
 * either would be a warning with no correct fix; the services under it answer
 * for themselves. `validateLandscape`'s undocumented pass walks this set, and
 * the scorecard's `c4.elements` census counts it — one predicate, two readers,
 * zero drift.
 *
 * The `#external` skip here is exactly what `./kind-tags.ts` guards: read off a
 * tag a KIND declared, it can empty this census for a whole fleet at once.
 */
export function drawnSystems(elements: Elem[], services: ReadonlySet<string>): Elem[] {
  return serviceLevelElements(elements, services).filter(
    (e) =>
      !e.tags.includes(EXTERNAL_TAG) &&
      !ACTOR_KINDS.has(e.kind.toLowerCase()) &&
      !elements.some((c) => c.id.startsWith(`${e.id}.`) && standsForService(c, services)),
  );
}
