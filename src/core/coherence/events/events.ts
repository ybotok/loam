/**
 * The event axis of the feature gate: do the C4 delta's tagged edges, the
 * requirement deltas' `Publishes:`/`Consumes:` lines, and the asyncapi
 * contracts agree about what each service puts on the wire?
 *
 * The package's orchestrator, called once from featureCoherence with the
 * delta facts it already holds (tagged relationships and the element
 * resolver): ./declared.ts walks the feature's own contracts and grades
 * what one service's pair of documents can settle; ./lookups.ts answers the
 * in-flight question lazily, and the consumer index (core/consumers/) who
 * still consumes a message; this module joins the three axes — the exact
 * shape coherence.ts gives the operation join, on the message name.
 *
 * A package of its own rather than lines in coherence.ts because that file
 * ran at its 300-line limit before the event axis existed; the seam is
 * real, not cosmetic — everything here joins on a message name, nothing
 * there does.
 */
import { type Rel } from "../../c4/likec4.js";
import { eventKeys, unboundSentence } from "../../c4/resolve/direction.js";
import { type PathableService, type RawServiceId } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { enumeratedServiceIndex } from "../../repo/service-target.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import { declaredEvents, type EventDeltaScope } from "./declared.js";
import { eventLookups } from "./lookups.js";
import type { RetiredLookup } from "../retired/archived.js";
import { revivedEvents } from "../retired/revival/revived.js";
import type { ConsumerIndex } from "../../consumers/consumers.js";
import { nothingStill, refusalDetails, refusalMessage, stillNamed, type StillNamed } from "../consumed/refusal.js";
import { fleetSendersAfter, unproducedIssues, type ConsumeClaim } from "./produced.js";

/** What featureCoherence hands the event axis — the delta facts it already computed. */
export interface EventCoherenceRequest {
  scope: EventDeltaScope;
  /** The services this feature's specs/ touch — the walk's subjects. */
  svcNames: PathableService[];
  /** The delta's tagged relationships — the edges the landscape merge would splice. */
  taggedRels: Rel[];
  /** The element→service resolver over the delta's elements plus the enumerated fleet. */
  svcOf: (id: string) => string;
  /** The infrastructure kind of a delta element or its ancestor (core/c4/resolve/direction.ts) — a key bound there is on the wrong end. */
  infraKindOf: (id: string) => string | undefined;
  context?: FleetContext;
  /** The retired index, shared with the contract axis so one call walks `features/archive/` once at most. */
  retired: RetiredLookup;
  /** The consumer index, read after this feature's merge — shared with the contract axis so the fleet is read once. */
  consumers: ConsumerIndex;
  /** The services the merge leaves a directory for — the enumerated fleet plus this feature's `specs/` (./produced.ts). */
  known: ReadonlySet<RawServiceId>;
}

