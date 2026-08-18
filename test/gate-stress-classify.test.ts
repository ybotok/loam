/**
 * The failure classifier on synthetic inputs — the only way to test
 * classification without running the 200-second gate inside the gate.
 *
 * Every class exists so a red run can be NAMED without being re-run: an
 * unclassified flake invites the quiet rerun that launders a real race into
 * a green gate. These fixtures are the shapes vitest 4 actually emits; a
 * vitest upgrade that changes the reporter shape should fail here, loudly,
 * rather than misclassify silently in CI.
 */
import { describe, expect, it } from "vitest";
// eslint-disable-next-line -- a .mjs module; vitest transforms it fine.
import { classifyRun } from "../scripts/gate-stress-classify.mjs";

function report(suites: Array<{ name: string; tests: Array<{ status: string; messages?: string[] }> }>) {
  return {
    numTotalTests: suites.reduce((n, s) => n + s.tests.length, 0),
    testResults: suites.map((s) => ({
      name: s.name,
      assertionResults: s.tests.map((t, i) => ({
        status: t.status,
        fullName: `${s.name} > case ${i}`,
        failureMessages: t.messages ?? [],
      })),
    })),
  };
}

describe("classifyRun", () => {
  it("a clean run with every discovered file reported is clean", () => {
    const r = classifyRun({
      report: report([{ name: "/t/a.test.ts", tests: [{ status: "passed" }] }]),
      stderrText: "",
      exitCode: 0,
      discoveredFiles: ["/t/a.test.ts"],
    });
    expect(r).toEqual({ verdict: "clean", failures: [] });
  });

  it("an ordinary assertion failure is product", () => {
    const r = classifyRun({
      report: report([
        { name: "/t/a.test.ts", tests: [{ status: "failed", messages: ["AssertionError: expected 1 to be 2"] }] },
      ]),
      stderrText: "",
      exitCode: 1,
      discoveredFiles: ["/t/a.test.ts"],
    });
    expect(r.verdict).toBe("product");
    expect(r.failures[0]).toMatchObject({ file: "/t/a.test.ts", class: "product" });
  });

  it("pool deaths are runner-policy: tinypool, closed channels, signals, timeouts", () => {
    for (const msg of [
      "Tinypool: worker exited unexpectedly",
      "Error: Channel closed",
      "ERR_IPC_CHANNEL_CLOSED",
      "Process terminated: SIGSEGV",
      "Hook timed out in 120000ms",
      "Test timed out in 120000ms",
    ]) {
      const r = classifyRun({
        report: report([{ name: "/t/a.test.ts", tests: [{ status: "failed", messages: [msg] }] }]),
        stderrText: "",
        exitCode: 1,
        discoveredFiles: ["/t/a.test.ts"],
      });
      expect(r.verdict, msg).toBe("runner-policy");
    }
  });

  it("a [loam-host] refusal is infrastructure regardless of everything else", () => {
    const r = classifyRun({
      report: null,
      stderrText: "Error: [loam-host] this host forbids a primitive the suite requires: link(2) (EPERM)",
      exitCode: 1,
      discoveredFiles: [],
    });
    expect(r.verdict).toBe("infrastructure");
  });

  it("a non-zero exit whose report never parsed is runner-policy", () => {
    const r = classifyRun({ report: null, stderrText: "", exitCode: 1, discoveredFiles: [] });
    expect(r.verdict).toBe("runner-policy");
  });

  it("a discovered file absent from the report is runner-policy — the silently dropped file", () => {
    const r = classifyRun({
      report: report([{ name: "/t/a.test.ts", tests: [{ status: "passed" }] }]),
      stderrText: "",
      exitCode: 0,
      discoveredFiles: ["/t/a.test.ts", "/t/b.test.ts"],
    });
    expect(r.verdict).toBe("runner-policy");
    expect(r.failures[0]).toMatchObject({ file: "/t/b.test.ts", class: "runner-policy" });
  });

  it("all tests green, exit non-zero, under coverage: the threshold gate, not a flake", () => {
    const clean = report([{ name: "/t/a.test.ts", tests: [{ status: "passed" }] }]);
    const covered = classifyRun({
      report: clean,
      stderrText: "",
      exitCode: 1,
      discoveredFiles: ["/t/a.test.ts"],
      coverage: true,
    });
    expect(covered.verdict).toBe("coverage-threshold");
    // The same shape WITHOUT coverage has no threshold to blame — the runner
    // exited red against its own all-green report.
    const bare = classifyRun({
      report: clean,
      stderrText: "",
      exitCode: 1,
      discoveredFiles: ["/t/a.test.ts"],
      coverage: false,
    });
    expect(bare.verdict).toBe("runner-policy");
  });

  it("runner-policy outranks product in the run verdict — one broken pool taints the measurement", () => {
    const r = classifyRun({
      report: report([
        {
          name: "/t/a.test.ts",
          tests: [
            { status: "failed", messages: ["AssertionError: expected"] },
            { status: "failed", messages: ["Tinypool: worker exited unexpectedly"] },
          ],
        },
      ]),
      stderrText: "",
      exitCode: 1,
      discoveredFiles: ["/t/a.test.ts"],
    });
    expect(r.verdict).toBe("runner-policy");
    expect(r.failures).toHaveLength(2);
  });
});
