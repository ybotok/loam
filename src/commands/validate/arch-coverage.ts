/**
 * Whether the architecture a delta INTRODUCES is accounted for by something
 * that will actually merge with it.
 *
 * Two of the findings ask that of a REQUIREMENT: `archedge.uncovered` (a
 * scenario names the new edge — heuristic, warn-only) and `c4.uncovered` (an
 * arch.spec.md requirement covers the new element or edge — mechanical). This is
 * where agent-built code cuts its corners — the outbox, the retries, the alerts
 * — because no business scenario was ever going to mention them.
 *
 * The third asks it of a JOURNEY — `flow.unrepresented`, adopt-gated, with its
 * reasoning at the emission below. The fleet's journey map is the one artifact
 * nobody is told to update when the architecture moves under it.
 *
 * Split out of `validateFeature` because it is the only part of the feature
 * target that needs the LIVING landscape: everything else there reads the
 * feature directory alone. Keeping the lazy load and its two exemption sets in
 * one module is what stops "new" being decided differently in three places —
 * and `./covers-scope.ts` holds the phase that follows, where an entry somebody
 * WROTE is resolved rather than an obligation derived (`covers.unknown`).
 */
import { existsSync } from "node:fs";
import { loadFile, type LoadedDoc } from "../../core/c4/likec4.js";
import { type Flow } from "../../core/c4/flows/flow.js";
import { drawnRelationships } from "../../core/c4/flows/steps.js";
import { flowDocuments } from "../../core/flows/project.js";
import { elementService, serviceResolver, type Elem, type Rel } from "../../core/c4/model/model.js";
import { type PathableService } from "../../core/kernel/ids/service.js";
import { landscapePath as landscapeFile } from "../../core/repo/paths.js";
import { enumeratedServiceIds } from "../../core/repo/service-target.js";
import { type Finding } from "../../core/vocabulary/report.js";
import { type Requirement } from "../../core/document/spec.js";
import { coversEdge, coversElement } from "../../core/c4/arch.js";
import { FleetContext } from "../../core/fleet-context.js";
import { ACTOR_KINDS, EXTERNAL_TAG } from "./checks/vocabulary.js";
import { coversEntries } from "./checks/requirements.js";
import { coversScopeFindings } from "./covers-scope.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

/** One feature delta's architecture, and everything needed to decide what in it is new. */
export interface DeltaArch {
  docsDir: DocsDir;
  /** Every element the delta declares — the resolver's index, and `coversEdge`'s scope. */
  elements: Elem[];
  /** Every relationship the delta declares. */
  relationships: Rel[];
  /**
   * Every dynamic view the delta declares — what a `Covers: view:<id>` entry may
   * name, and what `flow.unrepresented` asks a new cross-service operation to
   * appear in a step of.
   */
  flows: Flow[];
  /**
   * The fleet's journeys — every dynamic view the `architecture/` project
   * declares, the documents under `architecture/flows/` included. Read once by
   * the fleet target and handed down; EMPTY on a `validate --feature <id>` run,
   * which grades one directory and pays for no fleet parse.
   *
   * Separate from `flows` above rather than unioned by the caller because the
   * two answer different questions: a delta's own views are what this feature
   * DRAWS, and an obligation — `c4.uncovered`, `flow.unrepresented` — is about
   * them alone, while these are what it may legitimately point at.
   */
  fleetFlows: Flow[];
  /** The delta's own additions: elements and edges carrying the feature id as a tag. */
  taggedEls: Elem[];
  taggedRels: Rel[];
  /** Each addressed service's arch.spec.md delta, in enumeration order. */
  archDeltas: Array<{ service: PathableService; reqs: Requirement[] }>;
  /**
   * Every service the feature's `specs/` addresses — not just the ones with an
   * arch delta. The resolver's fleet set unions these in because a service the
   * feature INTRODUCES has no `services/` directory yet, and without its name
   * an edge into that service's own modelled container resolved to the
   * container's title — a phantom the fleet half alone cannot rule out.
   */
  featureServices: PathableService[];
  /** Every scenario the feature's deltas carry, lowercased — the heuristic's haystack. */
  scenarioText: string;
  /** The living landscape under --all; undefined means "load it if you need it", null "there is none". */
  preloadedLand?: LoadedDoc | null;
  fleet?: FleetContext;
}

