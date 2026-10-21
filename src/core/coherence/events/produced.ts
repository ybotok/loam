/**
 * Does anything still SEND what this feature makes a service consume?
 *
 * `spine.message-unproduced` asked at feature scope — the question validate's
 * service target asks of every living consumer
 * (`commands/validate/service/events/message-producers.ts`), asked here of the
 * consumers this feature's merge would ADD. Until it was, a feature whose
 * delta newly `Consumes:` (or draws a `consumes` edge into) a message no
 * service and no #external element sends passed the feature gate, archived at
 * exit 0 under "living spec + landscape are now complete + current.", and the
 * very next `validate --all` reported the error against the consumer
 * (the real-fleet review, 2026-10-21). `./events.ts` had already computed who
 * sends a message after the merge — for retirements only.
 *
 * THE SAME THREE SOURCES OF A PRODUCER, read after the merge, that the
 * retirement gate in `./events.ts` reads: a living service's contract (a
 * service this feature carries an event delta for answers with what the merge
 * leaves it, `declared.sentAfter`, and nothing else), and an #external element
 * whose `publishes` edge sends it. The external one is asked of the living map
 * over the directories the merge leaves (`ConsumerIndex.externalProducer`) AND
 * of this feature's own delta, because the landscape merge only adds: an
 * #external publisher the delta draws is on the map the next `validate --all`
 * reads. The consumer itself counts as a sender, as it does at service scope —
 * a relay that reads and writes one name produces it.
 *
 * THE SAME SUSPENSION. "Nobody sends this" is an argument from absence, and
 * service scope makes it only over a fleet whose every contract reads; one
 * unreadable `asyncapi.yaml` anywhere suspends it, because that file may be the
 * producer. A feature delta that does not read suspends it too — its own
 * `asyncapi.invalid` already gates.
 *
 * SOFTENED for a producer still in flight, on the `-pending` precedent every
 * other cross-feature join here follows: when another active feature's delta
 * declares the send, the message is "introduced by another feature still in
 * flight" — `spec-event.message-pending` for a requirement line, and
 * `c4-event.message-pending` for an edge. A warning, so two features meant to
 * ship together stay green while both are open, and its words say what the
 * wrong order costs.
 */
import type { Issue } from "../../vocabulary/issue.js";
import type { PathableService } from "../../kernel/ids/service.js";
import { enumeratedServiceIds } from "../../repo/service-target.js";
import { producersByMessage } from "../../asyncapi/producers.js";
import type { FleetContext } from "../../fleet-context.js";
import type { ConsumerIndex } from "../../consumers/consumers.js";
import type { DeclaredEvents, EventDeltaScope } from "./declared.js";
import type { EventLookups } from "./lookups.js";

/** One place this feature's delta makes a service consume a message. */
export interface ConsumeClaim {
  service: PathableService;
  message: string;
  /** Which document says so — a requirement's `Consumes:` line, or a tagged `consumes` edge. */
  source: "requirement" | "edge";
  /** How a reader finds it: `requirement 'X'`, or `edge a → b`. */
  via: string;
}

/** Everything the producer question reads, already computed by `./events.ts`. */
export interface ProducedRequest {
  scope: EventDeltaScope;
  declared: DeclaredEvents;
  consumers: ConsumerIndex;
  lookups: EventLookups;
  claims: readonly ConsumeClaim[];
  /** The #external element this feature's own delta draws publishing `message`, or null. */
  deltaExternal: (message: string) => string | null;
  context?: FleetContext;
}

export async function unproducedIssues(req: ProducedRequest): Promise<Issue[]> {
  const { scope, declared, consumers, lookups, context } = req;
  if (req.claims.length === 0) return [];
  // One finding per (consumer, message), however many lines and edges claim
  // it — the grain service scope reports at, so the two counts agree.
  const groups = new Map<string, ConsumeClaim[]>();
  for (const claim of req.claims) {
    const key = JSON.stringify([claim.service, claim.message]);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const touched = new Set<string>([...declared.featureDocs.keys(), ...declared.unreadable]);
  const produced = async (message: string): Promise<boolean> => {
    if ((await consumers.producers(message)).some((id) => !touched.has(id))) return true;
    if ([...declared.sentAfter.values()].some((sent) => sent.includes(message))) return true;
    return (await consumers.externalProducer(message)) !== null || req.deltaExternal(message) !== null;
  };
  // Read only once some consumer has no producer, which a healthy feature
  // never reaches: the fleet's contracts are already behind the consumer
  // index's memo, but this read is a plain one (it is the walk service scope
  // suspends on, and must be the same one).
  let suspended: Promise<boolean> | undefined;
  const doubt = (): Promise<boolean> =>
    (suspended ??= (async () =>
      declared.unreadable.size > 0 ||
      (await producersByMessage(scope.docsDir, await enumeratedServiceIds(scope.docsDir, context), context)).unreadable.length >
        0)());

  const issues: Issue[] = [];
  for (const key of [...groups.keys()].sort()) {
    const claims = groups.get(key)!;
    const { service, message } = claims[0]!;
    if (await produced(message)) continue;
    if (await doubt()) continue;
    const where = claims.map((c) => c.via).join(", ");
    const pending = await lookups.messageSentElsewhere(message);
    if (pending !== undefined) {
      issues.push({
        severity: "warn",
        code: claims.some((c) => c.source === "requirement") ? "spec-event.message-pending" : "c4-event.message-pending",
        subject: service,
        message:
          `${service}: ${where} consumes '${message}', whose only sender is in-flight ${pending} — archive it first: ` +
          `archived before it, this feature leaves '${message}' with no producer and the next \`loam validate --all\` ` +
          `reports spine.message-unproduced against ${service}`,
      });
      continue;
    }
    issues.push({
      severity: "error",
      code: "spine.message-unproduced",
      subject: service,
      message:
        `${service}: ${where} consumes '${message}', but after this merge no service in the fleet and no #external ` +
        `element would declare it is sent — the message would have no producer anywhere, and the next ` +
        `\`loam validate --all\` reports this same code against ${service}. Add the producer's send (an action: send ` +
        `operation in its asyncapi.yaml, living or in this feature's specs/<service>/ delta), draw the #external ` +
        `system publishing it (a publishes edge from an #external element), or drop the consumption from this feature`,
    });
  }
  return issues;
}
