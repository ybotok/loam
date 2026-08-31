/**
 * The archive-time merge: a feature's contract folded into the living one, and
 * every condition the caller has to surface afterwards.
 *
 * The result type carries far more than the merged text on purpose. A merge
 * that quietly overwrote an operation, dropped a component, or ran against a
 * stale baseline is not an error — it is a fact the archiving human has to be
 * told, and a return value nobody can forget to read is the only place that
 * survives a refactor.
 */
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, parseDocument } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold OpenAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
import { HTTP_METHODS } from "../doc.js";
import { errorMessage, OpenapiMergeError } from "./error.js";
import { classifyOperationBaseline } from "./pin.js";
import { classifyBaselineDigests, isRemoval, valueDigest } from "../digest.js";
import { entryFor, readBaselineRecord, restatedSurfaces } from "../baseline/record.js";
import { opLabel, operationIdOf, plainChild, withoutFeatureMarkers } from "./markers.js";
import { mergeComponentClosure } from "./components.js";

/** What an OpenAPI path merge computed, including every condition the caller must surface. */
export interface OpenapiMergeResult {
  /**
   * The merged living document, or null when the feature document restates
   * nothing at all — neither a path entry nor a component. It used to be null
   * for a document with no `paths` key whatever its components said, and a
   * delta whose whole change was a shared schema archived at exit 0 having
   * merged nothing.
   */
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
  /** Path-level keys the delta QUOTED (`x-loam-baselines` entry equal to own content) — skipped, living's copy kept. */
  pathItemQuoted: string[];
  /** Path-level keys written on a stale record entry — reaching the merge means `--approve` said to. */
  pathItemStale: string[];
  /** `<kind>/<name>` of living components overwritten with different content. */
  componentsModified: string[];
  /**
   * `<kind>/<name>` of components written into a living contract that did not
   * have them. Beside `componentsModified` because the plan needs a name for
   * what a merge ADDED: a components-only delta merges no operation, and the
   * plan line naming the merged operation ids read `merged ()` for it — empty
   * parentheses, which is how a merge that published a new shared schema
   * looked exactly like one that did nothing.
   */
  componentsAdded: string[];
  /** Components the delta QUOTED — not copied, living's copy kept. */
  componentsQuoted: string[];
  /** Components written on a stale record entry — under `--approve`, like the operations. */
  componentsStale: string[];
  /** Local refs reachable from merged content that resolve in neither document. */
  unresolved: Array<{ ref: string; from: string }>;
}


