/**
 * The `--json` rows. Separate from `./print.ts` because only this side is a
 * contract: the payload keys are frozen, the columns beside them are not.
 */
import { repoPath } from "../../core/envelope/json.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { type ServiceView, type VerificationCell } from "./views.js";

export function serviceJson(docsDir: string, v: ServiceView): Record<string, unknown> {
  const s = v.entry;
  return {
    id: s.id,
    path: repoPath(docsDir, s.dir),
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
