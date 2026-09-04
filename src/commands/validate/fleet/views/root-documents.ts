/**
 * The documents the RENDERER's root project loads, enumerated the way the
 * renderer enumerates them: everything under the docs root that the root
 * `likec4.config.json` does not exclude.
 *
 * It exists because `./fleet-project.ts` used to build the set BY SHAPE — the
 * `architecture/` project, each extending `model.likec4`, and every `.likec4`
 * inside a service directory — and that is three roots, not a tree. A `.likec4`
 * one directory ABOVE a service (`services/platform/notes.likec4`, the parent of
 * service directories) was in none of them: `loam validate --all` came back
 * byte-identical to baseline and never named the file, while `npx likec4
 * validate --project fleet .` reported Invalid over nine files and thirteen
 * errors (verification 2026-09-04, R2). The same file one directory lower was a
 * loud error. SCHEMA, `loam-codes` and `explain` all said loam loads "every
 * `.likec4` the root project reads"; this is that sentence, executed.
 *
 * FOUR THINGS COME OUT, and each is a rule rather than a filter of convenience:
 *
 *  - The GENERATED `architecture/subsystems.likec4`, for `c4/project/documents.ts`'s
 *    reason — docs/DESIGN.md rule 26 makes its staleness a byte compare, and a
 *    stale one naming a removed element would blank this load and report a
 *    cascade whose repair is `loam subsystem sync`.
 *  - Anything the root `exclude` covers, read through `c4/root-project/exclude.ts`
 *    — the renderer does not load it, so grading it would be loam reporting a
 *    failure nobody can see. A root config loam cannot read an `exclude` list out
 *    of covers nothing: guessing an exclusion is worse than loading one document
 *    too many.
 *  - Every STANDALONE service directory. Such a model declares its own kinds, so
 *    the root project must exclude it and `service.model-unexcluded` is the grade
 *    for a root that does not — one finding naming the entry to add, rather than
 *    a duplicate-kind cascade under a second code.
 *  - `features/`. A feature's `delta.likec4` carries a `specification` block of
 *    its own and the directory is transient — the scaffolded root config excludes
 *    it for exactly that reason, and a fleet mid-feature would otherwise read as
 *    a fleet whose map is declared twice. loam drops it whether or not the entry
 *    is still there; `loam validate --feature` is where a delta is graded.
 *
 * Dot-directories and `node_modules` are not walked at all. Those are loam's own
 * machinery (`.loam-before` holds a verbatim copy of the landscape, which would
 * read as the map declared twice) and a package tree, never authored documents —
 * the same thing the scaffold's own `node_modules` glob says.
 */
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { excludingPath, readRootExclude } from "../../../../core/c4/root-project/exclude.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { subsystemViewsPath } from "../../../../core/repo/paths.js";

/** The directory name loam never walks, beside every dot-directory. */
const PACKAGES = "node_modules";

/** The one subtree loam drops whatever the root config says — see the banner. */
const FEATURES = "features";

/**
 * Every `.likec4` the renderer's root project reads and loam can grade, absolute
 * and sorted. `standalone` is each standalone service's directory, absolute.
 */
export async function rootProjectDocuments(docsDir: DocsDir, standalone: readonly string[]): Promise<string[]> {
  const exclude = await readRootExclude(docsDir);
  const generated = resolve(subsystemViewsPath(docsDir));
  const excluded = standalone.map((dir) => `${resolve(dir)}${sep}`);
  const root = resolve(docsDir);
  const found: string[] = [];
  const keeps = (path: string): boolean => {
    if (resolve(path) === generated) return false;
    if (excluded.some((dir) => resolve(path).startsWith(dir))) return false;
    const rel = relative(root, path).split(/[\\/]/);
    if (rel[0] === FEATURES) return false;
    return exclude === null || excludingPath(exclude, rel.join("/")) === null;
  };
  const walk = async (at: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      // A directory that cannot be read contributes nothing: this grade runs
      // inside `validate --all` over a whole fleet, and the one behaviour it may
      // never have is failing the run it was added to.
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === PACKAGES) continue;
        await walk(path);
      } else if (entry.name.endsWith(".likec4") && keeps(path)) {
        found.push(path);
      }
    }
  };
  await walk(root);
  return found.sort();
}
