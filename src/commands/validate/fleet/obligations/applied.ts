/**
 * WHERE each obligation is applied on the living fleet map — the objects the
 * grader in `./obligations.ts` asks its questions of.
 *
 * A module of its own because these are the two halves the grader always had:
 * the applications (which objects carry which obligation, and which of them the
 * coverage question may be asked of) and the questions themselves. The halves
 * parted when a FLOW became a fourth kind of tagged object, whose application
 * is expanded hop by hop into the relationships it rides
 * (`core/usecases/obligations/flows.ts`) — and the union that keeps a flow from
 * ever reaching the coverage question is this module's whole shape.
 */
import { type Elem, type LoadedDoc, type Rel } from "../../../../core/c4/likec4.js";
import { NO_DEPLOYMENT } from "../../../../core/c4/parsed/deployment.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { elementService, serviceResolver } from "../../../../core/c4/resolve/service.js";
import { taggedDeployment, type TaggedDeployment } from "../../../../core/deployment/objects.js";
import { OBLIGATION_TAG_PREFIX } from "../../../../core/obligations/obligations.js";
import { edgeOwner, hopEdges, viewObligations } from "../../../../core/usecases/obligations/flows.js";
import { stepPlace, viewFile } from "../../../../core/usecases/place.js";
import { compareIds } from "../../../../core/repo/entries.js";

/** What every application shares: which obligation, and how a message names the object. */
interface Placed {
  obligation: string;
  /**
   * How the finding spells this object, and how a `Covers:` line has to: an
   * element id, `source -> target`, or the `node:` forms. A flow's is its id
   * and file, which no `Covers:` line names.
   */
  where: string;
  /**
   * What the finding is filed under — the service that owns it, where one
   * does. ABSENT for a region, a datacenter or a cluster, and for an edge
   * neither of whose ends is one of ours: naming a team that did not ask for
   * the work is worse than leaving the sentence general.
   */
  subject?: string;
}

/**
 * One place an obligation is applied, by what it sits on.
 *
 * A union rather than a record of optional fields, because the coverage
 * question may be asked of three of the four and must never be asked of the
 * fourth: no `Covers:` form names a view, so a flow is expanded into the
 * relationships its hops ride first (`coverageObjects`), and `Covered` is what
 * the compiler lets reach `uncoveredFindings`.
 */
export type TaggedObject =
  | (Placed & { kind: "element"; element: Elem })
  | (Placed & {
      kind: "edge";
      edge: Rel;
      /**
       * For an edge that is here because a flow's hop rides it rather than
       * because the map tags it: which flow, and which hop, so the message says
       * why an edge nobody tagged is being asked about.
       */
      via?: string;
    })
  | (Placed & { kind: "deployed"; deployed: TaggedDeployment })
  | (Placed & { kind: "flow"; view: ParsedView });

/** The applications the coverage question can be asked of. */
export type Covered = Exclude<TaggedObject, { kind: "flow" }>;

/**
 * Every `#obl-` tag on the living map, one entry per (obligation, object) pair.
 *
 * A bare `#obl-` slugs to the empty string and is kept as an application on
 * purpose, exactly as a bare `#cap-` is kept as a claim: the prefix is the
 * author's opt-in however little follows it, and dropping it as unreserved
 * would leave an object that asked to be graded silently ungraded. It then
 * resolves to `obligation.unknown` in every fleet that did not declare an empty
 * id, which is the honest answer.
 */
