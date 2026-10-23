/**
 * A feature's service-local flows (`./slot.ts`), graded the way
 * `loam validate --service` will grade them once the archive has written them
 * beside the service's model — and the gate on the two acts that overwrite a
 * living file.
 *
 * THE SERVICE TARGET'S GRADER, NOT A COPY. Every hop and every tag goes
 * through `serviceUseCaseFindings` (`../../service/grade.ts`), the function
 * `validate --service` runs, handed the project the archive would leave
 * (`./stage.ts`) and the requirement ids it would leave for that service: the
 * living ids of its spec.md and arch.spec.md with this feature's delta folded
 * in by the merge's own fold (`./ids.ts`) — an id the feature ADDS or MODIFIES
 * resolves, one it REMOVES does not. Before this, the slot was read by nothing,
 * and a broken hop or a tag naming no requirement archived clean.
 *
 * WHO DECLARES A TAG THE FEATURE ADDS. A `#req-` tag is a LikeC4 tag, refused
 * unless a `specification` the project reads declares it, and an id this
 * feature adds is declared nowhere yet. The flow document declares it: a
 * tags-only `specification { tag req-<slug> }` at its top, measured legal at
 * the 1.59.2 pin beside both shapes of model. The archive copies the document
 * whole, so the declaration lands with the one document that uses it — no
 * declaration is ever moved into another document, which is SCHEMA's rule for
 * the C4 delta. A tag a living block already declares (the map's, for an
 * extending model; model.likec4's, for a standalone one) must not be declared
 * again, and the staged parse refuses the duplicate here exactly as the next
 * `validate --service` would.
 *
 * REPLACING OR RETIRING IS GATED ON EVERY PROMISE THE FLOW KEEPS. Overwriting a
 * living flow has no pin of its own to collide on: two features rewriting one
 * flow would be a silent last-writer-wins. So a document whose living twin
 * exists is legal only when the twin claims at least one requirement of this
 * service — a view's `#req-` tag resolving today — and EVERY requirement it
 * claims is one this feature MODIFIES or REMOVES. The overwrite then rides on
 * those requirements' `Based-On:` pins: any second feature redrawing the same
 * file must change one of the same promises, so it is `delta.modified-conflict`
 * while both are in flight and `delta.baseline-stale` the moment the first
 * archives. "Some claimed promise changed" was the first rule, and it let two
 * features each changing a different promise of one flow replace it in turn,
 * the second burying the first's redraw at exit 0 (review, 2026-10-23).
 * Anything else is `usecase.flow-exists`, as for a fleet flow; a retirement
 * naming no living file is `usecase.flow-unknown`, and a document holding
 * nothing at all is `usecase.flow-invalid`.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { resolveRequirementTags } from "../../../capabilities/usecase-join.js";
import { errorText, type LoadedDoc } from "../../../c4/likec4.js";
import { projectDocumentsBesideMap } from "../../../c4/project/architecture.js";
import { previewMerge, type MergePreview } from "../../../c4/project/merge/preview.js";
import type { StagedDocument } from "../../../c4/project/staged.js";
import type { ServiceModel } from "../../../c4/service-model/load.js";
import type { ExtendingModel } from "../../../c4/splice/contract.js";
import type { Requirement } from "../../../document/spec.js";
import { inOrder } from "../../../kernel/concurrency.js";
import type { DocsDir, FeatureDir } from "../../../kernel/ids/dirs.js";
import type { RawServiceId } from "../../../kernel/ids/service.js";
import { compareIds } from "../../../repo/entries.js";
import { featureSpecPaths, SPEC_AXES, type ServicePaths } from "../../../repo/paths.js";
import type { Issue } from "../../../vocabulary/issue.js";
import { asIssue } from "../../grade/feature.js";
import { serviceUseCaseFindings, tagHint } from "../../service/grade.js";
import { changedIds, tableOf, untouched, type ServiceDeltaPair } from "./ids.js";
import { livingServiceFlows } from "./living.js";
import { featureServiceFlows, livingServiceFlowPath, SERVICE_FLOW_DIR, type ServiceFlowDoc } from "./slot.js";
import { stageServiceProject } from "./stage.js";

/** Everything the grade needs, injected — this package has no edge to `core/fleet-context.ts` (`../overlay.ts`). */
export interface ServiceFlowDeltaRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /** The services the feature's `specs/` names. */
  services: readonly RawServiceId[];
  /** The `services/<id>/` directories that exist — the fleet as it stands. */
  enumerated: ReadonlySet<string>;
  /** Where an enumerated service lives; an id `enumerated` does not hold is one this feature creates, unfiled. */
  locate: (service: RawServiceId) => Promise<ServicePaths>;
  /** A LIVING service model, read the way its shape demands. */
  serviceModel: (paths: ServicePaths) => Promise<ServiceModel>;
  /** A requirements document, parsed — living or the feature's delta. */
  readRequirements: (path: string) => Promise<Requirement[]>;
  /** The caller's memoised LikeC4 read, for the merge preview's `delta.likec4`. */
  load?: (path: string) => Promise<LoadedDoc>;
  /** The fleet's extending models, for the preview's routing — a thunk, paid only by a feature with a document here. */
  models: () => Promise<readonly ExtendingModel[]>;
  /**
   * The feature's OTHER documents the same archive writes under `architecture/`
   * — its fleet flows and its topology documents, each with the path inside
   * `architecture/` it lands at (`StagedDocument.rel`). An extending model's
   * project holds all of `architecture/`, so after the archive they are in it:
   * a service flow sharing a view id with the fleet flow it drills down from
   * passed here and was `Duplicate view` under the very next `validate --service`
   * (review, 2026-10-23). A thunk, and injected, because the two slots belong
   * to packages this one may not import (`../flows.ts` imports this package).
   */
  architecture: () => Promise<readonly StagedDocument[]>;
}

