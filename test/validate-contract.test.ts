/**
 * Tests for `loam validate --all` and `loam validate --json`
 * (src/commands/validate.ts + src/core/report.ts).
 *
 * --all is the fleet gate: one invocation that CI can hang a check on.
 * --json is the machine contract: stable codes an agent branches on, instead of
 * parsing prose. Both read the same report; only the renderer differs, so the
 * text output of a single target must stay exactly what it was.
 *
 * Families:
 *  - --all: coverage of every target, summary, exit discipline
 *  - --all: the landscape is parsed once and findings stay identical to per-target runs
 *  - --json: envelope, ok-vs-valid, finding shape, stable codes
 *  - --json: graded absences (service.unknown / service.no-spec / service.no-openapi)
 *  - option conflicts
 */
import { describe, expect, it } from "vitest";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  LIVING_OPENAPI,
  SERVICE_MODEL,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

interface Finding {
  severity: "ok" | "warn" | "error";
  code: string;
  message: string;
  details: string[];
}
interface Target {
  kind: "service" | "feature" | "landscape";
  id: string;
  valid: boolean;
  findings: Finding[];
}

const codes = (t: Target): string[] => t.findings.map((f) => f.code);

describe("--all", () => {
  it("validates every service and every active feature in one run", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
      expect(res.out).toContain(SVC);
      expect(res.out).toContain("FEAT-1");
    });
  });

  it("ends with a summary of what was checked", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.out).toContain("1 service");
      expect(res.out).toContain("1 feature");
    });
  });

  it("needs no --service: it does not depend on the local repo's identity", async () => {
    // no `service` in loam.json — --all must still work
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
    });
  });

  it("exits 1 when any single service fails", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = `# ${SVC}\n\n## Requirements\n\n### Requirement: No scenario\nThe service SHALL do a thing.\n`;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
      expect(res.out).toContain("without a scenario");
    });
  });

  it("exits 1 when any single feature fails", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] =
      "## ADDED Requirements\n\n### Requirement: No scenario\nThe service SHALL do a thing.\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
    });
  });

  it("a service directory with no C4 model is an error, not a silent skip", async () => {
    const files = coherentFixture();
    files["services/ghost/spec.md"] = "# ghost\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
      expect(res.out).toContain("ghost");
    });
  });

  it("does not validate archived features", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-0-old/specs/svc/spec.md"] =
      "## ADDED Requirements\n\n### Requirement: Broken\nNo scenario here.\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("FEAT-0");
    });
  });

  it("an empty docs repo passes with nothing to check", async () => {
    await withProject({}, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
      expect(res.out).toContain("0 services");
    });
  });

  it("refuses to combine --all with a single target", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const withService = await runLoam(p.workDir, "validate", "--all", "--service", SVC);
      expect(withService.code).toBe(1);
      const withFeature = await runLoam(p.workDir, "validate", "--all", "--feature", "FEAT-1");
      expect(withFeature.code).toBe(1);
    });
  });

  it("refuses --service with --feature as invalid-option, instead of silently dropping --service", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("invalid-option");
    });
  });

  it("parses the landscape once, and the findings stay identical to per-target runs", async () => {
    // The preloaded-landscape path must be a behavioral no-op: every service
    // target under --all reports byte-for-byte what its single-target run does.
    const files = coherentFixture();
    files["services/checkout-web/model.likec4"] = SERVICE_MODEL;
    await withProject(files, {}, async (p) => {
      const all = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      for (const svc of ["checkout-web", SVC]) {
        const single = JSON.parse(
          (await runLoam(p.workDir, "validate", "--service", svc, "--json")).stdout,
        );
        const fromAll = (all.targets as Target[]).find((t) => t.id === svc)!;
        expect(fromAll.findings).toEqual(single.targets[0].findings);
      }
    });
  });
});

describe("--json envelope", () => {
  it("separates 'the command ran' from 'the docs are valid'", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const clean = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
      expect(clean.ok).toBe(true);
      expect(clean.valid).toBe(true);
    });

    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = `# ${SVC}\n\n## Requirements\n\n### Requirement: No scenario\nThe service SHALL do a thing.\n`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true); // the command worked
      expect(json.valid).toBe(false); // the docs did not
    });
  });

  it("reports a missing config as a command failure, not a validation verdict", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "validate", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("no-config");
    expect(json.valid).toBeUndefined();
  });

  it("reports an unknown feature as a command failure", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-999", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unknown-target");
    });
  });
});

