/**
 * The contract as the feature would leave it: the REAL merge
 * (core/asyncapi/merge/merge.ts, core/openapi/merge/merge.ts) run over the
 * two texts and read back, nothing written. On the event axis one simulation
 * feeds three gate questions — the `declares()` join in ../events/events.ts
 * (a retired or edited-away send must stop answering "the service declares
 * this" BEFORE archive, or a leftover `Publishes:` line passes the gate and
 * breaks the post-archive fleet), the consumer gate's wire half (a channel or
 * operation removal that stops the service SENDING a message the fleet still
 * consumes), and the revival check (./revived.ts) — which asks it on both
 * axes: where does each operationId and message name stand once the delta
 * merges, against where it stands now.
 *
 * Calling the merge rather than re-deriving its verdicts is the point: a
 * second spelling of quote/edit/removal here would eventually disagree with
 * the merge about what archive actually writes, and the gate would be
 * promising a contract the archive does not produce. The revival check is
 * the proof: it re-derived the merge case by case — a relocation marker
 * anywhere, a swap by a named operation, a channel restated with a `$ref` —
 * and every review found a shape the derivation missed (a marker at an
 * address the id never lived at, a replacement with no operationId).
 *
 * A living contract that does not exist is the archive's CREATE branch: it
 * writes the delta with its markers stripped, and that is what the merged
 * contract is.
 */
import { parse } from "yaml";
import { asyncapiDocOf } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import { AsyncapiMergeError } from "../../asyncapi/merge/error.js";
import { stripAsyncapiMarkers } from "../../asyncapi/merge/markers.js";
import { mergeAsyncapiSlots } from "../../asyncapi/merge/merge.js";
import { openapiFromText, type OpenapiDoc } from "../../openapi/doc.js";
import { OpenapiMergeError } from "../../openapi/merge/error.js";
import { stripOpenapiRemovalMarkers } from "../../openapi/merge/markers.js";
import { mergeOpenapiPaths } from "../../openapi/merge/merge.js";

/** The two texts the simulation merges, plus the living side's existing parse. */
export interface MergeSimulationInput<Doc> {
  /** undefined when no living contract exists — the archive then creates one from the delta. */
  livingText: string | undefined;
  /** The reader's parse of livingText — reused verbatim when the merge writes nothing. */
  livingDoc: Doc;
  featureText: string;
  service: string;
}

/**
 * Simulate the archive-time event merge, or stand down. Both documents are
 * known readable here (the pair, ./event-pair.ts, asks only with the delta's
 * text in hand and a living side that answers — readable, or absent — and
 * both of its readers, the walk in ../events/declared.ts and rebase's
 * `serviceRevivals`, refuse an unreadable delta first), so the only
 * refusals left are the merge's own judgement calls — an aliased section, a
 * section spelling one slot key twice. `undefined` on those rather than a
 * throw: the walk falls back to the feature ∪ living union view, which can
 * only be too lenient, the revival check grades no message, and the
 * archive's own plan surfaces the refusal by name — a refusal `--approve`
 * cannot pass, so nothing it would have graded can land.
 */
export function mergedAsyncapiDoc(input: MergeSimulationInput<AsyncapiDoc>): AsyncapiDoc | undefined {
  const { livingText, livingDoc, featureText, service } = input;
  try {
    if (livingText === undefined) return asyncapiDocOf(parse(stripAsyncapiMarkers(featureText, service)));
    const out = mergeAsyncapiSlots(livingText, featureText, service);
    return out.text === null ? livingDoc : asyncapiDocOf(parse(out.text));
  } catch (error) {
    if (error instanceof AsyncapiMergeError) return undefined;
    throw error;
  }
}

/** The OpenAPI twin, through the same function archive's plan calls — `undefined` where that merge refuses. */
export function mergedOpenapiDoc(input: MergeSimulationInput<OpenapiDoc>): OpenapiDoc | undefined {
  const { livingText, livingDoc, featureText, service } = input;
  try {
    if (livingText === undefined) return openapiFromText(stripOpenapiRemovalMarkers(featureText, service));
    const out = mergeOpenapiPaths(livingText, featureText, service);
    return out.text === null ? livingDoc : openapiFromText(out.text);
  } catch (error) {
    if (error instanceof OpenapiMergeError) return undefined;
    throw error;
  }
}
