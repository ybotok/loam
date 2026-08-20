/**
 * The fleet target's contained load path — the phase that touches the
 * filesystem before anything can be graded, and the value the target leaves
 * behind for the rest of the run. Split from `./landscape.ts` when the fleet
 * target grew past the line limit; the containment DOCTRINE below travelled
 * with the functions it explains, and `FleetGrade` sits with the read that
 * produces the journeys it carries.
 */
import type { LoadedDoc } from "../../../core/c4/likec4.js";
import type { Flow } from "../../../core/c4/flows/flow.js";
import { readFlowState, type FlowState } from "../../../core/flows/project.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { TargetReport } from "../../../core/vocabulary/report.js";

/**
 * What grading the fleet produces: the target's report, and the one value the
 * REST of the run needs from it — the fleet's journeys.
 *
 * Returned rather than re-read per target, on the bargain the preloaded
 * landscape already strikes (`validate --all` parses the map once and hands the
 * document down). Re-reading would not merely be slower: a service resolving
 * `Covers: view:<id>` against a flow set assembled differently from the one
 * `flow.uncovered` counted would call a correct line a typo while the fleet
 * gate demanded the author write it.
 */
export interface FleetGrade {
  report: TargetReport;
  /**
   * Every dynamic view the `architecture/` project declares — the fleet map's
   * own `views { }` block and every document under `architecture/flows/`,
   * unioned. EMPTY whenever nothing may be concluded: no map, an unreadable
   * one, or flow documents that did not parse. Empty is never proof that a
   * fleet draws no journeys, and no caller may read it as coverage; it means
   * "this run knows of none", and the findings saying why ride in `report`.
   */
  flows: Flow[];
}

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
    flows: [],
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

/**
 * The fleet's journeys, read ONCE per run and contained the way the landscape
 * is — same doctrine, same package, same reason: `validateLandscape` runs
 * outside the dispatcher's `guarded`, so one journey file carrying a permission
 * bit (or an `architecture/flows/` that is a file, or a sandbox denying the
 * workspace tmpdir) escaped every per-target catch and became the whole run's
 * `repository-unavailable` — a fleet gate saying nothing about the ninety-nine
 * services that are fine. "Could not be read" and "did not parse" have the same
 * consequence here and the same finding (`flow.invalid`).
 *
 * `declared` is the fleet map's OWN `views { ... }` block, which the reader
 * takes as the whole answer when nothing is stored under `architecture/flows/`
 * — so a fleet that never adopts flows pays one readdir and no second Langium
 * workspace. When flow documents DO exist they are staged together with the
 * map, so the result already contains those same views: the fleet's flow set is
 * the union, never one or the other.
 */
export async function readFleetFlows(docsDir: DocsDir, declared: Flow[]): Promise<FlowState> {
  try {
    return await readFlowState(docsDir, declared);
  } catch (err) {
    return {
      errors: [{ message: err instanceof Error ? err.message : String(err) }],
      elements: [],
      flows: [],
      files: [],
      groups: [],
      expected: null,
    };
  }
}
