/**
 * The contract axis's removal gate, `openapi.remove-op-consumed`: does the
 * fleet still consume an operation this feature takes out of the contract —
 * by a removal marker, or by defining another operation where it lives?
 *
 * Moved out of `../coherence.ts`, which ran at its 400-line limit, along the
 * seam the gate already had there: everything below asks the consumer index
 * (core/consumers/) one question per operation the merge loses and phrases
 * the refusal, and nothing else in featureCoherence reads its answer. The
 * index itself is built there and handed in, because the event axis's twin
 * (`asyncapi.remove-message-consumed`, ../events/events.ts) asks the same one.
 */
import type { Issue } from "../../vocabulary/issue.js";
import type { ConsumerIndex } from "../../consumers/consumers.js";
import type { Declared } from "../declared.js";

/** What the gate is asked over: the shared index, and the two ways this feature's merge loses an operation. */
export interface ConsumedOperationsRequest {
  /** The consumer index, read after this feature's merge — shared with the event axis so the fleet is read once. */
  consumers: ConsumerIndex;
  removingOps: Declared["removingOps"];
  displacedOps: Declared["displacedOps"];
}

export async function consumedOperationIssues(request: ConsumedOperationsRequest): Promise<Issue[]> {
  const { consumers, removingOps, displacedOps } = request;
  const issues: Issue[] = [];
  // --- taking an operation out of the contract while the fleet still calls it ---
  // Exactness and justification never ask what matters to the other
  // ninety-nine repos: is anybody still calling it? The merge deletes the
  // operation while the edge, the requirement and the use-case hop naming it
  // stay, so the next `validate --all` breaks a repository whose author was
  // never in this feature. Asked of the ONE consumer index, read after this
  // feature's merge (core/consumers/ says what it reads and what a feature can
  // retire). `own` counts too: for a marker the REMOVED requirement leaves with
  // the merge, so what remains is a second one, or an internal edge. One index
  // for both shapes and the event axis, so the fleet is read once.
  const still = async (svc: string, op: string): Promise<string[]> => {
    const found = await consumers.opConsumers(svc, op);
    return [...found.victims, ...found.own];
  };
  // The landscape merge only ADDS edges, so an edge is dropped or redrawn in the living map itself.
  const route = `drop or redraw its edge in the architecture/ project, MODIFY or REMOVE the requirement that names it in this feature's specs/<service>/ delta`;
  for (const [svc, retiring] of removingOps) {
    for (const op of retiring) {
      const named = await still(svc, op);
      if (named.length === 0) continue;
      issues.push({
        severity: "error",
        code: "openapi.remove-op-consumed",
        subject: svc,
        details: named,
        message: `${svc}: this feature retires '${op}', but the fleet would still consume it after this merge — ${named.join("; ")}. Retire each consumer in the same change (${route}), or archive with --approve to break it deliberately.`,
      });
    }
  }

  // The same loss with no marker to read: another operation defined where a
  // consumed one lives replaces it there, and once the contract the merge
  // would write defines it nowhere it has left the contract exactly as a
  // retirement does. One code, because the breach and its override are the
  // removal's — only `api.op-unconsumed` (advisory) said anything before, and
  // the archive passed without `--approve`. With no marker there is no REMOVED
  // requirement either, so the provider's own requirement naming the old id
  // stays unless this feature restates it — `own` is what catches it.
  for (const [svc, displaced] of displacedOps) {
    for (const { id: op, at } of displaced) {
      const named = await still(svc, op);
      if (named.length === 0) continue;
      const by = at.map(({ address, by: id }) => `${id === undefined ? "an operation with no operationId" : `'${id}'`} at ${address}`).join(" and ");
      issues.push({
        severity: "error",
        code: "openapi.remove-op-consumed",
        subject: svc,
        details: named,
        message: `${svc}: this feature's openapi.yaml defines ${by}, where '${op}' lives now — the merge replaces it there and would leave '${op}' defined nowhere, but it is still consumed — ${named.join("; ")}. Define '${op}' at another address in this delta if it is to stay. To take it out on purpose, update every consumer in the same change — ${route} (${svc}'s own restated to name the new operation, for a rename; a REMOVED one owes no x-loam-remove marker, since the overwrite already takes '${op}' out) — or archive with --approve to break it deliberately.`,
      });
    }
  }
  return issues;
}
