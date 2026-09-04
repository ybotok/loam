/**
 * What the generated views file MUST say — the shared answer every subsystem
 * writer and `subsystem sync` render from. A module beneath the verbs (in the
 * txn/ subpackage) because the commit window and sync both consume it, and a
 * second spelling of "what should the views say" would be a second chance to
 * disagree with `validate`'s staleness check.
 */
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { loadFile } from "../../../core/c4/likec4.js";
import { architectureProjectDocuments, loadArchitecture } from "../../../core/c4/project/architecture.js";
import { serviceDirOf, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { landscapePath } from "../../../core/repo/paths.js";
import { type MapFacts, renderSubsystemViews } from "../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";

/** What one read of the map yielded, and whether it came from the whole project. */
export interface LandscapeRead {
  /** The element join and the style census, or null when neither reading was available. */
  facts: MapFacts | null;
  /**
   * The `architecture/` PROJECT parsed. FALSE means the facts below, if there
   * are any, were assembled document by document — the member join from the
   * landscape file alone (so an element a use-case document binds is missing
   * from it), the style census from every document that parses on its own.
   */
  known: boolean;
}

/**
 * The elements and declared global style ids of the whole `architecture/`
 * PROJECT — the member join, and the one line a view may borrow a palette
 * with — with the provenance of that answer beside it.
 *
 * The PROJECT, not the landscape file alone, and that is a correctness rule
 * rather than a preference: `validate` grades this file against
 * `loadArchitecture` — the landscape merged with every
 * `architecture/usecases/*.likec4`, which may `extend` the model and bind
 * elements of its own. While this side read the landscape alone, a use-case
 * document declaring one element bound to a filed service was enough to make
 * `sync` answer `current` while `validate --all` reported
 * `subsystem.views-stale` and named `sync` as the repair — a loop no command
 * could clear, reproduced on `examples/docs` before this call changed. Two
 * readers of "what should the views say" must read the same documents, or the
 * shared render in `core/repo/tree/render/views.ts` is shared in name only.
 *
 * WHY THE FALLBACK AND THE FLAG ARE TWO ANSWERS RATHER THAN ONE. The fallback
 * exists because one broken use-case document must not cost the render its
 * member join: the landscape's own elements are still the truth about who
 * belongs in which subsystem, and re-rendering the file without them takes every
 * `include` line off it (verification 2026-09-04, W5). But the STYLE CENSUS is
 * not the landscape file's alone — SCHEMA blesses a palette in any `.likec4`
 * under `architecture/` — so the fallback takes it over EVERY document that
 * parses on its own (`declaredStyles`). Reading it off the landscape alone was
 * enough to drop `global style subsystems` from a good generated file whenever
 * the palette sat in a sibling and an unrelated sibling was broken
 * (re-verification 2026-09-04, area C item 8).
 *
 * `known` still means the PROJECT parsed, and nothing weaker, because the MEMBER
 * JOIN is what it licences: a use-case document that binds an element of its own
 * contributes to the join and cannot be read document by document. It is
 * `../sync.ts`'s licence to leave an existing file alone.
 *
 * An ABSENT map is not a failure: there is nothing to read, the empty facts are
 * the truth, and the tolerant render is what a fleet being scaffolded needs. An
 * EMPTY project is no longer reachable here — `architectureProjectDocuments`
 * keeps the landscape whatever the root `exclude` says, and its banner records
 * what an empty one cost.
 */
export async function landscapeFacts(docsDir: DocsDir): Promise<LandscapeRead> {
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return { facts: { elements: [] }, known: true };
  try {
    const doc = await loadArchitecture(docsDir);
    // The whole document on success, so the render reads the same record
    // `validate --all` grades against; `globalStyles` rides along without
    // being named here, and a field the loaders add later does too.
    if (doc.errors.length === 0) return { facts: doc, known: true };
  } catch {
    // A throw and a parse error are the same evidence: fall through to the file.
  }
  try {
    const file = await loadFile(path);
    // THE STYLE CENSUS IS TAKEN OVER EVERY DOCUMENT, not over the landscape, and
    // that is what makes the fallback safe for a verb that has to write. A
    // palette declared in a SIBLING under `architecture/` is invisible to a read
    // of the landscape alone, so a `subsystem new` run standing beside one
    // unrelated broken sibling silently dropped `global style subsystems` from a
    // good generated file — the landscape parsed, the element join survived, and
    // nothing graded the loss because `sync` answers `blocked` for as long as the
    // broken file stands (re-verification 2026-09-04, area C item 8). Reading
    // each document ON ITS OWN is the widening the fallback is entitled to: it
    // cannot merge them (that is what failed one line up), but a document that
    // parses alone certainly declares the style groups it declares.
    if (file.errors.length === 0) {
      return { facts: { elements: file.elements, globalStyles: await declaredStyles(docsDir, file) }, known: false };
    }
  } catch {
    // Unreadable bytes; the caller is told loam could not say.
  }
  return { facts: null, known: false };
}

/**
 * Every global style id declared by an `architecture/` document that parses ON
 * ITS OWN, the landscape's included — the union, sorted, so the render is a
 * function of the set rather than of readdir order.
 *
 * The document set is `architectureProjectDocuments`: the same list the PROJECT
 * read uses, so the fallback can never consider a file the merged read would
 * have excluded — the generated views file itself, or one the root `exclude`
 * hides from the renderer. A document that does not parse alone contributes
 * nothing and is not an error here: it is named by `loam validate --all`, and
 * the note this module carries already tells the reader the census came from
 * outside a project read.
 */
async function declaredStyles(docsDir: DocsDir, landscape: MapFacts): Promise<string[]> {
  const ids = new Set(landscape.globalStyles ?? []);
  let paths: string[];
  try {
    paths = await architectureProjectDocuments(docsDir);
  } catch {
    return [...ids].sort();
  }
  const map = resolve(landscapePath(docsDir));
  for (const path of paths) {
    if (resolve(path) === map) continue;
    try {
      const doc = await loadFile(path);
      if (doc.errors.length === 0) for (const id of doc.globalStyles ?? []) ids.add(id);
    } catch {
      // One unreadable sibling costs its own styles and nothing else.
    }
  }
  return [...ids].sort();
}

/**
 * The bytes the views file must hold for this tree, and whether the map they
 * were computed from was read as a PROJECT.
 *
 * The content is always renderable — from the landscape file alone, or from
 * nothing — because a fleet with no generated file yet must still get one, and
 * the tree-changing verbs must still land theirs in the commit that changes the
 * tree. `known: false` is the caller's licence to leave an EXISTING file alone
 * instead (`../sync.ts`, `action: "blocked"`).
 */
export interface ExpectedViews {
  /**
   * The `architecture/` PROJECT was read. False means the content was rendered
   * from the landscape file alone — or from nothing at all — so its style census
   * is not one an existing file may be rewritten from.
   */
  known: boolean;
  /** The bytes the file must hold, or null for "must be absent". */
  content: string | null;
}

export async function expectedViews(docsDir: DocsDir, tree: FleetTree): Promise<ExpectedViews> {
  const read = await landscapeFacts(docsDir);
  return { known: read.known, content: renderSubsystemViews(tree, read.facts ?? { elements: [] }) };
}

/**
 * The one line a person is owed when the map cannot be read — the same sentence
 * from `../sync.ts` (which then leaves an existing file alone) and from a
 * tree-changing verb (which renders the tolerant shape anyway, because its own
 * contract is that the file lands in the verb's commit). It names the gating
 * surface rather than repeating its findings: `loam validate --all` is where the
 * broken document is named. It lives here, beside the facts it is about, because
 * both callers are on this side of the `txn/` boundary and a constant in
 * `../sync.ts` would point the package edge back up.
 */
export const LANDSCAPE_UNREADABLE_NOTE =
  "note: architecture/ does not parse as one project, so the element join is whatever " +
  "architecture/landscape.likec4 alone says and the style census is the union of the documents that parse on " +
  "their own — fix the map (`loam validate --all` names the file), then re-run `loam subsystem sync`.";

/**
 * The tree AS THE RENAMES LEAVE IT, computed in memory: every dir under a
 * moved root is remapped by prefix, and each entry's placement chain is
 * re-derived from its remapped dir. The views file is rendered from this, so
 * the commit lands file and renames agreeing — never from a re-walk that
 * would have to happen between two states. Beside `expectedViews` because the
 * two are one promise: what the commit renames and what the file says must
 * come from the same in-memory answer.
 */
export function movedTree(tree: FleetTree, renames: { from: string; to: string }[], servicesRoot: string): FleetTree {
  const remap = (dir: string): string => {
    for (const r of renames) {
      if (dir === r.from || dir.startsWith(r.from + sep)) return r.to + dir.slice(r.from.length);
    }
    return dir;
  };
  const chainOf = (dir: string): string[] => relative(servicesRoot, dir).split(sep);
  return {
    findings: tree.findings,
    services: tree.services.map((s) => {
      const dir = remap(s.dir);
      // The constructor call records provenance: a readdir-established
      // directory carried through a rename this same commit performs.
      return { ...s, dir: serviceDirOf(dir), subsystem: chainOf(dir).slice(0, -1) };
    }),
    subsystems: tree.subsystems.map((s) => {
      const dir = remap(s.dir);
      return { ...s, dir, path: chainOf(dir) };
    }),
  };
}
