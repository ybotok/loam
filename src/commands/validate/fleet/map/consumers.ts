/**
 * Who consumes a drawn element — and the datastore grade that reads the answer.
 *
 * The census used to walk the MAP's relationships alone, and under the extending
 * shape that is a partial view of the fleet: a service draws the container-level
 * call in its own `model.likec4` and the map carries the service-level twin, so a
 * store whose consuming edges were all drawn in models had ZERO consumers and
 * was graded on the one service the map happened to draw (R1). A model is
 * evidence about the fleet exactly as the map is, so both are counted here,
 * once, by one derivation two checks share.
 *
 * WHERE A STORE LIVES IS THE TEAM'S CHOICE, and this module used to say the
 * opposite at length. Nested under the element that resolves to its owner — in
 * that service's `extend <fqn> { store = database … }` block, or inside its
 * element on the map — and drawn as a fleet-level PEER are both first-class
 * placements, and loam grades neither as wrong. `landscape.datastore-private`
 * existed to push every one-consumer store into the first, its whole message a
 * prescription to delete the peer; it is retired (2026-09-07), the arm below is
 * gone, and no message here prescribes a move.
 *
 * What survives the retirement is the one CONSEQUENCE, which is a fact about
 * LikeC4 rather than a preference: a per-service project is `architecture/` plus
 * that ONE model, so an edge naming `<owner-fqn>.<store>` resolves for a SECOND
 * service only when the MAP declares the store. Written in the owner's `extend`
 * block instead, the same edge is two errors on the consumer's own model
 * ("Could not resolve reference to Referenceable named 'store'"). That is the
 * load-bearing half, it is stated by `reversibility` below where it actually
 * bites, and SCHEMA carries the same sentence.
 *
 * The choice is cheap, and the surviving message says exactly HOW cheap, because
 * "reversible" was false in the one state that used to assert it. The two
 * placements do give the store the same id, `<owner-fqn>.<store>` — but the
 * move is only free in ONE direction once a second service names it. Measured
 * on `examples/docs`: moving `db` out of order-service's `extend` block into
 * `orderService` on the map left the model at 12 elements · 8 relationships,
 * left `Covers: marketplace.orderService.db` in its arch.spec.md resolving, and
 * left checkout-web's container-level edge to it resolving too. Moving it BACK
 * with that second edge drawn is two errors on checkout-web's own model
 * ("Could not resolve reference to Referenceable named 'db'"), or
 * `landscape.invalid` plus one `spine.landscape-invalid` per service when the
 * second edge is drawn on the map — because an `extend` block is visible to its
 * own service's project alone. `datastore-shared` printed the unconditional
 * clause in 100% of the states it fires in, every one of which already has the
 * second consumer that makes map→extend break (verification 2026-09-04). So the
 * rule the message states is directional: extend→map is always safe; map→extend
 * only while no other service's model or map edge names the store.
 *
 * A sub-package of `fleet/` for `./isolation.ts`'s reason and with its rule: it
 * imports NOTHING from `fleet/`, so the map facts it reads arrive on the input
 * records the caller fills.
 */
import { type Elem, type Rel } from "../../../../core/c4/likec4.js";
import { infrastructureKind } from "../../../../core/c4/resolve/direction.js";
import { DATASTORE_KIND } from "../../../../core/vocabulary/maturity.js";
import { type Finding } from "../../../../core/vocabulary/report.js";
import { type AttestedModel, type NestedStore } from "./attest.js";

export interface CensusInput {
  /** The map's own edges — a service-level twin is what the map carries of a container-level call. */
  relationships: Rel[];
  /** Every element the map declares, at any depth: what says an endpoint is infrastructure. */
  elements: Elem[];
  /** The services/<id>/ directories that exist: a consumer is an edge's other end filed under a real one. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
  /** `census.ts`'s predicate, for `DatastoreInput.standsForService`'s reason: a bound `database` is a service, not infrastructure. */
  standsForService: (e: Elem) => boolean;
  /** What each service's own model attests (`./attest.ts`). */
  attested: readonly AttestedModel[];
}

