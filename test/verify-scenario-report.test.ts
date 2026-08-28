/**
 * `{"loamScenarioReport": 1, …}` — the runner-neutral answer sheet for
 * `scenario.tested` claims.
 *
 * `loam gherkin` stamps every generated scenario `@loam-digest-<16hex>`, and
 * until this shape existed only cucumber's JSON carried that tag back. A fleet
 * on JUnit, pytest, Playwright, Vitest or a house runner could therefore never
 * reach `verified` — not because its evidence was weaker, but because of a file
 * format. The product's own shipped example is the proof of what that cost:
 * every claim in `FEAT-088`'s record is `answered_by: agent`.
 *
 * The property under test is that the STANDARD OF PROOF did not move. An answer
 * from this file is `answered_by: runner`, identical to a cucumber one, because
 * the contract was never the dialect — it is the content-derived digest plus a
 * status saying a real run reported it green. So the two assertions that matter
 * are: a passing entry reads exactly as cucumber does, and a `failed` entry
 * still refuses. The third group is the refusals, which is where a format that
 * guesses would quietly turn a scenario nobody ran into a confirmation.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import type { Verification } from "../src/core/verify/record.js";
import {
  coherentFixture,
  makeProject,
  runLoam,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";
import { answersFile, FEAT, RECORD, serviceClaims, serviceRepo, SPLIT } from "./helpers/federated.js";

let project: Project | null = null;
afterEach(async () => {
  await project?.destroy();
  project = null;
});

/** The digest `loam gherkin` stamps on the fixture feature's first scenario. */
function fixtureDigest(): string {
  return scenarioDigest(SPLIT, parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines, "business");
}

async function withReport(body: unknown): Promise<{ code: number; out: string; stdout: string; p: Project }> {
  project = await makeProject(coherentFixture(), { service: SPLIT });
  const repo = await serviceRepo(project, SPLIT, "primary");
  await writeFile(join(repo, "report.json"), JSON.stringify(body), "utf8");
  const claims = await serviceClaims(project, SPLIT);
  const answers = await answersFile(repo, claims.filter((c) => c.kind !== "scenario.tested"));
  const run = await runLoam(
    project.workDir, "verify", FEAT, "--service", SPLIT,
    "--results", "report.json", "--record", answers, "--json",
  );
  return { ...run, p: project };
}

describe("the loamScenarioReport answer sheet", () => {
  it("confirms a claim as `runner`, exactly as a cucumber report does", async () => {
    const { code, out, p } = await withReport({
      loamScenarioReport: 1,
      results: [{ digest: fixtureDigest(), status: "passed", test: "SplitPaymentTest#acrossTwoPayees" }],
    });
    expect(code, out).toBe(0);

    const record = parse(await readFile(join(p.docsDir, RECORD), "utf8")) as Verification;
    const scenario = record.claims.filter((c) => c.kind === "scenario.tested");
    expect(scenario.length).toBeGreaterThan(0);
    const confirmed = scenario.filter((c) => c.verdict === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    // THE assertion. Not `agent`, not a third value: the same claim answered to
    // the same standard by the same identity as a cucumber run.
    for (const c of confirmed) expect(c.answered_by).toBe("runner");
    // The runner's own name for the test is what a reader follows to the run.
    expect(confirmed[0]!.evidence.join(" ")).toContain("SplitPaymentTest#acrossTwoPayees");
  });

  it("refuses to confirm a failed entry", async () => {
    const { code, out, p } = await withReport({
      loamScenarioReport: 1,
      results: [{ digest: fixtureDigest(), status: "failed", test: "SplitPaymentTest#acrossTwoPayees" }],
    });
    expect(code, out).toBe(0);
    const record = parse(await readFile(join(p.docsDir, RECORD), "utf8")) as Verification;
    const scenario = record.claims.filter((c) => c.kind === "scenario.tested");
    expect(scenario.every((c) => c.verdict === "unconfirmed")).toBe(true);
  });

  it("refuses a status that is neither passed nor failed", async () => {
    // The failure this guards: a runner that reports `skipped` for a scenario
    // nobody executed. Guessing it green is how a not-run scenario becomes a
    // confirmation; guessing it red would be equally invented. It is refused.
    const { code, out } = await withReport({
      loamScenarioReport: 1,
      results: [{ digest: fixtureDigest(), status: "skipped" }],
    });
    expect(code).toBe(1);
    expect(out).toContain("passed");
    expect(out).toContain("did not run");
  });

  it("refuses a malformed digest, and a wrong version, as its OWN shape", async () => {
    const bad = await withReport({ loamScenarioReport: 1, results: [{ digest: "nope", status: "passed" }] });
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("16 lowercase hex");
    await project?.destroy();
    project = null;

    const future = await withReport({ loamScenarioReport: 99, results: [] });
    expect(future.code).toBe(1);
    // Not "this is not a cucumber array": a file that claims the shape is
    // graded as that shape, or the author is told about the wrong mistake.
    expect(future.out).toContain("loamScenarioReport");
    expect(future.out).not.toContain("cucumber");
  });
});
