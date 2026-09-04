/**
 * A service's OWN use cases: the `dynamic view`s its LikeC4 project declares,
 * read the way the renderer reads that project.
 *
 * THE SLOT IS THE PROJECT. `loam subsystem sync` writes a
 * `services/<…>/<svc>/likec4.config.json` that registers every `.likec4` under
 * the service directory as one LikeC4 project, so the renderer already shows a
 * `views.likec4` beside the model, or a `usecases/<name>.likec4` under it. loam
 * reads exactly that set — `model.likec4` plus every sibling, recursively, minus
 * whatever that project file's own `exclude` drops (`./exclude.ts`) — and
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
 * TWO SHAPES, ONE SLOT. A model that stands alone is a project of its own
 * directory, exactly as above. A model that EXTENDS the fleet map is not: its
 * containers are declared inside an element the map owns, so a flow beside it
 * naming one of those containers only resolves in a project that also holds the
 * map (`c4/service-model/documents.ts`, `serviceFlowDocuments`). That project is
 * staged from the DOCS ROOT, so every view comes back spelled
 * `services/<tree>/usecases/x.likec4` — and the service prefix is stripped here,
 * because every finding this scan feeds names a file relative to the service
 * directory and a reader must not have to work out which spelling they were
 * given. The same prefix is the FILTER: the map's own `architecture/usecases/`
 * flows are in that project too, and without it every service in the fleet would
 * be graded for every fleet-level use case.
 *
 * THE CHEAP GATE, in order, so a fleet without the axis pays one recursive
 * readdir per service and nothing else:
 *
 *  1. no sibling → nothing new is loaded, and the model's own tagged views are
 *     graded at zero cost against the project the model was READ in. For a
 *     standalone model that is the single-file load already in hand, which IS
 *     its whole project; for an extending one it is `ServiceModel.project`, the
 *     map and this model together — NOT the service's own slice of it, which is
 *     what the caller passes as `model` and what every count and `Covers:` line
 *     is answered from. A hop backed by a map edge is backed wherever the view
 *     is written, and grading the two arms against different documents made one
 *     view `usecase.step-unbacked` in model.likec4 and clean in a sibling. A
 *     standalone model's views came back named `source.c4`
 *     (`core/usecases/place.ts` records the rule) and an extending model's carry
 *     their docs-relative path, so the file is spelled here, where it is known,
 *     for both: `model.likec4`;
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
import { relative } from "node:path";
import type { LikeC4Error, LoadedDoc } from "../../c4/likec4.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import { architectureDocuments } from "../../c4/project/documents.js";
import { asLoadedDoc, loadProject } from "../../c4/project/load.js";
import { serviceFlowDocuments } from "../../c4/service-model/documents.js";
import type { StepScope } from "../../c4/resolve/steps.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { ARTIFACT_FILES, type ServicePaths } from "../../repo/paths.js";
import { isUseCase, mentionsTagPrefix } from "../fleet.js";
import { keepIncluded, serviceProjectExclude } from "./exclude.js";

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
  /**
   * Set only when this model EXTENDS the fleet map, and then both halves of it
   * — a record rather than two optional fields, for docs/CODE-STYLE.md's reason:
   * they are only ever passed together, and a caller that supplied one without
   * the other is exactly the inconsistent pair a record makes unrepresentable.
   *
   * `docsDir` decides which documents the sibling project holds (the map as
   * well, or the directory alone) and which root they are staged from, and
   * therefore how LikeC4 spells every `sourcePath` that comes back.
   *
   * `project` is the per-service project the model was READ in — the map plus
   * this model (`ServiceModel.project`) — and it is the scope a hop resolves
   * against when there is no sibling file. `model` above is then the service's
   * own SLICE of that project, which is the right answer for every count and
   * every `Covers:` line and the wrong one here: a hop backed by a MAP edge is
   * backed, and grading it against the slice reported `usecase.step-unbacked`
   * (exit 1) for a view in model.likec4 that was clean the moment the same view
   * moved to a sibling file, where the loaded project holds the map. One
   * question, two answers, decided by which file the author happened to write
   * the view in.
   *
   * Absent means the standalone shape — the service directory is the project and
   * the single-file load IS that project, exactly as it has always been.
   */
  extending?: { docsDir: DocsDir; project: LoadedDoc };
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
  const found = await architectureDocuments(req.paths.dir, [req.paths.model]);
  // What the RENDERER holds, for the standalone shape where this directory's
  // own `likec4.config.json` IS the project config: a sibling its `exclude`
  // covers is in no project loam may claim to be reading (`./exclude.ts`). The
  // extending shape reads the root project instead, so its list does not apply
  // — a per-service config beside an extending model is `service.likec4-config-stray`.
  const siblings =
    req.extending === undefined
      ? keepIncluded(req.paths.dir, await serviceProjectExclude(req.paths.dir), found)
      : found;
  // The scope of the no-sibling arm, and it is the PROJECT for both shapes: the
  // single-file load for a standalone model (which is its whole project), and
  // the map-plus-model load for an extending one. Reading `req.model` there for
  // an extending model read its own slice instead, so one view was graded two
  // different ways depending on which file it was written in.
  const alone = req.extending?.project ?? req.model;
  const scope = { elements: alone.elements, relationships: alone.relationships, known: req.known };
  const own = (req.model.views ?? []).filter(isUseCase);
  if (siblings.length === 0) {
    if (own.length === 0) return { kind: "none" };
    return { kind: "read", views: own.map((view) => ({ ...view, sourcePath: ARTIFACT_FILES.model })), model: scope };
  }
  if (own.length === 0 && !(await mentionsTagPrefix(siblings))) return { kind: "none" };

  const base = req.extending?.docsDir ?? req.paths.dir;
  const documents =
    req.extending === undefined
      ? [req.paths.model, ...siblings]
      : await serviceFlowDocuments(req.extending.docsDir, req.paths);
  const project = await loadProject(base, documents);
  if (!project.clean) {
    // Each error already carries the real path of its document (`loadProject`
    // rewrites the staged path back), and the flattening is `asLoadedDoc`'s —
    // the fleet's own path-sorted order, taken from the one place it is
    // spelled rather than re-spelled here: the caller names the FIRST broken
    // file, and a second sort rule would let the service target name a
    // different first file than the fleet target names for the same project.
    return { kind: "unreadable", errors: asLoadedDoc(project).errors };
  }
  // The prefix the service's own documents are spelled under inside this
  // project: empty for a standalone model (the project IS the directory, so
  // every view in it is this service's) and `services/<tree>/` for an extending
  // one, whose project also holds the whole fleet map.
  const prefix = req.extending === undefined ? "" : `${relative(base, req.paths.dir).split(/[\\/]/).join("/")}/`;
  return {
    kind: "read",
    views: rebase(project.views.filter(isUseCase), prefix),
    model: { elements: project.elements, relationships: project.relationships, known: req.known },
  };
}

/**
 * The views this SERVICE declares, spelled relative to its own directory.
 *
 * With an empty prefix — the standalone shape — this is the identity, including
 * for a view whose `sourcePath` is absent: that project holds nothing but the
 * service's own files, so there is nothing to attribute and nothing to strip.
 *
 * With a prefix, it is both the filter and the rebase, and both halves are one
 * rule about which document belongs to whom. The project also holds the fleet
 * map, so `architecture/usecases/checkout.likec4` is in it — and without the
 * filter every service in the fleet would be graded for every fleet-level use
 * case. A view carrying no `sourcePath` cannot be attributed at all and is
 * dropped for the same reason: the path is the only evidence there is.
 */
function rebase(views: readonly ParsedView[], prefix: string): ParsedView[] {
  if (prefix === "") return [...views];
  return views
    .filter((view) => view.sourcePath?.startsWith(prefix) === true)
    .map((view) => ({ ...view, sourcePath: (view.sourcePath ?? "").slice(prefix.length) }));
}
