import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import {
  HTTP_METHODS,
  OPENAPI_BASELINE_KEY,
  classifyBaselineDigests,
  operationBaselineOf,
  operationDigest,
  withoutOperationBaseline,
} from "./openapi.js";

/**
 * What a feature's operation IS, relative to the living contract — the one
 * judgement that tells a QUOTE from an EDIT.
 *
 * A feature's openapi.yaml is a complete document, so most of what it spells is
 * quotation: the author restated the living contract around the slot they were
 * changing. Without a pin the merge cannot tell the two apart and upserts both,
 * which is how a feature that only meant to touch `cancelOrder` silently
 * reverted another team's landed change to `refundOrder` — no overlap between
 * the features required, just two deltas over one service.
 */
export type OperationBaselineVerdict = ReturnType<typeof classifyBaselineDigests>;

/**
 * Classify one feature operation against its living counterpart, from the raw
 * YAML trees the merge works in. The rule itself lives in core/openapi.ts, so
 * the gate and the merge cannot drift apart about which operations get written.
 *
 * A malformed pin matches no digest and lands in `stale`, which merges rather
 * than skips. Deliberate: `openapi.baseline-invalid` refuses it at the gate, and
 * a value nobody can evaluate must never be the reason a merge quietly drops an
 * operation.
 */
export function classifyOperationBaseline(featureOp: unknown, livingOp: unknown): OperationBaselineVerdict {
  return classifyBaselineDigests(
    operationBaselineOf(featureOp),
    operationDigest(featureOp),
    livingOp === undefined ? undefined : operationDigest(livingOp),
  );
}

/** What happened to one operation's `x-loam-based-on`. */
export interface OperationPin {
  path: string;
  method: string;
  /** Empty when the operation declares none — the slot is still the identity. */
  operationId: string;
  status:
    /** It had no pin and now has one. */
    | "pinned"
    /** It named an older living version; it now names the current one. */
    | "repinned"
    /** It already named the current living version — no write. */
    | "unchanged"
    /** The living contract has no operation at this slot: this feature is adding it. */
    | "unresolved"
    /** Written as a YAML alias — one shared value backs every use, so loam will not stamp through it. */
    | "unwritable";
  from: string | null;
  to: string | null;
}

export interface OpenapiPinPlan {
  /** The rewritten contract, or null when no pin changes. */
  text: string | null;
  pins: OperationPin[];
}

/**
 * Pin every operation in a feature contract against the living one — what
 * `loam rebase` writes on this axis.
 *
 * The pin is always `operationDigest` of the LIVING operation, never of the
 * delta's own, and that single rule produces both merge verdicts by itself: an
 * operation the author only QUOTED is byte-equal to living, so its pin equals
 * its own content and `classifyOperationBaseline` calls it a quote; one the
 * author EDITED differs from its pin, so the merge writes it. Nothing has to
 * guess at intent — the document already records it, and the pin makes it
 * legible to the merge.
 *
 * Slot-keyed (path + method), exactly as the merge upserts. An operationId that
 * moved to another slot is a new slot with nothing living behind it, which is
 * `unresolved` and correct: there is no living version of an operation at a
 * path the contract does not serve yet.
 */
