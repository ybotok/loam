/**
 * `verified` means a run of THE scenario the claim stamped — not a tag.
 *
 * The digest is the identity a report is matched on, and a tag is only text:
 * a one-step stub named "a step" carrying the right `@loam-digest-…` confirmed
 * five-step scenarios, because nothing compared what ran with what was
 * stamped. And the path a fleet without cucumber takes to `verified` — loam's
 * own runner-neutral shape — was named nowhere a user looks first: `verify
 * --help`, WORKFLOW, the implement protocol and the `done.check` a work packet
 * prints all said "cucumber", and a JUnit XML report died on a raw JSON parse
 * error. Separately, the all-at-once `--record` accepted `src/foo.py:1` for a
 * file that does not exist, while `--service` refused the same citation.
 * Pinned here:
 *
 *  - a cucumber run must have run the stamped scenario's step count; a stub
 *    stays unconfirmed, saying why;
 *  - cucumber-js's hidden Before/After hook entries are hooks, not steps —
 *    they neither inflate the count nor hide a failure;
 *  - loam's own shape, which carries no steps, is held to its status alone;
 *  - a report that is not JSON is refused naming both accepted shapes;
 *  - the runner-neutral shape is named on every surface that names cucumber;
 *  - the all-at-once form refuses a citation to a line that does not exist.
 */
import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { buildProgram } from "../src/cli.js";
import { PROTOCOLS } from "../src/core/agent/protocol.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { citeable, coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { FEAT, RECORD, SPLIT } from "./helpers/federated.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A feature whose checklist is one five-step scenario and nothing else, so `--results` alone may answer it. */
const FIVE_STEPS = `# payment-split-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **And** two payees
- **When** it is split 60/40
- **Then** two shares are recorded
- **And** they sum to the total
`;

async function project(): Promise<Project> {
  const p = await makeProject({
    "features/FEAT-1-split/specs/payment-split-service/spec.md": FIVE_STEPS,
    "features/FEAT-1-split/intent.md": "---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Split payments\n",
  });
  cleanups.push(() => p.destroy());
  return p;
}

const DIGEST = scenarioDigest(SPLIT, parseRequirements(FIVE_STEPS)[0]!.scenarios[0]!.lines);

/** One cucumber element carrying the scenario's digest, with the given step entries. */
async function report(p: Project, steps: unknown[]): Promise<string> {
  const doc = [
    {
      uri: "features/loam/split-a-payment.feature",
      name: "Split a payment",
      elements: [{ name: "a step", type: "scenario", tags: [{ name: `@loam-digest-${DIGEST}` }], steps }],
    },
  ];
  await writeFile(join(p.workDir, "report.json"), JSON.stringify(doc), "utf8");
  return "report.json";
}

const passed = (keyword: string): unknown => ({ keyword, name: "a step", result: { status: "passed" } });

async function recordFrom(p: Project, file: string): Promise<{ code: number; json: Record<string, any> }> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--results", file, "--json");
  return { code: res.code, json: JSON.parse(res.stdout) as Record<string, any> };
}

