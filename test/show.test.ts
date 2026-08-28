/**
 * Deep invariant tests for `loam show` (src/commands/show.ts).
 *
 * `show` is the "read one thing" command: everything loam knows about a service
 * or a feature, without opening five files by hand. It resolves the target type
 * itself, so the resolution rules are pinned here alongside the output contract.
 *
 * Families:
 *  - target resolution: service / feature / archived / collision / unknown
 *  - service view: artifacts, requirements, operations, landscape edges
 *  - feature view: intent, delta counts, per-service requirement delta
 *  - --json contract for both views
 */
import { describe, expect, it } from "vitest";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  LIVING_OPENAPI,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";

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

describe("target resolution", () => {
  it("resolves a service by its directory name", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      expect(res.code).toBe(0);
      expect(res.out).toContain(SVC);
      expect(res.out).toContain("services/payment-service");
    });
  });

  it("resolves a feature by id, slug and all", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("FEAT-1");
      expect(res.out).toContain("features/FEAT-1-split");
    });
  });

  it("reads an archived feature without a flag — shipped features are still readable", async () => {
    await withProject(
      {
        "features/archive/FEAT-9-shipped/intent.md": "# shipped\n",
        "features/archive/FEAT-9-shipped/specs/svc/spec.md": "# delta\n",
      },
      async (p) => {
        const res = await runLoam(p.workDir, "show", "FEAT-9");
        expect(res.code).toBe(0);
        expect(res.out).toContain("archived");
      },
    );
  });

  it("prefers a feature over a same-named service, and --type forces the other reading", async () => {
    await withProject(
      {
        "services/FEAT-1/spec.md": "# oddly named service\n",
        "features/FEAT-1-split/intent.md": "# feature\n",
      },
      async (p) => {
        const auto = await runLoam(p.workDir, "show", "FEAT-1");
        expect(auto.out).toContain("features/FEAT-1-split");

        const forced = await runLoam(p.workDir, "show", "FEAT-1", "--type", "service");
        expect(forced.code).toBe(0);
        expect(forced.out).toContain("services/FEAT-1");
      },
    );
  });

  it("fails on an unknown target, naming what it looked for", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "nope");
      expect(res.code).toBe(1);
      expect(res.out).toContain("nope");
    });
  });

  it("fails when --type service names something that is not a service", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1", "--type", "service");
      expect(res.code).toBe(1);
    });
  });

  it("without loam.json points at `loam init` and exits 1", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "show", SVC);
    expect(res.code).toBe(1);
    expect(res.out).toContain("loam init");
  });
});

