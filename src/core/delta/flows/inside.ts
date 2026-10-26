/**
 * The business flows through one service, each hop joined to the service's own
 * flows — the reads `loam delta` needs for its use-case section, wired to the
 * invocation's context. `core/usecases/join/` owns every rule; this module only
 * decides what to read and in which state.
 *
 * TWO CORPORA OF FLEET FLOWS. The living ones, from `architecture/`, are what
 * the service already sits in; the feature's own, read against the map its
 * merge would leave, are the flows this change is FOR — and the brief used to
 * show only the first, so an implementer saw none of the feature's flows until
 * the archive had made them living. They stay two lists: `flows` keeps meaning
 * what it has always meant, and a consumer counting it must not get a
 * different number for the same question.
 *
 * ONE CORPUS OF SERVICE FLOWS, AS THE MERGE LEAVES IT. The service's living
 * flows, minus every file a document in the feature's slot replaces or retires,
 * plus the slot's flows staged over the post-merge project exactly as the gate
 * stages them (`stageAfterMerge`). The requirements they are joined through are
 * the merge's too, so a hop into an operation this feature adds finds the flow
 * this feature draws for it.
 *
 * WHAT IT COSTS. The living fleet scan keeps its byte gate (`readUseCases`),
 * and the feature's flows cost a staged project only when the feature has a
 * `usecases/` at all (`readFeatureFlows`). The service's own flows are read
 * only when a hop holds a key one of its requirements carries — the join's ids
 * are computed first, and an empty set reads no service project — and then
 * behind a byte scan for those ids' tag spellings (`livingServiceFlows`), with
 * the merge preview and one more staged project only when the feature carries
 * a flow document for this service. `redraw` walks the service's flows only
 * when the feature MODIFIES or REMOVES one of its requirements.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveRequirementTags } from "../../capabilities/usecase-join.js";
import { errorText } from "../../c4/likec4.js";
import { projectDocumentsBesideMap } from "../../c4/project/architecture.js";
import { previewMerge } from "../../c4/project/merge/preview.js";
import type { StagedDocument } from "../../c4/project/staged.js";
import { extendingModels } from "../../c4/service-model/fleet/extending.js";
import { applyRequirementDelta } from "../../document/apply.js";
import type { Requirement } from "../../document/spec.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import type { RawServiceId } from "../../kernel/ids/service.js";
import { SPEC_AXES, type ServicePaths, type SpecAxis } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { readUseCases } from "../../usecases/fleet.js";
import { scanHealth } from "../../usecases/touch.js";
import { readFeatureFlows } from "../../usecases/delta/overlay.js";
import { authoredFile } from "../../usecases/place.js";
import { changedPromiseFlows } from "../../usecases/delta/modified.js";
import { livingServiceFlows } from "../../usecases/delta/service/living.js";
import type { ServiceDeltaPair } from "../../usecases/delta/service/ids.js";
import { featureServiceFlowDir, featureServiceFlows, overwrittenBy } from "../../usecases/delta/service/slot.js";
import { stageAfterMerge } from "../../usecases/delta/service/stage.js";
import { flowsInside, joinableIds, type JoinedUseCase, type ServiceFlowClaims } from "../../usecases/join/inside.js";
import { requirementKeys } from "../../usecases/join/keys.js";

export interface ServiceUseCaseRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  service: RawServiceId;
  /** The enumerated fleet plus the feature's own services — the resolver's set, as the brief's other sections use it. */
  known: ReadonlySet<string>;
  /** The feature's two requirement deltas for this service, parsed — empty for an axis it carries none for. */
  deltas: Record<SpecAxis["key"], readonly Requirement[]>;
  /**
   * The feature's other documents under `architecture/`, for the staged project
   * (`AfterMergeRequest.architecture`). Injected, because naming the topology
   * slot here would be an edge to `core/deployment/` this package does not
   * otherwise have (`./service.ts` makes the same call).
   */
  architecture: () => Promise<readonly StagedDocument[]>;
  context: FleetContext;
}

/** A corpus of fleet flows through the service, or the honest refusal to say. */
export interface FlowsThrough {
  unreadable: boolean;
  error?: string;
  flows: JoinedUseCase[];
}

/**
 * A living flow of the service that this feature makes untrue — one entry per
 * FLOW, with every claim of it the feature moves: `usecase.requirement-modified`'s
 * set and the removal's `usecase.requirement-unresolved`, which name it once per
 * claim.
 */
export interface RedrawFlow {
  id: string;
  file: string;
  /** Where the redrawn flow goes, when the flow has a slot (`ChangedPromiseFlow.slot`). */
  slot?: string;
  claims: RedrawClaim[];
}

