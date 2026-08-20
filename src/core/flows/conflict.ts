/**
 * Two features editing one journey, before either of them ships.
 *
 * A requirement is protected from this by a `Based-On:` pin and `loam rebase`:
 * the second archive is told the living text moved under it. A dynamic view
 * carries no pin, and the merge rule makes the consequence total — a view is
 * REPLACED whole, so whichever feature archives second discards the first's
 * journey entirely, steps, branches and all, with no diff anywhere to say so.
 *
 * The finding is `asyncapi.message-conflict`'s exactly, down to the grading: a
 * WARNING that never gates. Both deltas apply cleanly and only the two authors
 * can say which intention is the real one — refusing would block a pair of
 * features that may well be coordinated already, and the whole point is that
 * the second author is told before they archive rather than after.
 *
 * The scan is TEXT, not a parse, and both halves of that are deliberate.
 * Parsing every in-flight delta would spin up a Langium workspace per feature
 * on a path `validate --feature` runs constantly; and a delta that does not
 * parse today is exactly the one whose author has not finished, which must not
 * be the reason their claim on a journey goes unreported.
 */
import { existsSync } from "node:fs";
import { scanDynamicViews } from "../c4/splice/view-splice.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { featurePaths } from "../repo/paths.js";
import { listFeatures } from "../repo/repo.js";
import { readUtf8 } from "../staging/writes.js";
import type { Issue } from "../vocabulary/issue.js";

/** Which feature is being graded, and which journeys it claims. */
export interface FlowConflictScope {
  docsDir: DocsDir;
  featureId: string;
  /** The ids of the dynamic views this feature's delta declares tagged with its own id. */
  viewIds: string[];
  context?: FleetContext;
}

export async function flowViewConflicts(scope: FlowConflictScope): Promise<Issue[]> {
  // Paid only by a feature that actually claims a journey — the standing cost
  // `../coherence/events/lookups.ts` weighs for the message join, answered the
  // cheaper way here because this walk reads no contract and parses nothing.
  if (scope.viewIds.length === 0) return [];
  const claimed = await inFlightClaims(scope);
  return scope.viewIds.flatMap((id) => {
    const other = claimed.get(id);
    if (other === undefined) return [];
    return [
      {
        severity: "warn" as const,
        code: "flow.view-conflict" as const,
        subject: id,
        message:
          `this feature changes the dynamic view '${id}', which in-flight ${other} also changes — a view is ` +
          `replaced whole and carries no Based-On: pin, so whichever archives second discards the other's ` +
          `journey entirely; coordinate before either ships`,
      },
    ];
  });
}

/**
 * Which view id every OTHER active feature claims, by the same rule the merge
 * uses: a dynamic view its delta declares carrying that feature's own tag. An
 * untagged view in a delta is context — the merge does not carry it, so it
 * clobbers nothing and must not be reported as if it did.
 *
 * First feature wins a clash, as the message join does: one name to coordinate
 * with is enough to act on, and listing all of them would make the message
 * grow with the fleet.
 */
async function inFlightClaims(scope: FlowConflictScope): Promise<Map<string, string>> {
  const claims = new Map<string, string>();
  for (const feature of await listFeatures(scope.docsDir, {}, scope.context)) {
    if (feature.id === scope.featureId) continue;
    const delta = featurePaths(feature.dir).delta;
    if (!existsSync(delta)) continue;
    let text: string;
    try {
      text = await readUtf8(delta);
    } catch {
      // Another feature's unreadable delta is that feature's own finding
      // (`delta.invalid`, on its own `validate`). It must never be the reason
      // THIS feature's validate fails: a warning about coordination cannot be
      // worth failing closed over, and the file loam could not read is one it
      // could not have merged either.
      continue;
    }
    for (const view of scanDynamicViews(text)) {
      if (!view.tags.includes(feature.id)) continue;
      if (!claims.has(view.id)) claims.set(view.id, feature.id);
    }
  }
  return claims;
}
