/**
 * `loam verify --service` over a working tree that is not its HEAD
 * (src/commands/verify/evidence/worktree.ts).
 *
 * An attestation names `git rev-parse HEAD`, but the suite ran against the
 * working tree. A run over modified files and untracked directories recorded
 * "attested at <the pre-feature commit>" and `verified` without a word — a
 * record naming a commit that did not contain the code its report was about.
 *
 * The first step of the fix, pinned here: the record carries `dirty: true` and
 * the paths, the run warns (`verify.uncommitted-changes`), and `gate`,
 * `status` and the read view all say "+ uncommitted changes" — while what loam
 * itself writes or carries in the repository (the reports, the answers file,
 * the generated suite, an in-repo docs dir, loam.json) never trips it. Nothing
 * refuses yet: that is the second step, and a change to the exit contract.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { asVerification } from "../src/core/verify/read/shape.js";
import type { Verification } from "../src/core/verify/record.js";
import { loamCarried, uncommittedPaths } from "../src/commands/verify/evidence/worktree.js";
import { loadConfig } from "../src/core/envelope/config.js";
import { archivedVerification } from "../src/core/status/feature/words.js";
import type { VerificationState } from "../src/core/status/report.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam, FEATURE_SPEC, type Project } from "./helpers/harness.js";
import { answersFile, FEAT, PAYMENT, serviceClaims, serviceRecord, serviceRepo, SPLIT } from "./helpers/federated.js";

let project: Project | null = null;
afterEach(async () => {
  await project?.destroy();
  project = null;
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", ...args], { cwd });
}

/**
 * The service repo, one more committed source file (`app.ts`) for the tree to
 * move under, and a green loamScenarioReport answering its scenario claims —
 * so a clean run is `verified` and the only variable is the working tree.
 */
async function setUp(): Promise<{ p: Project; repo: string; answers: string }> {
  project = await makeProject(coherentFixture(), { service: SPLIT });
  const repo = await serviceRepo(project, SPLIT, "primary");
  await writeFile(join(repo, "app.ts"), "export const split = () => 2;\n", "utf8");
  git(repo, "add", "app.ts");
  git(repo, "commit", "-qm", "app");
  const digest = scenarioDigest(SPLIT, parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines, "business");
  await writeFile(
    join(repo, "report.json"),
    JSON.stringify({ loamScenarioReport: 1, results: [{ digest, status: "passed" }] }),
    "utf8",
  );
  const claims = await serviceClaims(project, SPLIT);
  const answers = await answersFile(repo, claims.filter((c) => c.kind !== "scenario.tested"));
  return { p: project, repo, answers };
}

async function recordRun(p: Project, answers: string, json = true): Promise<{ code: number; out: string; stdout: string }> {
  const flags = ["verify", FEAT, "--service", SPLIT, "--results", "report.json", "--record", answers];
  return runLoam(p.workDir, ...flags, ...(json ? ["--json"] : []));
}

async function written(p: Project): Promise<Verification> {
  return parse(await readFile(join(p.docsDir, serviceRecord(SPLIT)), "utf8")) as Verification;
}

interface Notice {
  code: string;
  message: string;
}

