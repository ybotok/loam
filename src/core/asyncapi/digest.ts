/**
 * Slot identity for the event axis: what a feature-local asyncapi.yaml's
 * slots hash to, and the markers `loam rebase` and the merge read from them.
 *
 * The digest RULE is imported from the OpenAPI axis (../openapi/digest.js)
 * rather than respelled: the marker keys, the removal test, the baseline
 * accessors and the digest itself are ALIASES of that module's — one
 * definition each, renamed to this axis's vocabulary. Two spellings of the
 * one rule is the exact drift that module's own header names as the failure
 * mode, and it is not hypothetical here: the deep strip filters on the
 * OpenAPI key constants, so a second spelling of either key would be two
 * definitions of "which keys are feature-only" — the marker leak the strip
 * exists to close. The import direction is asyncapi → openapi only,
 * verified cycle-free — no openapi module imports asyncapi
 * (openapi/depth.ts names it in a comment alone).
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
import {
  isRemoval,
  OPENAPI_BASELINE_KEY,
  OPENAPI_BASELINES_KEY,
  OPENAPI_REMOVE_KEY,
  operationBaselineOf,
  operationDigest,
  withoutOperationBaseline,
} from "../openapi/digest.js";

/**
 * The baseline marker: which living version of a slot a FEATURE delta was
 * written against. The OpenAPI axis's key, not a restatement of its
 * spelling, because a feature's asyncapi.yaml is a complete document for
 * the same reason its openapi.yaml is: authors restate the living contract
 * around the slot they change, and the pin is what lets the merge tell a
 * QUOTE from an EDIT.
 */
export const ASYNCAPI_BASELINE_KEY = OPENAPI_BASELINE_KEY;

/**
 * The feature-only ROOT record that pins what the SLOT pin cannot reach: every
 * `components/<kind>/<name>` outside `messages`. The OpenAPI axis's key and
 * the OpenAPI axis's reader (core/openapi/baseline/record.ts) — one record
 * shape for both axes, because a second spelling of "which living version was
 * this written against" is the drift this module's header names.
 *
 * A root record rather than an in-value pin here for the reason it is one
 * there: a slot value is always a mapping, so `x-loam-based-on` has somewhere
 * to live inside it, but a `components/schemas/<name>` value is a JSON Schema
 * — an in-value loam key there would be a schema keyword, and JSON Schema's
 * own `true` is a legal component that no in-value key survives at all.
 */
export const ASYNCAPI_BASELINES_KEY = OPENAPI_BASELINES_KEY;

/** The feature-only explicit removal marker's key — the OpenAPI axis's, aliased. */
export const ASYNCAPI_REMOVE_KEY = OPENAPI_REMOVE_KEY;

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

/** Is this slot value a feature-only explicit removal marker? One test for both axes. */
export const isSlotRemoval = isRemoval;

/** The `x-loam-based-on` a slot declares, or undefined — `operationBaselineOf`, aliased. */
export const slotBaselineOf = operationBaselineOf;

/**
 * The slot without its own baseline marker — what a digest is taken over. A
 * pin is a statement ABOUT a delta, never part of the slot it describes:
 * inside the digest input, no baseline could ever be self-consistent. The
 * OpenAPI rule, aliased — the key is the same key.
 */
export const withoutSlotBaseline = withoutOperationBaseline;

/**
 * The identity of a slot's CONTENT: sha256 of its canonical form, pin
 * excluded. `operationDigest` under this axis's name — the same canonical
 * JSON, the same cut, so a pin either axis writes means the same thing.
 */
export const slotDigest = operationDigest;

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
 * Every path whose node carries `x-loam-remove: true`, at ANY depth — the
 * three slot depths the format spec gives the key meaning at, inline channel
 * messages, and every place the key means nothing at all: the document root,
 * `info`, a `components` sibling, the inside of a payload. The reader's
 * `markers` field is built from this walk so `asyncapi.remove-marker-living`
 * can NAME a marker wherever one leaked: the strip removes the loam keys at
 * document depth, and a sweep narrower than the strip is how the OpenAPI
 * axis once published a marker invisible even to validate.
 */
export function removalMarkerPaths(node: unknown, at: string): string[] {
  if (node === null || typeof node !== "object") return [];
  const out: string[] = [];
  if (isSlotRemoval(node)) out.push(at === "" ? "(document root)" : at);
  const children = Array.isArray(node)
    ? node.map((value, i) => [String(i), value] as const)
    : Object.entries(node as Record<string, unknown>);
  for (const [key, value] of children) {
    out.push(...removalMarkerPaths(value, at === "" ? key : `${at}.${key}`));
  }
  return out;
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
