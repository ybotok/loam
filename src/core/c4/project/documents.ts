/**
 * Which `.likec4` documents in a docs repo's `architecture/` loam loads as one
 * project.
 *
 * The renderer's answer is "all of them". The root `likec4.config.json` no
 * longer excludes `services/**`: the root project holds the map AND every
 * service model that EXTENDS it, because such a model is only readable beside
 * the map, and `loam subsystem sync` excludes only the directory of each model
 * that STANDS ALONE — one `services/<tree>/**` entry per standalone model,
 * never the whole subtree (`c4/service-model/renderer.ts` owns that list, and
 * is the one place loam reads that file). loam's own answer here is all of them
 * EXCEPT the generated `architecture/subsystems.likec4`, and that exception is
 * not an optimisation:
 *
 *  - docs/DESIGN.md rule 26 excludes the generated file from every read loam
 *    performs. Its staleness is a byte compare (`subsystem.views-stale`) and
 *    nothing anywhere reads its contents.
 *  - Including it would invent a failure mode. Its `include` lines name
 *    landscape element ids, so a file that has drifted — a service removed
 *    since the last `loam subsystem sync` — would be a parse error, and a parse
 *    error in one project document blanks the model for all of them. A fleet
 *    whose only problem is a stale generated file would lose its whole map
 *    instead of getting the one finding that names the repair.
 *
 * The skip is passed in by the caller rather than spelled here, so the filename
 * stays written in `repo/paths.ts` alone.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Every `.likec4` file under `dir`, recursively, minus `skip`, in a stable
 * order.
 *
 * Sorted because it decides the staging order and therefore nothing at all —
 * LikeC4 merges a project regardless — but a stable list makes a failure
 * reproducible and a diff of one readable. A directory that does not exist is
 * an empty list, never a throw: a fleet with no `architecture/` is a fleet with
 * nothing to load, which is already `landscape.missing`'s question, not this
 * function's.
 */
export async function architectureDocuments(dir: string, skip: string[] = []): Promise<string[]> {
  const excluded = new Set(skip.map((path) => resolve(path)));
  const found: string[] = [];
  const walk = async (at: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".likec4") && !excluded.has(resolve(path))) found.push(path);
    }
  };
  await walk(resolve(dir));
  return found.sort();
}
