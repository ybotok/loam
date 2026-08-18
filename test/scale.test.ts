/**
 * A synthetic fleet at something like production shape: 30 services across
 * every maturity rung, a landscape chaining them with op-linked calls, and 10
 * active features adding cross-service operations with tagged deltas.
 *
 * Everything else in the suite validates fleets of one to three services, so
 * nothing pinned that `validate --all` and `list --json` stay CORRECT when the
 * numbers grow: that finding counts scale linearly with construction (no
 * accidental cross-product findings, no findings lost to short-circuiting),
 * that a clean fleet exits 0 at size, and that the maturity rollup adds up to
 * the fleet that was actually built. The fixture is generated programmatically
 * so the expected counts are DERIVED from the same constants that build it —
 * changing the shape changes both sides together.
 *
 * Wall-clock is gated, but only as a blowup alarm, and the ceiling has to
 * tolerate the fact that this file runs inside a 64-file parallel suite. What
 * it costs, measured: ~12s for `validate --all` on an idle box, ~30s with the
 * cores saturated, and 65-77s when the whole suite is running beside it. Those
 * numbers are the machine, not a regression — the same fixture on 4d8cb4b (the
 * commit before the hardening campaign) measures 11.9s against 12.1s today,
 * so the earlier "~4s on a dev laptop" in this header described hardware this
 * one is not.
 *
 * It exists to catch pathological blowups — an accidental per-service re-parse
 * of the landscape or a return of the per-feature double-load turns 40-odd
 * workspace spins into hundreds, and THAT is what must never land silently.
 * That class is an order of magnitude, so it trips this ceiling under any load;
 * vitest's own 120s testTimeout is the hard backstop behind it, and the ceiling
 * sits just under it so a blowup fails with the message below rather than an
 * opaque timeout.
 */
import { describe, it, expect } from "vitest";
import { fleetFiles } from "./helpers/fleet-fixture.js";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/**
 * The generator itself lives in ./helpers/fleet-fixture.ts (no vitest import),
 * because scripts/bench-validate.ts builds the same fleet at benchmark size.
 * The constants stay HERE: every pin below is derived from the same numbers
 * that build the fixture, so changing the shape changes both sides together.
 * See FleetShape in the helper for what each rung means.
 */
const APILESS = 5;
const DOCUMENTED = 10; // svc-6  … svc-15  the full triple
const SOURCED = 10; //   svc-16 … svc-25  triple + sources declared
const VOUCHED = 5; //    svc-26 … svc-30  triple + sources + digest + verified
const SERVICES = APILESS + DOCUMENTED + SOURCED + VOUCHED;

const FEATURES = 10; // FEAT-1 … FEAT-10, each an edge svc-(15+i) → svc-(5+i)

function fleet(): Record<string, string> {
  return fleetFiles({
    apiless: APILESS,
    documented: DOCUMENTED,
    sourced: SOURCED,
    vouched: VOUCHED,
    features: FEATURES,
  });
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

describe(`the synthetic fleet: ${SERVICES} services, ${FEATURES} features`, () => {
  async function fleetProject(): Promise<Project> {
    return makeProject(fleet());
  }

  it("validate --all is green at fleet size, with finding counts derived from construction", async () => {
    const p = await fleetProject();
    try {
      const started = performance.now();
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const elapsed = performance.now() - started;
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(true);
      expect(json.summary).toEqual({
        services: SERVICES,
        features: FEATURES,
        errors: 0,
        // The one warning a clean adopted fleet still carries: every service
        // whose frontmatter declares no `sources` (partial + documented).
        warnings: APILESS + DOCUMENTED,
      });
      // Services that DO declare sources can only be checked from their own
      // repos — the fleet gate must say so rather than read as "verified".
      expect(json.sourcesUnverifiableFromHere).toBe(SOURCED + VOUCHED);

      const findings = (json.targets as Array<{ findings: Array<{ severity: string; code: string }> }>).flatMap(
        (t) => t.findings,
      );
      const count = (code: string): number => findings.filter((f) => f.code === code).length;
      expect(count("landscape.matched")).toBe(1);
      expect(count("c4.valid")).toBe(SERVICES);
      // Every service in the call chain except the first is called with an op.
      expect(count("spine.resolved")).toBe(DOCUMENTED + SOURCED + VOUCHED - 1);
      // One living spec per service, plus one requirement delta and one arch
      // requirement delta per feature.
      expect(count("requirements.covered")).toBe(SERVICES + 2 * FEATURES);
      // Every tagged edge is covered by its feature's arch delta.
      expect(count("c4.uncovered")).toBe(0);
      expect(count("covers.unknown")).toBe(0);
      expect(count("sources.absent")).toBe(APILESS + DOCUMENTED);
      expect(count("delta.valid")).toBe(FEATURES);
      expect(count("archedge.covered")).toBe(FEATURES);
      expect(count("coherence.ok")).toBe(FEATURES);
      // No finding slipped in that the construction does not predict.
      expect(findings.filter((f) => f.severity === "error")).toEqual([]);
      expect(
        findings.filter((f) => f.severity === "warn" && f.code !== "sources.absent"),
      ).toEqual([]);

      // The blowup alarm (see header): sized for a loaded box inside the
      // parallel suite, and kept under vitest's 120s testTimeout so a real
      // blowup reports this message instead of timing out.
      expect(
        elapsed,
        `validate --all over ${SERVICES} services / ${FEATURES} features took ${Math.round(elapsed)}ms`,
      ).toBeLessThan(110_000);
    } finally {
      await p.destroy();
    }
  });

  it("list --json's maturity rollup adds up to the fleet that was built", async () => {
    const p = await fleetProject();
    try {
      const res = await runLoam(p.workDir, "list", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.maturity).toEqual({
        empty: 0,
        // Nothing is `partial`: every service in this fleet has the artifacts
        // that are actually expected of it. The five API-less ones sit at
        // `documented` beside the ten with contracts — the rung means "has what
        // it needs", not "has an openapi.yaml".
        partial: 0,
        documented: APILESS + DOCUMENTED,
        sourced: SOURCED,
        vouched: VOUCHED,
      });
      expect(json.services).toHaveLength(SERVICES);
      expect(json.features).toHaveLength(FEATURES);
      // Spot-check the rungs land on the intended services, not just in the
      // intended quantities.
      const byId = new Map(
        (json.services as Array<{ id: string; maturity: string }>).map((s) => [s.id, s.maturity]),
      );
      expect(byId.get("svc-1")).toBe("documented");
      expect(byId.get("svc-6")).toBe("documented");
      expect(byId.get("svc-16")).toBe("sourced");
      expect(byId.get("svc-30")).toBe("vouched");
    } finally {
      await p.destroy();
    }
  });
});
