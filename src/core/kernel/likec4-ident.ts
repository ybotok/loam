/**
 * One string function: a path of authored names encoded into a LikeC4 view
 * IDENTIFIER, injectively.
 *
 * A module of its own, at the bottom of the graph, because two generators now
 * need the same answer — `../repo/tree/views.ts` names a view per subsystem
 * from its directory path, `../flows/views.ts` names a view per flow group
 * from its tag — and they live in packages that must not import each other.
 * Copying twelve lines would have been cheaper to write and is exactly the
 * defect below waiting to happen twice.
 *
 * INJECTIVE is the whole point, and it is a defect this encoding fixed rather
 * than a property somebody wanted. The naive folding (every byte outside
 * `[A-Za-z0-9]`, and the join separator alike, becoming `_`) collided three
 * DISTINCT healthy subsystem names onto one identifier — `a_b`, and `b` under
 * `a`, both rendering `subsystem_a_b` — so `loam validate --all` stayed green
 * while the LikeC4 renderer refused the whole `architecture/` project over a
 * duplicate view id, and no name-collision check fires because the flat
 * namespace really is intact.
 *
 * Hence the encoding: an identifier byte (`[A-Za-z0-9]`) passes through, any
 * other byte becomes `_` + two lowercase hex digits (`.` → `_2e`, `-` → `_2d`,
 * `_` itself → `_5f` — the underscore must be escaped precisely because it is
 * BOTH legal in a name and the separator), and segments join on `__`.
 * Underscore runs then decode uniquely — one is an escape, two a separator,
 * three a separator followed by an escape — so no two distinct legal paths
 * share an identifier. A name holding a code point above 0xff produces a
 * longer hex run that could in principle re-collide; it stays deterministic,
 * and every caller already grades such a name as invalid by its own rule.
 */

/** One segment, byte by byte: identifier characters through, everything else escaped. */
function encodeSegment(name: string): string {
  return [...name]
    .map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16).padStart(2, "0")}`))
    .join("");
}

/**
 * The identifier body for a path of names — callers prepend their own kind
 * prefix (`subsystem_`, `flow_group_`), so two generators can never mint the
 * same id for two different things.
 */
export function likec4Identifier(segments: readonly string[]): string {
  return segments.map(encodeSegment).join("__");
}
