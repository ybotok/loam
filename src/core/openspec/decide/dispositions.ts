/**
 * What happens to each authored artifact loam has no equivalent for: a
 * proposal, a task list, a design note.
 *
 * Every one of them is a decision rather than a default, because the honest
 * answers differ per corpus — one team's `design.md` is an ADR, another's is a
 * scratchpad. A disposition nobody chose is the one way this migration could
 * quietly drop authored work, so an unset one blocks readiness.
 */
import { ownValue } from "../../kernel/records.js";
import { type OpenSpecMapping, type OpenSpecMappingIssue } from "../model/mapping.js";
import { type OpenSpecArtifact, type OpenSpecArtifactDecision, type OpenSpecArtifactKind } from "../model/model.js";

export function artifactDispositions(
  artifacts: OpenSpecArtifact[],
  mapping: OpenSpecMapping,
  activeChangeIds: ReadonlySet<string>,
  mappingIssues: OpenSpecMappingIssue[],
): OpenSpecArtifactDecision[] {
    const decisionKinds = new Set<OpenSpecArtifactKind>(["proposal", "tasks", "change-design"]);
    const artifactDecisions: OpenSpecArtifactDecision[] = artifacts
      // Never offer a disposition for an artifact no enumerated change owns —
      // dot-prefixed change directories are refused, not migrated, and a
      // `selectedDisposition` recorded for one is a decision about nothing.
      .filter((artifact): artifact is OpenSpecArtifact & { kind: "proposal" | "tasks" | "change-design" } =>
        artifact.scope === "active"
        && decisionKinds.has(artifact.kind)
        && artifact.changeId !== undefined
        && activeChangeIds.has(artifact.changeId))
      .map((artifact) => {
        const selected = ownValue(mapping.artifacts, artifact.path) ?? null;
        return {
          path: artifact.path,
          kind: artifact.kind,
          suggestedDisposition: artifact.disposition,
          disposition: selected,
          status: selected === null ? "needsDisposition" as const : "mapped" as const,
        };
      });
    const artifactPaths = new Set(artifactDecisions.map((decision) => decision.path));
    // Sets of plain strings: the question being asked is "is this authored value
    // one of the ones this kind accepts", and a set of the union could not be
    // asked it without an assertion putting the answer back where it started.
    const dispositionsByKind: Record<OpenSpecArtifactDecision["kind"], ReadonlySet<string>> = {
      proposal: new Set(["convert-to-intent", "retain-read-only", "manual-review"]),
      tasks: new Set(["preserve-as-legacy-checklist", "retain-read-only", "manual-review"]),
      "change-design": new Set(["review-as-feature-adr", "retain-read-only", "manual-review"]),
    };
    for (const [path, disposition] of Object.entries(mapping.artifacts)) {
      if (!artifactPaths.has(path)) {
        mappingIssues.push({
          code: "mapping.unknown-artifact",
          key: path,
          message: `Mapping names unknown active authored artifact '${path}'.`,
        });
      } else {
        const decision = artifactDecisions.find((item) => item.path === path)!;
        if (dispositionsByKind[decision.kind].has(disposition)) continue;
        mappingIssues.push({
          code: "mapping.invalid-artifact-disposition",
          key: path,
          message: `${decision.kind} artifact '${path}' has unsupported disposition '${disposition}'.`,
        });
      }
    }
  return artifactDecisions;
}
