import type { Elem, Rel } from "../likec4.js";
import type { ScanKinds, ScannedModel } from "../source-scan.js";

/**
 * A landscape merge the splicer could not compute. Every one is mechanical —
 * the input cannot be spliced as authored, never a judgment `--approve` may
 * override — and it is thrown at plan time, so nothing has been written.
 * `archiveErrorCode` (commands/archive/archive.ts) owns the mapping to `merge-failed`;
 * the splicer itself never names a CLI code.
 */
export class LandscapeSpliceError extends Error {}

/**
 * Refuse a splice the splice map cannot see once it has landed — the document
 * scanned the same number of statements after the insert as before it.
 *
 * Every insert adds at least one declaration or edge, so an unchanged count
 * means the bytes went somewhere the scan reads as nothing: inside a comment or
 * a string. LikeC4 reads it the same way, so the parse net passes a document
 * that simply lacks the addition, and the archive printed "+1 relationship(s)"
 * over an edge that was never there (review, 2026-10-22, on a block comment
 * whose last line starts with `//`). Placement is meant never to do this; this
 * is what turns a placement bug into `merge-failed` instead of silent loss.
 */
export function assertSpliceVisible(before: ScannedModel | null, after: ScannedModel | null, what: string): void {
  const count = (s: ScannedModel | null): number => (s === null ? 0 : s.elements.length + s.rels.length);
  if (count(after) > count(before)) return;
  throw new LandscapeSpliceError(
    `placing '${what}' would land it where neither the splice map nor LikeC4 reads it — inside a comment or a string — ` +
      `so the merge would lose it while reporting it merged; nothing was written. Move the comment it would land in, ` +
      `then re-run, and report the shape`,
  );
}

/**
 * A service whose `model.likec4` EXTENDS the fleet map — the document that owns
 * that service's interior, and therefore the one a nested addition belongs in.
 *
 * The merge takes these as TEXT already in hand, exactly as it takes the
 * landscape: reading the fleet and writing the result stay with the caller.
 * A service with a standalone model, or none, is simply absent from the list,
 * and the merge then behaves as it did before the extending shape existed.
 */
export interface ExtendingModel {
  /** The `services/<…>/<svc>` directory name — what an element's binding resolves to. */
  service: string;
  /** Repo-relative and `/`-separated: what a message names and where the caller writes. */
  path: string;
  /** The living model source, as authored. */
  text: string;
}

/** What one extending model owes this feature — routed, not yet spliced. */
export interface ModelAdditions {
  model: ExtendingModel;
  els: Elem[];
  rels: Rel[];
  /**
   * The kinds the model borrows from the map it extends, read off the landscape
   * this merge spliced: a model declares none of its own, and its scan cannot
   * see a `kind name` declaration or an `a .kind b` edge without them.
   */
  borrowed: ScanKinds;
}

/**
 * The tags each relationship kind of the DELTA gives every edge of that kind —
 * its `specification.relationshipKindTags`. The parsed additions carry them and
 * the delta's statements do not, so the splice needs the table to match one to
 * the other (`./identity/edges.ts`, `scannedStatementKey`).
 */
export type KindTags = Readonly<Record<string, readonly string[]>>;

export interface LandscapePlan {
  /** The merged landscape source, or null when everything was already there. */
  content: string | null;
  addedEls: Elem[];
  addedRels: Rel[];
  /**
   * The additions this merge routed AWAY from the map, per model that owns
   * them. Empty when the request named no extending models — the shape every
   * caller had before the routing existed. `./model/merge.ts` turns each entry
   * into that model's merged text.
   */
  models: ModelAdditions[];
}

/**
 * Everything the landscape splicer reads, as text and parsed views already in
 * hand. The merge is a pure text-to-text computation — reading the two files
 * (and deciding to write the result) stays with the caller, which is also what
 * keeps the splicer free of the staging layer.
 */
export interface LandscapeMergeRequest {
  /** The living landscape.likec4, decoded by the caller's readUtf8. */
  landscapeText: string;
  /** delta.likec4 as authored — the bytes the additions are spliced from. */
  deltaText: string;
  /** EVERY element the delta declares — the title join and the parent lookup read past the tagged ones. */
  deltaElements: Elem[];
  /** The delta's elements tagged with the feature: the candidate additions. */
  newEls: Elem[];
  /** The delta's relationships tagged with the feature. */
  newRels: Rel[];
  featureId: string;
  /** The delta's relationship kinds' tags. Omitted reads as a delta whose kinds carry none. */
  deltaKindTags?: KindTags;
  /**
   * The fleet's extending models. Omitted (or empty) is the pre-extending
   * behaviour byte for byte: every addition lands on the map.
   */
  models?: readonly ExtendingModel[];
}
