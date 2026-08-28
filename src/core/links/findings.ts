/**
 * `link.unresolved` — a markdown link in an authored document whose target is
 * not there, or is there under a different spelling.
 *
 * The convention this grades has been written down since the fleet-ADR work and
 * said, in both `SCHEMA.md` and the generated `AGENTS.md`, that nothing
 * validated it. This module is what makes that sentence false, and the reason
 * the convention was chosen is the reason it can: the target of a standard
 * markdown link is a real relative path, so "does this resolve" has a
 * filesystem answer, where a wikilink would need Obsidian's
 * shortest-unique-path search reimplemented — guessing, which loam does not do.
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
 *
 * THE RESOLUTION IS EXPORTED SEPARATELY from the finding, because a second
 * reader needs the other half of the answer: the glossary grades a term by who
 * links TO it, which is this same walk read forwards instead of backwards.
 */
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { repoPath } from "../envelope/json.js";
import { isPathInside } from "../kernel/path-safety.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { Finding } from "../vocabulary/report.js";
import { pathCaseIndex, type PathCaseIndex } from "./case.js";
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
  /**
   * The directory-listing memo behind the case check, shared across a whole
   * run by whoever owns the walk. Omitted, each call builds its own — correct,
   * just not shared. Never a module-level cache: a listing that outlived one
   * command would answer for a directory that has since changed.
   */
  cases?: PathCaseIndex;
}

/** A link that points at a real file inside the docs repo, and the file it points at. */
export interface ResolvedLink {
  link: DocumentLink;
  /** The absolute path the link names, as `node:path` resolves it. */
  target: string;
}

/** One document's links, split by whether the docs repo answers for them. */
export interface DocumentLinkage {
  resolved: ResolvedLink[];
  /** Links inside the docs repo that name nothing — with the stored spelling, where there is one. */
  broken: Array<{ link: DocumentLink; storedAs?: string }>;
}

/**
 * Every link in one document, resolved against the docs repo.
 *
 * TARGETS OUTSIDE THE DOCS REPO ARE NEITHER RESOLVED NOR BROKEN, and the
 * exclusion is honesty rather than leniency. A docs repo is routinely checked
 * out beside nothing else, so `../../payments-svc/README.md` is a path loam
 * cannot answer for: the file's absence here is evidence about this checkout,
 * not about the link. Only a target that stays inside `docsDir` gets a verdict,
 * which is the same boundary every other reader in loam observes and the reason
 * the finding below can afford to be an error at all.
 *
 * CASE COUNTS, and it must, because the alternative is a check that passes on
 * the author's machine and fails where the work is read. `existsSync` is
 * case-insensitive on Windows and macOS; GitHub's renderer and every Linux CI
 * runner are not. So a resolving link is one that exists AND is spelled the way
 * the filesystem stores it — and when it is not, `storedAs` carries the real
 * name into the message, on every platform alike, so the diagnosis does not
 * depend on which operating system ran the check.
 */
export function resolveLinks(doc: LinkedDocument, scope: LinkScope): DocumentLinkage {
  const cases = scope.cases ?? pathCaseIndex();
  const dir = dirname(doc.path);
  const linkage: DocumentLinkage = { resolved: [], broken: [] };
  for (const link of documentLinks(doc.text)) {
    const target = resolve(dir, link.path);
    if (!isPathInside(scope.docsDir, target)) continue;
    if (existsSync(target) && cases.spelledExactly(scope.docsDir, target)) {
      linkage.resolved.push({ link, target });
      continue;
    }
    const storedAs = cases.storedAs(dirname(target), basename(target));
    linkage.broken.push({ link, ...(storedAs === undefined ? {} : { storedAs }) });
  }
  return linkage;
}

/** The links in one document that resolve to nothing, as at most one finding. */
export function unresolvedLinkFindings(doc: LinkedDocument, scope: LinkScope): Finding[] {
  const where = repoPath(scope.docsDir, doc.path);
  const { broken } = resolveLinks(doc, scope);
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
      details: broken.map((one) => detail(where, one)),
    },
  ];
}

/**
 * One broken link, spelled so the author can find it: the file and line first,
 * then the link exactly as written. `raw` rather than the decoded path, because
 * the decoded form is not the string that is in the document.
 *
 * The stored spelling is appended when the only thing wrong is case, because
 * without it the message reads as a lie — the file the author is being told to
 * write is already sitting beside the one they linked from.
 */
function detail(where: string, one: { link: DocumentLink; storedAs?: string }): string {
  const line = `${where}:${one.link.line}: [${one.link.text}](${one.link.raw})`;
  return one.storedAs === undefined ? line : `${line} — stored as '${one.storedAs}'`;
}
