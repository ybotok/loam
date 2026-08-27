/**
 * The fleet question the event axis asks: who produces what this service
 * consumes. Split out of `./events.js` along the seam its own header always
 * named — the local axis grades one service's files, while this is the only
 * check on either spine that reads OTHER services' contracts, and the two
 * subjects share nothing but the consumed-message list the axis hands over.
 */
import { type DeclaredService, type PathableService, type RawServiceId } from "../../../../core/kernel/ids/service.js";
import { type LoadedDoc } from "../../../../core/c4/likec4.js";
import { type Finding } from "../../../../core/vocabulary/report.js";
import { producersByMessage } from "../../../../core/asyncapi/producers.js";
import { type AsyncapiDoc } from "../../../../core/asyncapi/model.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import { externalProducerOf } from "../../checks/fleet-shape.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";

/**
 * What the producer question is asked over. One record rather than a parameter
 * list: everything here is already bound together as one service's view of the
 * fleet, and the 4-parameter limit says so too.
 */
export interface ProducerQuestion {
  docsDir: DocsDir;
  service: PathableService;
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /** Its element→service resolver; null exactly when `land` is. */
  landSvcOf: ((id: string) => DeclaredService) | null;
  /** Service directories that exist — the fleet the producer question is asked over. */
  known: ReadonlySet<RawServiceId>;
  /** This service's own parsed contract — the local-shape half of the external answer. */
  events: AsyncapiDoc;
  /** The deduped message names this service consumes, from edges and requirement lines alike. */
  consumed: readonly string[];
  fleet?: FleetContext;
}

// The fleet question, and the one check on either spine that a single
// repository cannot answer: a consumer joins to a message whose schema lives
// in the producer's contract, in the producer's repo. Paid only when something
// actually consumes — a fleet where nobody has adopted the axis walks nothing.
export async function producerFindings(input: ProducerQuestion): Promise<Finding[]> {
  const { docsDir, service, land, landSvcOf, known, events, consumed, fleet } = input;
  const findings: Finding[] = [];
  if (consumed.length === 0) return findings;
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
  return findings;
}
