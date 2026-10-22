/**
 * `usecase.requirement-modified` — a LIVING flow whose `#req-` tag claims a
 * requirement this feature rewrites.
 *
 * THE HOLE. A `#req-` tag joins a flow to one named promise, and the join is by
 * id. A MODIFIED requirement keeps its id and replaces its whole text, so after
 * the archive the tag still resolves, every grade of the flow stays green — and
 * the flow can be drawing exactly the behaviour the new wording forbids: an
 * event path the requirement now says is gone, a hop through a service it no
 * longer names. Nothing in loam reads a flow's MEANING, so nothing can say
 * whether the drawing still keeps the promise. What loam can say is that the
 * promise moved under it, and it said nothing.
 *
 * A WARNING, AND IT NEVER GATES. Rewording a promise a flow keeps is ordinary;
 * the flow may well still keep it. This names each flow and the requirement, so
 * the author reads one against the other while the feature is still open — and
 * redraws the flow in the same change where it no longer holds.
 *
 * TWO ALTITUDES, TWO SCOPES — the ones `validate --all` resolves the tag with.
 * A flow in `architecture/` keeps a BUSINESS promise: its `#req-` tag is scoped
 * by its `#cap-` tag to a capability document (`core/capabilities/usecase-join.ts`),
 * so it is asked about the capability requirements this feature modifies. A
 * flow beside a service's model keeps that SERVICE's promise: its `#req-` tag is
 * scoped by the directory to the ids of that service's spec.md and arch.spec.md
 * (`commands/validate/service/usecases/tags.ts`), so it is asked about the
 * service requirements this feature modifies there — and only the services the
 * feature's `specs/` touch can hold one. The feature's own `usecases/` are not
 * living and are graded against the new text already (`../grade/feature.ts`).
 * A REMOVED requirement is not this code's: the merge leaves its tag resolving
 * to nothing, which is `usecase.requirement-unresolved`.
 *
 * WHAT IT COSTS. Nothing, for a feature that modifies no requirement — which is
 * nearly every feature, and the caller does not call this then. For one that
 * does, a byte scan for the tag's own spelling (`req-<slug>`) over the
 * documents that could declare it, and a LikeC4 load only for a project one of
 * them is in: a tag name is one token, so a document without its characters
 * cannot carry it. A project that does not parse is skipped, not reported —
 * `validate --all` owns that answer (`usecase.flow-invalid`, `landscape.invalid`),
 * and a warning about one requirement must not become a second report of a
 * broken map.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  REQ_TAG_PREFIX,
  resolveCapabilityTags,
  resolveRequirementTags,
  tagSlug,
} from "../../capabilities/usecase-join.js";
import { gradableCapabilityIds } from "../../capabilities/findings.js";
import type { CapabilityVocabulary } from "../../capabilities/capabilities.js";
import type { CapabilityDeltaDoc } from "../../capabilities/delta/uncovered.js";
import { architectureDocuments } from "../../c4/project/documents.js";
import { architectureProjectDocuments } from "../../c4/project/architecture.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { LoadedDoc } from "../../c4/likec4.js";
import type { ServiceModel } from "../../c4/service-model/load.js";
import { replacementsOf } from "../../document/apply.js";
import type { Requirement } from "../../document/spec.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { ServicePaths } from "../../repo/paths.js";
import { compareIds } from "../../repo/entries.js";
import type { Issue } from "../../vocabulary/issue.js";
import { useCasesIn } from "../fleet.js";
import { viewFile } from "../place.js";
import { readServiceFlows } from "../service/flows.js";

/** One delta document beside the living one it merges into — a capability's, or one spec axis of a service. */
export interface DeltaPair {
  /** The capability id, or the service id. */
  id: string;
  reqs: readonly Requirement[];
  living: readonly Requirement[];
}

/** One spec axis of a service the feature touches, and where that service lives — asked only for one whose delta modifies something. */
export interface ServiceDeltaPair extends DeltaPair {
  paths: () => Promise<ServicePaths>;
}

export interface ModifiedFlowRequest {
  docsDir: DocsDir;
  /** The feature's capability deltas — what an `architecture/` flow's tag is asked about. */
  capabilities: readonly CapabilityDeltaDoc[];
  /** The feature's service deltas, one entry per spec axis — what a service's own flow is asked about. */
  services: readonly ServiceDeltaPair[];
  /** The capability vocabulary a `#cap-` tag resolves against. */
  vocabulary: CapabilityVocabulary;
  /** The enumerated fleet, for the element→service resolver's reason (`../fleet.ts`). */
  known: ReadonlySet<string>;
  /**
   * A service's model, read the way its shape demands. Injected for
   * `./overlay.ts`'s reason: a memoised read does not justify an edge from
   * `core/usecases/` to `fleet-context`.
   */
  serviceModel: (paths: ServicePaths) => Promise<ServiceModel>;
  /**
   * The `architecture/` project, as the invocation already holds it — the
   * same injection, for the same reason: `validate --all` and `status` run this
   * walk once per active feature, and a fresh load per feature is a LikeC4
   * workspace each.
   */
  architecture: () => Promise<LoadedDoc>;
}

/** One living flow, located, and the scope its `#req-` tag resolves in. */
interface LivingFlow {
  view: ParsedView;
  /** The repo-relative file a reader opens. */
  file: string;
  /** The capability ids its own `#cap-` tags resolve to, or — beside a model — its service alone. */
  scope: string[];
  /** Which of the two scopes `scope` is in: a capability id and a service id may be spelled alike. */
  altitude: Altitude;
}

type Altitude = "capability" | "service";

