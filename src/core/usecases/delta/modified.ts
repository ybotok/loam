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
 * and gate an archive the fleet then grades green. The feature's own flows
 * are not living and are graded against the new text already — its
 * `usecases/` by `../grade/feature.ts`, its `specs/<svc>/usecases/` by
 * `./service/grade.ts` — and a living service flow one of those REDRAWS (a
 * document at its path) is skipped below for the same reason: after the
 * archive the file is the feature's.
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
import { join, relative } from "node:path";
import { resolveCapabilityTags, resolveRequirementTags, type RequirementClaim } from "../../capabilities/usecase-join.js";
import { gradableCapabilityIds } from "../../capabilities/findings.js";
import type { CapabilityVocabulary } from "../../capabilities/capabilities.js";
import type { CapabilityDeltaDoc } from "../../capabilities/delta/uncovered.js";
import { architectureProjectDocuments } from "../../c4/project/architecture.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { LoadedDoc } from "../../c4/likec4.js";
import type { ServiceModel } from "../../c4/service-model/load.js";
import type { Requirement } from "../../document/spec.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { rawServiceId } from "../../kernel/ids/service.js";
import type { ServicePaths } from "../../repo/paths.js";
import { compareIds } from "../../repo/entries.js";
import type { Issue } from "../../vocabulary/issue.js";
import { useCasesIn } from "../fleet.js";
import { viewFile } from "../place.js";
import { changedIds, tableOf, withUntouchedAxes, type Table, type ServiceDeltaPair } from "./service/ids.js";
import { livingServiceFlows, mentions, needlesFor } from "./service/living.js";
import { featureServiceFlowDir, SERVICE_FLOW_DIR } from "./service/slot.js";

export interface ChangedPromiseRequest {
  docsDir: DocsDir;
  /** The feature, for the one question a living service flow is asked first: does this feature redraw it (`./service/slot.ts`)? */
  featureDir: FeatureDir;
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
  /**
   * Beside a model, and under its `usecases/` only: the feature document that
   * would replace this flow's file (`./service/slot.ts`), docs-relative — what
   * the finding tells an author to write. Absent for an `architecture/` flow,
   * and for one in `views.likec4` or model.likec4, which no feature can redraw.
   */
  slot?: string;
}

type Altitude = "capability" | "service";

type Resolved = Extract<RequirementClaim, { kind: "resolved" }>;

export async function changedPromiseFlowIssues(req: ChangedPromiseRequest): Promise<Issue[]> {
  const tables: Record<Altitude, Table> = {
    capability: tableOf(req.capabilities),
    service: tableOf(await withUntouchedAxes(req.services, req.readRequirements)),
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
      `wording: read the flow against the replacement, and ${redraw(flow)}.`,
    locations: [{ path: flow.file, role: "primary" }],
  };
}

/**
 * How THIS flow is redrawn, which depends on where it lives. A service flow
 * under `usecases/` has a feature-side slot, and the redrawn flow belongs there:
 * it is graded against the model the merge leaves and lands with the archive.
 * Edited in place instead, a redraw naming a container this feature's delta
 * adds would fail `validate --all` until the archive — so the slot is the one
 * route that works for the case this warning exists for. Everything else is
 * edited where it lives.
 */
function redraw(flow: LivingFlow): string {
  if (flow.slot !== undefined) {
    return (
      `if it no longer keeps the promise, redraw it in this change at ${flow.slot} — the archive writes it over this ` +
      "file, graded first against the model the merge leaves (a document there holding only comments retires the flow instead)"
    );
  }
  return flow.altitude === "service"
    ? "redraw it in this change if it no longer keeps the promise — in place, since only a flow under the service's usecases/ has a slot a feature can redraw it from"
    : "redraw it in this change if it no longer keeps the promise";
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
          `drop the tag (or point it at the promise that replaces this one) in this change${flow.slot === undefined ? "" : ` — by a redrawn flow at ${flow.slot}, or a document there holding only comments, which retires it`}, or MODIFY the requirement instead of removing it`,
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

async function fleetFlows(req: ChangedPromiseRequest, changed: ReadonlyMap<string, ReadonlySet<string>>): Promise<LivingFlow[]> {
  // The vocabulary ladder (`core/capabilities/findings.ts`): with nothing
  // declared no `#cap-` tag resolves, so no fleet flow can be said to claim anything.
  const declared = gradableCapabilityIds(req.vocabulary);
  if (changed.size === 0 || declared === null) return [];
  if (!(await mentions(await architectureProjectDocuments(req.docsDir), needlesFor([...changed.values()].flatMap((ids) => [...ids]))))) return [];
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
    const flows = await livingServiceFlows({ docsDir: req.docsDir, paths, known: req.known, serviceModel: req.serviceModel, ids });
    const dir = featureServiceFlowDir(req.featureDir, rawServiceId(service));
    for (const { view, file } of flows ?? []) {
      const rel = view.sourcePath?.startsWith(`${SERVICE_FLOW_DIR}/`) === true ? view.sourcePath.slice(SERVICE_FLOW_DIR.length + 1) : undefined;
      const slot = rel === undefined ? undefined : join(dir, ...rel.split("/"));
      // A flow this feature REDRAWS is not asked about at all: after the archive
      // it is the feature's document, which `./service/grade.ts` grades against
      // the ids the merge leaves — so a warning to redraw it, or a prediction that
      // its old tag breaks, would be about a file the archive replaces.
      if (slot !== undefined && existsSync(slot)) continue;
      out.push({
        view,
        file,
        scope: [service],
        altitude: "service",
        ...(slot === undefined ? {} : { slot: relative(req.docsDir, slot).split(/[\\/]/).join("/") }),
      });
    }
  }
  return out;
}
