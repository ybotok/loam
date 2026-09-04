/**
 * Who consumes a drawn element — and the datastore grades that read the answer.
 *
 * The census used to walk the MAP's relationships alone, and under the extending
 * shape that is a partial view of the fleet: a service draws the container-level
 * call in its own `model.likec4` and the map carries the service-level twin, so a
 * store whose consuming edges were all drawn in models had ZERO consumers and
 * earned nothing at all, while a store reached by three models and one map edge
 * was reported `landscape.datastore-private` naming the one service the map
 * happened to draw (R1). A model is evidence about the fleet exactly as the map
 * is, so both are counted here, once, by one derivation two checks share.
 *
 * WHERE A PRIVATE STORE LIVES, stated once because three surfaces used to answer
 * it differently: a store one service owns is NESTED UNDER THAT SERVICE'S
 * ELEMENT — in the service's extending model (`extend <fqn> { store = database
 * … }`), or inside the service's element on the map when the map draws that
 * service's containers. A second service reaching it later is drawn where that
 * service draws every other call: a container-level edge in ITS model naming
 * `<owner-fqn>.<store>`, carried up to the map as a service-level edge to the
 * owning service. Nothing moves back, and nothing goes ungraded — a nested store
 * two services reach is `landscape.datastore-shared` here (E3).
 *
 * WHICH OF THE TWO PLACEMENTS, and this is measured rather than assumed: a
 * per-service project is `architecture/` plus that ONE model, so an edge naming
 * `<owner-fqn>.<store>` resolves for the second service only when the MAP
 * declares the store. Written in the owner's `extend` block instead, the same
 * edge is two errors on the consumer's own model ("Could not resolve reference
 * to Referenceable named 'store'"), so that store is private for good and its
 * second consumer can only ever be drawn at service level. The message below
 * says so; SCHEMA carries the same sentence.
 *
 * The choice is cheap, and both messages now say exactly HOW cheap, because
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
 * rule both messages now state is directional: extend→map is always safe;
 * map→extend only while no other service's model or map edge names the store.
 *
 * And the remedy is named for the consumer's own model SHAPE rather than
 * assumed: `extend <fqn>` in a STANDALONE model (one that declares its own
 * `specification`) resolves nothing, because such a model is parsed alone — so
 * prescribing it there turns a clean run into `c4.invalid`. The shape comes off
 * the same `./attest.ts` record the consumer join reads.
 *
 * A sub-package of `fleet/` for `./isolation.ts`'s reason and with its rule: it
 * imports NOTHING from `fleet/`, so the map facts it reads arrive on the input
 * records the caller fills.
 */
import { type Elem, type Rel } from "../../../../core/c4/likec4.js";
import { type Finding } from "../../../../core/vocabulary/report.js";
import { type AttestedModel, type NestedStore } from "./attest.js";

/** The element kind read as a datastore, compared case-insensitively. */
const DATASTORE_KIND = "database";

export interface CensusInput {
  /** The map's own edges — a service-level twin is what the map carries of a container-level call. */
  relationships: Rel[];
  /** The services/<id>/ directories that exist: a consumer is a source filed under a real one. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
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
 * The model half reads EXTENDING models only, and the reason is the id space. An
 * extending model's ids are the map's fully-qualified ids — one project — so the
 * join is exact. A standalone model's ids are its own file's, and
 * `core/c4/resolve/attested.ts` says outright that a counterpart is never
 * matched to a landscape element: joining one would file a coincidence of
 * spelling as a coupling between two services.
 */
export function consumerCensus(input: CensusInput): (elementId: string) => string[] {
  const reaches = (elementId: string, id: string): boolean => id === elementId || id.startsWith(`${elementId}.`);
  return (elementId: string): string[] => {
    const out = new Set<string>();
    for (const r of input.relationships) {
      if (!reaches(elementId, r.target)) continue;
      const svc = input.resolve(r.source);
      if (input.services.has(svc)) out.add(svc);
    }
    for (const model of input.attested) {
      if (!model.extending) continue;
      if (model.calls.some((c) => c.direction === "out" && reaches(elementId, c.counterpartId))) {
        out.add(model.service);
      }
    }
    return [...out].sort();
  };
}

/** What loam actually read at a consumer's own `model.likec4`, which decides where a store may be nested. */
export type ConsumerShape = "extending" | "standalone" | null;

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
  /** What each service's own model attests (`./attest.ts`) — the consumer join AND the shape the remedy names. */
  attested: readonly AttestedModel[];
  /** The census above, built once and shared with the platform-candidate advisory. */
  consumers: (elementId: string) => string[];
  /** Where a service's directory sits, repo-relative — the enumeration's answer, never `services/<id>`. */
  pathOf: (id: string) => string;
}

/**
 * A datastore drawn as a fleet-level peer makes a claim its consumer count
 * either supports or refutes: one consumer means the drawing is false — the
 * store is that service's internals, not a system in its own right — while two
 * or more mean the strongest coupling two services can have, which deserves to
 * be stated rather than inferred. A NESTED store is private by construction, so
 * it is silent at one consumer and earns the same `datastore-shared` at two.
 */
