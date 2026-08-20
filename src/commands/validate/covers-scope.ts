/**
 * What a feature's `Covers:` entries are resolved AGAINST, and the per-service
 * retry that widens it — `covers.unknown` in feature scope.
 *
 * The phase boundary this sits on: `./arch-coverage.ts` decides what in a delta
 * is NEW and therefore owes an obligation, which needs the living landscape as
 * an exemption set. This module decides whether an entry somebody wrote RESOLVES
 * at all, which needs the living landscape as a haystack — plus each addressed
 * service's own model and health.yaml, neither of which the obligation half ever
 * opens. Two phases, two documents' worth of loading, and only one of them may
 * ever spin a per-service Langium workspace.
 *
 * The lazy landscape load stays with the caller on purpose: it owns the single
 * `LoadedDoc` both phases share, and loading it twice per feature was the
 * dominant cost `validate --all` was built to avoid.
 */
import { existsSync } from "node:fs";
import { loadFile, type LoadedDoc } from "../../core/c4/likec4.js";
import { type Flow } from "../../core/c4/flows/flow.js";
import { type Elem, type Rel } from "../../core/c4/model/model.js";
import { type PathableService } from "../../core/kernel/ids/service.js";
import { locateServicePaths } from "../../core/repo/service-target.js";
import { type Finding } from "../../core/vocabulary/report.js";
import { type Requirement } from "../../core/document/spec.js";
import { type CoverageScope } from "../../core/c4/arch.js";
import { readHealth } from "../../core/vocabulary/health.js";
import { FleetContext } from "../../core/fleet-context.js";
import { coversUnknownFindings } from "./checks/requirements.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

/** Everything a delta's `Covers:` entries may legitimately point at. */
export interface CoversScope {
  docsDir: DocsDir;
  /** Each addressed service's arch.spec.md delta, in enumeration order. */
  archDeltas: Array<{ service: PathableService; reqs: Requirement[] }>;
  /** The delta's own architecture: what this feature declares and draws. */
  delta: { elements: Elem[]; relationships: Rel[]; flows: Flow[] };
  /**
   * The fleet's journeys, read once by the fleet target under `--all` — what an
   * entry may point at besides the views the delta itself draws. EMPTY on a
   * `validate --feature <id>` run, which pays for no fleet parse.
   */
  fleetFlows: Flow[];
  /** The living landscape, when it exists and parsed; null otherwise. */
  living: LoadedDoc | null;
  /** The enumerated fleet — `services/` plus this feature's own `specs/` names. */
  known: ReadonlySet<string>;
  fleet?: FleetContext;
}

/**
 * Resolution looks at the delta itself, the living landscape, the service's own
 * model and its health.yaml — a delta's arch requirement may cover an element it
 * adds, one that already exists, or an alert the service declares. Each model is
 * loaded lazily, and only when an entry fails against what is already in hand:
 * the clean path never pays for a workspace spin.
 */
export async function coversScopeFindings(scope: CoversScope): Promise<Finding[]> {
  const { docsDir, archDeltas, delta, fleetFlows, living, known, fleet } = scope;
  const findings: Finding[] = [];
  const baseElements = [...delta.elements, ...(living?.elements ?? [])];
  const baseRels = [...delta.relationships, ...(living?.relationships ?? [])];
  // Flows follow elements: the delta's own views, the fleet's journeys and the
  // living landscape's own views, so a delta requirement may cover a journey
  // this feature draws or one the fleet already has — wherever the fleet stores
  // it. The landscape's own views stay in the union for the two states in which
  // `fleetFlows` is empty and the map's journeys are not: a
  // `validate --feature <id>` run, which never reads them, and a run where a
  // document under `architecture/flows/` did not parse. Where both are present
  // the fleet set already contains the map's views, and the duplicate costs
  // nothing (resolution is `some`, the hint de-duplicates). The per-service
  // model retry below unions the service's own views for the same reason it
  // unions its elements.
  const baseFlows = [...delta.flows, ...fleetFlows, ...(living?.flows ?? [])];
  for (const { service: svc, reqs } of archDeltas) {
    // An unreadable living health.yaml mutes the alert:/sli: entries here
    // exactly as in service scope — the health.invalid finding itself belongs to
    // the service target, which owns the file's diagnosis.
    const health = await readHealth((await locateServicePaths(docsDir, svc, fleet)).health);
    const where = { where: `${svc}: arch.spec.md`, subject: svc };
    let coverage: CoverageScope = { elements: baseElements, relationships: baseRels, flows: baseFlows, health: health.ids, known };
    const unresolved = coversUnknownFindings(reqs, where, coverage, health.unreadable);
    if (unresolved.length === 0) continue;
    const modelPath = (await locateServicePaths(docsDir, svc, fleet)).model;
    const model = existsSync(modelPath)
      ? fleet === undefined
        ? await loadFile(modelPath)
        : await fleet.loadLikeC4(modelPath)
      : null;
    if (model !== null && model.errors.length === 0) {
      coverage = {
        elements: [...baseElements, ...model.elements],
        relationships: [...baseRels, ...model.relationships],
        flows: [...baseFlows, ...model.flows],
        health: health.ids,
        known,
      };
    }
    findings.push(...coversUnknownFindings(reqs, where, coverage, health.unreadable));
  }
  return findings;
}
