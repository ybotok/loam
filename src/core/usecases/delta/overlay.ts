/**
 * A feature's flows, read against the fleet map AS THIS FEATURE'S MERGE WOULD
 * LEAVE IT.
 *
 * The staging and the merge preview that make that possible are no longer here:
 * they moved to `core/c4/project/staged.ts` when the deployment slot became the
 * second feature-local `.likec4` document, because a second copy of that
 * machinery is the copy that drifts, and the two would disagree first about the
 * merge preview — the one thing both axes' refusals rest on. That module's
 * header carries the WHY of the post-merge corpus; this one keeps what is
 * particular to use cases, which is the interpretation: which of the staged
 * views are this feature's, and what they resolve against.
 *
 * FAIL CLOSED, and not silently. Every failure is the `unreadable` arm carrying
 * LikeC4's own messages: a flow this cannot read is never a flow that grades
 * clean, which is the asymmetry `../fleet.ts` states for the fleet-scope scan.
 */
import { type LoadedDoc } from "../../c4/likec4.js";
import { stageMergedProject, type StagedProject } from "../../c4/project/staged.js";
import type { ExtendingModel } from "../../c4/splice/contract.js";
import { serviceResolver } from "../../c4/resolve/service.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { isUseCase, type UseCaseScan } from "../fleet.js";
import { featureFlows, USECASE_SUBDIR } from "./flows.js";

/** Everything the overlay needs, and nothing it would have to read twice. */
export interface FlowOverlayRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  /** The feature's id — the tag that selects the delta's own additions. */
  featureId: string;
  /**
   * The enumerated fleet, for the element→service resolver. It rides in for the
   * reason every other edge join carries it: without it a hop drawn into a
   * modelled container `payment.api` resolves to a service called "api" that
   * has never existed.
   */
  known: ReadonlySet<string>;
  /**
   * The caller's memoised LikeC4 read, when it has one. Only `delta.likec4` goes
   * through it, and only to compute the merge preview — but the caller
   * (`featureCoherence`) has already loaded that exact document, and loading one
   * spins a fresh Langium workspace, which `core/coherence/coherence.ts` calls
   * the dominant per-feature cost.
   *
   * A FUNCTION rather than the `FleetContext` itself, deliberately: this package
   * has no edge to `core/fleet-context.ts`, one memoised read does not justify
   * adding one, and the edge would push `core/usecases/` up a DAG level for
   * nothing. Absent, the load happens directly, which is right for a caller
   * running outside an invocation index.
   */
  load?: (path: string) => Promise<LoadedDoc>;
  /**
   * The fleet's extending models, for the merge preview — the SAME list
   * `loam archive` routes with. Without it the preview holds interior the
   * archive will put in `services/<…>/model.likec4`, so a hop naming
   * `<service-fqn>.<container>` resolves here and against nothing once the flow
   * is living: `usecase.flow-invalid` fails open, and it is the gate
   * `--approve` cannot override (verification 2026-09-04, review F8).
   *
   * A THUNK, and both halves of that matter. A function for the reason `load`
   * is one: the reader takes a `FleetContext` and this package has no edge to
   * it, so the caller that owns the fleet read supplies the answer. LAZY
   * because the early return above is the axis's per-feature opt-in — a feature
   * with no `usecases/` directory must not pay for a fleet enumeration and one
   * read per extending model to be told there is nothing to grade.
   */
  models?: () => Promise<readonly ExtendingModel[]>;
}

/**
 * The flows this feature carries, parsed over the post-merge map — or the
 * honest refusal to say.
 *
 * A feature with no `usecases/` directory is `read` with no views, at the cost
 * of one walk over a directory that is not there. That is the axis's
 * per-feature opt-in and the whole price a fleet that has not adopted it pays.
 */
export async function readFeatureFlows(req: FlowOverlayRequest): Promise<UseCaseScan> {
  const flows = await featureFlows(req.featureDir);
  if (flows.length === 0) {
    return { kind: "read", views: [], model: { elements: [], relationships: [], known: req.known }, resolve: (id) => id };
  }
  // AFTER the early return, which is what makes the thunk worth its shape: the
  // fleet read is paid only by a feature that actually brings a flow.
  const models = req.models === undefined ? undefined : await req.models();
  const staged = await stageMergedProject({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    documents: flows.map((flow) => ({ rel: `${USECASE_SUBDIR}/${flow.rel}`, path: flow.path })),
    ...(req.load === undefined ? {} : { load: req.load }),
    ...(models === undefined ? {} : { models }),
  });
  return interpret(staged, req.known);
}

/**
 * The staged parse as the use-case axis reads it.
 *
 * THE FEATURE'S OWN FLOWS ONLY. A living use case is the fleet scan's to report,
 * and repeating it here would file somebody else's finding against this
 * feature's gate — the same scoping every other feature-side check keeps.
 */
function interpret(staged: StagedProject, known: ReadonlySet<string>): UseCaseScan {
  if (staged.kind === "unreadable") return { kind: "unreadable", errors: staged.errors };
  const { doc, real, mine } = staged;
  // Through `isUseCase`, because `UseCaseScan.views` is documented as the
  // reserved-tag views ONLY and this is the type's second producer. The
  // resolvers below filter on the prefix anyway, so no answer changes today —
  // but `flowsClaiming` and `servicesInFlowsClaiming` take a `UseCaseScan` and
  // read `scan.views` straight, and the whole point of exporting one predicate
  // was that a second spelling of the opt-in drifts.
  const views = (doc.views ?? [])
    .filter((view) => view.sourcePath !== undefined && mine.has(view.sourcePath))
    .filter(isUseCase);
  return {
    kind: "read",
    views: views.map((view) => ({ ...view, sourcePath: view.sourcePath === undefined ? view.sourcePath : real(view.sourcePath) })),
    model: { elements: doc.elements, relationships: doc.relationships, known },
    resolve: serviceResolver(doc.elements, known),
  };
}
