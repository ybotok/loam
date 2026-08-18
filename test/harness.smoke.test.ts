import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam } from "./helpers/harness.js";

describe("harness smoke", () => {
  it("runs validate --feature on the coherent fixture and succeeds", async () => {
    const p = await makeProject(coherentFixture(), { service: "payment-service" });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.out).toContain("FEAT-1");
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("runs validate on the configured service and succeeds", async () => {
    const p = await makeProject(coherentFixture(), { service: "payment-service" });
    try {
      const res = await runLoam(p.workDir, "validate");
      expect(res.out).toContain("payment-service");
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("serialises two overlapping in-process runs, and both come out uncorrupted", async () => {
    // Without the queue the second call proceeds concurrently: chdir and the
    // console capture interleave between two commands and BOTH outputs are
    // corrupt, silently. With it, an overlap is two clean sequential runs.
    // (A refusal was tried instead and reverted: vitest cannot cancel a
    // timed-out test's async work, so under overload a zombie run held the
    // in-flight flag and later tests failed the guard — one timeout became a
    // cascade of misattributed product failures.)
    const p = await makeProject(coherentFixture(), { service: "payment-service" });
    try {
      const first = runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      const second = runLoam(p.workDir, "status", "FEAT-1");
      const [a, b] = await Promise.all([first, second]);
      expect(a.code).toBe(0);
      expect(a.out).toContain("FEAT-1");
      expect(b.code).toBe(0);
      expect(b.out).toContain("FEAT-1");
    } finally {
      await p.destroy();
    }
  });
});
