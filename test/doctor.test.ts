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

  it("prints the fix under every finding in the human view", async () => {
    // A diagnostic that names a problem without naming its fix is a diagnostic
    // the reader has to go research — and doctor is what someone runs BECAUSE
    // they do not yet know what loam wants from them.
    const root = await makeTmpDir("loam-doctor-fix-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const docs = join(root, "docs");
    await mkdir(docs);
    await writeFile(join(root, "loam.json"), JSON.stringify({ docsDir: "./docs" }) + "\n", "utf8");

    const result = await runLoam(root, "doctor");

    expect(result.code).toBe(1);
    const lines = result.out.split("\n");
    const findingLines = lines.filter((l) => /^ {4}[✗⚠] /.test(l));
    expect(findingLines.length).toBeGreaterThan(0);
    // every finding line is followed by its fix line
    for (const line of findingLines) {
      const next = lines[lines.indexOf(line) + 1];
      expect(next, line).toMatch(/^ {6}fix: \S/);
    }
    expect(result.out).toContain("loam init --docs");
  });

  it("carries a fix in the --json contract too, not only in the prose view", async () => {
    const root = await makeTmpDir("loam-doctor-fix-json-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const report = JSON.parse((await runLoam(root, "doctor", "--json")).stdout);

    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(typeof finding.fix, finding.code).toBe("string");
      expect(finding.fix.length, finding.code).toBeGreaterThan(0);
    }
  });
});

/**
 * doctor and status answering the same question the same way.
 *
 * Two commands read one repository and only one of them was looking at it. In a
 * service repo bound to a service nobody had adopted — a freshly wired one, the
 * most common repo there is — `doctor` said `doctor.service-unknown` and
 * `status` said `next.fleet-clean`: "nothing is in flight and every service is
 * written down", vacuously true over a fleet of zero. The documented agent loop
 * reads `status --json` and runs `next[0]`, so an agent following it was sent to
 * start a feature instead of adopting the service under its feet.
 */