export async function eventCoherence(request: EventCoherenceRequest): Promise<Issue[]> {
  const { scope, svcNames, taggedRels, svcOf, context, consumers } = request;
  const issues: Issue[] = [];
  const declared = await declaredEvents(scope, svcNames, issues, context);
  const lookups = eventLookups({ docsDir: scope.docsDir, featureId: scope.featureId }, context);

  // Who would still name a message after this merge: the consumer index's
  // consumers, and its `own` — the provider's own `Publishes:` lines as the
  // merge leaves them. That is the event twin of the overwrite's own-requirement
  // scan: a message re-keyed or no longer sent while the provider's living
  // requirement still says it `Publishes:` it archived at exit 0, and the next
  // `validate --all` reported `spec-event.message-undefined` against the
  // provider (review 2026-10-12, finding 3) — a REMOVED requirement justifies a
  // marker, but nothing asks a re-key or a turned-around operation for one.
  // A consumer document nobody could read or place refuses too, as on the
  // contract axis (../consumed/refusal.ts).
  //
  // But a CONSUMER is stranded only when nothing would send the message after
  // this merge — no service, and no #external element whose edge publishes it.
  // That is the rule `spine.message-unproduced` grades a consumer by — it stays
  // quiet over an outside producer (`externalProducerOf`,
  // core/c4/resolve/external.ts) — and the one `loam diff` asks first
  // (`producers`, then `externalProducer`, core/diff/semantic.ts).
  // Counting every consumer "whoever its producer is" refused a retirement from
  // one of two senders over the other sender's own consumes edge, and told the
  // author to drop it, while `loam diff` called the same removal a warning
  // ("still sent by …") and the next `validate --all` was clean (the
  // verification of the consumer fixes, N2). Counting the fleet's senders alone
  // then refused a retirement from a message's only fleet sender while an
  // #external element still published it, and `loam diff` called the archived
  // removal `diff.message-removed-consumed`, while the next `validate --all` was
  // clean again (the verification of N1–N3, D1). The provider's OWN documents are
  // another matter: the spine and validate grade them against the provider's
  // own contract, so they strand whoever else sends the message, and `own`
  // still refuses beside a surviving sender.
  //
  // The senders are asked of the MERGE, never of the living fleet alone:
  // `producers` reads the fleet as it stands, so a feature retiring the message
  // from both senders would let each one pass on the other's living contract.
  // A service this feature carries an event delta for sends what the
  // simulation leaves it (`declared.sentAfter`), or vouches for nothing; every
  // other service sends what its living contract does. Positive evidence only,
  // as `producers` is: an unreadable contract, or a merge that stood down,
  // never keeps a message produced. The outside producer is the living map's
  // edge and tag, which the landscape merge cannot take away (it only adds to
  // the map), asked over the directories the merge leaves: each `specs/<svc>/`
  // of this feature becomes a `services/<svc>/`, and a directory the #external
  // element resolves to outranks its tag, so a feature onboarding the outside
  // system as a service takes the producer away. Asked over the directories
  // as they stood, the gate passed that retirement while the next `loam diff`
  // reported `diff.message-removed-consumed` and `validate --all`
  // `spine.message-unproduced` (the verification of D1, X2). One this
  // feature's own C4 delta would draw is not counted, so that shape errs
  // toward refusing — `--approve`, or draw the edge in the living map. The
  // consumer check in ./produced.ts DOES count it, deliberately: there the
  // closed direction is the other one (that module says why), and the fleet
  // half of the senders is the one helper both read.
  const sendersAfter = async (svc: string, message: string): Promise<string[]> => {
    const fleet = (await fleetSendersAfter(declared, consumers, message)).filter((id) => id !== svc);
    const outside = await consumers.externalProducer(message);
    return outside === null ? fleet : [...fleet, `${outside} (#external)`];
  };
  const still = async (svc: string, message: string): Promise<{ found: StillNamed; senders: string[] }> => {
    const answer = await consumers.messageConsumers(svc, message);
    const senders = await sendersAfter(svc, message);
    return { senders, found: stillNamed(senders.length === 0 ? answer : { ...answer, victims: [], suspended: [] }) };
  };
  // The landscape merge only ADDS edges, so an edge is dropped in the living map
  // itself — a consumer's consumes edge, or the provider's own publishes edge,
  // which the spine grades on its source (`own`, core/consumers/consumers.ts).
  const route = `drop its consumes edge, or drop or redraw its publishes edge, in the architecture/ project, MODIFY or REMOVE the requirement whose Consumes:/Publishes: line names it in this feature's specs/<service>/ delta`;
  // With a sender left only the provider's own documents are named, so the
  // remedy is theirs alone — telling the author to drop a consumer's edge
  // there is the false route this gate used to give.
  const ownRoute = (svc: string): string =>
    `drop or redraw its publishes edge in the architecture/ project, or MODIFY or REMOVE the requirement whose Publishes: line names it in this feature's specs/${svc}/ delta`;
  const ownOnly = (svc: string, senders: string[]): string =>
    `${senders.join(", ")} would still send it after this merge, so its consumers keep a producer, but ${svc}'s own documents would still name it`;
  // The route a consumer's refusal gains: another sender keeps the message
  // produced, and one this feature adds counts (`declared.sentAfter`); so does
  // the #external element that publishes it, drawn in the living map — the one
  // place `sendersAfter` reads an outside producer from — unless this feature
  // makes it a service. The route says so: a feature onboarding the gateway is
  // told no #external element publishes the message while its living map
  // draws one doing exactly that, and the way out is the first route, the new
  // service's own send operation in its specs/<service>/ delta.
  const anotherSender =
    "keep another service sending it (an action: send operation in its asyncapi.yaml, living or in this feature's specs/<service>/ delta) or an #external element publishing it (a publishes edge from it in the living architecture/ project; one whose element this feature's specs/<service>/ makes a service no longer counts)";

  // Retiring a message the fleet still consumes — openapi.remove-op-consumed's
  // twin, and like it a question neither exactness nor justification asks:
  // the merge deletes the declaration while the consumes edge and the other
  // repo's requirement stay, so the next `validate --all` breaks on a
  // repository whose author was never in this feature.
  for (const [svc, net] of declared.netRemoved) {
    for (const message of net) {
      const { found, senders } = await still(svc, message);
      if (nothingStill(found)) continue;
      const lost = `this feature retires message '${message}'`;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-message-consumed",
        subject: svc,
        details: refusalDetails(found),
        message: refusalMessage(found, {
          subject: svc,
          lost,
          verb: "name",
          named: (list) =>
            senders.length === 0
              ? `${svc}: ${lost}, and no readable contract would still send it after this merge, nor does an #external element publish it, but the fleet would still name it — ${list}. Retire each in the same change (${route}), ${anotherSender}, or archive with --approve to break it deliberately.`
              : `${svc}: ${lost}; ${ownOnly(svc, senders)} — ${list}. Retire each in the same change (${ownRoute(svc)}), or archive with --approve to break it deliberately.`,
        }),
      });
    }
  }

  // The WIRE half of the same question: a channel or operation removal (or
  // an edit) can stop the service SENDING a message whose declaration
  // survives — the merge applies cleanly, and the next `validate --all`
  // breaks on the consumer's repository (spine.message-unproduced) exactly
  // as a deleted declaration would. Asked of the simulated merge's sent-set
  // diff; a name the net-removal loop above already asked keeps one finding.
  for (const [svc, stopped] of declared.stoppedSending) {
    const net = declared.netRemoved.get(svc);
    for (const message of stopped) {
      if (net?.has(message) === true) continue;
      const { found, senders } = await still(svc, message);
      if (nothingStill(found)) continue;
      const lost = `after this feature's merge, ${svc}'s asyncapi.yaml would no longer declare an action: send operation for '${message}'`;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-message-consumed",
        subject: svc,
        details: refusalDetails(found),
        message: refusalMessage(found, {
          subject: svc,
          lost,
          verb: "name",
          named: (list) =>
            senders.length === 0
              ? `${svc}: ${lost}, and no other readable contract would send it either, nor does an #external element publish it, but the fleet would still name it — ${list}. Keep an operation sending it, ${anotherSender}, retire each in the same change (${route}), or archive with --approve to break it deliberately.`
              : `${svc}: ${lost}; ${ownOnly(svc, senders)} — ${list}. Keep an operation sending it, retire each in the same change (${ownRoute(svc)}), or archive with --approve to break it deliberately.`,
        }),
      });
    }
  }

  // A revival: a slot or message this delta declares that the living
  // contract no longer has because an ARCHIVED feature retired it, or a
  // message name declared again at a key an archived feature took it out of
  // — the contract axis's `openapi.op-revived`, on the slot and the message
  // name (../retired/revival/revived.ts). Asked of the index only when the merged
  // contract declares something the living one does not.
  for (const [svc, arrived] of declared.revivalCandidates) {
    if (arrived.slots.length === 0 && arrived.messages.length === 0) continue;
    issues.push(...revivedEvents(svc, arrived, await request.retired()));
  }

  // Two features declaring one (service, message): both deltas apply
  // cleanly, so whichever archives second replaces the other's declaration
  // wholesale — delta.added-conflict's shape on the message join.
  for (const [svc, doc] of declared.featureDocs) {
    for (const m of doc.messages) {
      if (m.remove === true) continue;
      const other = await lookups.messageDefinedElsewhere(svc, m.name);
      if (other === undefined) continue;
      issues.push({
        severity: "warn",
        code: "asyncapi.message-conflict",
        subject: svc,
        message: `${svc}: this feature declares message '${m.name}', which in-flight ${other} also adds or edits — whichever archives second replaces the other's declaration wholesale; coordinate before either ships`,
      });
    }
  }

  // The bound service's contract as the feature would leave it. Where the
  // feature carries a delta over a readable living contract, that is the
  // SIMULATED merge (declared.mergedDocs): a slot the delta retires or edits
  // away stops answering here BEFORE archive — a leftover Publishes: line on
  // a surviving requirement used to pass this gate on living's say-so, then
  // break `validate --all` on the post-archive docs. Everywhere the
  // simulation has no answer — no delta for the service, a side that does
  // not read, a document the merge refuses — the feature ∪ living union
  // stands in, which can only be too lenient, never wrongly red; the living
  // side is read lazily per service, since an edge may bind a service the
  // feature carries no specs/ directory for.
  const livingDocs = new Map<PathableService, AsyncapiDoc>();
  const livingOf = async (svc: PathableService): Promise<AsyncapiDoc> => {
    let doc = livingDocs.get(svc);
    if (doc === undefined) {
      doc = await readAsyncapi((await locateServicePaths(scope.docsDir, svc, context)).asyncapi, context);
      livingDocs.set(svc, doc);
    }
    return doc;
  };
  // undefined = no verdict: an unreadable LIVING contract proves nothing
  // about the message (validate's asyncapi.invalid owns that file), and
  // grading against its empty parse would blame every edge for one broken
  // document.
  const declares = async (
    svc: PathableService,
    direction: "publishes" | "consumes",
    message: string,
  ): Promise<boolean | undefined> => {
    const merged = declared.mergedDocs.get(svc);
    if (merged !== undefined) {
      return direction === "publishes" ? merged.sent.includes(message) : merged.received.includes(message);
    }
    const living = await livingOf(svc);
    if (living.unreadable) return undefined;
    const feat = declared.featureDocs.get(svc);
    return direction === "publishes"
      ? living.sent.includes(message) || (feat?.sent.includes(message) ?? false)
      : living.received.includes(message) || (feat?.received.includes(message) ?? false);
  };
  const action = (direction: "publishes" | "consumes"): string => (direction === "publishes" ? "send" : "receive");

  // The declared→enumerated bridge coherence.ts uses for op edges, for the
  // same reason: every lookup below joins into services/<id>/ or the
  // feature's own specs/. A bound element NEITHER knows is skipped rather
  // than graded — an #external producer is the documented shape for a
  // message produced outside the fleet (spine.message-external), so grading
  // its edge against an absent service directory would turn the worked
  // example red.
  const enumeratedTarget = enumeratedServiceIndex(scope.docsDir, svcNames, context);

  // Tagged edges: `publishes` binds the edge's SOURCE, `consumes` its
  // TARGET — the same reading validate's event spine takes of the living
  // landscape, applied to the delta, from the one statement of the rule
  // (core/c4/resolve/direction.ts).
  // Every consumption this merge would add, collected as the two loops below
  // walk the edges and the lines, and asked for a producer at the end
  // (./produced.ts) — `spine.message-unproduced` at feature scope.
  const claims: ConsumeClaim[] = [];
  for (const r of taggedRels) {
    const edge = `${svcOf(r.source)} → ${svcOf(r.target)}`;
    for (const key of eventKeys(r)) {
      const b = { direction: key.direction, message: key.message, name: svcOf(key.bound), edge };
      const pathable = await enumeratedTarget(b.name);
      if (pathable === undefined) {
        // The skip above, unless the key is bound to infrastructure and a
        // service sits at the OTHER end: then it is on the wrong end of its
        // edge and binds nothing, which the living spine reports under the
        // same code once this delta merges. An `#external` system at the bound
        // end is an outside producer or consumer, and stays skipped.
        const kind = request.infraKindOf(key.bound);
        const drawer = kind === undefined ? undefined : await enumeratedTarget(svcOf(key.other));
        if (kind !== undefined && drawer !== undefined) {
          issues.push({ severity: "warn", code: "spine.message-unbound", subject: drawer, message: `delta ${unboundSentence(r, key, kind)}` });
        }
        continue;
      }
      // asyncapi.invalid already gates; one breach, one finding.
      if (declared.unreadable.has(pathable)) continue;
      if (b.direction === "consumes") claims.push({ service: pathable, message: b.message, source: "edge", via: `edge ${b.edge}` });
      const ok = await declares(pathable, b.direction, b.message);
      if (ok !== false) continue;
      const other = await lookups.messageDefinedElsewhere(pathable, b.message);
      if (other !== undefined) {
        issues.push({
          severity: "warn",
          code: "c4-event.message-pending",
          message: `edge ${b.edge} ${b.direction} '${b.message}', defined by in-flight ${other} — archive it first`,
        });
      } else {
        issues.push({
          severity: "error",
          code: "c4-event.message-undefined",
          message: `edge ${b.edge} ${b.direction} '${b.message}', but ${b.name}'s asyncapi contract (feature and living alike) declares no operation with action: ${action(b.direction)} for it`,
        });
      }
    }
  }

  // The requirement deltas' own lines, graded the same way — the same
  // sentence validate gives the living-side breach, under the same code, so
  // one breach keeps one name across scopes. The lines were read once by
  // ./declared.ts's walk (declared.links); re-reading them here per service
  // was a second parse of both spec files on the context-less archive path.
  for (const svc of svcNames) {
    if (declared.unreadable.has(svc)) continue;
    for (const link of declared.links.get(svc) ?? []) {
      if (link.direction === "consumes") {
        claims.push({ service: svc, message: link.message, source: "requirement", via: `requirement '${link.requirement}'` });
      }
      const ok = await declares(svc, link.direction, link.message);
      if (ok !== false) continue;
      const other = await lookups.messageDefinedElsewhere(svc, link.message);
      if (other !== undefined) {
        issues.push({
          severity: "warn",
          code: "spec-event.message-pending",
          subject: svc,
          message: `${svc}: requirement '${link.requirement}' ${link.direction} '${link.message}', defined by in-flight ${other} — archive it first`,
        });
      } else {
        issues.push({
          severity: "error",
          code: "spec-event.message-undefined",
          subject: svc,
          message: `${svc}: requirement '${link.requirement}' ${link.direction} '${link.message}', but ${svc}'s asyncapi.yaml declares no operation with action: ${action(link.direction)} for it`,
        });
      }
    }
  }

  issues.push(...(await unproducedIssues({ scope, declared, consumers, lookups, claims, known: request.known, ...(context === undefined ? {} : { context }) })));
  return issues;
}