export async function deltaArchCoverage(delta: DeltaArch): Promise<Finding[]> {
  const {
    docsDir,
    elements,
    relationships,
    flows,
    fleetFlows,
    taggedEls,
    taggedRels,
    archDeltas,
    featureServices,
    scenarioText,
    preloadedLand,
    fleet,
  } = delta;
  const findings: Finding[] = [];

  // The delta's own element→service resolver, built once for the whole feature.
  // `serviceOf` is a one-shot wrapper that rebuilds its index on every call, and
  // the two loops below ask it up to five times per tagged edge — so a delta
  // over a large model paid for one Map of every element per question asked.
  // The enumerated fleet — `services/` plus the feature's own `specs/` names,
  // where a service it introduces lives — rides into it, and into `baseSvcOf`
  // below, which MUST resolve the same way or the already-living exemption
  // keys never match: so an edge drawn into a modelled container
  // (`payment.api`) grades against the service that owns it instead of a
  // service called "api" that has never existed. An unenumerable services/
  // degrades to the feature's own names, exactly what every caller got before
  // the set existed.
  const known: ReadonlySet<string> = new Set<string>([
    ...(await enumeratedServiceIds(docsDir, fleet)),
    ...featureServices,
  ]);
  const svcOf = serviceResolver(elements, known);

  // Arch-edge coverage (heuristic, warn-only): each new tagged edge should be named by a scenario.
  for (const r of taggedRels) {
    const target = svcOf(r.target);
    const covered = edgeCovered(target, r.title, scenarioText);
    findings.push({
      severity: covered ? "ok" : "warn",
      code: covered ? "archedge.covered" : "archedge.uncovered",
      subject: target,
      message: `${svcOf(r.source)} → ${target}  "${r.title ?? ""}"${covered ? "" : "  — no scenario names it"}`,
      text: { indent: 4, header: "arch-edge coverage (heuristic):" },
    });
  }

  // The architecture spec axis, feature scope — the mechanical counterpart of
  // the heuristic above. Every NEW tagged element and edge in the delta wants a
  // `Covers:` line in one of the feature's arch.spec.md deltas (c4.uncovered):
  // this is where agent-built code cuts its corners — the outbox, the retries,
  // the alerts — because no business scenario was ever going to mention them.
  // Grouping-only elements take the same exemptions the fleet map applies
  // (person kinds, #external) — one set, in checks/vocabulary.ts, so "not a
  // service" cannot mean two things. Warnings, never archive gates; `--strict`
  // escalates.
  //
  // Only requirements the archive will MERGE grant coverage here. In a delta,
  // BASE means "the living state, quoted": it merges nothing, emits no
  // .feature, and yields no scenario.tested claim — so a Covers: line under a
  // plain `## Requirements` quote is an obligation that ships nowhere, and
  // counting it silenced c4.uncovered for free. (The service-scope pass keeps
  // the unfiltered call: a LIVING spec is legitimately all BASE.)
  const activeCovers = archDeltas.flatMap(({ reqs }) =>
    coversEntries(reqs.filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED")),
  );

  // What the living landscape ALREADY holds. A delta has to re-declare the
  // elements its new edges attach to, and authors tag those re-declarations
  // along with everything else — so a requirements-only feature that touches an
  // existing service was told to write `Covers:` lines for architecture it is
  // not adding. c4.uncovered is an obligation on NEW architecture; an element
  // the living landscape already resolves is not new, whatever the tag says.
  // Loaded lazily: a delta with nothing tagged never pays for the parse.
  let living: LoadedDoc | null | undefined = preloadedLand;
  const livingLandscape = async (): Promise<LoadedDoc | null> => {
    if (living === undefined) {
      const lp = landscapeFile(docsDir);
      living = existsSync(lp)
        ? fleet === undefined
          ? await loadFile(lp)
          : await fleet.loadLikeC4(lp)
        : null;
    }
    return living;
  };
  const alreadyLiving = async (): Promise<LoadedDoc | null> => {
    if (taggedEls.length === 0 && taggedRels.length === 0) return null;
    const doc = await livingLandscape();
    return doc !== null && doc.errors.length === 0 ? doc : null;
  };
  const base = await alreadyLiving();
  const baseSvcOf = base === null ? null : serviceResolver(base.elements, known);
  const baseIds = new Set(base?.elements.map((e) => e.id) ?? []);
  const baseServices = new Set((base?.elements ?? []).map(elementService));
  // How a service→service pair is keyed, spelled ONCE. The two sides used to
  // join with different separators — a NUL where the set was built, a space
  // where it was queried — so the exemption never matched anything, and every
  // edge a delta re-declares verbatim (which it must, to attach anything to
  // it) was reported as new architecture nobody covers. The join is structural
  // rather than a separator character: the last one was a NUL, and a raw NUL in
  // a template literal makes the source read as binary to `file` and invisible
  // to `grep` — which is how a one-character mismatch survived review.
  const edgeKey = (source: string, target: string): string => JSON.stringify([source, target]);
  const baseEdges = new Set(
    (base?.relationships ?? []).map((r) => edgeKey(baseSvcOf!(r.source), baseSvcOf!(r.target))),
  );

  for (const e of taggedEls) {
    if (ACTOR_KINDS.has(e.kind.toLowerCase()) || e.tags.includes(EXTERNAL_TAG)) continue;
    if (baseIds.has(e.id) || baseServices.has(elementService(e))) continue;
    if (activeCovers.some((c) => coversElement(c, e))) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: elementService(e),
      message: `delta adds '${e.title}' (${e.id}) but no arch requirement covers it — add 'Covers: ${e.id}' to a specs/<svc>/arch.spec.md delta, or its architectural obligations ship unchecked`,
    });
  }

  // `flow.unrepresented` rides the SAME walk over the tagged edges: it grades
  // the relationships this loop already holds, through the one `svcOf` the
  // feature shares. A pass of its own would be a second place turning an
  // endpoint into a service name, and two such disagreeing is exactly how the
  // already-living exemption below once stopped matching anything.
  //
  // `metadata { op }` is the filter and the whole question — an edge naming no
  // operation has nothing to be represented, and `c4.op-link-missing` grades
  // that state. Cross-service only: `likec4.config.json` scopes the flows
  // project to `architecture/`, so an intra-service call is not something a
  // fleet journey can draw at all.
  //
  // THIS DELTA'S OWN VIEWS ALONE, never the fleet's — the rule
  // `DeltaArch.fleetFlows` already states for `c4.uncovered`: a delta's own
  // views are what this feature DRAWS, and an obligation is about those. It
  // also keeps the answer identical under `validate --feature <id>`, which
  // reads no fleet journey; an obligation visible only under `--all` is one the
  // author who could act on it never sees.
  //
  // AND IT IS ADOPT-GATED. An axis nobody has adopted is quiet everywhere else
  // in loam — gherkin staleness needs `<gherkinDir>/loam/` to exist first, and
  // `health.uncovered` manufactures no obligation without a health.yaml,
  // because an absent file must not manufacture obligations. A fleet drawing no
  // journey cannot discharge this warning except by adopting the whole axis, so
  // firing there taxes people who have not opted in, and a signal people route
  // around is worth less than no signal. The gate asks about the FLEET, never
  // about this delta: a fleet WITH journeys whose feature draws none is the rot
  // being named. Both halves are asked, in the shape `loadFlowProject` states —
  // the map's own `views { }` block, plus the documents under
  // `architecture/flows/` — by EXISTENCE rather than content, so `--feature`
  // (which parses no fleet journey) answers as `--all` does, and a delta with
  // no tagged edge pays nothing.
  const drawn = drawnRelationships(flows);
  const fleetDrawsJourneys =
    taggedRels.length > 0 && ((base?.flows.length ?? 0) > 0 || (await flowDocuments(docsDir)).length > 0);
  for (const r of taggedRels) {
    const source = svcOf(r.source);
    const target = svcOf(r.target);
    if (fleetDrawsJourneys && r.op !== undefined && source !== target && !drawn.has(r)) {
      findings.push({
        severity: "warn",
        code: "flow.unrepresented",
        subject: target,
        message:
          `delta adds ${source} → ${target} calling '${r.op}', and no step of a dynamic view this ` +
          "delta draws carries it — the fleet's journey map will not show where this call happens, " +
          "and nothing else asks it to. Draw the step in a dynamic view in delta.likec4 tagged with " +
          "the feature id; archive merges it into the fleet's journeys. One step drawn between two " +
          "services carries every relationship declared between them, so drawing this pair once " +
          "answers for every operation on it — and, equally, an operation added between a pair some " +
          "drawn step already joins is never named here",
      });
    }
    if (baseEdges.has(edgeKey(source, target))) continue;
    if (activeCovers.some((c) => coversEdge(c, r, elements, known))) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: target,
      message: `delta adds edge ${source} → ${target} ("${r.title ?? ""}") but no arch requirement covers it — add 'Covers: ${r.source} -> ${r.target}' to a specs/<svc>/arch.spec.md delta`,
    });
  }

  // covers.unknown, feature scope — the resolution phase, in ./covers-scope.ts.
  // Guarded here rather than there because this is where the living landscape
  // is loaded: a delta whose arch requirements write no `Covers:` line at all
  // must not pay for the parse, and the guard is the only thing that knows.
  if (archDeltas.some(({ reqs }) => coversEntries(reqs).length > 0)) {
    const land = await livingLandscape();
    findings.push(
      ...(await coversScopeFindings({
        docsDir,
        archDeltas,
        delta: { elements, relationships, flows },
        fleetFlows,
        living: land !== null && land.errors.length === 0 ? land : null,
        known,
        fleet,
      })),
    );
  }

  return findings;
}

/** Heuristic: an edge is "covered" if a scenario names the target or a keyword from the edge title. */
function edgeCovered(target: string, title: string | undefined, scenarioText: string): boolean {
  if (scenarioText.includes(target.toLowerCase())) return true;
  for (const token of (title ?? "").split(/[^A-Za-z0-9]+/)) {
    if (token.length >= 5 && scenarioText.includes(token.toLowerCase())) return true;
  }
  return false;
}
