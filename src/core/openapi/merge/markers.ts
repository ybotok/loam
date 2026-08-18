/**
 * The keys loam adds to a feature's contract that must never reach the living
 * one: `x-loam-remove`, `x-loam-based-on`, and the root `x-loam-baselines`
 * record.
 *
 * They are gathered here rather than spread through the merge because they are
 * the vocabulary both ends of the delta path share — `stripOpenapiRemovalMarkers`
 * takes them out for the projection a service repository sees, and the merge
 * takes them out again on the way into the living document. Two spellings of
 * "which keys are feature-only" is how one of the two starts leaking a marker.
 */
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parseDocument } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold OpenAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
import { HTTP_METHODS } from "../doc.js";
import {
  FEATURE_ONLY_KEYS,
  isRemoval,
  operationBaselineOf,
  withoutFeatureKeysDeep,
  withoutOperationBaseline,
  OPENAPI_BASELINE_KEY,
  OPENAPI_BASELINES_KEY,
} from "../digest.js";
import { setComponentValue } from "./components.js";
import { errorMessage, OpenapiMergeError } from "./error.js";

/**
 * Remove feature-only operation-removal markers — and the root
 * `x-loam-baselines` record — before a feature contract is used to create a
 * brand-new living document. Normally coherence refuses the removal shape
 * because there cannot be a removal target; this guard also keeps `--approve`
 * from ever persisting a marker into living docs. The record needs the strip
 * on THIS path even more than the pins do: archive's create branch publishes
 * this function's output verbatim, and a components-only delta has nothing
 * strippable inside `paths` at all — the root key must not ride out on the
 * early returns below.
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
  const hasRecord = isRecord(plain) && OPENAPI_BASELINES_KEY in plain;
  // Shape from the RESOLVED tree, for the same reason the merge reads it there:
  // an aliased `paths` or path item is not a map node, and treating it as
  // "nothing to strip" is how a feature-only marker reached a living contract.
  const paths = plainChild(plain, "paths");
  if (!isRecord(paths)) {
    if (!hasRecord) return featureText;
    feature.deleteIn([OPENAPI_BASELINES_KEY]);
    return serialize(feature, service);
  }

  const cleaned: Record<string, unknown> = {};
  let stripped = false;
  for (const [path, item] of Object.entries(paths)) {
    const kept = withoutFeatureMarkers(item);
    if (!isDeepStrictEqual(kept, item)) stripped = true;
    // A path the strip emptied goes with its last operation: `\/x: {}` is a
    // path the contract advertises and nothing answers.
    if (kept !== undefined) cleaned[path] = kept;
  }
  // Component values get the same discipline as path items: a component
  // holding an operation shape (a `pathItems` component, a callback) nests
  // the feature-only keys where the paths walk never looks, and the create
  // branch publishes this function's output verbatim. The write is
  // string-key-matched (setComponentValue) so a numeric component name is
  // replaced, never duplicated.
  const comps = plainChild(plain, "components");
  if (isRecord(comps)) {
    for (const [kind, names] of Object.entries(comps)) {
      if (!isRecord(names)) continue;
      for (const [name, value] of Object.entries(names)) {
        const kept = withoutFeatureKeysDeep(value);
        if (kept !== value) {
          setComponentValue(feature, kind, name, kept);
          stripped = true;
        }
      }
    }
  }

  if (!stripped) {
    if (!hasRecord) return featureText;
    feature.deleteIn([OPENAPI_BASELINES_KEY]);
    return serialize(feature, service);
  }

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
      // The merge's twin: no OPERATIONS left means the path goes, surviving
      // path-level keys included — `{}` was only the easy shape of dead.
      if (isMap(remaining) && !remaining.items.some((it) => isScalar(it.key) && HTTP_METHODS.has(String(it.key.value)))) {
        feature.deleteIn(["paths", path]);
      }
    }
  }
  // The root record goes on BOTH serialization branches: it is feature
  // bookkeeping exactly like the pins, and the rewrite branch above replaced
  // only `paths`, so the root key survives either way without this.
  if (hasRecord) feature.deleteIn([OPENAPI_BASELINES_KEY]);
  return serialize(feature, service);
}

/** One spelling of "hand the document back", so every strip branch fails the same way. */
function serialize(feature: ReturnType<typeof parseDocument>, service: string): string {
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
