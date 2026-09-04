/**
 * The other half of the archive's C4 merge: what a feature adds INSIDE a
 * service, spliced into the service's own extending `model.likec4`.
 *
 * `../landscape-merge.ts` routes the additions (`../identity/owner.ts` states
 * the rule) and this carries them over, by the same discipline: authored source,
 * byte for byte,
 * with the feature's own tag stripped and the indentation rebased — never a
 * re-serialization of the parsed model, which keeps only the fields loam models.
 *
 * PLACEMENT IS SIMPLER HERE, and deliberately so. The map groups additions by
 * service because every service writes into it and concurrent archives must
 * merge in git; a service model has ONE service in it, so there is no
 * neighborhood to join. An element lands inside the `extend <fqn> { … }` block
 * that owns its parent — or inside its parent's own block when the model
 * already declares that container — and a model with no `extend` block for the
 * fqn gains one at the end of its `model { }` block, as a model with no `model
 * { }` block at all gains that. A relationship lands after the last top-level
 * relationship of that block, or last in it.
 *
 * WHAT THIS DOES NOT DO IS PROVE THE RESULT. The landscape merge parses its own
 * output because a landscape is a self-contained document; an extending model
 * is not — it is read beside the `architecture/` project, and staging that set
 * means touching the docs repo. So the parse net lives with the caller
 * (`commands/archive/plan/model/extending.ts`), which is also the side that
 * holds the merged MAP the model must be proven against.
 */
import type { Elem } from "../../likec4.js";
import { scanModel, type ScannedModel, type ScannedRel } from "../../source-scan.js";
import { matchLineEndings, spliceSource } from "../authored-source.js";
import { LandscapeSpliceError, type ModelAdditions } from "../contract.js";
import { relStatementKey } from "../identity/edges.js";
import { closeSpot, nestedInsert, spotAfter } from "../placement.js";

export interface ModelMergeRequest {
  /** One model's share of the merge, as `planLandscapeMerge` routed it. */
  additions: ModelAdditions;
  /** delta.likec4 as authored — the bytes the additions are spliced from. */
  deltaText: string;
  featureId: string;
}

/** The merged model source. Refuses (never guesses) when the delta or the model cannot be read. */
export function spliceModel(req: ModelMergeRequest): string {
  const { additions, deltaText, featureId } = req;
  const { model } = additions;
  const scan = scanModel(deltaText);
  if (scan === null) {
    throw new LandscapeSpliceError("delta.likec4 has no model block — nothing to splice the additions from");
  }
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = relStatementKey(s);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }

  let content = withModelBlock(model.text);
  let live = read(content, model.path);
  // The delta ranges already carried over, so a child whose parent is itself
  // new is recognised as riding inside the parent's text — the same rule the
  // landscape merge states, and the reason `node` inside a new `cache` is never
  // spliced twice.
  const spliced: Array<{ start: number; end: number }> = [];
  const rides = (start: number, end: number): boolean =>
    spliced.some((r) => start >= r.start && end <= r.end);
  const applyAt = (at: number, insert: string): void => {
    content = content.slice(0, at) + insert + content.slice(at);
    live = read(content, model.path);
  };

  // Ancestors first, exactly as the landscape merge orders them: a spliced
  // parent covers its children before they are seen.
  const depth = (id: string): number => id.split(".").length;
  const ordered = [...additions.els].sort(
    (a, b) => depth(a.id) - depth(b.id) || (byId.get(a.id)?.start ?? 0) - (byId.get(b.id)?.start ?? 0),
  );
  for (const e of ordered) {
    const src = byId.get(e.id);
    if (src === undefined) {
      throw new LandscapeSpliceError(
        `cannot locate '${e.id}' in delta.likec4 — the model merge splices authored source, and this declaration was not found`,
      );
    }
    if (rides(src.start, src.end)) continue;
    const [at, insert] = elementInsert({
      content,
      live,
      block: (indent) => spliceSource(deltaText, src, { featureId, indent }),
      parent: parentIdOf(e),
    });
    applyAt(at, insert);
    spliced.push({ start: src.start, end: src.end });
  }

  for (const r of additions.rels) {
    const s = pool.get(relStatementKey(r))?.shift();
    if (s === undefined) {
      throw new LandscapeSpliceError(
        `cannot locate the '${r.source} -> ${r.target}' relationship in delta.likec4 — the model merge splices authored source, and no matching declaration was found`,
      );
    }
    if (rides(s.start, s.end)) continue;
    const base = blockIndent(content, live.close);
    // Top-level in the model block: an edge written inside an `extend` block is
    // that block's, and anchoring after it would splice into someone's body.
    const top = live.rels.filter((x) => !live.elements.some((el) => x.start > el.start && x.start < el.end));
    const anchor = top.at(-1);
    const spot = anchor === undefined ? closeSpot(content, live.close) : spotAfter(content, live.close, anchor.end);
    const block = spliceSource(deltaText, s, { featureId, indent: `${base}  ` });
    applyAt(spot.at, spot.bare ? `\n${block}\n` : `${block}\n`);
  }
  // The delta's newlines are not necessarily this model's, and a merge that left
  // both conventions in one file is noise in every editor and every diff — the
  // same correction the landscape merge makes, from the same helper
  // (verification 2026-09-04, W-CRLF).
  return matchLineEndings(model.text, content);
}

