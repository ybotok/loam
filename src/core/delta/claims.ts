/**
 * What OTHER features in flight claim, and the lazy lookup the checks use.
 *
 * The scan is built on first use and never twice: the common delta claims
 * nothing another feature touches, and the fleet walk is the expensive part of
 * this whole module. `ClaimLookup` is an interface rather than the maps
 * themselves so `./select.ts` cannot see — and so cannot accidentally force —
 * the scan it is deciding whether to need.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type FleetContext } from "../fleet-context.js";
import { parseRequirements } from "../document/parse.js";
import { type Requirement } from "../document/spec.js";
import { featureSpecPaths, SPEC_AXES } from "../repo/paths.js";
import { listFeatures } from "../repo/repo.js";
import { key, requirementKey, type DeltaScope } from "./scope.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** Which other feature claims this requirement, if any — one question per index. */
export interface ClaimLookup {
  added(scope: DeltaScope, requirement: Pick<Requirement, "id" | "name">): Promise<string | undefined>;
  changed(scope: DeltaScope, requirement: Pick<Requirement, "id" | "name">): Promise<string | undefined>;
}

/**
 * A lookup that runs the fleet scan at most once, on the first question asked.
 * The common case never pays for it.
 */
export function claimLookup(docsDir: DocsDir, featureId: string, context?: FleetContext): ClaimLookup {
  let inFlight: ActiveClaims | null = null;
  const ask = async (
    which: keyof ActiveClaims,
    scope: DeltaScope,
    requirement: Pick<Requirement, "id" | "name">,
  ): Promise<string | undefined> => {
    inFlight ??= await activeClaims(docsDir, featureId, context);
    const map = inFlight[which];
    return map.get(key(scope.service, scope.axis, requirementKey(requirement)))
      ?? map.get(key(scope.service, scope.axis, `name:${requirement.name}`));
  };
  return {
    added: (scope, requirement) => ask("added", scope, requirement),
    changed: (scope, requirement) => ask("changed", scope, requirement),
  };
}

/**
 * What other ACTIVE features claim, per (service, axis, requirement): what they
 * ADD, and — separately — what they CHANGE or REMOVE. The two are separate
 * indexes because they mean opposite things to the reader: an addition
 * elsewhere explains why a MODIFIED target is missing today, a change elsewhere
 * warns that the target is contested. One scan builds both; scanning twice
 * would double the fleet walk for the same bytes.
 */
interface ActiveClaims {
  added: Map<string, string>;
  changed: Map<string, string>;
}

async function activeClaims(
  docsDir: DocsDir,
  exclude: string,
  context?: FleetContext,
): Promise<ActiveClaims> {
  const added = new Map<string, string>();
  const changed = new Map<string, string>();
  for (const feature of await listFeatures(docsDir, {}, context)) {
    if (feature.id === exclude) continue;
    for (const service of feature.services) {
      for (const axis of SPEC_AXES) {
        const path = featureSpecPaths(feature.dir, service)[axis.key];
        if (!existsSync(path)) continue;
        const reqs = context === undefined
          ? parseRequirements(await readFile(path, "utf8"))
          : await context.readRequirements(path);
        for (const r of reqs) {
          const map = r.kind === "ADDED" ? added : r.kind === "MODIFIED" || r.kind === "REMOVED" ? changed : null;
          if (map === null) continue;
          for (const identity of new Set([requirementKey(r), `name:${r.name}`])) {
            const k = key(service, axis, identity);
            if (!map.has(k)) map.set(k, feature.id);
          }
        }
      }
    }
  }
  return { added, changed };
}
