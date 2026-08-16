import { elementService, serviceOf, type Elem, type Rel } from "../likec4.js";
import type { ScannedElement, ScannedModel } from "../source-scan.js";

/* ------------------------------------------------------------------ */
/* Landscape placement — where a top-level addition lands               */
/* ------------------------------------------------------------------ */

/**
 * The placement scheme, in full. It never moves an authored byte — placement
 * only chooses where NEW spliced blocks go — and it is deterministic in a
 * stronger sense: archiving feature A then feature B (touching different
 * services) yields the SAME final bytes as B then A, which is what lets two
 * concurrent archive PRs merge in git instead of colliding on one shared
 * append point.
 *
 *  - An ELEMENT whose service already has top-level elements in the model
 *    (the elementService join — binding first, title as the fallback) lands
 *    immediately after the last of them: it joins its service's neighborhood.
 *    Two features touching the SAME service therefore land adjacently, and
 *    their concurrent PRs still conflict — expected, and documented
 *    (SCHEMA.md sends that conflict to the PR flow).
 *  - An element opening a NEW service lands in the trailing region before the
 *    model's closing brace: skip the trailing relationship run, then walk left
 *    per same-service RUN, past every run whose leading id is
 *    lexicographically greater — an insertion sort of neighborhood heads
 *    against whatever is already there, which is what makes the region's
 *    final order independent of archive order (see the note on elementSpot:
 *    per-statement comparison was order-dependent).
 *  - A RELATIONSHIP lands after the last top-level relationship touching its
 *    SOURCE's service (either endpoint counts), then past the anchor's own
 *    CLUSTER members with a smaller sort key — two edges anchored to the same
 *    statement must order by key, not by which archived first. With no such
 *    neighborhood it falls to the trailing region, cluster-head-key-sorted
 *    the same insertion-sort way, after the trailing elements.
 *
 * LikeC4 reference resolution is not order-dependent, so a relationship
 * placed before an element it names still parses; the in-memory parse net in
 * landscape-merge.ts's planLandscapeMerge stays as the backstop regardless.
 */
export interface Spot {
  /** Offset into the living text: a line start, or a point inside a shared line. */
  at: number;
  /** True when `at` shares its line with other text (the closing brace, or a displaced statement) — the block must bring its own newlines. */
  bare: boolean;
}

/** A top-level statement of the living model, with everything placement asks of it. */
export interface TopStmt {
  kind: "element" | "rel";
  /** Element: its id. */
  id: string;
  /** Relationship: its placement sort key (relSortKey). */
  key: string;
  /** The service(s) this statement resolves to — one for an element, both endpoints for a rel. */
  services: string[];
  start: number;
  end: number;
}

/**
 * The living model as placement reads it: the text being spliced into, its
 * top-level statement layout, and the model block's closing brace. One value
 * because every spot is computed against all three at the same instant — a
 * layout paired with text a splice has since moved would place against a
 * document that no longer exists (see `modelRegion` in landscape-merge.ts's
 * planLandscapeMerge).
 */
export interface ModelRegion {
  text: string;
  stmts: TopStmt[];
  close: number;
}

/** The model's top-level statements in document order, joined to the parsed elements for services. */
export function topStatements(scan: ScannedModel, els: Elem[]): TopStmt[] {
  const topEls = scan.elements.filter((e) => !e.id.includes("."));
  const bound = new Map(els.map((e) => [e.id, elementService(e)]));
  const stmts: TopStmt[] = topEls.map((e) => ({
    kind: "element" as const,
    id: e.id,
    key: "",
    services: [bound.get(e.id) ?? e.id],
    start: e.start,
    end: e.end,
  }));
  for (const r of scan.rels) {
    // A rel declared inside an element's body is not a top-level statement —
    // anchoring after it would splice into the parent's block.
    if (topEls.some((e) => r.start > e.start && r.start < e.end)) continue;
    stmts.push({
      kind: "rel",
      id: "",
      key: relSortKey(els, r),
      // Deliberately no `known` fleet set here: this resolution only decides
      // WHERE in the file a statement anchors, both sides of every comparison
      // resolve through the same call, and the merged document is re-parsed
      // before anything is written — a wrong grouping is cosmetic, never a
      // wrong merge.
      services: [serviceOf(els, r.source), serviceOf(els, r.target)],
      start: r.start,
      end: r.end,
    });
  }
  return stmts.sort((a, b) => a.start - b.start);
}

