/**
 * The direct join partners of one service, derived from the LIVING landscape,
 * and the maturity grading of everything on either end of a join.
 *
 * The landscape is the only place the fleet's joins are drawn, so the partner
 * set is exactly the edges whose resolved source or target is the gated
 * service — resolved through `serviceResolver` with the ENUMERATED fleet
 * riding in, the same ride that keeps container-modelling landscapes attached
 * everywhere else (an edge into `paymentService.api` is an edge into the
 * service that owns it). A landscape that is absent or does not parse yields
 * NO partner set, never an empty one: `landscape` says which, and the check
 * layer turns "could not look" into `gate.partners-unknown` rather than
 * letting it read as "no partners".
 */
import { existsSync } from "node:fs";
import { type Elem, type Rel } from "../c4/likec4.js";
import { serviceResolver } from "../c4/resolve/service.js";
import {
  ACTOR_KINDS,
  EXTERNAL_TAG,
  landscapeEvidence,
  maturityGaps,
  serviceMaturity,
  MATURITY_LADDER,
  type Maturity,
} from "../vocabulary/maturity.js";
import { compareIds, type ServiceEntry } from "../repo/entries.js";
import { landscapePath, servicePathsAt } from "../repo/paths.js";
import { enumeratedServices } from "../repo/service-target.js";
import type { FleetContext } from "../fleet-context.js";
import { ancestorIds } from "../kernel/ids/fqn/ancestors.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { RawServiceId } from "../kernel/ids/service.js";
import type { GatePartner, LandscapeRead, PartnerRole } from "./report.js";

export interface PartnerScanRequest {
  docsDir: DocsDir;
  /** The gated service — a name the enumeration approved (`resolveServiceTarget`). */
  service: RawServiceId;
  fleet: FleetContext;
}

/** One service graded on the adoption ladder, with what the next rung wants. */
export interface GradedService {
  maturity: Maturity;
  gaps: string[];
}

export interface PartnerScan {
  landscape: LandscapeRead;
  /**
   * Why the landscape graded `invalid` — the parse-error tally or the read
   * failure's own words. Null on `read` and `absent`; the finding that fails
   * the gate must say what broke, not merely that something did.
   */
  landscapeProblem: string | null;
  /**
   * The gated service's own rung, graded under the landscape's evidence —
   * `gate.service-undocumented`'s subject. Fail-closed on the api question:
   * with no readable map, `landscapeEvidence` assumes an API is expected.
   */
  target: GradedService;
  /**
   * The same service graded with NO api expected of it — the reading that
   * does not depend on the landscape at all. The check layer answers from
   * THIS one when the map is absent or broken: the api question is then
   * unanswerable, and one unanswerable fact must not convict twice (the
   * landscape already carries its own finding).
   */
  targetWithoutApi: GradedService;
  /**
   * The gated service's own enumerated entry — carried so a finding can name
   * the directory it actually occupies. `services/<id>/` is right only for an
   * unfiled fleet, and a check that sends a reader to a directory they cannot
   * open has answered worse than not at all.
   */
  targetEntry: ServiceEntry;
  partners: GatePartner[];
  /**
   * The enumerated entries behind the partners that HAVE a `services/`
   * directory, in `partners` order — what the freshness check walks. Kept as
   * entries rather than names so the ids that travel on carry the
   * enumeration's provenance (`RawServiceId`), never a document's.
   */
  partnerEntries: ServiceEntry[];
}

/** Is this rung at or above `documented` — the fixed threshold check 1 grades against? */
export function atLeastDocumented(m: Maturity): boolean {
  return MATURITY_LADDER.indexOf(m) >= MATURITY_LADDER.indexOf("documented");
}

/**
 * What the map says about one edge END: does it stand for a person, and is it
 * tagged `#external`? Walked up the ancestor chain because both facts are
 * usually written on the containing system while the edge is drawn from a
 * nested element — but the walk STOPS at the first element that stands for a
 * service (an explicit binding or a title naming a real directory,
 * `serviceResolver`'s own first two rungs, checked after that element's own
 * facts are read). What sits above the service boundary is a grouping, and a
 * grouping's `#external` is the grouping's claim, not the service's: without
 * the stop, an adopted service drawn inside an `#external` zone was exempted
 * from `gate.partner-undocumented` and its real rung hidden.
 */
function endFacts(
  byId: Map<string, Elem>,
  known: ReadonlySet<string>,
  id: string,
): { actor: boolean; external: boolean } {
  let actor = false;
  let external = false;
  // The id itself, then each dotted ancestor — the same walk `serviceResolver`
  // resolves through, out of the one module that spells it
  // (`core/kernel/ids/fqn/ancestors.ts`).
  for (const candidate of ancestorIds(id)) {
    const e = byId.get(candidate);
    if (e === undefined) continue;
    if (ACTOR_KINDS.has(e.kind.toLowerCase())) actor = true;
    if (e.tags.includes(EXTERNAL_TAG)) external = true;
    if (e.service !== undefined || known.has(e.title)) break;
  }
  return { actor, external };
}

/** How one edge joins the two ends, in the words the finding and the payload both use. */
function viaOf(r: Rel): string[] {
  const typed = [
    ...(r.op === undefined ? [] : [`operation ${r.op}`]),
    ...(r.publishes === undefined ? [] : [`message ${r.publishes}`]),
    ...(r.consumes === undefined ? [] : [`message ${r.consumes}`]),
  ];
  if (typed.length > 0) return typed;
  return [r.title === undefined ? "untyped edge" : `edge '${r.title}'`];
}

interface PartnerAccumulator {
  consumer: boolean;
  provider: boolean;
  external: boolean;
  via: Set<string>;
}

