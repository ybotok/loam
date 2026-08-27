/**
 * A feature's own capability deltas: `features/<FEAT>/capabilities/<id>/spec.md`.
 *
 * The business axis's answer to `specs/<svc>/spec.md`. A capability document is
 * a requirements document like any other, so a feature that changes one writes
 * a DELTA against it rather than editing the living text in place — which buys
 * the three things the living tree has never had: a `Based-On:` pin, so two PRs
 * touching one capability collide loudly instead of silently overwriting each
 * other; the delta algebra's refusals (`delta.added-duplicate`,
 * `delta.modified-unknown`, …), so a diff that lands nothing says so; and a
 * business change that ships and unships with the feature that made it.
 *
 * BOTH LIFECYCLES COEXIST AND MUST. Nothing here makes a direct edit of
 * `capabilities/<id>/spec.md` illegal — a fleet mid-adoption edits the document
 * and always has. What a feature-local delta adds is a second, safer route, and
 * a direct edit racing one surfaces as `delta.baseline-stale` instead of as
 * today's silent loss.
 *
 * ONE CALL, because the walk is already written: `readCapabilityTree`
 * implements the presence-classifies rule, the symlink-cycle guard and the
 * `compareIds` ordering over any root. Re-deriving it here for the feature side
 * would be two walks free to disagree about what a capability directory is.
 *
 * NO `FleetContext` PARAMETER, and that is load-bearing rather than stylistic:
 * `core/fleet-context.ts` imports `../capabilities.js`, so nothing under
 * `src/core/capabilities/` may import it back — a core-root↔capabilities
 * package cycle `import/no-cycle` cannot see. The memo lives on the class and
 * calls this; callers holding a context use `context.featureCapabilityDeltas`.
 */
import { readCapabilityTree, type CapabilityTree } from "../tree.js";
import { featureCapabilityDeltasDir } from "../../repo/paths.js";
import type { FeatureDir } from "../../kernel/ids/dirs.js";

/**
 * The capability documents one feature's delta carries, ordered by id.
 *
 * `present: false` — and zero readdirs — when the feature has no
 * `capabilities/` directory, which is every feature in a fleet that has not
 * adopted the axis. That short-circuit is `readCapabilityTree`'s own
 * `existsSync` and it is the whole cost such a fleet pays.
 */
export function featureCapabilityDeltas(featureDir: FeatureDir): Promise<CapabilityTree> {
  return readCapabilityTree(featureCapabilityDeltasDir(featureDir));
}
