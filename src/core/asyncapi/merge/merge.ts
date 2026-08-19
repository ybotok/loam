/**
 * The archive-time merge on the event axis: a feature's asyncapi delta folded
 * into the living contract, and every condition the caller has to surface
 * afterwards — the OpenAPI merge's shape, slot-keyed instead of path-keyed.
 *
 * The result type carries far more than the merged text on purpose. A merge
 * that quietly overwrote a slot, deleted a message, or ran against a stale
 * baseline is not an error — it is a fact the archiving human has to be told,
 * and a return value nobody can forget to read is the only place that
 * survives a refactor.
 *
 * Every SHAPE question — which slots does the feature declare, what does the
 * living contract hold at a (section, key) — is answered from the RESOLVED
 * plain trees, never from the AST node: an alias node is not a map even when
 * it resolves to one, and reading it as absent is how the OpenAPI merge once
 * dropped whole contract deltas. The WRITES walk the AST, string-key-matched,
 * and refuse aliases — one shared value backs every use of an anchor, so
 * writing through one would rewrite every other node that aliases it.
 */
import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold AsyncAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
import { classifyBaselineDigests } from "../../openapi/digest.js";
import { asyncapiSlots, slotDigest, type AsyncapiSection } from "../digest.js";
import { danglingRefs } from "../depth.js";
import { messageName } from "../read.js";
import { errorMessage, AsyncapiMergeError } from "./error.js";
import {
  deleteSlot,
  refuseAmbiguousSlotKeys,
  sectionAstPath,
  setSlotValue,
  slotLabel,
  withoutFeatureMarkers,
} from "./markers.js";

/** One slot the merge acted on — the section decides which per-section code the plan reports. */
export interface AsyncapiSlotOutcome {
  section: AsyncapiSection;
  /** `slotLabel` of the slot — the message's join name included where it has one. */
  label: string;
}

/** What an asyncapi slot merge computed, including every condition the caller must surface. */
export interface AsyncapiMergeResult {
  /** The merged living document, or null when nothing was written — no slots declared, or every slot a quote. */
  text: string | null;
  /** Living slots overwritten with different content. */
  modified: AsyncapiSlotOutcome[];
  /** Living slots deleted by `x-loam-remove: true` markers. */
  removed: AsyncapiSlotOutcome[];
  /**
   * Slots the delta QUOTED — pinned, and equal to their own baseline — so the
   * merge left the living contract's own copy alone. Reported rather than
   * silent: "your delta mentions this and I did not write it" is exactly the
   * sentence whose absence made the OpenAPI revert invisible.
   */
  quoted: AsyncapiSlotOutcome[];
  /**
   * Slots whose pin matches neither the delta's own content nor the living
   * one: edited here AND changed by somebody else in between.
   * `asyncapi.baseline-stale` refuses these at the gate; the merge still
   * overwrites, because reaching it at all means `--approve` said to.
   */
  baselineStale: AsyncapiSlotOutcome[];
  /** Local refs the MERGE left dangling: unresolved in the merged tree and not already dangling in living. */
  unresolved: string[];
}

/**
 * Merge the feature's slots into the living AsyncAPI structurally (YAML AST,
 * not text splicing). A feature document declaring no slots is a successful
 * no-op. Per slot, the pin decides: a QUOTE is never a merge input — not even
 * under `--approve`, because overriding a gate is a decision and reverting a
 * slot nobody edited is a bug — while `stale` still writes, since reaching
 * the merge at all means `--approve` said to. A removal marker deletes its
 * exact target and the section key when the section empties; everything
 * published goes through the deep marker strip.
 */
