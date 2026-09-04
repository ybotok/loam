/**
 * `landscape.service-isolated` — a service the fleet map draws and nothing
 * reaches, graded on EVIDENCE rather than on the shape alone.
 *
 * The state is the one `loam seed --from fleet.yaml` leaves for every service
 * nobody listed under `calls:`: a bound element with no edge. Nothing used to
 * report it — `landscape.service-unmodelled` wants a missing element, and the
 * element is present — so a service could be adopted with a full artifact set
 * and stay invisible to every cross-service check while the run ended on
 * `landscape.matched`.
 *
 * Why the evidence gate, and not "every edgeless bound element": a warning with
 * no correct fix is the warning somebody silences. A worker or a cron that
 * genuinely calls nothing has an edgeless element that is TRUE, and there is
 * no tag loam reads for "deliberately isolated" (inventing one is the invented
 * need the non-goals forbid). So this fires only when the service's own
 * `model.likec4` parses and declares at least one call across its boundary —
 * a JOIN between two authored documents: the model attests a call the map
 * does not draw. The list comes from `attestedCalls`, the same derivation the
 * adopt brief names those calls with, so the brief and this check can never
 * disagree about which edges the map owes. Silent, on purpose, for a service
 * with no model (seed's fleet), an unparseable model (`c4.invalid` owns it), a
 * model reaching nothing, and an unmodelled service (`service-unmodelled` owns
 * it).
 *
 * `#external` is never a SUBJECT, and that is now enforced rather than assumed.
 * The claim used to rest on "an `#external` element is not an enumerated
 * service" — true of the ordinary case and false of the reachable one: an
 * element tagged `#external` and bound with `metadata { service '<id>' }` to a
 * directory that exists resolved like any other, so a foreign box answered for
 * one of our services (R4). The two neighbouring binding checks have always
 * skipped the tag; the input set here does too, so "deliberately not ours"
 * means the same thing in all three.
 *
 * The subject set ONLY, and that boundary is the whole of the rule. The filter
 * also sat inside the `touched` walk for one round, which answers a different
 * question — does the map draw any edge on this service — and got it wrong: a
 * kind carrying the tag (`element topic { #external }`, the idiom
 * `examples/docs/architecture/landscape.likec4` defends at length) puts
 * `#external` on every element of that kind, so an edge drawn from a service's
 * OWN topic stopped touching it and the warning fired on a service the map
 * demonstrably reaches — while `loam adopt`, whose `landscape.touched` has no
 * tag filter, said `touched: true` on the same tree. Two answers to one rule
 * is the drift this file's banner promises there cannot be, so the walk below
 * is the brief's predicate exactly, tag and all.
 *
 * A sub-package of its own because `fleet/` sits at the five-file cap, and it
 * imports NOTHING from `fleet/`: a child reaching back into its parent while
 * the parent calls the child is the package cycle `scripts/package-graph.mjs`
 * refuses, which is why the input is one record the caller fills. The models
 * are no longer read here either — `./attest.ts` reads each of them once for
 * this check and the datastore census together.
 */
import { type LoadedDoc } from "../../../../core/c4/likec4.js";
import { edgeTemplates, spellCall } from "../../../../core/c4/resolve/attested.js";
import { type Finding } from "../../../../core/vocabulary/report.js";
import { type AttestedModel } from "./attest.js";

export interface IsolationInput {
  /** The parsed landscape. */
  land: LoadedDoc;
  /**
   * The services a NON-`#external` element resolves to — `service-unmodelled`'s
   * set with the tag filter applied, which is what keeps a foreign box from
   * answering for one of our directories.
   */
  modelled: ReadonlySet<string>;
  /** The ids of the map's `#external` elements: never a subject — and never what the message names. */
  external: ReadonlySet<string>;
  /** What each service's own model attests, read once by `./attest.ts` for this check and the store census. */
  attested: readonly AttestedModel[];
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
  /** Where a service's directory sits, repo-relative — the enumeration's answer, never `services/<id>`. */
  pathOf: (id: string) => string;
}

/** How many attested calls the message spells out before "…" — three reads; thirty is a wall. */
const NAMED_CALLS = 3;

export function isolationFindings(input: IsolationInput): Finding[] {
  const { land, resolve, pathOf } = input;
  // One pass over the relationships: a service is touched when EITHER endpoint
  // resolves to it. An intra-service edge (`svc.api -> svc.db`) therefore
  // counts, which is the brief's `landscape.touched` predicate exactly, and
  // what keeps a self-model drawn as one service of container edges silent.
  // NO tag filter here, deliberately — see the banner: an `#external` endpoint
  // is still an edge the map draws on whatever it resolves to, and skipping one
  // made this check contradict `loam adopt` on a service whose own topic (a
  // kind-tagged `#external` element) was the endpoint.
  const touched = new Set<string>();
  for (const r of land.relationships) {
    for (const endpoint of [r.source, r.target]) touched.add(resolve(endpoint));
  }

  const findings: Finding[] = [];
  for (const model of input.attested) {
    if (!input.modelled.has(model.service) || touched.has(model.service)) continue;
    const calls = model.calls;
    if (calls.length === 0) continue;
    // `modelled.has` proves a non-external element resolves; the find is the
    // same predicate spelled on the elements, and an empty answer fails closed
    // rather than naming an element that is not there.
    const element = land.elements.find((e) => resolve(e.id) === model.service && !input.external.has(e.id));
    if (element === undefined) continue;
    const named = calls.slice(0, NAMED_CALLS).map(spellCall).join(", ") + (calls.length > NAMED_CALLS ? ", …" : "");
    // The repair form follows the calls' direction (`edgeTemplates`): the
    // outbound form alone, spelled here until 2026-09-03, sent an inbound
    // call backwards.
    const forms = edgeTemplates(element.id, calls)
      .map((t) => `\`${t}\``)
      .join(" or ");
    findings.push({
      severity: "warn",
      code: "landscape.service-isolated",
      subject: model.service,
      message:
        // "the fleet map (architecture/)", never the landscape FILE: the input
        // is the whole PROJECT, so an edge added to `architecture/extra.likec4`
        // and never to landscape.likec4 silences this finding — measured on both
        // the seed lab and examples/docs. Naming one file told a reader the edge
        // had to land there, which SCHEMA, `loam explain` and the brief all
        // already contradicted (verification 2026-09-04).
        `landscape: ${pathOf(model.service)}/ resolves to '${element.id}' and no edge in the fleet map ` +
        `(architecture/) touches it, while ${pathOf(model.service)}/model.likec4 declares ${calls.length} ` +
        `call(s) across its boundary ` +
        `(${named}) — the service is drawn and invisible to every cross-service check. Draw each as one edge on ` +
        `${element.id}: ${forms} for a call, ` +
        `\`publishes\`/\`consumes\` for an event, naming the other party as the map already spells it`,
    });
  }
  return findings;
}
