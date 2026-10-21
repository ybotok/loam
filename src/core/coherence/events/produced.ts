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
 * THE FLEET'S SENDERS ARE THE RETIREMENT GATE'S, read after the merge
 * (`fleetSendersAfter` below, which `./events.ts` calls too): a living
 * service's contract, except that a service this feature carries an event
 * delta for answers with what the merge leaves it (`declared.sentAfter`) and
 * nothing else. The consumer itself counts, as it does at service scope — a
 * relay that reads and writes one name produces it.
 *
 * THE OUTSIDE PRODUCER IS ASKED OF THE MAP THE MERGE LEAVES, and here the two
 * gates part on purpose. The retirement gate reads only the living map and
 * errs toward refusing a retirement (`./events.ts` says why). A consumer is the
 * opposite shape: its question is whether `validate --all` will find a
 * producer once the archive lands, and the landscape merge only ADDS — a
 * tagged `publishes` edge from an #external system is on that map. Reading
 * the delta alone was not enough, because a delta re-declares a living system
 * as an untagged stub (`salesforce = softwareSystem 'salesforce'`): the edge
 * lands, the living element keeps its #external tag, and the fleet is clean —
 * while a delta-only read saw no tag and refused. So the living map is asked
 * first (memoised, cheap), and only then the staged post-merge map
 * (`core/c4/project/staged.ts`, the archive's own merge), parsed once per
 * feature and only on the path where nothing else sends the message.
 *
 * THE SAME SUSPENSION. "Nobody sends this" is an argument from absence, and
 * service scope makes it only over a fleet whose every contract reads; one
 * unreadable `asyncapi.yaml` anywhere suspends it, because that file may be the
 * producer. A feature delta that does not read suspends it too — its own
 * `asyncapi.invalid` already gates — and so does a post-merge map that cannot
 * be staged: loam could not look, which is never "nobody publishes it".
 *
 * SOFTENED for a producer still in flight, on the `-pending` precedent every
 * other cross-feature join here follows: when another active feature's delta
 * declares the send, the message is "introduced by another feature still in
 * flight" — `spec-event.message-pending` for a requirement line, and
 * `c4-event.message-pending` for an edge. A warning, so two features meant to
 * ship together stay green while both are open, and its words say what the
 * wrong order costs.
 */
import type { LoadedDoc } from "../../c4/likec4.js";
import { stageMergedProject } from "../../c4/project/staged.js";
import { externalProducerOf } from "../../c4/resolve/external.js";
import { serviceResolver } from "../../c4/resolve/service.js";
import { extendingModels } from "../../c4/service-model/fleet/extending.js";
import type { Issue } from "../../vocabulary/issue.js";
import type { PathableService, RawServiceId } from "../../kernel/ids/service.js";
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

/**
 * The fleet services that would send `message` after this merge, sorted —
 * positive evidence only. A service this feature carries an event delta for
 * (or whose delta does not read) sends what the simulated merge leaves it and
 * nothing else; every other service sends what its living contract does. Read
 * alone, the living half would let a feature retiring a message from both of
 * its senders pass on each one's living contract.
 */
export async function fleetSendersAfter(declared: DeclaredEvents, consumers: ConsumerIndex, message: string): Promise<string[]> {
  const touched = new Set<string>([...declared.featureDocs.keys(), ...declared.unreadable]);
  const living = (await consumers.producers(message)).filter((id) => !touched.has(id));
  const merged = [...declared.sentAfter].filter(([, sent]) => sent.includes(message)).map(([id]) => id);
  return [...new Set([...living, ...merged])].sort();
}

/** Everything the producer question reads, already computed by `./events.ts`. */
export interface ProducedRequest {
  scope: EventDeltaScope;
  declared: DeclaredEvents;
  consumers: ConsumerIndex;
  lookups: EventLookups;
  claims: readonly ConsumeClaim[];
  /** The services the merge leaves a directory for — the enumerated fleet plus this feature's `specs/`. */
  known: ReadonlySet<RawServiceId>;
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
  // The post-merge map, staged at most once and only when the living answers
  // ran out; null when it cannot be had, which suspends rather than convicts.
  let staged: Promise<LoadedDoc | null> | undefined;
  const mergedMap = (): Promise<LoadedDoc | null> =>
    (staged ??= (async () => {
      const project = await stageMergedProject({
        ...scope,
        documents: [],
        ...(context === undefined ? {} : { load: (path: string) => context.loadLikeC4(path) }),
        models: await extendingModels(scope.docsDir, context),
      });
      return project.kind === "read" ? project.doc : null;
    })());
  /** true = sent; false = nothing sends it; undefined = loam could not look. */
  const produced = async (message: string): Promise<boolean | undefined> => {
    if ((await fleetSendersAfter(declared, consumers, message)).length > 0) return true;
    if ((await consumers.externalProducer(message)) !== null) return true;
    const map = await mergedMap();
    if (map === null) return undefined;
    return externalProducerOf(message, map, serviceResolver(map.elements, req.known), req.known) !== null;
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
  for (const [, claims] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [first] = claims;
    if (first === undefined) continue;
    const { service, message } = first;
    const sent = await produced(message);
    if (sent !== false) continue;
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