export function mergeAsyncapiSlots(
  livingText: string,
  featureText: string,
  service: string,
): AsyncapiMergeResult {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new AsyncapiMergeError("feature", service, feature.errors[0]!.message);
  }
  // Two pairs whose keys stringify identically (404 and "404") would make
  // the resolved walk and the string-matched writers disagree about which
  // node a slot names — refused on either side, before any verdict is taken.
  refuseAmbiguousSlotKeys(feature, "feature", service);
  let featPlain: unknown;
  try {
    // Resolve aliases once with the document's own anchor context. Calling an
    // individual AST node's toJSON() loses that context and can silently turn
    // an aliased slot into the wrong value.
    featPlain = feature.toJS() ?? {};
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }
  const featSlots = asyncapiSlots(featPlain);
  if (featSlots.length === 0) return noop();

  const living = parseDocument(livingText);
  if (living.errors.length > 0) {
    throw new AsyncapiMergeError("living", service, living.errors[0]!.message);
  }
  refuseAmbiguousSlotKeys(living, "living", service);
  let livingPlain: unknown;
  try {
    livingPlain = living.toJS() ?? {};
  } catch (error) {
    throw new AsyncapiMergeError("living", service, errorMessage(error));
  }
  const livingBySlot = new Map(asyncapiSlots(livingPlain).map((slot) => [`${slot.section}\0${slot.key}`, slot]));

  const modified: AsyncapiSlotOutcome[] = [];
  const removed: AsyncapiSlotOutcome[] = [];
  const quoted: AsyncapiSlotOutcome[] = [];
  const baselineStale: AsyncapiSlotOutcome[] = [];
  const touched = new Set<AsyncapiSection>();
  let edited = false;
  for (const slot of featSlots) {
    const before = livingBySlot.get(`${slot.section}\0${slot.key}`);
    const name = slot.section === "components.messages" ? messageName(slot.node, slot.key) : undefined;
    const at = { section: slot.section, label: slotLabel(slot.section, slot.key, name) };
    if (slot.remove) {
      // Coherence validates the marker and gates absent/mismatched targets.
      // The merge remains defensive under --approve: never delete a different
      // message merely because it occupies the requested slot. Channel and
      // operation identity IS the key, so presence is the whole match there.
      if (before === undefined) continue;
      if (slot.section === "components.messages" && messageName(before.node, slot.key) !== name) continue;
      writableSection(living, livingPlain, slot.section, service);
      if (deleteSlot(living, slot.section, slot.key)) {
        removed.push(at);
        touched.add(slot.section);
        edited = true;
      }
      continue;
    }

    const verdict = classifyBaselineDigests(
      slot.basedOn,
      slot.digest,
      before === undefined ? undefined : slotDigest(before.node),
    );
    // A QUOTE is not a merge input. The author wrote this slot down because
    // the document is complete, not because they changed it, so the living
    // contract keeps whatever it holds — including a change that landed after
    // this delta was written. Mechanical, not a judgement: `--approve` does
    // not turn it back on.
    if (verdict === "quote") {
      quoted.push(at);
      continue;
    }
    if (verdict === "stale") baselineStale.push(at);
    const publish = withoutFeatureMarkers(slot.node);
    // An unpinned restatement equal to the living slot has nothing to write —
    // the component closure's rule, kept here so a never-rebased delta that
    // merely restates the contract does not churn its bytes.
    if (before !== undefined && isDeepStrictEqual(before.node, publish)) continue;
    if (before !== undefined) modified.push(at);
    writableSection(living, livingPlain, slot.section, service);
    // Without the strip the living contract would grow a pin to a version of
    // itself — and, on this axis, a marker nested on an inline channel
    // message, invisible to the slot walker (SCHEMA.md's channel-interior
    // decision: the strip works at that nested depth exactly as at slot depth).
    setSlotValue(living, slot.section, slot.key, publish);
    edited = true;
  }

  // Removing the last slot leaves a section the contract still spells and
  // nothing declares — delete the emptied mapping, and `components` too when
  // the messages were all it held. After the whole loop, so a removal and an
  // upsert into one section never race the cleanup.
  for (const section of touched) {
    const node = living.getIn(sectionAstPath(section));
    if (!isMap(node) || node.items.length > 0) continue;
    living.deleteIn(sectionAstPath(section));
    if (section === "components.messages") {
      const components = living.getIn(["components"]);
      if (isMap(components) && components.items.length === 0) living.deleteIn(["components"]);
    }
  }

  // Nothing written: the living document must not even be re-serialized —
  // byte-identity under an all-quote delta is the whole point of the pin.
  if (!edited) {
    return { text: null, modified, removed, quoted, baselineStale, unresolved: [] };
  }

  let mergedPlain: unknown;
  let text: string;
  try {
    mergedPlain = living.toJS() ?? {};
    text = living.toString();
  } catch (error) {
    throw new AsyncapiMergeError("living", service, errorMessage(error));
  }
  // The ref sweep grades what the MERGE would leave dangling: a merged slot
  // pointing at something neither document defines, or a removal that took a
  // target the living document still references. Refs already dangling in the
  // living contract are validate's finding (asyncapi.ref-unresolved, warn),
  // not this feature's doing — gating the archive on pre-existing rot would
  // block every delta over an already-rotten contract.
  const preexisting = new Set(danglingRefs(livingPlain));
  const unresolved = danglingRefs(mergedPlain).filter((ref) => !preexisting.has(ref));
  return { text, modified, removed, quoted, baselineStale, unresolved };
}

/**
 * Refuse a living container the merge cannot write into: a section spelled as
 * something other than a mapping is a document loam cannot merge, and one
 * spelled as a YAML alias would take the write into every node that shares
 * the anchor. Asked at the write, because reading is safe and writing is not
 * — an absent container is fine, `setSlotValue` creates it.
 */
function writableSection(
  living: ReturnType<typeof parseDocument>,
  livingPlain: unknown,
  section: AsyncapiSection,
  service: string,
): void {
  const path = sectionAstPath(section);
  for (let depth = 1; depth <= path.length; depth += 1) {
    const prefix = path.slice(0, depth);
    const plain = prefix.reduce<unknown>((node, step) => (isRecord(node) ? node[step] : undefined), livingPlain);
    if (plain === undefined || plain === null) return;
    const label = prefix.join(".");
    if (!isRecord(plain)) {
      throw new AsyncapiMergeError("living", service, `'${label}' is not a mapping`);
    }
    if (!isMap(living.getIn(prefix))) {
      throw new AsyncapiMergeError(
        "living",
        service,
        `'${label}' is written as a YAML alias — one shared value backs every use, so merging into it would rewrite every other node that aliases it. Expand it before archiving.`,
      );
    }
  }
}

/** The successful "the feature document has nothing to merge" answer. */
function noop(): AsyncapiMergeResult {
  return { text: null, modified: [], removed: [], quoted: [], baselineStale: [], unresolved: [] };
}