/**
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing). A feature document restating NOTHING — no path entry and no
 * component — is a successful no-op; one whose whole delta is a component is
 * merged like any other, through the closure at the end of this function.
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
  // The SHAPE refusal is unchanged and stays first: a `paths` that is a
  // sequence or a scalar is a document loam cannot merge. Absent and null
  // (`paths:` with nothing under it) are not shape faults — they are documents
  // holding no path entries, which is a different sentence and now has a
  // different answer.
  if (featPathsPlain !== undefined && featPathsPlain !== null && !isRecord(featPathsPlain)) {
    throw new OpenapiMergeError("feature", service, "`paths` is not a mapping");
  }
  const featPathEntries = isRecord(featPathsPlain) ? Object.entries(featPathsPlain) : [];
  // "Is there anything to merge?" is a question about the whole delta, and for
  // years it was asked of `paths` alone — an absence test standing in for the
  // decision. It returned here, before the living document was even parsed, so
  // the component closure (the last statement of this function, and the only
  // thing that writes a component) never ran: a feature whose entire change was
  // a shared schema passed the gate and archived at exit 0 having merged
  // NOTHING. The components answer it too now, over the ONE surface
  // enumeration the gate and the rebase plan already grade the delta with.
  const componentsAreTheDelta = featPathEntries.length === 0;
  if (componentsAreTheDelta && !restatedSurfaces(featPlain).some((s) => s.kind === "component")) {
    return noop();
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
  const livingPathsPlain = plainChild(livingPlain, "paths");
  if (livingPathsPlain !== undefined && livingPathsPlain !== null && !isRecord(livingPathsPlain)) {
    throw new OpenapiMergeError("living", service, "`paths` is not a mapping");
  }
  const modified: string[] = [];
  const pathItemModified: string[] = [];
  const removed: string[] = [];
  const quoted: string[] = [];
  const baselineStale: string[] = [];
  const pathItemQuoted: string[] = [];
  const pathItemStale: string[] = [];
  // The surface record, read ONCE for the path-item loop and the component
  // closure. Malformed entries read back as absent — the gate refuses them,
  // and a value nobody can evaluate must never be why a merge skips a write.
  const { record } = readBaselineRecord(featPlain);
  // The plain values this merge actually WRITES, labelled for the ref sweep:
  // the closure copies new components reachable from these, and only these —
  // a quoted operation's refs are living's own business.
  const written: Array<{ from: string; value: unknown }> = [];
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
        if (!HTTP_METHODS.has(m)) {
          // The operations' verdict, for the keys beside them, from the root
          // record instead of an in-value pin. A QUOTE is skipped for the
          // operations' reason — the author restated it, they did not edit it
          // — and skipping matters MORE here: a path-level key applies to
          // every operation on the path, including ones this feature never
          // mentions. Stale still writes: reaching the merge means --approve.
          const verdict = classifyBaselineDigests(
            entryFor(record, { kind: "path-item", path, key: m, value: afterPlain }),
            valueDigest(afterPlain),
            before === undefined ? undefined : valueDigest(beforePlain),
          );
          if (verdict === "quote") {
            pathItemQuoted.push(`'${m}' (${path})`);
            continue;
          }
          if (verdict === "stale") pathItemStale.push(`'${m}' (${path})`);
        }
        // The difference check covers EVERY key of the path item; only the
        // LABEL depends on whether the key is an HTTP method.
        if (before !== undefined && !isDeepStrictEqual(beforePlain, afterPlain)) {
          if (HTTP_METHODS.has(m)) modified.push(opLabel(beforePlain, afterPlain, m, path));
          else pathItemModified.push(`'${m}' (${path})`);
        }
        // Every shape question above was answered from the RESOLVED tree, which
        // is exactly what makes an aliased path item read as an ordinary
        // mapping. The WRITE cannot be that forgiving: `setIn` walks the AST,
        // and one shared value backs every use of an anchor, so an operation
        // merged through the alias would land in every other path that
        // references it. There is no way to write into one use of an anchor and
        // not the rest, so this is a refusal rather than a fallback — and it is
        // asked here, at the write, because reading is safe and writing is not.
        if (!isMap(living.getIn(["paths", path]))) {
          throw new OpenapiMergeError(
            "living",
            service,
            `path '${path}' is written as a YAML alias — one shared value backs every use, so merging into it would rewrite every other path that aliases it. Expand it before archiving.`,
          );
        }
        // Without the strip the living contract would grow a pin to a version
        // of itself, and the NEXT feature's baseline would hash it.
        living.setIn(["paths", path, m], publishable[m]);
        written.push({ from: `paths ${path}`, value: publishable[m] });
      }
      // Removing the last method leaves a path the contract still advertises
      // and nothing answers — and `{}` is only the easy shape of that state: a
      // surviving path-LEVEL key (`parameters`, `summary`) kept the path alive
      // with zero operations just as misleadingly. No methods left means the
      // path goes, whatever else survived beside them. The same cleanup
      // stripOpenapiRemovalMarkers does on the feature side.
      const remaining = living.getIn(["paths", path]);
      if (isMap(remaining) && !remaining.items.some((it) => isScalar(it.key) && HTTP_METHODS.has(String(it.key.value)))) {
        living.deleteIn(["paths", path]);
      }
      continue;
    }
    if (!isRecord(featItemPlain)) {
      throw new OpenapiMergeError("feature", service, `path '${path}' is not a mapping`);
    }
    const clean = withoutFeatureMarkers(featItemPlain);
    if (clean !== undefined) {
      living.setIn(["paths", path], clean);
      written.push({ from: `paths ${path}`, value: clean });
    }
  }

  const closure = mergeComponentClosure({ living, featPlain, livingPlain, record, written, componentsAreTheDelta });
  const { componentsModified, componentsAdded, componentsQuoted, componentsStale, unresolved } = closure;

  let text: string;
  try {
    text = living.toString();
  } catch (error) {
    throw new OpenapiMergeError("living", service, errorMessage(error));
  }
  return {
    text, modified, pathItemModified, removed, quoted, baselineStale,
    pathItemQuoted, pathItemStale, componentsModified, componentsAdded, componentsQuoted, componentsStale, unresolved,
  };
}

/**
 * The successful "the feature document has nothing to merge" answer. Every key
 * of the result is spelled here, empty, rather than left off: the two objects
 * are compared field by field in the tests and read field by field by the plan,
 * and a `noop()` that quietly lacked a key would make "no delta" and "a delta
 * that merged nothing" structurally different shapes of the same answer.
 */
function noop(): OpenapiMergeResult {
  return {
    text: null, modified: [], pathItemModified: [], removed: [], quoted: [], baselineStale: [],
    pathItemQuoted: [], pathItemStale: [], componentsModified: [], componentsAdded: [],
    componentsQuoted: [], componentsStale: [], unresolved: [],
  };
}

