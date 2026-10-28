/**
 * Which views a set of `.likec4` documents DECLARES, read from their text — the
 * evidence a `navigateTo` is graded against (`../navigation/unplaced.ts`).
 *
 * TEXT, not a LikeC4 load, and on purpose: it is asked exactly when a load
 * already failed to place a link, about a project loam never loads whole — the
 * renderer's, which holds the generated documents every loam load leaves out so
 * a stale one cannot blank the map. A parse of it could fail for that very
 * reason and say nothing about the views. The scan reads the declaration and
 * nothing else: over MASKED source, so a view named in a comment or a title
 * declares nothing, and only a `view` at the top of a top-level `views { }`
 * block counts.
 *
 * A package of its own because both readers of it sit where the package graph
 * allows nothing new: `../project/` is at its five files and imports from here,
 * and `../navigation/` is a leaf every loader imports, which this — reading
 * `../source-mask.ts` — may not join without closing a cycle.
 */
import { readFile } from "node:fs/promises";
import { inOrder } from "../../kernel/concurrency.js";
import type { RenderedViews } from "../navigation/unplaced.js";
import { maskSource, topLevelBlocks } from "../source-mask.js";

/**
 * Every view the given documents declare, by id. A document that cannot be read
 * contributes nothing — a link that names a view only it declares stays an
 * error, which is the direction a check may err in. A view id declared twice
 * keeps its first declaration; LikeC4 refuses the project either way.
 */
export async function declaredViewsIn(paths: readonly string[]): Promise<RenderedViews> {
  const texts = await inOrder(paths, (path) => readFile(path, "utf8").catch(() => null));
  const views = new Map<string, { dynamic: boolean }>();
  for (const text of texts) {
    if (text === null) continue;
    for (const [id, dynamic] of declaredViews(text)) if (!views.has(id)) views.set(id, { dynamic });
  }
  return views;
}

/** The words that may follow `view` where the view has no id of its own — or that begin the next one. */
const NOT_AN_ID = new Set(["of", "extends", "view", "dynamic", "deployment"]);

/**
 * Every `[id, dynamic]` one document's `views` blocks declare.
 *
 * A view's body is OPTIONAL in the pinned grammar — `view stub` is a whole
 * declaration — so a heading is read up to its id and never up to a `{`: a
 * pattern that ran on to the next brace swallowed the view after a bodyless
 * one, and a link into that view failed the whole map again (the defect this
 * evidence exists to stop). The id is read through a lookahead for the same
 * reason, so the word after a bare `view` can still begin the next heading.
 * Depth is counted per block, because a heading only counts directly inside
 * `views { }`, never inside a view's own body.
 */
function* declaredViews(text: string): Generator<[string, boolean]> {
  const { code } = maskSource(text);
  // Both built per call, as `../service-model/shape.ts` builds its own: a `/g`
  // regex carries `lastIndex`, mutable state a module-level one would share.
  // The first is a top-level `views` block (a title it may carry is masked to
  // blanks); the second, one view heading — its kind word, and its id if the
  // next token is one.
  const viewsBlock = /\bviews\b[^{}]*\{/g;
  const viewHead = /\b(?:(dynamic|deployment)\s+)?view\b(?=\s+([A-Za-z_][\w-]*)|)/g;
  for (const { body } of topLevelBlocks(code, viewsBlock)) {
    let depth = 0;
    let cursor = 0;
    for (const match of body.matchAll(viewHead)) {
      for (; cursor < match.index; cursor += 1) {
        if (body[cursor] === "{") depth += 1;
        else if (body[cursor] === "}") depth -= 1;
      }
      const id = match[2];
      if (depth === 0 && id !== undefined && !NOT_AN_ID.has(id)) yield [id, match[1] === "dynamic"];
    }
  }
}
