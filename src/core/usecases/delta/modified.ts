/**
 * The LIVING flows whose `#req-` tag claims a requirement this feature changes:
 * `usecase.requirement-modified` for one it rewrites, and
 * `usecase.requirement-unresolved` for one it takes away.
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
 * A REMOVAL IS THE FLEET'S OWN ERROR, ONE ARCHIVE EARLY. The merge deletes the
 * promise and leaves the tag, so the very next `validate --all` reports the flow
 * `usecase.requirement-unresolved` — while the feature gate had said nothing and
 * the archive had exited 0 (the real-fleet review, 2026-10-21). That grade holds
 * no judgement about the drawing: the tag resolves to nothing, whatever the flow
 * shows. So it is raised here under the SAME code, at the same severity, with
 * the VIEW as its subject as at fleet altitude — the fleet's grade predicted,
 * not a second opinion beside it — and as an error it gates the archive.
 * `--approve` may walk past it, for `capability.remove-requirement-realized`'s
 * reason one carrier over: retiring a promise something still claims is the
 * author's call about the feature, loam reads the flow perfectly well (this is
 * no `usecase.flow-invalid` blindness), and the living docs then carry exactly
 * the error this named.
 *
 * GRADED AGAINST WHAT THE MERGE LEAVES, not against the REMOVED list. Each
 * document's after-side is the merge's own fold (`applyRequirementDelta`), so a
 * removal the same delta re-spells under an id that flattens to the same tag
 * leaves the tag resolving and earns nothing, exactly as the fleet will grade
 * it. The same verdict is asked of a MODIFIED: it keeps its id, but
 * an id this feature adds beside it may flatten to the same tag, and then the
 * merge breaks the tag too — the error, not the warning, whose "the tag will
 * still resolve" would be false. And only a claim that resolves TODAY is asked
 * about: one that is already broken is `validate --all`'s finding now, and
 * reporting it again here would be one mistake counted twice.
 *
 * TWO ALTITUDES, TWO SCOPES — the ones `validate --all` resolves the tag with.
 * A flow in `architecture/` keeps a BUSINESS promise: its `#req-` tag is scoped
 * by its `#cap-` tag to a capability document (`core/capabilities/usecase-join.ts`),
 * so it is asked about the capability requirements this feature changes. A
 * flow beside a service's model keeps that SERVICE's promise: its `#req-` tag is
 * scoped by the directory to the ids of that service's spec.md and arch.spec.md
 * (`../service/tags.ts`), so it is asked about the
 * service requirements this feature changes there — and only the services the
 * feature's `specs/` touch can hold one. BOTH documents are that scope, so the
 * one a touched service carries no delta for is read as it stands: without it
 * an id the other document also declares would read as gone after the merge,
 * and gate an archive the fleet then grades green. The feature's own
 * `usecases/` are not living and are graded against the new text already
 * (`../grade/feature.ts`).
 *
 * WHAT IT COSTS. Nothing, for a feature that modifies and removes no
 * requirement — which is nearly every feature, and the caller does not call
 * this then. For one that does, a byte scan for the tag's own spelling
 * (`req-<slug>`) over the documents that could declare it, the living document
 * of a touched service's other axis, and a LikeC4 load only for a project one
 * of them is in: a tag name is one token, so a document without its characters
 * cannot carry it. A project that does not parse is skipped, not reported —
 * `validate --all` owns that answer (`usecase.flow-invalid`, `landscape.invalid`),
 * and a finding about one requirement must not become a second report of a
 * broken map.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  REQ_TAG_PREFIX,
  resolveCapabilityTags,
  resolveRequirementTags,
  tagSlug,
  type RequirementClaim,
} from "../../capabilities/usecase-join.js";
import { gradableCapabilityIds } from "../../capabilities/findings.js";
import type { CapabilityVocabulary } from "../../capabilities/capabilities.js";
import type { CapabilityDeltaDoc } from "../../capabilities/delta/uncovered.js";
import { architectureDocuments } from "../../c4/project/documents.js";
import { architectureProjectDocuments } from "../../c4/project/architecture.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { LoadedDoc } from "../../c4/likec4.js";
import type { ServiceModel } from "../../c4/service-model/load.js";
import { applyRequirementDelta, replacementsOf, type Replacement } from "../../document/apply.js";
import type { Requirement } from "../../document/spec.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { SPEC_AXES, type ServicePaths, type SpecAxis } from "../../repo/paths.js";
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

/** One spec axis of a service the feature touches, and where that service lives — asked only for one whose delta changes something. */
export interface ServiceDeltaPair extends DeltaPair {
  /** Which of the service's two documents this is: the other is read as it stands when the feature carries no delta for it. */
  axis: SpecAxis["key"];
  paths: () => Promise<ServicePaths>;
}