/** One service's documents, with where it lives and what the merge leaves of its promises. */
interface ServiceScope {
  service: RawServiceId;
  paths: ServicePaths;
  docs: readonly ServiceFlowDoc[];
  /** Ids a `#req-` tag resolves against today, and after the merge (`undefined`: no document either side). */
  living: ReadonlySet<string>;
  after: ReadonlySet<string> | undefined;
  /** The living ids this feature MODIFIES or REMOVES — what makes a replacement legal. */
  changed: ReadonlySet<string>;
}

export async function serviceFlowDeltaIssues(req: ServiceFlowDeltaRequest): Promise<Issue[]> {
  const docs = await featureServiceFlows(req.featureDir, req.services);
  if (docs.length === 0) return [];
  // AFTER the early return: the fleet read and the merge preview are paid only
  // by a feature that really carries a service-local flow.
  const preview = await previewMerge({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    models: await req.models(),
    ...(req.load === undefined ? {} : { load: req.load }),
    projectDocuments: () => projectDocumentsBesideMap(req.docsDir),
  });
  const architecture = await req.architecture();
  const services = [...new Set(docs.map((d) => d.service))];
  // Services are independent — one staged project each — so they run through
  // the kernel's bounded pool, with the answers kept in service order.
  const perService = await inOrder(services, async (service) => {
    const scope = await scopeOf(req, service, docs.filter((d) => d.service === service));
    const gate = await overwrites(req, scope);
    return [...gate.issues, ...(await gradeService(req, scope, preview, { overwritten: gate.overwritten, architecture }))];
  });
  return perService.flat();
}

/** Where a service lives, and its promises before and after the merge. */
async function scopeOf(req: ServiceFlowDeltaRequest, service: RawServiceId, docs: readonly ServiceFlowDoc[]): Promise<ServiceScope> {
  const paths = await req.locate(service);
  const feature = featureSpecPaths(req.featureDir, service);
  const deltas: ServiceDeltaPair[] = [];
  for (const axis of SPEC_AXES) {
    const delta = feature[axis.key];
    if (!existsSync(delta)) continue;
    const living = existsSync(paths[axis.key]) ? await req.readRequirements(paths[axis.key]) : [];
    deltas.push({ id: service, axis: axis.key, reqs: await req.readRequirements(delta), living, paths: () => Promise.resolve(paths) });
  }
  // The documents the feature leaves alone, as they stand — `untouched`'s rule,
  // so this grade and `../modified.ts`'s read one service's two documents alike.
  const pairs = [...deltas, ...(await untouched(service, paths, deltas, req.readRequirements))];
  const table = tableOf(pairs);
  return {
    service,
    paths,
    docs,
    living: table.living.get(service) ?? new Set(),
    // `undefined` only when NEITHER document exists before or after the merge —
    // `requirementIdsOf`'s two answers, one feature later.
    after: pairs.length === 0 ? undefined : table.merged.get(service),
    changed: changedIds(table).get(service) ?? new Set(),
  };
}

