/**
 * Whether the architecture a delta INTRODUCES is covered by a requirement that
 * will actually merge.
 *
 * Three findings, one question asked three ways: `archedge.uncovered` (a
 * scenario names the new edge — heuristic, warn-only), `c4.uncovered` (an
 * arch.spec.md requirement covers the new element or edge — mechanical), and
 * `covers.unknown` (the `Covers:` line resolves to something real). This is
 * where agent-built code cuts its corners — the outbox, the retries, the alerts
 * — because no business scenario was ever going to mention them.
 *
 * Split out of `validateFeature` because it is the only part of the feature
 * target that needs the LIVING landscape: everything else there reads the
 * feature directory alone. Keeping the lazy load and its two exemption sets in
 * one module is what stops "new" being decided differently in three places.
 */
import { existsSync } from "node:fs";
import { type Elem, type LoadedDoc, type Rel } from "../../core/c4/likec4.js";
import { elementService, serviceResolver } from "../../core/c4/resolve/service.js";
import { groupsServices } from "../../core/c4/resolve/systems.js";
import { type PathableService } from "../../core/kernel/ids/service.js";
import { landscapePath as landscapeFile } from "../../core/repo/paths.js";
import { locateServicePaths } from "../../core/repo/service-target.js";
import { enumeratedServiceIds } from "../../core/repo/service-target.js";
import { type Finding } from "../../core/vocabulary/report.js";
import { type Requirement } from "../../core/document/spec.js";
import { coversEdge, coversElement, coversEntries, type CoverageScope } from "../../core/c4/arch.js";
import { readHealth } from "../../core/vocabulary/health.js";
import { FleetContext } from "../../core/fleet-context.js";
import { ACTOR_KINDS, EXTERNAL_TAG } from "../../core/vocabulary/maturity.js";
import { coversUnknownFindings } from "./checks/requirements.js";
import { deltaSpelledCovers, mergedMapOf, survivingEdgeCover, survivingElementCover } from "./coverage/covers-after.js";
import type { DocsDir, FeatureDir } from "../../core/kernel/ids/dirs.js";

/** One feature delta's architecture, and everything needed to decide what in it is new. */
export interface DeltaArch {
  docsDir: DocsDir;
  /** The feature itself — what the merge preview a `Covers:` line is checked against is computed from. */
  featureDir: FeatureDir;
  featureId: string;
  /** Every element the delta declares — the resolver's index, and `coversEdge`'s scope. */
  elements: Elem[];
  /** Every relationship the delta declares. */
  relationships: Rel[];
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
  /**
   * The read index the service models below are read through. Required, for
   * `validateService`'s reason: `serviceModel` needs the enumeration and a
   * document memo to answer at all. Every validate mode builds one before it
   * grades anything — `--feature` included (`validate.ts`) — so there is no
   * second, unmemoised reading rule here for a run that arrived without one.
   */
  fleet: FleetContext;
}

