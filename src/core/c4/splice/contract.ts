import type { Elem, Rel } from "../likec4.js";

/**
 * A landscape merge the splicer could not compute. Every one is mechanical —
 * the input cannot be spliced as authored, never a judgment `--approve` may
 * override — and it is thrown at plan time, so nothing has been written.
 * `archiveErrorCode` (commands/archive/archive.ts) owns the mapping to `merge-failed`;
 * the splicer itself never names a CLI code.
 */
export class LandscapeSpliceError extends Error {}

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
}

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
  /**
   * The fleet's extending models. Omitted (or empty) is the pre-extending
   * behaviour byte for byte: every addition lands on the map.
   */
  models?: readonly ExtendingModel[];
}
