/**
 * The element↔directory passes of the fleet cross-check: which drawn box
 * answers for which `services/<id>/`, and what it means when the answer is
 * none, two, or one nobody owns.
 *
 * Lifted out of `../landscape.ts` when that module reached its line limit, and
 * the seam is a phase rather than a subject: everything here runs after the map
 * has parsed, reads nothing from disk, and grades exactly one join — the census
 * `../census.ts` derives against the enumeration `../landscape.ts` performed.
 * The four grades are ordered as the report reads them, and the ORDER is the
 * caller's business, which is why this is one function rather than four.
 *
 * A sub-package of `fleet/` for `./isolation.ts`'s reason, and with its rule: it
 * imports NOTHING from `fleet/` itself — a child reaching back into its parent
 * while the parent calls the child is the package cycle
 * `scripts/package-graph.mjs` refuses — so the two census derivations arrive as
 * data on the input record rather than as an import of `../census.js`.
 */
import { type Elem } from "../../../../core/c4/likec4.js";
import { elementService } from "../../../../core/c4/resolve/service.js";
import { EXTERNAL_TAG, INFRA_KINDS } from "../../../../core/vocabulary/maturity.js";
import { type Finding } from "../../../../core/vocabulary/report.js";

export interface BindingInput {
  /** Every element the map declares, at any depth — a binding answers for itself wherever it is written. */
  elements: Elem[];
  /** Service-LEVEL elements (`census.ts serviceLevelElements`) — the fleet map's own boxes. */
  drawn: Elem[];
  /** The drawn SYSTEMS (`census.ts drawnSystems`) — `drawn` minus what the map itself says is no service. */
  systems: Elem[];
  /** The services/<id>/ directories that exist. */
  services: ReadonlySet<string>;
  /** The services some element resolves to — the set `landscape.service-unmodelled` reads. */
  modelled: ReadonlySet<string>;
  /** Where a service's directory sits, repo-relative — the enumeration's answer, never `services/<id>`. */
  pathOf: (id: string) => string;
}

export function bindingFindings(input: BindingInput): Finding[] {
  const { elements, drawn, services, pathOf } = input;
  const findings: Finding[] = [];

  // Two boxes standing for one service directory. Every join in loam is
  // `element -> service`, computed by picking the FIRST element that resolves —
  // so with two of them, which one wins is readdir order, and the edges of the
  // loser are attributed to a service they do not belong to. Silent until now,
  // and unfixable by staring at either element on its own.
  const perService = new Map<string, Elem[]>();
  for (const e of drawn) {
    if (e.tags.includes(EXTERNAL_TAG)) continue;
    const id = elementService(e);
    perService.set(id, [...(perService.get(id) ?? []), e]);
  }
  for (const [id, elems] of perService) {
    if (elems.length < 2) continue;
    // A collision only matters where it decides something: a real directory to
    // attribute to, or a binding somebody wrote down on purpose.
    if (!services.has(id) && !elems.some((e) => e.service !== undefined)) continue;
    findings.push({
      severity: "warn",
      code: "landscape.binding-duplicate",
      subject: id,
      message: `landscape: ${elems.length} elements resolve to service '${id}' (${elems.map((e) => e.id).join(", ")}) — every element→service join picks one of them arbitrarily, so the others' edges are filed under a service that does not own them; keep one element per services/<id>/`,
    });
  }

  for (const id of services) {
    if (input.modelled.has(id)) continue;
    findings.push({
      severity: "error",
      code: "landscape.service-unmodelled",
      subject: id,
      message: `landscape: ${pathOf(id)}/ exists but nothing in architecture/landscape.likec4 models it — add an element, or bind one with metadata { service '${id}' }`,
    });
  }

  // A binding is a claim about this repo wherever it is written — including
  // inside another element, which the old top-level filter never looked at, so
  // a typo one level down bound an edge to a service that does not exist and
  // nothing said so. Every element with a binding answers for it, at any depth.
  for (const e of elements) {
    if (e.tags.includes(EXTERNAL_TAG) || e.service === undefined) continue;
    if (services.has(e.service)) continue;
    findings.push({
      severity: "error",
      code: "landscape.binding-unknown",
      subject: e.service,
      message: `landscape: '${e.title}' binds to service '${e.service}', but services/${e.service}/ does not exist`,
    });
  }

  // Walked over the SYSTEM census — the same derivation the scorecard counts,
  // so the map's exemptions and the fleet rollup cannot drift — with the two
  // residual skips that are not exemptions: a bound element is the binding
  // pass's subject above, and a title naming a real directory is documented.
  //
  // Infrastructure the fleet OWNS is out of `systems` upstream, in
  // `../census.ts drawnSystems` (INFRA_KINDS), and it had to be: this message
  // offers exactly two remedies and BOTH are false of an owned datastore — there
  // is no `services/<id>/` to bind, and `#external` would claim somebody else
  // runs it. Measured on a one-service fixture drawing an owned `database` at
  // fleet level (2026-09-07), it fired here and had no correct fix.
  for (const e of input.systems) {
    if (e.service !== undefined) continue; // graded by the binding pass above
    if (services.has(e.title)) continue;
    findings.push({
      severity: "warn",
      code: "landscape.service-undocumented",
      subject: e.title,
      // The third remedy is spelled from `INFRA_KINDS` rather than typed out,
      // for the reason the set exists at all: the hook is a kind NAME, so a
      // fleet whose specification spells its store `postgres` still lands here,
      // and this sentence is the only place that tells its author which
      // spellings loam reads. A prose copy would be a second list free to drift
      // from the one the census walks.
      message: `landscape: '${e.title}' has no services/${e.title}/ — bind it with metadata { service '<id>' }, tag it #${EXTERNAL_TAG} if it is not ours, or give it one of the kinds loam reads as infrastructure (${[...INFRA_KINDS].join(", ")}) if it is a store, queue or bucket the fleet runs rather than a system somebody adopts`,
    });
  }

  return findings;
}