export async function deltaArchCoverage(delta: DeltaArch): Promise<Finding[]> {
  const {
    docsDir,
    featureDir,
    featureId,
    elements,
    relationships,
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
  // The map this feature's merge would leave, parsed at most once and only when
  // a hint or a `Covers:` line needs it (./coverage/covers-after.ts says when).
  const merged = mergedMapOf({ docsDir, featureDir, featureId, fleet, known });

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
  // (person kinds, #external) — one set, in core/vocabulary/maturity.ts, so
  // "not a service" cannot mean two things — and so does a GROUPING, an element
  // that stands for no service and contains one (core/c4/resolve/systems.ts).
  // A new domain drawn around a new service was asked for a `Covers:` line of
  // its own: there is no obligation a group can carry, and the service inside
  // it is graded on its own. Warnings, never archive gates; `--strict`
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
      living = existsSync(lp) ? await fleet.loadLikeC4(lp) : null;
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
    if (ACTOR_KINDS.has(e.kind.toLowerCase()) || e.tags.includes(EXTERNAL_TAG) || groupsServices(e, elements, known)) continue;
    if (baseIds.has(e.id) || baseServices.has(elementService(e))) continue;
    if (activeCovers.some((c) => coversElement(c, e))) continue;
    // Spelled in the space it will live in, the line covers it too: the id the
    // merge gives an element is the one the hint below recommends.
    const cover = await survivingElementCover(e, { svcOf, known }, merged);
    if (activeCovers.some((c) => c.form === "element" && c.id === cover)) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: elementService(e),
      message: `delta adds '${e.title}' (${e.id}) but no arch requirement covers it — add 'Covers: ${cover}' to a specs/<svc>/arch.spec.md delta, or its architectural obligations ship unchecked`,
    });
  }
  for (const r of taggedRels) {
    if (baseEdges.has(edgeKey(svcOf(r.source), svcOf(r.target)))) continue;
    if (activeCovers.some((c) => coversEdge(c, r, elements, known))) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: svcOf(r.target),
      message: `delta adds edge ${svcOf(r.source)} → ${svcOf(r.target)} ("${r.title ?? ""}") but no arch requirement covers it — add 'Covers: ${survivingEdgeCover(r, svcOf)}' to a specs/<svc>/arch.spec.md delta`,
    });
  }

  // covers.unknown, feature scope. Resolution looks at the delta itself, the
  // living landscape, the service's own model and its health.yaml — a delta's
  // arch requirement may cover an element it adds, one that already exists, or
  // an alert the service declares. The landscape and each model are loaded
  // lazily, and only when an entry fails against what is already in hand: the
  // clean path never pays for a workspace spin.
  if (archDeltas.some(({ reqs }) => coversEntries(reqs).length > 0)) {
    const land = await livingLandscape();
    const landParses = land !== null && land.errors.length === 0 ? land : null;
    const baseElements = [...elements, ...(landParses?.elements ?? [])];
    const baseRels = [...relationships, ...(landParses?.relationships ?? [])];
    // A feature never brings topology through `delta.likec4` — a `deployment { }`
    // block in one is refused by the merge — so the living map is the whole
    // scope for a `node:` entry in a delta, exactly as it is in service scope.
    const baseDeployment = landParses?.deployment;
    for (const { service: svc, reqs } of archDeltas) {
      // An unreadable living health.yaml mutes the alert:/sli: entries here
      // exactly as in service scope — the health.invalid finding itself
      // belongs to the service target, which owns the file's diagnosis.
      const svcPaths = await locateServicePaths(docsDir, svc, fleet);
      const health = await readHealth(svcPaths.health);
      // Through the ONE reader of `model.likec4`: a model that EXTENDS the map
      // is not a file this could open, and reading it as one would answer with
      // a pile of parse errors — which this arm reads as "no widening", so
      // every `Covers:` line naming a container of a migrated service would be
      // convicted as a typo. `mapUnreadable` is the same silence for the same
      // reason: nothing may widen a scope out of a document nobody could read.
      // Read at most once, and only when a line needs it.
      let modelRead: Promise<{ elements: Elem[]; relationships: Rel[] }> | undefined;
      const model = (): Promise<{ elements: Elem[]; relationships: Rel[] }> =>
        (modelRead ??= (async () => {
          const m = existsSync(svcPaths.model) ? await fleet.serviceModel(docsDir, svcPaths) : null;
          return m !== null && !m.mapUnreadable && m.doc.errors.length === 0
            ? { elements: m.doc.elements, relationships: m.doc.relationships }
            : { elements: [], relationships: [] };
        })());
      let scope: CoverageScope = {
        elements: baseElements,
        relationships: baseRels,
        ...(baseDeployment === undefined ? {} : { deployment: baseDeployment }),
        health: health.ids,
        known,
      };
      const unresolved = coversUnknownFindings(reqs, { where: `${svc}: arch.spec.md`, subject: svc }, scope, health.unreadable);
      if (unresolved.length > 0) {
        const m = await model();
        // Widened, never narrowed: the topology rides along. Rebuilding the
        // record without it convicted every `node:` entry as a typo the moment
        // another entry beside it sent the scope here.
        scope = {
          ...scope,
          elements: [...baseElements, ...m.elements],
          relationships: [...baseRels, ...m.relationships],
        };
        // The map the merge would leave widens it last, and only for a line still
        // unresolved: one spelled the way the living map will spell an element
        // this feature adds resolves there and nowhere else yet — and it is the
        // spelling the hints recommend.
        const after = coversUnknownFindings(reqs, { where: svc, subject: svc }, scope, health.unreadable).length > 0 ? (await merged())?.doc : undefined;
        if (after !== undefined) {
          scope = { ...scope, elements: [...scope.elements, ...after.elements], relationships: [...scope.relationships, ...after.relationships] };
        }
        findings.push(...coversUnknownFindings(reqs, { where: `${svc}: arch.spec.md`, subject: svc }, scope, health.unreadable));
      }
      // And the lines that DID resolve, read in the space they will live in:
      // one that answered only through the delta's own ids is `covers.unknown`
      // the moment the archive lands it (./coverage/covers-after.ts).
      findings.push(
        ...(await deltaSpelledCovers({
          service: svc,
          reqs,
          featureScope: scope,
          living: { elements: landParses?.elements ?? [], relationships: landParses?.relationships ?? [] },
          model,
          elements,
          svcOf,
          merged,
        })),
      );
    }
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
