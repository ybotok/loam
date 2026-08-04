import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import { HTTP_METHODS } from "./openapi.js";

/** What an OpenAPI path merge computed, including every condition the caller must surface. */
export interface OpenapiMergeResult {
  /** The merged living document, or null when the feature document has no paths to merge. */
  text: string | null;
  /** Labels of existing operations overwritten with different content. */
  modified: string[];
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
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing). A feature document without paths is a successful no-op.
 * The merged operations' local component-ref closure rides along recursively;
 * external refs are left untouched and never gated.
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
  const featPaths = feature.get("paths");
  if (!isMap(featPaths) || featPaths.items.length === 0) {
    return { text: null, modified: [], componentsModified: [], unresolved: [] };
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
  const modified: string[] = [];
  for (const item of featPaths.items) {
    const path = scalarKey(item.key);
    const featItem = item.value;
    const featItemPlain = plainChild(plainChild(featPlain, "paths"), path);
    const existing = living.getIn(["paths", path]);
    if (existing !== undefined && isMap(existing) && isMap(featItem)) {
      for (const method of featItem.items) {
        const m = scalarKey(method.key);
        const before = living.getIn(["paths", path, m]);
        const beforePlain = plainChild(plainChild(plainChild(livingPlain, "paths"), path), m);
        const afterPlain = plainChild(featItemPlain, m);
        if (HTTP_METHODS.has(m) && before !== undefined && !isDeepStrictEqual(beforePlain, afterPlain)) {
          modified.push(opLabel(beforePlain, afterPlain, m, path));
        }
        living.setIn(["paths", path, m], afterPlain);
      }
    } else {
      living.setIn(["paths", path], featItemPlain);
    }
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

  for (const item of featPaths.items) {
    const path = scalarKey(item.key);
    walk(plainChild(plainChild(featPlain, "paths"), path), `paths ${path}`);
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
  return { text, modified, componentsModified, unresolved };
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
  const idOf = (node: unknown): string | undefined => {
    const value = isMap(node)
      ? node.get("operationId")
      : node !== null && typeof node === "object"
        ? (node as Record<string, unknown>)["operationId"]
        : undefined;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const operation = idOf(after) ?? idOf(before);
  return operation !== undefined ? `'${operation}' (${method} ${path})` : `${method} ${path}`;
}

/** Convert a YAML scalar key into the string used by OpenAPI maps. */
export function scalarKey(key: unknown): string {
  if (key && typeof key === "object" && "value" in key) {
    return String((key as { value: unknown }).value);
  }
  return String(key);
}

function plainChild(parent: unknown, key: string): unknown {
  return parent !== null && typeof parent === "object"
    ? (parent as Record<string, unknown>)[key]
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
