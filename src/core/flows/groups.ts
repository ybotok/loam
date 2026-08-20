/**
 * Suites: which flows belong together, and what a run of one needs standing up.
 *
 * A flow joins a group by carrying a TAG, and the departure from the subsystem
 * tree it otherwise copies is deliberate. A subsystem groups services and
 * exactly-one-place is correct for them; suites are many-to-many — one journey
 * belongs to a smoke suite and a payments suite at once — and a directory
 * cannot say so. The tag also buys the typo check for free: LikeC4 refuses an
 * UNDECLARED tag, so a group declared once in a `specification` block makes a
 * mistyped group a parse error, where a mistyped directory name would silently
 * open a second group nobody notices is empty.
 *
 * THE ONE RULE THE GRAMMAR OWES: a group tag may not take the feature-id
 * grammar. Feature tags and group tags sit on the same line of the same view —
 * `#FEAT-101` marks a view a feature is changing exactly as it marks an element
 * — so the two vocabularies share one namespace, and the only thing that can
 * tell them apart is the shape of the name. `reservedGroupTags` reports every
 * tag that lands on the wrong side of it, because the alternative is a suite
 * that silently contains nothing.
 */
import type { Flow } from "../c4/flows/flow.js";
import { serviceResolver, type Elem } from "../c4/model/model.js";
import { isFeatureId } from "../kernel/ids/feature.js";

/** One suite: the tag that names it, the flows carrying it, and their participants. */
export interface FlowGroup {
  /** The tag, without '#' — exactly as `Flow.tags` spells it. */
  name: string;
  /** The ids of the flows in this group, sorted. */
  flows: string[];
  /**
   * The union of those flows' participants — element ids, sorted, deduplicated.
   * Sorted rather than first-appearance ordered, unlike a single flow's own
   * participants: a union has no document order to preserve, and the generated
   * views file compares byte-for-byte after a regeneration.
   */
  members: string[];
}

/** A tag loam had to refuse as a group, and the flow that carries it. */
export interface ReservedTag {
  flow: string;
  tag: string;
}

/**
 * Every group the fleet's flows declare, sorted by name.
 *
 * A flow with no group tag is in no group — legal and normal, exactly as an
 * unfiled service is: the flow is still a flow, it is simply not part of any
 * suite yet, and nothing generated says otherwise.
 */
export function flowGroups(flows: Flow[]): FlowGroup[] {
  const byName = new Map<string, { flows: Set<string>; members: Set<string> }>();
  for (const flow of flows) {
    for (const tag of groupTags(flow)) {
      const group = byName.get(tag) ?? { flows: new Set<string>(), members: new Set<string>() };
      byName.set(tag, group);
      group.flows.add(flow.id);
      for (const participant of flow.participants) group.members.add(participant);
    }
  }
  return [...byName.entries()]
    .map(([name, group]) => ({ name, flows: sorted(group.flows), members: sorted(group.members) }))
    .sort((a, b) => compare(a.name, b.name));
}

/**
 * Every tag on a flow that takes the feature-id grammar — the rule above,
 * enforced. One entry per (flow, tag), sorted, so a caller reports them in an
 * order two machines agree on.
 *
 * Enforced by REPORTING rather than by refusing the document: the file parses,
 * the tag is declared, and the only thing wrong is that loam cannot tell which
 * axis the author meant. Reading it as the feature tag it looks like is the
 * safe half of that guess — a feature's projection over a view must keep
 * working — and this is the half that says so out loud, because a group that
 * silently contains no flow is indistinguishable from a suite nobody has
 * written yet.
 */
export function reservedGroupTags(flows: Flow[]): ReservedTag[] {
  const out: ReservedTag[] = [];
  for (const flow of flows) {
    for (const tag of flow.tags) {
      if (isFeatureId(tag)) out.push({ flow: flow.id, tag });
    }
  }
  return out.sort((a, b) => compare(a.flow, b.flow) || compare(a.tag, b.tag));
}

