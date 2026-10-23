/**
 * A feature's service-local flows (`features/<FEAT>/specs/<svc>/usecases/`),
 * graded with the invocation's reads — the wiring half of
 * `core/usecases/delta/service/grade.ts`, which owns every rule.
 *
 * HERE, AND NOT IN `../delta.ts`. That walk is where a feature's other flow
 * questions are asked, and it is where this one belongs by subject; it is also
 * at the file limit, and this question needs nothing that walk has already
 * read — the requirement documents it opens are memoised by the context, so
 * reading them again costs a map lookup. `core/coherence/coherence.ts` calls it
 * beside the fleet slot's collision check (`flowDeltaIssues`).
 *
 * A CONTEXT IS BUILT WHEN NONE IS HANDED IN, as `../delta.ts` builds one for
 * the living-flow walk: the archive gate grades a feature without one, and the
 * service models this reads are only reachable through it.
 */
import { existsSync } from "node:fs";
import type { StagedDocument } from "../../c4/project/staged.js";
import { extendingModels } from "../../c4/service-model/fleet/extending.js";
import { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featureSpecServices } from "../../repo/repo.js";
import { enumeratedServiceIds, locateServicePaths } from "../../repo/service-target.js";
import { serviceFlowDeltaIssues } from "../../usecases/delta/service/grade.js";
import { featureServiceFlowDir } from "../../usecases/delta/service/slot.js";
import type { Issue } from "../../vocabulary/issue.js";

export interface ServiceFlowWiring {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /**
   * The feature's documents the archive writes under `architecture/` — passed
   * in by the caller that already imports both slots, because naming the
   * topology slot here would be an edge from this package to `core/deployment/`
   * that nothing else needs (`ServiceFlowDeltaRequest.architecture` says why the
   * grade needs them at all).
   */
  architecture: () => Promise<readonly StagedDocument[]>;
  context?: FleetContext;
}

export async function featureServiceFlowIssues(req: ServiceFlowWiring): Promise<Issue[]> {
  const { docsDir, featureDir } = req;
  const services = await featureSpecServices(featureDir, req.context);
  // The slot's per-feature opt-in: one `existsSync` per service the feature
  // touches, and nothing else, for a feature that carries no service flow —
  // which is every feature in a fleet that has not adopted the slot.
  if (!services.some((service) => existsSync(featureServiceFlowDir(featureDir, service)))) return [];
  const ctx = req.context ?? new FleetContext();
  return serviceFlowDeltaIssues({
    docsDir,
    featureDir,
    featureId: req.featureId,
    services,
    enumerated: new Set(await enumeratedServiceIds(docsDir, ctx)),
    // Not enumerated is a service this feature creates: unfiled, at
    // `services/<svc>/`, where the archive writes its first documents.
    locate: (service) => locateServicePaths(docsDir, service, ctx),
    serviceModel: (paths) => ctx.serviceModel(docsDir, paths),
    readRequirements: (path) => ctx.readRequirements(path),
    load: (path) => ctx.loadLikeC4(path),
    models: () => extendingModels(docsDir, ctx),
    architecture: req.architecture,
  });
}
