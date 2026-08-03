import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";

/** A parse/validation issue reported by LikeC4. */
export interface LikeC4Error {
  message: string;
  line?: number;
  sourceFsPath?: string;
}

/** loam-neutral element view (flattened from the LikeC4 computed model). */
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
  service?: string;
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
export function elementService(e: Elem): string {
  return e.service ?? e.title;
}

/**
 * The service a relationship endpoint belongs to. An id that names no element
 * resolves to itself, so a partial document degrades to the id rather than
 * throwing.
 */
export function serviceOf(elements: Elem[], id: string): string {
  const e = elements.find((x) => x.id === id);
  return e ? elementService(e) : id;
}

/** loam-neutral relationship view. */
export interface Rel {
  source: string;
  target: string;
  title?: string;
  /** OpenAPI operationId this call uses, from the relationship's `metadata { op '...' }`. */
  op?: string;
  tags: string[];
}

export interface LoadedDoc {
  errors: LikeC4Error[];
  elements: Elem[];
  relationships: Rel[];
}

/**
 * Load and validate a single self-contained `.likec4` document, in-process
 * (no external tool, no JVM). Returns validation errors and, if clean, the
 * flattened elements + relationships.
 */
export async function loadFile(path: string): Promise<LoadedDoc> {
  const src = await readFile(path, "utf8");
  const likec4 = await LikeC4.fromSource(src);
  const errors = (likec4.getErrors() as LikeC4Error[]) ?? [];
  if (errors.length > 0) {
    return { errors, elements: [], relationships: [] };
  }

  const model = (await likec4.computedModel()) as {
    elements: () => Iterable<{
      id: string;
      kind: string;
      title: string;
      description?: unknown;
      tags?: string[];
      metadata?: unknown;
    }>;
    relationships: () => Iterable<{
      source: { id: string };
      target: { id: string };
      title?: string;
      tags?: string[];
      metadata?: unknown;
    }>;
  };

  const elements: Elem[] = [...model.elements()].map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    description: descText(e.description),
    service: metaKey(e.metadata, "service"),
    tags: [...(e.tags ?? [])],
  }));
  const relationships: Rel[] = [...model.relationships()].map((r) => ({
    source: r.source.id,
    target: r.target.id,
    // LikeC4 reports an untitled edge as title: null — normalize to the declared `title?: string`.
    title: r.title ?? undefined,
    op: metaKey(r.metadata, "op"),
    tags: [...(r.tags ?? [])],
  }));

  return { errors, elements, relationships };
}

/**
 * Read one string key out of a LikeC4 `metadata { ... }` block. Two keys carry
 * loam's spines: `op` on a relationship (the OpenAPI operationId it calls) and
 * `service` on an element (the services/<id> directory it stands for). Elements
 * with no metadata come back as `{}`, so a missing key is indistinguishable from
 * a missing block — both mean "not bound".
 */
function metaKey(m: unknown, key: string): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
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
