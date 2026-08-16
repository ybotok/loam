/**
 * What operation content HASHES to, and what a recorded hash means when it is
 * read back.
 *
 * A module of its own because the digest and the comparison it must agree with
 * are a matched pair: key order must not matter here, since the merge's own
 * idea of "this operation differs" is `isDeepStrictEqual`, which ignores it. A
 * second spelling of either would go stale over a reordered `summary` pair the
 * merge calls identical — a false collision on the one check whose whole worth
 * is that it fires only for real ones.
 */
import { createHash } from "node:crypto";

/**
 * The baseline marker: which living version of this operation a FEATURE delta
 * was written against. Same idea as a requirement's `Based-On:` (core/document/spec.ts),
 * in the vendor-extension shape this axis already uses for `x-loam-remove`.
 *
 * This axis needs it MORE than the requirement axis does, because a feature's
 * openapi.yaml is a COMPLETE document rather than a patch: authors restate the
 * living contract around the slot they are changing, and the merge upserts every
 * operation the document spells. So a feature that never meant to touch
 * `refundOrder` — it merely quoted it — pushes its authoring-time copy back over
 * whatever landed in between, reverting another team's shipped change without
 * either feature overlapping the other at all. The pin is what lets the merge
 * tell a QUOTE from an EDIT: a quote equals its own baseline, and is skipped.
 */
export const OPENAPI_BASELINE_KEY = "x-loam-based-on";

/** How much of the sha256 an `x-loam-based-on` carries — the length every loam digest uses. */
export const OPERATION_DIGEST_LENGTH = 16;

/** The value shape of an `x-loam-based-on`, exactly as `operationDigest` writes it. */
export const OPERATION_DIGEST_RE = new RegExp(`^[0-9a-f]{${OPERATION_DIGEST_LENGTH}}$`);

/**
 * Canonical JSON for a resolved YAML value: object keys sorted, arrays left in
 * order, everything else as JSON writes it.
 *
 * Key ORDER must not matter, because the merge's own idea of "this operation
 * differs" is `isDeepStrictEqual` (./merge/merge.ts), which ignores it. A
 * digest that disagreed with that comparison would go stale over a reordered
 * `summary`/`operationId` pair the merge itself calls identical — a false
 * collision on the one check whose worth is that it fires only for real ones.
 */
function canonicalJson(node: unknown): string {
  if (node === null || typeof node !== "object") return JSON.stringify(node) ?? "null";
  if (Array.isArray(node)) return `[${node.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalJson(value)}`).join(",")}}`;
}

/**
 * The operation without its own baseline marker — what a digest is taken over,
 * and what the merge writes.
 *
 * A pin is a statement ABOUT a delta, never part of the operation it describes.
 * Inside the digest input, an operation's identity would depend on the pin
 * pointing at it and no baseline could ever be self-consistent; inside the
 * merged contract, a living operation would carry a pin to a version of itself
 * and the next feature's baseline would hash the previous feature's bookkeeping.
 */
export function withoutOperationBaseline(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const record = node as Record<string, unknown>;
  if (!(OPENAPI_BASELINE_KEY in record)) return node;
  const rest = { ...record };
  delete rest[OPENAPI_BASELINE_KEY];
  return rest;
}

/** The identity of an operation's CONTENT: sha256 of its canonical form, pin excluded. */
export function operationDigest(node: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(withoutOperationBaseline(node)), "utf8")
    .digest("hex")
    .slice(0, OPERATION_DIGEST_LENGTH);
}

/**
 * What a pin says, from digests alone — the one definition both the gate
 * (core/coherence/coherence.ts, which has parsed Operations) and the merge
 * (./merge/merge.ts, which has raw YAML trees) decide by. Two spellings of
 * this rule would eventually disagree about which operations a merge writes,
 * and the disagreement would be invisible until a contract came back wrong.
 *
 * Order matters: `quote` is settled against the delta's OWN content before the
 * living contract is consulted. An operation equal to its own baseline was not
 * edited, so what living holds now is nobody's business but the feature that
 * put it there.
 */
export function classifyBaselineDigests(
  pin: string | undefined,
  ownDigest: string,
  livingDigest: string | undefined,
): "unpinned" | "quote" | "edit" | "stale" | "unfounded" {
  if (pin === undefined) return "unpinned";
  if (livingDigest === undefined) return "unfounded";
  if (pin === ownDigest) return "quote";
  if (pin === livingDigest) return "edit";
  return "stale";
}

/** The `x-loam-based-on` a node declares, or undefined — non-strings included, so validate can refuse them. */
export function operationBaselineOf(node: unknown): string | undefined {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
  const value = (node as Record<string, unknown>)[OPENAPI_BASELINE_KEY];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : String(value);
}

