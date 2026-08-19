/**
 * Slot identity for the event axis: what a feature-local asyncapi.yaml's
 * slots hash to, and the markers `loam rebase` and the merge read from them.
 *
 * The digest RULE is imported from the OpenAPI axis (../openapi/digest.js)
 * rather than respelled: the same canonical JSON (keys sorted, arrays in
 * order), the same sha256 cut to the same 16 hex characters, classified by
 * the same verdict function. Two spellings of the one rule is the exact
 * drift that module's own header names as the failure mode. The import
 * direction is asyncapi → openapi only, verified cycle-free — no openapi
 * module imports asyncapi (openapi/depth.ts names it in a comment alone).
 *
 * Identity is the SLOT: the pair (section, key) over the three named
 * sections `channels.<key>`, `operations.<key>` and
 * `components.messages.<key>` — SCHEMA.md's format spec for this axis. An
 * inline channel message (`channels.<ck>.messages.<mk>`) is deliberately
 * NOT a slot: its identity is interior content of its channel's slot, so
 * the walker below never visits it, it cannot carry its own pin, and a
 * removal marker nested on it grades as part of the channel's content —
 * a feature declares or retires an INDIVIDUAL message under
 * `components.messages`, with the channel aliasing it by `$ref`.
 *
 * Nothing here reads inside `payload` as anything but bytes: a slot digest
 * is content identity (a changed payload moves it), never a join on payload
 * fields — read.ts's header carries the full doctrine.
 */
import { createHash } from "node:crypto";
import { canonicalJson, OPERATION_DIGEST_LENGTH } from "../openapi/digest.js";

/**
 * The baseline marker: which living version of a slot a FEATURE delta was
 * written against. Same spelling and shape as the OpenAPI axis's, because a
 * feature's asyncapi.yaml is a complete document for the same reason its
 * openapi.yaml is: authors restate the living contract around the slot they
 * change, and the pin is what lets the merge tell a QUOTE from an EDIT.
 */
export const ASYNCAPI_BASELINE_KEY = "x-loam-based-on";

/** The feature-only explicit removal marker's key — the OpenAPI axis's spelling. */
export const ASYNCAPI_REMOVE_KEY = "x-loam-remove";

/** The three sections whose entries are slots. */
export type AsyncapiSection = "channels" | "operations" | "components.messages";

/** One slot of an AsyncAPI document, as the identity layer sees it. */
export interface AsyncapiSlot {
  section: AsyncapiSection;
  /** The entry's key under its section — the slot half of the identity pair. */
  key: string;
  /** The slot's resolved value, pin and marker still in place. */
  node: unknown;
  /** True when the value carries `x-loam-remove: true` — a feature retiring the slot. */
  remove: boolean;
  /** The `x-loam-based-on` the value declares, or undefined — non-strings stringified, so the gate can refuse them. */
  basedOn?: string;
  /** `slotDigest` of the value as it stands in ITS OWN document. */
  digest: string;
}

/** Is this slot value a feature-only explicit removal marker? */
export function isSlotRemoval(node: unknown): boolean {
  return node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    (node as Record<string, unknown>)[ASYNCAPI_REMOVE_KEY] === true;
}

/** The `x-loam-based-on` a slot declares, or undefined — mirror of `operationBaselineOf`. */
export function slotBaselineOf(node: unknown): string | undefined {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
  const value = (node as Record<string, unknown>)[ASYNCAPI_BASELINE_KEY];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : String(value);
}

/**
 * The slot without its own baseline marker — what a digest is taken over. A
 * pin is a statement ABOUT a delta, never part of the slot it describes:
 * inside the digest input, no baseline could ever be self-consistent.
 */
export function withoutSlotBaseline(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const record = node as Record<string, unknown>;
  if (!(ASYNCAPI_BASELINE_KEY in record)) return node;
  const rest = { ...record };
  delete rest[ASYNCAPI_BASELINE_KEY];
  return rest;
}

/** The identity of a slot's CONTENT: sha256 of its canonical form, pin excluded. */
export function slotDigest(node: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(withoutSlotBaseline(node)), "utf8")
    .digest("hex")
    .slice(0, OPERATION_DIGEST_LENGTH);
}

/** Entries of a mapping node, or nothing — the walker's one structural read. */
function entriesOf(node: unknown): [string, unknown][] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
  return Object.entries(node as Record<string, unknown>);
}

/**
 * The document path of one slot — where the pin and the merge write. Spelled
 * here so `rebase`'s stamp and the merge's upsert cannot disagree about which
 * node a (section, key) pair addresses.
 */
export function slotPath(section: AsyncapiSection, key: string): string[] {
  return section === "components.messages" ? ["components", "messages", key] : [section, key];
}

/**
 * Every slot a parsed document declares, in document order across the three
 * sections. Inline channel messages are NOT visited: they are interior
 * content of their channel's slot (the header carries the decision), so a
 * pin or marker nested on one is part of the `channels.<ck>` value this
 * walker already returns — never a slot of its own.
 */
export function asyncapiSlots(root: unknown): AsyncapiSlot[] {
  if (root === null || typeof root !== "object" || Array.isArray(root)) return [];
  const doc = root as Record<string, unknown>;
  const slots: AsyncapiSlot[] = [];
  const walk = (section: AsyncapiSection, mapping: unknown): void => {
    for (const [key, node] of entriesOf(mapping)) {
      slots.push({
        section,
        key,
        node,
        remove: isSlotRemoval(node),
        digest: slotDigest(node),
        ...(slotBaselineOf(node) === undefined ? {} : { basedOn: slotBaselineOf(node) }),
      });
    }
  };
  walk("channels", doc["channels"]);
  walk("operations", doc["operations"]);
  walk("components.messages", (doc["components"] as Record<string, unknown> | undefined)?.["messages"]);
  return slots;
}
