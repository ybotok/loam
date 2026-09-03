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
 * it); an `#external` element is never an enumerated service, so it is never
 * a subject here.
 *
 * A sub-package of its own because `fleet/` sits at the five-file cap, and it
 * imports NOTHING from `fleet/`: a child reaching back into its parent while
 * the parent calls the child is the package cycle `scripts/package-graph.mjs`
 * refuses, which is why the input is one record the caller fills.
 */
import { existsSync } from "node:fs";
import { loadFile, type LoadedDoc } from "../../../../core/c4/likec4.js";
import { attestedCalls, edgeTemplates, spellCall } from "../../../../core/c4/resolve/attested.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import { type ServiceEntry } from "../../../../core/repo/entries.js";
import { servicePathsAt } from "../../../../core/repo/paths.js";
import { type Finding } from "../../../../core/vocabulary/report.js";

export interface IsolationInput {
  /** The enumerated services — the only possible subjects. */
  entries: readonly ServiceEntry[];
  /** The parsed landscape. */
  land: LoadedDoc;
  /** The services/<id>/ directories that exist, as the resolver's `known`. */
  services: ReadonlySet<string>;
  /** The services some element resolves to — the set `service-unmodelled` reads. */
  modelled: ReadonlySet<string>;
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
  /** Where a service's directory sits, repo-relative — the enumeration's answer, never `services/<id>`. */
  pathOf: (id: string) => string;
  /** Under `--all` every model.likec4 is already in this memo, so the reads below are hits. */
  fleet?: FleetContext;
}

/** How many attested calls the message spells out before "…" — three reads; thirty is a wall. */
const NAMED_CALLS = 3;

export async function isolationFindings(input: IsolationInput): Promise<Finding[]> {
  const { land, resolve, pathOf } = input;
  // One pass over the relationships: a service is touched when EITHER endpoint
  // resolves to it. An intra-service edge (`svc.api -> svc.db`) therefore
  // counts, which is the brief's `landscape.touched` predicate exactly, and
  // what keeps a self-model drawn as one service of container edges silent.
  const touched = new Set<string>();
  for (const r of land.relationships) {
    touched.add(resolve(r.source));
    touched.add(resolve(r.target));
  }
  // Only a modelled, untouched service with a model on disk is a candidate —
  // no model, no evidence, no finding.
  const candidates = input.entries.filter(
    (entry) => input.modelled.has(entry.id) && !touched.has(entry.id) && existsSync(servicePathsAt(entry.dir).model),
  );
  // Through the fleet memo when there is one (a hit under `--all`); a plain
  // load otherwise. Pooled and joined on the entry, never by index.
  const load = (path: string): Promise<LoadedDoc> =>
    input.fleet === undefined ? loadFile(path) : input.fleet.loadLikeC4(path);
  const loaded = await inOrder(candidates, async (entry) => ({ entry, doc: await load(servicePathsAt(entry.dir).model) }));

  const findings: Finding[] = [];
  for (const { entry, doc } of loaded) {
    // A model that does not parse attests nothing: `c4.invalid` is its finding.
    if (doc.errors.length > 0) continue;
    const calls = attestedCalls(doc, entry.id, input.services);
    if (calls.length === 0) continue;
    // `modelled.has` proves an element resolves; the find is the same predicate
    // spelled on the elements, and an empty answer fails closed rather than
    // naming an element that is not there.
    const element = land.elements.find((e) => resolve(e.id) === entry.id);
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
      subject: entry.id,
      message:
        `landscape: ${pathOf(entry.id)}/ resolves to '${element.id}' and no edge in architecture/landscape.likec4 ` +
        `touches it, while ${pathOf(entry.id)}/model.likec4 declares ${calls.length} call(s) across its boundary ` +
        `(${named}) — the service is drawn and invisible to every cross-service check. Draw each as one edge on ` +
        `${element.id}: ${forms} for a call, ` +
        `\`publishes\`/\`consumes\` for an event, naming the other party as the map already spells it`,
    });
  }
  return findings;
}
