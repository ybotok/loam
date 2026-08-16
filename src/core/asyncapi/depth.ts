/**
 * Pointer resolution and the contract-depth probes for the async axis: does a
 * message's payload declare any shape at all, and does every internal `$ref`
 * point at something.
 *
 * `resolvePointer` and `deref` moved here verbatim from read.ts when the
 * probes arrived — they are what the probes and the reader both walk with,
 * and read.ts was nine lines under the file limit.
 *
 * The probes are PRESENCE probes, never field joins: nothing here contributes
 * a name to the spine, nothing reads what a schema says — only whether one
 * was declared — and a payload declaring a non-JSON `schemaFormat` is skipped
 * outright, so the Avro migration stays a document change (read.ts's header
 * states the full stance).
 */

/** How deep a `$ref` chain is followed before the reader gives up. */
const MAX_REF_DEPTH = 8;

/**
 * Resolve an internal JSON Pointer (`#/a/b/c`) against the document root.
 *
 * Internal only, matching the OpenAPI axis's documented stance: external
 * references — URLs, file paths, anything not starting `#/` — are out of scope,
 * left untouched and never graded. That is also why authors are told to keep
 * payloads inside the document rather than `$ref`-ing an external `.avsc`: the
 * merge cannot carry what this reader cannot see.
 */
export function resolvePointer(root: unknown, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split("/")) {
    // JSON Pointer escaping, `~1` before `~0` so an encoded `~1` survives.
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/**
 * Follow `$ref` hops until a node that is not a reference, or the depth budget
 * runs out. The budget is the cycle guard: a document whose `$ref` points at
 * itself is legal YAML, and an unbounded walk would hang the whole validate run
 * rather than reporting a contract nobody can read.
 *
 * Returns the resolved node and the last pointer segment that reached it — the
 * segment is the declaration key, which is the message-name fallback, and it is
 * lost by the time a caller holds only the node.
 */
export function deref(root: unknown, node: unknown, key: string): { node: unknown; key: string } {
  let current = node;
  let currentKey = key;
  for (let hop = 0; hop < MAX_REF_DEPTH; hop += 1) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) break;
    const ref = (current as Record<string, unknown>)["$ref"];
    if (typeof ref !== "string") break;
    const resolved = resolvePointer(root, ref);
    if (resolved === undefined) return { node: undefined, key: currentKey };
    const seg = ref.slice(ref.lastIndexOf("/") + 1);
    current = resolved;
    // An alias keeps the TARGET's key, not the local one it was filed under: a
    // channel may list `#/components/messages/PaymentAuthorized` under any alias
    // it likes, and the fallback name has to be the declaration's own identity
    // or two services aliasing one message differently would stop joining.
    currentKey = seg.length > 0 ? seg : currentKey;
  }
  return { node: current, key: currentKey };
}

/**
 * The JSON-schema keys that say anything about shape. Presence is all that is
 * checked — a schema carrying any of these declared SOMETHING a consumer can
 * code against, however incompletely.
 */
const SHAPE_KEYS = [
  "properties",
  "$ref",
  "items",
  "enum",
  "const",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "patternProperties",
  "additionalProperties",
  "required",
];

/**
 * True when a message declaration's payload defines no shape at all: no
 * `payload`, or a schema with none of the keys that say anything and a `type`
 * of `object` or none — `type: object` and not one word more is exactly what
 * the first adoption shipped, and it validated as cleanly as a full schema.
 *
 * Deliberately NOT empty: a payload behind a dangling `$ref` (that is the ref
 * probe's finding), a non-mapping payload (`payload: true` is a declared
 * decision), a primitive `type`, and any payload declaring a non-JSON
 * `schemaFormat` — Avro's shape is not ours to judge.
 */
export function payloadUndeclared(root: unknown, msg: unknown): boolean {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return false;
  const raw = (msg as Record<string, unknown>)["payload"];
  if (raw === undefined || raw === null) return true;
  const payload = deref(root, raw, "").node;
  if (payload === undefined) return false;
  if (payload === null) return true;
  if (typeof payload !== "object" || Array.isArray(payload)) return false;
  let schema = payload as Record<string, unknown>;
  const format = schema["schemaFormat"];
  if (typeof format === "string") {
    if (!/json/i.test(format)) return false;
    // Multi-format shape: the actual schema sits one level down.
    const inner = deref(root, schema["schema"], "").node;
    if (inner === undefined) return false;
    if (inner === null) return true;
    if (typeof inner !== "object" || Array.isArray(inner)) return false;
    schema = inner as Record<string, unknown>;
  }
  if (SHAPE_KEYS.some((k) => k in schema)) return false;
  const type = schema["type"];
  return type === undefined || type === "object";
}

/**
 * Every internal `#/` reference in the document that resolves to nothing —
 * deduped, document order. This is the probe that catches BOTH silent-skip
 * sites in the reader: an operation's message-list entry that derefs to
 * nothing (it "contributes no name" and vanishes from sent/received), and a
 * channel alias whose dangling target leaves a phantom local key behind.
 */
export function danglingRefs(root: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        if (value.startsWith("#/") && resolvePointer(root, value) === undefined) out.add(value);
        continue;
      }
      walk(value);
    }
  };
  walk(root);
  return [...out];
}
