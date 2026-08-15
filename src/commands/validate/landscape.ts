/**
 * The fleet target: `services/` and architecture/landscape.likec4 graded
 * against each other, plus the two exemptions that decide which drawn element
 * answers for a service directory at all.
 *
 * The landscape is the one artifact no service owns — parsed once for the whole
 * run and graded on a target of its own, outside the dispatcher's `guarded`.
 * That is why its IO containment lives here instead: see `unreadableLandscape`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  elementService,
  loadFile,
  serviceResolver,
  type Elem,
  type LoadedDoc,
} from "../../core/c4/likec4.js";
import { landscapePath as landscapeFile } from "../../core/repo/paths.js";
import { listServices, serviceIdFindings } from "../../core/repo/repo.js";
import { type Finding, type TargetReport } from "../../core/vocabulary/report.js";
import { FleetContext, landscapeConflictFinding } from "../../core/fleet-context.js";
import { errorText } from "./report.js";

/** C4 kinds that model people. A person is never a service directory. */
export const ACTOR_KINDS = new Set(["person", "actor", "user"]);

/** Tag marking an element as somebody else's system — undocumented on purpose. */
export const EXTERNAL_TAG = "external";

/**
 * A landscape that could not be READ, shaped as one that did not PARSE.
 *
 * The landscape is the one artifact no target owns: it is read once for the
 * whole run and it is graded on a target of its own, which runs OUTSIDE
 * `guarded`. So a landscape.likec4 that is a directory, or that carries a
 * permission bit this process cannot open, escaped every per-target catch and
 * became the whole run's `repository-unavailable` — one file, and a fleet gate
 * that said nothing about the ninety-nine services that are fine. A DANGLING
 * symlink is not one of those shapes and never was: every read of the file is
 * gated on an `existsSync` that follows the link, so a broken one resolves as
 * `landscape.missing` long before anything opens it.
 *
 * What this contains is the FLEET-level reads, and only those: the `--all`
 * preload, and both reads inside `validateLandscape` — the conflict-marker
 * `readFile` and the parse. `loam validate --service <id>` and
 * `loam validate --feature <id>` hand in no preloaded doc, so `validateService`
 * and `validateFeature` open the same file again on demand, unwrapped and
 * INSIDE `guarded`: an EISDIR there is still reported as `service.unreadable`
 * or `feature.unreadable`, which files the fleet map's failure against the one
 * target the caller happened to name. That is the wrong subject on a finding
 * that does at least carry the offending path, and it costs those runs nothing
 * further — they grade a single target either way, so there is no report left
 * unwritten — which is why the remainder was left for the change that gives the
 * landscape one load path instead of three.
 *
 * `guarded` is deliberately NOT widened to cover the landscape target instead.
 * Its code ternary knows only services and features, so it would file the fleet
 * map's failure as `feature.unreadable`; and a guarded failure yields no
 * document, so all N services would go on to re-open the same broken file
 * inside their own guards and emit N copies of it. Containing the IO here needs
 * no new code and no new sentence: "could not be read" and "did not parse" have
 * the same consequence — nothing may be concluded from this file — and
 * `landscape.invalid` is already how that is said.
 */
function unreadableLandscape(err: unknown): LoadedDoc {
  return {
    errors: [{ message: err instanceof Error ? err.message : String(err) }],
    elements: [],
    relationships: [],
  };
}

/** One landscape load, answering with `unreadableLandscape` rather than throwing. */
export async function readLandscape(load: () => Promise<LoadedDoc>): Promise<LoadedDoc> {
  try {
    return await load();
  } catch (err) {
    return unreadableLandscape(err);
  }
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
  docsDir: string,
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
    findings.push({
      severity: "error",
      code: "landscape.invalid",
      message: `landscape: architecture/landscape.likec4 has ${land.errors.length} error(s) — cross-check with services/ impossible`,
      details: land.errors.map(errorText),
    });
    return report;
  }

  const services: ReadonlySet<string> = new Set(entries.map((s) => s.id));
  // Depth is not a fact about a service. This used to keep only top-level
  // elements (`!e.id.includes(".")`), which ordinary C4 breaks the moment it
  // groups services under a parent: every nested element was thrown away, so a
  // bound service read as unmodelled — an ERROR, on every service in the fleet
  // — and a binding written one level down was never checked at all. The tree
  // is walked instead, the way `serviceResolver` walks it for edges: a binding
  // wins at any depth, then a title naming a real services/<id>/, and what sits
  // INSIDE one of those is that service's container, not a service of its own.
  const byId = new Map(land.elements.map((e) => [e.id, e]));
  /** Declared ancestors of an element, nearest first. */
  const ancestorsOf = (e: Elem): Elem[] => {
    const out: Elem[] = [];
    for (let dot = e.id.lastIndexOf("."); dot !== -1; dot = e.id.lastIndexOf(".", dot - 1)) {
      const parent = byId.get(e.id.slice(0, dot));
      if (parent !== undefined) out.push(parent);
    }
    return out;
  };
  const standsForService = (e: Elem): boolean => e.service !== undefined || services.has(e.title);
  /** Service-LEVEL elements: everything not drawn inside something that is already a service. */
  const drawn = land.elements.filter((e) => !ancestorsOf(e).some(standsForService));
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
      message: `landscape: services/${id}/ exists but nothing in architecture/landscape.likec4 models it — add an element, or bind one with metadata { service '${id}' }`,
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

  for (const e of drawn) {
    if (e.tags.includes(EXTERNAL_TAG)) continue;
    if (e.service !== undefined) continue; // graded by the binding pass above
    if (ACTOR_KINDS.has(e.kind.toLowerCase())) continue;
    if (services.has(e.title)) continue;
    // An element that CONTAINS a service is a grouping — a domain, a boundary,
    // an enterprise — not a service nobody adopted. There is nothing to bind on
    // it and nothing to tag #external, so asking for either would be a warning
    // with no correct fix; the services under it answer for themselves.
    if (land.elements.some((c) => c.id.startsWith(`${e.id}.`) && standsForService(c))) continue;
    findings.push({
      severity: "warn",
      code: "landscape.service-undocumented",
      subject: e.title,
      message: `landscape: '${e.title}' has no services/${e.title}/ — bind it with metadata { service '<id>' }, or tag it #${EXTERNAL_TAG} if it is not ours`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "landscape.matched",
      message: `landscape: ${services.size} service(s) modelled — architecture/landscape.likec4 and services/ agree`,
    });
  }
  return report;
}
