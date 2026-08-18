/**
 * The pin that tells a QUOTE from an EDIT.
 *
 * A feature's openapi.yaml is a complete document, so most of what it spells is
 * quotation: the author restated the living contract around the slot they were
 * changing. Without a pin the merge cannot tell the two apart and upserts both,
 * which is how a feature that only meant to touch `cancelOrder` silently
 * reverted another team's landed change to `refundOrder` — no overlap between
 * the two features required, just two deltas over one service.
 *
 * Separate from `./merge.ts` because this is `loam rebase`'s half: it plans the
 * pins a delta is missing, while the merge only ever reads pins already written.
 */
import { isMap, parseDocument } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold OpenAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
import { HTTP_METHODS } from "../doc.js";
import {
  classifyBaselineDigests,
  operationBaselineOf,
  operationDigest,
  OPENAPI_BASELINE_KEY,
} from "../digest.js";
import { errorMessage, OpenapiMergeError } from "./error.js";
import { isRemoval } from "../digest.js";
import { plainChild } from "./markers.js";

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
 * YAML trees the merge works in. The rule itself lives in ../digest.ts, so
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


