/**
 * The fleet's capability vocabulary AS THIS FEATURE'S MERGE WOULD LEAVE IT —
 * the living declarations unioned with what the feature's own capability deltas
 * add.
 *
 * WHY THIS EXISTS AT ALL. Without it the axis's headline flow is refused by an
 * error code of its own making. `capabilityRequirementIndex` builds from
 * `vocab.tree.docs`, the LIVING tree, and `realizesUnknownIssues` runs against
 * it inside a feature delta as an ERROR that gates archive. So an author who
 * writes `CHECKOUT-REFUND-ONCE` into
 * `features/FEAT-9/capabilities/checkout/spec.md` and
 * `Realizes: checkout#CHECKOUT-REFUND-ONCE` into
 * `features/FEAT-9/specs/billing/spec.md` — the two halves of one change, in one
 * feature — is told the target does not exist. It does not exist YET, and the
 * same archive that would land the pointer lands the promise it points at.
 *
 * THE GRADE IS TAKEN AGAINST THE POST-MERGE FLEET, which is the only reading
 * under which both directions of the join mean anything inside a feature. It is
 * the same judgement the contract axis already makes one axis over, where
 * `spec-api.op-undefined` is graded against feature ∪ living rather than living
 * alone.
 *
 * IT WIDENS; IT MUST NOT BLIND. Every entry naming something neither side
 * declares still fails, with the same message and the same close-name
 * candidates — now drawn from the widened set, so a typo against a requirement
 * the same feature is adding gets the useful suggestion rather than a list of
 * ids the author was not writing about.
 *
 * THE LADDER SURVIVES. An unreadable `architecture/capabilities.yaml` is still
 * `invalid`, and `declared: null` still suspends the whole family: a feature
 * delta cannot make an unreadable vocabulary readable, and grading a hundred
 * entries against a file nobody can parse is the cascade `../findings.ts`
 * suppresses.
 */
import type { Requirement } from "../../document/spec.js";
import type { Capability, CapabilityVocabulary } from "../capabilities.js";
import type { CapabilityRequirementIndex } from "../realizes/join.js";

/** One capability document a feature's delta carries, already parsed. */
export interface FeatureCapabilityDelta {
  /** The capability id — the directory chain under `features/<FEAT>/capabilities/`. */
  id: string;
  /** The delta document's requirements, kinds and all. */
  reqs: Requirement[];
}

/**
 * The vocabulary a feature's deltas would leave behind: every living
 * declaration, plus every capability id this feature introduces.
 *
 * `present` widens too, and that is the point rather than a side effect: a
 * feature writing the fleet's FIRST capability document is what creates
 * `capabilities/`, so it is the act of opting in. Grading its own joins against
 * the vocabulary it is about to create catches the typo before the merge; the
 * alternative — silence until the document is living — reports the same typo on
 * somebody else's next `validate --all`, against a document they did not write.
 *
 * `tree` is deliberately NOT widened. It lists the LIVING documents under
 * `capabilities/`, and `capabilityRequirementIndex` reads every one of them and
 * declares every non-REMOVED requirement it finds. Splicing a feature's delta
 * path into that list would apply the living rule to a delta — which is right
 * for ADDED and wrong for BASE, the kind a delta uses to QUOTE living context
 * and that the merge never writes. The feature side arrives through
 * `withFeatureRequirements` below instead, where the delta kinds decide.
 *
 * An id a feature introduces is recorded `source: "tree"` with no `spec`: the
 * tree is the side that will declare it once the merge lands, and there is no
 * living document to name yet. Nothing in the feature-grading path reads either
 * field — they exist for the fleet-scope messages, which never see this value.
 */
export function withFeatureCapabilities(
  vocab: CapabilityVocabulary,
  ids: readonly string[],
): CapabilityVocabulary {
  if (ids.length === 0) return vocab;
  const byId = new Map<string, Capability>(vocab.byId);
  for (const id of ids) {
    if (byId.has(id)) continue;
    byId.set(id, { id, source: "tree" });
  }
  return { ...vocab, present: true, byId };
}

/**
 * The `Realizes:` index a feature's deltas would leave behind: the living
 * requirement ids per capability, plus the ids this feature ADDS or MODIFIES.
 *
 * ADDED and MODIFIED, never REMOVED and never BASE.
 *
 * BASE is where the exclusion earns its keep: a `## Requirements` section
 * inside a delta QUOTES living context for a reader, and the merge never writes
 * it — so an id appearing only there will not exist after the archive either,
 * and widening on it would resolve a `Realizes:` in silence and leave the fleet
 * holding a pointer at a promise nobody ever wrote.
 *
 * REMOVED is excluded for honesty rather than for effect. A REMOVED requirement
 * that names something living is already in the index through the LIVING half,
 * so leaving it out changes no answer; what it must not do is make a delta that
 * removes something absent — already `delta.removed-unknown` — look resolvable
 * on top of that.
 *
 * WHAT THIS DOES NOT CLOSE, stated because the shape invites the assumption: a
 * feature that REMOVES a capability requirement a LIVING service requirement
 * realizes archives clean, and the next `validate --all` reports
 * `capability.realizes-unknown` against a service document nobody touched.
 * Catching that needs the join taken in the other direction — the living
 * `Realizes:` corpus against this feature's removals — which is the mirror of
 * the ROADMAP's `capability.uncovered` and belongs with it, not here.
 *
 * A capability the feature introduces gets an entry even when its delta adds no
 * requirements, and the empty set is a real answer rather than a filler: it is
 * what tells `resolveRealizes` to say "declares no requirements yet" instead of
 * "has no document at all", which are two different fixes.
 *
 * `declared === null` returns the index untouched — the ladder, one level down.
 */
export function withFeatureRequirements(
  index: CapabilityRequirementIndex,
  deltas: readonly FeatureCapabilityDelta[],
): CapabilityRequirementIndex {
  if (index.declared === null || deltas.length === 0) return index;
  const byCapability = new Map<string, ReadonlySet<string>>(index.byCapability);
  for (const delta of deltas) {
    const ids = new Set(byCapability.get(delta.id) ?? []);
    for (const r of delta.reqs) {
      if (r.kind !== "ADDED" && r.kind !== "MODIFIED") continue;
      if (r.id !== undefined) ids.add(r.id);
    }
    byCapability.set(delta.id, ids);
  }
  return { declared: index.declared, byCapability };
}
