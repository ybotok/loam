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
import { elementService, serviceResolver } from "../../../core/c4/resolve/service.js";
import { landscapePath as landscapeFile } from "../../../core/repo/paths.js";
import { serviceIdFindings } from "../../../core/repo/entries.js";
import { listFleetTree, listServices } from "../../../core/repo/repo.js";
import { type Finding, type TargetReport } from "../../../core/vocabulary/report.js";
import { landscapeConflictFinding } from "../../../core/conflict-markers.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { capabilityFleetFindings, fleetShapeFindings, permissionFindings } from "../checks/fleet-shape.js";
import { EXTERNAL_TAG } from "../../../core/vocabulary/maturity.js";
import { errorText } from "../checks/vocabulary.js";
import { serviceTreePath, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { drawnSystems, serviceLevelElements } from "./census.js";
import { unreadableLandscape } from "./load.js";
import { kindTagFindings } from "./kind-tags.js";
import { useCaseFindings } from "./usecases/usecases.js";
import { viewIdFindings } from "./views/ids.js";
import { viewsStaleFindings } from "./views/stale.js";
import { readCapabilities } from "../../../core/capabilities/capabilities.js";
import { gradableCapabilityIds } from "../../../core/capabilities/findings.js";
import { capabilitiesPath } from "../../../core/repo/paths.js";

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
  const report: TargetReport = { kind: "landscape", id: "landscape", findings };

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
  // Before the landscape's own early returns: the authorization and capability
  // vocabularies are fleet facts that do not depend on the map existing or parsing.
  findings.push(...(await permissionFindings(docsDir, entries, fleet)));
  findings.push(...(await capabilityFleetFindings(docsDir, entries, fleet)));

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
    findings.push({
      severity: "error",
      code: "landscape.invalid",
      message: `landscape: ${named} has ${land.errors.length} error(s) — cross-check with services/ impossible`,
      // Every line carries its own file, because one project's errors can come
      // from more than one document and a bare `L8:` is unactionable then.
      details: land.errors.map((e) =>
        e.sourceFsPath === undefined || broken.length < 2 ? errorText(e) : `${spell(e.sourceFsPath)} ${errorText(e)}`,
      ),
    });
    return report;
  }

  // The generated subsystem views, graded only now that the landscape has
  // parsed: the expected bytes are a function of (tree, landscape elements) —
  // `views/stale.ts` says why a byte compare and why exactly one finding.
  findings.push(...(await viewsStaleFindings(docsDir, tree, land.elements)));
  // Beside staleness, and for the same file: an authored view id that collides
  // with one loam mints into it takes the whole architecture/ project down in
  // the renderer while every check here stays green — see views/ids.ts.
  findings.push(...viewIdFindings(land.viewIds, tree));

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
    if (modelled.has(id)) continue;
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
  for (const e of land.elements) {
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
  for (const e of drawnSystems(land.elements, services)) {
    if (e.service !== undefined) continue; // graded by the binding pass above
    if (services.has(e.title)) continue;
    findings.push({
      severity: "warn",
      code: "landscape.service-undocumented",
      subject: e.title,
      message: `landscape: '${e.title}' has no services/${e.title}/ — bind it with metadata { service '<id>' }, or tag it #${EXTERNAL_TAG} if it is not ours`,
    });
  }

  // The shape advisories run LAST, over the same drawn set and resolver the
  // structural checks used. Any one of them suppresses `landscape.matched`
  // below on purpose: a map with a shape warning did not fully "agree".
  findings.push(
    ...fleetShapeFindings({ drawn, relationships: land.relationships, services, resolve: landSvcOf, pathOf }),
  );

  // The use cases the SAME `architecture/` project declares — every
  // `dynamic view` in the landscape and in every `architecture/usecases/*.likec4`
  // — graded against the model above (usecases/usecases.ts owns the opt-in and
  // the grades). They ride this target for `viewsStaleFindings`' reason: a view
  // belongs to no service, and only the fleet run has both the whole model and
  // the enumerated `services/` in view at once.
  //
  // The views come from `preloaded` rather than from `land`, and that is the
  // file-naming rule made mechanical instead of remembered: only the PROJECT
  // load gives a view the `sourcePath` a finding has to name, while the
  // single-file fallback a few lines above calls every document `source.c4` —
  // so a message built from that load would send its reader to
  // `architecture/source.c4`, a file that has never existed. No preload, no
  // grading, and nothing to get wrong.
  //
  // Read second, and the ladder APPLIED BY ITS OWN FUNCTION rather than
  // re-spelled here: an absent or unreadable capabilities.yaml means silence for
  // the whole family, not a fleet full of unresolved tags, so `null` travels
  // rather than an empty list — which the join would read as "the fleet declares
  // no capabilities" and grade every tag against. `gradableCapabilityIds` is the
  // one statement of that rule (`core/capabilities/findings.ts`), and this is a
  // caller of it precisely so a fourth un-gradable vocabulary state cannot be
  // fixed in core while the command layer keeps handing the join a whole key set.
  // `capabilityFleetFindings` above has already paid for this read through the
  // fleet context's memo.
  const vocabulary =
    fleet === undefined
      ? await readCapabilities(capabilitiesPath(docsDir))
      : await fleet.capabilities(capabilitiesPath(docsDir));
  findings.push(
    ...useCaseFindings({
      views: preloaded?.views ?? [],
      elements: land.elements,
      relationships: land.relationships,
      services,
      resolve: landSvcOf,
      capabilities: gradableCapabilityIds(vocabulary),
    }),
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