export async function modifiedPromiseFlowIssues(req: ModifiedFlowRequest): Promise<Issue[]> {
  // Per altitude, what a tag resolves against TODAY — each document's living
  // ids, a service's two axes together, the one set its directory-scoped tag
  // is read against — and which of those ids this feature modifies.
  const tables: Record<Altitude, { living: Map<string, Set<string>>; modified: Map<string, Set<string>> }> = {
    capability: { living: livingIds(req.capabilities), modified: modifiedIds(req.capabilities) },
    service: { living: livingIds(req.services), modified: modifiedIds(req.services) },
  };
  const flows = [
    ...(await fleetFlows(req, tables.capability.modified)),
    ...(await serviceFlows(req, tables.service.modified)),
  ];
  const issues: Issue[] = [];
  for (const { view, file, scope, altitude } of flows.sort((a, b) => compareIds(a.file, b.file) || compareIds(a.view.id, b.view.id))) {
    const table = tables[altitude];
    for (const claim of resolveRequirementTags(view.tags, scope, (id) => table.living.get(id))) {
      if (claim.kind !== "resolved" || table.modified.get(claim.capability)?.has(claim.id) !== true) continue;
      const whose =
        altitude === "capability" ? `${claim.capability}#${claim.id}` : `${claim.capability}'s requirement ${claim.id}`;
      issues.push({
        severity: "warn",
        code: "usecase.requirement-modified",
        subject: claim.capability,
        message:
          `${file}: flow '${view.id}' is tagged #${claim.tag} — it claims ${whose}, which this feature MODIFIES. ` +
          `The tag will still resolve after the archive and nothing grades what the flow draws against the new ` +
          `wording: read the flow against the replacement, and redraw it in this change if it no longer keeps the promise.`,
        locations: [{ path: file, role: "primary" }],
      });
    }
  }
  return issues;
}

/**
 * The requirement ids each document's delta MODIFIES, by the id the LIVING
 * document gives them — selected by `replacementsOf`, the merge's own walk, so
 * a MODIFIED written by heading alone still names the id a tag carries. A
 * document the merge would refuse is skipped: the delta gate reports it, and
 * this warning has nothing true to say about a merge that cannot happen.
 */
function modifiedIds(docs: readonly DeltaPair[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const doc of docs) {
    let replaced;
    try {
      replaced = replacementsOf([...doc.living], [...doc.reqs]);
    } catch {
      continue;
    }
    for (const r of replaced) {
      if (r.kind !== "MODIFIED" || r.living.id === undefined) continue;
      out.set(doc.id, (out.get(doc.id) ?? new Set()).add(r.living.id));
    }
  }
  return out;
}

function livingIds(docs: readonly DeltaPair[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const doc of docs) {
    const ids = out.get(doc.id) ?? new Set<string>();
    for (const r of doc.living) if (r.id !== undefined) ids.add(r.id);
    out.set(doc.id, ids);
  }
  return out;
}

/** The tag spellings that could claim one of these ids. */
function needlesFor(modified: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return [...new Set([...modified.values()].flatMap((ids) => [...ids].map((id) => `${REQ_TAG_PREFIX}${tagSlug(id)}`)))];
}

/** Does any of these documents contain one of the tag spellings at all? Unreadable fails closed, as `../fleet.ts`'s gate does. */
async function mentions(paths: readonly string[], needles: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const text = (await readFile(path)).toString("latin1");
      if (needles.some((needle) => text.includes(needle))) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function fleetFlows(req: ModifiedFlowRequest, modified: ReadonlyMap<string, ReadonlySet<string>>): Promise<LivingFlow[]> {
  // The vocabulary ladder (`core/capabilities/findings.ts`): with nothing
  // declared no `#cap-` tag resolves, so no fleet flow can be said to claim anything.
  const declared = gradableCapabilityIds(req.vocabulary);
  if (modified.size === 0 || declared === null) return [];
  if (!(await mentions(await architectureProjectDocuments(req.docsDir), needlesFor(modified)))) return [];
  const read = useCasesIn(await req.architecture(), req.known);
  if (read.kind !== "read") return [];
  return read.views.map((view) => ({
    view,
    file: viewFile(view),
    scope: resolveCapabilityTags(view.tags, declared).flatMap((c) => (c.kind === "resolved" ? [c.id] : [])),
    altitude: "capability" as const,
  }));
}

async function serviceFlows(req: ModifiedFlowRequest, modified: ReadonlyMap<string, ReadonlySet<string>>): Promise<LivingFlow[]> {
  const out: LivingFlow[] = [];
  for (const [service, ids] of modified) {
    // Sequential on purpose, for `../fleet.ts`'s gate's reason: nearly every
    // service answers from one readdir and a byte scan, and the rare one that
    // opens a workspace should not be raced by the ones that do not need one.
    const pair = req.services.find((doc) => doc.id === service);
    if (pair === undefined) continue;
    const paths = await pair.paths();
    if (!(await mentions(await architectureDocuments(paths.dir), needlesFor(new Map([[service, ids]]))))) continue;
    const model = await req.serviceModel(paths);
    if (model.mapUnreadable || model.doc.errors.length > 0) continue;
    const flows = await readServiceFlows({
      paths,
      model: model.doc,
      known: req.known,
      ...(model.shape === "extending" && model.project !== null
        ? { extending: { docsDir: req.docsDir, project: model.project } }
        : {}),
    });
    if (flows.kind !== "read") continue;
    for (const view of flows.views) {
      const file = relative(req.docsDir, join(paths.dir, view.sourcePath ?? "model.likec4")).split(/[\\/]/).join("/");
      out.push({ view, file, scope: [service], altitude: "service" });
    }
  }
  return out;
}
