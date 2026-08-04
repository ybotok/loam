import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import { HTTP_METHODS } from "./openapi.js";

/** What an OpenAPI path merge computed, including every condition the caller must surface. */
export interface OpenapiMergeResult {
  /** The merged living document, or null when the feature document has no paths to merge. */
  text: string | null;
  /** Labels of existing operations overwritten with different content. */
  modified: string[];
  /**
   * Labels of PATH-LEVEL keys (`parameters`, `servers`, `summary`, `x-*`)
   * overwritten with different content. They are not operations, so they were
   * excluded from the difference check entirely and overwritten in silence —
   * a delta restating a path with a shorter `parameters` list dropped shared
   * parameters from every operation under it, and the plan said nothing.
   */
  pathItemModified: string[];
  /** Labels of living operations deleted by `x-loam-remove: true` markers. */
  removed: string[];
  /** `<kind>/<name>` of living components overwritten with different content. */
  componentsModified: string[];
  /** Local refs reachable from merged content that resolve in neither document. */
  unresolved: Array<{ ref: string; from: string }>;
}

export type OpenapiMergeSource = "feature" | "living";

/** A document the merge planner cannot read. Commands map this domain error to their own envelope. */
export class OpenapiMergeError extends Error {
  override readonly name = "OpenapiMergeError";

  constructor(
    readonly source: OpenapiMergeSource,
    readonly service: string,
    detail: string,
  ) {
    super(`${source} openapi for ${service} is not valid YAML: ${detail}`);
  }
}

/**
 * Remove feature-only operation-removal markers before a feature contract is
 * used to create a brand-new living document. Normally coherence refuses this
 * shape because there cannot be a removal target; this guard also keeps
 * `--approve` from ever persisting the marker into living docs.
 */
export function stripOpenapiRemovalMarkers(featureText: string, service: string): string {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new OpenapiMergeError("feature", service, feature.errors[0]!.message);
  }
  let plain: unknown;
  try {
    plain = feature.toJS() ?? {};
  } catch (error) {
    throw new OpenapiMergeError("feature", service, errorMessage(error));
  }
  // Shape from the RESOLVED tree, for the same reason the merge reads it there:
  // an aliased `paths` or path item is not a map node, and treating it as
  // "nothing to strip" is how a feature-only marker reached a living contract.
  const paths = plainChild(plain, "paths");
  if (!isRecord(paths)) return featureText;

  const cleaned: Record<string, unknown> = {};
  let stripped = false;
  for (const [path, item] of Object.entries(paths)) {
    const kept = withoutRemovalMarkers(item);
    if (!isDeepStrictEqual(kept, item)) stripped = true;
    // A path the strip emptied goes with its last operation: `\/x: {}` is a
    // path the contract advertises and nothing answers.
    if (kept !== undefined) cleaned[path] = kept;
  }
  if (!stripped) return featureText;

  // Edit the AST in place when every node the strip touches IS a node — the
  // author's comments, key order and formatting are theirs to keep. An alias
  // cannot be edited in place (there is one shared value behind it, and
  // deleting a key through it would change every use), so those documents get
  // their `paths` rewritten from the resolved tree instead: losing formatting
  // is a cost, shipping the marker is a corruption.
  const editable =
    isMap(feature.get("paths")) && Object.keys(paths).every((p) => isMap(feature.getIn(["paths", p])));
  if (!editable) {
    feature.setIn(["paths"], cleaned);
  } else {
    for (const [path, item] of Object.entries(paths)) {
      if (!isRecord(item)) continue;
      for (const [m, value] of Object.entries(item)) {
        if (HTTP_METHODS.has(m) && isRemoval(value)) feature.deleteIn(["paths", path, m]);
      }
      const remaining = feature.getIn(["paths", path]);
      if (isMap(remaining) && remaining.items.length === 0) feature.deleteIn(["paths", path]);
    }
  }
  try {
    return feature.toString();
  } catch (error) {
    throw new OpenapiMergeError("feature", service, errorMessage(error));
  }
}

