/**
 * The fleet target: `services/` and architecture/landscape.likec4 graded
 * against each other, plus the two exemptions that decide which drawn element
 * answers for a service directory at all.
 *
 * The landscape is the one artifact no service owns — parsed once for the whole
 * run and graded on a target of its own, outside the dispatcher's `guarded`.
 * That is why its IO containment lives in this package instead: see
 * `unreadableLandscape` in `./load.ts`.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { readFile } from "node:fs/promises";
import { loadFile, type Elem, type LoadedDoc } from "../../../core/c4/likec4.js";
import { serviceResolver } from "../../../core/c4/resolve/service.js";
import { landscapePath as landscapeFile, servicePathsAt } from "../../../core/repo/paths.js";
import { readModelShapes } from "../../../core/c4/service-model/shape.js";
import { serviceIdFindings } from "../../../core/repo/entries.js";
import { listFleetTree, listServices } from "../../../core/repo/repo.js";
import { type Finding, type TargetReport } from "../../../core/vocabulary/report.js";
import { landscapeConflictFinding } from "../../../core/conflict-markers.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { capabilityFleetFindings, fleetShapeFindings, permissionFindings } from "../checks/fleet-shape.js";
import { fleetLinkFindings } from "../links/corpus.js";
import { glossaryFindings } from "../links/glossary.js";
import { obligationFindings, obligationVocabularyFindings } from "./obligations.js";
import { readObligations } from "../../../core/obligations/obligations.js";
import { obligationsPath } from "../../../core/repo/paths.js";
import { EXTERNAL_TAG } from "../../../core/vocabulary/maturity.js";
import { errorText } from "../../../core/c4/likec4.js";
import { serviceTreePath, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { drawnSystems, serviceLevelElements, standsForService } from "./census.js";
import { unreadableLandscape } from "./load.js";
import { kindTagFindings } from "./kind-tags.js";
import { mapAttestation } from "./map/attest.js";
import { bindingFindings } from "./map/bindings.js";
import { consumerCensus, datastoreFindings } from "./map/consumers.js";
import { isolationFindings } from "./map/isolation.js";
import { fleetUseCaseFindings } from "./map/usecases.js";
import { viewIdFindings } from "./views/ids.js";
import { viewsStaleFindings } from "./views/stale.js";
import { projectFindings } from "./views/projects.js";
import { fleetProjectFindings } from "./views/fleet-project.js";
import type { ParsedView } from "../../../core/c4/parsed/dynamic-views.js";
import { isUseCase } from "../../../core/usecases/fleet.js";

/**
 * The fleet's flows as a grade may read them, or `null` when loam cannot see
 * them at all — the same `null`-suspends idiom `gradableCapabilityIds` uses,
 * and here it guards one specific wrong answer.
 *
 * `capability.requirement-unrealized` says a business promise is kept by
 * nobody. A use case is one of the two things that can keep it, so a run that
 * could not read the flows must not make that claim: no preload (a single-target
 * run) and a project that did not parse are both "loam did not look", never
 * "there is nothing there". A preload that DID parse and declares no views is a
 * real, empty answer and grades normally.
 *
 * Filtered through `isUseCase` — the same opt-in `readUseCases` applies before
 * `loam list capabilities` asks this question — because the two surfaces must
 * never disagree about `keptBy`. Handing the unfiltered preload over was
 * harmless only by luck: an untagged view yields no claims, so the answers
 * matched for want of an input that could tell them apart. A `#req-`-only view
 * is exactly that input.
 */
function gradableFlows(preloaded: LoadedDoc | null | undefined): readonly ParsedView[] | null {
  if (preloaded === null || preloaded === undefined || preloaded.errors.length > 0) return null;
  return (preloaded.views ?? []).filter(isUseCase);
}

