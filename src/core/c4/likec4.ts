import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";
import { declaredService } from "../kernel/ids/service.js";
import { flattenFlows } from "./flows/flatten.js";
import { type Flow } from "./flows/flow.js";
import { type ReadableViews } from "./flows/parsed-view.js";
import { type Elem, type Rel } from "./model/model.js";

/** A parse/validation issue reported by LikeC4. */
export interface LikeC4Error {
  message: string;
  line?: number;
  sourceFsPath?: string;
}

export interface LoadedDoc {
  errors: LikeC4Error[];
  elements: Elem[];
  relationships: Rel[];
  /** The document's dynamic views — the journeys drawn over the model above. */
  flows: Flow[];
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
      return { errors, elements: [], relationships: [], flows: [] };
    }

    // `parsedModel`, not `computedModel`: the computed stage additionally
    // computes every VIEW the document declares (and a default one when it
    // declares none), which loam never reads — it renders nothing. That work is
    // superlinear in the number of RELATIONSHIPS, so a landscape at fleet shape
    // turned `loam list` from under a second into minutes. The elements and
    // relationships below are identical either way, and the dynamic views are
    // read from the same parsed declaration (see flows/flatten.ts) rather than
    // from the computed views the expensive stage would build.
    const model = (await likec4.parsedModel()) as ReadableModel & ReadableViews;
    const { elements, relationships } = flattenModel(model);
    return { errors, elements, relationships, flows: flattenFlows(model, relationships) };
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
