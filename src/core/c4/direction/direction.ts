/**
 * How loam reads which way a relationship points: which end each event key
 * binds, and which endpoints are infrastructure, whose direction carries no
 * meaning. SCHEMA.md's "Which way an edge points" lists every reader; the two
 * rules here are the ones more than one reader shares.
 *
 * `metadata { publishes }` binds the edge's SOURCE: a service produces what its
 * own asyncapi.yaml declares an `action: send` for. `metadata { consumes }`
 * binds its TARGET. THE ARROW FOLLOWS THE MESSAGE, producer to topic and topic
 * to consumer, and the event spine is not the only reader of that arrow: review
 * order's fan-in (`core/dependencies/fanin.ts`) and a use case's hop backing
 * read the same drawing. That is why a key on the wrong end is REPORTED rather
 * than re-bound to whichever end happens to be a service. Re-binding a reversed
 * consume edge to its source would make the spine agree with a drawing every
 * other reader still takes the opposite way, and on an edge between two fleet
 * services nothing can tell which end the author meant.
 *
 * Through 0.2.0-alpha.10 a key on the wrong end was skipped without a word, at
 * service scope and feature scope alike. The document validated, the metadata
 * parsed, and the spine graded one link fewer; the `event.covered` count was
 * the only trace. `spine.message-unbound` names that silence. Both scopes read
 * the binding from `eventKeys` below, so the rule is written down once.
 *
 * It is a question about the resolved model (which endpoint of an edge a key
 * belongs to, and what kind of thing that endpoint is), which is why it sat in
 * `../resolve/` beside `external.ts` until that package reached six files. It
 * was the one module there that resolves no service itself: the caller's
 * `serviceResolver` (`../resolve/service.ts`) is what turns an endpoint into a
 * service, so the edge reading stands as a package of its own.
 */
import { ancestorIds } from "../../kernel/ids/fqn/ancestors.js";
import { INFRA_KINDS } from "../../vocabulary/maturity.js";
import { type Elem, type Rel } from "../likec4.js";

/** One event key on one edge, with the endpoint it binds and the one it does not. */
export interface EventKey {
  direction: "publishes" | "consumes";
  message: string;
  /** The endpoint the key binds: the source for `publishes`, the target for `consumes`. */
  bound: string;
  /** The other endpoint. */
  other: string;
}

/**
 * Every event key a relationship carries, each with the endpoint it binds. One
 * edge may carry both keys: a producer drawn straight to its consumer, with no
 * broker on the map, publishes from its source and is consumed at its target.
 */
export function eventKeys(r: Rel): EventKey[] {
  const keys: EventKey[] = [];
  if (r.publishes !== undefined) keys.push({ direction: "publishes", message: r.publishes, bound: r.source, other: r.target });
  if (r.consumes !== undefined) keys.push({ direction: "consumes", message: r.consumes, bound: r.target, other: r.source });
  return keys;
}

/**
 * The infrastructure kind an endpoint belongs to — its own, or the nearest
 * ancestor's among `INFRA_KINDS` — or undefined for any other element. A table
 * nested in a `database` is part of the database, so the ancestors count.
 *
 * Infrastructure never initiates and never decides anything: a database, a
 * topic or a bucket neither calls nor publishes nor consumes. That one fact
 * answers two readers. The consumer census reads an edge between a service and
 * infrastructure as the service USING it, whichever way the arrow points. And
 * an event key bound to infrastructure is a key on the wrong end of its edge,
 * since a topic is the thing between a producer and a consumer and never
 * either of them.
 *
 * The limitation is `INFRA_KINDS`'s own: the hook is a kind NAME, so a broker
 * drawn as a plain `softwareSystem` is not infrastructure here, exactly as it
 * is not for `landscape.service-undocumented`. Callers pass the elements that
 * may count. The census leaves out an element that stands for a service, which
 * is a service whatever its kind.
 */
export function infrastructureKind(elements: readonly Elem[]): (id: string) => string | undefined {
  const kinds = new Map<string, string>();
  for (const e of elements) {
    const kind = e.kind.toLowerCase();
    if (INFRA_KINDS.has(kind)) kinds.set(e.id, kind);
  }
  return (id: string): string | undefined => {
    for (const a of ancestorIds(id)) {
      const kind = kinds.get(a);
      if (kind !== undefined) return kind;
    }
    return undefined;
  };
}

/**
 * Why a key binds nothing and how the edge is drawn so it does. A caller raises
 * it only when the bound end is infrastructure (`infrastructureKind`) and the
 * other end is a service of the fleet. Both halves of that test matter, and the
 * first is deliberately narrower than "the bound end is no service". An
 * `#external` system at the bound end is a party outside the fleet, and a key
 * there says something true: `crm -> billingService` carrying `publishes` is an
 * outside producer, which the producer question accepts
 * (`./external.ts`, `spine.message-external`), and a `consumes` on an outside
 * system is an outside consumer. Turning either round would be wrong. An edge
 * whose bound end IS a service is graded against that service's contract, so a
 * wrong drawing there already surfaces as `spine.message-undefined`.
 *
 * The fix is the same reversal for both keys: `consumes` wants the consumer at
 * the target and `publishes` wants the producer at the source, so the edge as
 * it should be drawn is the drawn edge turned round. Unless the edge carries
 * BOTH keys: a service that publishes one message to a topic and consumes
 * another from it, drawn as one arrow, always has one key on the topic, so
 * turning the arrow round only moves the warning to the other key. The key at
 * fault then goes onto an edge of its own, and the sentence says so.
 */
export function unboundSentence(r: Rel, key: EventKey, kind: string): string {
  const end = key.direction === "publishes" ? "SOURCE" : "TARGET";
  const both = r.publishes !== undefined && r.consumes !== undefined;
  const fix = both
    ? `the edge carries both keys, so one arrow cannot serve them: move ${key.direction} '${key.message}' onto an ` +
      `edge of its own, ${r.target} -> ${r.source}`
    : `draw it ${r.target} -> ${r.source}`;
  return (
    `edge ${r.source} -> ${r.target} carries ${key.direction} '${key.message}', but \`${key.direction}\` binds the ` +
    `edge's ${end}, and ${key.bound} is a ${kind}, which neither publishes nor consumes. The key binds nothing, so ` +
    `no contract is checked against it. The arrow follows the message (producer to topic, topic to consumer): ${fix}`
  );
}