/**
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing). A feature document without paths is a successful no-op.
 * The merged operations' local component-ref closure rides along recursively;
 * external refs are left untouched and never gated.
 *
 * Every SHAPE question — is there a `paths` mapping, is this path item a
 * mapping, which methods does it hold — is answered from the RESOLVED plain
 * trees, never from the AST node. Asking the AST (`isMap(node)`) answers a
 * different question: an alias node is not a map even when it resolves to one.
 * `paths: *alias` therefore read as "no paths to merge" and the whole contract
 * delta was dropped with a successful exit, and an aliased path ITEM fell into
 * the wholesale-replace branch and deleted every living operation on that path
 * that the alias did not restate. Aliases are legal OpenAPI and the natural way
 * to write a delta that repeats a shape; nothing here may treat them as absent.
 * An alias that cannot be resolved at all is a document loam cannot read, and
 * says so — it is never "nothing to merge".
 */
export function mergeOpenapiPaths(
  livingText: string,
  featureText: string,
  service: string,
): OpenapiMergeResult {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new OpenapiMergeError("feature", service, feature.errors[0]!.message);
  }
  let featPlain: unknown;
  try {
    // Resolve aliases once with the document's own anchor context. Calling an
    // individual AST node's toJSON() loses that context and can silently turn
    // an aliased operation or component into the wrong value.
    featPlain = feature.toJS() ?? {};
  } catch (error) {
    throw new OpenapiMergeError("feature", service, errorMessage(error));
  }
  const featPathsPlain = plainChild(featPlain, "paths");
  if (featPathsPlain === undefined || featPathsPlain === null) {
    return noop();
  }
  if (!isRecord(featPathsPlain)) {
    throw new OpenapiMergeError("feature", service, "`paths` is not a mapping");
  }
  const featPathEntries = Object.entries(featPathsPlain);
  if (featPathEntries.length === 0) return noop();

  const living = parseDocument(livingText);
  if (living.errors.length > 0) {
    throw new OpenapiMergeError("living", service, living.errors[0]!.message);
  }
  let livingPlain: unknown;
  try {
    livingPlain = living.toJS() ?? {};
  } catch (error) {
    throw new OpenapiMergeError("living", service, errorMessage(error));
  }
  const livingPathsPlain = plainChild(livingPlain, "paths");
  if (livingPathsPlain !== undefined && livingPathsPlain !== null && !isRecord(livingPathsPlain)) {
    throw new OpenapiMergeError("living", service, "`paths` is not a mapping");
  }
  const modified: string[] = [];
  const pathItemModified: string[] = [];
  const removed: string[] = [];
  for (const [path, featItemPlain] of featPathEntries) {
    const existing = living.getIn(["paths", path]);
    const existingPlain = plainChild(livingPathsPlain, path);
    if (existing !== undefined && !isRecord(existingPlain)) {
      // The living contract holds this path as something other than a path
      // item. Replacing it wholesale is the one branch that may delete living
      // operations without naming them, so it is reserved for paths the living
      // contract does not have at all.
      throw new OpenapiMergeError("living", service, `path '${path}' is not a mapping`);
    }
    if (existing !== undefined) {
      if (!isRecord(featItemPlain)) {
        throw new OpenapiMergeError("feature", service, `path '${path}' is not a mapping`);
      }
      for (const [m, afterPlain] of Object.entries(featItemPlain)) {
        const before = living.getIn(["paths", path, m]);
        const beforePlain = plainChild(existingPlain, m);
        if (HTTP_METHODS.has(m) && isRemoval(afterPlain)) {
          // Coherence validates the marker and gates absent/mismatched targets.
          // The merge remains defensive under --approve: never delete a
          // different operation merely because it occupies the requested slot.
          if (
            before !== undefined &&
            operationIdOf(beforePlain) !== undefined &&
            operationIdOf(beforePlain) === operationIdOf(afterPlain)
          ) {
            removed.push(opLabel(beforePlain, afterPlain, m, path));
            living.deleteIn(["paths", path, m]);
          }
          continue;
        }
        // The difference check covers EVERY key of the path item; only the
        // LABEL depends on whether the key is an HTTP method.
        if (before !== undefined && !isDeepStrictEqual(beforePlain, afterPlain)) {
          if (HTTP_METHODS.has(m)) modified.push(opLabel(beforePlain, afterPlain, m, path));
          else pathItemModified.push(`'${m}' (${path})`);
        }
        living.setIn(["paths", path, m], afterPlain);
      }
      // Removing the last method leaves `\/x: {}` — a path the contract still
      // advertises and nothing answers. The same cleanup
      // stripOpenapiRemovalMarkers already does on the feature side.
      const remaining = living.getIn(["paths", path]);
      if (isMap(remaining) && remaining.items.length === 0) living.deleteIn(["paths", path]);
      continue;
    }
    if (!isRecord(featItemPlain)) {
      throw new OpenapiMergeError("feature", service, `path '${path}' is not a mapping`);
    }
    const clean = withoutRemovalMarkers(featItemPlain);
    if (clean !== undefined) living.setIn(["paths", path], clean);
  }

  const componentsModified: string[] = [];
  const unresolved: OpenapiMergeResult["unresolved"] = [];
  const visited = new Set<string>();
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];

  const visitRef = (ref: string, from: string): void => {
    if (!ref.startsWith("#/")) return;
    const match = /^#\/components\/([^/]+)\/([^/]+)(?:\/|$)/.exec(ref);
    if (!match) {
      if (!resolvePointer(featPlain, ref).found && !resolvePointer(livingPlain, ref).found) {
        unresolved.push({ ref, from });
      }
      return;
    }
    const kind = match[1]!;
    const name = match[2]!;
    const key = `${kind}/${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const inFeature = resolvePointer(featPlain, `#/components/${kind}/${name}`);
    if (inFeature.found) {
      copies.push({ kind, name, value: inFeature.value });
      walk(inFeature.value, `components/${key}`);
      return;
    }
    if (!resolvePointer(livingPlain, `#/components/${kind}/${name}`).found) {
      unresolved.push({ ref, from });
    }
  };

  const walk = (node: unknown, from: string): void => {
    for (const ref of collectRefs(node)) visitRef(ref, from);
  };

  for (const [path, featItemPlain] of featPathEntries) {
    walk(withoutRemovalMarkers(featItemPlain), `paths ${path}`);
  }

  for (const { kind, name, value } of copies) {
    const existing = living.getIn(["components", kind, name]);
    if (existing !== undefined) {
      const existingPlain = resolvePointer(livingPlain, `#/components/${kind}/${name}`);
      if (existingPlain.found && isDeepStrictEqual(existingPlain.value, value)) continue;
      componentsModified.push(`${kind}/${name}`);
    }
    living.setIn(["components", kind, name], value);
  }

  let text: string;
  try {
    text = living.toString();
  } catch (error) {
    throw new OpenapiMergeError("living", service, errorMessage(error));
  }
  return { text, modified, pathItemModified, removed, componentsModified, unresolved };
}

