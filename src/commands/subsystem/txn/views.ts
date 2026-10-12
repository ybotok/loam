/**
 * What the generated views files MUST say — the shared answer every subsystem
 * writer and `subsystem sync` render from, and the one compare both make against
 * it (`planGenerated`). A module beneath the verbs (in the txn/ subpackage)
 * because the commit window and sync both consume it, and a second spelling of
 * "what should the views say" would be a second chance to disagree with
 * `validate`'s staleness check.
 *
 * BOTH generated files come out of ONE read of the map, and that is the reason
 * this module answers about the pair rather than about one file: they are
 * rendered from the same parsed `architecture/` project, they are repaired by
 * the same command, and they must land in the same commit — a verb that changed
 * a service's placement changed a subsystem view's members AND that service's
 * overview TITLE (`<subsystem path> / <service id>`), so shipping one without
 * the other is the "stale between two commits" state the generated files'
 * contract exists to refuse. Reading the project twice would also parse the
 * whole fleet map twice per run for one answer.
 */
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { loadFile } from "../../../core/c4/likec4.js";
import { architectureProjectDocuments, loadArchitecture } from "../../../core/c4/project/architecture.js";
import { serviceDirOf, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { landscapePath, serviceViewsPath, subsystemViewsPath } from "../../../core/repo/paths.js";
import {
  type MapFacts,
  renderServiceOverviews,
  renderSubsystemViews,
  viewsAgree,
} from "../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";
import type { PlannedWrite } from "../../../core/staging/writes.js";

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
 * The elements, the relationships and the declared global style ids of the whole
 * `architecture/` PROJECT — the member join, the edges every per-service view
 * computes its peer set from, and the one line a view may borrow a palette
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
  // No map at all: no elements and NO EDGES, said outright. `relationships` is
  // required of every `MapFacts` precisely so an empty answer has to be written
  // down rather than dropped — see the type.
  if (!existsSync(path)) return { facts: { elements: [], relationships: [] }, known: true };
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
      // THE LANDSCAPE'S OWN RELATIONSHIPS TRAVEL WITH ITS ELEMENTS. This arm
      // composes a record rather than handing the document across, because the
      // style census below is widened past what this one document declares — and
      // the first version of it listed the fields it happened to be thinking
      // about and dropped the edges the document was carrying all along. That is
      // silent: every per-service view then renders with no peers, the service
      // and its own interior and nothing it touches, and no check anywhere says
      // so. `MapFacts` now REQUIRES the field for exactly this reason; the copy
      // stays explicit so the widening above it stays visible.
      return {
        facts: {
          elements: file.elements,
          relationships: file.relationships,
          globalStyles: await declaredStyles(docsDir, file),
        },
        known: false,
      };
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
 * ONE generated file: where it lives, and the bytes it must hold — `null` for
 * "this file must not exist", which is a state of its own and not a blank file
 * (`render/stale.ts` keeps the same three apart on the reading side).
 */
export interface ExpectedFile {
  path: string;
  content: string | null;
}

/** What a commit does to one generated file once every writer's own veto has passed. */
export type ViewsAction = "created" | "updated" | "removed" | "current";

/**
 * Compare ONE generated file against what it must say: the write when they
 * differ, and what that write is. Both writers of these files — `../sync.ts`'s
 * `planFile` and the verbs' `stageGenerated` (`./txn.ts`) — put their own veto
 * in front of this and nothing else, because the rule is one rule, and a second
 * spelling of it would be a second chance for the two writers to answer
 * differently about the same file.
 *
 * The compare is over CONTENT, not bytes: `viewsAgree` records why, beside the
 * generator. A Windows clone hands a generated file back CRLF with not one fact
 * changed, and a byte compare made `sync` answer `updated` and rewrite it LF —
 * after which git shows the file permanently modified and the next checkout puts
 * the CRLF back — and folded the same rewrite into every subsystem move's
 * transaction and journal. `validate` stopped demanding that rewrite; the
 * writers must stop offering it, or they disagree about the same file. What gets
 * WRITTEN is still the LF render as a Buffer, so the decode is a comparison only.
 */
export function planGenerated(file: ExpectedFile, current: string | null): { action: ViewsAction; write: PlannedWrite | null } {
  if (viewsAgree(current, file.content)) return { action: "current", write: null };
  const bytes = file.content === null ? null : Buffer.from(file.content, "utf8");
  return {
    action: current === null ? "created" : bytes === null ? "removed" : "updated",
    write: { path: file.path, content: bytes },
  };
}

/**
 * The bytes BOTH generated files must hold for this tree, and whether the map
 * they were computed from was read as a PROJECT.
 *
 * The content is always renderable — from the landscape file alone, or from
 * nothing — because a fleet with no generated file yet must still get one, and
 * the tree-changing verbs must still land theirs in the commit that changes the
 * tree. `known: false` is the caller's licence to leave an EXISTING file alone
 * instead (`../sync.ts`, `action: "blocked"`).
 *
 * NAMED FIELDS, never an array, and never one folded answer: the two files go
 * stale for different reasons and each is named in its own finding and its own
 * report line, so a caller that could not tell them apart would have nothing to
 * say. `subsystem.views-stale` carries the path precisely so one code covers
 * both honestly.
 *
 * THE SERVICE FILE IS THE ONE THE MAP CAN EMPTY. `renderSubsystemViews` answers
 * null only when the TREE has no subsystems — a fact no map can change — while
 * `renderServiceOverviews` answers null whenever no service resolves to an
 * element, which is exactly what an unreadable map looks like from here (`facts`
 * falls back to an empty element list and an empty edge list alike). So for that
 * file "must be absent" and "loam could not read the map" are the same bytes,
 * and only `known` tells them apart:
 * a writer must not treat a null service render under `known: false` as evidence
 * that the file should go. Both callers hold that line, and say so.
 */
export interface ExpectedViews {
  /**
   * The `architecture/` PROJECT was read. False means the content was rendered
   * from the landscape file alone — or from nothing at all — so its style census
   * is not one an existing file may be rewritten from, and its element join is
   * not one the per-service file may be deleted on.
   */
  known: boolean;
  /** `architecture/subsystems.likec4` — one view per subsystem, from the tree. */
  subsystems: ExpectedFile;
  /** `architecture/services.likec4` — one overview view per service the map draws. */
  services: ExpectedFile;
}

export async function expectedViews(docsDir: DocsDir, tree: FleetTree): Promise<ExpectedViews> {
  const read = await landscapeFacts(docsDir);
  // The parsed DOCUMENT goes across, never a literal composed here: `MapFacts`
  // carries the relationships the per-service peer sets are computed from, and a
  // caller that dropped them would render every service view peerless — the
  // service and its interior, and nothing it touches — with no error anywhere.
  // The type now REQUIRES the field so that mistake cannot be made silently
  // (`render/views.ts` records what it cost); this last-resort literal is the one
  // place an empty answer is the TRUE one — loam could not read the map at
  // all — and it says so rather than leaving the field off.
  const map = read.facts ?? { elements: [], relationships: [] };
  return {
    known: read.known,
    subsystems: { path: subsystemViewsPath(docsDir), content: renderSubsystemViews(tree, map) },
    services: { path: serviceViewsPath(docsDir), content: renderServiceOverviews(tree, map) },
  };
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
