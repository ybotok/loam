/**
 * `loam gate --since <ref>` holds an archived feature to the feature that
 * SHIPPED — and a feature archived again ships again.
 *
 * Two fail-open paths the flag still had, both reproduced end to end on the
 * example fleet by review:
 *
 *  1. A record answering a checklist the feature had moved away from read
 *     `stale` in flight, and `verified` the moment its feature was archived:
 *     `verificationState` never marks an archived record stale (a checklist
 *     re-derived after the merge can only mismatch), so archiving stayed the
 *     cheapest way past the warning. `loam archive` now captures the checklist
 *     digest the feature asks at the merge into its snapshot manifest, and the
 *     gate holds the frozen record to it. `list` and the other readers still
 *     read an archived record as frozen history — test/list.test.ts pins that.
 *  2. A feature unarchived, edited and archived again sat at a path that
 *     existed at the ref, and was skipped as one an earlier deploy had
 *     shipped. An archive directory now counts as shipped by the ref only when
 *     its contents are what they were there — committed since or not.
 *
 * Plus the two edges: a record that matched at archive stays graded on its
 * merits, and an archive that captured no checklist (an older loam) is read
 * as frozen history and says so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFile, cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { citeable, coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";
import { featureChecklist } from "../src/core/verify/checklist.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));
const FEAT = "FEAT-101";
const FEAT_DIR = "features/FEAT-101-payment-splitting";
const ARCHIVED_DIR = "features/archive/FEAT-101-payment-splitting";

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", ["-c", "user.email=since@test.invalid", "-c", "user.name=Since Test", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

/** Stage and commit everything, then tag it — the docs commit a deploy recorded. */
function deploy(root: string, tag: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", `deploy ${tag}`);
  git(root, "tag", tag);
}

/** A byte copy of the shipped example docs repo at `<root>/fleet`, with the git root one level up. */
async function exampleFleet(): Promise<{ root: string; fleet: string }> {
  const root = await makeTmpDir("loam-gate-shipped-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fleet = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, fleet, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  return { root, fleet };
}

interface Run {
  code: number;
  out: string;
  payload: Record<string, any>;
}

async function loamJson(cwd: string, ...args: string[]): Promise<Run> {
  const res = await runLoam(cwd, ...args, "--json");
  return { code: res.code, out: res.out, payload: JSON.parse(res.stdout) as Record<string, any> };
}

function verificationFindings(payload: Record<string, any>): Array<Record<string, any>> {
  return payload.checks.find((c: { check: string }) => c.check === "verification").findings;
}

/**
 * FEAT-101 recorded `verified`, the way the review did it: every scenario
 * answered by a green runner-neutral report, every other claim by an agent
 * citing a real line of this repository.
 */
async function recordVerified(fleet: string): Promise<void> {
  const checklist = await featureChecklist(fleet as never, join(fleet, FEAT_DIR) as never, FEAT);
  const scenarios = checklist.claims.filter((c) => c.kind === "scenario.tested");
  await writeFile(
    join(fleet, "report.json"),
    JSON.stringify({ loamScenarioReport: 1, results: scenarios.map((c) => ({ digest: c.digest, status: "passed" })) }),
    "utf8",
  );
  await writeFile(join(fleet, "intent-proof.txt"), "proof\n", "utf8");
  await writeFile(
    join(fleet, "answers.json"),
    JSON.stringify(
      checklist.claims
        .filter((c) => c.kind !== "scenario.tested")
        .map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["intent-proof.txt:1"] })),
    ),
    "utf8",
  );
  const res = await loamJson(fleet, "verify", FEAT, "--results", "report.json", "--record", "answers.json");
  expect(res.code, res.out).toBe(0);
  expect(res.payload.verdict).toBe("verified");
  expect(res.payload.summary).toMatchObject({ claims: 19, confirmed: 19 });
}

/** A scenario appended to payment-service's requirement delta: a new claim, so a new checklist. */
async function appendScenario(fleet: string, dir: string, name: string): Promise<void> {
  await appendFile(
    join(fleet, dir, "specs/payment-service/spec.md"),
    `\n#### Scenario: ${name}\n- **Given** an order whose card the issuer declines\n- **When** authorization is requested\n- **Then** no funds are reserved and the reason is returned\n`,
    "utf8",
  );
}

