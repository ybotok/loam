import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";
import { declaredService, type DeclaredService } from "../kernel/ids/service.js";
import { readDynamicViews, type ParsedView } from "./parsed/dynamic-views.js";
import { readGlobalStyleIds, readViewIds, type ViewIdClaim } from "./parsed/view-ids.js";
import { readSpecification, type DocSpecification } from "./parsed/specification.js";
import { readDeployment, type DeploymentModel } from "./parsed/deployment.js";
import { descText, metaKey } from "./parsed/values.js";

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
  /**
   * The document's `specification { }` block — what its KINDS declare, as
   * opposed to what its elements do. Optional because a document that did not
   * parse has none, and because the several `LoadedDoc` literals standing in for
   * an absent file (`show`'s missing model.likec4, `unreadableLandscape`) have
   * nothing to put here: a reader must treat "absent" and "declares nothing" the
   * same way. See `./parsed/specification.ts` for why loam reads it at all —
   * short version: since LikeC4 1.59.0 a kind can carry tags, and only the
   * specification can tell an inherited tag from an authored one.
   */
  specification?: DocSpecification;
  /**
   * The `dynamic view`s the document DECLARES — the ordered steps of a use
   * case, never a rendering (docs/DESIGN.md rule 26). Optional for exactly the
   * reason `specification` is: a document that did not parse has none, and the
   * several `LoadedDoc` literals standing in for an absent file have nothing to
   * put here. Absent and empty mean the same thing to every reader — no views
   * were declared, or none could be read — and neither is a finding: a fleet
   * that draws no diagrams owes loam no views block.
   */
  views?: ParsedView[];
  /**
   * The ids of every view the document AUTHORS, static ones included — a census,
   * not a read of what any of them shows. Separate from `views` above because
   * the two answer different questions off different filters (see
   * `./parsed/view-ids.ts`), and because a static view contributes an id and
   * nothing else loam may look at.
   */
  viewIds?: ViewIdClaim[];
  /**
   * The ids of every GLOBAL STYLE the document declares — `global { styleGroup
   * <id> { … } }` and the single-rule `global { style <id> … }` alike, since
   * LikeC4 files both under one id table (hence not `styleGroups`). A
   * declaration census exactly as `viewIds` is: the ids, sorted, and never a
   * rule inside one (docs/DESIGN.md rule 26 says why a style is a rendering
   * instruction loam may not read). One consumer — the generated subsystem
   * views, which reference the group named `subsystems` when it is declared
   * and nothing otherwise, because a reference to an undeclared id is a parse
   * error that blanks the whole `architecture/` project in the renderer.
   * Optional for the reason `views` is: a document that did not parse has
   * none, and the `LoadedDoc` literals standing in for an absent file have
   * nothing to put here; absent and empty mean the same thing to every reader.
   */
  globalStyles?: string[];
  /**
   * The `deployment { }` model the document declares — nodes, instances and the
   * edges between them (`./parsed/deployment.ts`). Optional for the reason
   * `views` is, and read the same way by every consumer: absent and empty mean
   * "no topology", and neither is a finding. A fleet that draws no deployment
   * owes loam none, which is also the whole opt-in the axis has.
   */
  deployment?: DeploymentModel;
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
 *
 * Views are deliberately NOT in this interface, even though loam does read them.
 * What this interface pins is the two-stage PARITY that makes the cheap stage a
 * safe substitute for the expensive one — and the stages are not claimed to
 * agree about views, nor need to: the parsed stage is the only one rule 26
 * permits. That read has its own adapter, `./parsed/dynamic-views.ts`.
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
  /**
   * The parsed `specification { }` block. Typed `unknown` and normalized by
   * `readSpecification` rather than described here, because it is NOT part of
   * the two-stage parity this interface pins: the shape is LikeC4's internal
   * record (1.59.2 spells element-kind tags and relationship-kind tags
   * differently), and writing it out here would be a structural claim about a
   * dependency's internals that the compiler would then enforce against us.
   */
  specification?: unknown;
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

    // `parsedModel`, not `computedModel`: the computed stage RESOLVES every
    // view — expanding its predicates against the model and deriving the
    // ancestor edges a diagram needs (and computing a default view when the
    // document declares none). loam reads what a view DECLARES and never what a
    // view SHOWS (docs/DESIGN.md rule 26), so none of that resolution is ever
    // wanted; it renders nothing. That work is superlinear in the number of
    // RELATIONSHIPS, so a landscape at fleet shape turned `loam list` from under
    // a second into minutes. The elements and relationships below are identical
    // either way. The `await` is load-bearing for anything reading `$data`: it is
    // undefined on the unresolved promise.
    const model = (await likec4.parsedModel()) as ReadableModel;
    return {
      errors,
      specification: readSpecification(model.specification),
      views: readDynamicViews(model),
      viewIds: readViewIds(model),
      globalStyles: readGlobalStyleIds(model),
      deployment: readDeployment(model),
      ...flattenModel(model),
    };
  } finally {
    await likec4.dispose();
  }
}
