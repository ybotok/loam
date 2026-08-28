/**
 * A feature's own glossary deltas: `features/<FEAT>/glossary/<term>.md`.
 *
 * A change that needs a new word brings the word with it. The archive copies the
 * definition into `glossary/`, `loam unarchive` takes it back out with
 * everything else the feature landed, and until then the term is visible in
 * review beside the requirements that use it — which is the whole reason this
 * route exists rather than "remember to edit the glossary too".
 *
 * CREATE-ONLY, and this is the axis's one real design decision rather than an
 * unfinished half. A feature-local capability document is a DELTA — `## ADDED
 * Requirements`, `Requirement-ID:` identity, `Based-On:` pins — because it
 * merges INTO a living document and two features editing one requirement would
 * otherwise silently overwrite each other. A term has none of that: the file is
 * one definition, the merge is a whole-file copy, and there is nothing to merge
 * partially. So rewriting a living definition through a feature would be a
 * silent whole-file replacement with no pin to collide on, where editing
 * `glossary/<term>.md` directly in the same pull request produces an ordinary
 * git conflict that a human resolves. `glossary.term-exists` refuses the first
 * and points at the second.
 *
 * TWO FEATURES INTRODUCING THE SAME WORD is the case that makes the refusal
 * load-bearing rather than pedantic: whichever archives first creates the living
 * definition, and the second is told — loudly, before it merges — that the word
 * now exists and its own file is the one to delete.
 *
 * ONE CALL for the walk, because it is already written: `readGlossary`
 * implements the file-is-a-term rule, the `README.md` exclusion, the nesting and
 * the symlink guard over any root. A second walk for the feature side would be
 * two implementations free to disagree about what a term is.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { featureGlossaryDir, glossaryDir } from "../repo/authored/paths.js";
import { type Issue } from "../vocabulary/issue.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import { readGlossary, type Glossary } from "./tree.js";

/**
 * The definitions one feature carries, ordered by id.
 *
 * `present: false` — and zero readdirs — when the feature has no `glossary/`
 * directory, which is every feature in a fleet that has not adopted the axis.
 * That short-circuit is `readGlossary`'s own `existsSync` and it is the whole
 * cost such a fleet pays.
 */
export function featureGlossary(featureDir: FeatureDir): Promise<Glossary> {
  return readGlossary(featureGlossaryDir(featureDir));
}

/**
 * Where each of this feature's terms WILL live once the archive merges — the
 * overlay a feature's own documents are allowed to cite.
 *
 * A feature that introduces a word cites it at its future living path
 * (`../../glossary/order.md`), because that is where the link has to point once
 * the feature ships; citing the delta path instead would resolve today and rot
 * on the day it lands. So while a feature is in flight, `link.unresolved` treats
 * these paths as resolved — the same overlay the capability axis needed for
 * `Realizes:`, and for the same reason: an index built from the LIVING tree
 * alone refuses the feature's own headline flow.
 */
export async function featureGlossaryOverlay(docsDir: DocsDir, featureDir: FeatureDir): Promise<Set<string>> {
  const glossary = await featureGlossary(featureDir);
  return new Set(glossary.terms.map((t) => resolve(livingTermPath(docsDir, t.id))));
}

/**
 * `glossary.term-exists` — a term this feature introduces that the living
 * glossary already defines.
 *
 * An ERROR and never a warning-that-gates: unlike `capability.uncovered`, there
 * is no legal reading of it. The merge would replace an authored definition
 * with another one, and no `--approve` makes that a different act than it is.
 * The fix is in the message and is the one a reviewer would give anyway.
 */
export async function glossaryDeltaIssues(docsDir: DocsDir, featureDir: FeatureDir): Promise<Issue[]> {
  const glossary = await featureGlossary(featureDir);
  if (!glossary.present) return [];
  return glossary.terms
    .filter((term) => existsSync(livingTermPath(docsDir, term.id)))
    .map((term) => ({
      severity: "error" as const,
      code: "glossary.term-exists" as const,
      subject: term.id,
      message:
        `glossary/${term.id}.md already exists, so this feature's definition of '${term.id}' would replace an authored one wholesale — ` +
        "a feature-local glossary document INTRODUCES a term, it does not rewrite one. " +
        `Delete features/<FEAT>/glossary/${term.id}.md and edit glossary/${term.id}.md directly in this same change, ` +
        "where git produces an ordinary conflict if somebody else is editing it too.",
    }));
}

/**
 * The LIVING path a feature-local term id addresses. Spelled here because three
 * readers need it — the refusal above, the overlay, and the archive merge — and
 * a reader that resolved it differently would refuse a term the merge then
 * created anyway.
 *
 * The id is joined un-split, which `node:path` normalizes: `join(dir, "a/b")`
 * and `join(dir, "a", "b")` are the same string. What holds this join is
 * PROVENANCE, exactly as it holds `livingCapabilityPaths` — every id here came
 * out of a `readGlossary` walk, where each component is a `readdir` entry name
 * and therefore a directory or file that exists. No caller takes one from argv;
 * the day one does, it needs the treatment `core/kernel/ids/capability.ts` gave
 * the same hazard one axis over.
 */
export function livingTermPath(docsDir: DocsDir, id: string): string {
  return join(glossaryDir(docsDir), `${id}.md`);
}
