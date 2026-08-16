/**
 * The keys loam adds to a feature's contract that must never reach the living
 * one: `x-loam-remove` and `x-loam-based-on`.
 *
 * They are gathered here rather than spread through the merge because they are
 * the vocabulary both ends of the delta path share — `stripOpenapiRemovalMarkers`
 * takes them out for the projection a service repository sees, and the merge
 * takes them out again on the way into the living document. Two spellings of
 * "which keys are feature-only" is how one of the two starts leaking a marker.
 */
import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold OpenAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
import { HTTP_METHODS } from "../doc.js";
import { operationBaselineOf, withoutOperationBaseline, OPENAPI_BASELINE_KEY } from "../digest.js";
import { errorMessage, OpenapiMergeError } from "./error.js";

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
    const kept = withoutFeatureMarkers(item);
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
  //
  // The test has to reach the OPERATION nodes too, not just the path items. The
  // in-place branch strips a surviving operation's pin through
  // `["paths", p, m, x-loam-based-on]`, and an aliased operation is exactly one
  // level below where the check used to look — so `deleteIn` walked into a node
  // that is not a collection and threw out of archive as `internal`, on a
  // document whose only fault was writing one operation twice.
  //
  // What disqualifies a method is "there is something here to strip and I cannot
  // reach it", not "this is not a map node". Only a resolved MAPPING can be a
  // removal marker or carry a pin, so a method spelled as a scalar — `get: ~`,
  // or a string — is nothing the in-place branch would have touched; demanding a
  // map node of it too demoted whole documents to the rewrite branch and cost
  // their author every comment, anchor and hand-chosen key order inside `paths`,
  // in the bytes archive installs as the living contract. What is left is the
  // real hazard: a mapping the AST does not hand back as a map. An alias is the
  // one node kind that resolves to a mapping without being one, and a method
  // whose KEY is an alias is not findable by name at all, so `deleteIn` reports
  // nothing deleted and the marker ships in silence. Both answer `undefined` or
  // a non-map here, and both belong on the safe branch.
  const editable =
    isMap(feature.get("paths")) &&
    Object.entries(paths).every(
      ([p, item]) =>
        isMap(feature.getIn(["paths", p])) &&
        (!isRecord(item) ||
          Object.entries(item).every(
            ([m, op]) => !HTTP_METHODS.has(m) || !isRecord(op) || isMap(feature.getIn(["paths", p, m])),
          )),
    );
  if (!editable) {
    feature.setIn(["paths"], cleaned);
  } else {
    for (const [path, item] of Object.entries(paths)) {
      if (!isRecord(item)) continue;
      for (const [m, value] of Object.entries(item)) {
        // A loam marker at PATH level, deleted here for the same reason the
        // resolved-tree branch drops it: the two branches must agree exactly
        // about what a living contract may carry.
        if (FEATURE_ONLY_KEYS.has(m)) feature.deleteIn(["paths", path, m]);
        if (!HTTP_METHODS.has(m)) continue;
        if (isRemoval(value)) feature.deleteIn(["paths", path, m]);
        // The surviving operations keep their formatting but lose their pin:
        // the in-place branch must strip everything the resolved-tree branch
        // does, or the two disagree about what a living contract may carry.
        else if (operationBaselineOf(value) !== undefined) {
          feature.deleteIn(["paths", path, m, OPENAPI_BASELINE_KEY]);
        }
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

export function opLabel(before: unknown, after: unknown, method: string, path: string): string {
  const operation = operationIdOf(after) ?? operationIdOf(before);
  return operation !== undefined ? `'${operation}' (${method} ${path})` : `${method} ${path}`;
}

/** Is this operation node a feature-only explicit removal marker? */
export function isRemoval(node: unknown): boolean {
  return node !== null &&
    typeof node === "object" &&
    (node as Record<string, unknown>)["x-loam-remove"] === true;
}

/** Read an operationId from a YAML or plain operation node. */
export function operationIdOf(node: unknown): string | undefined {
  const value = isMap(node)
    ? node.get("operationId")
    : node !== null && typeof node === "object"
      ? (node as Record<string, unknown>)["operationId"]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Every key that is an instruction to loam rather than part of the contract.
 * At PATH level neither has any meaning — `x-loam-remove` addresses one
 * operation and `x-loam-based-on` pins one — so a path item carrying either is
 * an authoring mistake, and one that must not be published whatever else is
 * done about it.
 */
const FEATURE_ONLY_KEYS = new Set(["x-loam-remove", OPENAPI_BASELINE_KEY]);

/**
 * Copy a path item without anything that belongs to the FEATURE rather than to
 * the contract: removal-marker operations, the `x-loam-based-on` pins on the
 * operations that survive, and a loam marker written at PATH level. All three
 * are instructions to loam, and a living contract that carries any of them is
 * lying to the next reader — and, for the pin, to the next feature's baseline.
 *
 * The path-level case used to fall through: the filter guarded only HTTP
 * methods, so `x-loam-remove: true` beside the methods was copied verbatim into
 * the fleet's living contract, where it also kept the empty-path cleanup from
 * ever seeing an empty path.
 */
export function withoutFeatureMarkers(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key, value]) => !FEATURE_ONLY_KEYS.has(key) && !(HTTP_METHODS.has(key) && isRemoval(value)))
    .map(([key, value]) => [key, HTTP_METHODS.has(key) ? withoutOperationBaseline(value) : value] as const);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export function plainChild(parent: unknown, key: string): unknown {
  return parent !== null && typeof parent === "object"
    ? (parent as Record<string, unknown>)[key]
    : undefined;
}
