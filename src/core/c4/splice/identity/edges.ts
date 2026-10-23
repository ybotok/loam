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
 * them has would make the merge disagree with itself one archive later. The one
 * field the two read differently — the tags, which the parse inherits from the
 * relationship's kind — is reconciled on the scanned side (`scannedStatementKey`).
 */
import type { Elem, Rel } from "../../likec4.js";
import type { ScannedModel, ScannedRel } from "../../source-scan.js";
import type { KindTags } from "../contract.js";

/**
 * Which AUTHORED STATEMENT a parsed addition was written as — the key that
 * matches a `Rel` back to its bytes in delta.likec4, so the splice carries the
 * declaration verbatim instead of re-serializing it.
 *
 * Stricter than `relKey` below on purpose, and asking a different question:
 * `relKey` decides whether the living document already HAS this edge, across
 * two id namespaces, so it joins on titles; this one runs inside ONE document
 * where ids are exact, and it must tell apart two statements the merge would
 * otherwise hand each other's bytes. Both endpoints, the title, all three spine
 * keys and the tags, because a pool entry shared by two additions gives the
 * second one the first one's authored source.
 *
 * The tags are a SET, and a parsed `Rel`'s are not the ones written in the
 * statement: since LikeC4 1.59.0 a relationship kind can carry tags
 * (`relationship publishes { #async }`), and the parse hands every edge of the
 * kind its kind's tags, deduplicated against the statement's own (measured at
 * the 1.59.2 pin). A scanned statement carries only what is written in it, so
 * `scannedStatementKey` adds its kind's tags before keying — keyed as written,
 * every edge of a tagged kind found no statement, and archive refused a delta
 * `validate --feature` and `status` had called ready (`merge-failed`, or
 * `usecase.flow-invalid` when the feature had flows; 2026-10).
 */
export function relStatementKey(r: Rel | ScannedRel): string {
  const spine = [r.op ?? "", r.publishes ?? "", r.consumes ?? ""];
  return JSON.stringify([r.source, r.target, r.title ?? "", ...spine, [...new Set(r.tags)].sort()]);
}

/**
 * A scanned statement's `relStatementKey`, with the tags its kind gives it —
 * what the parse of the same statement carries. `kindTags` is the document's
 * `specification.relationshipKindTags` (`../../parsed/specification.ts`); a
 * document whose kinds carry no tags keys exactly as `relStatementKey` does.
 */
export function scannedStatementKey(s: ScannedRel, kindTags: KindTags): string {
  const inherited = s.kind === undefined ? [] : (kindTags[s.kind] ?? []);
  return relStatementKey({ ...s, tags: [...s.tags, ...inherited] });
}

/**
 * Every statement of one scan, pooled by the key its parsed addition will ask
 * with (`relStatementKey`), in document order. ONE construction for every
 * reader that matches an addition back to its bytes — the map's splice, the
 * model's, and the vocabulary check that reads what they will carry
 * (`../vocabulary/undeclared.ts`) — because a reader keying differently from
 * the splice would read one duplicate statement while the splice writes
 * another. Each reader takes from a pool of its own with `shift()`, in
 * addition order, as the splice does.
 */
export function statementPool(scan: ScannedModel, kindTags: KindTags): Map<string, ScannedRel[]> {
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = scannedStatementKey(s, kindTags);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  return pool;
}

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