export function datastoreFindings(input: DatastoreInput): Finding[] {
  const findings: Finding[] = [];
  for (const e of input.drawn) {
    // An element that stands for a real service is the fleet itself, not its
    // shape; a datastore bound to a directory is graded by the binding checks.
    if (input.standsForService(e)) continue;
    if (e.kind.toLowerCase() !== DATASTORE_KIND) continue;
    const consumers = input.consumers(e.id);
    if (consumers.length === 0) continue;
    findings.push(
      consumers.length === 1 ? privateFinding(e, consumers[0]!, input) : sharedFinding(e.title, consumers, "", ""),
    );
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

/**
 * Where the store goes, named for the consumer's own model SHAPE — which this
 * sentence used to assert instead of reading. It always prescribed the
 * extending-shape remedy, and following it on a standalone consumer turns a
 * clean run into `c4.invalid`: a model that declares its own `specification` is
 * parsed alone, so `extend <fqn>` there resolves nothing at all (measured — one
 * error, "Could not resolve reference to Element named '<fqn>'"). The two
 * placements otherwise give the store the SAME id, which is the fact that makes
 * the choice cheap: measured on examples/docs, moving `db` out of
 * order-service's extend block into `orderService` on the map left the model at
 * 12 elements · 8 relationships, left `Covers: marketplace.orderService.db` in
 * its arch.spec.md resolving, and left checkout-web's edge to it resolving too.
 */
function placement(at: { fqn: string; local: string; path: string; shape: ConsumerShape }): string {
  // Direction, not symmetry. The clause used to read "moving the declaration
  // between them later rewrites no edge", which is true only while this store
  // has ONE consumer — the state this finding is in — and false the moment the
  // second consumer it goes on to promise arrives: that consumer's edge resolves
  // against the map's declaration alone. Saying it unconditionally here is what
  // made `datastore-shared` inherit a sentence that was false in every state it
  // printed in (verification 2026-09-04).
  const same =
    `the two placements give it the same id, ${at.fqn}.${at.local}, and with one consumer either move ` +
    `is free — out of the \`extend\` block onto the map always is, and back into it while no other ` +
    `service's model or map edge names the store, an \`extend\` block being visible to its own service's ` +
    `project alone`;
  if (at.shape === "extending") {
    return (
      `A store one service owns is nested UNDER that service's element: write it in the ` +
      `\`extend ${at.fqn} { … }\` block of ${at.path}, or inside '${at.fqn}' here when the map draws ` +
      `that service's containers, and delete this peer — ${same}.`
    );
  }
  // The two absent-extending-model arms differ in what there is to do: a
  // STANDALONE model exists and can be migrated; with no model at all there is
  // nothing to migrate, and "migrate the model" sent a reader looking for a file
  // loam had just said it could not find (verification 2026-09-04).
  const otherwise =
    at.shape === "standalone"
      ? `${at.path} declares its own \`specification\`, so it is parsed alone and \`extend ${at.fqn}\` ` +
        `resolves nothing there`
      : `loam read no extending model at ${at.path}`;
  const migrate =
    at.shape === "standalone"
      ? `migrate the model to the extending shape (SCHEMA.md, "Two shapes of a service model")`
      : `write an extending model at ${at.path} (SCHEMA.md, "Two shapes of a service model")`;
  return (
    `A store one service owns is nested UNDER that service's element, and this consumer has no ` +
    `extending model to nest it in (${otherwise}): write it inside '${at.fqn}' here, where the map draws ` +
    `that service's containers, and delete this peer — or ${migrate} and write it in an ` +
    `\`extend ${at.fqn} { … }\` block there, where ${same}.`
  );
}

/**
 * The one-consumer message, and it names the PLACEMENT rather than a directory:
 * the remedy used to read "move it into services/<id>/model.likec4 as a nested
 * container, or add the second consumer's edge", which offered two remedies as
 * equals and left the second one impossible — an edge naming the moved store is
 * `landscape.invalid` for loam, so an author who took the first remedy believed
 * they had shut the second door (#01). They had not, and the sentence now says
 * how: a later consumer is drawn in ITS OWN model, and loam counts that — as
 * long as that model EXTENDS the map, which the caveat below is careful to say.
 */
function privateFinding(store: Elem, consumer: string, input: DatastoreInput): Finding {
  const fqn = input.drawn.find((e) => input.resolve(e.id) === consumer)?.id ?? consumer;
  const local = store.id.split(".").at(-1) ?? store.id;
  const model = input.attested.find((m) => m.service === consumer);
  const shape: ConsumerShape = model === undefined ? null : model.extending ? "extending" : "standalone";
  return {
    severity: "warn",
    code: "landscape.datastore-private",
    subject: store.title,
    message:
      `landscape: '${store.title}' is a datastore with a single consumer at fleet level ` +
      `('${consumer}') — drawn as a peer it reads as a system in its own right, available to be ` +
      `depended on. ${placement({ fqn, local, path: `${input.pathOf(consumer)}/model.likec4`, shape })} ` +
      `Nesting closes no door: a second service reaching the same data later draws a container-level ` +
      `edge to ${fqn}.${local} in ITS OWN model plus a service-level edge to '${fqn}' here, and loam ` +
      `counts a consumer an EXTENDING model attests exactly as it counts one drawn here — so that ` +
      `state is \`landscape.datastore-shared\`, never silence. A consumer whose model stands alone is ` +
      `not counted (its ids are its own file's, never the map's), so its edge belongs on the map. ` +
      `Which placement: that edge RESOLVES only against a store the map declares (a per-service ` +
      `project is architecture/ plus one model), so ` +
      (shape === "extending"
        ? `nest it here when a second consumer is foreseeable and in the model when it is not. `
        : `the map is the placement that keeps that door open. `) +
      `If another service reaches the same data today, draw its edge and this becomes that warning now`,
  };
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
