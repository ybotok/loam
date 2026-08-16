/**
 * Does the diff apply to the thing it claims to change?
 *
 * A requirement delta is a diff against a living spec, and nothing used to check
 * that it lands. Every failure mode here is silent today: MODIFIED of a
 * requirement that does not exist is merged as a creation, ADDED of one that
 * does exist REPLACES it (scenarios and all) while the author believes they are
 * adding, and a heading that nearly matches the delta grammar parses as plain
 * prose so archive merges nothing at all and says nothing about it.
 *
 * The last of those has a legal-looking cousin: a requirement under an ordinary
 * prose heading (`## Behavior`, `## Error Handling`) is BASE too, and BASE never
 * merges. Upstream OpenSpec deltas are written that way, so the answer is to name
 * what will be lost rather than to start merging prose sections.
 *
 * These run inside the archive gate, because the merge is where the damage lands.
 *
 * This module is only the walk: which documents get read, in what order, and how
 * the two passes over each are handed a `DeltaScope`. The checks themselves are
 * in `./document.ts` (a document against itself) and `./select.ts` (the delta
 * against the living text). Their order is load-bearing and stays here, where it
 * can be read in one screen.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type FleetContext } from "../fleet-context.js";
import { parseRequirements } from "../document/parse.js";
import { featureSpecPaths, servicePaths, SPEC_AXES } from "../repo/paths.js";
import { featureSpecServices } from "../repo/repo.js";
import { type Issue } from "../vocabulary/issue.js";
import { claimLookup } from "./claims.js";
import { deltaDocumentIssues, livingDocumentIssues } from "./document.js";
import { indexLiving, type DeltaScope } from "./scope.js";
import { selectionIssues } from "./select.js";

export async function deltaShapeIssues(
  docsDir: string,
  featureDir: string,
  featureId: string,
  context?: FleetContext,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const services = await featureSpecServices(featureDir, context);
  if (services.length === 0) return issues;

  // What OTHER features in flight claim. Only built when a claim has to be
  // checked — the common case never pays for the scan.
  const claims = claimLookup(docsDir, featureId, context);

  // Both requirement-carrying files per service run the same checks — one code
  // path parameterized by filename, the merge's own factoring. `where` names
  // the arch file in messages so a finding cannot be chased into the wrong
  // document; spec.md keeps its historical spelling.
  for (const service of services) {
    for (const axis of SPEC_AXES) {
      const specPath = featureSpecPaths(featureDir, service)[axis.key];
      if (!existsSync(specPath)) continue;
      const raw = context === undefined
        ? await readFile(specPath, "utf8")
        : await context.readText(specPath);
      const scope: DeltaScope = {
        featureId,
        docsDir,
        service,
        axis,
        specPath,
        where: axis.key === "spec" ? service : `${service} (arch.spec.md)`,
        // How the axis's living document is named in messages — spec.md keeps
        // the historical "living spec", the arch axis says which file it means.
        livingDoc: axis.key === "spec" ? "living spec" : "living arch.spec.md",
      };

      const reqs = context === undefined ? parseRequirements(raw) : await context.readRequirements(specPath);
      issues.push(...deltaDocumentIssues(scope, raw, reqs));

      const livingPath = servicePaths(docsDir, service)[axis.key];
      const living = indexLiving(
        existsSync(livingPath)
          ? context === undefined
            ? parseRequirements(await readFile(livingPath, "utf8"))
            : await context.readRequirements(livingPath)
          : [],
      );
      issues.push(...livingDocumentIssues(scope, living));
      issues.push(...(await selectionIssues(scope, reqs, living, claims)));
    }
  }

  return issues;
}
