/**
 * The join a dynamic-view step needs and does not carry: from (source, target)
 * to the relationships the model DECLARES between them.
 *
 * A parsed step has a source, a target, a title and no `metadata`. Every
 * operation loam grades — the `metadata { op }` spine, the events spine — hangs
 * off the relationship, so a step that cannot find its relationship exercises
 * nothing loam can name.
 *
 * LikeC4 computes this join itself, one stage up: every edge of a COMPUTED
 * dynamic view carries the relations it stands for, ACROSS granularity — a step
 * drawn service to service over a container-to-container declaration resolves
 * there, verified against the pinned 1.59.2. That is the answer this module has
 * to match, and it is off limits: computing a model builds every view in the
 * document at a cost superlinear in edge count, which is what `../likec4.ts`
 * and `../workspace.ts` refuse to pay on every `validate --all`. So loam does
 * the join itself, at the cheap stage, over the relationships it has already
 * flattened.
 */
import { ancestorIds, type Rel } from "../model/model.js";

/**
 * A `(source, target) -> relationships` lookup over one document, matching a
 * step against declarations made ABOVE its endpoints and, failing that, BELOW
 * them.
 *
 * Both directions are needed because a landscape draws one interaction at
 * whatever granularity reads best, and the journey is drawn at another. The
 * climb is the walk the operation spine already performs (see `ancestorIds`):
 * a step between modelled containers, `checkoutWeb.ui -> paymentService.api`,
 * over an edge declared between the services. The DESCENT is its mirror, and
 * the one this repository's own corpus needs — `examples/docs`' landscape
 * declares `checkoutWeb.ui -> paymentService.api` while a cross-service journey
 * is naturally drawn `checkoutWeb -> paymentService`. Climbing alone answered
 * every step of such a fleet with nothing, which would have fired
 * `flow.step-unresolved` at an author whose document is entirely correct.
 *
 * ORDER, and it is a decision rather than an accident:
 *
 *  1. the climb, nearest first — exact pair, then the nearest enclosing pair.
 *     Distance is the total hops both endpoints had to climb, so one level on
 *     each side loses to one level in total; ties go to the more specific
 *     SOURCE, which is arbitrary but fixed, since an answer depending on map
 *     order would differ between two readings of one document. The first pair
 *     that matches anything answers ALONE: a relationship declared at container
 *     level is never silently merged with one declared at service level.
 *  2. the descent, only once the whole climb has failed. A declaration at or
 *     above the step's own endpoints names those endpoints (or the boxes that
 *     contain them), so it is the closer statement of what the step is; a
 *     declaration below them is the fallback. And it carries EVERY match in
 *     declaration order rather than a nearest one, because a service-to-service
 *     arrow drawn over three container-level edges really does stand for all
 *     three — picking one would answer the operation question with a coin flip.
 */
export function relationResolver(relationships: Rel[]): (source: string, target: string) => Rel[] {
  const declared = new Map<string, Map<string, Rel[]>>();
  for (const rel of relationships) {
    const targets = declared.get(rel.source) ?? new Map<string, Rel[]>();
    declared.set(rel.source, targets);
    const between = targets.get(rel.target) ?? [];
    between.push(rel);
    targets.set(rel.target, between);
  }
  return (source: string, target: string): Rel[] => {
    for (const [from, to] of pairsNearestFirst(source, target)) {
      const between = declared.get(from)?.get(to);
      // A copy: two steps drawn between the same pair would otherwise share one
      // array, and a caller trimming one step's matches would edit the other's.
      if (between !== undefined) return [...between];
    }
    // The descent scans every relationship, and only for a step the climb could
    // not place — a full pass over a fleet landscape, but one that runs a
    // handful of times per document rather than per relationship. Indexing it
    // would cost a second structure to hold the same answer.
    return relationships.filter((rel) => within(rel.source, source) && within(rel.target, target));
  };
}

/**
 * Every (source ancestor, target ancestor) pair, nearest first. Built per call
 * rather than memoized: an element id is one or two segments deep in practice,
 * so this is a handful of string slices, and a cache keyed on a PAIR of ids
 * would cost more to hold than it saves. The index above is the part worth
 * sharing across steps, and it is shared.
 */
function pairsNearestFirst(source: string, target: string): [string, string][] {
  const sources = ancestorIds(source);
  const targets = ancestorIds(target);
  const pairs: { climb: number; hops: number; pair: [string, string] }[] = [];
  for (const [i, from] of sources.entries()) {
    for (const [j, to] of targets.entries()) {
      pairs.push({ climb: i + j, hops: i, pair: [from, to] });
    }
  }
  pairs.sort((a, b) => a.climb - b.climb || a.hops - b.hops);
  return pairs.map((candidate) => candidate.pair);
}

/**
 * Is `id` the element `root`, or something modelled inside it?
 *
 * The separator is part of the test, not decoration: `paymentServiceV2` starts
 * with `paymentService` and is a different system, so a bare `startsWith` would
 * join a journey to the operations of whatever service happened to share a name
 * prefix.
 */
function within(id: string, root: string): boolean {
  return id === root || id.startsWith(`${root}.`);
}