describe("a cucumber run is held to the stamped scenario's step count", () => {
  it("a one-step stub carrying the right digest confirms nothing", async () => {
    const p = await project();
    const { code, json } = await recordFrom(p, await report(p, [passed("Given ")]));
    expect(code).toBe(0);
    expect(json.verdict).toBe("unverified");
    const claim = (parse(await p.read(RECORD)) as { claims: Array<Record<string, string>> }).claims[0]!;
    expect(claim["verdict"]).toBe("unconfirmed");
    expect(claim["answered_by"]).toBe("runner");
    expect(claim["note"]).toContain("ran 1 step(s) where the stamped scenario has 5");
  });

  it("the full run confirms — the count is the stamped scenario's, And-steps included", async () => {
    const p = await project();
    const steps = ["Given ", "And ", "When ", "Then ", "And "].map(passed);
    const { json } = await recordFrom(p, await report(p, steps));
    expect(json.verdict).toBe("verified");
  });

  it("cucumber-js's hidden hook entries are hooks: they do not count as steps", async () => {
    const p = await project();
    const hook = (keyword: string, status = "passed"): unknown => ({ keyword, hidden: true, result: { status } });
    const steps = [hook("Before"), ...["Given ", "And ", "When ", "Then ", "And "].map(passed), hook("After")];
    expect((await recordFrom(p, await report(p, steps))).json.verdict).toBe("verified");
  });

  it("and a failing hidden hook still sinks the run, named as a hook", async () => {
    const p = await project();
    const steps = [
      ...["Given ", "And ", "When ", "Then ", "And "].map(passed),
      { keyword: "After", hidden: true, result: { status: "failed" } },
    ];
    expect((await recordFrom(p, await report(p, steps))).json.verdict).toBe("unverified");
    const claim = (parse(await p.read(RECORD)) as { claims: Array<Record<string, string>> }).claims[0]!;
    expect(claim["note"]).toContain("failed in a before/after hook");
  });

  it("loam's runner-neutral shape carries no steps, so it is held to its status alone", async () => {
    const p = await project();
    await writeFile(
      join(p.workDir, "scenarios.json"),
      JSON.stringify({ loamScenarioReport: 1, results: [{ digest: DIGEST, status: "passed", test: "SplitTest#twoPayees" }] }),
      "utf8",
    );
    expect((await recordFrom(p, "scenarios.json")).json.verdict).toBe("verified");
  });
});

describe("a report that is not JSON", () => {
  it("is refused answers-unreadable, naming both shapes --results reads", async () => {
    const p = await project();
    await writeFile(
      join(p.workDir, "junit.xml"),
      '<?xml version="1.0"?>\n<testsuite name="split"><testcase name="twoPayees"/></testsuite>\n',
      "utf8",
    );
    const { code, json } = await recordFrom(p, "junit.xml");
    expect(code).toBe(1);
    expect(json.error.code).toBe("answers-unreadable");
    expect(json.error.message).toContain("junit.xml");
    expect(json.error.message).toContain("XML");
    expect(json.error.message).toContain("cucumber JSON");
    expect(json.error.message).toContain("loamScenarioReport");
    expect(p.exists(RECORD)).toBe(false);
  });
});

describe("the runner-neutral shape is named wherever cucumber is", () => {
  it("in verify --help", () => {
    const verify = buildProgram().commands.find((c) => c.name() === "verify")!;
    const results = verify.options.find((o) => o.long === "--results")!;
    expect(results.description).toContain("cucumber JSON");
    expect(results.description).toContain("loamScenarioReport");
  });

  it("in the implement protocol's recording step", () => {
    expect(PROTOCOLS["loam-implement"]).toContain("loamScenarioReport");
  });

  it("in the done.check a work packet prints for a scenario unit", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "tasks", FEAT, "--json");
    expect(res.code, res.out).toBe(0);
    const unit = (JSON.parse(res.stdout).units as Array<{ kind: string; done: { check: string } }>).find(
      (u) => u.kind === "scenario.tested",
    )!;
    expect(unit.done.check).toContain(`@loam-digest-${DIGEST}`);
    expect(unit.done.check).toContain("cucumber JSON");
    expect(unit.done.check).toContain("loamScenarioReport");
  });

  it("in the next.verify-attested step status prints, and in what `loam explain` says of it", async () => {
    // The canonical fleet rather than this file's feature-only one: `status`
    // reads a docs repo, and refuses one with no services/.
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    await citeable(p.workDir, "src/split.ts:3");
    const checklist = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout) as { claims: Array<{ id: string }> };
    await writeFile(
      join(p.workDir, "agent.json"),
      JSON.stringify(checklist.claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split.ts:3"] }))),
      "utf8",
    );
    expect((await runLoam(p.workDir, "verify", FEAT, "--record", "agent.json")).code).toBe(0);
    const status = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as {
      next: Array<{ code: string; statement: string; command: string }>;
    };
    const step = status.next.find((s) => s.code === "next.verify-attested")!;
    expect(step.statement).toContain("cucumber JSON");
    expect(step.statement).toContain("loamScenarioReport");
    // The runner-neutral placeholder, not `<cucumber-report.json>`.
    expect(step.command).toBe(`loam verify ${FEAT} --results <report.json>`);

    const explained = JSON.parse((await runLoam(p.workDir, "explain", "next.verify-attested", "--json")).stdout);
    expect(JSON.stringify(explained)).toContain("loamScenarioReport");
    expect(JSON.stringify(explained)).not.toContain("cucumber-report.json");
  });
});

