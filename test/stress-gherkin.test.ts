/**
 * The generated-suite emitter under concurrency. This suite was written when
 * gherkin was the one writer with no lock and no staging, so it drew the line
 * at what that writer could honestly guarantee: byte-deterministic output,
 * idempotent re-runs, and concurrent runs of the SAME living plan converging
 * on the same bytes, because identical plans were same-content whole-buffer
 * overwrites with no orphan deletions. The writer has since gained both, in
 * src/commands/gherkin/commit.ts: the root's lock is held across recovery,
 * staging and the journaled swap, so the four runs below now take turns
 * instead of overwriting one another. The claims are unchanged. A red here is
 * a found product race, never to retry, and it has found one. Under CPU load,
 * a waiter breaking the lock as stale deleted a successor's live lock. Two runs
 * then shared one commit window, and one run's recovery swept the other's
 * staged temps (breakStaleLock in src/core/staging/lock.ts; every window it
 * had is opened deterministically in test/lock-break.test.ts).
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