export interface ChangedPromiseRequest {
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
  /** A living requirements document, parsed — a touched service's axis the feature carries no delta for. Injected for the same reason again. */
  readRequirements: (path: string) => Promise<Requirement[]>;
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

type Resolved = Extract<RequirementClaim, { kind: "resolved" }>;

/**
 * Per document id — a capability, or a service's two axes together, the one
 * set its directory-scoped tag is read against — the ids a tag resolves
 * against today and after the merge, and which living ids this feature
 * rewrites or retires.
 */
interface Table {
  living: Map<string, Set<string>>;
  merged: Map<string, Set<string>>;
  modified: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
}

export async function changedPromiseFlowIssues(req: ChangedPromiseRequest): Promise<Issue[]> {
  const tables: Record<Altitude, Table> = {
    capability: tableOf(req.capabilities),
    service: tableOf(await withUntouchedAxes(req)),
  };
  const flows = [
    ...(await fleetFlows(req, changedIds(tables.capability))),
    ...(await serviceFlows(req, changedIds(tables.service))),
  ];
  const issues: Issue[] = [];
  for (const flow of flows.sort((a, b) => compareIds(a.file, b.file) || compareIds(a.view.id, b.view.id))) {
    const table = tables[flow.altitude];
    const after = new Map(resolveRequirementTags(flow.view.tags, flow.scope, (id) => table.merged.get(id)).map((c) => [c.tag, c]));
    for (const claim of resolveRequirementTags(flow.view.tags, flow.scope, (id) => table.living.get(id))) {
      if (claim.kind !== "resolved") continue;
      const change = changeOf(table, claim);
      if (change === null) continue;
      // The merge's verdict first, for either change: a MODIFIED keeps its id,
      // but an id this feature adds beside it can flatten to the same tag, and
      // then the warning's "the tag will still resolve" would be false.
      const later = after.get(claim.tag);
      if (later !== undefined && later.kind !== "resolved") issues.push(brokenIssue(flow, claim, { change, later }));
      else if (change === "MODIFIES") issues.push(modifiedIssue(flow, claim));
    }
  }
  return issues;
}

function changeOf(table: Table, claim: Resolved): "MODIFIES" | "REMOVES" | null {
  if (table.modified.get(claim.capability)?.has(claim.id) === true) return "MODIFIES";
  return table.removed.get(claim.capability)?.has(claim.id) === true ? "REMOVES" : null;
}

function whose(flow: LivingFlow, claim: Resolved): string {
  return flow.altitude === "capability" ? `${claim.capability}#${claim.id}` : `${claim.capability}'s requirement ${claim.id}`;
}

function modifiedIssue(flow: LivingFlow, claim: Resolved): Issue {
  return {
    severity: "warn",
    code: "usecase.requirement-modified",
    subject: claim.capability,
    message:
      `${flow.file}: flow '${flow.view.id}' is tagged #${claim.tag} — it claims ${whose(flow, claim)}, which this feature MODIFIES. ` +
      `The tag will still resolve after the archive and nothing grades what the flow draws against the new ` +
      `wording: read the flow against the replacement, and redraw it in this change if it no longer keeps the promise.`,
    locations: [{ path: flow.file, role: "primary" }],
  };
}

/**
 * The tag the merge breaks. Two ways, and each has its own fix: a removal
 * leaves nothing the tag names, and an id this feature adds can flatten to the
 * same tag as the one it claims — the only way a MODIFIED, which keeps its id,
 * can break it at all.
 */
function brokenIssue(
  flow: LivingFlow,
  claim: Resolved,
  broken: { change: "MODIFIES" | "REMOVES"; later: Exclude<RequirementClaim, { kind: "resolved" }> },
): Issue {
  const { change, later } = broken;
  const [why, fix] =
    later.kind === "many"
      ? [
          `${later.ids.length} requirements will flatten to '${later.slug}' (${later.ids.join(", ")}), so nothing in the tag can say which promise the flow keeps`,
          "rename one of the colliding ids in this change",
        ]
      : [
          "nothing it names is left",
          "drop the tag (or point it at the promise that replaces this one) in this change, or MODIFY the requirement instead of removing it",
        ];
  return {
    severity: "error",
    code: "usecase.requirement-unresolved",
    // The VIEW, as `validate --all` names it once the archive lands — so the
    // prediction and the outcome are about one thing a reader opens.
    subject: flow.view.id,
    message:
      `${flow.file}: flow '${flow.view.id}' is tagged #${claim.tag} — it claims ${whose(flow, claim)}, which this feature ${change}. ` +
      `After the archive the tag no longer resolves — ${why} — and \`loam validate --all\` reports this flow with this ` +
      `same error: ${fix}.`,
    locations: [{ path: flow.file, role: "primary" }],
  };
}

/**
 * Each document's table rows. The modified and removed ids are named by the id
 * the LIVING document gives them — selected by `replacementsOf`, the merge's own
 * walk, so a MODIFIED or REMOVED written by heading alone still names the id a
 * tag carries — and the after-side is that same merge's result. A document the
 * merge would refuse keeps its living ids on both sides and changes nothing:
 * the delta gate reports it, and nothing here has a true thing to say about a
 * merge that cannot happen.
 *
 * TODAY'S side leaves out a living requirement sitting under a REMOVED heading,
 * as both fleet indexes do (`capabilityRequirementIndex`, `requirementIdsOf`):
 * a tag resolving only through one is already the fleet's error. The fold
 * still runs on the whole living list, because that is the archive's input.
 */
function tableOf(docs: readonly DeltaPair[]): Table {
  const table: Table = { living: new Map(), merged: new Map(), modified: new Map(), removed: new Map() };
  for (const doc of docs) {
    const living = doc.living.filter((r) => r.kind !== "REMOVED");
    let fold: { replaced: Replacement[]; merged: readonly Requirement[] };
    try {
      fold = { replaced: replacementsOf([...doc.living], [...doc.reqs]), merged: applyRequirementDelta([...doc.living], [...doc.reqs]) };
    } catch {
      fold = { replaced: [], merged: living };
    }
    idsInto(table.living, doc.id, living);
    idsInto(table.merged, doc.id, fold.merged);
    for (const r of fold.replaced) {
      if (r.living.id === undefined || (r.kind !== "MODIFIED" && r.kind !== "REMOVED")) continue;
      const into = r.kind === "MODIFIED" ? table.modified : table.removed;
      into.set(doc.id, (into.get(doc.id) ?? new Set()).add(r.living.id));
    }
  }
  return table;
}

/** A document's ids, unioned into its row — created even when empty, which is the `empty` arm's answer rather than `undocumented`'s. */
function idsInto(rows: Map<string, Set<string>>, id: string, reqs: readonly Requirement[]): void {
  const ids = rows.get(id) ?? new Set<string>();
  for (const r of reqs) if (r.id !== undefined) ids.add(r.id);
  rows.set(id, ids);
}

/** The ids each document's delta modifies or removes — what a flow has to mention to be asked about at all. */
function changedIds(table: Table): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const rows of [table.modified, table.removed]) {
    for (const [id, ids] of rows) out.set(id, new Set([...(out.get(id) ?? []), ...ids]));
  }
  return out;
}

