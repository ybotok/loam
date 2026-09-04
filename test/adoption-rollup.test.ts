/**
 * The axis-adoption rollup: `validate --all`'s additive `scorecard.adoption`
 * key, the adoption/axes lines of the scorecard table, and the text-only
 * grouping of warnings whose sole cause is a fleet-wide not-started axis
 * (src/commands/validate/fleet/scorecard/adoption.ts + report.ts).
 *
 * The anchor assertions — the exact `adoption` object on the coherent
 * fixture, and the capabilities banner replacing the two per-capability warn
 * lines — fail on the pre-rollup tree (the key was undefined; the warns
 * printed individually) and pin the two doctrines the feature ships with:
 * grouping is a RENDERING lever (`--json`, the footer's counts, exit codes
 * and `--strict` are computed from the unfiltered findings), and the rule is
 * mechanical and fail-closed ("not started" means N=0 — a partially adopted
 * axis never groups, and an axis at zero with no qualifying warning prints no
 * banner).
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AXIS_GROUPED_WARNS } from "../src/commands/validate/fleet/scorecard/adoption.js";
import { coherentFixture, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** Two declared capabilities; whether anything realizes them is the fixture's call. */
const CAPABILITIES = `capabilities:
  payments/refund:
    description: Refund a captured payment
    owner: payment-service
  payments/split:
    description: Split a payment across payees
    owner: payment-service
`;

/** Two services with C4 models and NOTHING else, drawn by a landscape with no edges. */
/**
 * Two services with a model and nothing else — the requirements axis at zero.
 *
 * Each model STANDS ALONE (its own `specification` block) and carries the same
 * `metadata { service }` binding as the map's element, deliberately: a
 * standalone model's copy of a shared element that disagrees with the map is
 * `c4.declaration-diverged`, and two of those would be warnings this test's
 * subject — the not-started banner's grouping arithmetic — has nothing to do
 * with.
 */
