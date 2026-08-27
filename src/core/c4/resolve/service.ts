/**
 * Which `services/<id>/` directory a modelled element belongs to.
 *
 * A distinct subject from loading a document, and a distinct phase: the
 * loader beside this package (`../likec4.ts`) turns LikeC4's parse output into
 * loam's neutral `Elem`/`Rel` records, and everything here runs AFTER that, over
 * those records, answering one question the model itself never states outright.
 * It is the join every fleet-wide check rests on — the landscape↔services
 * reconciliation, the spine's edge grouping, `Covers:` resolution, health.yaml's
 * dependency matching — which is why `docs/DESIGN.md`'s Open-decisions table
 * audits its call sites as a subject of their own rather than as a detail of the
 * loader.
 *
 * The resolution order below is the whole of it, and its last rung is the one
 * that lies: read that comment before adding a caller.
 */
import { declaredService, type DeclaredService } from "../../kernel/ids/service.js";
import { type Elem } from "../likec4.js";

/**
 * The service directory an element stands for: an explicit
 * `metadata { service '<id>' }` binding wins, the title is the fallback.
 *
 * The fallback is what every docs repo written before the binding existed relies
 * on, and it is also the trap the binding exists to close: matching on the title
 * means renaming a box in a diagram silently unlinks it from its service, and
 * every check that joined the two just stops finding anything.
 */
export function elementService(e: Elem): DeclaredService {
  return e.service ?? declaredService(e.title);
}

/**
 * Every id an endpoint may be filed under, nearest first: `a.b.c`, `a.b`, `a`.
 *
 * A landscape does not have to draw a service as one opaque box. The moment
 * somebody models its containers — `paymentService.api`, `paymentService.worker`
 * — an edge drawn INTO a container is still an edge into the service, and every
 * join that groups by service has to know that. Resolving only the exact id is
 * what made those edges invisible: the spine check silently skipped them, and
 * the no-openapi grace treated a service with a dozen inbound container calls as
 * one nobody calls at all.
 */
function ancestorIds(id: string): string[] {
  const out = [id];
  for (let dot = id.lastIndexOf("."); dot !== -1; dot = id.lastIndexOf(".", dot - 1)) {
    out.push(id.slice(0, dot));
  }
  return out;
}

/**
 * A memoized `id -> service` resolver over one document.
 *
 * Resolution order, and why it is this order:
 *
 *  1. the nearest ancestor (the id itself first) carrying an explicit
 *     `metadata { service '<id>' }` — a binding is a claim somebody wrote down,
 *     so it outranks every guess;
 *  2. the nearest ancestor whose title names a REAL `services/<id>/` directory —
 *     positive evidence from the filesystem, available only to callers that
 *     hand in `known`;
 *  3. the element's own title, and finally the raw id — today's fallback, kept
 *     LAST because it is the one that lies: it happily resolves
 *     `paymentService.api` to "api", a service that has never existed.
 *
 * Built once per document and shared, because it is called inside loops over
 * every relationship and the walk up the ancestor chain is not free.
 */
export function serviceResolver(
  elements: Elem[],
  known?: ReadonlySet<string>,
): (id: string) => DeclaredService {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const memo = new Map<string, DeclaredService>();
  return (id: string): DeclaredService => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    let answer: DeclaredService | undefined;
    for (const candidate of ancestorIds(id)) {
      const e = byId.get(candidate);
      if (e?.service !== undefined) {
        answer = e.service;
        break;
      }
    }
    if (answer === undefined && known !== undefined) {
      for (const candidate of ancestorIds(id)) {
        const e = byId.get(candidate);
        if (e !== undefined && known.has(e.title)) {
          answer = declaredService(e.title);
          break;
        }
      }
    }
    if (answer === undefined) {
      const self = byId.get(id);
      answer = self ? elementService(self) : declaredService(id);
    }
    memo.set(id, answer);
    return answer;
  };
}

/**
 * The service a relationship endpoint belongs to. An id that names no element
 * resolves to itself, so a partial document degrades to the id rather than
 * throwing.
 *
 * `known` is the set of service directories that actually exist; pass it
 * wherever the caller has enumerated `services/`, so an edge into a modelled
 * container resolves to the service that owns it instead of to the container's
 * own title. Callers with a single document and no repository in hand omit it
 * and keep the pre-existing behaviour.
 */
export function serviceOf(elements: Elem[], id: string, known?: ReadonlySet<string>): DeclaredService {
  return serviceResolver(elements, known)(id);
}