/**
 * The service pairs, plus — for each service whose delta modifies or removes
 * something — every document of it the feature carries no delta for, as it
 * stands (`reqs: []`, so it changes nothing and only widens both sides).
 * `requirementIdsOf` (`../service/grade.ts`) reads
 * both documents for a service-local tag, skipping a requirement under a
 * REMOVED heading; so must this, or a tag the untouched document keeps
 * resolving reads as broken — and one only a REMOVED entry there answers reads
 * as kept, though the archive leaves that document as it is.
 */
async function withUntouchedAxes(req: ChangedPromiseRequest): Promise<DeltaPair[]> {
  const out: DeltaPair[] = [...req.services];
  const asked = new Set<string>();
  // Sequential, and it costs nothing worth racing: a feature names a handful of
  // services, each read is one memoised document, and most services here
  // already have both axes in the feature or no second document at all.
  for (const pair of req.services) {
    const own = req.services.filter((p) => p.id === pair.id);
    if (asked.has(pair.id) || !own.some((p) => p.reqs.some((r) => r.kind === "MODIFIED" || r.kind === "REMOVED"))) continue;
    asked.add(pair.id);
    const paths = await pair.paths();
    for (const axis of SPEC_AXES) {
      if (own.some((p) => p.axis === axis.key) || !existsSync(paths[axis.key])) continue;
      const living = (await req.readRequirements(paths[axis.key])).filter((r) => r.kind !== "REMOVED");
      out.push({ id: pair.id, reqs: [], living });
    }
  }
  return out;
}

/** The tag spellings that could claim one of these ids. */
function needlesFor(changed: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return [...new Set([...changed.values()].flatMap((ids) => [...ids].map((id) => `${REQ_TAG_PREFIX}${tagSlug(id)}`)))];
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

async function fleetFlows(req: ChangedPromiseRequest, changed: ReadonlyMap<string, ReadonlySet<string>>): Promise<LivingFlow[]> {
  // The vocabulary ladder (`core/capabilities/findings.ts`): with nothing
  // declared no `#cap-` tag resolves, so no fleet flow can be said to claim anything.
  const declared = gradableCapabilityIds(req.vocabulary);
  if (changed.size === 0 || declared === null) return [];
  if (!(await mentions(await architectureProjectDocuments(req.docsDir), needlesFor(changed)))) return [];
  const read = useCasesIn(await req.architecture(), req.known);
  if (read.kind !== "read") return [];
  return read.views.map((view) => ({
    view,
    file: viewFile(view),
    scope: resolveCapabilityTags(view.tags, declared).flatMap((c) => (c.kind === "resolved" ? [c.id] : [])),
    altitude: "capability" as const,
  }));
}

async function serviceFlows(req: ChangedPromiseRequest, changed: ReadonlyMap<string, ReadonlySet<string>>): Promise<LivingFlow[]> {
  const out: LivingFlow[] = [];
  for (const [service, ids] of changed) {
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
