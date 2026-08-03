/**
 * Deep invariant tests for `loam list` (src/commands/list.ts).
 *
 * `list` is the first read command: on a 100+ service fleet it answers "what is
 * in this docs repo" and "what is missing" without opening a single file. It is
 * also the first command with a --json contract, so its shape is pinned here.
 *
 * Families:
 *  - text output: sections, counts, artifact flags, ordering
 *  - filtering: services-only / features-only / archived
 *  - --json: envelope, field shape, repo-relative paths, ordering
 *  - failure modes: no config, empty repo
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

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

/** A repo with two services of differing completeness and three features. */
function fleetFixture(): Record<string, string> {
  return {
    "services/payment-service/model.likec4": "model {}\n",
    "services/payment-service/spec.md": "# payment-service\n",
    "services/payment-service/openapi.yaml": "openapi: 3.1.0\n",
    "services/payment-service/runbook.md": "# runbook\n",
    "services/payment-service/health.yaml": "slo: {}\n",
    "services/payment-service/adrs/0001-outbox.md": "# adr\n",
    "services/checkout-web/spec.md": "# checkout-web\n",
    "features/FEAT-2-refunds/intent.md": "# refunds\n",
    "features/FEAT-10-splitting/intent.md": "# splitting\n",
    "features/FEAT-10-splitting/delta.likec4": "model {}\n",
    "features/FEAT-10-splitting/specs/payment-service/spec.md": "# delta\n",
    "features/archive/FEAT-1-old/intent.md": "# old\n",
  };
}

describe("text output", () => {
  it("lists both sections with counts", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services (2)");
      expect(res.out).toContain("features (2 active)");
      expect(res.out).toContain("payment-service");
      expect(res.out).toContain("checkout-web");
      expect(res.out).toContain("FEAT-2");
      expect(res.out).toContain("FEAT-10");
    });
  });

  it("flags present artifacts and dashes the missing ones", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      const full = res.out.split("\n").find((l) => l.includes("payment-service"))!;
      const bare = res.out.split("\n").find((l) => l.includes("checkout-web"))!;
      expect(full).toContain("M S A R H");
      expect(bare).toContain("- S - - -");
    });
  });

  it("shows the ADR count only for services that have ADRs", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out.split("\n").find((l) => l.includes("payment-service"))).toContain("1 adr");
      expect(res.out.split("\n").find((l) => l.includes("checkout-web"))).not.toContain("adr");
    });
  });

  it("marks which features have an intent and a delta, and which services they touch", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "features");
      const withDelta = res.out.split("\n").find((l) => l.includes("FEAT-10"))!;
      const without = res.out.split("\n").find((l) => l.includes("FEAT-2"))!;
      expect(withDelta).toContain("I D");
      expect(withDelta).toContain("payment-service");
      expect(without).toContain("I -");
    });
  });

  it("orders features numerically: FEAT-2 before FEAT-10", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "features");
      expect(res.out.indexOf("FEAT-2")).toBeLessThan(res.out.indexOf("FEAT-10"));
    });
  });

  it("hides archived features unless --archived is passed", async () => {
    await withProject(fleetFixture(), async (p) => {
      const plain = await runLoam(p.workDir, "list", "features");
      expect(plain.out).not.toContain("FEAT-1 ");
      expect(plain.out).not.toContain("archived");

      const withArchive = await runLoam(p.workDir, "list", "features", "--archived");
      expect(withArchive.out).toContain("FEAT-1");
      expect(withArchive.out).toContain("archived");
    });
  });

  it("narrows to one section when asked", async () => {
    await withProject(fleetFixture(), async (p) => {
      const svcs = await runLoam(p.workDir, "list", "services");
      expect(svcs.out).toContain("services (2)");
      expect(svcs.out).not.toContain("features (");

      const feats = await runLoam(p.workDir, "list", "features");
      expect(feats.out).toContain("features (2 active)");
      expect(feats.out).not.toContain("services (");
    });
  });

  it("says so plainly when a section is empty", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services (0)");
      expect(res.out).toContain("features (0 active)");
    });
  });

  it("rejects an unknown section instead of silently listing everything", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "widgets");
      expect(res.code).toBe(1);
      expect(res.out).toContain("widgets");
    });
  });
});

describe("--json contract", () => {
  it("emits one ok-enveloped object with both collections", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.docsDir).toBe(p.docsDir);
      expect(Array.isArray(json.services)).toBe(true);
      expect(Array.isArray(json.features)).toBe(true);
    });
  });

  it("describes a service by id, repo-relative path, artifacts and adr count", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const svc = json.services.find((s: { id: string }) => s.id === "payment-service");
      expect(svc).toEqual({
        id: "payment-service",
        path: "services/payment-service",
        has: { model: true, spec: true, openapi: true, runbook: true, health: true },
        adrs: 1,
        status: null,
      });
    });
  });

  it("describes a feature by id, directory, touched services and artifacts", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-10");
      expect(feat).toEqual({
        id: "FEAT-10",
        dirName: "FEAT-10-splitting",
        path: "features/FEAT-10-splitting",
        archived: false,
        services: ["payment-service"],
        has: { intent: true, delta: true },
      });
    });
  });

  it("keeps paths repo-relative so the output is diffable across machines", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      for (const s of json.services) expect(s.path.startsWith("services/")).toBe(true);
      for (const f of json.features) expect(f.path.startsWith("features/")).toBe(true);
    });
  });

  it("carries the same ordering as the text output", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(json.features.map((f: { id: string }) => f.id)).toEqual(["FEAT-2", "FEAT-10"]);
      expect(json.services.map((s: { id: string }) => s.id)).toEqual([
        "checkout-web",
        "payment-service",
      ]);
    });
  });

  it("includes archived features only with --archived, flagged", async () => {
    await withProject(fleetFixture(), async (p) => {
      const plain = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(plain.features.map((f: { id: string }) => f.id)).not.toContain("FEAT-1");

      const withArchive = JSON.parse(
        (await runLoam(p.workDir, "list", "--json", "--archived")).stdout,
      );
      const archived = withArchive.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(archived.archived).toBe(true);
      expect(archived.path).toBe("features/archive/FEAT-1-old");
    });
  });

  it("omits the section that was filtered out", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      expect(json.services).toBeDefined();
      expect(json.features).toBeUndefined();
    });
  });

  it("reports failure inside the envelope, not as loose text, and still exits 1", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "list", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("no-config");
    expect(json.error.message).toContain("loam init");
  });

  it("emits valid JSON even for an empty docs repo", async () => {
    await withProject({}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(json).toEqual({ ok: true, docsDir: p.docsDir, services: [], features: [] });
    });
  });
});

describe("failure modes", () => {
  it("without loam.json points at `loam init` and exits 1", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "list");
    expect(res.code).toBe(1);
    expect(res.out).toContain("loam init");
  });

  it("works on the canonical coherent fixture", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("payment-service");
      expect(res.out).toContain("FEAT-1");
    });
  });
});
