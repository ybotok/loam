/**
 * The use-case section of `loam delta`: which business flows run through the
 * service, at which hop, and what each hop is inside the service.
 *
 * The one section of the brief that is a fact about the FLEET rather than
 * about the feature's own files. An implementer handed "add the endpoint" and
 * not told that step 4 of Checkout is the caller has to go find that out, and
 * on a fleet of a hundred nobody does. The hop join (`core/usecases/join/`)
 * answers the next question down — which of the service's own flows say what
 * that hop is inside it — and `redraw` the one after: which of those flows this
 * change makes untrue.
 *
 * Every read here gates itself. A docs repo whose `architecture/` never
 * mentions a reserved tag pays a readdir and a few file reads, a feature with
 * no `usecases/` one walk over a directory that is not there, and a service no
 * hop keys no project read at all — which is what keeps this section usable
 * inside `/loam-implement`'s inner loop.
 */
import { featureDeployments } from "../../core/deployment/delta.js";
import { serviceUseCases, type FlowsThrough, type ServiceUseCases } from "../../core/delta/flows/inside.js";
import type { Requirement } from "../../core/document/spec.js";
import { FleetContext } from "../../core/fleet-context.js";
import type { DocsDir, FeatureDir } from "../../core/kernel/ids/dirs.js";
import type { RawServiceId } from "../../core/kernel/ids/service.js";
import { featureFlows, USECASE_SUBDIR } from "../../core/usecases/delta/flows.js";

export interface DeltaUseCaseRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  service: RawServiceId;
  /**
   * `living ∪ featureServices`, the union the architecture slice resolves with,
   * so a service this feature INTRODUCES resolves to itself rather than to a
   * container's title.
   */
  known: ReadonlySet<string>;
  reqs: readonly Requirement[];
  archReqs: readonly Requirement[];
}

export async function deltaUseCases(req: DeltaUseCaseRequest): Promise<ServiceUseCases> {
  return serviceUseCases({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    service: req.service,
    known: req.known,
    deltas: { spec: req.reqs, archSpec: req.archReqs },
    // What else this archive writes under `architecture/` — the two slots the
    // gate stages a service's flows beside (`core/coherence/coherence.ts`).
    architecture: async () => [
      ...(await featureFlows(req.featureDir)).map((flow) => ({ rel: `${USECASE_SUBDIR}/${flow.rel}`, path: flow.path })),
      ...(await featureDeployments(req.featureDir)),
    ],
    context: new FleetContext(),
  });
}

/**
 * The `useCases` key. `unreadable`, `error` and `flows` are the key's original
 * three, unchanged in meaning — the living flows through the service — and each
 * hop of them gains `inside` only where the service answers it. Everything else
 * is additive, which the envelope permits (core/envelope/json.ts): the
 * feature's own flows as a key of their own with the same hole semantics, the
 * readability of the service's flows, and the flows the change makes untrue.
 */
export function useCasesJson(u: ServiceUseCases): Record<string, unknown> {
  return {
    ...throughJson(u.living),
    featureFlows: throughJson(u.feature),
    inside: u.inside,
    redraw: u.redraw,
  };
}

function throughJson(t: FlowsThrough): Record<string, unknown> {
  return { unreadable: t.unreadable, ...(t.error === undefined ? {} : { error: t.error }), flows: t.flows };
}