describe("service view", () => {
  it("reports every artifact, present or missing", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      expect(res.out).toContain("model.likec4");
      expect(res.out).toContain("spec.md");
      expect(res.out).toContain("openapi.yaml");
      expect(res.out).toContain("runbook.md");
      expect(res.out).toContain("health.yaml");
      // the fixture has no runbook/health — they must be shown as missing, not
      // omitted, and with the same "-" `list` uses: ✗ is the error glyph, and a
      // missing runbook is not an error
      const runbook = res.out.split("\n").find((l) => l.includes("runbook.md"))!;
      expect(runbook.trimStart().startsWith("- ")).toBe(true);
      expect(runbook).not.toContain("✗");
    });
  });

  it("counts model elements and relationships", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      expect(res.out).toContain("2 elements");
    });
  });

  it("lists requirements with their scenario counts", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      expect(res.out).toContain("Authorize a payment");
      expect(res.out).toContain("1 scenario");
    });
  });

  it("marks which operations a requirement governs and which are orphaned", async () => {
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
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      // scoped to the operations block — the requirements block names ops too
      const ops = res.out.slice(res.out.indexOf("  operations")).split("\n");
      expect(ops.find((l) => l.includes("authorizePayment"))).toContain("✓");
      expect(ops.find((l) => l.includes("refundPayment"))).toContain("⚠");
    });
  });

  it("shows who calls this service and what it calls, from the landscape", async () => {
    // checkout-web is only a landscape element in the base fixture; give it a
    // directory so it is a service in its own right and can be shown too.
    const files = { ...coherentFixture(), "services/checkout-web/spec.md": "# checkout-web\n" };
    await withProject(files, async (p) => {
      const inbound = await runLoam(p.workDir, "show", SVC);
      const land = inbound.out.slice(inbound.out.indexOf("  landscape"));
      expect(land).toContain("← checkout-web");
      expect(land).toContain("authorizePayment");

      const outbound = await runLoam(p.workDir, "show", "checkout-web");
      expect(outbound.out.slice(outbound.out.indexOf("  landscape"))).toContain(`→ ${SVC}`);
    });
  });

  it("survives a service whose model does not parse, reporting the errors", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/model.likec4`] = "specification {\n  element softwareSystem\n}\n\nmodel {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "show", SVC);
      expect(res.code).toBe(0);
      expect(res.out.toLowerCase()).toContain("error");
    });
  });

  it("shows a service that has nothing but a directory", async () => {
    await withProject({ "services/empty/.keep": "" }, async (p) => {
      const res = await runLoam(p.workDir, "show", "empty");
      expect(res.code).toBe(0);
      expect(res.out).toContain("empty");
    });
  });
});

describe("feature view", () => {
  it("reports the feature artifacts and delta size", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1");
      expect(res.out).toContain("intent.md");
      expect(res.out).toContain("delta.likec4");
      // FEATURE_DELTA tags exactly one element and one relationship with FEAT-1
      expect(res.out).toContain("1 element");
      expect(res.out).toContain("1 relationship");
    });
  });

  it("summarizes the requirement delta per service, with the operations it governs", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1");
      expect(res.out).toContain("payment-split-service");
      expect(res.out).toContain("+1");
      expect(res.out).toContain("createSplit");
    });
  });

  it("marks an absent artifact with '-', keeping ✗ for errors alone", async () => {
    await withProject({ "features/FEAT-3-bare/intent.md": "# bare\n" }, async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-3");
      expect(res.code).toBe(0);
      const delta = res.out.split("\n").find((l) => l.includes("delta.likec4"))!;
      expect(delta.trimStart().startsWith("- ")).toBe(true);
      expect(res.out).not.toContain("✗");
    });
  });

  it("survives a feature whose delta does not parse", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out.toLowerCase()).toContain("error");
    });
  });
});

describe("--json contract", () => {
  it("describes a service: artifacts, requirements, operations, landscape edges", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", SVC, "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.type).toBe("service");
      expect(json.id).toBe(SVC);
      expect(json.path).toBe(`services/${SVC}`);
      expect(json.has.model).toBe(true);
      expect(json.has.runbook).toBe(false);
      expect(json.model).toEqual({ elements: 2, relationships: 0, errors: [] });
      expect(json.requirements).toEqual([
        {
          name: "Authorize a payment",
          kind: "BASE",
          covers: [],
          scenarios: 1,
          operations: ["authorizePayment"],
        },
      ]);
      expect(json.operations).toEqual([
        { id: "authorizePayment", governedBy: ["Authorize a payment"] },
      ]);
      expect(json.landscape.inbound).toEqual([
        { service: "checkout-web", op: "authorizePayment", title: "Calls authorizePayment" },
      ]);
      expect(json.landscape.outbound).toEqual([]);
    });
  });

  it("describes a feature: delta counts and the per-service requirement delta", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", "FEAT-1", "--json")).stdout);
      expect(json.type).toBe("feature");
      expect(json.id).toBe("FEAT-1");
      expect(json.dirName).toBe("FEAT-1-split");
      expect(json.path).toBe("features/FEAT-1-split");
      expect(json.archived).toBe(false);
      expect(json.has).toEqual({ intent: true, delta: true });
      expect(json.delta).toEqual({ elements: 1, relationships: 1, errors: [] });
      expect(json.services).toEqual([
        {
          id: "payment-split-service",
          added: 1,
          modified: 0,
          removed: 0,
          operations: ["createSplit"],
        },
      ]);
      // An EMPTY array, never an absent key: a consumer must not have to tell
      // "this feature changes no capability" from "this loam does not report
      // them", and the two would be the same absence.
      expect(json.capabilities).toEqual([]);
    });
  });

  it("lists a feature's capability deltas — the promises it changes", async () => {
    // A feature carrying ONLY a capability delta used to display as a feature
    // carrying nothing, from the command a person runs to find out what a
    // feature carries — while the archive would refuse it over those very
    // documents. `show` and the archive must not be able to disagree about
    // whether a feature has content.
    const files = coherentFixture();
    files["features/FEAT-2-refunds/intent.md"] =
      "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Refunds\n\nMoney back.\n";
    files["features/FEAT-2-refunds/capabilities/payments/refunds/spec.md"] =
      "# payments/refunds — capability delta for FEAT-2\n\n## ADDED Requirements\n\n### Requirement: Refund within five days\nRequirement-ID: REF-1\n\nThe fleet SHALL refund within five days.\n\n#### Scenario: It is refunded\n- **Given** a customer\n- **When** they ask\n- **Then** it is refunded\n";
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", "FEAT-2", "--json")).stdout);
      expect(json.services).toEqual([]);
      expect(json.capabilities).toEqual([
        {
          // The NESTED id, spelled whole: resolved by its leaf this would read
          // `refunds`, which is a different capability entirely.
          id: "payments/refunds",
          path: "features/FEAT-2-refunds/capabilities/payments/refunds/spec.md",
          added: 1,
          modified: 0,
          removed: 0,
          // The id, because `Realizes: payments/refunds#REF-1` is the line
          // somebody has to write next and the id is the half of it nobody can
          // guess from the heading.
          promises: [{ kind: "ADDED", id: "REF-1", name: "Refund within five days" }],
        },
      ]);

      const human = await runLoam(p.workDir, "show", "FEAT-2");
      expect(human.out).toContain("capabilities");
      expect(human.out).toContain("payments/refunds");
      expect(human.out).toContain("REF-1");
    });
  });

  it("prints no capabilities section for a fleet that has not adopted the axis", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "FEAT-1");
      expect(res.code).toBe(0);
      // An empty heading on every feature of every such fleet is the noise that
      // teaches people to skim the output.
      expect(res.out).not.toContain("capabilities");
    });
  });

  it("reports an unknown target inside the envelope and exits 1", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "show", "nope", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unknown-target");
      expect(json.error.message).toContain("nope");
    });
  });

  it("reports a missing config inside the envelope", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "show", SVC, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("no-config");
  });

  it("surfaces parse errors as data rather than failing the command", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/model.likec4`] = "specification {\n  element softwareSystem\n}\n\nmodel {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", SVC, "--json")).stdout);
      expect(json.ok).toBe(true);
      expect(json.model.errors.length).toBeGreaterThan(0);
      expect(json.model.elements).toBe(0);
    });
  });
});
