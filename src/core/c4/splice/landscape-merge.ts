
import { elementService, loadSource, serviceOf, type Elem, type Rel } from "../likec4.js";
import { scanModel, type ScannedElement, type ScannedModel, type ScannedRel } from "../source-scan.js";
import { spliceSource } from "./authored-source.js";
import { LandscapeSpliceError, type LandscapeMergeRequest, type LandscapePlan } from "./contract.js";
import {
  elementSpot,
  nestedInsert,
  relKey,
  relSortKey,
  relSpot,
  topStatements,
  type ModelRegion,
  type Spot,
} from "./placement.js";

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

/**
 * Plan the merge of the feature's new elements + relationships into the living
 * landscape's `model { ... }` block (preserving the rest of the file).
 *
 * The additions are SPLICED from delta.likec4 as authored — byte for byte,
 * technology, style, icons, links, metadata, nested children and all — never
 * re-serialized from the parsed model: a rebuild keeps only the fields loam
 * models, and every field it forgets is authored detail destroyed. The one
 * edit on the way over is dropping the feature's own tag — the additions are
 * baseline now (SCHEMA.md documents the drop as why unarchive restores bytes
 * instead of recomputing) — and a construct the strip empties goes with it.
 *
 * Placement is deterministic and SERVICE-GROUPED (the spot* helpers in
 * placement.ts):
 * a top-level addition lands beside what already belongs to its service, so
 * two concurrent archives touching different services usually splice on
 * different lines and git merges their PRs — the single shared append point
 * every archive used to hit made two concurrent archives conflict BY
 * CONSTRUCTION. A NESTED element lands inside its parent's block — inside the
 * living parent when the landscape already has it, riding verbatim inside the
 * spliced parent when the parent is new from the same delta — never as a flat
 * dotted id at top level, which LikeC4 rejects. The additions carry no marker
 * comment: which archive added what is the git history's to say.
 *
 * Existence is checked semantically against the parsed landscape (by element
 * id/title and by edge identity), so re-archiving is idempotent and title
 * strings appearing elsewhere in the source cause no false skips. Assumes the
 * delta reuses the landscape's element identifiers for existing services. A
 * title match whose two sides are BOTH bound to different services is not an
 * existence hit but a collision, and refuses the archive (see the guard).
 *
 * Splicing is text surgery, so the computed result is PARSED before it is
 * returned: a merged landscape LikeC4 rejects refuses the archive at plan time
 * (merge-failed, nothing written — the unparseable-delta discipline) instead
 * of landing in the living docs.
 */
