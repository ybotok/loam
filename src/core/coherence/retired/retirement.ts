/**
 * What ONE contract delta retires — the rule, spelled once for every reader
 * that asks it.
 *
 * Two readers ask it of different features, and they must never disagree. The
 * feature gate asks it of the delta being graded (`../declared.ts` for the
 * OpenAPI axis, `../events/declared.ts` for the event axis): which operations
 * and messages is THIS feature taking out of the living contract. The retired
 * index (`./archived.ts`) asks the same question of every feature already in
 * `features/archive/`: which operations and messages did a shipped feature take
 * out, so a later delta spelling one of them is a revival rather than an
 * addition. A second spelling of the relocation rule in the index is how a
 * moved endpoint would read as retired there while the gate called it moved.
 *
 * Moved here from the two walks verbatim, comments and all; the walks keep the
 * checks that USE the sets, this module keeps the sets.
 */
import type { Operation } from "../../openapi/doc.js";
import type { AsyncapiSlot } from "../../asyncapi/digest.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";

/** The OpenAPI half: every id a removal marker names, and the ones genuinely retired. */
export interface OperationRetirements {
  /** Every operationId a removal marker names, relocations included — "did the author write a marker". */
  markerIds: Set<string>;
  /** Markers minus relocations — "is this operation going away". */
  net: Set<string>;
}

/**
 * A relocation — same operationId, removal marker on the old slot, upsert on
 * the new one — retires nothing. Every rule that asks "is this operation going
 * away" must therefore ask the NET set (markers this feature does not
 * redefine), while "did the author write a marker at all" asks the raw one.
 * Conflating them made moving an endpoint fail three checks at once for a
 * change that removes nothing.
 *
 * A marker with no `operationId` is not here at all: the reader lists it apart
 * (`anonymousRemovals`), and the merge deletes a living operation only when the
 * one at the marker's own method and path carries the id the marker names — a
 * marker naming none matches nothing, so it retires nothing either. That match
 * is also why a marker is a REQUEST rather than a record: one that missed its
 * slot deleted nothing, and the retired index (./archived.ts) checks each
 * against the contract its merge ran against before counting it.
 */
export function operationRetirements(ops: readonly Operation[]): OperationRetirements {
  const redefined = new Set(ops.filter((op) => !op.remove).map((op) => op.id));
  const markerIds = new Set(ops.filter((op) => op.remove).map((op) => op.id));
  const net = new Set([...markerIds].filter((id) => !redefined.has(id)));
  return { markerIds, net };
}

/** The event half's four sets — the raw marker shapes, the redeclarations, and what is genuinely going away. */
export interface MessageRetirements {
  /** Names a `components.messages` marker retires, relocations included. */
  markerNames: Set<string>;
  /** Names the LIVING contract declares inline under a channel this delta removes. */
  inlineRetired: Set<string>;
  /** Names the delta declares again, anywhere — a marker on one of these is a relocation. */
  redeclared: Set<string>;
  /** `markerNames ∪ inlineRetired`, minus `redeclared`. */
  net: Set<string>;
}

/**
 * A relocation — same message name, marker on the old key, declaration at a
 * new one — retires nothing. "Is this message going away" asks the NET set;
 * "did the author write a marker" asks the raw one, the OpenAPI distinction
 * above verbatim. Two raw sets, because the two marker shapes carry different
 * debts: a message-slot marker must be justified by a REMOVED requirement,
 * while a channel-slot removal needs exactness only (requirements join on
 * message names, never channel keys — SCHEMA.md) and its living inline
 * interior leaves with it.
 *
 * `living` is the contract the delta was merged INTO (or is about to be): a
 * channel removal's inline interior is written there and nowhere in the delta,
 * which carries only the marker. The feature gate passes the living contract
 * on disk; the retired index passes the archived feature's snapshot pre-image,
 * the living contract as it stood the moment that merge ran.
 */
export function messageRetirements(
  featDoc: AsyncapiDoc,
  featSlots: readonly AsyncapiSlot[],
  living: AsyncapiDoc,
): MessageRetirements {
  const markerNames = new Set(
    featDoc.messages.filter((m) => m.remove === true && m.slot.startsWith("components.messages.")).map((m) => m.name),
  );
  const channelRemovals = featSlots.filter((s) => s.section === "channels" && s.remove).map((s) => s.key);
  const inlineRetired = new Set(
    living.messages
      .filter((m) => channelRemovals.some((ck) => m.slot.startsWith(`channels.${ck}.messages.`)))
      .map((m) => m.name),
  );
  const redeclared = new Set(featDoc.messages.filter((m) => m.remove !== true).map((m) => m.name));
  const net = new Set([...markerNames, ...inlineRetired].filter((name) => !redeclared.has(name)));
  return { markerNames, inlineRetired, redeclared, net };
}
