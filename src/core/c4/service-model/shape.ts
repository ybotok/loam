/**
 * Which of the two shapes a `model.likec4` has, decided by a byte scan of the
 * file itself.
 *
 * A STANDALONE model declares at least one `element <kind>` inside a top-level
 * `specification { }` block. It is parsed ALONE, exactly as every model was
 * before this axis: it may re-declare the partners it talks to, and it renders
 * only as a project of its own. An EXTENDING model declares no element kind —
 * it takes the map's — and says what is inside the service with
 * `extend <fqn> { … }`; it is parsed INSIDE the fleet's `architecture/`
 * project, beside the map that declares those kinds.
 *
 * THE FILE'S OWN GRAMMAR DECIDES, never a config key, and that is the whole
 * design of this module. A flag in `loam.json` would be a second authority on a
 * fact the document already states, free to disagree with it — and the
 * disagreement is not a warning but a parse: a model read the wrong way is
 * either eleven `c4.invalid` errors (an extending model parsed alone: measured,
 * deleting a model's `specification` under the old loader) or a pile of
 * duplicate-declaration errors blamed on BOTH files (a standalone model staged
 * beside the landscape). Nothing about a model has to be migrated for loam to
 * read it correctly; the bytes say which it is.
 *
 * Every other answer is `extending`, and each of those is legal on purpose: a
 * tags-only `specification { tag req-X }` (measured legal inside one project,
 * and it lands the tag in the project's specification), a bare `model {}`, an
 * empty file, a file that is only `views { }`. The conservative direction is
 * therefore towards `extending` — which is why an unreadable file is NOT
 * classified here at all (see `FleetContext.serviceModel`): absence is a
 * question for the reader that establishes the file exists, not for a scanner
 * looking at bytes it does not have.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inOrder } from "../../kernel/concurrency.js";
import { maskSource, matchBrace } from "../source-mask.js";

export type ModelShape = "standalone" | "extending";

/**
 * A kind declaration inside a specification block — `element service`,
 * `element softwareSystem`. Deliberately only `element`: `tag`,
 * `relationship`, `deploymentNode` and `color` declare no ELEMENT kind, and a
 * model whose specification holds only those still takes every element kind it
 * uses from the map, which is exactly what makes it extending.
 */
const ELEMENT_KIND = /\belement\s+[A-Za-z_][\w-]*/;

/**
 * The shape of a model, from its source text.
 *
 * The scan runs over MASKED source (`../source-mask.ts`), so a comment or a
 * string containing `specification { element x }` counts for nothing — and that
 * is not a hypothetical: the brief loam writes for an adopted service explains
 * the other shape in a comment, so an authored model can easily carry those
 * exact words in prose. Reading them as a declaration would flip a whole
 * service to the wrong loader.
 *
 * Only TOP-LEVEL blocks are considered — depth zero in the masked source — for
 * the same reason: `specification` nested inside another block is not a
 * declaration LikeC4 would honour, so loam must not honour it either.
 *
 * An unbalanced block (no closing brace) is read to end of file and still
 * answers `standalone` when it declares a kind. That file does not parse at
 * all, and both loaders will say so; answering `standalone` sends the reader to
 * the one whose errors name only this file, which is the honest half of a
 * broken document.
 */
export function modelShape(text: string): ModelShape {
  const { code } = maskSource(text);
  // Built per call rather than hoisted to module scope: a `/g` regex carries
  // `lastIndex`, which is mutable state a second caller would inherit — the
  // module-level-state hazard AGENTS.md names, arriving through a constant that
  // looks immutable.
  const specification = /\bspecification\s*\{/g;
  for (let match = specification.exec(code); match !== null; match = specification.exec(code)) {
    const open = match.index + match[0].length - 1;
    if (depthBefore(code, match.index) !== 0) continue;
    const close = matchBrace(code, open);
    const body = close === -1 ? code.slice(open + 1) : code.slice(open + 1, close);
    if (ELEMENT_KIND.test(body)) return "standalone";
  }
  return "extending";
}

/**
 * One model's shape, from its bytes — the shape of a file that cannot be read
 * is `standalone`.
 *
 * That is the conservative arm rather than a guess. The standalone path hands
 * the model to the per-file loader, so a caller asking about a file that is not
 * there (or is not readable) gets today's exact error — `c4.invalid`, naming
 * that file — instead of a slice of the fleet map, which is what the extending
 * path would answer about a document nobody could open.
 */
export async function readModelShape(path: string): Promise<ModelShape> {
  return readFile(path, "utf8").then(modelShape, (): ModelShape => "standalone");
}

/**
 * Many models' shapes at once, keyed by RESOLVED path.
 *
 * The fleet needs this list before it can do anything else: which models are
 * batched as projects and which as documents, which directories are owed a
 * per-service `likec4.config.json` and which must not have one. Every one of
 * those questions is asked over the FULL service enumeration rather than over
 * whatever subset a run is grading, so the read is a bulk one through the
 * shared pool — a fleet of 56 models is 56 small reads, and the pool is what
 * keeps them from being 56 sequential round-trips on a network-mounted docs
 * repo.
 */
export async function readModelShapes(paths: readonly string[]): Promise<Map<string, ModelShape>> {
  const entries = await inOrder(paths, async (path) => [resolve(path), await readModelShape(path)] as const);
  return new Map(entries);
}

/**
 * How many blocks are open at `index` in masked code. A plain count, because
 * the mask has already blanked every brace inside a string or a comment — the
 * one thing that would make counting lie.
 */
function depthBefore(code: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") depth -= 1;
  }
  return depth;
}
