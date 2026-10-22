/**
 * Which drawn elements are SERVICES — asked of a feature's delta, the way the
 * fleet census asks it of the map.
 *
 * The census (`commands/validate/fleet/census.ts`, `drawnSystems`) is the one
 * answer `validate --all` gives: an element is graded as a service when no
 * ancestor already stands for one, unless it is a person, somebody else's
 * system (`#external`), infrastructure the fleet runs, or a GROUPING — an
 * element that contains a service rather than being one. The feature-scope
 * graders asked a narrower question of their own. `service.no-requirement-delta`
 * asked only "is it a `softwareSystem`", so a delta's `#external` producer was
 * called a new service that owes a requirement delta; the checklist's
 * `service.exists` asked "is its id dotted", so the same producer became a unit
 * of work in `loam tasks`, a top-level grouping became a service called after
 * its title, and the new service FEAT-101 draws inside the map's own group
 * became a container nobody had to build (the real-fleet review, 2026-10-21).
 * After the archive, the fleet called every one of those differently.
 *
 * It lives in core because those graders do (`core/coherence/`,
 * `core/verify/`), and a core module can never import the census: the
 * predicates are spelled here again, and `standsForService` and the grouping
 * rule must keep answering exactly what the census's do.
 *
 * TWO DELIBERATE NARROWINGS against the census, both because a delta is not a
 * whole map. An ancestor the delta does not DECLARE answers as a service — a
 * level nothing in this document describes may be a living service's own
 * element, and the graders had always read a dotted id as a container; only
 * levels the delta draws itself (a group, a boundary) are looked through. And
 * a grouping must stand for no service itself: an element bound to a service
 * IS one, whatever it contains, which is the census's answer too wherever it
 * matters (a bound or directory-titled element never reaches its
 * undocumented pass).
 *
 * WHAT THE DELTA'S TAGS CANNOT SAY. A delta re-declares the living elements it
 * attaches to as stubs, usually untagged and always without their living tags,
 * and the merge keeps the living element's tags — so "is this #external" is a
 * question about the map the merge leaves, not about the stub.
 * `livingCounterpart` finds the living element a stub stands for, so a caller
 * can ask it the same question.
 */
import { type Elem, type LoadedDoc } from "../likec4.js";
import { properAncestorIds } from "../../kernel/ids/fqn/ancestors.js";
import { ACTOR_KINDS, EXTERNAL_TAG, INFRA_KINDS } from "../../vocabulary/maturity.js";
import { drawnServiceElements, elementService } from "./service.js";

/**
 * Does this element stand for a `services/<id>/` directory — an explicit
 * `metadata { service }` binding, or a title naming one `known` holds? The
 * census's `standsForService`, rung for rung.
 */
export function standsForService(e: Elem, known: ReadonlySet<string>): boolean {
  return e.service !== undefined || known.has(e.title);
}

/**
 * A GROUPING: an element that stands for no service and contains one that
 * does — a domain, a boundary, an enterprise. There is nothing to bind on it,
 * no requirement for it to carry and no repository that builds it; the
 * services under it answer for themselves.
 */
export function groupsServices(e: Elem, elements: readonly Elem[], known: ReadonlySet<string>): boolean {
  if (standsForService(e, known)) return false;
  const prefix = `${e.id}.`;
  return elements.some((c) => c.id.startsWith(prefix) && standsForService(c, known));
}

/**
 * Is this element a service-level SYSTEM of ours in the document `elements`
 * comes from: not a person, not `#external`, not unbound infrastructure, not a
 * grouping, and not drawn inside something that is (or may be) a service.
 */
export function isServiceSystem(e: Elem, elements: readonly Elem[], known: ReadonlySet<string>): boolean {
  const kind = e.kind.toLowerCase();
  if (ACTOR_KINDS.has(kind) || e.tags.includes(EXTERNAL_TAG)) return false;
  if (INFRA_KINDS.has(kind) && !standsForService(e, known)) return false;
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const id of properAncestorIds(e.id)) {
    const parent = byId.get(id);
    // Undeclared, or a service: either way this element is inside one.
    if (parent === undefined || standsForService(parent, known)) return false;
  }
  return !groupsServices(e, elements, known);
}

/** What `readDeltaSystem` reads a tagged delta element against. */
export interface DeltaSystemScope {
  /** Every element the delta declares — where its ancestors and children are looked up. */
  elements: readonly Elem[];
  /** The directories the merge leaves: the enumerated fleet plus the feature's own `specs/`. */
  known: ReadonlySet<string>;
  /** The living map, read only when no directory answers for an element; null when absent or unparsed. */
  livingMap: () => Promise<LoadedDoc | null>;
}

/**
 * What a tagged delta element will be on the map the merge leaves:
 *
 * - `none` — not a service: the delta draws it as a person, somebody else's
 *   system, infrastructure, a grouping or a container — or it is the stub of a
 *   living element the map draws as one of those;
 * - `drawn` — a service with no directory that the living map ALREADY draws,
 *   so this feature re-declares it rather than introducing it;
 * - `service` — every other service: one a directory answers for, or one
 *   nothing has drawn before.
 *
 * The living map is read only for an element no directory answers for — the
 * one case where the stub's missing tags can be the whole answer — so the
 * common delta, whose new services all have `specs/`, never parses it.
 */
export async function readDeltaSystem(e: Elem, scope: DeltaSystemScope): Promise<"none" | "drawn" | "service"> {
  const { elements, known } = scope;
  if (!isServiceSystem(e, elements, known)) return "none";
  if (known.has(elementService(e))) return "service";
  const map = await scope.livingMap();
  const living = map === null ? undefined : livingCounterpart(e, map, known);
  if (map === null || living === undefined) return "service";
  return isServiceSystem(living, map.elements, known) ? "drawn" : "none";
}

/**
 * The element of the living map a delta element stands for: the same id, else
 * the box the map DRAWS for the same service (`drawnServiceElements` — never a
 * container of some other service that happens to share a title). Undefined
 * when the map draws nothing of the kind, which for an element no directory
 * answers for is what makes it new.
 */
export function livingCounterpart(e: Elem, living: LoadedDoc, known: ReadonlySet<string>): Elem | undefined {
  const byId = new Map(living.elements.map((el) => [el.id, el]));
  const same = byId.get(e.id);
  if (same !== undefined) return same;
  const drawn = drawnServiceElements(living.elements, known).get(elementService(e));
  return drawn === undefined ? undefined : byId.get(drawn);
}
