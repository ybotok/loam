/**
 * One service's four documents, each read or honestly not — the shape every
 * consumer question is asked of.
 *
 * It began as `loam diff`'s (`core/diff/base-state.ts` held it, because the
 * diff was its only reader), and moved here when the consumer index became
 * the one answer the diff, the coherence gate and the archive planner share:
 * the index reads the living fleet in this shape, so the shape lives one level
 * below everything that asks it.
 */
import { createHash } from "node:crypto";
import type { Requirement } from "../document/spec.js";
import type { Operation } from "../openapi/doc.js";
import type { EventMessage } from "../asyncapi/model.js";
import type { RawServiceId } from "../kernel/ids/service.js";

/**
 * One artifact's state on one side of the diff. `unreadable` is the
 * containment arm: the file exists but could not be read as its kind, so
 * every finding on this axis for this subject is SUSPENDED — "nobody could
 * look" must never grade as "nothing is there", in either direction.
 *
 * `bytes` is the sha256 of the raw file when there WERE bytes and they refused
 * to parse — absent when the bytes themselves could not be had (a failed
 * `git show`, a directory where the file belongs). It is the one fact an
 * unreadable side can still prove: that it is the same file the other side
 * holds, which `core/diff/semantic.ts`'s `comparable` turns into "the branch
 * did not touch this contract" (an AsyncAPI 2.x document is unreadable by policy, and
 * suspending it on every run failed every `loam diff` over a fleet that holds
 * one, whatever the branch changed).
 */
export type AxisState<T> =
  | { kind: "absent" }
  | { kind: "read"; value: T }
  | { kind: "unreadable"; path: string; error: string; bytes?: string };

/** The `bytes` identity of an unreadable side — the same hash on both sides, so equal means byte-identical. */
export function bytesDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * One service on one side of the diff — the same shape for the base ref and
 * the working tree (`./current.ts` builds that one, `core/diff/base-state.ts`
 * the base ref's), which is what lets `core/diff/semantic.ts` join the two
 * without caring which side came from git — and what lets the consumer index
 * (`./consumers.ts`) read the living fleet in the shape the diff already does.
 */
export interface ServiceState {
  /** The directory's leaf name — a name read off the tree, so the index may join it into a feature's `specs/<svc>/`. */
  id: RawServiceId;
  /** Docs-relative directory with forward slashes, e.g. `services/billing/payment-service`. */
  dir: string;
  spec: AxisState<Requirement[]>;
  /** Read on both sides for every requirement join — the outbox requirement lives here as often as in spec.md (`./consumers.ts`'s `REQUIREMENT_AXES`). */
  archSpec: AxisState<Requirement[]>;
  /** Operations with `x-loam-remove` markers filtered out: a marker is bookkeeping, never a callable operation. */
  openapi: AxisState<Operation[]>;
  /** Messages with removal markers filtered out, for the same reason. */
  asyncapi: AxisState<EventMessage[]>;
}

/**
 * Ids claimed by more than one enumerated directory, with every claimant named
 * — the base side's grouping (`core/diff/base-state.ts`) and `./current.ts`'s,
 * so the two sides of a diff refuse the same ambiguity the same way.
 */
export function collisions(dirs: readonly { id: string; dir: string }[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const d of dirs) byId.set(d.id, [...(byId.get(d.id) ?? []), d.dir]);
  return new Map([...byId].filter(([, claimants]) => claimants.length > 1));
}