describe("gate --since grades an archived record against the checklist it shipped with", () => {
  it("a record gone stale before the archive stays stale after it (the review's repro), and a re-archive is graded", async () => {
    const { root, fleet } = await exampleFleet();
    deploy(root, "R");

    // 1. FEAT-101 recorded verified, 19 of 19.
    await recordVerified(fleet);
    // 2. A scenario appended after the record was written.
    await appendScenario(fleet, FEAT_DIR, "A declined card releases nothing and reports the decline");
    // 3. In flight, the gate already says so.
    const inFlight = await loamJson(fleet, "gate", "--service", "payment-service", "--strict");
    expect(inFlight.payload.features).toEqual([expect.objectContaining({ id: FEAT, state: "stale", verdict: "unverified" })]);

    // 4. Archived, it used to read ["FEAT-101","recorded","verified","19/19"] with no finding.
    const archived = await runLoam(fleet, "archive", FEAT);
    expect(archived.code, archived.out).toBe(0);
    const manifest = JSON.parse(await readFile(join(fleet, ARCHIVED_DIR, ".loam-before/manifest.json"), "utf8"));
    expect(manifest.checklist).toMatch(/^[0-9a-f]{16}$/);
    // list keeps reading the frozen record as history, never stale.
    const listed = (await loamJson(fleet, "list", "features", "--archived")).payload.features.find(
      (f: { id: string }) => f.id === FEAT,
    );
    expect(listed.verification.state).toBe("recorded");

    const since = await loamJson(fleet, "gate", "--service", "payment-service", "--strict", "--since", "R");
    expect(since.payload.features).toEqual([
      expect.objectContaining({
        id: FEAT,
        archived: true,
        state: "stale",
        verdict: "unverified",
        claims: 19,
        confirmed: 19,
        checklistAtArchive: manifest.checklist,
      }),
    ]);
    const findings = verificationFindings(since.payload);
    expect(findings.map((f) => [f.severity, f.code, f.subject])).toEqual([["warn", "gate.feature-unverified", FEAT]]);
    expect(findings[0]!.message).toContain("archived after R");
    expect(findings[0]!.message).toContain("moved after its record was written");
    expect(findings[0]!.message).toContain(`\`loam unarchive ${FEAT}\``);

    // The re-archive: deployed as R2, then reopened, edited and shipped again
    // from the same features/archive/ path — left uncommitted, as a pipeline
    // gating its own working tree would see it.
    deploy(root, "R2");
    expect((await loamJson(fleet, "gate", "--service", "payment-service", "--since", "R2")).payload.features).toEqual([]);
    const reopened = await runLoam(fleet, "unarchive", FEAT);
    expect(reopened.code, reopened.out).toBe(0);
    await appendScenario(fleet, FEAT_DIR, "An expired card is refused before the issuer is asked");
    const again = await runLoam(fleet, "archive", FEAT);
    expect(again.code, again.out).toBe(0);
    // `git diff R2` sees the living spec move — and so does the gate now.
    expect(git(root, "diff", "--name-only", "R2", "--", "fleet/services/payment-service/spec.md")).not.toBe("");
    const rearchived = await loamJson(fleet, "gate", "--service", "payment-service", "--since", "R2");
    expect(rearchived.payload.features).toEqual([
      expect.objectContaining({ id: FEAT, archived: true, state: "stale", verdict: "unverified" }),
    ]);

    // Committed or not: once committed it is still a change since R2, and
    // against the commit that carries it, nothing has shipped since.
    deploy(root, "R3");
    expect((await loamJson(fleet, "gate", "--service", "payment-service", "--since", "R2")).payload.features).toEqual([
      expect.objectContaining({ id: FEAT, archived: true }),
    ]);
    expect((await loamJson(fleet, "gate", "--service", "payment-service", "--since", "R3")).payload.features).toEqual([]);
  });

  it("a feature unarchived, edited and archived again after the ref ships again — committed or not", async () => {
    // No record at all, so nothing here leans on the capture above: this is
    // the directory question alone. FEAT-1's archive directory exists at R.
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    git(p.docsDir, "init", "-q", "-b", "main");
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
    deploy(p.docsDir, "R");
    const gateSince = async (ref: string): Promise<Array<Record<string, unknown>>> =>
      (await loamJson(p.workDir, "gate", "--service", "payment-split-service", "--since", ref)).payload.features;
    expect(await gateSince("R")).toEqual([]);

    expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
    await p.write(
      "features/FEAT-1-split/specs/payment-split-service/spec.md",
      (await p.read("features/FEAT-1-split/specs/payment-split-service/spec.md")).replace(
        "two shares are recorded",
        "two shares are recorded and summed",
      ),
    );
    const again = await runLoam(p.workDir, "archive", "FEAT-1");
    expect(again.code, again.out).toBe(0);
    // Same path as at R, different contents, nothing committed yet.
    expect(await gateSince("R")).toEqual([expect.objectContaining({ id: "FEAT-1", archived: true, state: "absent" })]);

    deploy(p.docsDir, "R2");
    expect(await gateSince("R")).toEqual([expect.objectContaining({ id: "FEAT-1", archived: true })]);
    expect(await gateSince("R2")).toEqual([]);
  });

  it("a record that answered the feature at archive is graded on its merits, and an older archive says what it could not check", async () => {
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    await citeable(p.workDir, "src/split/Service.ts:12");
    git(p.docsDir, "init", "-q", "-b", "main");
    deploy(p.docsDir, "R");

    // Agent-answered throughout: complete, current, and attested — not stale.
    const checklist = JSON.parse((await runLoam(p.workDir, "verify", "FEAT-1", "--json")).stdout);
    const answers = checklist.claims.map((c: { id: string }) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] }));
    await writeFile(join(p.workDir, "answers.json"), JSON.stringify(answers), "utf8");
    expect((await runLoam(p.workDir, "verify", "FEAT-1", "--record", "answers.json")).code).toBe(0);
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);

    const graded = await loamJson(p.workDir, "gate", "--service", "payment-split-service", "--since", "R");
    expect(graded.payload.features).toEqual([
      expect.objectContaining({ id: "FEAT-1", archived: true, state: "recorded", verdict: "attested", checklistAtArchive: checklist.digest }),
    ]);
    expect(verificationFindings(graded.payload).map((f) => f.code)).toEqual(["verify.scenario-attested"]);

    // The same archive as a loam that captured nothing would have left it.
    const manifestPath = "features/archive/FEAT-1-split/.loam-before/manifest.json";
    const { checklist: _captured, ...older } = JSON.parse(await p.read(manifestPath)) as Record<string, unknown>;
    await p.write(manifestPath, JSON.stringify(older, null, 2) + "\n");
    const frozen = await loamJson(p.workDir, "gate", "--service", "payment-split-service", "--since", "R");
    expect(frozen.payload.features).toEqual([
      expect.objectContaining({ id: "FEAT-1", archived: true, state: "recorded", checklistAtArchive: null }),
    ]);
    const text = await runLoam(p.workDir, "gate", "--service", "payment-split-service", "--since", "R");
    expect(text.stdout).toContain("its archive captured no checklist");
  });
});
