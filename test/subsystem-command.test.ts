/**
 * The `loam subsystem` verb surface minus move/rename (those have their own
 * suite, test/subsystem-move.test.ts): new, rm, list, history's doctrine
 * edges, the verb/flag refusals, and `adopt --subsystem`. Every refusal
 * asserts the stable code, exit 1, and — for the write verbs — that nothing
 * was written (treeHashes before/after).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

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

/** Assert a refusal: stable code, exit 1, and nothing written. */
async function refuses(p: Project, args: string[], code: string): Promise<{ message: string }> {
  const before = await treeHashes(p.docsDir);
  const res = await runLoam(p.workDir, ...args, "--json");
  expect(res.code, args.join(" ")).toBe(1);
  const payload = JSON.parse(res.stdout);
  expect(payload.ok).toBe(false);
  expect(payload.error.code, args.join(" ")).toBe(code);
  expect(await treeHashes(p.docsDir), args.join(" ")).toEqual(before);
  return { message: payload.error.message };
}

describe("subsystem new", () => {
  it("creates the marker and the views file in one commit, and the fleet is green after", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "subsystem", "new", "payments", "--title", "Payments", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload).toMatchObject({ ok: true, created: "payments", path: "services/payments", views: "created" });
      expect(await p.read("services/payments/subsystem.yaml")).toBe("title: Payments\n");
      // The generated file landed in the SAME commit: an empty subsystem is
      // legal and its view body is empty.
      expect(await p.read("architecture/subsystems.likec4")).toContain("view subsystem_payments {\n  }");
      const all = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(all.code).toBe(0);
    });
  });

  it("refuses fail-closed when the disk already answers to the name the tree cannot see", async () => {
    // A plain FILE at the services/ root is invisible to the tree walk (only
    // directories are classified), so the flat-namespace check misses it —
    // but `join(services/, name)` lands exactly on it, and without the probe
    // the marker write detonated inside the transaction instead of refusing.
    const files = coherentFixture();
    files["services/billing"] = "not a directory\n";
    await withProject(files, async (p) => {
      const res = await refuses(p, ["subsystem", "new", "billing"], "already-exists");
      expect(res.message).toContain("already exists on disk");
    });
  });

  it("refuses fail-closed where the filesystem folds case: 'Billing' must not write a marker into services/billing", async () => {
    const files = coherentFixture();
    files["services/billing/spec.md"] = "---\nservice: billing\n---\n\n# billing\n";
    await withProject(files, async (p) => {
      // Whether this volume folds case is a fact about the machine, probed
      // rather than assumed, so the test discriminates on macOS/Windows and
      // still asserts the create is not over-refused on Linux.
      const folded = existsSync(join(p.docsDir, "services", "BILLING"));
      const res = await runLoam(p.workDir, "subsystem", "new", "Billing", "--json");
      if (folded) {
        expect(res.code).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("already-exists");
        // The live service was not invaded: no marker beside its artifacts —
        // the exact subsystem.marker-misplaced state this probe fails closed on.
        expect(p.exists("services/billing/subsystem.yaml")).toBe(false);
      } else {
        expect(res.code).toBe(0);
        expect(p.exists("services/Billing/subsystem.yaml")).toBe(true);
      }
    });
  });

  it("an empty marker is a valid marker: no metadata flags, empty file", async () => {
    await withProject(coherentFixture(), async (p) => {
      expect((await runLoam(p.workDir, "subsystem", "new", "payments")).code).toBe(0);
      expect(await p.read("services/payments/subsystem.yaml")).toBe("");
    });
  });

  it("--under nests the group, and the child's view name carries the path", async () => {
    await withProject(coherentFixture(), async (p) => {
      expect((await runLoam(p.workDir, "subsystem", "new", "payments")).code).toBe(0);
      const res = await runLoam(p.workDir, "subsystem", "new", "billing", "--under", "payments", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).path).toBe("services/payments/billing");
      expect(await p.read("architecture/subsystems.likec4")).toContain("view subsystem_payments__billing");
    });
  });

  it("refuses an illegal name (invalid-option), a namespace collision at any depth (already-exists), and an unknown parent (unknown-target)", async () => {
    await withProject(coherentFixture(), async (p) => {
      expect((await refuses(p, ["subsystem", "new", "pay ments"], "invalid-option")).message).toContain("subsystem name");
      // Collides with a SERVICE id — the namespace is one and flat.
      const svc = await refuses(p, ["subsystem", "new", "payment-service"], "already-exists");
      expect(svc.message).toContain("flat namespace");
      expect((await runLoam(p.workDir, "subsystem", "new", "payments")).code).toBe(0);
      await refuses(p, ["subsystem", "new", "payments"], "already-exists");
      const miss = await refuses(p, ["subsystem", "new", "billing", "--under", "paymnets"], "unknown-target");
      expect(miss.message).toContain("payments");
    });
  });
});

