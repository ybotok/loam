/**
 * Where every file of the feature will be once this archive lands — the half of
 * the link rewrite that `core/links/parse.ts`'s `rebaseLinks` cannot know.
 *
 * THE DEFECT THIS CLOSES. The requirement merge has re-expressed a delta's
 * relative links from the directory they were written in to the one they land
 * in since the glossary axis shipped. But it re-expressed them against the
 * target's OLD place, and the same archive moves the targets that sit inside
 * the feature: a link from a delta to `features/<FEAT>/glossary/order.md` was
 * rewritten faithfully into the living spec and resolved to nothing one rename
 * later, when the term had been copied to `glossary/order.md` and the feature
 * directory had gone to `features/archive/<FEAT>/`. Every such link was
 * `link.unresolved` on the first `validate --all` after a clean archive — an
 * error the feature gate could not see, because before the archive the link
 * was correct.
 *
 * TWO RULES, and they are the archive's own moves rather than a guess:
 *
 * - A file the archive COPIES into the living tree — a glossary term, a flow,
 *   a topology document — is cited at its living copy. That is the document
 *   readers are meant to find, and the one `glossary.unlinked` counts a
 *   citation of: a link left on the archived copy would resolve and still
 *   leave the living term reading as a word nobody uses.
 * - Every other file under the feature directory — its ADRs above all, the
 *   intent, the deltas themselves — is cited where the feature now lives,
 *   `features/archive/<FEAT>/`. Nothing else copies a feature ADR anywhere: it
 *   records a decision taken for this change, and it stays with the change
 *   (SCHEMA "Layout" says so beside the slot).
 *
 * Built per call from three directory walks — the glossary, the flows and the
 * topology documents, the same walks `../specs.ts` and `../landscape.ts` make
 * to copy them; a `Gated` field would be one more value the gate computes for
 * a phase it does not own.
 */
import { join, relative, resolve } from "node:path";
import { featureGlossary, livingTermPath } from "../../../../core/glossary/delta.js";
import { isPathInside } from "../../../../core/kernel/path-safety.js";
import { featureFlows, livingFlowPath } from "../../../../core/usecases/delta/flows.js";
import { featureDeployments, livingDeploymentPath } from "../../../../core/deployment/delta.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { Gated } from "../state.js";

/** Absolute path in, the absolute path the same file will have after this archive out. */
export type Retarget = (target: string) => string;

export async function featureRetarget(docsDir: DocsDir, gated: Pick<Gated, "featureDir" | "archiveDest">): Promise<Retarget> {
  const copies = new Map<string, string>();
  for (const term of (await featureGlossary(gated.featureDir)).terms) {
    copies.set(resolve(term.path), resolve(livingTermPath(docsDir, term.id)));
  }
  for (const flow of await featureFlows(gated.featureDir)) {
    copies.set(resolve(flow.path), resolve(livingFlowPath(docsDir, flow.rel)));
  }
  for (const doc of await featureDeployments(gated.featureDir)) {
    copies.set(resolve(doc.path), resolve(livingDeploymentPath(docsDir, doc.rel)));
  }
  return (target: string): string => {
    const copied = copies.get(resolve(target));
    if (copied !== undefined) return copied;
    if (!isPathInside(gated.featureDir, target)) return target;
    return join(gated.archiveDest, relative(gated.featureDir, target));
  };
}
