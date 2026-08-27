/**
 * How the landscape merge decides that two relationships are the SAME EDGE,
 * and in what order equal ones are written.
 *
 * A subject of its own, and not a corner of placement: everything in
 * `../placement.ts` answers *where in the text* a statement goes, in byte
 * offsets, while everything here answers *which statement this is*, as a
 * comparable string. The merge asks the identity question first and the
 * placement question second, and getting the first one wrong is the failure
 * mode that is silent — a delta edge that hashes the same as a living one is
 * counted as already present and dropped at exit 0, with `+0 relationship(s)`
 * printed over a binding that never reached the map.
 *
 * Both keys are built from fields BOTH `Rel` and `ScannedRel` carry, because
 * the same edge must key identically as today's addition and as a statement in
 * the next archive's scan of the file it was written into. A field only one of
 * them has would make the merge disagree with itself one archive later.
 */
import type { Elem, Rel } from "../../likec4.js";

/**
 * The order of loam-inserted relationships that share a landing region:
 * (source title, target title, the three spine keys, title) as one comparable
 * string. Titles, not ids — the namespaces differ. The same edge must sort
 * identically as today's addition and as a statement in the next archive's
 * scan, so every field is one BOTH `Rel` and `ScannedRel` carry.
 */
export function relSortKey(
  els: Elem[],
  r: { source: string; target: string; title?: string; op?: string; publishes?: string; consumes?: string },
): string {
  const spine = [r.op ?? "", r.publishes ?? "", r.consumes ?? ""];
  return JSON.stringify([titleOf(els, r.source), titleOf(els, r.target), ...spine, r.title ?? ""]);
}

/**
 * What makes two edges the same edge. Endpoints are compared by TITLE, which is
 * stable across the delta's and the landscape's id namespaces.
 *
 * An edge carrying a SPINE KEY — `op`, `publishes` or `consumes` — IS that call
 * or that message, whatever it is titled: retitling it must not merge a second
 * copy. An edge with none has only its title. Separate namespaces, because they
 * are separate things: an op-less edge titled `authorizePayment` is not the edge
 * whose operationId is authorizePayment, and keying on `op ?? title` quietly
 * merged only one of them.
 *
 * ALL THREE keys, not just `op`. While the other two were out, a delta edge differing from a
 * living one only by `metadata { publishes 'x' }` hashed the same, counted as already present,
 * and was dropped — `+0 relationship(s)` at exit 0 over a binding that never reached the map.
 */
export function relKey(els: Elem[], r: Rel): string {
  const src = titleOf(els, r.source);
  const tgt = titleOf(els, r.target);
  const spine = [r.op ?? "", r.publishes ?? "", r.consumes ?? ""];
  return JSON.stringify(spine.some((v) => v !== "") ? ["spine", src, tgt, ...spine] : ["title", src, tgt, r.title ?? ""]);
}

export function titleOf(elements: Elem[], id: string): string {
  return elements.find((e) => e.id === id)?.title ?? id;
}
