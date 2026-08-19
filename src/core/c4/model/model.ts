/**
 * What an element and a relationship ARE to loam, and which `services/<svc>/`
 * each one stands for.
 *
 * A package of its own rather than part of the loader beside it, because the
 * two answer different questions: `../likec4.js` asks LikeC4 what a document
 * says, while this is loam's own vocabulary for the answer — the shape half of
 * `core/` joins on, and the resolution that turns a drawn box into a directory.
 * The types and the join ship together deliberately: every caller that reads an
 * element also asks whose it is, and splitting them would buy nothing but a
 * second import line in each of those files.
 *
 * The two grades SCHEMA.md gives a broken join — `landscape.binding-unknown`
 * for an explicit binding that names nothing, a warning for a title that merely
 * fails to match — both come out of the resolution order below.
 */
import { declaredService, type DeclaredService } from "../../kernel/ids/service.js";

/** loam-neutral element view (flattened from the LikeC4 parsed model). */
export interface Elem {
  id: string;
  kind: string;
  title: string;
  description?: string;
  /**
   * The `services/<id>` directory this element stands for, from the element's
   * `metadata { service '...' }`. Absent on the elements nobody has bound —
   * see `elementService` for the fallback.
   */
  service?: DeclaredService;
  tags: string[];
}

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

/** loam-neutral relationship view. */
export interface Rel {
  source: string;
  target: string;
  title?: string;
  /** OpenAPI operationId this call uses, from the relationship's `metadata { op '...' }`. */
  op?: string;
  /**
   * AsyncAPI message this edge PRODUCES, from `metadata { publishes '...' }`.
   * Resolved against the edge SOURCE's own contract: a service publishes what it
   * declares an `action: send` for.
   */
  publishes?: string;
  /**
   * AsyncAPI message this edge CONSUMES, from `metadata { consumes '...' }`.
   * Two keys rather than one directional `message`, because the async spine is
   * not symmetric with the HTTP one: there the PROVIDER owns the contract and
   * every consumer is checked against it, while here the PRODUCER owns the
   * message and the consumer lives in another repository entirely. Which side of
   * an edge owes the declaration has to be readable from the edge itself — the
   * arrow cannot say it, because a Kafka edge points at the broker from both
   * ends.
   */
  consumes?: string;
  tags: string[];
}
