/**
 * A requirement delta that says nothing, and a feature that changes nothing.
 *
 * `loam new` scaffolds every requirement delta as a heading over an HTML
 * comment, so an untouched `specs/<svc>/spec.md` parses as a legal document
 * with zero requirements — and every check over it was vacuously green:
 * `validate --feature` printed "requirements covered (0 requirements, all with
 * scenarios)", `loam status` called the file written and the feature's docs
 * ready, and `loam archive` planned a merge of nothing and went through
 * (study 2026-10-30, I16). README's rule is that a check silent for want of
 * anything to ask must never read as a check that passed, and SCHEMA's
 * smallest legal feature says a change touching no requirement is no feature
 * at all. The living side already had the answer — `spec.no-requirements`
 * warns over a living spec.md with no requirement — and the feature side was
 * never given it.
 *
 * Two findings, at two altitudes, because they ask two different things:
 *
 * - `delta.no-requirements` — one service's requirement delta holds nothing.
 *   A WARNING that never gates: beside a real change elsewhere in the feature,
 *   an empty file merges nothing and harms nothing, and an architecture-only
 *   feature is legal (`service.no-requirement-delta` is that axis's warning).
 *   It is what turns the service's spec row `missing` in `loam status`, the
 *   same answer a specs/<svc>/ with no spec.md at all already got.
 * - `delta.changes-nothing` — the WHOLE feature would merge nothing. A warning
 *   that GATES, `--approve` overriding, exactly like `intent.empty`: archiving
 *   it reports a merge while folding nothing into the living docs.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, join, sep } from "node:path";
import type { Requirement } from "../../document/spec.js";
import type { FeatureDir } from "../../kernel/ids/dirs.js";
import type { PathableService } from "../../kernel/ids/service.js";
import { featureSpecPaths, SPEC_AXES } from "../../repo/paths.js";
import { carriesServiceFlows } from "../../usecases/delta/service/slot.js";
import { recordLocation } from "../../verify/location.js";
import type { Issue } from "../../vocabulary/issue.js";

/** What the emptiness checks read: the feature's own files, and one fact the C4 pass already has. */
export interface EmptinessScope {
  featureDir: FeatureDir;
  featureId: string;
  svcNames: PathableService[];
  /**
   * Whether `delta.likec4` carries anything the landscape merge would splice —
   * a tagged element or relationship — or could not be read at all. An
   * unreadable delta proves nothing either way, and `delta.invalid` refuses it
   * already, so it counts as a change rather than as an absence.
   */
  drawsArchitecture: boolean;
  /** One requirement document's requirements, through the invocation's read index when there is one. */
  read: (path: string) => Promise<Requirement[]>;
}

export async function emptinessIssues(scope: EmptinessScope): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const svc of scope.svcNames) {
    const paths = featureSpecPaths(scope.featureDir, svc);
    const docs = SPEC_AXES.filter((axis) => existsSync(paths[axis.key]));
    // A flow-only service delta is a delta every gate grades and none asks a
    // requirement of (`status/feature/artifacts.ts` says why), so an untouched
    // spec.md beside it is leftover scaffold, not an empty change.
    if (docs.length === 0 || carriesServiceFlows(scope.featureDir, svc)) continue;
    if (await holdsRequirement(scope, docs.map((axis) => paths[axis.key]))) continue;
    const files = docs.map((axis) => `specs/${svc}/${axis.file}`).join(" and ");
    issues.push({
      severity: "warn",
      code: "delta.no-requirements",
      subject: svc,
      message:
        `${svc}: ${files} ${docs.length === 1 ? "holds" : "hold"} no '### Requirement:' block — nothing in ${docs.length === 1 ? "it" : "them"} changes what ${svc} promises, ` +
        `so every requirement check over ${docs.length === 1 ? "it" : "them"} is vacuous rather than passing. Write the ADDED/MODIFIED/REMOVED requirements ${scope.featureId} makes to ${svc}, or delete the empty file.`,
    });
  }
  if (!scope.drawsArchitecture && !(await changesAnything(scope))) {
    issues.push({
      severity: "warn",
      gates: true,
      code: "delta.changes-nothing",
      message:
        `${scope.featureId} changes nothing: delta.likec4 tags no element or relationship, no requirement delta holds a '### Requirement:' block, ` +
        `and the feature carries no other delta document — archiving it would fold nothing into the living docs while reporting a merge. Write the change, or archive with --approve.`,
    });
  }
  return issues;
}

/** Does any of these requirement documents hold a requirement — of any kind? */
async function holdsRequirement(scope: EmptinessScope, paths: string[]): Promise<boolean> {
  for (const path of paths) {
    if ((await scope.read(path)).length > 0) return true;
  }
  return false;
}

/**
 * Does anything in the feature directory change the living docs, apart from
 * delta.likec4 (the caller's `drawsArchitecture`)?
 *
 * Asked as a walk over what IS there rather than a list of the axes a feature
 * may carry, and that is the design: every file the walk cannot account for —
 * a contract delta, a flow, a glossary term, a deployment document, an ADR,
 * something a later axis adds — counts as a change, so an axis this module has
 * never heard of can only make the gate quieter, never make it refuse a real
 * feature. What it accounts for is the scaffold's own shape: the intent (which
 * says why, and changes nothing), the verification record (which answers
 * claims, and changes nothing), and the requirement documents — a service's
 * spec.md or arch.spec.md, a capability's spec.md — which change something
 * exactly when they hold a requirement.
 */
async function changesAnything(scope: EmptinessScope): Promise<boolean> {
  const record = recordLocation(scope.featureDir);
  let entries;
  try {
    entries = await readdir(scope.featureDir, { recursive: true, withFileTypes: true });
  } catch {
    // Unreadable is not empty: a gate that refused over a directory nobody
    // could list would be the claim this module exists to stop making.
    return true;
  }
  const requirementDocs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const parts = relative(scope.featureDir, path).split(sep);
    if (parts.length === 1 && (parts[0] === "intent.md" || parts[0] === "delta.likec4")) continue;
    if (path === record || path.startsWith(record + sep)) continue;
    const serviceDoc = parts.length === 3 && parts[0] === "specs" && SPEC_AXES.some((axis) => axis.file === parts[2]);
    const capabilityDoc = parts.length >= 3 && parts[0] === "capabilities" && parts[parts.length - 1] === "spec.md";
    if (!serviceDoc && !capabilityDoc) return true;
    requirementDocs.push(path);
  }
  return holdsRequirement(scope, requirementDocs);
}
