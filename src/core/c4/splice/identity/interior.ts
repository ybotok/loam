/**
 * `./owner.ts`'s question one construct up: not "whose interior is this id" but
 * "does this whole NEW BLOCK hand its interior over" — decided ONCE per block,
 * and read by BOTH halves of the archive's routing.
 *
 * A service the feature INTRODUCES arrives as one tagged element whose authored
 * bytes already hold its containers. Those containers carry no feature tag of
 * their own — LikeC4 does not inherit tags — so per-addition routing cannot see
 * them: they rode onto the map inside their parent, and the service's extending
 * model could then never declare them, because writing the container the adopt
 * brief prescribes made the map's copy a duplicate and the service `c4.invalid`
 * (verification 2026-09-04, refutation of E1). So the box lands on the map
 * without its interior and the children go into the model's `extend <fqn> { }`
 * block, which `../model/merge.ts` creates.
 *
 * ONE DECISION, NOT TWO, and that is the whole reason this is a module rather
 * than a closure inside `../landscape-merge.ts`. A child of such a block CAN
 * carry the feature tag, and then both halves see it: per-addition routing reads
 * its tag and sends it to the model, while the block decision leaves the same
 * child's bytes on the map. Each half was right on its own and the merge
 * declared the child twice — `merge-failed`, exit 1, nothing written, on a delta
 * neither half was wrong about (re-verification 2026-09-04). `covering` is what
 * makes the routing defer: a declaration written inside a block is the BLOCK's
 * to place, whether or not it is tagged.
 *
 * A block holding a RELATIONSHIP statement rides whole. Such an edge names its
 * endpoints by their LOCAL names inside the block, and the model merge anchors a
 * relationship at the model block's top level — splitting the two apart would
 * leave the map naming children it no longer declares, and `api -> worker` at a
 * model's top level resolves to nothing. The edge rides with its block, for the
 * same reason its siblings do.
 */
import { parentIdOf } from "../../../kernel/ids/fqn/ancestors.js";
import type { Elem } from "../../likec4.js";
import type { ScannedModel } from "../../source-scan.js";
import type { SourceRange } from "../authored-source.js";
import type { ExtendingModel } from "../contract.js";

/** What one block decided about everything written inside it. */
export type BlockFate = "whole" | "split";

export interface InteriorRequest {
  /** The delta's declarations located in source — the bytes every decision is about. */
  scan: ScannedModel;
  /** EVERY element the delta declares: a child the parse does not carry cannot be routed. */
  deltaElements: readonly Elem[];
  /** Which document owns a given parent id's interior (`./owner.ts`). */
  owner: (parentId: string) => ExtendingModel | undefined;
  /** The delta's declarations this merge is adding — where the blocks are found. */
  addedEls: readonly Elem[];
}

/** One split block's share: what its service's model takes, and what the map must drop. */
export interface RoutedInterior {
  model: ExtendingModel;
  els: Elem[];
}

export interface Interiors {
  /** Delta ranges the map's spliced bytes must leave behind — the split blocks' children. */
  readonly omit: readonly SourceRange[];
  /** What each split block hands the model that owns it. */
  readonly routed: readonly RoutedInterior[];
  /**
   * The decision of the block a statement is written INSIDE, or null when no
   * block holds it and ordinary routing applies. A block's own declaration is
   * not inside itself and answers null.
   */
  covering: (at: SourceRange) => BlockFate | null;
}

export function planInteriors(req: InteriorRequest): Interiors {
  const { scan, deltaElements, owner, addedEls } = req;
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const blocks: Array<{ range: SourceRange; fate: BlockFate }> = [];
  const routed: RoutedInterior[] = [];
  const omit: SourceRange[] = [];

  for (const e of addedEls) {
    // A block is an addition that lands on the MAP (nothing owns its parent)
    // and whose own interior belongs to a model. An addition routed away is not
    // a block: its children ride inside its bytes into the same model, which is
    // `../model/merge.ts`'s own `rides` rule.
    if (owner(parentIdOf(e.id)) !== undefined) continue;
    const model = owner(e.id);
    if (model === undefined) continue;
    // Not in the scan: the splice loop refuses on its own, with the message that
    // names the declaration it could not locate.
    const src = byId.get(e.id);
    if (src === undefined) continue;
    const kids = scan.elements.filter((c) => parentIdOf(c.id) === e.id);
    if (kids.length === 0) continue;
    const els = kids
      .map((c) => deltaElements.find((x) => x.id === c.id))
      .filter((x): x is Elem => x !== undefined);
    // A child the parse does not carry is one the model merge could not splice
    // either (it splices by id), so the whole block rides rather than losing it.
    const splits = els.length === kids.length && !scan.rels.some((r) => r.start >= src.start && r.end <= src.end);
    blocks.push({ range: { start: src.start, end: src.end }, fate: splits ? "split" : "whole" });
    if (!splits) continue;
    routed.push({ model, els });
    omit.push(...kids.map((c) => ({ start: c.start, end: c.end })));
  }

  return {
    omit,
    routed,
    covering: (at) => blocks.find((b) => inside(at, b.range))?.fate ?? null,
  };
}

/** Strictly inside: the ranges of two declarations nest or are disjoint, never overlap. */
function inside(at: SourceRange, block: SourceRange): boolean {
  return at.start >= block.start && at.end <= block.end && (at.start !== block.start || at.end !== block.end);
}