describe("verify --service --results over uncommitted changes", () => {
  it("a clean tree records as it always has — loam's own inputs and the generated suite do not count", async () => {
    const { p, repo, answers } = await setUp();
    // Untracked, and all loam's: the report and the answers file (written by
    // setUp) and the suite `loam gherkin` would have written.
    await mkdir(join(repo, "features", "loam"), { recursive: true });
    await writeFile(join(repo, "features", "loam", "split.feature"), "Feature: split\n", "utf8");

    const run = await recordRun(p, answers);
    expect(run.code, run.out).toBe(0);
    const payload = JSON.parse(run.stdout) as { notices?: Notice[] };
    expect((payload.notices ?? []).map((n) => n.code)).not.toContain("verify.uncommitted-changes");
    const attestation = (await written(p)).attestations![0]!;
    expect(attestation.dirty).toBeUndefined();
    expect(attestation.uncommitted).toBeUndefined();
  });

  it("records dirty: true and the paths, warns, and still records — the second step, refusing, is not taken", async () => {
    const { p, repo, answers } = await setUp();
    await writeFile(join(repo, "app.ts"), "export const split = () => 3;\n", "utf8");
    await mkdir(join(repo, "src", "split"), { recursive: true });
    await writeFile(join(repo, "src", "split", "payee.ts"), "export const payee = 1;\n", "utf8");

    const run = await recordRun(p, answers);
    expect(run.code, run.out).toBe(0);
    const payload = JSON.parse(run.stdout) as {
      notices?: Notice[];
      attestations: { service: string; dirty?: boolean; uncommitted?: string[] }[];
    };
    // Recorded all the same: the evidence is what it is. What changed is that
    // the record no longer lets the commit it names pass for the tested code.
    const notice = (payload.notices ?? []).find((n) => n.code === "verify.uncommitted-changes");
    expect(notice?.message).toContain("app.ts");
    expect(notice?.message).toContain("src/");
    expect(payload.attestations[0]).toMatchObject({ service: SPLIT, dirty: true, uncommitted: ["app.ts", "src/"] });

    const attestation = (await written(p)).attestations![0]!;
    expect(attestation.dirty).toBe(true);
    expect(attestation.uncommitted).toEqual(["app.ts", "src/"]);

    const text = await recordRun(p, answers, false);
    expect(text.out).toMatch(/attested at git commit [0-9a-f]{40} \+ uncommitted changes\./);
    expect(text.out).toContain("⚠ verify.uncommitted-changes:");
  });

  it("gate, status and the read view carry it beside the verdict", async () => {
    const { p, repo, answers } = await setUp();
    // payment-service answers its own claim from a clean repo of its own, so
    // the feature is complete and the one dirty attestation is SPLIT's.
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    const paymentAnswers = await answersFile(paymentRepo, await serviceClaims(p, PAYMENT));
    const clean = await runLoam(paymentRepo, "verify", FEAT, "--service", PAYMENT, "--record", paymentAnswers, "--json");
    expect(clean.code, clean.out).toBe(0);
    await writeFile(join(repo, "app.ts"), "export const split = () => 3;\n", "utf8");
    const dirty = await recordRun(p, answers);
    expect(dirty.code, dirty.out).toBe(0);
    expect((JSON.parse(dirty.stdout) as { verdict: string }).verdict).toBe("verified");

    // The gate answers for an adopted service; the fixture's feature is the
    // one that introduces this one, so give it a living spec to stand on.
    await p.write(`services/${SPLIT}/spec.md`, `---\nservice: ${SPLIT}\nstatus: draft\nowner: payments-team\n---\n\n# ${SPLIT}\n`);
    const gate = await runLoam(p.workDir, "gate", "--json");
    const row = (JSON.parse(gate.stdout) as { features?: { id: string; verdict: string; uncommitted?: string[] }[] })
      .features?.find((f) => f.id === FEAT);
    expect(row, gate.out).toMatchObject({ verdict: "verified", uncommitted: [SPLIT] });
    expect((await runLoam(p.workDir, "gate")).out).toContain(`${FEAT} · verified + uncommitted changes (${SPLIT})`);

    const status = await runLoam(p.workDir, "status", FEAT, "--json");
    expect((JSON.parse(status.stdout) as { verification: { uncommitted?: string[] } }).verification.uncommitted).toEqual([SPLIT]);
    const statusText = (await runLoam(p.workDir, "status", FEAT)).out;
    expect(statusText).toContain(`verified + uncommitted changes (${SPLIT})`);

    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect((JSON.parse(read.stdout) as { notices?: Notice[] }).notices?.map((n) => n.code)).toContain(
      "verify.uncommitted-changes",
    );
    expect((await runLoam(p.workDir, "verify", FEAT)).out).toContain("+ uncommitted changes (");
  });

  it("a clean re-record clears it — the flag describes one attestation, not the feature forever", async () => {
    const { p, repo, answers } = await setUp();
    await writeFile(join(repo, "app.ts"), "export const split = () => 3;\n", "utf8");
    expect((await recordRun(p, answers)).code).toBe(0);
    git(repo, "commit", "-qam", "the tested code");
    expect((await recordRun(p, answers)).code).toBe(0);
    expect((await written(p)).attestations![0]!.dirty).toBeUndefined();
    const status = await runLoam(p.workDir, "status", FEAT, "--json");
    expect((JSON.parse(status.stdout) as { verification: { uncommitted?: string[] } }).verification.uncommitted).toBeUndefined();
  });
});

