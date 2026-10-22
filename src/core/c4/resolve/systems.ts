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
 * `core/verify/`), and core may not import the census. `standsForService`
 * below is the census's own predicate rung for rung, and the census still
 * spells its copy: the two must keep answering alike until it imports this
 * one.
 *
 * THREE DELIBERATE NARROWINGS against the census, all because a delta is not a
 * whole map. An element is looked at only through ancestors the delta DECLARES
 * and that are themselves groupings — the map's domain or boundary drawn around
 * the services it re-declares. A level the delta does not declare may be a
 * living service's own element, and one that stands for no service yet groups
 * none — a new system's box, an `#external` vendor — is what its children
 * belong to: a container of a service with no directory yet is that service's,
 * and an endpoint inside a vendor is the vendor's (`core/gate/partners.ts`
 * reads it so). And a grouping must stand for no service itself: an element
 * bound to a service IS one, whatever it contains — the census's answer too
 * wherever it matters, since a bound or directory-titled element never reaches
 * its undocumented pass.
 *
 * WHAT THE DELTA'S TAGS CANNOT SAY. A delta re-declares the living elements it
 * attaches to as stubs, usually untagged and always without their living tags,
 * and the merge keeps the living element's tags — so "is this #external" is a
 * question about the map the merge leaves, not about the stub. For an element
 * no directory answers for, `readDeltaSystem` finds the living element it
 * stands for and asks it the same question.
 */
import { existsSync } from "node:fs";
import { type Elem, type LoadedDoc } from "../likec4.js";
import { properAncestorIds } from "../../kernel/ids/fqn/ancestors.js";
import { ACTOR_KINDS, EXTERNAL_TAG, INFRA_KINDS } from "../../vocabulary/maturity.js";
import { drawnServiceElements, elementService } from "./service.js";

/**
 * Does this element stand for a `services/<id>/` directory — an explicit
 * `metadata { service }` binding, or a title naming one `known` holds?
 */
function standsForService(e: Elem, known: ReadonlySet<string>): boolean {
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
 * grouping, and drawn only inside groupings that document declares.
 */
function isServiceSystem(e: Elem, elements: readonly Elem[], known: ReadonlySet<string>): boolean {
  const kind = e.kind.toLowerCase();
  if (ACTOR_KINDS.has(kind) || e.tags.includes(EXTERNAL_TAG)) return false;
  if (INFRA_KINDS.has(kind) && !standsForService(e, known)) return false;
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const id of properAncestorIds(e.id)) {
    const parent = byId.get(id);
    if (parent === undefined || !groupsServices(parent, elements, known)) return false;
  }
  return !groupsServices(e, elements, known);
}

/** What `readDeltaSystem` reads a tagged delta element against. */
export interface DeltaSystemScope {
  /** Every element the delta declares — where its ancestors and children are looked up. */
  elements: readonly Elem[];
  /** The directories the merge leaves: the enumerated fleet plus the feature's own `specs/`. */
  known: ReadonlySet<string>;
  /** The enumerated fleet alone — the services that already have a `services/<id>/`. */
  living: ReadonlySet<string>;
  /** The living map (`livingMapOf`), read only when no directory answers for an element. */
  livingMap: () => Promise<LoadedDoc | null>;
}

/**
 * What a tagged delta element will be on the map the merge leaves:
 *
 * - `none` — not a service: the delta draws it as a person, somebody else's
 *   system, infrastructure, a grouping or something inside another element —
 *   or it is the stub of a living element the map draws as one of those;
 * - `living` — the stub of a service that already has a `services/<id>/`:
 *   this feature changes it, it does not introduce it;
 * - `drawn` — a service with no directory that the living map ALREADY draws,
 *   so this feature re-declares it rather than introducing it either;
 * - `service` — a service this feature introduces: its directory is the
 *   feature's own `specs/<id>/`, or nothing has drawn it before.
 *
 * The living map is read only for an element no directory answers for — the
 * one case where the stub's missing tags can be the whole answer — so the
 * common delta, whose new services all have `specs/`, never parses it. A map
 * that is absent or does not parse leaves the delta to answer alone, which is
 * how every element was read before the map was asked.
 */
export async function readDeltaSystem(e: Elem, scope: DeltaSystemScope): Promise<"none" | "living" | "drawn" | "service"> {
  const { elements, known } = scope;
  if (!isServiceSystem(e, elements, known)) return "none";
  const service = elementService(e);
  if (scope.living.has(service)) return "living";
  if (known.has(service)) return "service";
  const map = await scope.livingMap();
  const counterpart = map === null ? undefined : livingCounterpart(e, map, known);
  if (map === null || counterpart === undefined) return "service";
  return isServiceSystem(counterpart, map.elements, known) ? "drawn" : "none";
}

/**
 * The living map as `readDeltaSystem` reads it — the caller's
 * `architecture/landscape.likec4` (`landscapePath`; the path arrives as an
 * argument because `core/repo/` already imports this package), parsed at most
 * once per reader and only when first asked; null when there is none or it
 * does not parse. One reader for every grader that asks, so two of them can
 * never see different maps for one element.
 */
export function livingMapOf(path: string, load: (path: string) => Promise<LoadedDoc>): () => Promise<LoadedDoc | null> {
  let read: Promise<LoadedDoc | null> | undefined;
  return () =>
    (read ??= (async () => {
      if (!existsSync(path)) return null;
      const doc = await load(path);
      return doc.errors.length === 0 ? doc : null;
    })());
}

/**
 * The element of the living map a delta element stands for: the same id, else
 * the box the map DRAWS for the same service (`drawnServiceElements` — never a
 * container of some other service that happens to share a title). Undefined
 * when the map draws nothing of the kind, which for an element no directory
 * answers for is what makes it new.
 */
function livingCounterpart(e: Elem, living: LoadedDoc, known: ReadonlySet<string>): Elem | undefined {
  const byId = new Map(living.elements.map((el) => [el.id, el]));
  const same = byId.get(e.id);
  if (same !== undefined) return same;
  const drawn = drawnServiceElements(living.elements, known).get(elementService(e));
  return drawn === undefined ? undefined : byId.get(drawn);
}