export function pinOpenapiOperations(featureText: string, livingText: string, service: string): OpenapiPinPlan {
  const doc = parseDocument(featureText);
  if (doc.errors.length > 0) throw new OpenapiMergeError("feature", service, doc.errors[0]!.message);
  let featPlain: unknown;
  let livingPlain: unknown;
  try {
    featPlain = doc.toJS() ?? {};
  } catch (error) {
    throw new OpenapiMergeError("feature", service, errorMessage(error));
  }
  try {
    const parsed = parseDocument(livingText);
    if (parsed.errors.length > 0) throw new OpenapiMergeError("living", service, parsed.errors[0]!.message);
    livingPlain = parsed.toJS() ?? {};
  } catch (error) {
    if (error instanceof OpenapiMergeError) throw error;
    throw new OpenapiMergeError("living", service, errorMessage(error));
  }

  const featPaths = plainChild(featPlain, "paths");
  if (!isRecord(featPaths)) return { text: null, pins: [] };
  const livingPaths = plainChild(livingPlain, "paths");

  const pins: OperationPin[] = [];
  let edited = false;
  for (const [path, item] of Object.entries(featPaths)) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !isRecord(op)) continue;
      // A removal marker asserts a slot rather than restating an operation, so
      // it has nothing to be based on; `openapi.remove-target-mismatch` is what
      // guards it against a living slot that moved under it.
      if (isRemoval(op)) continue;

      const id = typeof op["operationId"] === "string" ? op["operationId"] : "";
      const at = { path, method, operationId: id };
      const from = operationBaselineOf(op) ?? null;
      const livingItem = plainChild(livingPaths, path);
      const livingOp = isRecord(livingItem) ? livingItem[method] : undefined;
      if (!isRecord(livingOp)) {
        pins.push({ ...at, status: "unresolved", from, to: null });
        continue;
      }
      const digest = operationDigest(livingOp);
      if (from === digest) {
        pins.push({ ...at, status: "unchanged", from: digest, to: digest });
        continue;
      }
      // One shared value backs every use of an anchor, so `setIn` through an
      // alias would pin every other use of it too — the same reason
      // stripOpenapiRemovalMarkers refuses to edit aliases in place.
      if (!isMap(doc.getIn(["paths", path, method]))) {
        pins.push({ ...at, status: "unwritable", from, to: null });
        continue;
      }
      pins.push({ ...at, status: from === null ? "pinned" : "repinned", from, to: digest });
      doc.setIn(["paths", path, method, OPENAPI_BASELINE_KEY], digest);
      edited = true;
    }
  }

  if (!edited) return { text: null, pins };
  try {
    return { text: doc.toString(), pins };
  } catch (error) {
    throw new OpenapiMergeError("feature", service, errorMessage(error));
  }
}

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
  /**
   * Labels of operations the delta QUOTED — pinned, and equal to their own
   * baseline — so the merge left the living contract's own copy alone. Reported
   * rather than silent: "your delta mentions this and I did not write it" is
   * exactly the sentence whose absence made the revert invisible.
   */
  quoted: string[];
  /**
   * Labels of operations whose pin matches neither the delta's own content nor
   * the living one: edited here AND changed by somebody else in between.
   * `openapi.baseline-stale` refuses these at the gate; the merge still
   * overwrites, because reaching it at all means `--approve` said to.
   */
  baselineStale: string[];
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
  const editable =
    isMap(feature.get("paths")) && Object.keys(paths).every((p) => isMap(feature.getIn(["paths", p])));
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
  const quoted: string[] = [];
  const baselineStale: string[] = [];
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
      // EVERY branch publishes through withoutFeatureMarkers. This one used to
      // copy every key of the feature path item and guard only the HTTP
      // methods, so a path-level `x-loam-remove` landed in the living contract
      // with `modified: []` and no warning. A key the strip drops is never
      // written; the removal handling below still reads the RAW item, because
      // that is where the markers it acts on live.
      const publish = withoutFeatureMarkers(featItemPlain);
      const publishable = isRecord(publish) ? publish : {};
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
        if (HTTP_METHODS.has(m)) {
          const verdict = classifyOperationBaseline(afterPlain, before === undefined ? undefined : beforePlain);
          // A QUOTE is not a merge input. The author wrote this operation down
          // because the document is complete, not because they changed it, so
          // the living contract keeps whatever it holds — including a change
          // that landed after this delta was written. This is mechanical, not a
          // judgement, so `--approve` does not turn it back on: overriding a
          // gate is a decision, reverting an operation nobody edited is a bug.
          if (verdict === "quote") {
            quoted.push(opLabel(beforePlain, afterPlain, m, path));
            continue;
          }
          if (verdict === "stale") baselineStale.push(opLabel(beforePlain, afterPlain, m, path));
        }
        if (!(m in publishable)) {
          // A feature-only marker at path level. It is never published, and
          // never reported as a path-item overwrite either — it is not a key of
          // the contract at all. The archive gate names it to the author.
          continue;
        }
        // The difference check covers EVERY key of the path item; only the
        // LABEL depends on whether the key is an HTTP method.
        if (before !== undefined && !isDeepStrictEqual(beforePlain, afterPlain)) {
          if (HTTP_METHODS.has(m)) modified.push(opLabel(beforePlain, afterPlain, m, path));
          else pathItemModified.push(`'${m}' (${path})`);
        }
        // Without the strip the living contract would grow a pin to a version
        // of itself, and the NEXT feature's baseline would hash it.
        living.setIn(["paths", path, m], publishable[m]);
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
    const clean = withoutFeatureMarkers(featItemPlain);
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
    walk(withoutFeatureMarkers(featItemPlain), `paths ${path}`);
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
  return { text, modified, pathItemModified, removed, quoted, baselineStale, componentsModified, unresolved };
}

/** The successful "the feature document has nothing to merge" answer. */
function noop(): OpenapiMergeResult {
  return {
    text: null,
    modified: [],
    pathItemModified: [],
    removed: [],
    quoted: [],
    baselineStale: [],
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
function withoutFeatureMarkers(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key, value]) => !FEATURE_ONLY_KEYS.has(key) && !(HTTP_METHODS.has(key) && isRemoval(value)))
    .map(([key, value]) => [key, HTTP_METHODS.has(key) ? withoutOperationBaseline(value) : value] as const);
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
