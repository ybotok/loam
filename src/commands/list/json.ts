/**
 * The `--json` rows. Separate from `./print.ts` because only this side is a
 * contract: the payload keys are frozen, the columns beside them are not.
 */
import { repoPath } from "../../core/envelope/json.js";
import { type CapabilityRow } from "../../core/capabilities/rollup.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { servicesUnder } from "../../core/repo/tree/find.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { type ServiceView, type VerificationCell } from "./views.js";

export function serviceJson(docsDir: string, v: ServiceView): Record<string, unknown> {
  const s = v.entry;
  return {
    id: s.id,
    path: repoPath(docsDir, s.dir),
    // Names from services/ down, outermost first; [] = unfiled. `path` above
    // already truthfully reflects placement — this is the same fact as data
    // instead of a string to split.
    subsystem: s.subsystem,
    has: { ...s.has, archSpec: v.archSpec },
    adrs: s.adrs,
    status: s.status,
    maturity: v.maturity,
    missing: v.missing,
    apiExpected: v.apiExpected,
    // Never omitted when true: a consumer that filters this table into a
    // worklist has to be able to tell "checked and fine" from "not checkable
    // from here", and absence reads as the first one.
    ...(v.unverifiableFromHere ? { provenance: "unverifiable-from-here" } : {}),
  };
}

/**
 * The subsystem rows beside the service table, sorted by path. `memberCount`
 * is TRANSITIVE — every service beneath, at any depth — matching the
 * generated views file's membership, so the two numbers a consumer can
 * cross-check never disagree about what "in this group" means.
 */
export function subsystemsJson(docsDir: string, tree: FleetTree): Record<string, unknown>[] {
  return [...tree.subsystems]
    .sort((a, b) => (a.path.join("/") < b.path.join("/") ? -1 : 1))
    .map((sub) => ({
      name: sub.name,
      path: repoPath(docsDir, sub.dir),
      title: sub.meta.title ?? null,
      memberCount: servicesUnder(tree, sub).length,
    }));
}

/**
 * One `capabilities[]` row — additive payload, explicit `loam list
 * capabilities` only, and diff-stable: the rollup already sorts rows,
 * realizedBy and statuses' keys deterministically, and this projection adds
 * nothing that could vary between machines. Optional keys are omitted rather
 * than nulled so a declaration that never carried a description does not grow
 * one in the diff.
 */
export function capabilityJson(row: CapabilityRow): Record<string, unknown> {
  return {
    id: row.id,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.owner !== undefined ? { owner: row.owner } : {}),
    realizedBy: row.realizedBy,
    services: row.services,
    statuses: row.statuses,
  };
}

export function featureJson(
  docsDir: string,
  f: FeatureEntry,
  verification: VerificationCell | null,
): Record<string, unknown> {
  return {
    id: f.id,
    dirName: f.dirName,
    path: repoPath(docsDir, f.dir),
    archived: f.archived,
    services: f.services,
    has: f.has,
    verification,
  };
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/** What the features table says about verification without N `loam verify` runs. */
