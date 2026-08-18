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

/**
 * The feature-only ROOT record that pins the surfaces the operation pin cannot
 * reach: path-item non-method keys and components. `{ pathItems: {<path>:
 * {<key>: <16-hex>}}, components: {"<kind>/<name>": <16-hex>} }` — written by
 * `loam rebase`, graded by validate/archive, consumed by the merge, and
 * stripped from every living document exactly like the pin. A single root
 * record rather than in-value extensions because a component's value can be a
 * bare boolean (JSON Schema allows `true`), which no in-value key survives.
 */
export const OPENAPI_BASELINES_KEY = "x-loam-baselines";

/** The feature-only explicit removal marker's key. */
export const OPENAPI_REMOVE_KEY = "x-loam-remove";

/** Is this operation node a feature-only explicit removal marker? */
export function isRemoval(node: unknown): boolean {
  return node !== null &&
    typeof node === "object" &&
    (node as Record<string, unknown>)[OPENAPI_REMOVE_KEY] === true;
}

/**
 * Every key that is an instruction to loam rather than part of the contract.
 * At PATH level none has any meaning — `x-loam-remove` addresses one
 * operation and `x-loam-based-on` pins one — so a path item carrying either
 * is an authoring mistake, and one that must not be published whatever else
 * is done about it. Lives HERE, in the openapi root beside the keys it names,
 * because both `merge/` and `baseline/` consume it and a value edge between
 * those two packages in either direction would be a package cycle.
 */
export const FEATURE_ONLY_KEYS: ReadonlySet<string> = new Set([OPENAPI_REMOVE_KEY, OPENAPI_BASELINE_KEY]);

/**
 * `value` with every feature-only key removed, at ANY depth — or the value
 * unchanged (same reference) when it carries none. The component closure
 * writes values VERBATIM into the living contract, and a component holding an
 * operation shape (a `pathItems` component, a callback) can nest the markers
 * where the path-level strip never walks: `--approve` once published
 * `x-loam-remove: true` inside a living component, invisible even to
 * `validate`, whose marker sweep reads `paths` alone.
 */
export function withoutFeatureKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const stripped = withoutFeatureKeysDeep(v);
      if (stripped !== v) changed = true;
      return stripped;
    });
    return changed ? out : value;
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(record)) {
    if (FEATURE_ONLY_KEYS.has(key)) {
      changed = true;
      continue;
    }
    const stripped = withoutFeatureKeysDeep(v);
    if (stripped !== v) changed = true;
    out[key] = stripped;
  }
  return changed ? out : value;
}

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

/**
 * The identity of ANY resolved value: sha256 of its canonical form. The one
 * digest the path-item and component baselines carry — order-of-keys blind,
 * array-order sensitive, legal over scalars and booleans, exactly as the
 * operation digest always was.
 */
export function valueDigest(node: unknown): string {
  return createHash("sha256").update(canonicalJson(node), "utf8").digest("hex").slice(0, OPERATION_DIGEST_LENGTH);
}

/** The identity of an operation's CONTENT: sha256 of its canonical form, pin excluded. */
export function operationDigest(node: unknown): string {
  return valueDigest(withoutOperationBaseline(node));
}

/**
 * What a pin says, from digests alone — the one definition every decider
 * shares: the gate (./baseline/gate.ts) and the merge
 * (./merge/{merge,components,pin}.ts) alike. Two spellings of
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

