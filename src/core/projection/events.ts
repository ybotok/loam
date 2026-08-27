/**
 * The AsyncAPI half of projecting a feature onto one service — the event-axis
 * mirror of `./api.ts`, moved out of `commands/delta/slices.ts` with it for
 * the same second-caller reason.
 */
import { existsSync } from "node:fs";
import { readAsyncapi } from "../asyncapi/read.js";

/**
 * One message declaration the feature's AsyncAPI delta carries for this
 * service. `slot` is where it is declared — `components.messages.<key>`, or an
 * inline `channels.<ck>.messages.<mk>` — the same spelling the validate
 * findings use; `message` is the join token an edge's `metadata { publishes }`
 * and a requirement's `Publishes:` line name.
 */
export interface EventChange {
  slot: string;
  message: string;
  /**
   * What the document's own operations do with the message: `send`, `receive`,
   * or null when no operation reaches it (declared but not wired — and always
   * null for a removal, whose marker joins nothing). A name both sent and
   * received reports `send`: the producer's side owns the contract.
   */
  direction: "send" | "receive" | null;
  /** `x-loam-remove: true` — this declaration retires the slot, not adds it. */
  remove: boolean;
}

/** The event axis of the brief. Same discipline as ApiSlice: the changes and the document's readability travel together. */
export interface EventSlice {
  changes: EventChange[];
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
}

/**
 * The feature's AsyncAPI delta for one service, as slots rather than names —
 * the event-axis mirror of `apiChanges`, read through `core/asyncapi/read.ts`
 * so this view cannot see a message validate does not. Like the API slice, it
 * lists the WHOLE document, restated living slots included: the delta is a
 * complete document, and which slots are new is `loam validate`'s question.
 */
export async function eventChanges(asyncapiPath: string): Promise<EventSlice> {
  if (!existsSync(asyncapiPath)) return { changes: [], unreadable: false };
  const doc = await readAsyncapi(asyncapiPath);
  if (doc.unreadable) {
    return { changes: [], unreadable: true, ...(doc.error === undefined ? {} : { error: doc.error }) };
  }
  const sent = new Set(doc.sent);
  const received = new Set(doc.received);
  return {
    changes: doc.messages.map((m) => ({
      slot: m.slot,
      message: m.name,
      direction: sent.has(m.name) ? "send" : received.has(m.name) ? "receive" : null,
      remove: m.remove === true,
    })),
    unreadable: false,
  };
}
