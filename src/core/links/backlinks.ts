/**
 * Who links to what, across the whole repository — the link graph read
 * backwards.
 *
 * `link.unresolved` asks each document about its own links. This asks the
 * opposite question, and it is the one the glossary is built on: "which
 * documents use this term" is exactly "which documents link to `glossary/<term>.md`",
 * and no single target can answer it. A term is cited from a service's spec, a
 * capability document and a feature's intent, so the index is fleet-scope by
 * construction.
 *
 * IT IS THE SAME WALK AS THE FINDING, deliberately — `resolveLinks` produces
 * both halves of one answer, and the corpus is `core/links/corpus.ts`'s single
 * definition. An index built from a second enumeration would report a term as
 * unused while the document citing it was being graded one target over.
 *
 * AN UNREADABLE DOCUMENT IS RETURNED, not swallowed. A term can only be shown as
 * cited by nobody if loam actually read everybody, and a UTF-16 spec.md would
 * otherwise turn into a silently missing citation. Under `validate` the same
 * file already earns `link.unreadable`; `loam list` has no such finding, so it
 * needs the list to say what it did not read.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoPath } from "../envelope/json.js";
import type { FleetContext } from "../fleet-context.js";
import { decodeDocument } from "../kernel/document-bytes.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { pathCaseIndex } from "./case.js";
import { allAuthoredDocuments } from "./corpus.js";
import { resolveLinks } from "./findings.js";

export interface BacklinkIndex {
  /** Repo-relative paths of the documents linking to `target`, ordered, without duplicates. */
  linkersOf(target: string): string[];
  /** Repo-relative paths of documents whose links could not be read at all. */
  unreadable: string[];
}

/**
 * Build the index over every authored document in the repository.
 *
 * One `pathCaseIndex` for the whole walk, because this one really is fleet-wide
 * and the same directories are asked about hundreds of times. Still not a
 * module-level cache: it lives exactly as long as this call.
 */
export async function backlinkIndex(docsDir: DocsDir, fleet?: FleetContext): Promise<BacklinkIndex> {
  const linkers = new Map<string, Set<string>>();
  const unreadable: string[] = [];
  const scope = { docsDir, cases: pathCaseIndex() };
  for (const path of await allAuthoredDocuments(docsDir, fleet)) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = fleet === undefined ? decodeDocument(await readFile(path), path) : await fleet.readText(path);
    } catch {
      unreadable.push(repoPath(docsDir, path));
      continue;
    }
    const from = repoPath(docsDir, path);
    for (const { target } of resolveLinks({ path, text }, scope).resolved) {
      const key = resolve(target);
      let sources = linkers.get(key);
      if (sources === undefined) linkers.set(key, (sources = new Set()));
      sources.add(from);
    }
  }
  unreadable.sort();
  return {
    linkersOf: (target) => [...(linkers.get(resolve(target)) ?? [])].sort(),
    unreadable,
  };
}
