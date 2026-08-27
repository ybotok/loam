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
    // Asked and answered without the scan: the index below holds SERVICE
    // claims only, so every key a capability scope could build begins with a
    // kind no row carries. Without this line a capability-only feature — an
    // analyst's first act, touching no service at all — paid a full fleet walk
    // plus a parse of every active feature's every delta document to reach an
    // answer that is `undefined` by construction. Delete it on the day
    // `activeClaims` indexes the business corpus too, and not before.
    if (scope.kind !== "service") return undefined;
    inFlight ??= await activeClaims(docsDir, featureId, context);
    const map = inFlight[which];
    return map.get(key(scope, requirementKey(requirement)))
      ?? map.get(key(scope, `name:${requirement.name}`));
  };
  return {
    added: (scope, requirement) => ask("added", scope, requirement),
    changed: (scope, requirement) => ask("changed", scope, requirement),
  };
}

/**
 * What other ACTIVE features claim, per (kind, subject, axis, requirement):
 * what they ADD, and — separately — what they CHANGE or REMOVE. The two are
 * separate indexes because they mean opposite things to the reader: an addition
 * elsewhere explains why a MODIFIED target is missing today, a change elsewhere
 * warns that the target is contested. One scan builds both; scanning twice
 * would double the fleet walk for the same bytes.
 *
 * SERVICE CLAIMS ONLY, deliberately. A capability delta's questions therefore
 * always answer `undefined`, which suppresses four cross-feature warnings on
 * the business axis — `delta.added-conflict`, `delta.modified-conflict`,
 * `delta.modified-pending` and `delta.removed-pending`. Never a wrong answer,
 * only a missing warning, and the `kind` in the key is what keeps it missing
 * rather than wrong (a capability and a service sharing a name would otherwise
 * collide). `claimLookup` short-circuits on that kind rather than asking, so
 * the suppression costs nothing as well as saying nothing. Indexing the
 * capability axis too is one more walk in this same loop; it waits for the
 * fleet that reports the ordering, because a warning shipped speculatively is
 * a branch nobody needed.
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
            const k = key({ kind: "service", subject: service, axis }, identity);
            if (!map.has(k)) map.set(k, feature.id);
          }
        }
      }
    }
  }
  return { added, changed };
}
