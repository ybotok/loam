/**
 * Pins examples/docs — the README's "Try it" target and SCHEMA.md's runnable
 * companion — against the real commands. Nothing else in the suite reads the
 * example tree, so without this file it can drift from the checks (a new
 * validate rule, a changed archive gate) and the first person to notice is a
 * reader following the README. A failure here means the example and the code
 * disagree: make the example exemplary again, do not loosen the assertions.
 *
 * The warning set is pinned EXACTLY, not merely bounded. The three warnings the
 * example carries are deliberate demonstrations (checkout-web names no sources;
 * one landscape edge has no op link; one of FEAT-101's tagged edges has no arch
 * requirement covering it), and an exact match makes any new code that starts
 * firing on the example loud instead of quietly accumulating.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

// The example is copied into a temp dir rather than validated in place: only
// read-only commands run here today, but a test must not be one bug away from
// rewriting the repo's own example tree.
let root: string;
let workDir: string;
let docsDir: string;

beforeAll(async () => {
  root = await makeTmpDir();
  workDir = join(root, "work");
  docsDir = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await cp(EXAMPLES, docsDir, { recursive: true });
  await writeFile(
    join(workDir, "loam.json"),
    JSON.stringify({ docsDir }, null, 2) + "\n",
    "utf8",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("examples/docs vs loam validate --all", () => {
  it("is valid: zero errors, and exactly the three demonstration warnings", async () => {
    const res = await runLoam(workDir, "validate", "--all", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.valid).toBe(true);
    expect(payload.summary).toEqual({ services: 2, features: 1, errors: 0, warnings: 3 });

    const bySeverity = (sev: string) =>
      payload.targets
        .flatMap((t: { findings: Array<{ severity: string; code: string }> }) => t.findings)
        .filter((f: { severity: string }) => f.severity === sev)
        .map((f: { code: string }) => f.code)
        .sort();
    expect(bySeverity("error")).toEqual([]);
    // c4.uncovered is the checkout-web → payment-split-service edge: FEAT-101's
    // arch delta covers the other tagged additions and leaves this one out on
    // purpose, so the example demonstrates the arch-coverage obligation firing.
    expect(bySeverity("warn")).toEqual(["c4.uncovered", "sources.absent", "spine.op-link-missing"]);
  });

  it("counts payment-service's sources as unverifiable from outside its repo", async () => {
    // The example spec names `sources` but this workdir is not payment-service's
    // repo, so the fleet summary reports the blind spot instead of resolving it.
    const res = await runLoam(workDir, "validate", "--all", "--json");
    expect(JSON.parse(res.stdout).sourcesUnverifiableFromHere).toBe(1);
  });
});

describe("examples/docs vs loam archive FEAT-101 --dry-run", () => {
  it("plans a coherent six-file merge plus the move, warning only that the new service has no model", async () => {
    const res = await runLoam(workDir, "archive", "FEAT-101", "--dry-run", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.feature).toBe("FEAT-101");
    expect(payload.archived).toBe(false);
    // FEAT-101 creates services/payment-split-service/ — spec, arch spec and
    // contract — and the landscape gains the element, but nothing writes the
    // service's own model.likec4. Archive used to close with "complete and
    // current" and leave `validate --all` reporting a service it had just
    // created as incomplete; it says so up front now. Advisory: it never gates.
    expect(payload.warnings).toEqual([
      {
        severity: "warn",
        code: "service.no-model",
        gates: false,
        subject: "payment-split-service",
        message: expect.stringContaining("model.likec4"),
      },
    ]);
    expect(payload.overridden).toEqual([]);
    expect(payload.plan).toEqual([
      { path: "services/checkout-web/spec.md", action: "update" },
      { path: "services/payment-service/spec.md", action: "update" },
      { path: "services/payment-split-service/spec.md", action: "create" },
      { path: "services/payment-split-service/arch.spec.md", action: "create" },
      { path: "services/payment-split-service/openapi.yaml", action: "create" },
      { path: "architecture/landscape.likec4", action: "update" },
      {
        path: "features/FEAT-101-payment-splitting",
        action: "move",
        to: "features/archive/FEAT-101-payment-splitting",
      },
    ]);
  });

  it("writes nothing — the example tree is byte-identical after the dry run", async () => {
    const before = await treeHashes(docsDir);
    const res = await runLoam(workDir, "archive", "FEAT-101", "--dry-run");
    expect(res.code).toBe(0);
    expect(res.out).toContain("dry run — nothing was written");
    expect(await treeHashes(docsDir)).toEqual(before);
  });
});