/**
 * The order of loam-inserted relationships that share a landing region:
 * (source title, target title, op, title) as one comparable string. Titles,
 * not ids — the delta's and the landscape's id namespaces differ, and the
 * same edge must sort identically as today's addition and as an existing
 * statement in the next archive's scan.
 */
export function relSortKey(
  els: Elem[],
  r: { source: string; target: string; title?: string; op?: string },
): string {
  return JSON.stringify([titleOf(els, r.source), titleOf(els, r.target), r.op ?? "", r.title ?? ""]);
}

/**
 * The trailing walks move in PLACEMENT UNITS, never single statements. A unit
 * is a service neighborhood: a contiguous run of top-level elements resolving
 * to one service, or a contiguous cluster of relationships grown around the
 * statements touching one — keyed by its LEADING statement's id/key. Anchored
 * inserts extend a neighborhood without changing its head, so the insertion
 * sort the trailing region maintains is over neighborhood heads, which
 * archive order cannot reshuffle. Comparing per statement instead let an
 * anchored insert legally sit a LOWER id/key after a higher one (its anchor
 * decides where it lives, not its own sort key), and a later trailing walk
 * then stopped at different statements depending on which archive had run
 * first — order-DEPENDENT bytes for features touching disjoint services, the
 * exact regime the scheme guarantees.
 */
export function elementSpot(region: ModelRegion, id: string, service: string): Spot {
  const { text, stmts, close } = region;
  let anchor: TopStmt | undefined;
  for (const s of stmts) {
    if (s.kind === "element" && s.services.includes(service)) anchor = s;
  }
  if (anchor !== undefined) return spotAfter(text, close, anchor.end);
  let i = stmts.length - 1;
  let before: TopStmt | undefined;
  while (i >= 0 && stmts[i]!.kind === "rel") {
    before = stmts[i];
    i -= 1;
  }
  while (i >= 0 && stmts[i]!.kind === "element") {
    // The same-service run ending here is one unit: skip it whole or stop
    // before it whole — an anchored member may carry any id, the run's
    // LEADING id is its sort key.
    let j = i;
    while (j > 0 && stmts[j - 1]!.kind === "element" && stmts[j - 1]!.services[0] === stmts[i]!.services[0]) j -= 1;
    if (!(stmts[j]!.id > id)) break;
    before = stmts[j];
    i = j - 1;
  }
  return before !== undefined ? beforeSpot(text, before) : closeSpot(text, close);
}

/**
 * Each top-level statement's cluster, as the index of the cluster's leading
 * statement. A relationship whose SOURCE's service some earlier relationship
 * in the same contiguous stretch already touches is an anchored join — it
 * belongs to that neighborhood wherever its own key would sort. One whose
 * source's service nothing before it touches opens a new cluster; sharing
 * only a TARGET does not join (every trailing edge into a busy hub would
 * otherwise dissolve into one giant cluster, and the trailing sort with it).
 * Recomputed from bytes alone, so the next archive sees the same units this
 * one placed.
 */
function relClusterHeads(stmts: TopStmt[]): number[] {
  const heads = stmts.map((_, i) => i);
  let head = -1;
  let services: Set<string> | null = null;
  for (let i = 0; i < stmts.length; i += 1) {
    const s = stmts[i]!;
    if (s.kind !== "rel") {
      head = -1;
      services = null;
      continue;
    }
    if (services !== null && services.has(s.services[0]!)) {
      for (const svc of s.services) services.add(svc);
    } else {
      head = i;
      services = new Set(s.services);
    }
    heads[i] = head;
  }
  return heads;
}