describe("status and doctor agree about the repo they are standing in", () => {
  it("surfaces an unadopted binding as next[0], the same state doctor blocks on", async () => {
    // The fleet is empty and this repo says it is 'obm-message-rest-api'.
    const project = await makeProject({}, { service: "obm-message-rest-api" });
    cleanups.push(() => project.destroy());
    await mkdir(join(project.docsDir, "services"), { recursive: true });
    await mkdir(join(project.docsDir, "features"), { recursive: true });

    const status = JSON.parse((await runLoam(project.workDir, "status", "--json")).stdout);
    expect(status.next[0].code).toBe("next.adopt-bound");
    expect(status.next[0].service).toBe("obm-message-rest-api");
    expect(status.next[0].command).toBe("loam adopt --service obm-message-rest-api --json");
    // and the claim that made the old answer wrong is gone
    expect(status.next.map((s: { code: string }) => s.code)).not.toContain("next.fleet-clean");

    // the other command, at the same moment, on the same repo
    const doctor = JSON.parse((await runLoam(project.workDir, "doctor", "--json")).stdout);
    expect(doctor.findings.map((f: { code: string }) => f.code)).toContain("doctor.service-unknown");
  });

  it("says nothing about the binding once that service is adopted", async () => {
    const project = await makeProject(coherentFixture(), { service: "payment-service" });
    cleanups.push(() => project.destroy());

    const status = JSON.parse((await runLoam(project.workDir, "status", "--json")).stdout);
    expect(status.next.map((s: { code: string }) => s.code)).not.toContain("next.adopt-bound");
  });

  it("leaves an explicit --service view alone — that is a question about a different service", async () => {
    const project = await makeProject(coherentFixture(), { service: "not-adopted-yet" });
    cleanups.push(() => project.destroy());

    const narrowed = JSON.parse(
      (await runLoam(project.workDir, "status", "--service", "payment-service", "--json")).stdout,
    );
    expect(narrowed.next.map((s: { code: string }) => s.code)).not.toContain("next.adopt-bound");
    // unnarrowed, the same repo does say it
    const fleet = JSON.parse((await runLoam(project.workDir, "status", "--json")).stdout);
    expect(fleet.next[0].code).toBe("next.adopt-bound");
  });

  it("does not ask the docs repo to bind itself to a service", async () => {
    // In the docs repo, having no `service` is the correct state: it is the
    // fleet, not any one service. doctor knew where it was standing (it prints
    // the fleet count) and warned anyway, under a `fix` — `loam init --service
    // <id>` here — that would have made the repo wrong.
    const root = await makeTmpDir("loam-doctor-docsrepo-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await runLoam(root, "init", "--docs", ".", "--create");

    const report = JSON.parse((await runLoam(root, "doctor", "--json")).stdout);
    const codes = report.findings.map((f: { code: string }) => f.code);
    expect(codes).not.toContain("doctor.service-unbound");
    // the envelope still reports the fact, it is only the advice that is gone
    expect(report.currentService).toEqual({ configured: null, status: "unbound" });
    // and a service repo with no binding is still told
    const svc = await makeProject(coherentFixture(), {});
    cleanups.push(() => svc.destroy());
    const svcReport = JSON.parse((await runLoam(svc.workDir, "doctor", "--json")).stdout);
    expect(svcReport.findings.map((f: { code: string }) => f.code)).toContain("doctor.service-unbound");
  });
});

/**
 * A version-2 journal — the record the smaller transaction (rebase, vouch,
 * new, gherkin) writes before its first rename — as a killed run leaves it.
 *
 * Written by hand rather than by killing a real commit because the question
 * under test is what `doctor` READS off it; test/staging-txn.test.ts and the
 * per-writer crash suites own the other half, that the writers put it there
 * and recover from it. The digests are syntactically real (that is what the
 * strict reader checks) and belong to no file: nothing here repairs anything.
 */
const INTERRUPTED_VOUCH = {
  version: 2,
  command: "vouch",
  rerun: "loam vouch --service payment-service --yes",
  target: "payment-service",
  pid: 4242,
  host: "build-box",
  at: "2026-08-01T10:00:00.000Z",
  files: [
    {
      path: "services/payment-service/spec.md",
      before: "a".repeat(64),
      after: "b".repeat(64),
      tmp: "services/payment-service/.spec.md.loam-4242-0-1754042400000.tmp",
    },
  ],
};

describe("an interrupted commit's own record names its repair", () => {
  it("prints the stored rerun verbatim as the fix, rather than guessing at a command", async () => {
    // The `rerun` is journal DATA, so agent-commands-runnable.test.ts cannot
    // see it and cannot check it parses — test/staging-txn.test.ts parses every
    // writer's template against the real CLI instead. What is checked here is
    // that `doctor` prints THAT string and not one it composed itself: version
    // 1's `loam <command> <feature>` form yields `loam vouch payment-service`,
    // which the CLI refuses.
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    await project.write(".loam-commit", JSON.stringify(INTERRUPTED_VOUCH, null, 2) + "\n");

    const result = await runLoam(project.workDir, "doctor", "--json");
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.healthy).toBe(false);
    const finding = report.findings.find((f: { code: string }) => f.code === "doctor.commit-interrupted");
    expect(finding, result.stdout).toBeDefined();
    expect(finding.severity).toBe("blocker");
    expect(finding.fix).toContain(INTERRUPTED_VOUCH.rerun);
    // Who, when and which files — what a human places the crash against.
    expect(finding.message).toContain("build-box");
    expect(finding.message).toContain("4242");
    expect(finding.message).toContain("services/payment-service/spec.md");
    // And it is graded as a record loam UNDERSTANDS: the v1 reader rejects the
    // version field, and a v2 record mis-graded `commit-unreadable` would send
    // its reader to a human instead of to the one-command repair.
    expect(report.findings.map((f: { code: string }) => f.code)).not.toContain("doctor.commit-unreadable");
    expect(report.writePath.intent).toMatchObject({ version: 2, rerun: INTERRUPTED_VOUCH.rerun });
    expect(report.writePath.intentUnreadable).toBe(false);
  });

  it("names the writer and its target in the human view too", async () => {
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    await project.write(".loam-commit", JSON.stringify(INTERRUPTED_VOUCH, null, 2) + "\n");

    const result = await runLoam(project.workDir, "doctor");
    expect(result.code).toBe(1);
    expect(result.out).toContain("interrupted vouch of payment-service");
    expect(result.out).toContain(INTERRUPTED_VOUCH.rerun);
  });
});