/**
 * Distinct consumer SERVICES of an element, its nested children included: an
 * edge into `kafka.paymentEvents` is consumption of `kafka`.
 *
 * Two kinds of evidence, unioned. From the MAP: a relationship whose target is
 * the element or a descendant and whose source the shared resolver files under a
 * real `services/<id>/` — persons, other external systems and unresolved sources
 * never count, and two edges from one service are one consumer. From the
 * MODELS: a service whose own model attests an OUTBOUND call at the element or a
 * descendant.
 *
 * EITHER DIRECTION, where the element's end of the edge is infrastructure
 * (`infrastructureKind` in core/c4/resolve/direction.ts, among the elements
 * that stand for no service). A
 * database, a topic or a bucket never initiates anything, so an edge between it
 * and a service says that the service uses it, whichever way the arrow points.
 * Fleets draw a read both ways, as a call (`service -> store`) or as the data's
 * flow (`store -> service`), and loam's own event doctrine draws every consumer
 * as `topic -> service`. The census used to read only the edges INTO the
 * element, so a reader drawn as data flow stopped counting: the second
 * consumer of a shared store vanished and `landscape.datastore-shared` with
 * it, and a broker's consumers were never counted toward
 * `landscape.platform-candidate` at all, which made the "three of our services
 * reach it" in `examples/docs` false.
 * Elsewhere the direction still means something (an external system calling
 * INTO the fleet is not one the callee consumes), so it is still read there.
 * The model half follows the same rule: an INBOUND attested call counts when
 * its counterpart is infrastructure.
 *
 * The model half reads EXTENDING models only, and the reason is the id space. An
 * extending model's ids are the map's fully-qualified ids — one project — so the
 * join is exact. A standalone model's ids are its own file's, and
 * `core/c4/resolve/attested.ts` says outright that a counterpart is never
 * matched to a landscape element: joining one would file a coincidence of
 * spelling as a coupling between two services.
 */
export function consumerCensus(input: CensusInput): (elementId: string) => string[] {
  const reaches = (elementId: string, id: string): boolean => id === elementId || id.startsWith(`${elementId}.`);
  const infraKindOf = infrastructureKind(input.elements.filter((e) => !input.standsForService(e)));
  const isInfra = (id: string): boolean => infraKindOf(id) !== undefined;
  return (elementId: string): string[] => {
    const out = new Set<string>();
    const count = (id: string): void => {
      const svc = input.resolve(id);
      if (input.services.has(svc)) out.add(svc);
    };
    for (const r of input.relationships) {
      if (reaches(elementId, r.target)) count(r.source);
      else if (reaches(elementId, r.source) && isInfra(r.source)) count(r.target);
    }
    for (const model of input.attested) {
      if (!model.extending) continue;
      const uses = model.calls.some(
        (c) => reaches(elementId, c.counterpartId) && (c.direction === "out" || isInfra(c.counterpartId)),
      );
      if (uses) out.add(model.service);
    }
    return [...out].sort();
  };
}

export interface DatastoreInput {
  /** Service-LEVEL elements — the fleet map's own boxes, where a store drawn as a peer is found. */
  drawn: Elem[];
  /** Every element the MAP declares, at any depth — the other place a nested store is written. */
  elements: Elem[];
  /** Stores an extending model declares inside its own element (`./attest.ts`). */
  nestedStores: readonly NestedStore[];
  /** The services/<id>/ directories that exist. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver, for naming the consumer's own element on the map. */
  resolve: (id: string) => string;
  /**
   * `census.ts`'s one predicate for "this element stands for a `services/<id>/`",
   * injected because a `fleet/map/` module may not import `fleet/`. Both halves
   * of the grade below skip such an element: it is the fleet itself, not its
   * shape, and a store bound to a directory is the binding checks' subject.
   * `./attest.ts` applies the same predicate to the stores a MODEL declares, so
   * all three places answer it once.
   */
  standsForService: (e: Elem) => boolean;
  /** The census above, built once and shared with the platform-candidate advisory. */
  consumers: (elementId: string) => string[];
}

/**
 * A datastore two or more services reach is the strongest coupling two services
 * can have and the hardest to undo, which deserves to be STATED rather than
 * inferred. That is the whole of this grade now, and it applies to both
 * placements alike: a fleet-level peer and a store nested under its owner earn
 * the same `landscape.datastore-shared` at two consumers, and neither is graded
 * at one.
 *
 * The one-consumer arm is gone (2026-09-07). A fleet-level peer with a single
 * consumer used to be `landscape.datastore-private` — "drawn as a peer it reads
 * as a system in its own right … delete this peer" — which made WHERE a store is
 * drawn a restriction rather than the team's choice. It was never a fact about
 * the fleet: the same store, nested, was silent, so the finding graded the
 * drawing and not the architecture. The nested half was ALREADY silent at one
 * consumer, and it is that half's rule that now holds for both.
 */