export interface RedrawClaim {
  requirement: string;
  change: "MODIFIED" | "REMOVED";
  /**
   * `null`: the tag still resolves, and the flow may still hold — restating it
   * in the slot confirms it. Otherwise the error that gates the archive, and its
   * own fix: `unresolved` (drop or re-point the tag, or MODIFY instead of
   * removing), `collides` (rename one of the colliding ids).
   */
  breaks: "unresolved" | "collides" | null;
}

export interface ServiceUseCases {
  living: FlowsThrough;
  feature: FlowsThrough;
  /** Whether the service's own flows could be read — every `unread` hop says so on its own as well. */
  inside: { unreadable: boolean; error?: string };
  redraw: RedrawFlow[];
}

export async function serviceUseCases(req: ServiceUseCaseRequest): Promise<ServiceUseCases> {
  const ctx = req.context;
  const living = await readUseCases({ docsDir: req.docsDir, known: req.known });
  const feature = await readFeatureFlows({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    known: req.known,
    load: (path) => ctx.loadLikeC4(path),
    models: () => extendingModels(req.docsDir, ctx),
  });
  const paths = await locateServicePaths(req.docsDir, req.service, ctx);
  const merged = await mergedRequirements(req, paths);
  const keyed = requirementKeys(merged.reqs);
  const ids = new Set([...joinableIds(living, req.service, keyed), ...joinableIds(feature, req.service, keyed)]);
  // A refused requirement merge leaves no requirement set the archive could
  // write, so no hop can be joined through one — every keyed hop is `unread`,
  // never an inside that only LOOKS empty. Otherwise: no hop holds a key any
  // requirement carries, so no flow of the service can be inside anything, and
  // the true answer costs no project read.
  const corpus: Corpus =
    merged.kind === "refused"
      ? { flows: null, error: merged.reason }
      : ids.size === 0
        ? { flows: [] }
        : await serviceFlowCorpus(req, paths, ids, merged.reqs);
  const join = { service: req.service, requirements: keyed, flows: corpus.flows };
  return {
    living: { ...scanHealth(living), flows: flowsInside(living, join) },
    feature: { ...scanHealth(feature), flows: flowsInside(feature, { ...join, place: authoredFile(req.docsDir) }) },
    inside: corpus.flows === null ? { unreadable: true, ...(corpus.error === undefined ? {} : { error: corpus.error }) } : { unreadable: false },
    redraw: await redrawFlows(req, paths),
  };
}

/** The service's requirements as the archive's fold leaves them — or the refusal, with the living ones for the keys. */
type Merged = { kind: "merged"; reqs: Requirement[] } | { kind: "refused"; reqs: Requirement[]; reason: string };

/**
 * The service's requirements, both documents, as the archive's fold leaves
 * them. A delta the merge would refuse is NOT read as the living text here, as
 * `tableOf` reads it for a grade (`core/usecases/delta/service/ids.ts`): there
 * the delta gate reports the refusal, while this brief would report nothing and
 * show the hops of an ADDED operation as having no inside. The keys still come
 * from the living text, so each hop says what it was asked for.
 */
async function mergedRequirements(req: ServiceUseCaseRequest, paths: ServicePaths): Promise<Merged> {
  const living: Requirement[] = [];
  const merged: Requirement[] = [];
  for (const axis of SPEC_AXES) {
    const text = existsSync(paths[axis.key]) ? await req.context.readRequirements(paths[axis.key]) : [];
    living.push(...text.filter((r) => r.kind !== "REMOVED"));
    const delta = req.deltas[axis.key];
    if (delta.length === 0) {
      merged.push(...text.filter((r) => r.kind !== "REMOVED"));
      continue;
    }
    try {
      merged.push(...applyRequirementDelta([...text], [...delta]).filter((r) => r.kind !== "REMOVED"));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return {
        kind: "refused",
        reqs: living,
        reason: `${req.service}'s requirement merge is refused (${why}) — \`loam validate ${req.featureId}\` names it — so no hop can be joined through requirements the archive cannot write`,
      };
    }
  }
  return { kind: "merged", reqs: merged };
}

/** The service's flows with their claims, or `null` and the reason no one could read them. */
interface Corpus {
  flows: ServiceFlowClaims[] | null;
  error?: string;
}

