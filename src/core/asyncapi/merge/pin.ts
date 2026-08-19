/**
 * The pin that tells a QUOTE from an EDIT, on the event axis.
 *
 * A feature's asyncapi.yaml is a complete document, so most of what it spells
 * is quotation: the author restated the living contract around the slot they
 * were changing. Without a pin the merge cannot tell the two apart and
 * upserts both — the exact silent-revert the OpenAPI axis's pin closed, with
 * no overlap between two features required, just two deltas over one service.
 *
 * Separate from the (future) merge module because this is `loam rebase`'s
 * half: it plans the pins a delta is missing, while the merge only ever
 * reads pins already written. Slot-keyed over the three named sections
 * exactly as the merge upserts (core/asyncapi/digest.ts owns the walker and
 * the section→path spelling); an inline channel message is channel-slot
 * interior and is never pinned on its own — SCHEMA.md's recorded decision.
 */
import { isMap, parseDocument } from "yaml";
import { AsyncapiMergeError, errorMessage } from "./error.js";
import {
  ASYNCAPI_BASELINE_KEY,
  asyncapiSlots,
  slotDigest,
  slotPath,
  type AsyncapiSection,
} from "../digest.js";

/** What happened to one slot's `x-loam-based-on`. */
export interface AsyncapiSlotPin {
  section: AsyncapiSection;
  key: string;
  status:
    /** It had no pin and now has one. */
    | "pinned"
    /** It named an older living version; it now names the current one. */
    | "repinned"
    /** It already named the current living version — no write. */
    | "unchanged"
    /** The living contract has no slot at this (section, key): this feature is adding it. */
    | "unresolved"
    /** Written as a YAML alias — one shared value backs every use, so loam will not stamp through it. */
    | "unwritable";
  from: string | null;
  to: string | null;
}

export interface AsyncapiPinPlan {
  /** The rewritten contract, or null when no pin changes. */
  text: string | null;
  pins: AsyncapiSlotPin[];
}

/**
 * Pin every slot in a feature contract against the living one — what
 * `loam rebase` writes on this axis.
 *
 * The pin is always `slotDigest` of the LIVING slot, never of the delta's
 * own, and that single rule produces both merge verdicts by itself: a slot
 * the author only QUOTED is byte-equal to living, so its pin equals its own
 * content and classifies as a quote; one the author EDITED differs from its
 * pin, so the merge writes it. A slot the living document lacks is
 * `unresolved` and correct — there is no living version of a channel,
 * operation or message the contract does not carry yet.
 */
export function pinAsyncapiSlots(featureText: string, livingText: string, service: string): AsyncapiPinPlan {
  const doc = parseDocument(featureText);
  if (doc.errors.length > 0) throw new AsyncapiMergeError("feature", service, doc.errors[0]!.message);
  let featPlain: unknown;
  let livingPlain: unknown;
  try {
    featPlain = doc.toJS() ?? {};
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }
  try {
    const parsed = parseDocument(livingText);
    if (parsed.errors.length > 0) throw new AsyncapiMergeError("living", service, parsed.errors[0]!.message);
    livingPlain = parsed.toJS() ?? {};
  } catch (error) {
    if (error instanceof AsyncapiMergeError) throw error;
    throw new AsyncapiMergeError("living", service, errorMessage(error));
  }

  const livingBySlot = new Map(asyncapiSlots(livingPlain).map((slot) => [`${slot.section}\0${slot.key}`, slot]));
  const pins: AsyncapiSlotPin[] = [];
  let edited = false;
  for (const slot of asyncapiSlots(featPlain)) {
    // A removal marker asserts a slot rather than restating it, so it has
    // nothing to be based on; `asyncapi.remove-target-missing/-mismatch`
    // are what guard it against a living slot that moved under it.
    if (slot.remove) continue;

    const at = { section: slot.section, key: slot.key };
    const from = slot.basedOn ?? null;
    const living = livingBySlot.get(`${slot.section}\0${slot.key}`);
    if (living === undefined || living.node === null || typeof living.node !== "object" || Array.isArray(living.node)) {
      pins.push({ ...at, status: "unresolved", from, to: null });
      continue;
    }
    const digest = slotDigest(living.node);
    if (from === digest) {
      pins.push({ ...at, status: "unchanged", from: digest, to: digest });
      continue;
    }
    // One shared value backs every use of an anchor, so `setIn` through an
    // alias would pin every other use of it too — the OpenAPI pin's refusal,
    // copied for the same data-loss reason.
    if (!isMap(doc.getIn(slotPath(slot.section, slot.key)))) {
      pins.push({ ...at, status: "unwritable", from, to: null });
      continue;
    }
    pins.push({ ...at, status: from === null ? "pinned" : "repinned", from, to: digest });
    doc.setIn([...slotPath(slot.section, slot.key), ASYNCAPI_BASELINE_KEY], digest);
    edited = true;
  }

  if (!edited) return { text: null, pins };
  try {
    return { text: doc.toString(), pins };
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }
}
