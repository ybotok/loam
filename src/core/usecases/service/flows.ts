/**
 * A service's OWN use cases: the `dynamic view`s its LikeC4 project declares,
 * read the way the renderer reads that project.
 *
 * THE SLOT IS THE PROJECT. `loam subsystem sync` writes a
 * `services/<…>/<svc>/likec4.config.json` that registers every `.likec4` under
 * the service directory as one LikeC4 project, so the renderer already shows a
 * `views.likec4` beside the model, or a `usecases/<name>.likec4` under it. loam
 * reads exactly that set — `model.likec4` plus every sibling, recursively — and
 * nothing else, because a slot narrower than the renderer's would leave a flow
 * that renders and is graded by nothing, which is the report this module
 * answers: an intra-service flow behind an `arch.spec.md` requirement whose
 * `Covers:` names containers had no home. `architecture/usecases/` is a
 * separate project that cannot resolve a container (one such file turned a
 * whole fleet `landscape.invalid`), and the author's workaround beside the
 * model was invisible to every check. The read is NOT gated on the project
 * file's presence: that file is create-only and a team may delete it, its
 * absence has a warning of its own (`service.likec4-config-missing`), and a
 * flow the renderer cannot show yet is still a flow loam can grade.
 *
 * MODEL FACTS STAY SINGLE-FILE. `c4.valid`'s counts, `Covers:` resolution,
 * `health.dependency-unmodelled` and every other model reader keep the
 * single-file load the service target already made; the project is loaded here
 * for the VIEWS and their `sourcePath` only, and only when there is something
 * to grade. A sibling that declares elements extends what a hop may name, and
 * that is the renderer's reading too.
 *
 * THE CHEAP GATE, in order, so a fleet without the axis pays one recursive
 * readdir per service and nothing else:
 *
 *  1. no sibling → the single-file load already in hand IS the project, and
 *     its tagged views are graded off it at zero cost. Its views came back
 *     named `source.c4` (`core/usecases/place.ts` records the rule), so the
 *     file is spelled here, where it is known: `model.likec4`;
 *  2. siblings, no tagged view in the model, and no reserved prefix in any
 *     document (`mentionsTagPrefix`, the fleet's own byte gate) → nothing opted
 *     in, no workspace. An untagged `views.likec4` is somebody's hand-drawn
 *     diagram, never graded, exactly as an untagged fleet view is — and its
 *     parse errors are the renderer's business until a view opts the project
 *     in;
 *  3. otherwise `loadProject` over model + siblings, the way the renderer reads
 *     them. `own` and the project's views are never merged: when siblings
 *     exist the project is the whole answer, which is what keeps one view from
 *     being graded twice.
 *
 * A REQUEST RECORD rather than three parameters, for the reason
 * docs/CODE-STYLE.md gives: the paths, the single-file doc and the fleet set
 * are only ever passed together, and a caller handing in a doc loaded from
 * some other path is exactly the inconsistent pair a record makes
 * unrepresentable.
 */
import type { LikeC4Error, LoadedDoc } from "../../c4/likec4.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import { architectureDocuments } from "../../c4/project/documents.js";
import { asLoadedDoc, loadProject } from "../../c4/project/load.js";
import type { StepScope } from "../../c4/resolve/steps.js";
import { ARTIFACT_FILES, type ServicePaths } from "../../repo/paths.js";
import { isUseCase, mentionsTagPrefix } from "../fleet.js";

export interface ServiceFlowRequest {
  paths: ServicePaths;
  /**
   * The single-file load the service target already made and has verified
   * parses. Its views are the project when no sibling exists; its elements are
   * the model a no-sibling flow is graded over.
   */
  model: LoadedDoc;
  /** The enumerated fleet, for `serviceResolver`'s reason: without it a container resolves to a service that has never existed. */
  known: ReadonlySet<string>;
}

/**
 * What a service's flows are, or the honest refusal to say.
 *
 * Three variants rather than a record with flags, for `UseCaseScan`'s reason
 * one package up: a project that did not parse has no elements to resolve
 * against and no views to grade, and a caller handed `{ views: [], unreadable:
 * true }` is one `.length` check away from reporting a service as flow-free
 * when nobody could read it. `none` is the gate's answer — nothing opted in,
 * nothing was loaded — and it is distinct from `read` with no views (a project
 * that mentions a prefix in prose and declares no tagged view), because only
 * the second one cost a workspace.
 */
export type ServiceFlowScan =
  | { kind: "none" }
  | {
      kind: "read";
      /** The reserved-tag views ONLY, each carrying a `sourcePath` relative to the SERVICE directory. */
      views: ParsedView[];
      /** What a hop is attributed against — `known` required, as `UseCaseScan.model` requires it. */
      model: StepScope & { known: ReadonlySet<string> };
    }
  | {
      kind: "unreadable";
      /**
       * Every error the project raised, each carrying the real absolute path of
       * the document that raised it, sorted by that path — so a caller can name
       * the file, and a project with two broken documents reports them in a
       * stable order.
       */
      errors: LikeC4Error[];
    };

/**
 * The service's declared use cases, with the model they are drawn over.
 *
 * Reads only, throws nothing: every failure is the `unreadable` arm. The caller
 * has already established that `model.likec4` parses on its own — a project
 * whose model is broken is `c4.invalid`'s business, and loading it again here
 * would only repeat that cascade under a second code.
 */
export async function readServiceFlows(req: ServiceFlowRequest): Promise<ServiceFlowScan> {
  const siblings = await architectureDocuments(req.paths.dir, [req.paths.model]);
  const scope = { elements: req.model.elements, relationships: req.model.relationships, known: req.known };
  const own = (req.model.views ?? []).filter(isUseCase);
  if (siblings.length === 0) {
    if (own.length === 0) return { kind: "none" };
    return { kind: "read", views: own.map((view) => ({ ...view, sourcePath: ARTIFACT_FILES.model })), model: scope };
  }
  if (own.length === 0 && !(await mentionsTagPrefix(siblings))) return { kind: "none" };

  const project = await loadProject(req.paths.dir, [req.paths.model, ...siblings]);
  if (!project.clean) {
    // Each error already carries the real path of its document (`loadProject`
    // rewrites the staged path back), and the flattening is `asLoadedDoc`'s —
    // the fleet's own path-sorted order, taken from the one place it is
    // spelled rather than re-spelled here: the caller names the FIRST broken
    // file, and a second sort rule would let the service target name a
    // different first file than the fleet target names for the same project.
    return { kind: "unreadable", errors: asLoadedDoc(project).errors };
  }
  return {
    kind: "read",
    views: project.views.filter(isUseCase),
    model: { elements: project.elements, relationships: project.relationships, known: req.known },
  };
}
