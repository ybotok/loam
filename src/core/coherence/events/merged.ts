/**
 * The contract as the feature would leave it: the REAL merge
 * (core/asyncapi/merge/merge.ts) run over the two texts and read back,
 * nothing written. One simulation feeds two gate questions — the
 * `declares()` join in ./events.ts (a retired or edited-away send must stop
 * answering "the service declares this" BEFORE archive, or a leftover
 * `Publishes:` line passes the gate and breaks the post-archive fleet) and
 * the consumer gate's wire half (a channel or operation removal that stops
 * the service SENDING a message the fleet still consumes).
 *
 * Calling the merge rather than re-deriving its verdicts is the point: a
 * second spelling of quote/edit/removal here would eventually disagree with
 * the merge about what archive actually writes, and the gate would be
 * promising a contract the archive does not produce.
 */
import { parse } from "yaml";
import { asyncapiDocOf, type AsyncapiDoc } from "../../asyncapi/read.js";
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
 * readable here (the walk in ./declared.ts checked), so the only refusals
 * left are the merge's own judgement calls — an aliased section, a section
 * spelling one slot key twice. `undefined` on those rather than a throw: the
 * caller falls back to the feature ∪ living union view, which can only be
 * too lenient, and the archive's own plan will surface the refusal by name.
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
