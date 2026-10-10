/**
 * The contract as the feature would leave it: the REAL merge
 * (core/asyncapi/merge/merge.ts) run over the two texts and read back,
 * nothing written. One simulation feeds three gate questions — the
 * `declares()` join in ../events/events.ts (a retired or edited-away send
 * must stop answering "the service declares this" BEFORE archive, or a
 * leftover `Publishes:` line passes the gate and breaks the post-archive
 * fleet), the consumer gate's wire half (a channel or operation removal that
 * stops the service SENDING a message the fleet still consumes), and the
 * revival check's moved-message question (./revived.ts): is a name still
 * declared where it lives now once the delta merges, or does the delta itself
 * rewrite that place — a channel restated or retired, another message at the
 * key.
 *
 * Calling the merge rather than re-deriving its verdicts is the point: a
 * second spelling of quote/edit/removal here would eventually disagree with
 * the merge about what archive actually writes, and the gate would be
 * promising a contract the archive does not produce.
 */
import { parse } from "yaml";
import { asyncapiDocOf } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import { AsyncapiMergeError } from "../../asyncapi/merge/error.js";
import { mergeAsyncapiSlots } from "../../asyncapi/merge/merge.js";

/** The two texts the simulation merges, plus the living side's existing parse. */
export interface MergeSimulationInput {
  livingText: string;
  /** `readAsyncapi` of livingText — reused verbatim when the merge writes nothing. */
  livingDoc: AsyncapiDoc;
  featureText: string;
  service: string;
}

/**
 * Simulate the archive-time merge, or stand down. Both documents are known
 * readable here (the pair, ./event-pair.ts, asks only with both texts in
 * hand, and both of its readers — the walk in ../events/declared.ts and
 * rebase's `serviceRevivals` — refuse an unreadable delta first), so the
 * only refusals left are the merge's own judgement calls — an aliased
 * section, a section spelling one slot key twice. `undefined` on those
 * rather than a throw: the walk falls back to the feature ∪ living union
 * view, which can only be too lenient, the revival check to the living
 * contract as it stands, and the archive's own plan will surface the refusal
 * by name.
 */
export function mergedAsyncapiDoc(input: MergeSimulationInput): AsyncapiDoc | undefined {
  const { livingText, livingDoc, featureText, service } = input;
  try {
    const out = mergeAsyncapiSlots(livingText, featureText, service);
    return out.text === null ? livingDoc : asyncapiDocOf(parse(out.text));
  } catch (error) {
    if (error instanceof AsyncapiMergeError) return undefined;
    throw error;
  }
}
