/**
 * What a removal refusal counts of one consumer-index answer, and how it says
 * so — shared by the operation gate (./operations.ts) and its event twin
 * (../events/events.ts), so a consumer nobody could read refuses the same way,
 * in the same sentence, on both axes.
 *
 * Two lists, because they are two different claims. `named` is positive
 * evidence — the merge would strand these — and its sentence is each gate's
 * own, with the remedy that fits the shape. `unchecked` is a document nobody
 * could read or place, so the refusal must not say the fleet still consumes
 * anything: it says the gate could not tell, names the documents, and gives the
 * one remedy they share. Both land in `details[]`, the named ones first — the
 * order `loam diff` lists victims and doubts in.
 */
import type { Consumers } from "../../consumers/consumers.js";
import { documentDoubt } from "../../consumers/scan.js";

/** What the gate counts of one index answer. */
export interface StillNamed {
  /** The consumers the merge would strand, then the provider's own documents still naming it. */
  named: string[];
  /** The documents — a consumer's, or the provider's own — the scan could not read or place (`documentDoubt`). */
  unchecked: string[];
}

/**
 * The gate's reading of one answer: `victims` and `own` as evidence, and of the
 * suspensions only the document doubts. A caller drawn with no op and a
 * contested hop stay out — `documentDoubt` (core/consumers/scan.ts) says why
 * they are a warning's worth in `loam diff` and nothing here.
 */
export function stillNamed(found: Consumers): StillNamed {
  return {
    named: [...found.victims, ...found.own],
    unchecked: [...found.suspended, ...found.ownSuspended].filter(documentDoubt).map((s) => s.text),
  };
}

/** Nothing named and nothing unchecked: the removal is the gate's to let through. */
export function nothingStill(still: StillNamed): boolean {
  return still.named.length === 0 && still.unchecked.length === 0;
}

/** One refusal's sentence, as the gate that raises it phrases it. */
export interface RefusalWording {
  subject: string;
  /** How this feature's merge takes it out — the opening clause, e.g. "this feature retires 'capturePayment'". */
  lost: string;
  /** What a consumer does with it: "consume" for an operation, "name" for a message. */
  verb: string;
  /** The gate's own sentence over its named consumers, given them joined. */
  named: (list: string) => string;
}

/** The one remedy every unchecked document shares, after "make". */
const READABLE = "each document listed readable (re-save it as UTF-8, or leave one directory per service id) so the gate can answer";

/**
 * The message for one refusal. With named consumers it is the gate's own
 * sentence, plus one more when documents went unchecked too; with only
 * unchecked documents it never claims a consumer — "nobody could look" is not
 * "somebody still calls it", any more than it is "nobody does".
 */
export function refusalMessage(still: StillNamed, wording: RefusalWording): string {
  const unchecked = still.unchecked.join("; ");
  if (still.named.length === 0) {
    return `${wording.subject}: ${wording.lost}, but whether the fleet would still ${wording.verb} it after this merge could not be checked — ${unchecked}. Make ${READABLE}, or archive with --approve to break it deliberately.`;
  }
  const named = wording.named(still.named.join("; "));
  return still.unchecked.length === 0 ? named : `${named} Whether anything else would still ${wording.verb} it could not be checked either — ${unchecked}: make ${READABLE}.`;
}

/** What a refusal's `details[]` lists: the named consumers, then the documents nobody could check. */
export function refusalDetails(still: StillNamed): string[] {
  return [...still.named, ...still.unchecked];
}
