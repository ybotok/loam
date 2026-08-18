/**
 * Four real processes archiving the same feature at once. The docs lock's own
 * comment (src/core/staging/lock.ts) records the defect class this pins
 * against: two archives that both exited 0 while the second's splice silently
 * dropped the first's additions. "Deterministic winner or refusal" means
 * exactly one success, every loser refusing with a stable classified code,
 * and a final tree byte-identical to what a solo archive produces.
 *
 * The one nondeterministic byte in an archived feature is the snapshot
 * manifest's `archivedAt` timestamp (written by src/core/staging/snapshot.ts
 * into features/archive/<dir>/.loam-before/manifest.json), so the tree
 * comparison excludes that single file and pins its SHAPE instead.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNoLiveChildren, spawnLoam } from "./helpers/cli-process.js";
import { coherentFixture, makeProject, treeHashes, type Project } from "./helpers/harness.js";

const MANIFEST = "features/archive/FEAT-1-split/.loam-before/manifest.json";

async function comparableTree(docsDir: string): Promise<Record<string, string>> {
  const tree = await treeHashes(docsDir);
  delete tree[MANIFEST];
  return tree;
}

async function pinManifestShape(p: Project): Promise<void> {
  const manifest = JSON.parse(await readFile(join(p.docsDir, MANIFEST), "utf8")) as { archivedAt?: string };
  expect(typeof manifest.archivedAt).toBe("string");
  expect(Number.isNaN(Date.parse(manifest.archivedAt!))).toBe(false);
}

describe("four simultaneous archives of one feature", () => {
  afterEach(() => assertNoLiveChildren());

  it("exactly one wins, every loser refuses with a stable code, and the tree equals a solo run's", async () => {
    // The solo baseline first, on an identical fixture: this is what the
    // surviving tree must equal, byte for byte, manifest timestamp aside.
    const solo = await makeProject(coherentFixture(), { service: "payment-service" });
    const raced = await makeProject(coherentFixture(), { service: "payment-service" });
    try {
      const soloRun = await spawnLoam(solo.workDir, "archive", "FEAT-1", "--json");
      expect(soloRun.code, soloRun.stdout).toBe(0);
      await pinManifestShape(solo);
      const baseline = await comparableTree(solo.docsDir);

      const results = await Promise.all(
        Array.from({ length: 4 }, () => spawnLoam(raced.workDir, "archive", "FEAT-1", "--json")),
      );
      const winners = results.filter((r) => r.code === 0);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => r.code !== 0)) {
        const payload = JSON.parse(loser.stdout) as { error?: { code?: string } };
        // docs-busy: the loser overlapped the winner's lock window.
        // unknown-target: the loser started after the winner moved the
        // feature into the archive. Both are classified refusals; anything
        // else — above all `internal` — is a product defect this test exists
        // to catch.
        expect(["docs-busy", "unknown-target"]).toContain(payload.error?.code);
      }

      await pinManifestShape(raced);
      expect(await comparableTree(raced.docsDir)).toEqual(baseline);
      expect(existsSync(join(raced.docsDir, ".loam-lock"))).toBe(false);
      expect(Object.keys(await treeHashes(raced.docsDir)).filter((k) => k.endsWith(".tmp"))).toEqual([]);
    } finally {
      await solo.destroy();
      await raced.destroy();
    }
  }, 120_000);
});