/**
 * The journeys in NO suite — every flow whose tags declare no group, sorted by
 * id.
 *
 * The exact complement of `flowGroups` over the same `groupTags` filter, and
 * sharing that filter is the whole point: a tag taking the feature-id grammar
 * is read as a FEATURE tag and groups nothing, so a journey carrying only such
 * a tag is as unsuited as one carrying no tag at all. A second spelling of
 * "which tags group" would let the two disagree about exactly that journey —
 * the one an author is most likely to believe is suited.
 *
 * WHY THIS IS ANSWERED AT ALL, since a flow in no group is legal and normal
 * (the header above says so, and `subsystem`'s unfiled services are the same
 * shape): everything downstream of this module is per-GROUP. `./views.ts`
 * renders one view per group and `groupEnvironments` below answers one
 * environment per group, so a journey in none of them is absent from every line
 * either command prints — and absent in the one way an output cannot show. The
 * emission names them (`commands/flow/render.ts`); nothing grades them.
 *
 * Sorted here rather than trusted from the caller: `flattenFlows` does sort by
 * id, but this takes any `Flow[]`, and a list two machines print in two orders
 * is a diff nobody can read.
 */
export function ungroupedFlows(flows: Flow[]): string[] {
  return flows
    .filter((flow) => groupTags(flow).length === 0)
    .map((flow) => flow.id)
    .sort(compare);
}

/** What a run of one group needs standing up — the machine answer to "which services". */
export interface GroupEnvironment {
  group: string;
  flows: string[];
  /**
   * The service IDS the group's participants resolve to, sorted — what a
   * consumer joins on, never a path. A service's directory is wherever the
   * subsystem tree puts it (`services/<subsystem>/<id>/` once a fleet files
   * anything), so a consumer that built `services/<id>/` from this would miss
   * every filed service; identity is the id and placement is not part of it.
   */
  services: string[];
  /** Participants that resolve to no service directory — named, never dropped. */
  unresolved: UnresolvedParticipant[];
}

/** A participant the element→service join could not land in `services/`. */
export interface UnresolvedParticipant {
  /** The element id the flow drew. */
  participant: string;
  /** What the join answered — the directory name that would have to exist. */
  service: string;
  /** Is the element tagged `#external`? Then it is deliberately not ours, and needs a double rather than a directory. */
  external: boolean;
}

/**
 * Each group's environment: the participants resolved to service directories
 * through the SAME element→service join every other check uses — an explicit
 * `metadata { service '<id>' }` binding first, then a title naming a real
 * `services/<id>/`. Two answers to "whose element is this" would put the flow
 * spine and every other spine on different graphs.
 *
 * A participant that resolves to nothing is REPORTED, never dropped. This
 * output is the definition of an environment — which services must be up for a
 * group's flows — and a silently shorter list is the one failure mode that
 * cannot be noticed from the output itself: the run comes up, the missing
 * participant is simply absent, and the journey fails against a service nobody
 * was told to start.
 */
export function groupEnvironments(
  groups: FlowGroup[],
  elements: Elem[],
  known: ReadonlySet<string>,
): GroupEnvironment[] {
  const resolve = serviceResolver(elements, known);
  const byId = new Map(elements.map((e) => [e.id, e]));
  return groups.map((group) => {
    const services = new Set<string>();
    const unresolved: UnresolvedParticipant[] = [];
    for (const participant of group.members) {
      const service = resolve(participant);
      if (known.has(service)) {
        services.add(service);
        continue;
      }
      // The element's OWN tags, never an ancestor's: LikeC4 does not inherit
      // tags, so a container nested inside an #external system is not itself
      // external, and claiming it is would excuse a missing directory.
      const external = byId.get(participant)?.tags.includes(EXTERNAL_TAG) ?? false;
      unresolved.push({ participant, service, external });
    }
    return { group: group.name, flows: group.flows, services: sorted(services), unresolved };
  });
}

/**
 * The tag that says "deliberately not ours" — the landscape's own exemption,
 * spelled again rather than imported: the shared constant lives in
 * `commands/validate/checks/vocabulary.ts`, and `core/` must never import from
 * `commands/`. Moving it down here instead would be the right fix the day a
 * third core module needs it; one word in two places is not yet worth relocating
 * a constant every validate check reads.
 */
const EXTERNAL_TAG = "external";

/** A flow's GROUP tags: everything on it that the feature axis has not reserved. */
function groupTags(flow: Flow): string[] {
  return flow.tags.filter((tag) => !isFeatureId(tag));
}

/**
 * Plain lexicographic ordering, and plain is the point: these are tags and
 * element ids a document asserts, an INVALID one is still ordered
 * deterministically, and a locale-aware or numeric-aware comparison would make
 * the generated bytes a property of the machine rather than of the document.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compare);
}
