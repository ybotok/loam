import type { Elem, Rel } from "../model/model.js";

/**
 * A landscape merge the splicer could not compute. Every one is mechanical —
 * the input cannot be spliced as authored, never a judgment `--approve` may
 * override — and it is thrown at plan time, so nothing has been written.
 * `archiveErrorCode` (commands/archive/archive.ts) owns the mapping to `merge-failed`;
 * the splicer itself never names a CLI code.
 */
export class LandscapeSpliceError extends Error {}

export interface LandscapePlan {
  /** The merged landscape source, or null when everything was already there. */
  content: string | null;
  addedEls: Elem[];
  addedRels: Rel[];
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
}
