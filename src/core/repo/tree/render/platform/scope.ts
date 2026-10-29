/**
 * What the two platform views draw, read off the parsed map: the ROOT each pair
 * is about, the boxes of its inside view, and the elements around it.
 *
 * A root is a TOP-LEVEL element that holds at least one service without
 * standing for one, or for a subsystem — the boundary a grouped map draws its own fleet inside
 * (`examples/docs`' `marketplace`, a pilot fleet's one group around its eighteen
 * subsystem groups). "Holds a service" is the element→service join every other
 * generated view resolves through (`../body.ts`'s `renderContext`), handed in as
 * the set of element ids it bound, so a box the platform views draw and a box
 * the subsystem views draw are the same element. A map with no such element has
 * no platform to draw, and the render answers null — a fact the sync report
 * states, never a finding: presence is never owed (docs/DESIGN.md rule 26).
 *
 * INFRASTRUCTURE stays out of both views: an element whose kind, or an
 * ancestor's, is one of `INFRA_KINDS`, read by `infrastructureKind`
 * (`core/c4/direction/direction.ts`) — and never an element that stands for a
 * service, whatever its kind, as that helper's callers are told to ensure. That
 * is the user's own sentence about the two altitudes — no databases, no caches,
 * no topics — and the census's vocabulary, so a kind spelled `postgres` is not
 * infrastructure here either (SCHEMA's "Infrastructure" records that limit).
 *
 * Everything is sorted by element id with a plain lexicographic compare, for
 * the reason `../views.ts` gives: the output is part of a byte contract and
 * the ids' own grammar is ASCII.
 */
import { infrastructureKind } from "../../../../c4/direction/direction.js";
import type { Elem, Rel } from "../../../../c4/likec4.js";
import { ancestorIds, parentIdOf } from "../../../../kernel/ids/fqn/ancestors.js";
import { ACTOR_KINDS } from "../../../../vocabulary/maturity.js";

/** One root and everything its two views include. */
export interface PlatformScope {
  /** The root element: top-level, holding a service, standing for none and for no subsystem. */
  root: Elem;
  /** The inside view's boxes: the root's direct children that are not infrastructure. */
  boxes: string[];
  /**
   * The boxes that stand for no service and hold one — the subsystem groups.
   * Only these carry derived edges (`./coupling.ts` says why nothing else can).
   */
  groups: string[];
  /**
   * Everything OUTSIDE the root that an edge joins to something inside it, at
   * the top level of the map — the context view's ring. A person, an external
   * system, a broker; never a top-level element of an infrastructure kind.
   */
  peers: string[];
  /** The people among those edges' outside ends, at their own ids — the inside view's actors. */
  actors: string[];
}

/** Is `id` the element `ancestor` or one nested anywhere beneath it? */
export function within(id: string, ancestor: string): boolean {
  return id === ancestor || id.startsWith(`${ancestor}.`);
}

/**
 * Every root of the map, sorted by id, with what its views include.
 *
 * `subsystems` is the set of elements a generated subsystem view is drawn `of`,
 * and no root is one of them. A map whose top-level groups ARE its subsystems'
 * boxes has no platform boundary drawn, and taking each group for one would mint
 * a second `view … of` the same element in `platform.likec4` — a file that sorts
 * before `subsystems.likec4`, so it would take the group's click from the
 * subsystem view (measured on the subsystem suite's collapsible fleet).
 */
export function platformScopes(
  elements: readonly Elem[],
  relationships: readonly Rel[],
  services: ReadonlySet<string>,
  subsystems: ReadonlySet<string>,
): PlatformScope[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const kindOf = infrastructureKind(elements.filter((e) => !services.has(e.id)));
  const infra = (id: string): boolean => kindOf(id) !== undefined;
  const holdsService = (id: string): boolean => [...services].some((fqn) => within(fqn, id));
  const roots = elements
    .filter((e) => parentIdOf(e.id) === "" && !services.has(e.id) && !subsystems.has(e.id) && holdsService(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return roots.map((root) => {
    const boxes = elements
      .filter((e) => parentIdOf(e.id) === root.id && !infra(e.id))
      .map((e) => e.id)
      .sort();
    const peers = new Set<string>();
    const actors = new Set<string>();
    for (const rel of relationships) {
      const inSource = within(rel.source, root.id);
      const inTarget = within(rel.target, root.id);
      // One end inside and one outside: the edge crosses the boundary. An edge
      // wholly inside is the inside view's own wiring, and LikeC4 lifts it.
      if (inSource === inTarget) continue;
      const outside = inSource ? rel.target : rel.source;
      const top = ancestorIds(outside).at(-1)!;
      if (!infra(top)) peers.add(top);
      const kind = byId.get(outside)?.kind.toLowerCase();
      if (kind !== undefined && ACTOR_KINDS.has(kind)) actors.add(outside);
    }
    const groups = boxes.filter((box) => !services.has(box) && holdsService(box));
    return { root, boxes, groups, peers: [...peers].sort(), actors: [...actors].sort() };
  });
}
