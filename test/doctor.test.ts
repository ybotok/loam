import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("doctor", () => {
  it("reports runtime, accessibility and fleet counts without touching the repository", async () => {
    const project = await makeProject(coherentFixture(), { service: "payment-service" });
    cleanups.push(() => project.destroy());
    const before = await treeHashes(project.docsDir);

    const result = await runLoam(project.workDir, "doctor", "--json");

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      contractVersion: "1.0",
      ok: true,
      command: "doctor",
      healthy: true,
      config: { status: "valid" },
      docs: {
        exists: true,
        readable: true,
        writable: true,
        servicesDir: true,
        landscape: true,
      },
      currentService: { configured: "payment-service", status: "matched" },
    });
    expect(report.runtime.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.counts).toEqual({ services: 1, activeFeatures: 1 });
    expect(await treeHashes(project.docsDir)).toEqual(before);
  });

  it("turns corrupt config into a blocker report, not a stack trace", async () => {
    const root = await makeTmpDir("loam-doctor-corrupt-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, "loam.json"), "{ nope", "utf8");

    const result = await runLoam(root, "doctor", "--json");

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.healthy).toBe(false);
    expect(report.config.status).toBe("invalid");
    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: "blocker",
      code: "doctor.config-invalid",
    }));
  });

  it("blocks on a missing services directory but keeps landscape and binding gaps as warnings", async () => {
    const root = await makeTmpDir("loam-doctor-shape-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const docs = join(root, "docs");
    await mkdir(docs);
    await writeFile(join(root, "loam.json"), JSON.stringify({ docsDir: docs }) + "\n", "utf8");

    const result = await runLoam(root, "doctor", "--json");
    const report = JSON.parse(result.stdout);

    expect(result.code).toBe(1);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "blocker", code: "doctor.services-missing" }),
      expect.objectContaining({ severity: "warning", code: "doctor.landscape-missing" }),
      expect.objectContaining({ severity: "warning", code: "doctor.service-unbound" }),
    ]));
  });
});
