/**
 * What `loam rebase` writes on the event axis's SURFACE half: the
 * `x-loam-baselines` record, rebuilt wholesale from what is on disk right now
 * — `core/openapi/baseline/plan.ts`'s planner itself, over component surfaces
 * instead of path items and components.
 *
 * A ROOT record rather than an in-value pin, and that is not symmetry for its
 * own sake: a slot value is always a mapping, so `x-loam-based-on` has
 * somewhere to live inside it, but a `components/schemas/<name>` value is a
 * JSON Schema — where an in-value loam key would be a schema keyword, and
 * where JSON Schema's own `true` is a legal component that no in-value key
 * survives at all.
 *
 * Rebuilt rather than patched for the reason the OpenAPI plan states: a pin is
 * a claim about what its author read, and an entry left behind for a surface
 * the delta no longer declares — or one whose living counterpart is gone — is
 * a claim nobody is making any more. The sorted serialization (`buildRecord`)
 * is what makes a second run byte-identical.
 *
 * The planner is SHARED, not mirrored: it used to be a line-for-line copy of
 * the OpenAPI one minus the path-item arm, and the only real difference was
 * which walk enumerates the surfaces. `asyncapiSurfaces` is that walk, so this
 * module passes it and owns nothing else.
 *
 * This module must not import from `../merge/`: the merge reads this package,
 * so a value edge back would be a package cycle. That is also why an
 * unreadable document is answered with "nothing to pin" rather than an
 * `AsyncapiMergeError` — every caller chains this AFTER `pinAsyncapiSlots`,
 * which has already thrown that error for a document either side cannot parse.
 */
import { planOpenapiBaselines, type OpenapiBaselinePlan } from "../../openapi/baseline/plan.js";
import { asyncapiSurfaces } from "./surfaces.js";

/**
 * Pin every component surface of a feature event contract against the living
 * one — every `kind` in the answer is `"component"`, since an event contract
 * has no path items. The rules (the LIVING digest, `unresolved` for a surface
 * the living contract lacks, the idempotent rewrite) are the shared planner's,
 * stated there once.
 */
export function planAsyncapiBaselines(featureText: string, livingText: string): OpenapiBaselinePlan {
  return planOpenapiBaselines(featureText, livingText, asyncapiSurfaces);
}
