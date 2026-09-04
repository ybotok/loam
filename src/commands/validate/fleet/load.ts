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
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LoadedDoc } from "../../../core/c4/likec4.js";
import { FleetContext } from "../../../core/fleet-context.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { FeatureEntry, ServiceEntry } from "../../../core/repo/entries.js";
import { featurePaths, landscapePath, servicePathsAt } from "../../../core/repo/paths.js";

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

/** Everything a `--all` run parses up front, and the enumerations it was narrowed to. */
export interface FleetPrefetch {
  docsDir: DocsDir;
  fleet: FleetContext;
  /** The services this run grades — the `--base` narrowing when there is one. */
  services: readonly ServiceEntry[];
  /** The active features this run grades, likewise. */
  features: readonly FeatureEntry[];
}

/**
 * ONE workspace per document KIND for the whole `--all` run.
 *
 * The per-path load pays a fresh Langium workspace per document (~100 ms each
 * even warm), which made the fleet's main CI command O(documents) workspace
 * spins — 13.7 s median over the 120-service benchmark (docs/BENCHMARKS.md). So
 * `--all` enumerates its documents up front and batch-parses them into the
 * fleet context's memo; every load below, the landscape read included, is then a
 * seeded hit. The enumerations are the same memoised promises the target loops
 * reuse.
 *
 * TWO WORKSPACES, because the fleet's models no longer parse the same way as
 * each other: a model that EXTENDS the map is a PROJECT (the map plus that
 * file) and a model that stands alone is a document. So the shapes are read
 * first, the DOCUMENT batch is asked for everything that is one — the landscape,
 * every feature delta, every standalone model — and `prefetchServiceModels`
 * then batches the extending half as projects, finding its own standalone list
 * already memoised and asking for nothing.
 *
 * The order is load-bearing rather than tidy. `prefetchLikeC4` returns without a
 * workspace when fewer than two documents are missing (one document gains
 * nothing from batch isolation it already has), so splitting the documents
 * across two calls is how a fleet of one service and one feature ends up
 * batching the feature and parsing the model in a workspace of its own — the
 * exact per-document spin this function exists to remove, and what
 * `test/validate-batch-fallback.test.ts` counts.
 *
 * If a batch CANNOT run — a sandbox denying tmpdir writes — the prefetch seeds
 * nothing and every load falls back to today's per-path parse: identical
 * findings, the old speed. Single-service `validate` and `list` keep their
 * untouched code paths on purpose, so the ≤10% regression bound in
 * docs/BENCHMARKS.md holds by construction.
 *
 * It lives HERE rather than in `../validate.ts` because it is fleet-loading
 * business and that module is the argument grammar and the target dispatch; the
 * block also took that file to its line limit, which is the ceiling asking the
 * question it exists to ask.
 */
export async function prefetchFleetDocuments(input: FleetPrefetch): Promise<void> {
  const { docsDir, fleet } = input;
  const paths = input.services.filter((svc) => svc.has.model).map((svc) => servicePathsAt(svc.dir));
  const shapes = await fleet.modelShapes(paths.map((p) => p.model));
  const landscape = landscapePath(docsDir);
  await fleet.prefetchLikeC4([
    ...(existsSync(landscape) ? [landscape] : []),
    ...input.features.filter((feat) => feat.has.delta).map((feat) => featurePaths(feat.dir).delta),
    ...paths.filter((p) => shapes.get(resolve(p.model)) !== "extending").map((p) => p.model),
  ]);
  await fleet.prefetchServiceModels(docsDir, paths);
}