export function relSpot(region: ModelRegion, sourceService: string, key: string): Spot {
  const { text, stmts, close } = region;
  const heads = relClusterHeads(stmts);
  let anchorAt = -1;
  for (let i = 0; i < stmts.length; i += 1) {
    const s = stmts[i]!;
    if (s.kind === "rel" && s.services.includes(sourceService)) anchorAt = i;
  }
  if (anchorAt !== -1) {
    // Past the anchor, order among the cluster's OWN members is by key — two
    // edges anchored to the same statement must order by key, not by which
    // archived first — but the walk never leaves the cluster: the next
    // cluster is another neighborhood's, and stepping over it would depend
    // on which archive put it there.
    let last = stmts[anchorAt]!;
    for (let j = anchorAt + 1; j < stmts.length; j += 1) {
      const s = stmts[j]!;
      if (s.kind !== "rel" || heads[j] !== heads[anchorAt] || s.key >= key) break;
      last = s;
    }
    return spotAfter(text, close, last.end);
  }
  let i = stmts.length - 1;
  let before: TopStmt | undefined;
  while (i >= 0 && stmts[i]!.kind === "rel") {
    const j = heads[i]!;
    if (!(stmts[j]!.key > key)) break;
    before = stmts[j];
    i = j - 1;
  }
  return before !== undefined ? beforeSpot(text, before) : closeSpot(text, close);
}

/**
 * Insertion before an existing statement: at the start of its line when only
 * whitespace precedes it there, at the statement itself — bare, displacing it
 * onto a fresh line — when other text shares the line (a statement written on
 * the `model {` line, say). The unguarded line start spliced the block BEFORE
 * the model keyword, and the parse net refused a perfectly legal landscape.
 */
function beforeSpot(text: string, before: TopStmt): Spot {
  const ls = lineStartAt(text, before.start);
  if (/^[ \t]*$/.test(text.slice(ls, before.start))) return { at: ls, bare: false };
  return { at: before.start, bare: true };
}

/** The line following the statement that ends at `end` — clamped to the closing brace's own spot. */
function spotAfter(text: string, close: number, end: number): Spot {
  const nl = text.indexOf("\n", end);
  const at = nl === -1 ? text.length : nl + 1;
  return at > close ? closeSpot(text, close) : { at, bare: false };
}

/** The last resort: directly before the model's closing brace. */
function closeSpot(text: string, close: number): Spot {
  const ls = lineStartAt(text, close);
  if (/^[ \t]*$/.test(text.slice(ls, close))) return { at: ls, bare: false };
  return { at: close, bare: true };
}

function lineStartAt(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Where a child block enters an existing living parent: before the closing
 * brace of the parent's body, on its own line at the parent's inner indent —
 * and a parent that never had a body gains one around the child.
 */
export function nestedInsert(text: string, parent: ScannedElement, block: string): { at: number; insert: string } {
  if (parent.bodyOpen === -1) {
    return { at: parent.end, insert: ` {\n${block}\n${parent.indent}}` };
  }
  const lineStart = text.lastIndexOf("\n", parent.bodyClose - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, parent.bodyClose))) {
    return { at: lineStart, insert: `${block}\n` };
  }
  // `{ ... }` on one line — break the brace onto its own line to make room.
  return { at: parent.bodyClose, insert: `\n${block}\n${parent.indent}` };
}

/**
 * What makes two edges the same edge. Endpoints are compared by TITLE, which is
 * stable across the delta's and the landscape's id namespaces.
 *
 * An edge that carries an `op` IS that call, whatever it is titled — retitling it
 * must not merge a second copy. An edge with no `op` has only its title. The two
 * live in separate namespaces because they are separate things: an op-less edge
 * titled `authorizePayment` is not the edge whose operationId is authorizePayment,
 * and keying on `op ?? title` quietly merged only one of them.
 */
export function relKey(els: Elem[], r: Rel): string {
  const src = titleOf(els, r.source);
  const tgt = titleOf(els, r.target);
  return JSON.stringify(r.op !== undefined ? ["op", src, tgt, r.op] : ["title", src, tgt, r.title ?? ""]);
}

export function titleOf(elements: Elem[], id: string): string {
  return elements.find((e) => e.id === id)?.title ?? id;
}
