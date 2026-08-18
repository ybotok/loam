/**
 * The generated-suite emitter under concurrency. Gherkin is the one writer
 * with no lock and no staging (crash-consistent staged writes for it are the
 * NEXT roadmap item, "P0 — crash-consistent multi-file writers"), so this
 * suite draws the boundary of what today's writer honestly guarantees:
 * byte-deterministic output, idempotent re-runs, and concurrent runs of the
 * SAME living plan converging on the same bytes — because identical plans are
 * same-content whole-buffer overwrites with no orphan deletions. A red here
 * is a found product race to report into that next item, never to retry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { assertNoLiveChildren, spawnLoam } from "./helpers/cli-process.js";
import { coherentFixture, makeProject, treeHashes } from "./helpers/harness.js";

describe("gherkin emission under repetition and concurrency", () => {
  afterEach(() => assertNoLiveChildren());

  it("is idempotent serially and byte-converges under four concurrent living runs", async () => {
    const p = await makeProject(coherentFixture(), { service: "payment-service", gherkinDir: "gherkin" });
    try {
      const dir = join(p.workDir, "gherkin");
      const first = await spawnLoam(p.workDir, "gherkin", "--json");
      expect(first.code, first.stdout).toBe(0);
      const once = await treeHashes(dir);
      expect(Object.keys(once).length).toBeGreaterThan(0);

      const second = await spawnLoam(p.workDir, "gherkin", "--json");
      expect(second.code, second.stdout).toBe(0);
      // Idempotence is the precondition for the concurrent claim below: if
      // two SERIAL runs of one plan differ, concurrency has nothing to
      // converge on.
      expect(await treeHashes(dir)).toEqual(once);

      const results = await Promise.all(Array.from({ length: 4 }, () => spawnLoam(p.workDir, "gherkin", "--json")));
      for (const r of results) expect(r.code, r.stdout).toBe(0);
      expect(await treeHashes(dir)).toEqual(once);
    } finally {
      await p.destroy();
    }
  }, 120_000);
});
