/**
 * The landscape's contained load path — the one phase of the fleet target that
 * touches the filesystem before anything can be graded. Split from
 * `./landscape.ts` when the fleet target grew past the line limit; the
 * containment DOCTRINE below travelled with the functions it explains.
 *
 * The load ITSELF is no longer here. `loadArchitecture` moved to
 * `core/c4/project/architecture.ts` when the use-case axis grew a second reader
 * of it, and that module's banner records why; what stayed is the containment,
 * which is command-layer business because it is about which validate TARGET a
 * failed read is filed against.
 */
import type { LoadedDoc } from "../../../core/c4/likec4.js";

/**
 * A landscape that could not be READ, shaped as one that did not PARSE.
 *
 * The landscape is the one artifact no target owns: it is read once for the
 * whole run and it is graded on a target of its own, which runs OUTSIDE
 * `guarded`. So a landscape.likec4 that is a directory, or that carries a
 * permission bit this process cannot open, escaped every per-target catch and
 * became the whole run's `repository-unavailable` — one file, and a fleet gate
 * that said nothing about the ninety-nine services that are fine. A DANGLING
 * symlink is not one of those shapes and never was: every read of the file is
 * gated on an `existsSync` that follows the link, so a broken one resolves as
 * `landscape.missing` long before anything opens it.
 *
 * What this contains is the FLEET-level reads, and only those: the `--all`
 * preload, and both reads inside `validateLandscape` — the conflict-marker
 * `readFile` and the parse. `loam validate --service <id>` and
 * `loam validate --feature <id>` hand in no preloaded doc, so `validateService`
 * and `validateFeature` open the same file again on demand, unwrapped and
 * INSIDE `guarded`: an EISDIR there is still reported as `service.unreadable`
 * or `feature.unreadable`, which files the fleet map's failure against the one
 * target the caller happened to name. That is the wrong subject on a finding
 * that does at least carry the offending path, and it costs those runs nothing
 * further — they grade a single target either way, so there is no report left
 * unwritten — which is why the remainder was left for the change that gives the
 * landscape one load path instead of three.
 *
 * `guarded` is deliberately NOT widened to cover the landscape target instead.
 * Its code ternary knows only services and features, so it would file the fleet
 * map's failure as `feature.unreadable`; and a guarded failure yields no
 * document, so all N services would go on to re-open the same broken file
 * inside their own guards and emit N copies of it. Containing the IO here needs
 * no new code and no new sentence: "could not be read" and "did not parse" have
 * the same consequence — nothing may be concluded from this file — and
 * `landscape.invalid` is already how that is said.
 */
export function unreadableLandscape(err: unknown): LoadedDoc {
  return {
    errors: [{ message: err instanceof Error ? err.message : String(err) }],
    elements: [],
    relationships: [],
  };
}

/** One landscape load, answering with `unreadableLandscape` rather than throwing. */
export async function readLandscape(load: () => Promise<LoadedDoc>): Promise<LoadedDoc> {
  try {
    return await load();
  } catch (err) {
    return unreadableLandscape(err);
  }
}
