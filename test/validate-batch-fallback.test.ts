/**
 * The batch loader's failure contract, pinned end to end: when the shared
 * workspace CANNOT be built — a sandboxed runner denying tmpdir writes is the
 * environment class ROADMAP documents for cli-entry — `validate --all` must
 * produce byte-identical output at the old per-document speed. Never an error,
 * never a different finding: a fleet gate whose verdict depends on whether a
 * temp directory was writable is a gate nobody can trust in CI.
 *
 * The mock delegates to the REAL loadBatch until the switch flips, so the
 * healthy run in each pair goes through the genuine batch workspace and the
 * degraded run through the genuine per-path loads — the comparison is between
 * the two real roads, not between two stubs.
 */
import { describe, expect, it, vi } from "vitest";
import { coherentFixture, makeProject, runLoam } from "./helpers/harness.js";

const batch = { denied: false, realCalls: 0, deniedCalls: 0 };

vi.mock("../src/core/c4/workspace.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/c4/workspace.js")>();
  return {
    loadBatch: (paths: string[]) => {
      // The counters keep the byte-compares below from passing vacuously: they
      // prove the healthy run really batched and the degraded run really hit
      // the throw — i.e. that this mock intercepted the import validate uses.
      if (batch.denied) {
        batch.deniedCalls += 1;
        throw new Error("EACCES: operation not permitted, mkdtemp");
      }
      batch.realCalls += 1;
      return real.loadBatch(paths);
    },
  };
});

describe("validate --all when the batch workspace cannot be created", () => {
  it("emits byte-identical output for a clean fleet", async () => {
    const p = await makeProject(coherentFixture());
    try {
      batch.denied = false;
      const healthy = await runLoam(p.workDir, "validate", "--all", "--json");
      batch.denied = true;
      const degraded = await runLoam(p.workDir, "validate", "--all", "--json");
      // The healthy run must be a real green that really batched, and the
      // degraded run must really have been refused — or the pair proves nothing.
      expect(healthy.code).toBe(0);
      expect(batch.realCalls).toBeGreaterThanOrEqual(1);
      expect(batch.deniedCalls).toBeGreaterThanOrEqual(1);
      expect(degraded.code).toBe(healthy.code);
      expect(degraded.stdout).toBe(healthy.stdout);
      expect(degraded.stderr).toBe(healthy.stderr);
    } finally {
      batch.denied = false;
      await p.destroy();
    }
  });

  it("emits byte-identical findings for a fleet with a broken model", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = "model {\n  a -> nosuchthing\n}\n";
    const p = await makeProject(files);
    try {
      batch.denied = false;
      const healthy = await runLoam(p.workDir, "validate", "--all", "--json");
      batch.denied = true;
      const degraded = await runLoam(p.workDir, "validate", "--all", "--json");
      // Both roads must refuse the same way — same exit, same findings, same
      // error prose with the same line numbers (that is loadBatch's parity).
      expect(healthy.code).toBe(1);
      expect(degraded.code).toBe(healthy.code);
      expect(degraded.stdout).toBe(healthy.stdout);
      expect(degraded.stderr).toBe(healthy.stderr);
    } finally {
      batch.denied = false;
      await p.destroy();
    }
  });
});
