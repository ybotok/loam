/**
 * A service that exists so far only inside a feature in flight.
 *
 * Until a feature archives, the one place a service it INTRODUCES has a
 * directory at all is the feature's own `specs/<service>/` — `services/` learns
 * the name at the merge. Every command that resolved a service through the
 * `services/` enumeration alone therefore refused the newest service in the
 * fleet with "no such service", while `loam tasks` (which reads the feature's
 * claim subjects) listed work for it on the same tree, and `loam status`, run
 * from that service's own repository, told its developer to `loam adopt` code
 * that has not been written yet. One answer for all of them, here.
 *
 * "Introduces" is the directory fact and nothing more: an active feature
 * carries `specs/<service>/` and the living docs carry no `services/<service>/`.
 * A service the living docs already hold is modified by a feature, never
 * introduced by one, whatever the delta draws — so a living entry always wins
 * and the answer is empty.
 */
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { FeatureEntry } from "../repo/entries.js";
import { listFeatures, listServices } from "../repo/repo.js";

/**
 * The active features whose `specs/` introduce `service`, ordered by id — empty
 * when the service is living, or when no feature in flight names it. Archived
 * features never count: once one archives, the service is living.
 */
export async function introducingFeatures(
  docsDir: DocsDir,
  service: string,
  context?: FleetContext,
): Promise<FeatureEntry[]> {
  const living = await listServices(docsDir, context);
  if (living.some((s) => s.id === service)) return [];
  const active = await listFeatures(docsDir, {}, context);
  return active.filter((f) => f.services.some((s) => s === service));
}
