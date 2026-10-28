/**
 * The map-heavy fleet — `scripts/bench-validate.ts --fixture map-heavy`'s
 * shape — at a size the suite can afford, pinned two ways.
 *
 * The benchmark refuses a run that does not exit 0, so the fixture has to stay
 * a VALID fleet as the checks grow, or the timings it publishes would measure
 * error rendering; the first case keeps that true here, where a regression is
 * a red test rather than a benchmark that cannot run.
 *
 * The second is the cost itself, counted rather than timed. A wall-clock bound
 * in the parallel suite measures the host (`test/scale.test.ts` says why), but
 * the parse count is the mechanism: on a pilot fleet's shape, one parse of an
 * ~8k-line map per comment-only model was most of a 56-second `validate --all`
 * (docs/BENCHMARKS.md). Those models now share one parse, and a change that
 * quietly brought the per-model copies back fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { FleetContext } from "../src/core/fleet-context.js";
import { servicePathsAt } from "../src/core/repo/paths.js";
import { serviceDirOf } from "../src/core/kernel/ids/dirs.js";
import { MAP_HEAVY_FEATURE, mapHeavyFiles, mapHeavyServiceDir, type MapHeavyShape } from "./helpers/map-heavy-fixture.js";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

/** The pilot's proportions, scaled to a dozen services. */
const SHAPE: MapHeavyShape = {
  subsystems: 3,
  services: 12,
  externals: 4,
  databases: 5,
  domains: 2,
  groups: 6,
  edges: 60,
  kinds: 3,
  tags: 6,
  mapViews: 8,
  drilldownViews: 12,
  drawnModels: 3,
  opsPerService: 3,
  featureServices: 3,
  featureRequirements: 9,
};

interface Payload {
  targets: Array<{ findings: Array<{ severity: string; code: string }> }>;
}

const errors = (stdout: string): string[] =>
  (JSON.parse(stdout) as Payload).targets.flatMap((t) => t.findings).filter((f) => f.severity === "error").map((f) => f.code);

let project: Project;

beforeAll(async () => {
  project = await makeProject(mapHeavyFiles(SHAPE));
  // The two generated documents are whatever `subsystem sync` writes for this
  // map; the fixture deliberately does not freeze a copy of them.
  const sync = await runLoam(project.workDir, "subsystem", "sync");
  expect(sync.code).toBe(0);
}, 120_000);

afterAll(async () => {
  await project.destroy();
});

describe("the map-heavy fleet", () => {
  it("is a valid fleet with a valid feature — what the benchmark requires before it times anything", async () => {
    const all = await runLoam(project.workDir, "validate", "--all", "--json");
    expect(errors(all.stdout)).toEqual([]);
    expect(all.code).toBe(0);
    const feature = await runLoam(project.workDir, "validate", "--feature", MAP_HEAVY_FEATURE, "--json");
    expect(errors(feature.stdout)).toEqual([]);
    expect(feature.code).toBe(0);
  }, 120_000);

  it("parses the map once for all its comment-only models, not once per model", async () => {
    const fleet = new FleetContext();
    const paths = Array.from({ length: SHAPE.services }, (_, k) =>
      servicePathsAt(serviceDirOf(join(project.docsDir, mapHeavyServiceDir(SHAPE, k + 1)))),
    );
    await fleet.prefetchServiceModels(project.docsDir, paths);
    // One project per drawn model, ONE for the nine placeholders together.
    expect(fleet.stats().projectLoads).toBe(SHAPE.drawnModels + 1);
    // And every placeholder still reads as its own service, out of the memo.
    const placeholder = await fleet.serviceModel(project.docsDir, paths[SHAPE.services - 1]!);
    expect(placeholder.doc.errors).toEqual([]);
    expect(placeholder.project).not.toBeNull();
    expect(fleet.stats().projectLoads).toBe(SHAPE.drawnModels + 1);
  }, 120_000);
});
