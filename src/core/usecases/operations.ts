/**
 * Which hops of which business flows a contract removal breaks.
 *
 * `loam diff --base` already answers "who still depends on this operation" with
 * landscape edges and other services' living requirements. Both are true and
 * neither is the sentence a reviewer wants: an edge is a line in a diagram and a
 * requirement is a heading in somebody else's spec, while "step 4 of Checkout
 * stops working" is the fact a human weighs a pull request against. This module
 * is the join that produces that sentence, and it produces NOTHING ELSE — no
 * finding, no code, no severity. `core/diff/victims.ts` folds its answers into
 * the `details[]` of the two codes that already exist.
 *
 * ## Attributed is a victim; contested is a suspension
 *
 * The distinction is the whole reason this module is careful rather than a
 * filter. `attributeStep` (core/c4/resolve/steps.ts) grades a hop by the DISTINCT-op
 * count across the relationships backing it:
 *
 *  - `attributed` with `op === X` means every relationship behind the hop agrees
 *    the hop exercises X. Remove X and the flow breaks at that hop. That is
 *    positive evidence, and it is a victim.
 *  - `contested` means the relationships DISAGREE, so loam does not know which
 *    operation the hop exercises. It must not claim the flow breaks — a guessed
 *    victim reads exactly like a real one and turns a warn into an error on
 *    somebody's PR — and it must not go silent either, because silence here is
 *    the fail-open shape `ConsumerScan.suspended` exists to forbid. It is a
 *    suspension: loam says it could not answer.
 *
 * A contested hop is suspended only when X is among its candidate operations.
 * That is not a noise trade, it is the honest boundary: the candidates ARE the
 * relationships backing the hop, so an operation none of them names is an
 * operation the hop cannot be exercising under any reading of the disagreement.
 * Suspending every contested hop in the fleet on every removal would report
 * doubt loam does not actually have.
 *
 * An `unbacked` hop is neither. Nothing in the model backs it, so it names no
 * operation of anybody's contract — `usecase.step-unbacked` is already the error
 * that convicts it, and repeating that here would file a modelling defect
 * against whoever happened to remove an endpoint.
 */
import { attributeStep } from "../c4/resolve/steps.js";
import type { ParsedStep, ParsedView } from "../c4/parsed/dynamic-views.js";
import { hopPlace } from "./place.js";
import type { UseCaseScan } from "./fleet.js";

/**
 * What one contract removal does to the fleet's use cases.
 *
 * Two lists rather than `victims`/`suspended` — the vocabulary
 * `core/diff/victims.ts` uses — because this module answers about FLOWS and that
 * one answers about consumers. The caller does the folding, and naming the two
 * differently is what stops a reader taking this for a second implementation of
 * `ConsumerScan` (it is not: it never scans a document, and it cannot be
 * unreadable — the scan it runs over was already graded).
 */
export interface UseCaseHits {
  /** Hops the removal breaks, each spelled by `hopPlace`. */
  breaks: string[];
  /** Hops loam refuses to grade, each saying why in its own sentence. */
  unsure: string[];
}

/** The one removal a scan is being asked about. */
export interface RemovedOperation {
  /** The service dropping it — the same id the diff files its findings under. */
  provider: string;
  /** The operationId leaving the contract. */
  op: string;
}

const EMPTY: UseCaseHits = { breaks: [], unsure: [] };

/** Every hop of every graded use case, view order preserved, so output is stable. */
function hops(scan: Extract<UseCaseScan, { kind: "read" }>): Array<{ view: ParsedView; step: ParsedStep }> {
  return scan.views.flatMap((view) => view.steps.map((step) => ({ view, step })));
}

/**
 * The flows one removed operation breaks, and the ones loam cannot answer for.
 *
 * An `unreadable` scan contributes NOTHING — neither break nor suspension — and
 * that is `core/diff/victims.ts`'s own landscape doctrine applied one axis over:
 * an unreadable fleet map proves nothing either way, `landscape.invalid` is
 * validate's finding to make, and inventing doubt out of a parse error would
 * point the reviewer at a file their change never touched. The caller reports
 * the hole; this join stays quiet about it.
 */
export function hopsExercising(scan: UseCaseScan, removed: RemovedOperation): UseCaseHits {
  if (scan.kind !== "read") return EMPTY;
  const out: UseCaseHits = { breaks: [], unsure: [] };
  for (const { view, step } of hops(scan)) {
    const attribution = attributeStep(step, scan.model);
    if (attribution.verdict === "unbacked") continue;
    // The callee, through the SAME resolver every other join in this run uses,
    // so a hop drawn into a modelled container `payment.api` is filed against
    // payment-service rather than against a service called "api".
    if (scan.resolve(attribution.to) !== removed.provider) continue;
    // And the CALLER, through the same resolver: a hop whose two endpoints
    // resolve to one service is that service calling itself, which owes no
    // operationId of its own contract — `usecase.step-unlinked`'s fourth guard,
    // applied to the victim join. Without it an internal hop was a break of the
    // provider's own removal (verification 2026-09-04, R3).
    if (scan.resolve(attribution.from) === removed.provider) continue;
    if (attribution.verdict === "attributed") {
      if (attribution.op === removed.op) out.breaks.push(hopPlace(view, step));
      continue;
    }
    if (!attribution.ops.includes(removed.op)) continue;
    out.unsure.push(
      `${hopPlace(view, step)} — ${attribution.rels.length} relationships back ` +
        `${attribution.from} -> ${attribution.to} and they name different operations, so whether this hop ` +
        `exercises '${removed.op}' could not be answered`,
    );
  }
  return out;
}

/** The one message removal a scan is being asked about. */
export interface RemovedMessage {
  /** The service dropping the declaration — the diff's own subject. */
  provider: string;
  /** The AsyncAPI message name leaving the contract. */
  name: string;
}

/**
 * The flows one removed message breaks.
 *
 * No suspension arm, and the asymmetry is a fact about the model rather than an
 * omission: `attributeStep` contests OPERATIONS, because that is where two
 * relationships between one pair of endpoints can disagree. A `consumes` edge
 * names a message outright, so a hop either is backed by one or is not — there
 * is no disagreement for loam to refuse to resolve.
 *
 * The provider exclusion mirrors `messageConsumers` exactly: an edge INTO the
 * provider is the provider's own consumption, which leaves with the same change,
 * so a hop backed only by that edge is not a victim of it.
 */
export function hopsConsuming(scan: UseCaseScan, removed: RemovedMessage): string[] {
  if (scan.kind !== "read") return [];
  const out: string[] = [];
  for (const { view, step } of hops(scan)) {
    const attribution = attributeStep(step, scan.model);
    if (attribution.verdict === "unbacked") continue;
    const consumes = attribution.rels.some(
      (rel) => rel.consumes === removed.name && scan.resolve(rel.target) !== removed.provider,
    );
    if (consumes) out.push(hopPlace(view, step));
  }
  return out;
}