function modelOnlyFleet(): Record<string, string> {
  const model = (id: string, name: string): string => `specification {
  element softwareSystem
}

model {
  ${name} = softwareSystem '${id}' {
    description 'Service ${id}'
    metadata { service '${id}' }
  }
}

views {
  view of ${name} {
    include *
  }
}
`;
  return {
    "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
}

views {
  view landscape {
    include *
  }
}
`,
    "services/svc-a/model.likec4": model("svc-a", "svcA"),
    "services/svc-b/model.likec4": model("svc-b", "svcB"),
  };
}

describe("validate --all --json: the adoption payload key", () => {
  it("derives the six per-axis participation counts, exactly, on the coherent fixture", async () => {
    await withProject(coherentFixture(), async (p) => {
      const payload = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // The anchor: this key did not exist before the rollup shipped. The
      // denominator is deliberately NOT here — scorecard.services carries it.
      expect(payload.scorecard.adoption).toEqual({
        requirements: 1,
        arch: 0,
        openapi: 1,
        asyncapi: 0,
        permissions: 0,
        capabilities: 0,
      });
    });
  });
});

describe("validate --all text mode: the adoption and axes lines", () => {
  it("prints the participation row and the adopted/not-started one-liner in the scorecard table", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.out).toContain(
        "adoption      requirements 1/1 · arch 0/1 · openapi 1/1 · asyncapi 0/1 · permissions 0/1 · capabilities 0/1",
      );
      expect(res.out).toContain(
        "axes          adopted: requirements, openapi · not started: arch, asyncapi, permissions, capabilities",
      );
      // Four axes sit at zero and NO banner prints: nothing on this fleet
      // fires a groupable warning, and an axis banner exists only where it
      // actually replaced one.
      expect(res.out).not.toContain("axis not started fleet-wide");
    });
  });
});

describe("the not-started banner: a rendering lever over unchanged findings", () => {
  it("folds a fresh capability vocabulary's per-capability warns into one banner, text only", async () => {
    const files = coherentFixture();
    files["architecture/capabilities.yaml"] = CAPABILITIES;
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // Every finding is unchanged in --json: both per-capability warns stand.
      const unrealized = json.targets
        .flatMap((t: { findings: Array<{ code: string }> }) => t.findings)
        .filter((f: { code: string }) => f.code === "capability.unrealized");
      expect(unrealized).toHaveLength(2);
      expect(json.scorecard.adoption.capabilities).toBe(0);

      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.code).toBe(0);
      // ONE banner, naming the axis, the denominator and the dropped codes.
      expect(text.out).toContain("capabilities axis not started fleet-wide (0 of 1 service)");
      expect(text.out).toContain("2 warning(s) grouped: capability.unrealized×2");
      expect(text.out).toContain("every finding is unchanged in --json");
      const banners = text.out.split("\n").filter((l) => l.includes("axis not started fleet-wide"));
      expect(banners).toHaveLength(1);
      // The two per-capability lines are what the banner replaced.
      expect(text.out).not.toContain("is declared in architecture/capabilities.yaml");
      // The footer still counts the grouped warns — the numbers reconcile
      // with --json because both sides count the unfiltered findings.
      const w: number = json.summary.warnings;
      expect(text.out).toContain(`${w} warning${w === 1 ? "" : "s"}`);
      // The banner is a rollup, so it prints after the footer, not inside a target.
      expect(text.out.indexOf("warning")).toBeLessThan(text.out.indexOf("axis not started"));
    });
  });

  it("never groups a partially adopted axis: one realized capability un-banners the other's warn", async () => {
    const files = coherentFixture();
    files["architecture/capabilities.yaml"] = CAPABILITIES;
    // One requirement realizes payments/split, so the axis is 1/1 — adopted.
    files["services/payment-service/spec.md"] = LIVING_SPEC.replace(
      "Operations: authorizePayment",
      "Operations: authorizePayment\nCapability: payments/split",
    );
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(json.scorecard.adoption.capabilities).toBe(1);
      const text = await runLoam(p.workDir, "validate", "--all");
      // N=0 is "not started"; 0<N<M is "partially adopted" and NEVER groups:
      // the remaining warn names a real gap in an axis the fleet has started.
      expect(text.out).not.toContain("axis not started fleet-wide");
      expect(text.out).toContain("capability 'payments/refund' is declared in architecture/capabilities.yaml");
    });
  });

  it("groups per-service no-spec warns under the requirements banner, and --strict still counts them", async () => {
    await withProject(modelOnlyFleet(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      const noSpec = json.targets
        .flatMap((t: { findings: Array<{ code: string }> }) => t.findings)
        .filter((f: { code: string }) => f.code === "service.no-spec");
      expect(noSpec).toHaveLength(2);
      expect(json.summary).toEqual({ services: 2, features: 0, errors: 0, warnings: 2 });

      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.code).toBe(0);
      expect(text.out).toContain("requirements axis not started fleet-wide (0 of 2 services)");
      expect(text.out).toContain("2 warning(s) grouped: service.no-spec×2");
      expect(text.out).not.toContain("No living spec at");
      expect(text.out).toContain("0 errors, 2 warnings");
      // Five other axes are also at zero here and print NO banner: a banner
      // exists only where it replaced at least one warning.
      const banners = text.out.split("\n").filter((l) => l.includes("axis not started fleet-wide"));
      expect(banners).toHaveLength(1);

      // The banner is a rollup like the footer, so --errors-only keeps it
      // while the per-target listing stays empty.
      const quiet = await runLoam(p.workDir, "validate", "--all", "--errors-only");
      expect(quiet.out).toContain("requirements axis not started fleet-wide");
      expect(quiet.out).not.toContain("No living spec at");

      // The ONLY warnings on this fleet are the grouped ones, so this exit 1
      // is the pin that grouping never reaches --strict's count.
      const strict = await runLoam(p.workDir, "validate", "--all", "--strict");
      expect(strict.code).toBe(1);
    });
  });

  it("fails open outside --all: a single-target run prints the same warn individually, bannerless", async () => {
    await withProject(modelOnlyFleet(), async (p) => {
      // No scorecard is derived for a single target, so adoption is null and
      // the renderer takes the pre-rollup path: the groupable code prints as
      // itself, because "not started fleet-wide" is not provable here.
      const res = await runLoam(p.workDir, "validate", "svc-a");
      expect(res.out).toContain("No living spec at");
      expect(res.out).not.toContain("axis not started fleet-wide");
    });
  });

  it("refuses to group when a service is unreadable: a false zero must not suppress a real warn", async () => {
    await withProject(modelOnlyFleet(), async (p) => {
      // svc-a HAS a spec — the requirements axis IS started — but the file is
      // UTF-16 (the exact bytes scorecard.test.ts grades), so its target is
      // `service.unreadable` and its participation reads all-false. Grouping
      // over that zero would hide svc-b's real, unrelated no-spec gap behind a
      // banner claiming "not started fleet-wide" two lines under the error
      // proving otherwise; the renderer refuses instead.
      await writeFile(
        join(p.docsDir, "services/svc-a/spec.md"),
        Buffer.from("﻿" + LIVING_SPEC, "utf16le"),
      );
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // The payload keeps the zeros doctrine every other axis applies — the
      // unreadable service contributes nothing, and the service.unreadable
      // finding beside it names why.
      expect(json.scorecard.adoption.requirements).toBe(0);

      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.code).toBe(1);
      expect(text.out).toContain("could not be read");
      expect(text.out).toContain("No living spec at");
      expect(text.out).not.toContain("axis not started fleet-wide");
    });
  });

  it("never claims '0 of 0': a fleet with no services groups nothing", async () => {
    // A docs repo right after init: a capability vocabulary and an empty
    // services/. Every axis is VACUOUSLY zero — that is "there is no fleet",
    // not "not started fleet-wide" — so the fleet-level warns print
    // individually and no banner licenses itself on an empty denominator.
    await withProject(
      { "services/.keep": "", "architecture/capabilities.yaml": CAPABILITIES },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--all");
        expect(res.code).toBe(0);
        expect(res.out).toContain("capability 'payments/refund' is declared");
        expect(res.out).toContain("capability 'payments/split' is declared");
        expect(res.out).not.toContain("axis not started fleet-wide");
        expect(res.out).not.toContain("0 of 0");
      },
    );
  });

  it("holds the table's disjointness: one code, one axis — the inversion depends on it", () => {
    // A code filed under two axes would be grouped under whichever happens to
    // sit at zero — possibly folding a real warning under a fully adopted
    // axis's banner. The doc comment states the invariant; this makes it
    // mechanical.
    const flat = Object.values(AXIS_GROUPED_WARNS).flat();
    expect(new Set(flat).size).toBe(flat.length);
  });
});
