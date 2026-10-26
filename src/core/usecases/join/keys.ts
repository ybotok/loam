/**
 * What a hop asks of the service that answers it, and which of that service's
 * requirements say they answer it — the two halves of the hop join, each
 * reduced to one key.
 *
 * A fleet flow's hop into a service and that service's own flows describe one
 * call at two altitudes. They are separate documents and stay separate: nothing
 * here derives one from the other. What joins them is a key both already carry.
 * The hop's is the operation `attributeStep` attributes to it, or the message
 * its backing relationship's `publishes` or `consumes` metadata names; a
 * requirement's is the same name in its `Operations:`, `Publishes:` or
 * `Consumes:` line. `./inside.ts` takes the last step — the flows whose `#req-`
 * tag claims a requirement holding the hop's key are the hop's inside.
 *
 * ONLY WHERE THE SERVICE ANSWERS. A hop is the addressed service's to unfold
 * when the service is called on it, publishes on it, or is delivered to on it.
 * Where it is the CALLER of somebody else's operation, the key belongs to the
 * other service's contract and none of its own requirements can hold it, so the
 * hop has no inside here at all — not an empty one. The same guard as
 * `hopsExercising`'s (`../operations.ts`): a hop whose two endpoints resolve to
 * one service is that service calling itself, which owes no operation of its
 * own contract.
 *
 * NO GUESS. A contested hop — relationships naming different operations, and a
 * title picking none — joins nothing and says which operations it could be;
 * picking one would put an inside under a hop the map cannot attribute. An
 * unbacked hop has no key, and `usecase.step-unbacked` is already the finding
 * about it.
 */
import { attributeStep } from "../../c4/resolve/steps.js";
import type { ParsedStep } from "../../c4/parsed/dynamic-views.js";
import type { Requirement } from "../../document/spec.js";
import { compareIds } from "../../repo/entries.js";
import type { UseCaseScan } from "../fleet.js";

/**
 * One name both sides carry: the operation a service is called with, or a
 * message it publishes or consumes. The kind is part of the key, because an
 * operation and a message may be spelled alike and are different promises.
 */
export interface HopKey {
  kind: "op" | "publishes" | "consumes";
  name: string;
}

/**
 * What a hop the addressed service answers resolves to, before any flow is
 * looked at.
 *
 * Four variants rather than a record with optional fields, for
 * `StepAttribution`'s reason one join over: `keys` exists only when the backing
 * agrees, `candidates` only when it does not, and a hop nothing backs has
 * neither.
 *
 *  - `keyed` — the backing agrees, and names at least one key on this service's side.
 *  - `keyless` — the backing agrees and names none: an edge with no
 *    `metadata { op }`, a person's use of a system. Nothing can join it.
 *  - `contested` — the relationships name different operations and the title
 *    picks none. `candidates` sorted, `null` — the one that names none — last.
 *  - `unbacked` — nothing in the model backs the hop.
 */
export type HopAnswer =
  | { state: "keyed"; keys: HopKey[] }
  | { state: "keyless" }
  | { state: "contested"; candidates: (string | null)[] }
  | { state: "unbacked" };

/** A key as one string, for a map lookup: the kind and the name, which no operationId or message name can forge. */
export function keyId(key: HopKey): string {
  return `${key.kind} ${key.name}`;
}

/**
 * What one hop asks of `service`, or `null` when the service does not answer it.
 *
 * The scan's own resolver decides which service an endpoint belongs to — the
 * one every other join in the run uses — so a hop drawn into a modelled
 * container `payment.api` is the payment service's hop, never a service called
 * "api".
 */
export function hopAnswer(step: ParsedStep, scan: Extract<UseCaseScan, { kind: "read" }>, service: string): HopAnswer | null {
  const attribution = attributeStep(step, scan.model);
  const from = scan.resolve(attribution.from);
  const called = scan.resolve(attribution.to) === service && from !== service;
  if (attribution.verdict === "unbacked") return called ? { state: "unbacked" } : null;
  if (attribution.verdict === "contested") {
    // Sorted, the one that names none last: the model's relationship order is
    // LikeC4's, and a payload ordered by it would reorder under a dependency bump.
    const candidates = [...attribution.ops].sort((a, b) => (a === undefined ? 1 : b === undefined ? -1 : compareIds(a, b)));
    return called ? { state: "contested", candidates: candidates.map((op) => op ?? null) } : null;
  }
  const keys = new Map<string, HopKey>();
  const add = (key: HopKey): void => {
    keys.set(keyId(key), key);
  };
  if (called && attribution.op !== undefined) add({ kind: "op", name: attribution.op });
  // A message binds the side its key names (`Rel.publishes` / `Rel.consumes`):
  // the producer is the edge's source, the consumer its target. Read per
  // relationship, because on the container tier two edges between one pair may
  // carry two messages, and each is a promise of its own.
  for (const rel of attribution.rels) {
    if (rel.publishes !== undefined && scan.resolve(rel.source) === service) add({ kind: "publishes", name: rel.publishes });
    if (rel.consumes !== undefined && scan.resolve(rel.target) === service) add({ kind: "consumes", name: rel.consumes });
  }
  if (keys.size > 0) return { state: "keyed", keys: [...keys.values()].sort(compareKeys) };
  return called ? { state: "keyless" } : null;
}

/** Kind first, then name — the order a reader scans a short list in. */
export function compareKeys(a: HopKey, b: HopKey): number {
  return compareIds(a.kind, b.kind) || compareIds(a.name, b.name);
}

/**
 * Which requirements hold each key, by key — the requirement half of the join.
 *
 * Only a requirement with a `Requirement-ID` enters it: a `#req-` tag names an
 * id, so a requirement without one can be claimed by no flow, and listing it
 * would promise a join that cannot happen. A requirement under a REMOVED heading
 * is not a promise the service keeps, and stays out as every fleet index leaves
 * it out (`requirementIdsOf`).
 */
export function requirementKeys(reqs: readonly Requirement[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of reqs) {
    if (r.kind === "REMOVED" || r.id === undefined) continue;
    const keys: HopKey[] = [
      ...r.operations.map((name) => ({ kind: "op" as const, name })),
      ...r.publishes.map((name) => ({ kind: "publishes" as const, name })),
      ...r.consumes.map((name) => ({ kind: "consumes" as const, name })),
    ];
    for (const key of keys) {
      const ids = out.get(keyId(key)) ?? new Set<string>();
      out.set(keyId(key), ids.add(r.id));
    }
  }
  return out;
}