export function datastoreFindings(input: DatastoreInput): Finding[] {
  const findings: Finding[] = [];
  for (const e of input.drawn) {
    // An element that stands for a real service is the fleet itself, not its
    // shape; a datastore bound to a directory is graded by the binding checks.
    if (input.standsForService(e)) continue;
    if (e.kind.toLowerCase() !== DATASTORE_KIND) continue;
    const consumers = input.consumers(e.id);
    // One consumer is a store that service owns, drawn where the team chose to
    // draw it — a fact about the map's layout, not about the fleet. Zero is a
    // store nothing reaches, which was never graded here either.
    if (consumers.length < 2) continue;
    findings.push(sharedFinding(e.title, consumers, "", ""));
  }
  for (const store of nestedStoresOf(input)) {
    // The owner is a consumer by construction — the store sits inside the element
    // that resolves to it — so silence at one consumer IS the fixed state, and
    // the only question left is whether a second service reaches the same data.
    const consumers = [...new Set([store.owner, ...input.consumers(store.fqn)])].sort();
    if (consumers.length < 2) continue;
    findings.push(
      sharedFinding(
        store.title,
        consumers,
        // The store's own id, and said as such. The clause read "nested under
        // '<fqn>'", which sends a reader looking for an element that HOLDS the
        // store — when that id IS the store, and its container is its prefix.
        ` — ${store.owner}'s own store, written as '${store.fqn}'`,
        reversibility(store, consumers.filter((c) => c !== store.owner)),
      ),
    );
  }

  return findings;
}

/**
 * Every store nested under the element that resolves to its owner, from both
 * places the stance allows one to be written: inside the service's element ON
 * THE MAP, and in the service's own extending model. Keyed by fqn, so a
 * map-declared store — which the owner's model slice carries too, since a slice
 * is everything resolving to the service — is one store and not two.
 *
 * Both sources are needed and neither is redundant. The map's covers a service
 * whose model is standalone or absent (no slice to read); the model's covers a
 * store the map never draws, which is the placement the adopt brief prescribes.
 */
function nestedStoresOf(input: DatastoreInput): NestedStore[] {
  const drawnIds = new Set(input.drawn.map((e) => e.id));
  const byFqn = new Map<string, NestedStore>();
  for (const e of input.elements) {
    if (e.kind.toLowerCase() !== DATASTORE_KIND || drawnIds.has(e.id)) continue;
    // The peer branch's guard, which this half was missing: a `database` bound
    // with `metadata { service '<id>' }` and drawn one level down became a store
    // "owned" by its own binding, so a second reader made it a shared datastore
    // and the fix offered was to give each service its own copy of a service.
    if (input.standsForService(e)) continue;
    const owner = input.resolve(e.id);
    if (!input.services.has(owner)) continue;
    byFqn.set(e.id, { owner, fqn: e.id, title: e.title });
  }
  for (const store of input.nestedStores) if (!byFqn.has(store.fqn)) byFqn.set(store.fqn, store);
  return [...byFqn.values()];
}

/**
 * Which way the store may still be moved, now that a second service reaches it.
 *
 * The clause this replaces said the two placements were interchangeable — "the
 * two placements give it the same id … so moving the declaration between them
 * rewrites no edge" — and that is false in every state `datastore-shared` fires
 * in, because the finding needs a second consumer and a second consumer's edge
 * resolves only against a store the MAP declares (a per-service project is
 * `architecture/` plus one model). Measured: performing the move the sentence
 * called free turned a clean `examples/docs` into `c4.invalid` on the consumer's
 * model, or into `landscape.invalid` + one `spine.landscape-invalid` per service
 * when the second edge is on the map (verification 2026-09-04).
 *
 * The direction is stated rather than the current placement, and it holds
 * either way round: out of the owner's `extend` block onto the map is always
 * safe, back in is not while another service names the store. (In practice a
 * store this finding reaches is one the MAP declares — a second consumer's edge
 * cannot resolve against an `extend` block, so it could never have been drawn
 * — which is the same fact said from the other side.)
 */
function reversibility(store: NestedStore, others: string[]): string {
  const named = others.length === 1 ? `${others[0]!}'s edge` : `${others.join(", ")}'s edges`;
  return (
    `. Both placements give it the same id, ${store.fqn}, but with a second consumer the move is ONE-WAY: ` +
    `${named} resolves only against a declaration the MAP holds — a per-service project is \`architecture/\` ` +
    `plus one model, so an \`extend\` block is visible to its own service's project alone. Out of ` +
    `${store.owner}'s \`extend\` block onto ${store.owner}'s element on the map is always safe; moving it ` +
    `back INTO the \`extend\` block breaks that edge — \`c4.invalid\` on the other service's model, or ` +
    `\`landscape.invalid\` when the edge is drawn on the map`
  );
}

/** The two-or-more message, shared by the peer and the nested store — one word about coupling, once. */
function sharedFinding(title: string, consumers: string[], where: string, tail: string): Finding {
  return {
    severity: "warn",
    code: "landscape.datastore-shared",
    subject: title,
    message:
      `landscape: '${title}' is a datastore shared by ${consumers.length} services ` +
      `(${consumers.join(", ")})${where} — the strongest coupling two services can have, and the ` +
      `hardest to undo. Shared means the same DATA: if they read the same tables or keys, keep it ` +
      `where it is and let this warning state the coupling; if they only share a host or cluster ` +
      `(two schemas, two lock paths), that is operational blast radius — a runbook fact — and the ` +
      `honest model is one private store per service${tail}`,
  };
}