async function serviceFlowCorpus(req: ServiceUseCaseRequest, paths: ServicePaths, ids: ReadonlySet<string>, requirements: readonly Requirement[]): Promise<Corpus> {
  const ctx = req.context;
  const after = new Set(requirements.flatMap((r) => (r.id === undefined ? [] : [r.id])));
  const claims = (tags: readonly string[]): Set<string> =>
    new Set(resolveRequirementTags(tags, [req.service], () => after).flatMap((c) => (c.kind === "resolved" ? [c.id] : [])));
  const service = req.service;
  const docs = await featureServiceFlows(req.featureDir, [service]);
  // What the archive writes over (`overwrittenBy`, the rule the gate's
  // `overwrites` in `core/usecases/delta/service/grade.ts` applies too).
  const overwritten = overwrittenBy(docs, paths.dir);

  const livingFlows = await livingServiceFlows({
    docsDir: req.docsDir,
    paths,
    known: req.known,
    serviceModel: (p) => ctx.serviceModel(req.docsDir, p),
    ids,
  });
  if (livingFlows === null) {
    return { flows: null, error: `${req.service}'s living project does not read — \`loam validate --service ${req.service}\` names the fault` };
  }
  const out: ServiceFlowClaims[] = livingFlows
    .filter((flow) => !overwritten.has(resolve(join(req.docsDir, flow.file))))
    .map((flow) => ({ id: flow.view.id, file: flow.file, origin: "living" as const, claims: claims(flow.view.tags) }));

  const flowDocs = docs.filter((d) => d.kind === "flow");
  if (flowDocs.length === 0) return { flows: out };
  const preview = await previewMerge({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    models: await extendingModels(req.docsDir, ctx),
    load: (path) => ctx.loadLikeC4(path),
    projectDocuments: () => projectDocumentsBesideMap(req.docsDir),
  });
  if (preview.kind === "failed") return { flows: null, error: `the archive's merge is refused, so no flow this feature draws can be read: ${preview.reason}` };
  const staged = await stageAfterMerge({
    docsDir: req.docsDir,
    service: req.service,
    paths,
    preview,
    serviceModel: (p) => ctx.serviceModel(req.docsDir, p),
    overwritten,
    documents: flowDocs,
    architecture: await req.architecture(),
    known: req.known,
  });
  if (staged.kind === "unmodelled") return { flows: null, error: staged.detail };
  const scan = staged.scan;
  if (scan.kind === "unreadable") {
    const first = scan.errors[0];
    return { flows: null, ...(first === undefined ? {} : { error: errorText(first) }) };
  }
  if (scan.kind === "read") {
    const slot = featureServiceFlowDir(req.featureDir, service);
    for (const view of scan.views) {
      // `usecases/<rel>` inside the service directory: the slot spells the same `<rel>`.
      const rel = (view.sourcePath ?? "").replace(/^usecases\//, "");
      const file = relative(req.docsDir, join(slot, ...rel.split("/"))).split(/[\\/]/).join("/");
      out.push({ id: view.id, file, origin: "feature", claims: claims(view.tags) });
    }
  }
  return { flows: out };
}

/**
 * The living flows this feature makes untrue, from the walk
 * `usecase.requirement-modified` and the removal's error are built from — so
 * the list and the findings name the same files. Asked only when the feature
 * modifies or removes a requirement of the service: nothing else can move a
 * promise under a flow.
 */
async function redrawFlows(req: ServiceUseCaseRequest, paths: ServicePaths): Promise<RedrawFlow[]> {
  const ctx = req.context;
  const pairs: ServiceDeltaPair[] = [];
  for (const axis of SPEC_AXES) {
    const reqs = req.deltas[axis.key];
    if (reqs.length === 0) continue;
    const living = existsSync(paths[axis.key]) ? await ctx.readRequirements(paths[axis.key]) : [];
    pairs.push({ id: req.service, axis: axis.key, reqs, living, paths: () => Promise.resolve(paths) });
  }
  if (!pairs.some((p) => p.reqs.some((r) => r.kind === "MODIFIED" || r.kind === "REMOVED"))) return [];
  const moved = await changedPromiseFlows({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    // The service's own promises only: a fleet flow's tag is scoped by a
    // capability, and a feature cannot redraw an `architecture/` flow anyway.
    // With no capability delta the vocabulary thunk is never called.
    capabilities: [],
    services: pairs,
    vocabulary: () => ctx.capabilities(req.docsDir),
    known: req.known,
    serviceModel: (p) => ctx.serviceModel(req.docsDir, p),
    architecture: () => ctx.architecture(req.docsDir),
    readRequirements: (path) => ctx.readRequirements(path),
  });
  // One entry per flow: the walk names a flow once per claim it moves.
  const byFile = new Map<string, RedrawFlow>();
  for (const flow of moved.filter((m) => m.altitude === "service")) {
    const key = `${flow.file}\u0000${flow.id}`;
    const entry = byFile.get(key) ?? { id: flow.id, file: flow.file, ...(flow.slot === undefined ? {} : { slot: flow.slot }), claims: [] };
    entry.claims.push({ requirement: flow.requirement, change: flow.change === "MODIFIES" ? "MODIFIED" : "REMOVED", breaks: flow.breaks });
    byFile.set(key, entry);
  }
  return [...byFile.values()];
}
