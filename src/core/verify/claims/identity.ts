/**
 * What a claim is about, and what makes it the same claim next run: the kind
 * vocabulary and the two hash recipes. Moved out of `../checklist.ts` when the
 * `operation` join key pushed the derivation module over the line limit — the
 * seam was already in that file's own header, which discusses what a claim's
 * id is a function of apart from how the questions are derived. The kinds live
 * beside the id recipe rather than beside the derivation because the id STARTS
 * with the kind: the two are one identity, and a diff to this module is a diff
 * to every record in the fleet, which is exactly why it holds nothing else.
 */
import { createHash } from "node:crypto";

/**
 * What a claim is about. The order is the order the checklist comes back in,
 * and it reads as the story of the feature: the service exists, it exposes its
 * operations, it declares its messages, the calls into it are wired, the
 * behaviour is tested.
 */
export const CLAIM_KINDS = ["service.exists", "api.exposes", "event.declares", "c4.calls", "scenario.tested"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/**
 * How much of the sha256 goes into an id, and into a digest — the checklist's,
 * and a scenario claim's runner-matching one, which is deliberately the same
 * 16 hex `loam gherkin` stamps (its GHERKIN_DIGEST_LENGTH): the tag in a
 * cucumber report and the digest on a claim must be the same string.
 */
export const ID_LENGTH = 8;
export const DIGEST_LENGTH = 16;

/**
 * A claim's identity: a hash of what it says, and nothing about how it was
 * produced.
 *
 * The feature id is part of it so an answers file for one feature can never
 * validate against another. Two claims that really are identical (the same
 * scenario name twice under one requirement) are distinguished by occurrence, in
 * document order — they are still two questions, and answering one must not
 * answer the other.
 *
 * The hash is short because the claim text sits next to it everywhere it is
 * shown; it identifies a question, it does not authenticate one.
 */
export function claimId(
  featureId: string,
  kind: ClaimKind,
  parts: string[],
  seen: Map<string, number>,
): string {
  // NUL-joined so no claim's own text can spell another claim's tuple by
  // containing the separator: ['a b','c'] and ['a','b c'] stay two questions.
  const tuple = [featureId, kind, ...parts].join("\u0000");
  const n = (seen.get(tuple) ?? 0) + 1;
  seen.set(tuple, n);
  const canonical = n === 1 ? tuple : `${tuple}\u0000#${n}`;
  return `${kind}-${createHash("sha256").update(canonical).digest("hex").slice(0, ID_LENGTH)}`;
}

/**
 * A digest of the claim id SET — sorted, so reordering the artifacts does not
 * make a record look stale. It changes when a claim is added, removed or
 * reworded, which is exactly when an answer set stops describing the feature.
 * Takes the ids rather than the claims so this module never has to import the
 * `Claim` shape the derivation declares — the recipe is over ids and nothing
 * else, and the signature now says so.
 */
export function checklistDigest(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, DIGEST_LENGTH);
}
