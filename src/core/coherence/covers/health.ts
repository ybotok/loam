/**
 * `health.uncovered`, predicted: the alert or SLI a living `arch.spec.md`
 * requirement covers today that this feature's arch delta would leave covered
 * by nothing.
 *
 * Validate's service target grades `health.yaml` against the LIVING
 * `arch.spec.md` (`commands/validate/service/specs.ts`), and nothing graded the
 * delta that rewrites it. A MODIFIED requirement restates its whole block, so
 * a `Covers:` line the author did not carry over is a line the merge deletes:
 * the feature gate called the delta clean, the archive printed "living spec +
 * landscape are now complete + current.", and the next `validate --all` warned
 * that the signal now ships with nothing testing it (the real-fleet review,
 * 2026-10-21).
 *
 * ONLY WHAT THIS MERGE TAKES AWAY. A signal the living spec already leaves
 * uncovered is the service target's warning today and stays its warning; this
 * gate reporting it too would file somebody else's debt against a feature
 * that never touched it. And a service this feature creates has no living
 * `health.yaml` — a feature cannot carry one — so it has nothing to lose.
 *
 * A WARNING, the grade validate gives the same fact: the documents are legal
 * and the merge is correct, so it advises and never gates. The merge is the
 * archive's own (`afterMerge` over `applyRequirementDelta`), so the
 * requirements this reads are the ones the archive would write; a delta the
 * merge refuses is read as living ∪ ADDED ∪ MODIFIED, which can only find MORE
 * coverage — the quiet direction for an advisory.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseCoversEntry } from "../../c4/arch.js";
import { afterMerge } from "../../consumers/after.js";
import { parseRequirements } from "../../document/parse.js";
import type { Requirement } from "../../document/spec.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import type { PathableService } from "../../kernel/ids/service.js";
import { featureSpecPaths } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { readHealth } from "../../vocabulary/health.js";
import type { Issue } from "../../vocabulary/issue.js";

/** The feature being graded, and the services its `specs/` touch. */
export interface HealthCoverageScope {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  services: readonly PathableService[];
  context?: FleetContext;
}

/** The requirements naming `form:id` in a `Covers:` line — the rule `coversEntries` applies, REMOVED governing nothing. */
function covering(reqs: readonly Requirement[], form: "alert" | "sli", id: string): Requirement[] {
  return reqs.filter(
    (r) =>
      r.kind !== "REMOVED" &&
      r.covers.some((raw) => {
        const entry = parseCoversEntry(raw);
        return entry.form === form && entry.id === id;
      }),
  );
}

export async function droppedHealthCoverage(scope: HealthCoverageScope): Promise<Issue[]> {
  const { docsDir, featureDir, context } = scope;
  const read = async (path: string): Promise<Requirement[]> =>
    context === undefined ? parseRequirements(await readFile(path, "utf8")) : await context.readRequirements(path);
  const issues: Issue[] = [];
  for (const service of scope.services) {
    const deltaPath = featureSpecPaths(featureDir, service).archSpec;
    if (!existsSync(deltaPath)) continue;
    const paths = await locateServicePaths(docsDir, service, context);
    if (!existsSync(paths.archSpec) || !existsSync(paths.health)) continue;
    // An unreadable health.yaml is `health.invalid`, the service target's
    // finding; there are no ids here to grade either way.
    const health = await readHealth(paths.health);
    if (health.unreadable) continue;
    const living = await read(paths.archSpec);
    const after = afterMerge(living, await read(deltaPath)).map((m) => m.requirement);
    for (const { form, ids } of [
      { form: "alert" as const, ids: health.ids.alerts },
      { form: "sli" as const, ids: health.ids.slis },
    ]) {
      for (const id of ids) {
        const before = covering(living, form, id);
        if (before.length === 0 || covering(after, form, id).length > 0) continue;
        const signal = form === "alert" ? "alert" : "SLI";
        issues.push({
          severity: "warn",
          code: "health.uncovered",
          subject: service,
          message:
            `${service}: health.yaml declares ${signal} '${id}', which the living arch.spec.md covers today ` +
            `(${before.map((r) => `'${r.name}'`).join(", ")}) and nothing would after this feature's merge — its ` +
            `arch.spec.md delta rewrites or removes every requirement carrying 'Covers: ${form}:${id}', so the next ` +
            `\`loam validate --all\` reports health.uncovered. Keep the entry on the MODIFIED requirement, or cover ` +
            `the signal from another requirement in the delta`,
        });
      }
    }
  }
  return issues;
}
