/**
 * Who takes part in a set of use cases — the union a test environment is built
 * from, and the participants that union cannot place.
 *
 * It began as `servicesInFlowsClaiming` in `../capability.ts`, which answered
 * the same question for the flows claiming one capability and kept only the
 * half `loam explore` needed: the enumerated services. A suite asks it of a
 * different set of views — the ones carrying one `#suite-` tag — and needs the
 * other half too, so the walk moved here and grew a second output rather than
 * being written twice. Two walks over "which services does this flow touch"
 * would be two answers to the question a test stand is provisioned from.
 *
 * THE DEPENDENCY RUNS PARENT → CHILD, never back. `../capability.ts` and
 * `../fleet.ts` (which takes the suite prefix from `./suites.ts`) import this
 * package, so nothing here may value-import `core/usecases/` — the package
 * graph would close a cycle `import/no-cycle` cannot see (docs/DESIGN.md rule
 * 21). `UseCaseScan` crosses as a TYPE only, which erases.
 */
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import { ancestorIds } from "../../kernel/ids/fqn/ancestors.js";
import { compareIds } from "../../repo/entries.js";
import { EXTERNAL_TAG } from "../../vocabulary/maturity.js";
import type { UseCaseScan } from "../fleet.js";

/** A scan that read — the only kind with elements to resolve against. */
export type ReadScan = Extract<UseCaseScan, { kind: "read" }>;

/** A participant the element→service join could not land on an enumerated service. */
export interface UnresolvedParticipant {
  /** The element id a step drew, exactly as the view spells it. */
  element: string;
  /**
   * Does the element, or anything it is drawn inside, carry `#external`? Then it
   * is deliberately not the fleet's, and a stand needs a double for it rather
   * than a directory. See `isExternal` for why an ancestor's tag counts.
   */
  external: boolean;
}

/** The union of a set of views' participants, split by whether the fleet can stand each one up. */
export interface Participants {
  /** Enumerated service ids, sorted and deduplicated. */
  services: string[];
  /** Everything else the steps drew, one entry per element id, sorted by it. */
  unresolved: UnresolvedParticipant[];
}

/**
 * Every endpoint the views' steps draw, resolved through the scan's ONE
 * element→service resolver — the resolver `attributeStep` grades the same hops
 * with, built over the same enumerated fleet (`readUseCases`). A second
 * resolver here could not disagree today and would be a second place to change.
 *
 * AN ENDPOINT THAT RESOLVES TO NO ENUMERATED SERVICE IS REPORTED, NEVER DROPPED.
 * This answer is what a test environment is provisioned from, and a silently
 * shorter list is the one failure that cannot be seen from the list itself: the
 * stand comes up, the missing participant is simply absent, and the journey
 * fails against something nobody was told to start. The actor who begins a
 * flow, a topic in the middle, a partner's API — each is named here, so the
 * reader decides whether it needs a double, a fixture or a directory. The
 * caller that only wants seeds (`servicesInFlowsClaiming`) reads `services` and
 * ignores the rest, which is a choice it can see itself making.
 *
 * Sorted with compareIds rather than in step order: a union has no document
 * order to preserve, and a payload ordered by LikeC4's record order would
 * reorder under a dependency bump.
 */
export function participantsOf(scan: ReadScan, views: readonly ParsedView[]): Participants {
  const known = scan.model.known;
  const services = new Set<string>();
  const unresolved = new Set<string>();
  for (const view of views) {
    for (const step of view.steps) {
      for (const id of [step.source, step.target]) {
        const service = scan.resolve(id);
        if (known.has(service)) services.add(service);
        else unresolved.add(id);
      }
    }
  }
  const tagsOf = new Map(scan.model.elements.map((e) => [e.id, e.tags]));
  return {
    services: [...services].sort(compareIds),
    unresolved: [...unresolved].sort(compareIds).map((element) => ({ element, external: isExternal(element, tagsOf) })),
  };
}

/**
 * `#external` on the element or on anything it is drawn inside.
 *
 * The ancestor walk is `core/gate/partners.ts`' reading of the same tag, and it
 * is the one that is true for a stand: `stripe.api` drawn inside an `#external`
 * `stripe` is somebody else's endpoint whether or not the container repeats the
 * tag, and LikeC4 does not inherit tags downward, so reading the element's own
 * tags alone would print "ours, with no directory" over a partner's API. The
 * walk can excuse nothing here — this answer grades nothing, it only says which
 * participants want a double.
 *
 * A tag a KIND declares (`element topic { #external }`) arrives on every element
 * of that kind in the parsed model, so a topic counts without repeating it.
 */
function isExternal(element: string, tagsOf: ReadonlyMap<string, readonly string[]>): boolean {
  return ancestorIds(element).some((id) => tagsOf.get(id)?.includes(EXTERNAL_TAG) ?? false);
}
