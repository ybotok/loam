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
import { classifyBaselineDigests } from "../../openapi/digest.js";
import { asyncapiSlots, slotDigest, type AsyncapiSection } from "../digest.js";
import { danglingRefs } from "../depth.js";
import { messageName } from "../read.js";
import { readBaselineRecord } from "../../openapi/baseline/record.js";
import { asyncapiSurfaces } from "../baseline/surfaces.js";
import { errorMessage, AsyncapiMergeError } from "./error.js";
import { mergeAsyncapiComponents } from "./components.js";
import {
  deleteSlot,
  refuseAmbiguousSlotKeys,
  sectionAstPath,
  setSlotValue,
  slotLabel,
  withoutFeatureMarkers,
  writableSection,
} from "./markers.js";

/** One slot the merge acted on — the section decides which per-section code the plan reports. */
export interface AsyncapiSlotOutcome {
  section: AsyncapiSection;
  /** `slotLabel` of the slot — the message's join name included where it has one. */
  label: string;
}

/** What an asyncapi slot merge computed, including every condition the caller must surface. */
export interface AsyncapiMergeResult {
  /**
   * The merged living document, or null when nothing was written — every slot
   * and surface a quote, or the delta restating nothing at all. It used to be
   * null for a document declaring no SLOT whatever its components said, and a
   * delta whose whole change was a shared schema archived at exit 0 having
   * merged nothing.
   */
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
  /**
   * `<kind>/<name>` of living component SURFACES overwritten with different
   * content — the three fields below are the surface half's mirror of
   * `modified`, `quoted` and `baselineStale`, and they are spelled together on
   * the result and on `noop()` for the same reason those are: the plan reads
   * this object field by field, and a key present on one shape and missing
   * from the other makes "no delta" and "a delta that merged nothing"
   * structurally different answers to the same question.
   */
  componentsModified: string[];
  /** Surfaces the delta QUOTED — not copied, living's copy kept. */
  componentsQuoted: string[];
  /** Surfaces written on a stale record entry — under `--approve`, like the slots. */
  componentsStale: string[];
  /** Local refs the MERGE left dangling: unresolved in the merged tree and not already dangling in living. */
  unresolved: string[];
}

/**
 * Merge the feature's slots into the living AsyncAPI structurally (YAML AST,
 * not text splicing). A feature document restating NOTHING — neither a slot
 * nor a component surface — is a successful no-op; one whose whole delta is a
 * `components.schemas` entry is merged like any other, through
 * `mergeAsyncapiComponents` at the end of this function. Per slot, the pin
 * decides: a QUOTE is never a merge input — not even
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
  // "Is there anything to merge?" is a question about the WHOLE delta, and it
  // was asked of the three slot sections alone — an absence test standing in
  // for the decision. It returned before the living document was even parsed,
  // so `mergeAsyncapiComponents` (the last thing this function does, and the
  // only thing that writes a component surface) never ran: a feature whose
  // entire change was a `components.schemas` entry passed the gate and
  // archived at exit 0 having merged NOTHING. The surfaces answer it too now,
  // over the ONE enumeration the gate and the rebase plan already grade the
  // delta with. Deleting the early return alone would have changed nothing:
  // there was no writer outside the slot loop to fall through to.
  if (featSlots.length === 0 && asyncapiSurfaces(featPlain).length === 0) return noop();

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
  // Read ONCE here, not per surface: `problems` are deliberately ignored — a
  // malformed record is the gate's diagnosis (`asyncapi.baseline-invalid`) and
  // a parser never prints, so what reaches the surface merge is whatever read
  // back cleanly, and an entry that did not is simply absent (= unpinned).
  const { record } = readBaselineRecord(featPlain);

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
      writableSection(living, livingPlain, sectionAstPath(slot.section), service);
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
    writableSection(living, livingPlain, sectionAstPath(slot.section), service);
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

  // The surface half, after the slot loop and its section cleanup so a write
  // outside the three sections can never race them. `edited` has to take the
  // closure's answer: without it the verdicts below would be computed and
  // reported while the `!edited` return discarded the document they were
  // computed over — the defect surviving in a new shape, with the plan naming
  // a schema that never reached the living contract.
  const surfaces = mergeAsyncapiComponents({ living, featPlain, livingPlain, record, service });
  const { componentsModified, componentsQuoted, componentsStale } = surfaces;
  if (surfaces.copied) edited = true;

  // Nothing written: the living document must not even be re-serialized —
  // byte-identity under an all-quote delta is the whole point of the pin.
  if (!edited) {
    return {
      text: null, modified, removed, quoted, baselineStale,
      componentsModified, componentsQuoted, componentsStale, unresolved: [],
    };
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
  return {
    text, modified, removed, quoted, baselineStale,
    componentsModified, componentsQuoted, componentsStale, unresolved,
  };
}

/**
 * The successful "the feature document restates nothing at all" answer. Every
 * key of the result is spelled here, empty, rather than left off — the reason
 * `AsyncapiMergeResult` gives for the three surface fields.
 */
function noop(): AsyncapiMergeResult {
  return {
    text: null, modified: [], removed: [], quoted: [], baselineStale: [],
    componentsModified: [], componentsQuoted: [], componentsStale: [], unresolved: [],
  };
}
