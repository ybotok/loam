/**
 * Fleet-shape advisories over the parsed landscape: the two ways a fleet map
 * stops answering questions as it grows, caught while the map is already in
 * memory.
 *
 * Both arrived with the first fleet adoption, at service three rather than
 * service two. Ubiquitous infrastructure — logging Kafka, auth, service
 * discovery — takes one inbound edge per adopted service until the map is a
 * hairball around it; deleting the element fixes the picture and loses "who
 * depends on UAA", which is the question the map exists to answer during an
 * incident. Tagging keeps both: the fleet view excludes `#platform`, and a
 * platform view keeps the dependents. And a datastore drawn as a fleet-level
 * peer makes a claim its consumer count either supports or refutes: one
 * consumer means the drawing is false — the store is that service's
 * internals, not a system in its own right — while two or more mean the
 * strongest coupling two services can have, which deserves to be stated
 * rather than inferred.
 *
 * Everything here is O(relationships) over data the fleet target already
 * holds. loam still reads no code and decides no policy: the team chooses
 * what counts as platform and which data is truly shared — these warnings
 * only name the shapes that are usually wrong.
 */
import { type Elem, type Rel } from "../../../core/c4/likec4.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { EXTERNAL_TAG } from "./vocabulary.js";

/** Tag marking ubiquitous infrastructure; the scaffolded fleet view excludes it. */
export const PLATFORM_TAG = "platform";

/**
 * Consumers at which an untagged external hub starts to warn. Three, not two:
 * two services sharing a dependency is a fact about those two services, the
 * same edge from three is a pattern about the element — and three is where
 * the first fleet's map stopped being readable.
 */
export const PLATFORM_CANDIDATE_MIN_CONSUMERS = 3;

/** The element kind read as a datastore, compared case-insensitively. */
const DATASTORE_KIND = "database";

export interface FleetShape {
  /** Service-LEVEL elements — the fleet map's own boxes (landscape.ts `drawn`). */
  drawn: Elem[];
  relationships: Rel[];
  /** The services/<id>/ directories that exist. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
}

export function fleetShapeFindings(shape: FleetShape): Finding[] {
  const { drawn, relationships, services, resolve } = shape;
  const findings: Finding[] = [];

  // Distinct consumer SERVICES of an element, its nested children included: an
  // edge into `kafka.paymentEvents` is consumption of `kafka`. Persons, other
  // external systems and unresolved sources never count — a consumer is a
  // source the shared resolver files under a real services/<id>/, so two edges
  // from one service are one consumer.
  const consumersOf = (e: Elem): string[] => {
    const out = new Set<string>();
    for (const r of relationships) {
      if (r.target !== e.id && !r.target.startsWith(`${e.id}.`)) continue;
      const svc = resolve(r.source);
      if (services.has(svc)) out.add(svc);
    }
    return [...out].sort();
  };

  for (const e of drawn) {
    // An element that stands for a real service is the fleet itself, not its
    // shape: many consumers is what a well-used service looks like, and a
    // datastore bound to a directory is graded by the binding checks instead.
    if (e.service !== undefined || services.has(e.title)) continue;
    const consumers = consumersOf(e);

    if (
      e.tags.includes(EXTERNAL_TAG) &&
      !e.tags.includes(PLATFORM_TAG) &&
      consumers.length >= PLATFORM_CANDIDATE_MIN_CONSUMERS
    ) {
      findings.push({
        severity: "warn",
        code: "landscape.platform-candidate",
        subject: e.title,
        message:
          `landscape: '${e.title}' is consumed by ${consumers.length} services (${consumers.join(", ")}) ` +
          `and is not tagged #platform — a hub like this takes one more edge per adopted service until ` +
          `the fleet view is unreadable. Declare \`tag platform\` in the specification block and tag the ` +
          `element (LikeC4 refuses an undeclared tag, so both steps are needed): the fleet view then ` +
          `excludes it, and a platform view over \`include * -> element.tag = #platform\` keeps ` +
          `"who depends on it" answerable`,
      });
    }

    if (e.kind.toLowerCase() !== DATASTORE_KIND || consumers.length === 0) continue;
    if (consumers.length === 1) {
      findings.push({
        severity: "warn",
        code: "landscape.datastore-private",
        subject: e.title,
        message:
          `landscape: '${e.title}' is a datastore with a single consumer at fleet level ` +
          `('${consumers[0]!}') — drawn as a peer it reads as a system in its own right, available to ` +
          `be depended on. Move it into services/${consumers[0]!}/model.likec4 as a nested container ` +
          `and delete it here, or add the second consumer's edge if another service really reaches ` +
          `the same data`,
      });
    } else {
      findings.push({
        severity: "warn",
        code: "landscape.datastore-shared",
        subject: e.title,
        message:
          `landscape: '${e.title}' is a datastore shared by ${consumers.length} services ` +
          `(${consumers.join(", ")}) — the strongest coupling two services can have, and the hardest ` +
          `to undo. Shared means the same DATA: if they read the same tables or keys, keep it drawn ` +
          `and let this warning state the coupling; if they only share a host or cluster (two schemas, ` +
          `two lock paths), that is operational blast radius — a runbook fact — and the honest model ` +
          `is one private store per service`,
      });
    }
  }
  return findings;
}