describe("--json findings", () => {
  it("describes a clean service with one target and stable codes", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
      expect(json.targets).toHaveLength(1);
      const t: Target = json.targets[0];
      expect(t.kind).toBe("service");
      expect(t.id).toBe(SVC);
      expect(t.valid).toBe(true);
      expect(codes(t)).toEqual([
        "c4.valid",
        "requirements.covered",
        "api.covered",
        "spine.resolved",
        // the fixture's spec names no owner and no sources — incomplete, not wrong
        "frontmatter.field-missing",
        "sources.absent",
      ]);
      for (const f of t.findings) {
        expect(["ok", "warn"]).toContain(f.severity);
        expect(typeof f.message).toBe("string");
        expect(Array.isArray(f.details)).toBe(true);
      }
    });
  });

  it("codes a requirement with no scenario, and lists the offenders as details", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = `# ${SVC}\n\n## Requirements\n\n### Requirement: No scenario\nThe service SHALL do a thing.\n`;
    await withProject(files, { service: SVC }, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
      const f = (json.targets[0].findings as Finding[]).find(
        (x) => x.code === "requirements.missing-scenarios",
      )!;
      expect(f.severity).toBe("error");
      expect(f.details).toContain("No scenario");
    });
  });

  it("codes an ungoverned operation as a warning that does not invalidate the target", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const t: Target = JSON.parse(res.stdout).targets[0];
      expect(t.valid).toBe(true);
      const f = t.findings.find((x) => x.code === "api.ungoverned")!;
      expect(f.severity).toBe("warn");
      expect(f.message).toContain("refundPayment");
    });
  });

  it("codes a broken C4 model and carries the parser errors as details", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/model.likec4`] =
      "specification {\n  element softwareSystem\n}\n\nmodel {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, { service: SVC }, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
      const t: Target = json.targets[0];
      expect(t.valid).toBe(false);
      const f = t.findings.find((x) => x.code === "c4.invalid")!;
      expect(f.severity).toBe("error");
      expect(f.details.length).toBeGreaterThan(0);
    });
  });

  it("describes a feature target with its coherence verdict", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).stdout,
      );
      const t: Target = json.targets[0];
      expect(t.kind).toBe("feature");
      expect(t.id).toBe("FEAT-1");
      expect(t.valid).toBe(true);
      expect(codes(t)).toContain("delta.valid");
      expect(codes(t)).toContain("coherence.ok");
    });
  });

  it("names the service a feature's per-service finding is about, without prose parsing", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).stdout,
      );
      const t: Target = json.targets[0];
      const perService = t.findings.filter((f) => f.code === "requirements.covered");
      expect(perService.map((f) => (f as Finding & { subject: string }).subject)).toEqual([
        "payment-split-service",
      ]);
    });
  });

  it("carries a coherence breach with the coherence check's own code", async () => {
    const files = coherentFixture();
    // the delta's edge calls an operation nobody defines
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: payment-split-service\n  version: "1.0"\npaths: {}\n`;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const t: Target = JSON.parse(res.stdout).targets[0];
      expect(t.valid).toBe(false);
      expect(codes(t)).toContain("c4-api.op-undefined");
    });
  });

  it("--all emits the fleet landscape, one target per service and feature, plus a summary", async () => {
    const files = coherentFixture();
    files["services/checkout-web/model.likec4"] = SERVICE_MODEL;
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // the landscape ↔ services/ cross-check belongs to no single service, so it
      // reports as its own target, and leads: it frames everything under it
      expect(json.targets.map((t: Target) => t.id)).toEqual([
        "landscape",
        "checkout-web",
        SVC,
        "FEAT-1",
      ]);
      // four warnings: the payment-service spec names no owner and no sources,
      // the feature's intent names no owner, and checkout-web has no spec.md at
      // all (its missing openapi stays quiet — no landscape edge calls an op on it)
      expect(json.summary).toEqual({ services: 2, features: 1, errors: 0, warnings: 4 });
    });
  });

  it("codes an unknown service as its own error — a typo is not an unadopted service", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "paymnt-service", "--json");
      expect(res.code).toBe(1);
      const t: Target = JSON.parse(res.stdout).targets[0];
      expect(t.kind).toBe("service");
      expect(t.valid).toBe(false);
      expect(codes(t)).toEqual(["service.unknown"]);
      const f = t.findings[0]!;
      expect(f.severity).toBe("error");
      expect(f.message).toContain("payment-service"); // the real id, offered
      expect(f.message).not.toContain("adopt");
    });
  });

  it("codes missing spec.md and openapi.yaml as warnings that do not invalidate the target", async () => {
    // model only, no landscape: partial adoption is a supported state, so both
    // absences warn (with no landscape nothing proves the API is unexpected)
    await withProject(
      { [`services/${SVC}/model.likec4`]: SERVICE_MODEL },
      { service: SVC },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--json");
        expect(res.code).toBe(0);
        const t: Target = JSON.parse(res.stdout).targets[0];
        expect(t.valid).toBe(true);
        expect(codes(t)).toEqual(["c4.valid", "service.no-spec", "service.no-openapi"]);
        for (const code of ["service.no-spec", "service.no-openapi"]) {
          expect(t.findings.find((f) => f.code === code)!.severity).toBe("warn");
        }
      },
    );
  });

  it("codes migration debt once per service, not once per operation", async () => {
    const files = coherentFixture();
    // two operations, and a spec whose requirement links neither
    files[`services/${SVC}/spec.md`] = files[`services/${SVC}/spec.md`]!.replace(
      "Operations: authorizePayment\n\n",
      "",
    );
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const t: Target = JSON.parse(res.stdout).targets[0];
      const unlinked = t.findings.filter((f) => f.code === "api.ops-unlinked");
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]!.severity).toBe("warn");
      expect(unlinked[0]!.message).toContain("2 operation(s)");
      // the per-op warn still lists the orphans alongside
      expect(codes(t)).toContain("api.ungoverned");
    });
  });

  it("--all counts errors and warnings across the fleet", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(json.summary.warnings).toBeGreaterThan(0);
      expect(json.summary.errors).toBe(0);
      expect(json.valid).toBe(true);
    });
  });
});

describe("text output is unchanged for a single target", () => {
  it("still prints the service lines it always printed", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.out).toContain(`✓ ${SVC}: C4 model valid`);
      expect(res.out).toContain(`✓ ${SVC}: requirements covered`);
      expect(res.out).toContain(`✓ ${SVC}: API covered`);
      expect(res.out).toContain(`✓ ${SVC}: landscape spine`);
    });
  });

  it("still prints the feature lines it always printed", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.out).toContain("FEAT-1");
      expect(res.out).toContain("✓ delta.likec4 valid");
      expect(res.out).toContain("coherence: ✓ C4 · requirements · OpenAPI agree");
    });
  });
});
