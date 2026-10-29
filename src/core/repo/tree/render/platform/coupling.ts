/**
 * The async edges of a platform's inside view — the one thing in that picture
 * LikeC4 cannot draw on its own.
 *
 * The spine draws an event producer → topic → consumer ("THE ARROW FOLLOWS THE
 * MESSAGE", SCHEMA), and LikeC4 never draws an edge THROUGH an element a view
 * leaves out. Measured at the 1.59.2 pin on a three-subsystem probe: a view of
 * the subsystem boxes with the topic left out kept the lifted synchronous call
 * and showed the subsystem that only consumes as unconnected. The inside view
 * leaves every topic out by design, so without these edges it hides exactly the
 * coupling it is drawn to show.
 *
 * Derived from what the spine already reads, never from prose, and in two ways:
 *
 *  - BY MESSAGE KEY — a `publishes` edge and a `consumes` edge naming the same
 *    message, through whatever carries it: a topic, a broker drawn as one
 *    system, or a carrier of each kind. Named by the message. The key binds the
 *    end the spine binds — `publishes` its edge's SOURCE, `consumes` its
 *    TARGET — so a consume edge drawn the wrong way round (which
 *    `spine.message-unbound` already warns about) makes nobody a producer.
 *  - THROUGH A CHANNEL — an element of kind `topic` or `queue` — where at least
 *    one of the two edges carries no key. Every box with an edge INTO it is a
 *    producer and every box with an edge OUT of it a consumer, and the pair is
 *    named by the channel, because sharing a channel is all the drawing says.
 *    An edge into a channel whose only key is `consumes`, or out of one whose
 *    only key is `publishes`, is drawn backwards and counts on neither side.
 *
 * A pair is drawn only where LikeC4 would draw nothing: the two ends are
 * different boxes, and the element the message passes through is inside NO box
 * — a topic nested inside the producer's box already lifts the consumer's edge
 * to the two boxes, and a second edge there would say the same thing twice.
 *
 * AND ONLY BETWEEN TWO GROUPS — boxes that hold services without standing for
 * one — never at a service, a person or an external system. A relationship is
 * model content: it is drawn in EVERY view that includes both of its ends, not
 * in the one it was derived for. Between two subsystem groups that is the
 * platform's inside and the parent views that draw groups as boxes — pictures
 * that leave the topic out too. Between two SERVICES it is every per-service
 * overview and every hand-drawn view naming either: measured on `examples/docs`,
 * whose services sit directly in the root, three derived edges surfaced in a
 * per-service view, a subsystem view and an authored view. A pair at any other
 * box is counted for the file's disclosure line instead.
 *
 * What none of this can see is coupling drawn as plain edges to a broker, with
 * no key and no channel element: a broker in the middle says that two services
 * share infrastructure, not that one depends on the other, and pairing every
 * service that touches it would draw a star of edges the map never claimed.
 */
import type { Elem, Rel } from "../../../../c4/likec4.js";
import { within } from "./scope.js";

/** One derived edge: producer group → consumer group, and the names it carries. */
export interface CoupledPair {
  source: string;
  target: string;
  /** Sorted, distinct: messages where the keys say which, channels where they do not. */
  names: string[];
}

/** The pairs to draw, and how many distinct box pairs were left out because one end was not a group. */
export interface Coupling {
  pairs: CoupledPair[];
  outsideGroups: number;
}

/** The boxes of one inside view, and the ones among them that are subsystem groups. */
export interface Boxes {
  boxes: readonly string[];
  groups: readonly string[];
}

/** The kinds that stand between a producer and a consumer — SCHEMA's channel, never its server. */
const CHANNEL_KINDS = new Set(["topic", "queue"]);

/** One side of a pairing: the box at that end, and the message its edge names, if any. */
interface End {
  box: string;
  message: string | null;
}

/** How to read one side off an edge: which edges count, which end is the box, which key names the message. */
interface Side {
  picks: (r: Rel) => boolean;
  endOf: (r: Rel) => string;
  messageOf: (r: Rel) => string | undefined;
}

/** The producing side reads an edge's source and its `publishes`; the consuming side its target and `consumes`. */
const producing = (picks: (r: Rel) => boolean): Side => ({ picks, endOf: (r) => r.source, messageOf: (r) => r.publishes });
const consuming = (picks: (r: Rel) => boolean): Side => ({ picks, endOf: (r) => r.target, messageOf: (r) => r.consumes });

/** An edge whose only key binds the OTHER end — drawn backwards for the side asking. */
const onlyConsumes = (r: Rel): boolean => r.consumes !== undefined && r.publishes === undefined;
const onlyPublishes = (r: Rel): boolean => r.publishes !== undefined && r.consumes === undefined;

export function coupling(view: Boxes, elements: readonly Elem[], relationships: readonly Rel[]): Coupling {
  const boxOf = (id: string): string | null => view.boxes.find((box) => within(id, box)) ?? null;
  const groups = new Set(view.groups);
  const pairs = new Map<string, CoupledPair>();
  const outside = new Set<string>();
  const add = (from: string, to: string, name: string): void => {
    if (from === to) return;
    const key = `${from}\0${to}`;
    if (!groups.has(from) || !groups.has(to)) {
      outside.add(key);
      return;
    }
    const pair = pairs.get(key) ?? { source: from, target: to, names: [] };
    if (!pair.names.includes(name)) pair.names.push(name);
    pairs.set(key, pair);
  };
  // A carrier inside a box is visible already: LikeC4 lifts its edges to that box.
  const hidden = (carrier: string): boolean => boxOf(carrier) === null;

  const producers = ends(relationships, producing((r) => r.publishes !== undefined && hidden(r.target)), boxOf);
  const consumers = ends(relationships, consuming((r) => r.consumes !== undefined && hidden(r.source)), boxOf);
  for (const p of producers) {
    for (const c of consumers) if (p.message !== null && p.message === c.message) add(p.box, c.box, p.message);
  }

  for (const channel of elements.filter((e) => CHANNEL_KINDS.has(e.kind.toLowerCase()) && hidden(e.id))) {
    const into = ends(relationships, producing((r) => r.target === channel.id && !onlyConsumes(r)), boxOf);
    const outOf = ends(relationships, consuming((r) => r.source === channel.id && !onlyPublishes(r)), boxOf);
    for (const p of into) {
      // Both keyed: the key pairing above already answered, by the message.
      for (const c of outOf) if (p.message === null || c.message === null) add(p.box, c.box, channel.title === "" ? channel.id : channel.title);
    }
  }

  const drawn = [...pairs.values()]
    .map((pair) => ({ ...pair, names: [...pair.names].sort() }))
    .sort((a, b) => (a.source === b.source ? (a.target < b.target ? -1 : 1) : a.source < b.source ? -1 : 1));
  return { pairs: drawn, outsideGroups: outside.size };
}

/** The box-resolved ends of every edge one side picks, each with the message the edge names. */
function ends(relationships: readonly Rel[], side: Side, boxOf: (id: string) => string | null): End[] {
  const found: End[] = [];
  for (const r of relationships) {
    if (!side.picks(r)) continue;
    const box = boxOf(side.endOf(r));
    if (box !== null) found.push({ box, message: side.messageOf(r) ?? null });
  }
  return found;
}
