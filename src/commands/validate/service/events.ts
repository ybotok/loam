/**
 * The async contract axis — AsyncAPI messages on the landscape spine.
 *
 * The HTTP spine (`./spine.js`) and this one are mirror images, and the mirror
 * is the whole reason this is a second axis rather than a second `metadata`
 * key. On the HTTP axis the PROVIDER owns the contract: an edge names an
 * operation and the target's openapi.yaml settles it, locally, in one file.
 * Here the PRODUCER owns the message and the consumer joins to it from another
 * repository — so "is this message declared" is local, while "does anybody
 * publish it" is a fleet question with no local answer at all. That second
 * question is the only check on either spine that reads other services'
 * contracts, and it is paid for only when something actually consumes.
 */
import { existsSync } from "node:fs";
import {
  type DeclaredService,
  type PathableService,
  type RawServiceId,
} from "../../../core/kernel/ids.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type ServicePaths } from "../../../core/repo/paths.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { type Requirement } from "../../../core/document/spec.js";
import { producersByMessage } from "../../../core/asyncapi/producers.js";
import { readAsyncapi, slotsOf } from "../../../core/asyncapi/read.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { externalProducerOf } from "../checks/fleet-shape.js";

/** What the service target hands the event axis. */
export interface EventAxis {
  docsDir: string;
  service: PathableService;
  /** `service` widened for `===` against the resolver's DOCUMENT text — see service.ts. */
  me: string;
  paths: ServicePaths;
  /** Every requirement the living spec declares; `event.messages-unlinked` counts what is written. */
  reqs: Requirement[];
  /** The ones that still govern something — a REMOVED requirement links nothing. */
  livingReqs: Requirement[];
  /** arch.spec.md's requirements, which carry as many event links as spec.md's do. */
  archReqs: Requirement[];
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /** Its element→service resolver; null exactly when `land` is. */
  landSvcOf: ((id: string) => DeclaredService) | null;
  /** Service directories that exist — the fleet the producer question is asked over. */
  known: ReadonlySet<RawServiceId>;
  fleet?: FleetContext;
}

