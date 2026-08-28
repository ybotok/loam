/**
 * `glossary.unlinked` — a defined term that no document outside the glossary
 * cites.
 *
 * The mirror of `permissions.unenforced` and `capability.unrealized`, and it
 * earns its place for their reason: a vocabulary is worth what cites it. A term
 * nobody links to is either a word the fleet never adopted or a definition left
 * behind by a rename — both are drift, and neither is visible from inside the
 * file. WARN, because the honest answer is often "not written up yet", and
 * because a glossary must be safe to start: a fleet that defines twenty terms
 * on a Monday and cites four of them is adopting the axis, not failing it.
 *
 * A TERM CITED ONLY BY OTHER TERMS IS STILL UNLINKED, and this is the judgement
 * that keeps the warning worth anything. A glossary is a network of definitions,
 * so `order-line` linking to `order` is normal and correct — and it proves
 * nothing about whether the FLEET uses either word. The same reasoning
 * `capability.requirement-inert-join` applies one axis over: a join written
 * inside the tree is not evidence about the world outside it. The intra-glossary
 * citations are listed in `details` rather than hidden, because they are the
 * first thing a reader will otherwise go looking for.
 *
 * ONE FINDING FOR THE WHOLE GLOSSARY when nothing cites anything, and one per
 * term otherwise. A fleet that has just created `glossary/` and written its
 * first eight definitions would otherwise get eight identical warnings saying
 * the same thing about the same afternoon's work.
 */
import { backlinkIndex } from "../../../core/links/backlinks.js";
import { readGlossary } from "../../../core/glossary/tree.js";
import { glossaryDir } from "../../../core/repo/authored/paths.js";
import { repoPath } from "../../../core/envelope/json.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

export async function glossaryFindings(docsDir: DocsDir, fleet?: FleetContext): Promise<Finding[]> {
  const root = glossaryDir(docsDir);
  const glossary = await readGlossary(root);
  // The directory's existence is the axis's opt-in, exactly as
  // `architecture/capabilities.yaml` and `capabilities/` are the business
  // axis's. A fleet without one pays a single `existsSync` and hears nothing —
  // and the whole fleet-wide link walk below is never built.
  if (!glossary.present || glossary.terms.length === 0) return [];

  const index = await backlinkIndex(docsDir, fleet);
  const inGlossary = (source: string): boolean => source.startsWith(`${repoPath(docsDir, root)}/`);
  const unlinked = glossary.terms
    .map((term) => ({ term, cited: index.linkersOf(term.path) }))
    .map(({ term, cited }) => ({ term, outside: cited.filter((s) => !inGlossary(s)), within: cited.filter(inGlossary) }))
    .filter(({ outside }) => outside.length === 0);
  if (unlinked.length === 0) return [];

  // The whole vocabulary uncited is one fact about one afternoon, not N facts.
  if (unlinked.length === glossary.terms.length && glossary.terms.length > 1) {
    return [
      {
        severity: "warn",
        code: "glossary.unlinked",
        message:
          `glossary: none of the ${glossary.terms.length} defined term(s) is linked from any document outside glossary/. ` +
          "A term becomes checkable when a requirement, capability or intent cites it — " +
          "`[Order](../../glossary/order.md)` — and until then the definitions are a document nothing joins to.",
        details: unlinked.map(({ term }) => term.id),
      },
    ];
  }
  return unlinked.map(({ term, within }) => ({
    severity: "warn" as const,
    code: "glossary.unlinked",
    subject: term.id,
    message:
      `glossary/${term.id}.md is linked from no document outside glossary/` +
      (within.length === 0
        ? " — either a word the fleet has not adopted, or a definition left behind by a rename."
        : ", only from other terms — which says the glossary is consistent, not that the fleet uses the word.") +
      ` Cite it as \`[${term.id}](<relative>/glossary/${term.id}.md)\` from the requirement or capability that uses it, or delete the definition.`,
    ...(within.length === 0 ? {} : { details: within }),
  }));
}