/** The successful "the feature document has nothing to merge" answer. */
function noop(): OpenapiMergeResult {
  return {
    text: null,
    modified: [],
    pathItemModified: [],
    removed: [],
    componentsModified: [],
    unresolved: [],
  };
}

/** A resolved plain tree that can hold OpenAPI keys — an object, not an array. */
function isRecord(node: unknown): node is Record<string, unknown> {
  return node !== null && typeof node === "object" && !Array.isArray(node);
}

/** Every `$ref` string value anywhere in a plain JS tree, in document order. */
export function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const value of current) walk(value);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        if (key === "$ref" && typeof value === "string") out.push(value);
        else walk(value);
      }
    }
  };
  walk(node);
  return out;
}

/** Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. */
export function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
    } else if (current !== null && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

/** Name an overwritten operation by its operationId (feature's, else living's), or path+method. */
export function opLabel(before: unknown, after: unknown, method: string, path: string): string {
  const operation = operationIdOf(after) ?? operationIdOf(before);
  return operation !== undefined ? `'${operation}' (${method} ${path})` : `${method} ${path}`;
}

/** Is this operation node a feature-only explicit removal marker? */
function isRemoval(node: unknown): boolean {
  return node !== null &&
    typeof node === "object" &&
    (node as Record<string, unknown>)["x-loam-remove"] === true;
}

/** Read an operationId from a YAML or plain operation node. */
function operationIdOf(node: unknown): string | undefined {
  const value = isMap(node)
    ? node.get("operationId")
    : node !== null && typeof node === "object"
      ? (node as Record<string, unknown>)["operationId"]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Copy a path item without feature-only removal operations. */
function withoutRemovalMarkers(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([method, value]) => !(HTTP_METHODS.has(method) && isRemoval(value)));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function plainChild(parent: unknown, key: string): unknown {
  return parent !== null && typeof parent === "object"
    ? (parent as Record<string, unknown>)[key]
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
