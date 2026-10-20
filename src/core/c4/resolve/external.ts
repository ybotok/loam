/**
 * The producer OUTSIDE the fleet: the `#external` element the map says sends a
 * message no `services/<id>/` directory stands for.
 *
 * It sits in this package for `./attested.ts`'s reason: it is a question about
 * the RESOLVED model — which endpoint of a `publishes` edge belongs to no
 * service — and `serviceResolver` beside it is the one answer every join gives
 * to that. It moved here from `commands/validate/checks/fleet-shape.ts`, where it
 * sat beside the other checks that read tags off the drawn map, when a second
 * reader needed the same answer: the consumer index (`core/consumers/`), which a
 * `commands/` module can never be imported by.
 */
import { type LoadedDoc } from "../likec4.js";
import { type DeclaredService, type RawServiceId } from "../../kernel/ids/service.js";
import { EXTERNAL_TAG } from "../../vocabulary/maturity.js";

/**
 * The #external element that declares it PUBLISHES this message, or null —
 * the landscape-side half of the event spine's fleet question, whose fleet
 * half is `../../asyncapi/producers.ts` (`spine.message-unproduced`, in
 * `commands/validate/service/events/message-producers.ts`).
 *
 * Positive evidence only: an edge carrying `metadata { publishes '<msg>' }`
 * whose source element — itself or a declared ancestor, since the edge may
 * point out of a topic nested inside the broker — is tagged #external and
 * resolves to no known service directory. The resolution guard is what keeps
 * a mis-tagged internal service reading as unproduced: a tag is cheap to
 * write, and a services/<id>/ directory outranks it.
 */
export function externalProducerOf(
  message: string,
  land: LoadedDoc | null,
  landSvcOf: ((id: string) => DeclaredService) | null,
  known: ReadonlySet<RawServiceId>,
): string | null {
  if (land === null || land.errors.length > 0 || landSvcOf === null) return null;
  const knownIds: ReadonlySet<string> = known;
  const byId = new Map(land.elements.map((e) => [e.id, e]));
  for (const r of land.relationships) {
    if (r.publishes !== message) continue;
    if (knownIds.has(landSvcOf(r.source))) continue;
    for (let id = r.source; ; ) {
      const e = byId.get(id);
      if (e !== undefined && e.tags.includes(EXTERNAL_TAG)) return e.title;
      const dot = id.lastIndexOf(".");
      if (dot === -1) break;
      id = id.slice(0, dot);
    }
  }
  return null;
}
