/**
 * Which DOCUMENT owns the home of a new declaration — the other identity
 * question the archive's C4 merge asks, beside `./edges.ts`'s "which statement
 * is this".
 *
 * A declaration nested under a service's element belongs to that service's
 * `model.likec4` when the model EXTENDS the fleet map: that is the only
 * document allowed to declare the service's interior (SCHEMA.md, "the map holds
 * no service's interior"), and the map's copy becomes a duplicate the moment
 * the model writes its own — which is exactly what the adopt brief tells a
 * service to do, and exactly the failure this closes (verification 2026-09-04,
 * E1).
 *
 * The PARENT is what resolves, never the element itself, so the caller hands in
 * the parent id and this answers "whose interior is that". A service's own
 * element on the map has a parent that stands for nothing — a grouping box, or
 * the model root — so it resolves to no service with a model, stays on the map,
 * and every service-level edge between two of them stays with it. Asking about a
 * service element's OWN id is the same question one level down, and that is how
 * the landscape merge learns where a NEW service's interior belongs.
 *
 * A service with a STANDALONE model, or none at all, is simply absent from the
 * list and therefore owns nothing here: the map draws its containers, which is
 * legal and is what every repository did before the extending shape existed.
 */
import { ancestorIds } from "../../../kernel/ids/fqn/ancestors.js";
import type { Elem } from "../../likec4.js";
import { serviceResolver } from "../../resolve/service.js";
import type { ExtendingModel } from "../contract.js";

export interface OwnerRequest {
  /**
   * The corpus the parent id resolves against — the LIVING map's elements plus
   * the delta's own, so an element the delta introduces resolves the moment its
   * bytes would land.
   */
  bindEls: Elem[];
  /**
   * The ids the LIVING map declares. Reaching one is what proves the id chain is
   * spelled in the map's own namespace.
   */
  living: ReadonlySet<string>;
  /**
   * The ids the fleet's extending models declare inside their `extend` blocks.
   * Those are map fqns too — an `extend` frame reopens an element the map owns —
   * so a container already drawn in a model anchors the chain exactly as a living
   * one does, and an edge into a child of it still routes.
   */
  declared: ReadonlySet<string>;
  /**
   * The ids this merge is ADDING: the delta's declarations that survived the
   * existence joins. An id that is neither living, declared, nor added is one the
   * delta spells under its OWN name for an element the map already holds under
   * another — the legacy title join, which the landscape merge still merges for.
   * Routing it would open an `extend` block on an fqn the map has never heard of,
   * and the model's parse net would refuse an archive that used to merge
   * (verification 2026-09-04, refutation of E1: the guard used to accept any
   * chain whose ANCESTOR was living, so a title-joined name inside a group the
   * map declares — `marketplace.orderSvc` under the living `marketplace` — passed
   * it and every grouped fleet's legacy delta became `merge-failed`).
   */
  added: ReadonlySet<string>;
  models: readonly ExtendingModel[];
}

export function ownerOf(req: OwnerRequest): (parentId: string) => ExtendingModel | undefined {
  const { bindEls, living, declared, added, models } = req;
  if (models.length === 0) return () => undefined;
  const byService = new Map(models.map((m) => [m.service, m]));
  const resolve = serviceResolver(bindEls);
  return (parentId: string): ExtendingModel | undefined => {
    if (parentId === "") return undefined;
    // Walk up until the chain reaches an id the map's namespace already holds.
    // Everything below that point has to be a declaration this delta ADDS —
    // a child of a container the same delta introduces, or the new service
    // element itself — because those ids will exist once the merge lands.
    for (const a of ancestorIds(parentId)) {
      if (living.has(a) || declared.has(a)) break;
      if (!added.has(a)) return undefined;
    }
    return byService.get(resolve(parentId));
  };
}
