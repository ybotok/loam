/**
 * `link.unresolved` — a markdown link in an authored document whose target is
 * not there.
 *
 * The convention this grades has been written down since the fleet-ADR work and
 * has said, in both `SCHEMA.md` and the generated `AGENTS.md`, that nothing
 * validated it. This module is what makes that sentence false, and the reason
 * the convention was chosen is the reason it can: the target of a standard
 * markdown link is a real relative path, so "does this resolve" has a
 * filesystem answer, where a wikilink would need Obsidian's shortest-unique-path
 * search reimplemented — guessing, which loam does not do.
 *
 * ERROR, and the severity is the decision the maintainer took against the
 * alternative of warning outside `glossary/`. A link is a join of the same kind
 * as `Operations:` and `Covers:`, both of which error when they resolve to
 * nothing; the fact that this one is written in prose changes who typed it, not
 * whether it points at something. A fleet adopting loam with rotted links sees
 * them on its first run — a user-visible widening of the same class as the two
 * the use-case and business axes shipped, and recorded in CHANGELOG as one.
 *
 * ONE FINDING PER DOCUMENT, with every broken link in `details`. A document
 * whose links have rotted is one editing session and one reviewer, not ten
 * separate breaches, and per-link findings would let a single stale directory
 * rename fill a `validate --all` report with the same fix restated.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repoPath } from "../envelope/json.js";
import { isPathInside } from "../kernel/path-safety.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { Finding } from "../vocabulary/report.js";
import { documentLinks, type DocumentLink } from "./parse.js";

/** One authored document, and the text somebody already read out of it. */
export interface LinkedDocument {
  /** Absolute path of the document — the directory every relative target resolves against. */
  path: string;
  text: string;
}

/** What the finding is filed under, and the tree it may look inside. */
export interface LinkScope {
  docsDir: DocsDir;
  /** The service or feature the report is about; absent at fleet scope. */
  subject?: string;
}

/**
 * The links in one document that resolve to nothing, as at most one finding.
 *
 * TARGETS OUTSIDE THE DOCS REPO ARE NOT GRADED, and the exclusion is honesty
 * rather than leniency. A docs repo is routinely checked out beside nothing
 * else, so `../../payments-svc/README.md` is a path loam cannot answer for: the
 * file's absence here is evidence about this checkout, not about the link. Only
 * a target that stays inside `docsDir` gets a verdict, which is the same
 * boundary every other reader in loam observes and the reason this check can
 * afford to be an error at all.
 *
 * CASE IS NOT CHECKED, and this is a known limit rather than an oversight.
 * `existsSync` is case-insensitive on Windows and macOS and case-sensitive on
 * Linux and on GitHub's renderer, so `[Order](Order.md)` beside `order.md`
 * passes here and 404s in review. Catching it means a `readdir` per path
 * segment; the cheap half is worth having first, and the finding this would
 * add is a different one from "the file is not there".
 */
export function unresolvedLinkFindings(doc: LinkedDocument, scope: LinkScope): Finding[] {
  const where = repoPath(scope.docsDir, doc.path);
  const dir = dirname(doc.path);
  const broken = documentLinks(doc.text).filter((link) => {
    const target = resolve(dir, link.path);
    return isPathInside(scope.docsDir, target) && !existsSync(target);
  });
  if (broken.length === 0) return [];
  return [
    {
      severity: "error",
      code: "link.unresolved",
      ...(scope.subject === undefined ? {} : { subject: scope.subject }),
      message:
        `${where}: ${broken.length} markdown link(s) resolve to nothing. ` +
        "A link between documents here is a join — fix the path, or write the document it points at. " +
        "Targets outside the docs repo and links to a heading (`#section`) are not graded.",
      details: broken.map((link) => detail(where, link)),
    },
  ];
}

/**
 * One broken link, spelled so the author can find it: the file and line first,
 * then the link exactly as written. `raw` rather than the decoded path, because
 * the decoded form is not the string that is in the document.
 */
function detail(where: string, link: DocumentLink): string {
  return `${where}:${link.line}: [${link.text}](${link.raw})`;
}
