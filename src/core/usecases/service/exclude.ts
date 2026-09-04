/**
 * Which `.likec4` files beside a `model.likec4` the RENDERER actually loads —
 * the `exclude` list of the service's own `likec4.config.json`.
 *
 * loam writes that file with two keys and never reads it back
 * (`core/repo/tree/render/projects.ts` states the ownership rule), but a team
 * may add keys to it, and `exclude` is the one that changes what the project
 * holds. Until this module existed the service-flow reader staged every sibling
 * regardless: a view the renderer never sees was graded, and the finding it
 * earned said the project is "read the way the renderer reads it" and that the
 * view still renders — three claims about a file nobody would ever open
 * (verification 2026-09-04, D10).
 *
 * STANDALONE MODELS ONLY, which is where this file IS the project config. A
 * model that extends the map is read inside the ROOT project, whose own
 * `exclude` decides what it holds; a per-service config beside such a model is
 * a stray with a finding of its own (`service.likec4-config-stray`), and
 * honouring its list here would silence a document the renderer really does
 * load.
 *
 * THE MATCHER IS THE ONE MEASURED, at the likec4 1.59.2 pin, on a scratch
 * service directory holding `model.likec4`, `views.likec4` and
 * `usecases/flow.likec4` (`npx likec4 validate <dir>`, counting "found N source
 * files"): an entry drops a file when the file's directory-relative path STARTS
 * WITH the entry (`views`, `views.`, `views.likec4`, `usecases`, `usecases/`,
 * `usecases/flow` each dropped one; `ews.likec4` dropped none), or when it
 * matches as a glob whose `*` crosses `/` (`*.likec4` dropped all THREE), or
 * when a leading RECURSIVE segment — a doubled star and a slash — stands for
 * the zero or more directories above the file: that segment before `*.likec4`
 * dropped all three, and before `usecases` (with a recursive tail) or
 * `views.likec4` it dropped one each. All three halves are implemented because
 * all three were observed; nothing here interprets more than that, and an entry
 * loam cannot match leaves the file loaded — grading a file the renderer skips
 * is a wrong sentence, and skipping one it reads is a missing finding, which is
 * the worse of the two.
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { isRecord } from "../../kernel/records.js";
import { excludingPath } from "../../c4/root-project/exclude.js";
import type { ServiceDir } from "../../kernel/ids/dirs.js";

/** The per-service project file, by the name `core/repo/tree/render/projects.ts` writes it under. */
const CONFIG = "likec4.config.json";

/**
 * The service project's `exclude` entries, or `[]` when there is no list to
 * read — absent, unreadable, not JSON, or an `exclude` that is not a list of
 * strings. Failing open is right here and nowhere else: the answer decides
 * whether loam GRADES a document, and an empty list grades everything, which is
 * exactly what loam did before this module and never a new silence.
 */
export async function serviceProjectExclude(dir: ServiceDir): Promise<string[]> {
  const text = await readFile(`${dir}/${CONFIG}`, "utf8").catch(() => null);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const exclude: unknown = parsed["exclude"];
  if (!Array.isArray(exclude)) return [];
  const entries: unknown[] = exclude;
  return entries.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** The siblings that survive the list — absolute paths in, absolute paths out, order kept. */
export function keepIncluded(dir: ServiceDir, exclude: readonly string[], paths: readonly string[]): string[] {
  if (exclude.length === 0) return [...paths];
  return paths.filter((path) => !excluded(exclude, relative(dir, path).split(/[\\/]/).join("/")));
}

/**
 * Three rungs, because three separate spellings were measured hiding a file and
 * no one of them subsumes the others.
 *
 *  - the bare PREFIX (`views`, `usecases/flow`), which is the renderer's own
 *    behaviour and matches nothing a glob would;
 *  - `excludingPath`, the segment walk `core/c4/root-project/exclude.ts` already
 *    owns, which is what reads a doubled star anywhere in the entry — the three
 *    recursive spellings the docstring above measured each hide what the
 *    renderer hides, and the `globRe` half alone matched NONE of them, because a
 *    leading recursive segment compiled to a REQUIRED slash. loam therefore
 *    graded a file in no project it may claim to be reading, and gated the run
 *    on it (verification 2026-09-04);
 *  - `globRe`, kept for the one case the segment walk cannot express: a `*` that
 *    CROSSES `/`, which is what `*.likec4` hiding `usecases/flow.likec4` was
 *    measured doing.
 *
 * A union only ever hides more, and the module's own rule says the worse of the
 * two mistakes is skipping a file the renderer reads; each rung above is a
 * measurement rather than an interpretation, so the union stays honest.
 */
function excluded(exclude: readonly string[], rel: string): boolean {
  return exclude.some((raw) => {
    const entry = raw.replace(/^\.\//, "");
    if (entry === "") return false;
    if (rel.startsWith(entry)) return true;
    if (excludingPath([entry], rel) !== null) return true;
    return entry.includes("*") && globRe(entry).test(rel);
  });
}

/**
 * One entry as a whole-path regular expression, with `*` crossing `/` — which
 * is what `*.likec4` excluding `usecases/flow.likec4` measures. Built per call
 * rather than cached: a `RegExp` is cheap beside the readdir that produced the
 * paths, and a module-level cache keyed on a string is the shared state
 * AGENTS.md warns about.
 */
function globRe(entry: string): RegExp {
  const source = entry.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${source}$`);
}