export async function partnerScan(req: PartnerScanRequest): Promise<PartnerScan> {
  const { docsDir, service, fleet } = req;
  // The same memoized enumeration the command's resolveServiceTarget already
  // performed on this FleetContext — one walk answers both questions.
  const entries = await enumeratedServices(docsDir, fleet);
  // Keyed as plain strings on purpose: the lookups below arrive from the
  // resolver, whose names are document-asserted, and only a hit proves a
  // directory. The VALUES keep the enumeration's provenance.
  const entryById = new Map<string, ServiceEntry>(entries.map((e) => [e.id, e]));
  const known: ReadonlySet<string> = new Set(entries.map((e) => e.id));

  const lp = landscapePath(docsDir);
  let landscape: LandscapeRead = "absent";
  let landscapeProblem: string | null = null;
  let elements: Elem[] = [];
  let relationships: Rel[] = [];
  if (existsSync(lp)) {
    try {
      const doc = await fleet.loadLikeC4(lp);
      if (doc.errors.length > 0) {
        landscape = "invalid";
        const first = doc.errors[0];
        landscapeProblem =
          `${doc.errors.length} parse error(s)` +
          (first === undefined ? "" : ` — first: ${first.message}`);
      } else {
        landscape = "read";
        elements = doc.elements;
        relationships = doc.relationships;
      }
    } catch (err) {
      // A landscape that could not be READ, graded as one that did not PARSE —
      // commands/validate/fleet/load.ts's containment doctrine, spelled here
      // because core cannot import it: "could not be read" and "did not parse"
      // have the same consequence (nothing may be concluded from this file).
      // The reason travels into the finding, message-preserving as
      // `unreadableLandscape` is; the read error must not kill the run — the
      // other three checks still have answers.
      landscape = "invalid";
      landscapeProblem = err instanceof Error ? err.message : String(err);
    }
  }
  const parses = landscape === "read";
  const svcOf: (id: string) => string = parses
    ? serviceResolver(elements, known)
    : (id: string) => id;
  const elementIds = elements.map((e) => e.id);

  // One service's ladder rung. `landscapeEvidence` is the ONE shared spelling
  // of the positive-evidence apiExpected rule (core/vocabulary/maturity.ts);
  // its own docblock warns against calling it per service inside a FLEET loop,
  // and this loop is not one — it runs over the gated service and its direct
  // partners, a handful, never the enumeration.
  const gradeWith = (entry: ServiceEntry, apiExpected: boolean): GradedService => {
    const input = {
      entry,
      archSpec: existsSync(servicePathsAt(entry.dir).archSpec),
      apiExpected,
    };
    return { maturity: serviceMaturity(input), gaps: maturityGaps(input) };
  };
  const grade = (entry: ServiceEntry): GradedService =>
    gradeWith(
      entry,
      landscapeEvidence({ id: entry.id, parses, relationships, elementIds, svcOf }).apiExpected,
    );

  // Unreachable by construction: the command layer resolved `service` against
  // the same memoized enumeration this scan just read, and refused
  // `unknown-service` when no directory answered. Failing closed here beats
  // grading a service nobody enumerated as if its absence were a rung.
  const targetEntry = entryById.get(service);
  if (targetEntry === undefined) {
    throw new Error(`gate: '${service}' vanished from the enumeration between resolve and scan`);
  }

  const byId = new Map(elements.map((e) => [e.id, e]));
  const acc = new Map<string, PartnerAccumulator>();
  const join = (name: string, role: PartnerRole, r: Rel, external: boolean): void => {
    const slot = acc.get(name) ?? { consumer: false, provider: false, external: false, via: new Set<string>() };
    if (role === "consumer") slot.consumer = true;
    else slot.provider = true;
    slot.external = slot.external || external;
    for (const v of viaOf(r)) slot.via.add(v);
    acc.set(name, slot);
  };
  for (const r of relationships) {
    const source = svcOf(r.source);
    const target = svcOf(r.target);
    // A self-edge (both ends resolve to the gated service — its own containers
    // talking to each other) names no partner.
    if (source === target) continue;
    if (target === service) {
      const facts = endFacts(byId, known, r.source);
      // A person is never a deploy participant: the actor exemption every
      // landscape census applies (drawnSystems, commands/validate/fleet/census.ts).
      if (!facts.actor) join(source, "consumer", r, facts.external);
    } else if (source === service) {
      const facts = endFacts(byId, known, r.target);
      if (!facts.actor) join(target, "provider", r, facts.external);
    }
  }

  // Sorted by id so identical state yields identical bytes — the accumulator's
  // order is the landscape's edge order, which a reformat may shuffle.
  const joined = [...acc.entries()].sort((a, b) => compareIds(a[0], b[0]));
  const partners: GatePartner[] = joined.map(([name, slot]) => {
    const entry = entryById.get(name);
    return {
      service: name,
      maturity: entry === undefined ? null : grade(entry).maturity,
      role: slot.consumer && slot.provider ? "both" : slot.consumer ? "consumer" : "provider",
      via: [...slot.via].sort(),
      // An adopted service is OURS whatever a zone's tag says: `external` and
      // a maturity rung together must be unrepresentable, or the rung the
      // payload carries is one the exemption hides and the human view drops.
      external: entry === undefined && slot.external,
    };
  });

  return {
    landscape,
    landscapeProblem,
    targetEntry,
    target: grade(targetEntry),
    targetWithoutApi: gradeWith(targetEntry, false),
    partners,
    partnerEntries: joined.flatMap(([name]) => {
      const entry = entryById.get(name);
      return entry === undefined ? [] : [entry];
    }),
  };
}