/**
 * The living files this feature's documents overwrite — replaced or retired —
 * and each refusal of that act.
 *
 * A REFUSED document still overwrites its twin in the grade below. The archive
 * will not run while the refusal stands, so the only useful question left about
 * the document is whether it would be a sound replacement once the author has
 * made it legal; and staged BESIDE its twin it would land on the twin's very
 * path, so the project read would be neither the one the archive leaves nor
 * the living one — a replacement that relies on the twin's own tag declaration
 * was reported as a parse error of the living file it was not replacing.
 */
async function overwrites(req: ServiceFlowDeltaRequest, scope: ServiceScope): Promise<{ overwritten: Set<string>; issues: Issue[] }> {
  const overwritten = new Set<string>();
  const issues: Issue[] = [];
  // Read once, and only when a twin exists and the feature changes a promise
  // its flows could claim — otherwise the answer is known without a load.
  let flows: Awaited<ReturnType<typeof livingServiceFlows>> | undefined;
  const blind: string[] = [];
  for (const doc of scope.docs) {
    const living = livingServiceFlowPath(scope.paths.dir, doc.rel);
    const file = spell(req.docsDir, living);
    if (doc.kind === "empty") {
      issues.push(emptyIssue(req, scope, doc));
      continue;
    }
    if (!existsSync(living)) {
      if (doc.kind === "retirement") issues.push(unknownIssue(req, scope, doc, file));
      continue;
    }
    overwritten.add(living);
    if (scope.changed.size > 0 && flows === undefined) {
      flows = await livingServiceFlows({
        docsDir: req.docsDir,
        paths: scope.paths,
        known: req.enumerated,
        serviceModel: req.serviceModel,
        ids: scope.changed,
      });
    }
    // Blind, not refused for the flow's sake: loam cannot say which promise
    // the living file keeps, and `--approve` overrides judgement, never sight.
    if (flows === null) {
      blind.push(file);
      continue;
    }
    const claimed = [
      ...new Set(
        (flows ?? [])
          .filter((flow) => flow.file === file)
          .flatMap((flow) => resolveRequirementTags(flow.view.tags, [scope.service], () => scope.living))
          .flatMap((claim) => (claim.kind === "resolved" ? [claim.id] : [])),
      ),
    ].sort(compareIds);
    const unchanged = claimed.filter((id) => !scope.changed.has(id));
    if (claimed.length === 0 || unchanged.length > 0) issues.push(existsIssue(req, doc, { file, unchanged }));
  }
  if (blind.length > 0) {
    issues.push(
      unreadableIssue(
        scope,
        blind.map((file) => `${file}: ${scope.service}'s living project does not read, so nothing can say which promise this file keeps — \`loam validate --service ${scope.service}\` names the fault`),
      ),
    );
  }
  return { overwritten, issues };
}

/** The documents that draw something, staged and graded over the post-merge project. */
async function gradeService(
  req: ServiceFlowDeltaRequest,
  scope: ServiceScope,
  preview: MergePreview,
  around: { overwritten: ReadonlySet<string>; architecture: readonly StagedDocument[] },
): Promise<Issue[]> {
  if (preview.kind === "failed") return [unreadableIssue(scope, [`the merge preview could not be computed: ${preview.reason}`])];
  const modelRel = spell(req.docsDir, scope.paths.model);
  let shape: "standalone" | "extending";
  if (existsSync(scope.paths.model)) {
    const model = await req.serviceModel(scope.paths);
    if (model.mapUnreadable || model.doc.errors.length > 0) {
      return [unreadableIssue(scope, [`${modelRel} does not read (\`loam validate --service ${scope.service}\` names the fault), so no flow drawn over it can be`])];
    }
    shape = model.shape;
  } else if (preview.models.has(modelRel)) {
    shape = "extending";
  } else {
    return [unreadableIssue(scope, [`${modelRel} does not exist and this archive writes none, so there is no model for these flows to be drawn over`])];
  }
  const scan = await stageServiceProject({
    docsDir: req.docsDir,
    paths: scope.paths,
    shape,
    merged: { landscape: preview.landscape, models: preview.models, architecture: around.architecture },
    overwritten: around.overwritten,
    documents: scope.docs.filter((d) => d.kind === "flow"),
    known: new Set([...req.enumerated, ...req.services]),
  });
  if (scan.kind === "unreadable") {
    return [
      unreadableIssue(
        scope,
        [...tagHint(scan.errors, featureDeclaration), ...scan.errors.map((e) => (e.sourceFsPath === undefined ? errorText(e) : `${spell(req.docsDir, e.sourceFsPath)}: ${errorText(e)}`))],
      ),
    ];
  }
  return serviceUseCaseFindings({
    service: scope.service,
    treePath: spell(req.docsDir, scope.paths.dir),
    viewsAt: spell(req.docsDir, featureSpecPaths(req.featureDir, scope.service).dir),
    requirementIds: scope.after,
    docsDir: req.docsDir,
    scan,
    // The fleet the merge leaves: each `specs/<svc>/` becomes a `services/<svc>/`.
    services: new Set([...req.enumerated, ...req.services]),
  }).flatMap(asIssue);
}

