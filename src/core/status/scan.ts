/**
 * Reading a feature's per-service deltas without grading them. Both status
 * forms draw on this one scan: it is how the artifact table and the fleet form
 * decide which services owe a contract, and where the scenario steps come from.
 */
import { existsSync } from "node:fs";
import { requirementsMissingScenarios, type Requirement } from "../document/spec.js";
import { repoPath } from "../envelope/json.js";
import type { FleetContext } from "../fleet-context.js";
import type { FeatureEntry } from "../repo/entries.js";
import { featureSpecPaths, SPEC_AXES } from "../repo/paths.js";

/**
 * One read of each per-service delta, answering the three questions the two
 * status forms ask of it: which requirements carry no scenario (via the same
 * `requirementsMissingScenarios` every coverage check calls — REMOVED
 * requirements are exempt there and stay exempt here, content on its way out
 * owes no acceptance criteria), how many scenarios there are to generate a
 * suite from, and whether the delta governs any operation at all — which is
 * what decides whether the service is owed a contract.
 */
export interface DeltaScan {
  service: string;
  /** Repo-relative, and the file the steps point at. */
  path: string;
  /** validate's own label for this axis: `<svc>: requirements` / `<svc>: arch requirements`. */
  label: string;
  bare: Requirement[];
  scenarios: number;
  /** Operations the non-REMOVED requirements govern. `spec.md` only, like coherence's own `reqOps`. */
  operations: number;
}

export async function scanDeltas(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  context: FleetContext,
): Promise<DeltaScan[]> {
  const out: DeltaScan[] = [];
  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    // SPEC_AXES already carries the prose name of each axis — "requirements"
    // and "arch requirements" are its `label`s verbatim — so the pair is read
    // from there rather than spelled again, and a service's status can never
    // walk a different set of spec files than its validation does.
    for (const [file, label] of SPEC_AXES.map(
      (axis) => [p[axis.key], `${svc}: ${axis.label}`] as const,
    )) {
      if (!existsSync(file)) continue;
      const reqs = await context.readRequirements(file);
      out.push({
        service: svc,
        path: repoPath(docsDir, file),
        label,
        bare: requirementsMissingScenarios(reqs),
        scenarios: reqs.reduce((n, r) => n + r.scenarios.length, 0),
        operations:
          file === p.spec
            ? reqs.filter((r) => r.kind !== "REMOVED").reduce((n, r) => n + r.operations.length, 0)
            : 0,
      });
    }
  }
  return out;
}

/** Services this feature sends at least one operation to — see contracts.ts's `owesContract`. */
export function governedServices(scans: DeltaScan[]): ReadonlySet<string> {
  return new Set(scans.filter((s) => s.operations > 0).map((s) => s.service));
}
