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
  tags: string[];
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
    elements: () => Iterable<{ id: string; kind: string; title: string; description?: unknown; tags?: string[] }>;
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
    tags: [...(e.tags ?? [])],
  }));
  const relationships: Rel[] = [...model.relationships()].map((r) => ({
    source: r.source.id,
    target: r.target.id,
    title: r.title,
    op: metaOp(r.metadata),
    tags: [...(r.tags ?? [])],
  }));

  return { errors, elements, relationships };
}

/** Read the `op` key from a relationship's metadata object (the linked OpenAPI operationId). */
function metaOp(m: unknown): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)["op"];
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
