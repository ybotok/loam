/**
 * Eight read-only real-CLI runs at once: the widest net, proving the reading
 * half of the contract is reentrant — parseable envelopes, byte-identical
 * output for identical invocations, and a docs tree the reads did not touch.
 * cli-entry.test.ts covers commander's error paths in a bare cwd; this is the
 * same real entry over a real fleet, concurrently.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertNoLiveChildren, spawnLoam } from "./helpers/cli-process.js";
import { coherentFixture, makeProject, treeHashes } from "./helpers/harness.js";

describe("eight concurrent read-only CLI runs", () => {
  afterEach(() => assertNoLiveChildren());

  it("parse as ok envelopes, duplicates match byte for byte, and the tree is untouched", async () => {
    const p = await makeProject(coherentFixture(), { service: "payment-service" });
    try {
      const invocations: string[][] = [
        ["status", "FEAT-1", "--json"],
        ["list", "--json"],
        ["validate", "--feature", "FEAT-1", "--json"],
        ["delta", "FEAT-1", "--json"],
      ];
      const before = await treeHashes(p.docsDir);
      // Two of each, interleaved so duplicates race different commands, not
      // their own twin.
      const results = await Promise.all([...invocations, ...invocations].map((args) => spawnLoam(p.workDir, ...args)));
      for (const r of results) {
        expect(r.code, r.stdout).toBe(0);
        const payload = JSON.parse(r.stdout) as { ok?: boolean };
        expect(payload.ok).toBe(true);
      }
      for (let i = 0; i < invocations.length; i += 1) {
        // Byte-identical stdout for the duplicate invocation: a read that
        // varies under concurrency is a read of something mid-write.
        expect(results[i]!.stdout).toBe(results[i + invocations.length]!.stdout);
      }
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  }, 120_000);
});
