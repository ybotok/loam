/**
 * What a `--spine` run says about itself beside its findings: the joins meter
 * and the `lens` key of the `--json` payload.
 *
 * A lens that only HIDES is a lens that can be read as "the fleet is healthy".
 * Two numbers stop that, and both always reach the reader: how many joins the
 * run graded (a run that graded no operation and no message checked nothing,
 * and has to say so in words rather than in a green tick), and what the lens
 * set aside, by code. Neither is a finding — they describe the run, the way the
 * summary line does — so neither moves `valid`, a count or the exit code. The
 * text spelling of both is `../render/rollups.ts`'s, beside the other
 * whole-run lines: the renderer reads this package, and this package never
 * reads the renderer, so the two cannot form a cycle.
 */
import { existsSync } from "node:fs";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { eventKeys } from "../../../core/c4/direction/direction.js";
import { serviceResolver } from "../../../core/c4/resolve/service.js";
import { edgeKey } from "../../../core/diff/scope/edges.js";
import { type FleetContext } from "../../../core/fleet-context.js";
import { type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { ancestorIds } from "../../../core/kernel/ids/fqn/ancestors.js";
import { landscapePath } from "../../../core/repo/paths.js";
import { listServices } from "../../../core/repo/repo.js";
import { EXTERNAL_TAG } from "../../../core/vocabulary/maturity.js";
import { readLandscape } from "../fleet/load.js";
import { type HiddenTally } from "./spine.js";

/** The joins a run graded, counted per edge the way the spine checks read them. */
export interface JoinsMeter {
  /** Edges into a fleet service carrying `metadata { op }` — each graded against that service's openapi.yaml. */
  operations: number;
  /** `publishes` / `consumes` keys bound to a fleet service — each graded against its asyncapi.yaml. */
  messages: number;
  /** Edges into a fleet service that name nothing: drawn, never checked. `source → target`, in map order. */
  drawnOnly: string[];
  /** Edges into an `#external` system carrying no event key: never graded, whatever they name. */
  toExternals: number;
}

/** What the renderers read of a lensed run. */
export interface LensReport {
  hidden: HiddenTally;
  /** The meter, or null when the map is missing or does not parse. */
  joins: JoinsMeter | null;
  /**
   * The words naming what a narrower run's meter counted — `on payment-service`,
   * `in this run's scope` — or null when it counted the whole map. Text only:
   * the `--json` payload's `scope` and `targets` already say it.
   */
  over: string | null;
  /** Active features the run did not build: a proposal is graded by its own gate, not by the lens. */
  featuresSkipped: number;
}

/**
 * How many `drawnOnly` edges the payload spells before the rest are counted —
 * report.ts's DETAIL_LIMIT, for the reason it gives: an unbounded array is a
 * denial of attention in the interface an agent pipes, and the marker says
 * nothing is complete when it is not.
 */
const DRAWN_ONLY_LIMIT = 10;

/** Which of the map's joins a run graded — the meter counts those and no others. */
export interface MeterScope {
  /** The enumerated service directories: every spine check resolves an element through them. */
  known: ReadonlySet<string>;
  /** The services the run graded whole, or null on `--all` without `--base`, where every edge is the run's. */
  graded: ReadonlySet<string> | null;
  /**
   * Under `--base`: the edges the branch wrote, as `edgeKey`s. The landscape
   * target grades their operations against providers the scope left out
   * (`../scope.ts`), so they are the run's whoever owns them.
   */
  changed: ReadonlySet<string>;
}

/**
 * Count the joins a run graded off the parsed map. Elements resolve through
 * the same `serviceResolver` every spine check uses, so an edge into a
 * modelled container counts for the service that owns it.
 *
 * Counted per GRADED service, not per map. A meter of the whole map, printed
 * on `--all` alone, was the first draft, and review (2026-10-30) convicted it twice:
 * `--service checkout-web --spine`, with no join into checkout-web, printed the
 * same green as a service whose joins all resolved, and `--all --base` over a
 * README-only branch said "drawn only, not checked" beside seven joins it never
 * graded. A join belongs to the run when the service it binds is one the run
 * graded: an operation or a bare call binds its target, a message key the end
 * `eventKeys` names, a call into an external its caller.
 *
 * An edge carrying an event key is a message join (or a statement about an
 * outside producer, which grades nothing and is counted nowhere) and never
 * also a call: a publish into a broker is drawn INTO an external system, and
 * counting it as an ungraded call there would tell a reader their messages
 * went unchecked. A changed edge's message key is not the run's: `--base`
 * grades a changed edge's operation and nothing else.
 */
export function joinsMeter(land: LoadedDoc, scope: MeterScope): JoinsMeter {
  const { known, graded, changed } = scope;
  const svcOf = serviceResolver(land.elements, known);
  const externals = new Set(land.elements.filter((e) => e.tags.includes(EXTERNAL_TAG)).map((e) => e.id));
  const external = (id: string): boolean => ancestorIds(id).some((a) => externals.has(a));
  const binds = (end: string): boolean => (graded ?? known).has(svcOf(end));
  const meter: JoinsMeter = { operations: 0, messages: 0, drawnOnly: [], toExternals: 0 };
  for (const r of land.relationships) {
    const keys = eventKeys(r);
    meter.messages += keys.filter((k) => binds(k.bound)).length;
    if (keys.length > 0) continue;
    const ours = (end: string): boolean => graded === null || binds(end) || changed.has(edgeKey(r));
    // An operation on a call into somebody else's system is accepted and drawn,
    // and graded by nothing: its contract is not in this repository. Counted
    // with the external edges, so the meter never reads it as a checked join.
    if (external(r.target)) meter.toExternals += ours(r.source) ? 1 : 0;
    else if (!known.has(svcOf(r.target)) || !ours(r.target)) continue;
    else if (r.op !== undefined) meter.operations += 1;
    else meter.drawnOnly.push(`${svcOf(r.source)} → ${svcOf(r.target)}`);
  }
  return meter;
}

/** What `spineMeter` reads: the run's one index, and which joins it graded. */
export interface MeterRun {
  docsDir: DocsDir;
  fleet: FleetContext;
  graded: MeterScope["graded"];
  changed: MeterScope["changed"];
}

/**
 * The meter over the map this run read, or null when the repo has no map or
 * it does not parse — a count of a document nobody could read would be a
 * claim about the fleet that nobody checked. Through the fleet index, so the
 * map and the enumeration come out of the memo the checks already filled.
 */
export async function spineMeter(run: MeterRun): Promise<JoinsMeter | null> {
  const { docsDir, fleet } = run;
  if (!existsSync(landscapePath(docsDir))) return null;
  const land = await readLandscape(() => fleet.architecture(docsDir));
  if (land.errors.length > 0) return null;
  const known = new Set((await listServices(docsDir, fleet)).map((s) => s.id));
  return joinsMeter(land, { known, graded: run.graded, changed: run.changed });
}

/** The `lens` key of the `--json` payload — present only under `--spine`, so a default payload is unchanged. */
export function lensJson(lens: LensReport): Record<string, unknown> {
  const { joins } = lens;
  return {
    name: "spine",
    // Absent rather than zero over a map that is missing or did not parse:
    // the meter is a count of a document this run could not read, and a zero
    // there would be a claim about the fleet that nobody checked.
    ...(joins === null
      ? {}
      : {
          joins: {
            ...joins,
            drawnOnly:
              joins.drawnOnly.length <= DRAWN_ONLY_LIMIT
                ? joins.drawnOnly
                : [...joins.drawnOnly.slice(0, DRAWN_ONLY_LIMIT), `… (+${joins.drawnOnly.length - DRAWN_ONLY_LIMIT} more)`],
          },
        }),
    hidden: lens.hidden,
    featuresSkipped: lens.featuresSkipped,
  };
}
