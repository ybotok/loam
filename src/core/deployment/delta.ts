/**
 * A feature's own topology: `features/<FEAT>/deployment/<name>.likec4`.
 *
 * Until this slot existed a change that stood up a standby cluster had to be
 * written in two places at once — the requirement in the feature, the topology
 * edited straight into `architecture/` — because `delta.likec4` refuses a
 * `deployment { }` block and always will: that document re-declares the
 * landscape's own identifiers and carries its own `specification`, so it cannot
 * be staged beside the map in one LikeC4 project. A document that declares
 * NEITHER can, which is exactly why the use-case axis put its flows in files of
 * their own, and why this mirrors it rather than inventing a shape.
 *
 * WHAT MAKES IT WORK, and it was measured before the axis was written: LikeC4
 * `extend` resolves across documents of one project. A feature writes
 *
 *     deployment {
 *       extend eu {
 *         dcC = datacenter 'DC-C' { k8sC = cluster 'cluster-c' { … } }
 *       }
 *       eu.dcA.k8sA -> eu.dcC.k8sC 'async replication'
 *     }
 *
 * and the living region gains a datacenter with the living file untouched. So
 * the merge is a copy, not a splice, and `unarchive` needs nothing new — a
 * create is undone by deleting, which the snapshot manifest already records for
 * every write in the plan.
 *
 * CREATE-ONLY, for `core/usecases/delta/flows.ts`'s reasons rather than a
 * weaker version of them. A requirement delta merges INTO a living document and
 * two features editing one requirement would overwrite each other silently; a
 * topology document has no such algebra — the file is one block, the merge is a
 * whole-file copy, and there is nothing to merge partially. Rewriting a living
 * one through a feature would be a silent whole-file replacement with no pin to
 * collide on, where editing `architecture/<name>.likec4` directly in the same
 * pull request produces an ordinary git conflict a human resolves.
 *
 * ## What this does NOT yet check, and it is a gap rather than a decision
 *
 * A flow is graded against the map its own merge would leave behind
 * (`ARCH-LOAM-FEATURE-CORPUS`), so a hop into an element the feature adds
 * resolves and a hop into one the merge does not land is refused BEFORE the
 * copy. This axis has no such pass: a deployment document naming an element only
 * the feature's `delta.likec4` introduces is copied in unchecked, and the next
 * reader's `loam validate --all` carries `landscape.invalid` against a file they
 * did not write. It is undoable — `loam unarchive` deletes what the plan
 * created — and it is recorded in ROADMAP with the work it needs: the merge
 * preview lives inside `core/usecases/delta/overlay.ts`, and sharing it means
 * changing that module's contract, which is worth its own change rather than a
 * rider on this one.
 */
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { architectureDir } from "../c4/project/architecture.js";
import { architectureDocuments } from "../c4/project/documents.js";
import { featureDeploymentDir } from "../repo/authored/paths.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import { type Issue } from "../vocabulary/issue.js";

/** One topology document a feature carries. */
export interface FeatureDeployment {
  /**
   * The path INSIDE the feature's `deployment/` directory, `/`-separated — the
   * id this axis has. Nesting is spelled by the tree, as it is for every other
   * authored tree in the repo.
   */
  rel: string;
  /** The absolute path of the authored file. */
  path: string;
}

/**
 * The topology documents one feature carries, ordered by path.
 *
 * Zero readdirs when the feature has no `deployment/` directory, which is every
 * feature in a fleet that has not adopted the axis: `architectureDocuments`
 * answers an absent directory with an empty list rather than a throw. That
 * directory's existence is the whole per-feature opt-in.
 */
export async function featureDeployments(featureDir: FeatureDir): Promise<FeatureDeployment[]> {
  const dir = featureDeploymentDir(featureDir);
  const paths = await architectureDocuments(dir);
  const base = resolve(dir);
  return paths.map((path) => ({ rel: relative(base, path).split(/[\\/]/).join("/"), path }));
}

/**
 * The LIVING path a feature-local topology document addresses.
 *
 * Straight into `architecture/`, with no subdirectory of its own — unlike
 * `architecture/usecases/`, and the difference is the model rather than taste.
 * A `deployment { }` block is part of the fleet's ONE architecture project and
 * is read as such by every loader; filing it under a subdirectory would suggest
 * a second project, which is exactly the reading `subsystems.likec4` and
 * `landscape.likec4` already refuse by sitting at the top level together.
 *
 * `rel` is joined un-split, which `node:path` normalizes. What holds the join is
 * PROVENANCE: every `rel` here came out of an `architectureDocuments` walk, so
 * each component is a directory entry that exists. No caller takes one from argv.
 */
export function livingDeploymentPath(docsDir: DocsDir, rel: string): string {
  return join(architectureDir(docsDir), rel);
}

/**
 * `deployment.doc-exists` — a topology document this feature introduces that
 * the living `architecture/` already holds.
 *
 * An ERROR and never a warning-that-gates, for `usecase.flow-exists`'s reason:
 * there is no legal reading of it. The merge would replace an authored topology
 * wholesale, and no `--approve` makes that a different act than it is. Two
 * features introducing the same file is the case that makes it load-bearing
 * rather than pedantic — whichever archives first creates the living document,
 * and the second is told before it merges that its own file is the one to
 * delete.
 *
 * The collision is on the FILE, not on what is inside it. Two features may both
 * extend the same living region from two documents of their own and both
 * archive; that is the shape `extend` exists for, and refusing it would make the
 * slot useless for the fleet-wide change it was built for.
 */
export async function deploymentDeltaIssues(docsDir: DocsDir, featureDir: FeatureDir): Promise<Issue[]> {
  const docs = await featureDeployments(featureDir);
  return docs
    .filter((doc) => existsSync(livingDeploymentPath(docsDir, doc.rel)))
    .map((doc) => ({
      severity: "error" as const,
      code: "deployment.doc-exists" as const,
      subject: doc.rel,
      message:
        `architecture/${doc.rel} already exists, so this feature's topology would replace an authored one wholesale — ` +
        "a feature-local deployment document INTRODUCES topology, it does not rewrite it. " +
        `Delete features/<FEAT>/deployment/${doc.rel} and edit architecture/${doc.rel} directly in this same change, ` +
        "where git produces an ordinary conflict if somebody else is editing it too. " +
        `To ADD to what that file declares, write a document of another name that says \`extend\` — ` +
        `\`${suggest(doc.rel)}\` — which is what lets two features grow one region without touching each other.`,
    }));
}

/** A free name near the colliding one, so the fix is a rename the author can copy. */
function suggest(rel: string): string {
  const name = basename(rel).replace(/\.likec4$/, "");
  const dir = rel.slice(0, rel.length - basename(rel).length);
  return `${dir}${name}-extend.likec4`;
}