export async function planLandscapeMerge(merge: LandscapeMergeRequest): Promise<LandscapePlan> {
  const { landscapeText: text, deltaText, deltaElements, newEls, newRels, featureId } = merge;
  const land = await loadSource(text);
  if (land.errors.length > 0) {
    throw new LandscapeSpliceError(`landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
  }
  const haveIds = new Set(land.elements.map((e) => e.id));
  // The title join needs the matched element back, not just membership: the
  // cross-service guard below compares service BINDINGS across the join.
  const byTitle = new Map<string, Elem[]>();
  const seeTitle = (el: Elem): void => {
    byTitle.set(el.title, [...(byTitle.get(el.title) ?? []), el]);
  };
  for (const el of land.elements) seeTitle(el);
  const addedEls: Elem[] = [];
  for (const e of newEls) {
    if (haveIds.has(e.id)) continue;
    const sameTitle = byTitle.get(e.title);
    if (sameTitle !== undefined) {
      // A title match is the id-less fallback join, and skipping on it is only
      // safe when the two sides could be the same box. When both sides carry an
      // explicit `metadata { service }` binding and every binding disagrees,
      // they are provably DIFFERENT services' boxes sharing a title ('API',
      // 'Database') — the skip would silently drop the addition, and any delta
      // edge into it would then refuse the whole archive at the parse net
      // below with a message about nothing. Refuse here instead, at plan time,
      // naming both sides.
      if (e.service !== undefined && sameTitle.every((m) => m.service !== undefined && m.service !== e.service)) {
        const m = sameTitle[0]!;
        throw new LandscapeSpliceError(
          `the delta's '${e.id}' (bound to service '${e.service}') shares the title '${e.title}' with '${m.id}' (bound to service '${m.service}') — a title join across services would silently drop the addition; ` +
            `retitle one of them, or reuse the id '${m.id}' if they really are the same element`,
        );
      }
      // KNOWN (narrowed by the guard above): with EITHER side unbound the title
      // join stays trusting — the unbound title-fallback is the legal legacy
      // pattern — so a cross-service collision hiding behind an unbound element
      // is still silently skipped here. Scoping titles per service is backlog.
      continue;
    }
    haveIds.add(e.id);
    seeTitle(e);
    addedEls.push(e);
  }

  // Edges are matched by COUNT, not by membership: two edges the model cannot tell
  // apart are still two edges, and dropping the second one silently loses a call
  // the author drew. An edge already in the landscape consumes one delta edge of
  // the same identity, which is what keeps re-archiving idempotent.
  const have = new Map<string, number>();
  for (const r of land.relationships) {
    const k = relKey(land.elements, r);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const addedRels: Rel[] = [];
  for (const r of newRels) {
    const k = relKey(deltaElements, r);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    addedRels.push(r);
  }

  if (addedEls.length === 0 && addedRels.length === 0) return { content: null, addedEls, addedRels };

  const scan = scanModel(deltaText);
  if (scan === null) {
    throw new LandscapeSpliceError("delta.likec4 has no model block — nothing to splice the additions from");
  }

  // Everything below either locates a declaration's authored bytes or refuses.
  // `spliced` remembers the delta ranges already carried over, so a child whose
  // parent is itself new is recognised as riding inside the parent's text and
  // is never inserted twice.
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const spliced: Array<{ start: number; end: number }> = [];
  const rides = (start: number, end: number): boolean =>
    spliced.some((r) => start >= r.start && end <= r.end);

  // The living model, scanned on MASKED source (scanModel) and RE-SCANNED
  // after every splice: each addition lands in the text exactly as the
  // previous one left it, so an archive of N additions produces the same
  // bytes as N single-addition archives run back to back. Placement then
  // composes per statement — the unit the order-independence argument below
  // is stated in — instead of per archive, where a batch computed against a
  // stale layout could interleave with itself. Masking matters — a `model {`
  // spelled inside a comment or string above the real block must not capture
  // the match, or every top-level addition lands inside the comment (legal
  // LikeC4, so the parse net below would pass a landscape containing none of
  // the architecture).
  let content = text;
  // Service binding for placement: living elements first (they win a shared
  // id), the delta's after — a spliced statement's id resolves to its service
  // the moment its bytes land in the scan.
  const bindEls = [...land.elements, ...deltaElements.filter((d) => !land.elements.some((l) => l.id === d.id))];
  let livingScan = scanModel(content);
  let stmts = livingScan === null ? [] : topStatements(livingScan, bindEls);
  const rescan = (): void => {
    livingScan = scanModel(content);
    stmts = livingScan === null ? [] : topStatements(livingScan, bindEls);
  };
  const requireModel = (): ScannedModel => {
    if (livingScan === null) throw new LandscapeSpliceError("landscape.likec4 has no model block");
    return livingScan;
  };
  // Built fresh at every use, never captured: `content` and `stmts` are rebound
  // by each rescan, and a region assembled before a splice describes a document
  // that no longer exists.
  const modelRegion = (): ModelRegion => ({ text: content, stmts, close: requireModel().close });
  const applyAt = (at: number, insert: string): void => {
    content = content.slice(0, at) + insert + content.slice(at);
    rescan();
  };
  const applyTop = (spot: Spot, block: string): void => {
    // A bare spot shares its line with other text (the closing brace, or a
    // statement the block displaces) — it brings its own newlines; a
    // line-start spot slots between lines.
    applyAt(spot.at, spot.bare ? `\n${block}\n` : `${block}\n`);
  };

  // Placement walks the scanned statement layout, so a declaration the scan
  // cannot see is one placement would blindly splice around — LikeC4 accepts
  // two declarations on one line, but scanModel's statement head runs to the
  // end of the line, so the second rides invisibly inside the first: an
  // element bound to its service would miss its neighborhood, and a bodyless
  // parent gaining a body could wrap the wrong declaration. Refuse
  // mechanically (the parse-net discipline) instead of splicing blind.
  if (livingScan !== null) {
    const seen = new Set(livingScan.elements.map((e) => e.id));
    const invisible = land.elements.find((e) => !seen.has(e.id));
    if (invisible !== undefined) {
      throw new LandscapeSpliceError(
        `landscape.likec4 declares '${invisible.id}' in a form placement cannot locate — most often two declarations sharing one line; give each its own line, then re-run`,
      );
    }
    if (livingScan.rels.length < land.relationships.length) {
      throw new LandscapeSpliceError(
        `landscape.likec4 declares ${land.relationships.length} relationship(s) but placement can locate only ${livingScan.rels.length} — most often two statements sharing one line; give each its own line, then re-run`,
      );
    }
  }

  const livingParentOf = (parentId: string): ScannedElement | null => {
    if (livingScan === null) return null;
    const direct = livingScan.elements.find((e) => e.id === parentId);
    if (direct !== undefined) return direct;
    // The delta may spell an existing element under its own id; the title is
    // the stable cross-namespace name (the same rule the existence check uses).
    const title = deltaElements.find((e) => e.id === parentId)?.title;
    const livingId = title === undefined ? undefined : land.elements.find((e) => e.title === title)?.id;
    if (livingId === undefined) return null;
    return livingScan.elements.find((e) => e.id === livingId) ?? null;
  };

  // Ancestors first: a spliced parent covers its children before they are seen.
  const depth = (id: string): number => id.split(".").length;
  const sortedEls = [...addedEls].sort(
    (a, b) => depth(a.id) - depth(b.id) || (byId.get(a.id)?.start ?? 0) - (byId.get(b.id)?.start ?? 0),
  );
  for (const e of sortedEls) {
    const src = byId.get(e.id);
    if (src === undefined) {
      throw new LandscapeSpliceError(
        `cannot locate '${e.id}' in delta.likec4 — the landscape merge splices authored source, and this declaration was not found`,
      );
    }
    if (rides(src.start, src.end)) continue;
    const dot = e.id.lastIndexOf(".");
    if (dot === -1) {
      const spot = elementSpot(modelRegion(), e.id, elementService(e));
      applyTop(spot, spliceSource(deltaText, src, featureId, "  "));
      spliced.push({ start: src.start, end: src.end });
      continue;
    }
    const parentId = e.id.slice(0, dot);
    const parent = livingParentOf(parentId);
    if (parent === null) {
      throw new LandscapeSpliceError(
        `'${e.id}' nests under '${parentId}', which is neither in the living landscape nor added by this delta — there is nowhere to insert it`,
      );
    }
    const nested = nestedInsert(content, parent, spliceSource(deltaText, src, featureId, parent.indent + "  "));
    applyAt(nested.at, nested.insert);
    spliced.push({ start: src.start, end: src.end });
  }

  // Relationships: match each parsed addition back to its statement in the
  // delta source — full identity (endpoints, title, all three spine keys,
  // tags), consumed one statement per addition so duplicates stay duplicates.
  // The spine keys earn their place here the same way they do in `relKey`:
  // without them two additions differing only by `publishes` share one pool
  // entry, and `shift()` hands the second one the first one's authored bytes.
  const relKeyOf = (r: Rel | ScannedRel): string =>
    JSON.stringify([r.source, r.target, r.title ?? "", r.op ?? "", r.publishes ?? "", r.consumes ?? "", [...r.tags].sort()]);
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = relKeyOf(s);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  for (const r of addedRels) {
    const s = pool.get(relKeyOf(r))?.shift();
    if (s === undefined) {
      throw new LandscapeSpliceError(
        `cannot locate the '${r.source} -> ${r.target}' relationship in delta.likec4 — the landscape merge splices authored source, and no matching declaration was found`,
      );
    }
    if (rides(s.start, s.end)) continue;
    const key = relSortKey(deltaElements, r);
    // Deliberately no `known` fleet set: this resolves only the anchor a new
    // relationship lands after (placement.ts's reason — cosmetic grouping,
    // safety-netted by the re-parse below), never which service a check
    // grades.
    const spot = relSpot(modelRegion(), serviceOf(deltaElements, r.source), key);
    applyTop(spot, spliceSource(deltaText, s, featureId, "  "));
  }

  // The safety net: prove the computed landscape parses before anything is
  // written. Splice bugs — and legal inputs the living document cannot absorb,
  // like a kind its specification never declares — refuse here, at plan time,
  // instead of corrupting the one file the whole fleet reads.
  const check = await loadSource(content);
  if (check.errors.length > 0) {
    const detail = check.errors
      .slice(0, 3)
      .map((e) => (typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message))
      .join("; ");
    throw new LandscapeSpliceError(
      `the merged landscape would not parse (${check.errors.length} error(s): ${detail}) — nothing was written. ` +
        `The delta's additions do not fit the living landscape as authored — most often an element kind or tag ` +
        `its specification block does not declare; fix the landscape's specification or the delta, then re-run`,
    );
  }

  return { content, addedEls, addedRels };
}