export function taggedObjects(land: LoadedDoc, known: ReadonlySet<string>): TaggedObject[] {
  const out: TaggedObject[] = [];
  const resolve = serviceResolver(land.elements, known);
  for (const element of land.elements) {
    for (const tag of element.tags.filter((t) => t.startsWith(OBLIGATION_TAG_PREFIX))) {
      out.push({
        kind: "element",
        obligation: tag.slice(OBLIGATION_TAG_PREFIX.length),
        element,
        where: element.id,
        subject: elementService(element),
      });
    }
  }
  for (const edge of land.relationships) {
    for (const tag of edge.tags.filter((t) => t.startsWith(OBLIGATION_TAG_PREFIX))) {
      out.push(edgeObject(tag.slice(OBLIGATION_TAG_PREFIX.length), edge, edgeOwner(edge, resolve, known)));
    }
  }
  // The flows. `land.views` is the `architecture/` project's, use cases and
  // diagrams alike, and an `#obl-` tag is what makes one of them a use case
  // (`isUseCase`) — so every view carrying the tag is read here, and no other.
  // Sorted by (file, view id) for `gradedViews`' reason: when two flows ride
  // one edge the first one seen names the finding's `via`, and nothing in loam
  // has measured that the parse preserves declaration order.
  const views = [...(land.views ?? [])].sort((a, b) => compareIds(viewFile(a), viewFile(b)) || compareIds(a.id, b.id));
  for (const view of views) {
    for (const obligation of viewObligations(view)) {
      out.push({ kind: "flow", obligation, view, where: `flow '${view.id}' (${viewFile(view)})` });
    }
  }
  // The topology, walked by the same rule and for the reason the rule exists: a
  // tag is a claim about the object it sits on, and which MODEL that object
  // lives in is not something a reader of the tag can see. Until this walk the
  // same undeclared tag was an error on a container and silence on a
  // datacenter — fail-open, and the case FEAT-1's ARCH-LOAM-DEPLOY-TAGGED was
  // written about. A fleet that draws no topology contributes nothing here.
  for (const d of taggedDeployment(land.deployment ?? NO_DEPLOYMENT, land.elements, known, OBLIGATION_TAG_PREFIX)) {
    out.push({
      kind: "deployed",
      obligation: d.obligation,
      deployed: d,
      where: d.where,
      ...(d.service === undefined ? {} : { subject: d.service }),
    });
  }
  return out;
}

/**
 * An edge carrying an obligation, spelled once for the map's tag and a flow's
 * hop alike — the `where` both arms spell the same is what lets
 * `coverageObjects` count one endpoint pair once (`edgeKey`'s reason: a
 * `Covers:` edge line names endpoints and nothing else).
 *
 * The SUBJECT is the service that answers for the edge (`edgeOwner`). It used
 * to be the raw target id, so an edge into a container filed its finding under
 * the container and a publish edge under the topic — a worklist "per team"
 * whose rows named no team; a flow's hops, half of them publishes and
 * deliveries, made that the common case rather than the odd one.
 */
function edgeObject(obligation: string, edge: Rel, owner: string | undefined, via?: string): Covered {
  return {
    kind: "edge",
    obligation,
    edge,
    where: `${edge.source} -> ${edge.target}`,
    ...(owner === undefined ? {} : { subject: owner }),
    ...(via === undefined ? {} : { via }),
  };
}

/**
 * What the coverage question is asked of: every tagged object but the flows,
 * plus the relationship behind each hop of each flow, once per obligation and
 * endpoint pair.
 *
 * The map's own tags come first, so an edge that is both tagged and ridden by
 * a flow reads as tagged — the stronger statement, and the one whose message
 * needs no flow to explain it. A hop nothing backs contributes nothing:
 * `usecase.step-unbacked` reports it, and there is no relationship for a
 * `Covers:` line to name.
 */
export function coverageObjects(land: LoadedDoc, known: ReadonlySet<string>, tagged: TaggedObject[]): Covered[] {
  const resolve = serviceResolver(land.elements, known);
  const scope = { elements: land.elements, relationships: land.relationships, known };
  const seen = new Set<string>();
  const out: Covered[] = [];
  const add = (t: Covered): void => {
    const key = JSON.stringify([t.obligation, t.where]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const t of tagged) if (t.kind !== "flow") add(t);
  for (const t of tagged) {
    if (t.kind !== "flow") continue;
    for (const hop of hopEdges(t.view, scope)) {
      add(edgeObject(t.obligation, hop.edge, edgeOwner(hop.edge, resolve, known), `${stepPlace(hop.step)} of ${t.where}`));
    }
  }
  return out;
}