export async function eventAxisFindings(axis: EventAxis): Promise<Finding[]> {
  const { docsDir, service, me, paths, reqs, livingReqs, archReqs, land, landSvcOf, known, fleet } =
    axis;
  const findings: Finding[] = [];

  // Where this axis started, so the closing ok-finding can be "nothing here
  // broke" rather than a second, independently-computed claim about the same
  // facts. A positive finding derived from the same walk cannot disagree with it.
  const eventFindingsAt = findings.length;
  const events = await readAsyncapi(paths.asyncapi, fleet);
  const sentHere = new Set(events.sent);
  const receivedHere = new Set(events.received);

  // Every edge that binds THIS service to a message: `publishes` binds the
  // edge's source (a service produces what it declares an `action: send` for),
  // `consumes` binds its target. One edge may legitimately carry both — a relay
  // that reads one topic and writes another is a single arrow in most fleet maps.
  const eventEdges =
    land === null || land.errors.length > 0
      ? []
      : land.relationships.flatMap((r) => {
          const bound: { direction: "publishes" | "consumes"; message: string; other: string }[] = [];
          if (r.publishes !== undefined && landSvcOf!(r.source) === me) {
            bound.push({ direction: "publishes", message: r.publishes, other: landSvcOf!(r.target) });
          }
          if (r.consumes !== undefined && landSvcOf!(r.target) === me) {
            bound.push({ direction: "consumes", message: r.consumes, other: landSvcOf!(r.source) });
          }
          return bound;
        });
  // Both requirement namespaces, and a REMOVED requirement links nothing —
  // the `livingReqs` rule the API axis already follows, applied to the pair.
  const eventLinks = [...livingReqs, ...archReqs.filter((r) => r.kind !== "REMOVED")].flatMap((r) => [
    ...r.publishes.map((m) => ({ direction: "publishes" as const, message: m, requirement: r.name })),
    ...r.consumes.map((m) => ({ direction: "consumes" as const, message: m, requirement: r.name })),
  ]);

  if (!existsSync(paths.asyncapi)) {
    // Deliberately TWO grades, not the three `service.no-openapi` uses. Its
    // middle grade — warn when the landscape cannot prove nobody calls this
    // service — rests on HTTP being the default: most services expose one, so
    // "I could not look" is worth saying. An event contract is genuinely
    // optional; most services in a legacy fleet touch no topic at all. Warning
    // every one of them the moment a landscape fails to parse would put a
    // finding on the whole fleet that names a file nobody owes.
    //
    // So: something already joins into the absent file, or silence.
    const dangling = [
      ...new Set([...eventEdges.map((e) => e.message), ...eventLinks.map((e) => e.message)]),
    ].sort();
    if (dangling.length > 0) {
      findings.push({
        severity: "error",
        code: "service.no-asyncapi",
        subject: service,
        message:
          `No async contract at ${paths.asyncapi}, and ${dangling.length} message link(s) already point into it — ` +
          `every landscape edge and requirement naming one of them resolves to nothing until the file is back`,
        details: dangling,
      });
    }
  } else if (events.unreadable) {
    // The openapi.invalid discipline: a contract that EXISTS but does not read
    // is a broken source of truth, not an empty one. Grading the links against
    // an empty message set would turn one file into one `spine.message-undefined`
    // per edge, every one of them pointing at the landscape.
    findings.push({
      severity: "error",
      code: "asyncapi.invalid",
      subject: service,
      message: `${service}: asyncapi.yaml does not parse — the event spine is unchecked for this service`,
      ...(events.error === undefined ? {} : { details: [events.error] }),
    });
  } else {
    for (const name of events.duplicateNames) {
      findings.push({
        severity: "warn",
        code: "asyncapi.duplicate-message",
        subject: service,
        message: `${service}: asyncapi.yaml declares message '${name}' in ${slotsOf(events, name).join(" and ")} — every join on the name (an edge's metadata { publishes }, a requirement's Publishes: line) picks one of those slots arbitrarily`,
      });
    }
    // The contract-depth probes. Form validated and depth did not: a payload
    // of bare `type: object` and a `$ref` to nothing both read as cleanly as
    // a full schema, while a reader still cannot rebuild the payload from the
    // green contract. Presence probes only — a non-JSON schemaFormat
    // is skipped, so Avro stays a document change.
    const empties = events.messages.filter((m) => m.payloadEmpty === true).map((m) => m.name);
    if (empties.length > 0) {
      findings.push({
        severity: "warn",
        code: "asyncapi.payload-undescribed",
        subject: service,
        message:
          `${service}: ${empties.length} message(s) declare no payload shape (${empties.join(", ")}) — ` +
          `the name joins the spine, but nothing defines what a consumer would read; ` +
          `declare properties, or a schemaFormat for a non-JSON schema`,
      });
    }
    if (events.danglingRefs.length > 0) {
      findings.push({
        severity: "warn",
        code: "asyncapi.ref-unresolved",
        subject: service,
        message:
          `${service}: asyncapi.yaml contains ${events.danglingRefs.length} internal $ref(s) that resolve ` +
          `to nothing in the document — whatever they were meant to carry is silently absent from the ` +
          `spine's view of this contract`,
        details: events.danglingRefs,
      });
    }
    // Local resolution, both directions and both sources of a claim. An edge and
    // a requirement making the same broken claim get the same sentence under
    // different codes, matching how `spine.op-undefined` and
    // `spec-api.op-undefined` split the HTTP axis: one is the fleet map's
    // mistake, the other is this document's, and the fix is in a different file.
    const declares = (direction: "publishes" | "consumes", message: string): boolean =>
      direction === "publishes" ? sentHere.has(message) : receivedHere.has(message);
    const action = (direction: "publishes" | "consumes"): string =>
      direction === "publishes" ? "send" : "receive";
    for (const e of eventEdges) {
      if (declares(e.direction, e.message)) continue;
      findings.push({
        severity: "error",
        code: "spine.message-undefined",
        subject: service,
        message:
          `${service}: landscape edge ${e.direction === "publishes" ? `${service} → ${e.other}` : `${e.other} → ${service}`} ` +
          `${e.direction} '${e.message}', but ${service}'s asyncapi.yaml declares no operation with action: ${action(e.direction)} for it`,
      });
    }
    for (const e of eventLinks) {
      if (declares(e.direction, e.message)) continue;
      findings.push({
        severity: "error",
        code: "spec-event.message-undefined",
        subject: service,
        message: `${service}: requirement '${e.requirement}' ${e.direction} '${e.message}', but ${service}'s asyncapi.yaml declares no operation with action: ${action(e.direction)} for it`,
      });
    }
    // The migration-debt case, `api.ops-unlinked`'s twin: a contract and
    // requirements that never name each other leave this axis vacuously green.
    if (events.messages.length > 0 && reqs.length + archReqs.length > 0 && eventLinks.length === 0) {
      findings.push({
        severity: "warn",
        code: "event.messages-unlinked",
        subject: service,
        message: `${service}: asyncapi.yaml declares ${events.messages.length} message(s) but no requirement links any — the event axis is unchecked for this service`,
      });
    }
  }

  // The fleet question, and the one check on either spine that a single
  // repository cannot answer: a consumer joins to a message whose schema lives
  // in the producer's contract, in the producer's repo. Paid only when something
  // actually consumes — a fleet where nobody has adopted the axis walks nothing.
  const consumed = [
    ...new Set([
      ...eventEdges.filter((e) => e.direction === "consumes").map((e) => e.message),
      ...eventLinks.filter((e) => e.direction === "consumes").map((e) => e.message),
    ]),
  ].sort();
  if (consumed.length > 0) {
    const producers = await producersByMessage(docsDir, [...known], fleet);
    for (const message of consumed) {
      const who = producers.byMessage.get(message) ?? [];
      // "Nobody produces this" is an argument from absence, and it is only
      // sound over a fleet loam could actually read. One unreadable contract
      // anywhere suspends it — that service may be the producer, and the
      // alternative is blaming every consumer for somebody else's broken YAML.
      // The external answer and the contested answer below rest on positive
      // evidence and need no such guard.
      if (who.length === 0) {
        // A message produced OUTSIDE the fleet used to be inexpressible: the
        // landscape said the producer was #external, and this error fired
        // anyway — so honesty cost a red build, and the exit ramp people took
        // was deleting the link. The landscape already carries the answer; an
        // external producer shifts the contract question to the one file that
        // can settle it, this service's own asyncapi.yaml.
        const ext = externalProducerOf(message, land, landSvcOf, known);
        if (ext !== null) {
          const local = events.messages.find((m) => m.name === message);
          if (local === undefined || local.payloadEmpty === true) {
            findings.push({
              severity: "warn",
              code: "spine.message-external",
              subject: service,
              message:
                `${service}: consumes '${message}' from '${ext}', a system outside the fleet — the ` +
                `producer declares no contract here, so the only payload definition is this service's ` +
                `own asyncapi.yaml, and it currently defines no shape for it; declare the message with ` +
                `its payload`,
            });
          }
          // A carried contract closes the question: the landscape states the
          // external dependency, the consumer owns the schema — nothing to say.
        } else if (producers.unreadable.length === 0) {
          findings.push({
            severity: "error",
            code: "spine.message-unproduced",
            subject: service,
            message: `${service}: consumes '${message}', but no service in the fleet and no #external element declares it is sent — the message has no producer anywhere, so nothing defines its payload`,
          });
        }
      } else if (who.length > 1) {
        findings.push({
          severity: "warn",
          code: "asyncapi.message-contested",
          subject: service,
          message: `${service}: consumes '${message}', which ${who.length} services declare they send (${who.join(", ")}) — every consumer's join picks one of them arbitrarily, so the payload this service reads is whichever one happens to win`,
        });
      }
    }
  }

  // Positive confirmation, on the same rule `spine.resolved` follows: claimed
  // only where the axis actually checked something. A service that touches no
  // topic says nothing here — an "event axis clean" on every worker in the fleet
  // would be a green tick for work nobody did.
  const eventChecks = eventEdges.length + eventLinks.length;
  if (eventChecks > 0 && findings.length === eventFindingsAt) {
    findings.push({
      severity: "ok",
      code: "event.covered",
      message: `${service}: event spine (${eventChecks} message link(s) resolve to asyncapi.yaml)`,
    });
  }

  return findings;
}
