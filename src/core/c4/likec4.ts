import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";
import { declaredService, type DeclaredService } from "../kernel/ids/service.js";

/** A parse/validation issue reported by LikeC4. */
export interface LikeC4Error {
  message: string;
  line?: number;
  sourceFsPath?: string;
}

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

export interface LoadedDoc {
  errors: LikeC4Error[];
  elements: Elem[];
  relationships: Rel[];
}

/**
 * The slice of a LikeC4 model loam reads: elements and relationships, and on
 * each of those only id/kind/title/description/tags/metadata.
 *
 * It is a type of its own, rather than an inline cast at the one call site,
 * because BOTH of LikeC4's model stages expose exactly this slice — which is
 * what makes the cheap stage a safe substitute for the expensive one. The
 * substitution is pinned in test/likec4-model-parity.test.ts, which flattens
 * both stages through `flattenModel` below and compares the results.
 */
export interface ReadableModel {
  elements: () => Iterable<{
    id: string;
    kind: string;
    title: string;
    description?: unknown;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
  relationships: () => Iterable<{
    source: { id: string };
    target: { id: string };
    title?: string | null;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
}

/** Flatten a LikeC4 model into loam's neutral `Elem`/`Rel` view. */
export function flattenModel(model: ReadableModel): { elements: Elem[]; relationships: Rel[] } {
  const elements: Elem[] = [...model.elements()].map((e) => {
    // The one crossing between LikeC4's parse output and loam's type system:
    // a `metadata { service '...' }` binding is text somebody wrote, and this
    // is where it acquires a type that says so.
    const bound = metaKey(e.metadata, "service");
    return {
      id: e.id,
      kind: e.kind,
      title: e.title,
      description: descText(e.description),
      ...(bound === undefined ? {} : { service: declaredService(bound) }),
      tags: [...(e.tags ?? [])],
    };
  });
  const relationships: Rel[] = [...model.relationships()].map((r) => ({
    source: r.source.id,
    target: r.target.id,
    // LikeC4 reports an untitled edge as title: null — normalize to the declared `title?: string`.
    title: r.title ?? undefined,
    op: metaKey(r.metadata, "op"),
    publishes: metaKey(r.metadata, "publishes"),
    consumes: metaKey(r.metadata, "consumes"),
    tags: [...(r.tags ?? [])],
  }));
  return { elements, relationships };
}

/**
 * Load and validate a single self-contained `.likec4` document, in-process
 * (no external tool, no JVM). Returns validation errors and, if clean, the
 * flattened elements + relationships.
 */
export async function loadFile(path: string): Promise<LoadedDoc> {
  return loadSource(await readFile(path, "utf8"));
}

/**
 * `loadFile` for text that is not (yet) on disk — what the archive merge uses
 * to prove a computed landscape parses BEFORE anything is written.
 */
export async function loadSource(src: string): Promise<LoadedDoc> {
  // LikeC4 owns a Langium workspace and registers a process-exit listener for
  // it. Validation creates many short-lived instances, so every acquired
  // instance must be disposed even on an invalid document or a failed model
  // computation. Its logger is disabled because diagnostics are returned in
  // LoadedDoc instead of being written out-of-band to stderr.
  const likec4 = await LikeC4.fromSource(src, { logger: false });
  try {
    // Assigned, not cast: LikeC4 declares `getErrors()` as a non-nullable array
    // whose element type is structurally wider than ours, so the compiler can
    // check the shape here. The cast was the only thing standing between a
    // dependency renaming `message` and a build that still succeeded — and the
    // `?? []` it carried could never fire.
    const errors: LikeC4Error[] = likec4.getErrors();
    if (errors.length > 0) {
      return { errors, elements: [], relationships: [] };
    }

    // `parsedModel`, not `computedModel`: the computed stage additionally
    // computes every VIEW the document declares (and a default one when it
    // declares none), which loam never reads — it renders nothing. That work is
    // superlinear in the number of RELATIONSHIPS, so a landscape at fleet shape
    // turned `loam list` from under a second into minutes. The elements and
    // relationships below are identical either way.
    const model = (await likec4.parsedModel()) as ReadableModel;
    return { errors, ...flattenModel(model) };
  } finally {
    await likec4.dispose();
  }
}

/**
 * Read one string key out of a LikeC4 `metadata { ... }` block. Four keys carry
 * loam's spines: `op` on a relationship (the OpenAPI operationId it calls),
 * `publishes`/`consumes` on a relationship (the AsyncAPI message it produces or
 * receives), and `service` on an element (the services/<id> directory it stands
 * for). Every one of them is read by BOTH model readers — the parsed one here
 * and the text scanner `scanModel` uses for archive's splice map — because a key
 * only one of them sees is a key the merge silently drops. Elements
 * with no metadata come back as `{}`, so a missing key is indistinguishable from
 * a missing block — both mean "not bound".
 */
function metaKey(m: unknown, key: string): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
    // A key written TWICE in one block comes back as an array, accepted with no
    // error, and reading only the string form dropped every value — so an edge
    // naming two operations reported as naming none, `c4.op-link-missing` telling
    // the author the opposite of what they wrote. First wins, matching the text
    // scanner's `keyedLiteral`: the two readers disagreeing about a binding is
    // exactly what the paragraph above exists to prevent. Later values stay
    // dropped — one id per key per edge is the model.
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return undefined;
}

/** LikeC4 descriptions can be a string or a rich-text object ({ txt } / { text } / { md }). */
function descText(d: unknown): string | undefined {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    for (const key of ["txt", "text", "md", "value"]) {
      const v = o[key];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}