describe("subsystem rm", () => {
  it("removes an empty group — marker, directory and its view all gone", async () => {
    await withProject(coherentFixture(), async (p) => {
      await runLoam(p.workDir, "subsystem", "new", "payments");
      const res = await runLoam(p.workDir, "subsystem", "rm", "payments", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout)).toMatchObject({ removed: "payments", directoryRemoved: true, views: "removed" });
      expect(p.exists("services/payments")).toBe(false);
      // Last subsystem gone => the generated file must be absent again.
      expect(p.exists("architecture/subsystems.likec4")).toBe(false);
    });
  });

  it("refuses a non-empty group with subsystem-not-empty, naming the members, and writes nothing", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    files["services/payments/billing/subsystem.yaml"] = "";
    for (const [path, content] of Object.entries(coherentFixture())) {
      if (path.startsWith("services/payment-service/")) {
        files[path.replace("services/payment-service/", "services/payments/payment-service/")] = content;
        delete files[path];
      }
    }
    await withProject(files, async (p) => {
      await runLoam(p.workDir, "subsystem", "sync");
      const res = await refuses(p, ["subsystem", "rm", "payments"], "subsystem-not-empty");
      expect(res.message).toContain("service payment-service");
      expect(res.message).toContain("subsystem billing");
      // Each member ONCE, as what it is: the tree's members are also readdir
      // entries of this directory, and the un-discriminated stray scan listed
      // payment-service a second time as "file payment-service" — 4 member(s)
      // for a group holding 2.
      expect(res.message).toContain("2 member(s)");
      expect(res.message).not.toContain("file payment-service");
      expect(res.message).not.toContain("file billing");
    });
  });

  it("refuses to rm a service (invalid-option) and an unknown name (unknown-target)", async () => {
    await withProject(coherentFixture(), async (p) => {
      const svc = await refuses(p, ["subsystem", "rm", "payment-service"], "invalid-option");
      expect(svc.message).toContain("git rm");
      await refuses(p, ["subsystem", "rm", "nowhere"], "unknown-target");
    });
  });
});

describe("subsystem list", () => {
  it("shows the tree with member counts and the unfiled count, text and --json", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "title: Payments\n";
    for (const [path, content] of Object.entries(coherentFixture())) {
      if (path.startsWith("services/payment-service/")) {
        files[path.replace("services/payment-service/", "services/payments/payment-service/")] = content;
        delete files[path];
      }
    }
    files["services/checkout-web/spec.md"] = "---\nservice: checkout-web\n---\n\n# checkout-web\n";
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "subsystem", "list", "--json")).stdout);
      expect(json.subsystems).toEqual([
        { name: "payments", path: "services/payments", title: "Payments", memberCount: 1 },
      ]);
      expect(json.unfiledServices).toBe(1);
      expect(json.services).toBe(2);
      const text = await runLoam(p.workDir, "subsystem", "list");
      expect(text.out).toContain("payments  Payments  — 1 service(s)");
      expect(text.out).toContain("unfiled: 1 of 2 service(s)");
    });
  });

  it("says plainly that a flat fleet has no subsystems", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "subsystem", "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("no subsystems");
    });
  });
});

describe("subsystem history — the doctrine edge", () => {
  it("answers nothing without a finding when git will not say: exit 0, empty moves, answered: false", async () => {
    // makeProject fixtures are not git repositories, so git declines — which
    // must never be an error or a finding.
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "subsystem", "history", "payment-service", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout)).toMatchObject({
        ok: true,
        name: "payment-service",
        kind: "service",
        moves: [],
        answered: false,
      });
      const text = await runLoam(p.workDir, "subsystem", "history", "payment-service");
      expect(text.code).toBe(0);
      expect(text.out).toContain("git will not say");
    });
  });

  it("refuses a name the tree does not hold, with close-name hints", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await refuses(p, ["subsystem", "history", "payment-servce"], "unknown-target");
      expect(res.message).toContain("payment-service");
    });
  });
});

describe("the verb dispatch", () => {
  it("refuses an unknown verb, a wrong arity, and a flag on the wrong verb — one code, invalid-option", async () => {
    await withProject(coherentFixture(), async (p) => {
      await refuses(p, ["subsystem", "explode"], "invalid-option");
      await refuses(p, ["subsystem", "new"], "invalid-option");
      await refuses(p, ["subsystem", "rename", "only-one"], "invalid-option");
      await refuses(p, ["subsystem", "move", "payment-service"], "invalid-option");
      await refuses(p, ["subsystem", "rm", "x", "--into", "y"], "invalid-option");
      await refuses(p, ["subsystem", "sync", "--title", "T"], "invalid-option");
    });
  });
});

describe("adopt --subsystem", () => {
  it("briefs a NEW service's artifact paths inside the subsystem directory", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "adopt", "--service", "refund-service", "--subsystem", "payments", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.path).toBe("services/payments/refund-service");
      const spec = payload.targets.find((t: { artifact: string }) => t.artifact === "spec.md");
      expect(spec.path).toBe("services/payments/refund-service/spec.md");
      // adopt still writes nothing.
      expect(p.exists("services/payments/refund-service")).toBe(false);
    });
  });

  it("refuses an unknown subsystem with close-name hints, and warns instead of moving an existing service", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "adopt", "--service", "x-service", "--subsystem", "paymnets", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("unknown-target");
      expect(payload.error.message).toContain("payments");

      // An existing service is briefed where it lives: --subsystem never moves.
      const existing = await runLoam(p.workDir, "adopt", "--service", "payment-service", "--subsystem", "payments", "--json");
      expect(existing.code).toBe(0);
      const brief = JSON.parse(existing.stdout);
      expect(brief.path).toBe("services/payment-service");
      expect(brief.warnings.join(" ")).toContain("loam subsystem move");
    });
  });
});
