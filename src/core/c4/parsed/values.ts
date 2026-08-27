/**
 * The corners of LikeC4's parse output that are typed `unknown`, decoded.
 *
 * LikeC4 models `metadata { ... }` values and a `description` as open shapes —
 * a value may be a string, an array, or a rich-text object, and the declared
 * type says none of that. Every one of those crossings needs a defensive read
 * that answers "not present" rather than throwing, and each read encodes a
 * defect somebody hit. They live together here, one module below the adapter
 * (`../likec4.ts`) that calls them, because the adapter is at its line limit and
 * because "decode a value LikeC4 left untyped" is a subject of its own: the
 * specification reader beside this file is the same subject on a different
 * corner of the same object.
 */

/**
 * Read one string key out of a LikeC4 `metadata { ... }` block. Four keys carry
 * loam's spines: `op` on a relationship (the OpenAPI operationId it calls),
 * `publishes`/`consumes` on a relationship (the AsyncAPI message it produces or
 * receives), and `service` on an element (the services/<id> directory it stands
 * for). Every one of them is read by BOTH model readers — the parsed one
 * (`flattenModel` in `../likec4.ts`, which calls this) and the text scanner
 * `scanModel` uses for archive's splice map — because a key only one of them
 * sees is a key the merge silently drops. Elements with no metadata come back as
 * `{}`, so a missing key is indistinguishable from a missing block — both mean
 * "not bound".
 */
export function metaKey(m: unknown, key: string): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
    // A key written TWICE in one block comes back as an array, accepted with no
    // error, and reading only the string form dropped every value — so an edge
    // naming two operations reported as naming none, `c4.op-link-missing` telling
    // the author the opposite of what they wrote. First wins, matching the text
    // scanner's `keyedLiteral`: the two readers disagreeing about a binding is
    // exactly what the paragraph above exists to prevent. Later values stay
    // dropped — one id per key per edge is the model.
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return undefined;
}

/** LikeC4 descriptions can be a string or a rich-text object ({ txt } / { text } / { md }). */
export function descText(d: unknown): string | undefined {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    for (const key of ["txt", "text", "md", "value"]) {
      const v = o[key];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}