describe("the all-at-once --record checks that each citation exists", () => {
  it("refuses a file:line that does not resolve in this repository, as --service does", async () => {
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    const checklist = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout) as { claims: Array<{ id: string }> };
    const answers = (evidence: string): string =>
      JSON.stringify(checklist.claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: [evidence] })));

    await writeFile(join(p.workDir, "fabricated.json"), answers("src/foo.py:1"), "utf8");
    const fabricated = await runLoam(p.workDir, "verify", FEAT, "--record", "fabricated.json", "--json");
    expect(fabricated.code).toBe(1);
    const err = JSON.parse(fabricated.stdout).error;
    expect(err.code).toBe("answers-unevidenced");
    expect(err.message).toContain("'src/foo.py' does not exist in this repository");
    // Named in the repository's spelling, never this machine's absolute path.
    expect(err.message).not.toContain(p.workDir);
    expect(p.exists(RECORD)).toBe(false);

    // A line past the end is no more a citation than a missing file.
    await citeable(p.workDir, "src/foo.py:3");
    await writeFile(join(p.workDir, "past.json"), answers("src/foo.py:9"), "utf8");
    const past = await runLoam(p.workDir, "verify", FEAT, "--record", "past.json", "--json");
    expect(JSON.parse(past.stdout).error.code).toBe("answers-unevidenced");

    // The same answers, citing a line that exists, record as before: the
    // form still binds to no commit and stamps no pins.
    await writeFile(join(p.workDir, "real.json"), answers("src/foo.py:3"), "utf8");
    const real = await runLoam(p.workDir, "verify", FEAT, "--record", "real.json", "--json");
    expect(real.code, real.out).toBe(0);
    expect((parse(await p.read(RECORD)) as Record<string, unknown>)["attestations"]).toBeUndefined();
  });

  it("checks only what is shaped like a path:line — prose, URLs and a path with no line record as before", async () => {
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    const checklist = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout) as { claims: Array<{ id: string }> };
    const answers = (evidence: string[]): string =>
      JSON.stringify(checklist.claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence })));

    // None of these names a line of a file, so none of them can be wrong about
    // one: the all-at-once form has always recorded them, and still does.
    const other = ["manual QA by Alice, 2026-10-09", "https://ci.example.test:8443/runs/41", "README.md", "checked at 10:30"];
    await writeFile(join(p.workDir, "other.json"), answers(other), "utf8");
    const recorded = await runLoam(p.workDir, "verify", FEAT, "--record", "other.json", "--json");
    expect(recorded.code, recorded.out).toBe(0);
    const claims = (parse(await p.read(RECORD)) as { claims: Array<{ evidence: string[] }> }).claims;
    expect(claims.every((c) => JSON.stringify(c.evidence) === JSON.stringify(other))).toBe(true);

    // Beside them, an entry that IS a citation is still held to its line —
    // including a badly made one the canonical form would not accept.
    for (const citation of ["src/missing.py:1", "src/x.py:0"]) {
      await writeFile(join(p.workDir, "mixed.json"), answers([...other, citation]), "utf8");
      const mixed = await runLoam(p.workDir, "verify", FEAT, "--record", "mixed.json", "--json");
      expect(mixed.code, citation).toBe(1);
      const err = JSON.parse(mixed.stdout).error as { code: string; message: string };
      expect(err.code, citation).toBe("answers-unevidenced");
      expect(err.message, citation).toContain(`'${citation}'`);
    }
  });
});
