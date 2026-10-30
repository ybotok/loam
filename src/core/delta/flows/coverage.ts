/**
 * What a feature's own flows are graded against, gathered for the one call
 * that grades them (`flowCoverage`, `core/usecases/delta/claims.ts`).
 *
 * IT LIVES HERE AND NOT IN THE WALK because the walk (`../delta.ts`) reached its
 * line limit the day the flows gained their obligation axis, and this is the
 * seam it already had: the walk decides WHETHER the flows are read — a feature
 * with no `usecases/` directory pays one `existsSync` — and this module says
 * what they are read against. Every comment below came with the line it
 * explains; "HERE" in them still means the feature walk, which is whose index
 * these reads go through.
 */
import { readCapabilityVocabulary } from "../../capabilities/capabilities.js";
import type { CapabilityDeltaDoc } from "../../capabilities/delta/uncovered.js";
import { extendingModels } from "../../c4/service-model/fleet/extending.js";
import { parseRequirements, readRequirementsDocument } from "../../document/parse.js";
import type { Requirement } from "../../document/spec.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { coversIndex } from "../../usecases/obligations/covers.js";
import { readObligations } from "../../obligations/obligations.js";
import { obligationsPath } from "../../repo/paths.js";
import { enumeratedServiceIds, enumeratedServices } from "../../repo/service-target.js";
import { flowCoverage, type FlowPromises } from "../../usecases/delta/claims.js";
import type { ServiceDeltaPair } from "../../usecases/delta/service/ids.js";
import type { Issue } from "../../vocabulary/issue.js";

/** The feature walk's state the flows are graded against. */
export interface FeatureFlowCoverageRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /** The services this feature's `specs/` names. */
  services: readonly string[];
  /** The feature's capability deltas, as the walk parsed them. */
  capabilities: readonly CapabilityDeltaDoc[];
  /** Each service axis's delta beside its living text, as the walk parsed them — folded into the `Covers:` index. */
  pairs: readonly ServiceDeltaPair[];
  context?: FleetContext;
}

/** The promises a feature's own flows keep and the issues they earn — `flowCoverage`'s answer, with its inputs read. */
export async function featureFlowCoverage(req: FeatureFlowCoverageRequest): Promise<{ promises: FlowPromises; issues: Issue[] }> {
  const { docsDir, context } = req;
  // Decoded or refused by name (`readRequirementsDocument`), never `readFile`'s
  // utf8 — a UTF-16 capability document would read as no requirements and
  // convict every flow naming it.
  const read = async (path: string): Promise<Requirement[]> =>
    context === undefined ? parseRequirements(await readRequirementsDocument(path)) : await context.readRequirements(path);
  return flowCoverage({
    docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    capabilities: req.capabilities,
    // Read HERE, through the invocation's index, because this module holds
    // it and `core/usecases/` does not — every other read in this walk does
    // the same, and `core/repo/service-target.ts` prices a fleet
    // enumeration per call at ~13 ms on a 120-service fleet.
    vocabulary: context === undefined ? await readCapabilityVocabulary(docsDir) : await context.capabilities(docsDir),
    // The fleet the merge leaves: each `specs/<svc>/` of this feature becomes a
    // `services/<svc>/`, so a hop into a service it introduces resolves to that
    // service in the grade, as it will under the next `validate --all`.
    known: new Set([...(await enumeratedServiceIds(docsDir, context)), ...req.services]),
    read,
    // A function rather than the context itself: one memoised LikeC4 read
    // does not justify an edge from `core/usecases/` to `fleet-context`, and
    // the edge would push that package up a DAG level for nothing.
    ...(context === undefined ? {} : { load: (path: string) => context.loadLikeC4(path) }),
    // The fleet's extending models, for the merge preview the overlay
    // grades against — read HERE for `vocabulary`'s reason exactly, and as
    // a thunk so the walk pays for it only when a flow is really there.
    // Without it the preview is the pre-routing map and `usecase.flow-invalid`
    // fails open on the one shape it exists for: a hop into
    // `<service-fqn>.<container>`, which the archive routes into that
    // service's own model (verification 2026-09-04, review F8).
    models: () => extendingModels(docsDir, context),
    // The flows' `#obl-` tags: the LIVING vocabulary, and the `Covers:` index
    // with this feature's own deltas folded in, so an arch requirement it adds
    // for a hop answers the hop in the same change. Both thunks, read only when
    // a flow really carries the tag — the index is a read of every service's
    // two requirement documents.
    obligations: {
      vocabulary: () => readObligations(obligationsPath(docsDir)),
      covers: async () =>
        coversIndex({
          services: await enumeratedServices(docsDir, context),
          read,
          deltas: req.pairs.map((p) => ({ service: p.id, axis: p.axis, reqs: p.reqs, living: p.living })),
        }),
    },
  });
}
