/**
 * A feature's own flows: `features/<FEAT>/usecases/<name>.likec4`.
 *
 * A `dynamic view` is the only realizer a cross-service promise has, and until
 * this slot existed it was the one realizer no feature could carry. Every other
 * axis had a delta — a C4 delta, a requirement delta on both spec axes, both
 * contract deltas, a capability delta, a glossary term — so the business axis's
 * own headline case had to be written backwards: an analyst adds a capability
 * requirement, the architect answers it with a flow, and the flow could not ship
 * in that change. It merged only after the promise was already living, which
 * meant the promise landed first with nothing keeping it.
 *
 * CREATE-ONLY, for `core/glossary/delta.ts`'s reasons rather than a weaker
 * version of them. A capability document is a DELTA because it merges INTO a
 * living document and two features editing one requirement would otherwise
 * overwrite each other silently. A flow has none of that: the file is one
 * ordered hop sequence, the merge is a whole-file copy, and there is nothing to
 * merge partially. Rewriting a living flow through a feature would be a silent
 * whole-file replacement with no pin to collide on, where editing
 * `architecture/usecases/<name>.likec4` directly in the same pull request
 * produces an ordinary git conflict a human resolves. `usecase.flow-exists`
 * refuses the first and names the second — the same shape, and the same
 * severity, as `glossary.term-exists`.
 *
 * WHY A FILE OF ITS OWN AND NOT `delta.likec4`. The C4 delta is a MODEL delta:
 * it re-declares the landscape's own identifiers to anchor its new edges, and it
 * carries its own `specification` block because LikeC4 parses it standalone.
 * Both make it unstageable beside the landscape in one project — a duplicate
 * specification is an error blamed on both files, and a re-declared element is a
 * duplicate id. A views-only document declares neither, which is exactly why
 * living use cases already live in files of their own; the feature-local slot
 * mirrors that layout so the merge is a copy and the overlay is a stage.
 * `core/c4/splice/delta-blocks.ts` goes on refusing a `dynamic view` inside
 * `delta.likec4` and now names this slot as the place it belongs.
 *
 * ONE CALL for the walk. `architectureDocuments` already implements "every
 * `.likec4` under a directory, recursively, in a stable order, and an absent
 * directory is an empty list" — which is the whole of what a feature's flow
 * directory is. A second walk would be two implementations free to disagree
 * about what a flow file is, and they would disagree first about nesting.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { architectureDocuments } from "../../c4/project/documents.js";
import { architectureDir } from "../../c4/project/architecture.js";
import { featureUseCasesDir } from "../../repo/authored/paths.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { type Issue } from "../../vocabulary/issue.js";

/** The directory living flows are filed under, inside `architecture/`. */
export const USECASE_SUBDIR = "usecases";

/** One flow document a feature carries. */
export interface FeatureFlow {
  /**
   * The path INSIDE the feature's `usecases/` directory, `/`-separated — the id
   * this axis has, and the same path the merge writes under
   * `architecture/usecases/`. Nesting is spelled by the tree, as it is for every
   * other authored tree in the repo.
   */
  rel: string;
  /** The absolute path of the authored file. */
  path: string;
}

/**
 * The flows one feature carries, ordered by path.
 *
 * Zero readdirs when the feature has no `usecases/` directory, which is every
 * feature in a fleet that has not adopted the axis: `architectureDocuments`
 * answers an absent directory with an empty list rather than a throw.
 */
export async function featureFlows(featureDir: FeatureDir): Promise<FeatureFlow[]> {
  const dir = featureUseCasesDir(featureDir);
  const paths = await architectureDocuments(dir);
  const base = resolve(dir);
  return paths.map((path) => ({ rel: relative(base, path).split(/[\\/]/).join("/"), path }));
}

/**
 * The LIVING path a feature-local flow addresses. Spelled here because three
 * readers need it — the refusal below, the archive merge, and the overlay that
 * grades the flow before either — and a reader resolving it differently would
 * refuse a flow the merge then wrote anyway.
 *
 * `rel` is joined un-split, which `node:path` normalizes. What holds the join is
 * PROVENANCE, exactly as it holds `livingTermPath` one axis over: every `rel`
 * here came out of an `architectureDocuments` walk, so each component is a
 * directory entry that exists. No caller takes one from argv.
 */
export function livingFlowPath(docsDir: DocsDir, rel: string): string {
  return join(architectureDir(docsDir), USECASE_SUBDIR, rel);
}

/**
 * `usecase.flow-exists` — a flow this feature introduces that the living
 * `architecture/` already holds.
 *
 * An ERROR and never a warning-that-gates, for `glossary.term-exists`'s reason:
 * there is no legal reading of it. The merge would replace an authored flow
 * wholesale, and no `--approve` makes that a different act than it is. Two
 * features introducing the same flow is the case that makes it load-bearing
 * rather than pedantic — whichever archives first creates the living document,
 * and the second is told before it merges that its own file is the one to
 * delete.
 */
export async function flowDeltaIssues(docsDir: DocsDir, featureDir: FeatureDir): Promise<Issue[]> {
  const flows = await featureFlows(featureDir);
  return flows
    .filter((flow) => existsSync(livingFlowPath(docsDir, flow.rel)))
    .map((flow) => ({
      severity: "error" as const,
      code: "usecase.flow-exists" as const,
      subject: flow.rel,
      message:
        `architecture/${USECASE_SUBDIR}/${flow.rel} already exists, so this feature's flow would replace an authored one wholesale — ` +
        "a feature-local flow INTRODUCES a use case, it does not rewrite one. " +
        `Delete features/<FEAT>/${USECASE_SUBDIR}/${flow.rel} and edit architecture/${USECASE_SUBDIR}/${flow.rel} directly in this same change, ` +
        "where git produces an ordinary conflict if somebody else is editing it too.",
    }));
}
