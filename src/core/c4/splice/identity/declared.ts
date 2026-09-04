/**
 * What the fleet's extending models ALREADY declare — the half of the archive's
 * existence check that does not live on the map.
 *
 * The check has two joins: by id, and by TITLE for a delta that spells an
 * element under its own identifier rather than the map's. Only the id half ever
 * learned about the models the merge now writes into, so a container a service
 * already draws under a different id was spliced in beside itself and the
 * service silently grew two boxes with one name — while the SAME delta against
 * the same title ON THE MAP adds nothing (review of E1). One rule, two
 * documents, two answers.
 *
 * THE MODEL HALF IS SCOPED TO ITS SERVICE, and the map's is deliberately not.
 * The map's global title index is the id-less fallback for documents written
 * before `metadata { service }` existed, and it carries a hazard its own
 * comment states: two services' boxes sharing a title join to each other unless
 * both sides are bound. A service's interior is exactly where that would bite —
 * every extending model in a fleet names a container 'api' — so a model's
 * declaration joins by title only against an addition resolving to the SAME
 * explicitly bound service. Either side unbound means no title join at all: an
 * addition landing beside a namesake is a duplicate the author can see, and a
 * wrongly skipped one is a container that quietly never arrived.
 *
 * The reader is the SCAN and not a parse, for the reason the caller states: ids
 * are exact inside the fqn namespace the map and its models share, and parsing
 * every model here would cost one LikeC4 workspace per service to answer a
 * question about text. Two kinds of declaration therefore carry no title, and
 * neither loses anything: one whose head names no title (LikeC4 titles it after
 * its own name, and a model's default and a delta's differ exactly when their
 * ids do — which the id join already covers) and one writing its title as a
 * body property.
 */
import { ancestorIds } from "../../../kernel/ids/fqn/ancestors.js";
import type { DeclaredService } from "../../../kernel/ids/service.js";
import type { Elem } from "../../likec4.js";
import type { ScannedModel } from "../../source-scan.js";

export interface ModelDeclarations {
  /** Every id an extending model declares — the id join's share, and exact. */
  ids: string[];
  /**
   * True when some model already declares an element titled `title` inside the
   * service `id` resolves to. False whenever either side is unbound.
   */
  declaresTitle: (id: string, title: string) => boolean;
}

/**
 * Index the scanned models.
 *
 * `bindEls` is the corpus the service binding resolves against — the living
 * map's elements plus the delta's, the same one routing uses, because a model's
 * declaration is bound by an ancestor the MAP owns and a delta's addition by an
 * ancestor either document may.
 */
export function modelDeclarations(
  scans: ReadonlyArray<{ scan: ScannedModel | null }>,
  bindEls: readonly Elem[],
): ModelDeclarations {
  const bound = new Map<string, DeclaredService>();
  for (const e of bindEls) if (e.service !== undefined) bound.set(e.id, e.service);
  // An EXPLICIT binding on the id or an ancestor, and nothing else.
  // `serviceResolver`'s last rung answers with the element's own title or its
  // raw id — the rung its own comment calls the one that lies — and here that
  // would file two unbound services' containers under invented names and then
  // let those names join.
  const serviceOf = (id: string): DeclaredService | undefined => {
    for (const candidate of ancestorIds(id)) {
      const service = bound.get(candidate);
      if (service !== undefined) return service;
    }
    return undefined;
  };
  const ids: string[] = [];
  const titles = new Set<string>();
  for (const { scan } of scans) {
    for (const e of scan?.elements ?? []) {
      // An `extend` frame declares nothing: it reopens an element the map owns.
      if (e.extend === true) continue;
      ids.push(e.id);
      if (e.title === undefined) continue;
      const service = serviceOf(e.id);
      if (service !== undefined) titles.add(titleKey(service, e.title));
    }
  }
  return {
    ids,
    declaresTitle: (id, title): boolean => {
      const service = serviceOf(id);
      return service !== undefined && titles.has(titleKey(service, title));
    },
  };
}

/** Length-prefixed: a service id and a title cannot spell another pair's key. */
function titleKey(service: DeclaredService, title: string): string {
  return `${service.length}:${service}${title}`;
}
