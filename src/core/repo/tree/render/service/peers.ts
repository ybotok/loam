/**
 * The NEIGHBOUR SET of one service: every element the map draws an edge to or
 * from, computed by loam rather than asked of the renderer.
 *
 * This module exists because of a measurement, and the measurement is the whole
 * reason the per-service view is not three wildcard lines. At likec4 1.59.2, on
 * a 120-service map whose services are nested in `group` boxes, the obvious
 * recipe
 *
 *     include *
 *     include <fqn> -> *
 *     include * -> <fqn>
 *
 * drew the GROUP BOXES as the counterparts — `growth`, `catalog`, `support`,
 * `notifications` — instead of the peer services, and NONE of them carried
 * drill-down. LikeC4 resolves a counterpart at the highest ancestor that is not
 * also an ancestor of the subject, so on any map that groups its services —
 * which is exactly what a fleet past about thirty services needs at fleet
 * level — the wildcard form says "payments/service-0 talks to the growth group"
 * and navigates nowhere. It looks perfect on a five-service FLAT fixture, which
 * is how it would have shipped.
 *
 * Re-measured here at 1.59.2 on the 58-service / 11-group fleet, subject
 * `payments.svc0` with 8 real peers: the wildcard recipe draws 10 nodes of which
 * four are group boxes; naming the peers draws 11 — the subject, its `api`, its
 * `db` and all 8 peers, each at its own level, each carrying `navigateTo` into
 * that peer's own generated view (6 of the 8 are services and have one; the
 * customer and the broker are not).
 *
 * The counterpart is taken AS THE MAP DECLARES IT — an edge landing on
 * `kafka.orderEvents` names the topic, not the broker — because that is the
 * truer picture and it is the one the map already draws. Anything the render
 * substituted here would be loam re-drawing somebody's architecture.
 */
import type { Rel } from "../../../../c4/likec4.js";

/**
 * Every element on the far side of an edge touching this service, sorted and
 * de-duplicated.
 *
 * "Touching" is the subject OR any descendant of it: an edge into
 * `svc.api` is an edge into the service, and the view that hid it would be
 * lying about the service's surface. The far endpoint is dropped when it is
 * itself the subject or one of its descendants — that is INTERIOR, already
 * drawn by the view's own `include *`, and naming it again would put a second
 * include line in the file for a node that is already there.
 *
 * Sorted and de-duplicated because the generated file is a pure function of
 * committed bytes: document order is the parse's, not the author's, and two
 * edges between the same pair must not emit the same include twice.
 */
export function peersOf(fqn: string, relationships: readonly Rel[]): string[] {
  const prefix = `${fqn}.`;
  const own = (id: string): boolean => id === fqn || id.startsWith(prefix);
  const found = new Set<string>();
  for (const rel of relationships) {
    if (own(rel.source) && !own(rel.target)) found.add(rel.target);
    if (own(rel.target) && !own(rel.source)) found.add(rel.source);
  }
  return [...found].sort();
}