/** Where a FEATURE flow's tag goes — the document itself, which the archive copies whole. */
function featureDeclaration(name: string): string {
  return (
    `declare \`tag ${name}\` in a tags-only \`specification { tag ${name} }\` at the top of the flow document that ` +
    "uses it — the archive copies the document whole, so the declaration lands with the flow. Declare it there only " +
    "when no block the service's project already reads declares it (the map's for an extending model, model.likec4's " +
    "for a standalone one): a second declaration is a duplicate"
  );
}

function unreadableIssue(scope: ServiceScope, details: string[]): Issue {
  return {
    severity: "error",
    code: "usecase.flow-invalid",
    subject: scope.service,
    message:
      `${scope.service}: this feature's ${SERVICE_FLOW_DIR}/ flows could not be read against the project its own merge ` +
      `would leave — ${scope.service}'s model with this feature's delta routed into it, the map, and its living flows — ` +
      `so the archive would write flows nothing has checked beside the model. The fault may be in a living document as ` +
      `well as in the feature's; each detail names its file.`,
    details,
  };
}

/** A document holding nothing — the editor's new file, not a flow and not a retirement (`./slot.ts`). */
function emptyIssue(req: ServiceFlowDeltaRequest, scope: ServiceScope, doc: ServiceFlowDoc): Issue {
  const file = spell(req.docsDir, doc.path);
  return {
    severity: "error",
    code: "usecase.flow-invalid",
    subject: scope.service,
    message:
      `${file} is empty, so it is neither a flow nor a retirement: the archive would write an empty file at ` +
      `${spell(req.docsDir, livingServiceFlowPath(scope.paths.dir, doc.rel))}. Write the flow — or, to retire the ` +
      `living flow at that path, a comment saying why, which is what a retirement holds.`,
    locations: [{ path: file, role: "primary" }],
  };
}

function existsIssue(req: ServiceFlowDeltaRequest, doc: ServiceFlowDoc, twin: { file: string; unchanged: readonly string[] }): Issue {
  const act = doc.kind === "retirement" ? "retire" : "replace";
  const why =
    twin.unchanged.length === 0
      ? `no flow in it claims a requirement of ${doc.service} this feature MODIFIES or REMOVES`
      : `it also keeps ${twin.unchanged.join(", ")}, which this feature does not change`;
  return {
    severity: "error",
    code: "usecase.flow-exists",
    subject: doc.service,
    message:
      `${twin.file} already exists, and ${why} — so ${spell(req.docsDir, doc.path)} would ${act} an authored flow ` +
      `with no pin to collide on. A feature replaces or retires a living flow only through EVERY promise it keeps: ` +
      `MODIFY (or REMOVE) each requirement the flow claims in this feature's specs/${doc.service}/ — restating one ` +
      `unchanged is enough, its Based-On pin is what stops another feature redrawing the same file over this one. ` +
      `Otherwise rename this document to introduce a new flow, or edit ${twin.file} directly in this change, where git ` +
      `produces an ordinary conflict.`,
    locations: [
      { path: spell(req.docsDir, doc.path), role: "primary" },
      { path: twin.file, role: "scope" },
    ],
  };
}

function unknownIssue(req: ServiceFlowDeltaRequest, scope: ServiceScope, doc: ServiceFlowDoc, file: string): Issue {
  return {
    severity: "error",
    code: "usecase.flow-unknown",
    subject: doc.service,
    message:
      `${spell(req.docsDir, doc.path)} holds no LikeC4 statement, which asks the archive to retire the living flow at ` +
      `${file} — and there is none, so the retirement would remove nothing while the archive reported it done. Check ` +
      `its name against the flows under ${spell(req.docsDir, livingServiceFlowPath(scope.paths.dir, ""))}, or delete it: ` +
      `a document that draws nothing introduces nothing either.`,
    locations: [{ path: spell(req.docsDir, doc.path), role: "primary" }],
  };
}

/** Docs-relative and `/`-separated — the spelling every finding names a file by. */
function spell(docsDir: DocsDir, path: string): string {
  return relative(docsDir, path).split(/[\\/]/).join("/");
}
