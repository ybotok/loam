/**
 * The deployment axis's second question at feature scope: does a feature's own
 * topology READ against the map its merge would leave behind
 * (`deployment.doc-invalid`).
 *
 * Moved verbatim out of `../coherence.ts`, whose one function the two merges of
 * 2026-10-23 took past the 400-line limit. Why the question is asked, and why
 * there in the order, stays at the call site. It is a coherence module and not
 * a `core/deployment/` one for the reason the comments below give: this package
 * may hold the fleet context, and the deployment axis may not.
 */
import { extendingModels } from "../../c4/service-model/fleet/extending.js";
import { readFeatureDeployments } from "../../deployment/delta.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import type { Issue } from "../../vocabulary/issue.js";

/** The feature, and the fleet context when the caller holds one. */
export interface TopologyReadRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  context?: FleetContext;
}

/** One `deployment.doc-invalid` when the feature's topology does not read against the post-merge map, none otherwise. */
export async function unreadableTopologyIssues(request: TopologyReadRequest): Promise<Issue[]> {
  const { docsDir, featureDir, featureId, context } = request;
  const issues: Issue[] = [];

  const topology = await readFeatureDeployments({
    docsDir,
    featureDir,
    featureId,
    // A function rather than the context itself, for the reason the use-case
    // overlay states: one memoised read does not justify an edge from
    // `core/deployment/` to `fleet-context`.
    ...(context === undefined ? {} : { load: (path: string) => context.loadLikeC4(path) }),
    // The fleet's extending models, so the preview is the map the archive would
    // really leave: a nested addition is routed into the service's own model,
    // never onto the map. Read here for the same reason `load` is passed here —
    // this module holds the context and `core/deployment/` does not — and as a
    // thunk, so a feature with no `deployment/` directory pays nothing for it.
    models: () => extendingModels(docsDir, context),
  });
  if (topology.kind === "unreadable") {
    issues.push({
      severity: "error",
      code: "deployment.doc-invalid",
      subject: featureId,
      // The opening sentence does not say whose file is at fault, on the
      // `usecase.flow-invalid` message's reasoning: the corpus is the feature's
      // `deployment/` PLUS the living `architecture/` documents it extends, so
      // the failing path can be a living one — a landscape that no longer
      // parses, a topology somebody else wrote. Every message carries its own
      // path, so a reader can place it.
      message:
        `this feature's deployment document(s) could not be read against the map its own merge would leave behind, ` +
        `so the archive would land an architecture/ nothing has checked. The corpus is the feature's deployment/ AND ` +
        `the living architecture/ documents it extends, so the fault may be in either — each message names its file. ` +
        `${topology.errors.length} problem(s): ${topology.errors.join("; ")}`,
    });
  }
  return issues;
}