/** The parent an addition nests under. Routing only ever sends nested ids here. */
function parentIdOf(e: Elem): string {
  return e.id.slice(0, e.id.lastIndexOf("."));
}

interface ElementInsert {
  content: string;
  live: ScannedModel;
  /** The authored block at a given indent — computed late, because the indent depends on where it lands. */
  block: (indent: string) => string;
  parent: string;
}

/**
 * Where one element's block goes, as `(offset, text)`.
 *
 * Two arms, and the second is the one that makes a freshly adopted service
 * work: a model that has never named this container's parent has no `extend`
 * block for it, so the merge writes one rather than refusing. A parent the
 * merged project will not resolve is caught by the caller's parse net, which is
 * the only reader that can see the map and the model together.
 */
function elementInsert(req: ElementInsert): [number, string] {
  const { content, live, block, parent } = req;
  const declared = live.elements.find((x) => x.id === parent);
  if (declared !== undefined) {
    const nested = nestedInsert(content, declared, block(`${declared.indent}  `));
    return [nested.at, nested.insert];
  }
  const base = blockIndent(content, live.close);
  const body = `${base}  extend ${parent} {\n${block(`${base}    `)}\n${base}  }`;
  const spot = closeSpot(content, live.close);
  return [spot.at, spot.bare ? `\n${body}\n` : `${body}\n`];
}

/**
 * The model, with a `model { }` block appended when the file has none.
 *
 * `../../service-model/shape.ts` answers `extending` for an empty file, a
 * views-only file and a tags-only `specification { }` — three shapes it calls
 * legal on purpose — so routing hands those models a nested addition, and
 * refusing there took a whole legal shape away from `loam archive` for a
 * document the merge is perfectly able to author (review of E1: before the
 * routing existed, the same delta merged onto the map). It is the call
 * `elementInsert` already makes one level down — a model that has never named
 * the parent gains the `extend` block rather than refusing — and the caller's
 * parse net proves the result either way.
 */
function withModelBlock(text: string): string {
  if (scanModel(text) !== null) return text;
  const pad = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${pad}model {\n}\n`;
}

/**
 * The model's `model { }` block, re-scanned after every splice so each addition
 * lands in the text the previous one left — the landscape merge's rule, for the
 * same reason: placement composes per statement, not per archive.
 *
 * `withModelBlock` guarantees the FIRST read finds one, so a null here means a
 * splice destroyed the block it was writing into: mechanical, so it refuses at
 * plan time with nothing written, exactly as the parse nets do.
 */
function read(content: string, path: string): ScannedModel {
  const scan = scanModel(content);
  if (scan === null) {
    throw new LandscapeSpliceError(
      `merging this feature's additions left ${path} without a model block — nothing was written; re-run after reporting it`,
    );
  }
  return scan;
}

/** The indentation of the line the model block's closing brace sits on, or "" when it shares one. */
function blockIndent(text: string, close: number): string {
  const lineStart = text.lastIndexOf("\n", close - 1) + 1;
  const before = text.slice(lineStart, close);
  return /^[ \t]*$/.test(before) ? before : "";
}
