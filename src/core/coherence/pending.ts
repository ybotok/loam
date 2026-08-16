/**
 * What OTHER features in flight already define — the answer that turns "broken
 * contract" into "ordering dependency".
 *
 * Cross-service work normally lands as feature A consuming an operation that
 * in-flight feature B introduces; grading that as `op-undefined` tells the
 * author to fix a contract that is merely queued. coherence.ts downgrades to
 * the `*-pending` warnings on this module's answer. It is the openapi mirror
 * of delta.ts's `activeAdditions`, and lives beside its caller rather than in
 * delta.ts only because that module is at its size ceiling and the two
 * mirrors never share code — each reads a different axis's documents.
 */
import { featureSpecPaths } from "../repo/paths.js";
import { listFeatures } from "../repo/repo.js";
import { operations } from "../openapi/doc.js";
import type { FleetContext } from "../fleet-context.js";

/**
 * (service, operationId) pairs other ACTIVE features' openapi deltas define,
 * mapped to the feature id. Archived features are excluded: their ops are in
 * the living openapi already or gone for good, and neither is "pending". First
 * feature wins a clash — one name to archive first is enough to make progress.
 */
export async function activeOpAdditions(
  docsDir: string,
  exclude: string,
  context?: FleetContext,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const feature of await listFeatures(docsDir, {}, context)) {
    if (feature.id === exclude) continue;
    for (const service of feature.services) {
      for (const op of await operations(featureSpecPaths(feature.dir, service).openapi, context)) {
        if (op.remove) continue;
        const k = `${service} ${op.id}`;
        if (!map.has(k)) map.set(k, feature.id);
      }
    }
  }
  return map;
}
