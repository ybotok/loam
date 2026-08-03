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
});