describe("what the check leaves out, and how a record holding the flag is read", () => {
  it("an in-repo docs dir, loam.json and the suite are loam's; anything else under the root is not", async () => {
    const repo = await makeTmpDir();
    git(repo, "init", "-q");
    await writeFile(join(repo, "keep.ts"), "x\n", "utf8");
    git(repo, "add", "keep.ts");
    git(repo, "commit", "-qm", "base");
    await writeFile(join(repo, "loam.json"), JSON.stringify({ docsDir: "docs", service: SPLIT, gherkinDir: "tests" }), "utf8");
    await mkdir(join(repo, "docs", "features"), { recursive: true });
    await writeFile(join(repo, "docs", "features", "x.md"), "# x\n", "utf8");
    await mkdir(join(repo, "tests", "loam"), { recursive: true });
    await writeFile(join(repo, "tests", "loam", "a.feature"), "Feature: a\n", "utf8");
    const load = await loadConfig(repo);
    if (load.kind !== "loaded") throw new Error(`fixture config did not load: ${load.kind}`);
    const carried = loamCarried(load.config, repo);
    expect(await uncommittedPaths(repo, carried, { reports: {} })).toEqual([]);
    // A file beside the suite, not in it, is code — and git names the
    // untracked directory that holds it, as it does for any untracked tree.
    await writeFile(join(repo, "tests", "unit.ts"), "t\n", "utf8");
    expect(await uncommittedPaths(repo, carried, { reports: {} })).toEqual(["tests/"]);
  });

  it("an untracked file counts even where git is configured to hide untracked files", async () => {
    // `status.showUntrackedFiles=no` is a common speed setting in a large
    // monorepo, and porcelain v1 obeys it: the check read a tree of new,
    // untracked code as clean — the exact case it exists for.
    const repo = await makeTmpDir();
    git(repo, "init", "-q");
    git(repo, "config", "status.showUntrackedFiles", "no");
    await writeFile(join(repo, "keep.ts"), "x\n", "utf8");
    git(repo, "add", "keep.ts");
    git(repo, "commit", "-qm", "base");
    await mkdir(join(repo, "src", "split"), { recursive: true });
    await writeFile(join(repo, "src", "split", "payee.ts"), "export const payee = 1;\n", "utf8");
    expect(await uncommittedPaths(repo, [], { reports: {} })).toEqual(["src/"]);
  });

  it("an archived feature's headline keeps the flag the gate's archived row shows", () => {
    const state: VerificationState = {
      state: "recorded",
      recorded: "2026-10-30",
      verdict: "verified",
      claims: 3,
      confirmed: 3,
      unconfirmed: 0,
      unanswered: 0,
      attested: 0,
      answered: { runner: 1, "external-runner": 0, agent: 2 },
      uncommitted: [SPLIT],
    };
    expect(archivedVerification(state)).toBe(`verified + uncommitted changes (${SPLIT}) (3 of 3 claim(s) confirmed)`);
    const { uncommitted: _, ...clean } = state;
    expect(archivedVerification(clean)).toBe("verified (3 of 3 claim(s) confirmed)");
  });

  it("a `dirty` that is not a boolean makes the record unreadable rather than clean", async () => {
    const { p, repo, answers } = await setUp();
    await writeFile(join(repo, "app.ts"), "export const split = () => 3;\n", "utf8");
    expect((await recordRun(p, answers)).code).toBe(0);
    const record = await written(p);
    expect(asVerification(record)).not.toBeNull();
    expect(asVerification({ ...record, attestations: [{ ...record.attestations![0]!, dirty: "yes" }] })).toBeNull();
    expect(asVerification({ ...record, attestations: [{ ...record.attestations![0]!, uncommitted: "app.ts" }] })).toBeNull();
  });
});
