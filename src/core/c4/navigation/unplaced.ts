/**
 * `navigateTo` — the one reference loam lets a load leave unresolved, and who
 * grades it instead.
 *
 * A `navigateTo` is a click-through link between rendered views, and loam reads
 * nothing it carries (docs/DESIGN.md rule 26: a view's rendering is the
 * renderer's). Measured at the 1.59.2 pin: with the clause unresolved, the
 * parsed stage hands back byte-identical elements, relationships, dynamic views
 * and view ids. What it CAN do is fail a load — and most loads loam makes are
 * narrower than the project the renderer builds: the map alone for the
 * archive's merge proof, `architecture/` without the extending models and
 * without the generated views for the map's grade, `architecture/` plus one
 * model per service project. A link to a view one of the other documents
 * declares resolved for `likec4 validate` and failed for loam, and since a
 * failed map blanks every cross-service check, one link turned a pilot fleet's
 * gate red (report 042: `landscape.invalid` plus one `spine.landscape-invalid`
 * per service, and `delta.merge-refused` on every active feature).
 *
 * So a load never decides a link on the evidence of its own documents alone. A
 * load that is handed the views of the renderer's project
 * (`placedLinksDropped`) keeps exactly the links that name none of them; a
 * DOCUMENT load, which knows only its one file, sets every unresolved link
 * aside as data (`splitLinks`, `LoadedDoc.unplaced`) for the reader that knows
 * which project the document renders in — `../project/architecture.ts`'s
 * `gradeLinks` — so a link that lands nowhere is still an error wherever it
 * was one, and only the links LikeC4 itself resolves stop being errors.
 *
 * Two grammar slots take a link, both measured in the pinned grammar:
 * `DynamicViewRef` — an edge's body, a dynamic step's, and a relation predicate
 * written `include a -> b with { navigateTo … }`, all of which take a DYNAMIC
 * view only — and `ViewRef`, the element form `include x with { navigateTo … }`,
 * which takes any view. `view a extends b` is a third view reference and is
 * deliberately NOT here: with its parent unresolved the parsed stage DROPS the
 * child view, so the view-id census loam reads changes, and setting that
 * diagnostic aside would grade a project loam did not actually read.
 *
 * A package of its own, and a leaf, because every loader imports it —
 * `../likec4.ts` among them — and a module there that imported anything above
 * the loaders would close a package cycle through `fleet-context`.
 */

/**
 * The views a renderer's project declares, by id, each marked dynamic or not —
 * the evidence a link is checked against (`../project/architecture.ts` builds
 * it, from the documents' text).
 */
export type RenderedViews = ReadonlyMap<string, { dynamic: boolean }>;

/**
 * LikeC4's linker message for those two slots, matched exactly: Langium spells
 * it `Could not resolve reference to <type> named '<name>'.`, and the type is
 * the grammar's target rule — `DynamicView` for the first slot, `LikeC4View`
 * for the second — so an unresolved ELEMENT or TAG can never match.
 */
const UNPLACED = /^Could not resolve reference to (DynamicView|LikeC4View) named '([^']+)'\.$/;

/** The view an unresolved link names and whether only a dynamic view will do; null for any other diagnostic. */
function unplacedLink(message: string): { view: string; dynamic: boolean } | null {
  const match = UNPLACED.exec(message);
  return match === null ? null : { view: match[2]!, dynamic: match[1] === "DynamicView" };
}

/** Diagnostics minus every unresolved link — what a project load reports when no reader grades its links. */
export function withoutLinks<E extends { message: string }>(errors: readonly E[]): E[] {
  return errors.filter((e) => unplacedLink(e.message) === null);
}

/**
 * Diagnostics split into the ones a document load reports and the links it
 * sets aside. Order is kept on both sides, so a reader that puts a link back
 * puts it back where `distinctErrors` sorted it.
 */
export function splitLinks<E extends { message: string }>(errors: readonly E[]): { errors: E[]; unplaced: E[] } {
  return {
    errors: errors.filter((e) => unplacedLink(e.message) === null),
    unplaced: errors.filter((e) => unplacedLink(e.message) !== null),
  };
}

/**
 * Diagnostics minus every link whose view the renderer's project declares — a
 * dynamic one where only a dynamic one will do, because LikeC4 refuses an
 * edge's link to a static view whatever its id. A link named nowhere stays, and
 * so does every other diagnostic.
 *
 * `rendered` is asked only when there is a link to look up, so a project that
 * names no unresolved link — every healthy fleet — never pays for the walk.
 */
export async function placedLinksDropped<E extends { message: string }>(
  errors: readonly E[],
  rendered: () => Promise<RenderedViews>,
): Promise<E[]> {
  if (errors.every((e) => unplacedLink(e.message) === null)) return [...errors];
  const views = await rendered();
  return errors.filter((e) => {
    const link = unplacedLink(e.message);
    if (link === null) return true;
    const view = views.get(link.view);
    return view === undefined || (link.dynamic && !view.dynamic);
  });
}
