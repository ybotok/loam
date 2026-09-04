
import { parentIdOf } from "../../kernel/ids/fqn/ancestors.js";
import { errorText, loadSource, type Elem, type Rel } from "../likec4.js";
import { elementService, serviceOf } from "../resolve/service.js";
import { scanModel, type ScannedElement, type ScannedModel, type ScannedRel } from "../source-scan.js";
import { matchLineEndings, spliceSource } from "./authored-source.js";
import {
  LandscapeSpliceError,
  type ExtendingModel,
  type LandscapeMergeRequest,
  type LandscapePlan,
  type ModelAdditions,
} from "./contract.js";
import { assertMergeableDelta } from "./delta-blocks.js";
import { relSortKey, relStatementKey } from "./identity/edges.js";
import { newAdditions } from "./identity/existing.js";
import { planInteriors } from "./identity/interior.js";
import { ownerOf } from "./identity/owner.js";
import {
  elementSpot,
  nestedInsert,
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
 * Existence is checked semantically against the parsed landscape AND against
 * every extending model the request carries (by element id/title and by edge
 * identity), so re-archiving is idempotent whichever document the additions
 * landed in — `./identity/existing.ts` holds that phase and its two joins, and
 * this function only turns the collision it reports into the refusal.
 *
 * Splicing is text surgery, so the computed result is PARSED before it is
 * returned: a merged landscape LikeC4 rejects refuses the archive at plan time
 * (merge-failed, nothing written — the unparseable-delta discipline) instead
 * of landing in the living docs.
 *
 * NOT EVERYTHING LANDS HERE. A service whose model EXTENDS this map owns its
 * own interior, and an addition nested under such a service is ROUTED to that
 * model instead (`./identity/owner.ts` decides, `./model/merge.ts` splices).
 * Until it was, a delta's container landed in the map and the service was
 * `c4.invalid` — a duplicate declaration — the moment its model wrote the same
 * container, which is exactly what the adopt brief tells it to do
 * (verification 2026-09-04, E1). With no extending models in the request this
 * function behaves as it always did.
 *
 * Routing per ADDITION is not the whole of it, because a service the feature
 * INTRODUCES carries its interior in one element's authored bytes and those
 * children carry no feature tag of their own. `./identity/interior.ts` decides, once
 * per such block, whether it hands that interior to the model — cut out of what
 * lands on the map — or rides whole; the routing below DEFERS to that decision
 * for everything written inside the block, which is what keeps the two from
 * placing the same child twice.
 */
export async function planLandscapeMerge(merge: LandscapeMergeRequest): Promise<LandscapePlan> {
  const { landscapeText: text, deltaText, deltaElements, newEls, newRels, featureId } = merge;
  const models = merge.models ?? [];
  // First, and before the early return for "nothing to add": a block this merge
  // cannot carry is lost whether or not the delta also has tagged elements to
  // splice. See delta-blocks.ts.
  assertMergeableDelta(deltaText);
  const land = await loadSource(text);
  if (land.errors.length > 0) {
    throw new LandscapeSpliceError(`landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
  }
  // Service binding for the existence joins AND for routing and placement:
  // living elements first (they win a shared id), the delta's after — a spliced
  // statement's id resolves to its service the moment its bytes land in the scan.
  const bindEls = [...land.elements, ...deltaElements.filter((d) => !land.elements.some((l) => l.id === d.id))];
  // What the living fleet already has — the map AND every extending model, by id
  // and by title. `./identity/existing.ts` holds both joins and their asymmetry.
  const added = newAdditions({
    livingEls: land.elements,
    livingRels: land.relationships,
    bindEls,
    deltaElements,
    candidates: { els: newEls, rels: newRels },
    models,
  });
  if (added.collision !== undefined) {
    const { addition: e, living: m } = added.collision;
    throw new LandscapeSpliceError(
      `the delta's '${e.id}' (bound to service '${e.service}') shares the title '${e.title}' with '${m.id}' (bound to service '${m.service}') — a title join across services would silently drop the addition; ` +
        `retitle one of them, or reuse the id '${m.id}' if they really are the same element`,
    );
  }
  const addedEls = added.els;
  const addedRels = added.rels;

  const owner = ownerOf({
    bindEls,
    living: new Set(land.elements.map((e) => e.id)),
    declared: added.declaredIds,
    added: new Set(addedEls.map((e) => e.id)),
    models,
  });
  // Nothing to add: the same shape the merge returned before routing existed,
  // and the reason it is decided HERE rather than after the loops below — a
  // no-op archive must not have to scan the delta, nor answer the landscape
  // guards further down, which refuse documents this merge is not touching.
  // Equivalent to the old "nothing reached the map and nothing was routed":
  // every addition ends up in one of those two, so an empty pair means both.
  if (addedEls.length === 0 && addedRels.length === 0) {
    return { content: null, addedEls: [], addedRels: [], models: [] };
  }

  const scan = scanModel(deltaText);
  if (scan === null) {
    throw new LandscapeSpliceError("delta.likec4 has no model block — nothing to splice the additions from");
  }

  // Everything below either locates a declaration's authored bytes or refuses.
  // `spliced` remembers the delta ranges already carried over, so a child whose
  // parent is itself new is recognised as riding inside the parent's text and
  // is never inserted twice.
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  // Relationships: match each parsed addition back to its statement in the
  // delta source — full identity (`relStatementKey`), consumed one statement
  // per addition so duplicates stay duplicates. Built before the routing
  // because routing has to know WHERE an edge was written: one drawn inside a
  // block that rides whole is already on the map.
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = relStatementKey(s);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }

  const interiors = planInteriors({ scan, deltaElements, owner, addedEls });
  const routed = new Map<string, ModelAdditions>();
  const into = (model: ExtendingModel): ModelAdditions => {
    const existing = routed.get(model.path);
    if (existing !== undefined) return existing;
    const fresh: ModelAdditions = { model, els: [], rels: [] };
    routed.set(model.path, fresh);
    return fresh;
  };
  for (const share of interiors.routed) into(share.model).els.push(...share.els);

  const mapEls: Elem[] = [];
  for (const e of addedEls) {
    const src = byId.get(e.id);
    // Written inside a block that has already decided: a split block handed it
    // to the model with its siblings, and a whole one carries it onto the map
    // in the parent's own bytes, where the splice loop's `rides` finds it. Both
    // are placed exactly once, which is the point of asking the block first.
    const fate = src === undefined ? null : interiors.covering(src);
    if (fate === "split") continue;
    const model = fate === "whole" ? undefined : owner(parentIdOf(e.id));
    if (model === undefined) mapEls.push(e);
    else into(model).els.push(e);
  }
  const mapRels: Rel[] = [];
  for (const r of addedRels) {
    // An edge written inside a block that rides whole names its endpoints by
    // their LOCAL names and reads only there; it stays with its block.
    const stmts = pool.get(relStatementKey(r)) ?? [];
    const inBlock = stmts.length > 0 && stmts.every((s) => interiors.covering(s) !== null);
    // Otherwise the SOURCE decides: a call is drawn where the caller draws its
    // calls, and only when the source is not itself interior does the target's
    // owner get the edge. A service-level edge belongs to neither and stays on
    // the map.
    const model = inBlock ? undefined : owner(parentIdOf(r.source)) ?? owner(parentIdOf(r.target));
    if (model === undefined) mapRels.push(r);
    else into(model).rels.push(r);
  }
  const touchesMap = mapEls.length > 0 || mapRels.length > 0;

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
  const sortedEls = [...mapEls].sort(
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
    // Every split block's children, whichever block they belong to:
    // `spliceSource` keeps only the ranges that fall inside the bytes it is
    // carrying, so a block riding inside ANOTHER new block still loses its own
    // interior on the way to the map.
    const omit = interiors.omit;
    const dot = e.id.lastIndexOf(".");
    if (dot === -1) {
      const spot = elementSpot(modelRegion(), e.id, elementService(e));
      applyTop(spot, spliceSource(deltaText, src, { featureId, indent: "  ", omit }));
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
    const nested = nestedInsert(
      content,
      parent,
      spliceSource(deltaText, src, { featureId, indent: parent.indent + "  ", omit }),
    );
    applyAt(nested.at, nested.insert);
    spliced.push({ start: src.start, end: src.end });
  }

  // Each map-bound addition takes its statement out of the pool built above:
  // one statement per addition, so duplicates stay duplicates.
  for (const r of mapRels) {
    const s = pool.get(relStatementKey(r))?.shift();
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
    applyTop(spot, spliceSource(deltaText, s, { featureId, indent: "  " }));
  }

  // The safety net: prove the computed landscape parses before anything is
  // written. Splice bugs — and legal inputs the living document cannot absorb,
  // like a kind its specification never declares — refuse here, at plan time,
  // instead of corrupting the one file the whole fleet reads. Skipped when
  // every addition was routed away: the text is the one already parsed above,
  // and the models get their own net from the caller, which is the only side
  // that can stage a model beside the map it extends.
  // The splice composed bytes from two documents, and the delta's newlines are
  // not necessarily the map's. Corrected before the net, so what is proven is
  // what would be written.
  content = matchLineEndings(text, content);
  if (touchesMap) {
    const check = await loadSource(content);
    if (check.errors.length > 0) {
      const detail = check.errors
        .slice(0, 3)
        .map(errorText)
        .join("; ");
      throw new LandscapeSpliceError(
        `the merged landscape would not parse (${check.errors.length} error(s): ${detail}) — nothing was written. ` +
          `The delta's additions do not fit the living landscape as authored — most often an element kind or tag ` +
          `its specification block does not declare; fix the landscape's specification or the delta, then re-run`,
      );
    }
  }

  return { content: touchesMap ? content : null, addedEls: mapEls, addedRels: mapRels, models: [...routed.values()] };
}