/**
 * The fleet cross-check: `services/` and the landscape both claim to name the
 * fleet, and nothing used to compare them. A directory nobody drew and an element
 * with nothing behind it were equally invisible.
 *
 * The two directions are graded differently because the evidence differs. A
 * directory that exists is a fact, so a landscape missing it is an error — every
 * view derived from that landscape is then incomplete. An element with no
 * directory may legitimately be someone else's system, so it warns, and
 * `#external` says "deliberately not ours" and silences it. An explicit
 * `metadata { service '<id>' }` naming nothing is an error either way: a binding
 * is a claim about this repo, not a guess at one.
 *
 * An ABSENT landscape is a finding, not a skipped check. It used to return null
 * — no target, no findings, and a fleet gate that went green over a docs repo
 * with no fleet map at all, which is the single artifact every derived view and
 * every spine check is computed from. It is graded by what its absence proves:
 * with services in `services/` it is an ERROR (a fleet that exists is undrawn),
 * with none it is a WARNING (a docs repo before its first adopt legitimately
 * has nothing to draw, but the file still belongs there — `loam init` scaffolds
 * it, and a repo missing it will silently accept never getting one).
 *
 * `preloaded` is the already-parsed landscape under --all — the same doc every
 * service check gets.
 */
export async function validateLandscape(
  docsDir: DocsDir,
  preloaded?: LoadedDoc | null,
  fleet?: FleetContext,
): Promise<TargetReport> {
  const path = landscapeFile(docsDir);
  const findings: Finding[] = [];
  const report: TargetReport = {
    kind: "landscape",
    id: "landscape",
    path: "architecture/landscape.likec4",
    findings,
  };

  // The SET of service directories is this target's other subject, so it is
  // graded before the map is even opened: `service.id-invalid` is a fact about
  // `services/` that holds whether or not a landscape exists or parses, and
  // both of those return early below. Emitted here and nowhere else — the
  // enumeration is what makes the id a question, and one finding per fleet is
  // what the rename fixes.
  const entries = await listServices(docsDir, fleet);
  findings.push(...serviceIdFindings(entries));
  // The tree walk's own findings ride the same fleet target, before the map's
  // early returns for the same reason `service.id-invalid` does: a stranded,
  // colliding or mismarked directory is a fact about `services/` that holds
  // whether or not a landscape exists or parses — and a broken tree must make
  // the fleet gate refuse while still naming every service it found.
  const tree = await listFleetTree(docsDir, fleet);
  findings.push(...tree.findings);
  // Which SHAPE each model has, read once for the whole target: it decides four
  // of the grades below (`views/projects.ts`) and which documents the merged
  // project holds (`views/fleet-project.ts`). Over the full enumeration, which
  // is what `entries` is here even under `--base` — `validate --all` narrows the
  // TARGETS it grades and never the fleet the renderer would load.
  const models = entries.map((entry) => servicePathsAt(entry.dir).model);
  const shapes = fleet === undefined ? await readModelShapes(models) : await fleet.modelShapes(models);
  // A model and the renderer's project files disagreeing is a fact about
  // `services/` too, graded here for `service.id-invalid`'s reason: it holds
  // whether or not the map parses. One warning per service per disagreement;
  // views/projects.ts says why a warning, why this run and not `doctor`, why
  // the root-file gate, and why the grade is KEPT rather than spread and
  // dropped — one of the five gates the merged-project load below, and
  // re-deriving that fact there would let a cause and its 161-warning cascade
  // disagree about which state the run is in.
  const projects = await projectFindings(docsDir, entries, shapes);
  findings.push(...projects.findings);
  // Before the landscape's own early returns: the authorization and capability
  // vocabularies are fleet facts that do not depend on the map existing or parsing.
  findings.push(...(await permissionFindings(docsDir, entries, fleet)));
  findings.push(...(await capabilityFleetFindings(docsDir, entries, fleet, gradableFlows(preloaded))));
  // The documents that belong to no service and no feature — the fleet's ADRs
  // and the living capability tree — are graded for their links here, once,
  // for the same reason the two vocabularies above are: a fleet fact repeated
  // on every service target is the report.
  findings.push(...(await fleetLinkFindings({ docsDir, fleet })));
  // The glossary is graded on who cites it, which is a question only the whole
  // repository answers — so it belongs here, beside the two vocabularies, and
  // nowhere else.
  findings.push(...(await glossaryFindings(docsDir, fleet)));
  // The architectural obligation vocabulary, read ONCE here and handed to the
  // map half below: its own two verdicts hold whether or not the landscape
  // exists or parses, and a run where somebody is fixing the map must still be
  // told that this file does not read.
  const obligations = await readObligations(obligationsPath(docsDir));
  findings.push(...obligationVocabularyFindings(docsDir, obligations));

  if (!existsSync(path)) {
    const count = entries.length;
    findings.push({
      severity: count > 0 ? "error" : "warn",
      code: "landscape.missing",
      message:
        `landscape: architecture/landscape.likec4 does not exist — ` +
        (count > 0
          ? `${count} service(s) are adopted and nothing draws the fleet. `
          : "nothing draws the fleet. ") +
        "It is the one map every derived view and the C4↔API spine are computed from: " +
        "write a `specification { element softwareSystem }` + `model { … }` document there " +
        "with one element per services/<id>/, bound with `metadata { service '<id>' }`.",
    });
    return report;
  }

  // Conflict markers before the parse — `loam doctor`'s order, and for its
  // reason: the markers are the cause and the parse errors are the cascade.
  // Nothing may be concluded from a file that is two halves of two different
  // maps, least of all that a service nobody drew is unmodelled, so this
  // returns the way `landscape.invalid` does. An error, gating by the default
  // rule and deliberately not carrying `gates` — that field is coherence's,
  // and the archive gate has to ask this question itself (it does not yet).
  // Read plainly rather than through FleetContext: this target runs outside
  // `guarded`, and a document refused for its encoding would surface here as
  // the whole run's `repository-unavailable` instead of one finding.
  //
  // Both reads are contained for that same reason — see `unreadableLandscape`.
  // The conflict-marker read is the FIRST touch of the file, so it is the one
  // that fails when the file cannot be opened at all, and it runs before
  // `preloaded ??` can spare it.
  let land: LoadedDoc;
  try {
    const conflict = landscapeConflictFinding(
      "architecture/landscape.likec4",
      await readFile(path, "utf8"),
    );
    if (conflict !== null) {
      findings.push(conflict);
      return report;
    }
    land = preloaded ?? (fleet === undefined ? await loadFile(path) : await fleet.loadLikeC4(path));
  } catch (err) {
    land = unreadableLandscape(err);
  }
  if (land.errors.length > 0) {
    // Nothing may be concluded from a document that did not parse — in particular
    // not that every service is unmodelled.
    //
    // The fleet map is a PROJECT now, not a file: `architecture/landscape.likec4`
    // plus every `architecture/usecases/*.likec4`, merged the way the renderer
    // merges them. So the message names the FILES that broke rather than the
    // landscape by default — a use case with a typo'd element used to be
    // reported as the landscape having errors, which sent the author to the
    // wrong file with a line number that pointed at somebody else's text.
    const broken = [...new Set(land.errors.map((e) => e.sourceFsPath).filter((p): p is string => p !== undefined))];
    const spell = (abs: string): string => relative(docsDir, abs).split(/[\\/]/).join("/");
    const named = broken.length === 0 ? "architecture/landscape.likec4" : broken.map(spell).sort().join(", ");
    // The verb agrees with the LIST, not with the count after it: `named` is a
    // comma-joined series once two documents broke, and "a, b has 6 error(s)"
    // is a sentence a reader trips over. The service arm (`service/spine.ts`)
    // picks the verb the same way off the same list, and these two messages are
    // read side by side in one report — a run where the fleet line says "has"
    // and the service line says "have" about the same two files reads as two
    // different findings.
    const verb = broken.length > 1 ? "have" : "has";
    findings.push({
      severity: "error",
      code: "landscape.invalid",
      // The tail is general on purpose. It used to speak about use-case flows
      // alone, so an author whose MODEL EDGE named a container was told to move
      // a flow that does not exist (#01). Both shapes are the same defect: loam
      // grades the `architecture/` project, the renderer loads that project plus
      // every extending model, and a reference to a container only the model
      // declares therefore resolves there and not here.
      message:
        `landscape: ${named} ${verb} ${land.errors.length} error(s) — cross-check with services/ impossible. ` +
        "An unresolved name that a service's extending model declares — a use-case hop or an edge " +
        "naming `<service-fqn>.<container>` — renders for the renderer and resolves for nobody here: " +
        "name the SERVICE on the map, and the container in that service's own model (a container-level " +
        "flow lives beside the model that declares it)",
      // Every line carries its own file, because one project's errors can come
      // from more than one document and a bare `L8:` is unactionable then.
      details: land.errors.map((e) =>
        e.sourceFsPath === undefined || broken.length < 2 ? errorText(e) : `${spell(e.sourceFsPath)} ${errorText(e)}`,
      ),
    });
    return report;
  }

  // The generated subsystem views, graded only now that the landscape has
  // parsed: the expected bytes are a function of (tree, landscape elements,
  // the global style ids the map declares) — the whole doc goes across so the
  // grader and `sync` read one record; `views/stale.ts` says why a byte
  // compare and why exactly one finding.
  findings.push(...(await viewsStaleFindings(docsDir, tree, land)));
  // The renderer's own reading of the tree: the map, every extending model and
  // every `.likec4` beside one, merged into ONE project. It answers two
  // questions at once and only one of them can be true at a time — either that
  // project does not parse (`c4.fleet-project-invalid`), or it parsed and its
  // view-id census is the real one.
  const merged = fleet === undefined
    ? { kind: "skipped" as const }
    : await fleetProjectFindings({
        docsDir, entries, shapes, fleet, tree,
        architecture: land,
        mapExcluded: projects.mapExcluded,
        known: new Set(entries.map((s) => s.id)),
      });
  if (merged.kind === "invalid") findings.push(...merged.findings);
  // Beside staleness, and for the same file: an authored view id that collides
  // with one loam mints into it takes the whole root project down in the
  // renderer while every check here stays green — see views/ids.ts. The census
  // is the merged project's when there is one; otherwise the `architecture/`
  // project's alone, whose claims are spelled relative to that directory and are
  // made docs-relative here.
  findings.push(
    ...viewIdFindings(
      merged.kind === "clean"
        ? merged.viewIds
        : land.viewIds?.map((claim) => ({ ...claim, sourcePath: `architecture/${claim.sourcePath}` })),
      tree,
    ),
  );
  // The three obligation questions that need the map — where each declared rule
  // is applied, which tags resolve to nothing, and which applications no living
  // arch requirement covers. Here rather than beside the vocabulary above
  // because all three are about the parsed landscape, and `land` is only
  // trustworthy past this point.
  findings.push(...(await obligationFindings({ docsDir, vocabulary: obligations, land, services: entries, fleet })));

  const services: ReadonlySet<string> = new Set(entries.map((s) => s.id));
  // Where each service actually sits, for every finding below that names a
  // directory a reader is meant to open. `services/<id>/` is right only for an
  // unfiled fleet; a filed service lives at `services/<subsystem>/…/<id>/`, and
  // a finding pointing at the root form sends the fix to a path that does not
  // exist. Built once here because three checks below need the same answer.
  const pathOf = (id: string): string => {
    const entry = entries.find((s) => s.id === id);
    return entry === undefined ? `services/${id}` : serviceTreePath(entry);
  };
  // Ahead of every exemption below, because it is the one defect that can make
  // all of them lie at once: a tag loam grades on, declared on a KIND, landing
  // on an element that stands for one of our own directories — see kind-tags.ts.
  findings.push(...kindTagFindings({ specification: land.specification, elements: land.elements, services }));
  const drawn = serviceLevelElements(land.elements, services);
  // Which services the landscape models, answered by the same resolver every
  // edge join uses — so "modelled" here and "inbound edge" in the spine check
  // can never disagree about what an element stands for.
  const landSvcOf = serviceResolver(land.elements, services);
  const modelled: ReadonlySet<string> = new Set(land.elements.map((e) => landSvcOf(e.id)));
  // The same set with `#external` removed — the isolation check's input, and
  // NOT `service-unmodelled`'s: a foreign box bound to one of our directories
  // still means the directory is drawn, but "deliberately not ours" must not
  // make it a subject of an advisory about our own map (R4/W12). The two
  // binding passes have always skipped the tag; this is the third.
  const external: ReadonlySet<string> = new Set(
    land.elements.filter((e) => e.tags.includes(EXTERNAL_TAG)).map((e) => e.id),
  );
  const ours: ReadonlySet<string> = new Set(
    land.elements.filter((e) => !external.has(e.id)).map((e) => landSvcOf(e.id)),
  );

  // The element↔directory passes: two boxes for one directory, a directory
  // nobody drew, a binding naming nothing, and an element nobody owns.
  const systems = drawnSystems(land.elements, services);
  findings.push(...bindingFindings({ elements: land.elements, drawn, systems, services, modelled, pathOf }));

  // What the fleet's own models say, read once for the two checks below that
  // need it: a map edge is not the only evidence that a service consumes
  // something, nor the only evidence that it calls out (map/attest.ts).
  const drawnIds: ReadonlySet<string> = new Set(drawn.map((e) => e.id));
  // `census.ts`'s predicate, handed down rather than respelled: a `fleet/map/`
  // module may not import `fleet/`, and the store grades were skipping a
  // datastore that IS a service in one of their two halves only.
  const isService = (e: Elem): boolean => standsForService(e, services);
  const attestation = await mapAttestation({
    docsDir,
    entries,
    services,
    resolve: landSvcOf,
    standsForService: isService,
    drawnIds,
    ...(fleet === undefined ? {} : { fleet }),
  });
  const attested = attestation.models;
  const consumers = consumerCensus({ relationships: land.relationships, services, resolve: landSvcOf, attested });
  // The shape advisories run LAST, over the same drawn set and resolver the
  // structural checks used. Any one of them suppresses `landscape.matched`
  // below on purpose: a map with a shape warning did not fully "agree".
  findings.push(...fleetShapeFindings({ drawn, services, consumers }));
  const { nestedStores } = attestation;
  findings.push(
    ...datastoreFindings({
      drawn,
      elements: land.elements,
      nestedStores,
      services,
      resolve: landSvcOf,
      standsForService: isService,
      attested,
      consumers,
      pathOf,
    }),
  );
  // A drawn service nothing reaches, graded only where its own model attests
  // a call across its boundary — map/isolation.ts says why the evidence gate.
  findings.push(...isolationFindings({ land, modelled: ours, external, attested, resolve: landSvcOf, pathOf }));

  // The use cases the SAME `architecture/` project declares — every
  // `dynamic view` in the landscape and in every `architecture/usecases/*.likec4`
  // — graded against the model above (`map/usecases.ts` holds the call and the
  // two vocabulary reads it needs; `usecases/usecases.ts` owns the opt-in and
  // the grades). They ride this target for `viewsStaleFindings`' reason: a view
  // belongs to no service, and only the fleet run has both the whole model and
  // the enumerated `services/` in view at once.
  findings.push(
    ...(await fleetUseCaseFindings({
      docsDir,
      views: preloaded?.views ?? [],
      elements: land.elements,
      relationships: land.relationships,
      services,
      resolve: landSvcOf,
      fleet,
    })),
  );

  if (findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "landscape.matched",
      message: `landscape: ${services.size} service(s) modelled — architecture/landscape.likec4 and services/ agree`,
    });
  }
  return report;
}
