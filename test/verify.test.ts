/**
 * Tests for `loam verify` (src/commands/verify.ts, src/core/verify.ts) — the
 * done-check.
 *
 * The original design was to extract C4 from the built code and assert it equals
 * the delta. That died with the extractor: two generated models of the same code
 * differ in wording every run, so the diff would flap, and a check that cries
 * wolf gets switched off inside a week.
 *
 * So the determinism moves from the ANSWER to the QUESTION. loam derives a
 * checklist from the feature's own artifacts — the same files `validate` already
 * reads, no new parsing of code — and an agent answers each claim with evidence.
 * That only works if the question set is stable, so the invariants worth pinning
 * are the ones that make an answer mean something later:
 *
 *  - a claim's id is a function of the claim, not of the run: two runs are
 *    diffable, reordering the delta renames nothing, and REWORDING a scenario
 *    does rename its claim — title or body — an answer about text nobody wrote
 *    must not carry over as if it were still true;
 *  - an ARCHIVED feature's record is frozen history: archive merged the
 *    feature's ops into the living openapi, so a re-derived checklist would
 *    shrink and read a faithful record as stale forever — verify renders the
 *    record verbatim instead, and refuses --record;
 *  - `--record` refuses anything that does not correspond to the current
 *    checklist. An unknown id, an unanswered claim, a "yes" with no evidence:
 *    each is a way an unchecked claim could masquerade as checked, which is the
 *    single failure that would make the whole artifact worthless;
 *  - the record is a durable file in the feature directory, so it travels into
 *    `features/archive/` and reads without loam;
 *  - and it does not gate. Archive refuses an incoherent feature because loam
 *    COMPUTED the incoherence; a verdict is only as good as whoever wrote it,
 *    and a gate in front of shipping is an invitation to rubber-stamp it.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { scenarioDigest } from "../src/core/gherkin.js";
import { parseRequirements } from "../src/core/spec.js";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  treeHashes,
  FEATURE_SPEC,
  LIVING_SPEC,
  type Project,
} from "./helpers/harness.js";

const FEAT = "FEAT-1";
const DIR = "features/FEAT-1-split";
const RECORD = `${DIR}/verification.yaml`;
const SPLIT = "payment-split-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string> = coherentFixture()): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

interface Claim {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: string;
}

/** The checklist as the machine contract. */
async function checklist(p: Project, feature = FEAT): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "verify", feature, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
}

async function claims(p: Project, feature = FEAT): Promise<Claim[]> {
  return (await checklist(p, feature)).claims;
}

const kinds = (cs: Claim[]): string[] => cs.map((c) => c.kind);
const ids = (cs: Claim[]): string[] => cs.map((c) => c.id).sort();
const of = (cs: Claim[], kind: string): Claim[] => cs.filter((c) => c.kind === kind);

/** Write an answers file into the working repo and return the path to pass. */
async function writeAnswers(p: Project, answers: unknown, name = "answers.json"): Promise<string> {
  await writeFile(join(p.workDir, name), JSON.stringify({ answers }, null, 2), "utf8");
  return name;
}

/** Confirm every claim, with one line of evidence each. */
async function confirmAll(p: Project, feature = FEAT): Promise<string> {
  const cs = await claims(p, feature);
  return writeAnswers(
    p,
    cs.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] })),
  );
}

/* --- the runner's side: cucumber reports ---------------------------- */

/** The digest the emitter stamps for scenario `sc` of requirement `req` in a spec source. */
function digestOf(spec: string, req = 0, sc = 0): string {
  return scenarioDigest(parseRequirements(spec)[req]!.scenarios[sc]!.lines);
}

interface Run {
  digest?: string;
  name?: string;
  steps?: string[];
}

/** A standard cucumber JSON report: one feature, one element per run — extra fields included on purpose. */
function cucumberReport(runs: Run[], uri = "features/loam/split-a-payment.feature"): unknown {
  return [
    {
      uri,
      name: "Split a payment",
      keyword: "Feature",
      elements: runs.map((r) => ({
        name: r.name ?? "Split across two payees",
        type: "scenario",
        tags: [
          { name: "@FEAT-1", line: 2 },
          ...(r.digest === undefined ? [] : [{ name: `@loam-digest-${r.digest}` }]),
        ],
        steps: (r.steps ?? ["passed", "passed", "passed"]).map((status) => ({
          keyword: "Then ",
          result: { status, duration: 1 },
        })),
      })),
    },
  ];
}

async function writeReport(p: Project, runs: Run[], name = "report.json"): Promise<string> {
  await writeFile(join(p.workDir, name), JSON.stringify(cucumberReport(runs)), "utf8");
  return name;
}

/** A feature whose checklist is ALL scenario claims: one spec delta, two scenarios, nothing else. */
const SCENARIOS_ONLY = `# payment-split-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded

#### Scenario: Reject a split that does not sum
- **When** shares do not sum to the total
- **Then** the split is rejected
`;

const ARCH_ONLY = `# payment-split-service — arch delta for FEAT-1

## ADDED Requirements

### Requirement: Retries stay idempotent
The service SHALL apply createSplit idempotently under retry.

#### Scenario: Duplicate delivery
- **WHEN** the same split arrives twice
- **THEN** exactly one split is recorded
`;

function scenarioOnlyFixture(): Record<string, string> {
  return {
    "features/FEAT-1-split/specs/payment-split-service/spec.md": SCENARIOS_ONLY,
    "features/FEAT-1-split/intent.md": "---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Split payments\n",
  };
}

/* ------------------------------------------------------------------ */

describe("what the checklist asks about", () => {
  it("asks that every operation the feature adds is exposed", async () => {
    const p = await project();
    const cs = of(await claims(p), "api.exposes");
    expect(cs).toHaveLength(1);
    expect(cs[0]!.subject).toBe(SPLIT);
    expect(cs[0]!.claim).toContain("createSplit");
  });

  it("does not ask about an operation the living OpenAPI already defines", async () => {
    // A delta's openapi.yaml is a whole document, not a patch: authors restate the
    // living API in it. Only what is NEW is work this feature has to have done.
    const files = coherentFixture();
    files[`services/${SPLIT}/openapi.yaml`] = files[`${DIR}/specs/${SPLIT}/openapi.yaml`]!;
    const p = await project(files);
    expect(of(await claims(p), "api.exposes")).toEqual([]);
  });

  it("asks that every tagged edge carrying an operation is really called", async () => {
    const p = await project();
    const cs = of(await claims(p), "c4.calls");
    expect(cs).toHaveLength(1);
    // the claim names both ends and the operation — it is answerable without the delta
    expect(cs[0]!.claim).toContain("payment-service");
    expect(cs[0]!.claim).toContain(SPLIT);
    expect(cs[0]!.claim).toContain("createSplit");
    // it is a question about the CALLER's code, so that is the service it is filed under
    expect(cs[0]!.subject).toBe("payment-service");
  });

  it("ignores an edge with no operation link — there is nothing specific to look for", async () => {
    const files = coherentFixture();
    files[`${DIR}/delta.likec4`] = files[`${DIR}/delta.likec4`]!.replace(
      "    metadata { op 'createSplit' }\n",
      "",
    );
    const p = await project(files);
    expect(of(await claims(p), "c4.calls")).toEqual([]);
  });

  it("asks that every new service exists", async () => {
    const p = await project();
    const cs = of(await claims(p), "service.exists");
    expect(cs).toHaveLength(1);
    expect(cs[0]!.subject).toBe(SPLIT);
  });

  it("does not ask about an element the delta only draws for context", async () => {
    // Untagged elements are the diagram's furniture — payment-service already
    // exists, and asking whether it exists teaches the agent the checklist is noise.
    const p = await project();
    expect(of(await claims(p), "service.exists").map((c) => c.subject)).not.toContain(
      "payment-service",
    );
  });

  it("asks that every scenario of every changed requirement is covered by a test", async () => {
    const p = await project();
    const cs = of(await claims(p), "scenario.tested");
    expect(cs).toHaveLength(1);
    expect(cs[0]!.claim).toContain("Split across two payees");
    expect(cs[0]!.claim).toContain("Split a payment");
  });

  it("asks nothing about a requirement the delta merely quotes from the living spec", async () => {
    // `## Requirements` inside a delta is the current state, not this feature's
    // work; archive merges nothing for it, and neither does the checklist.
    const files = coherentFixture();
    files[`${DIR}/specs/${SPLIT}/spec.md`] = files[`${DIR}/specs/${SPLIT}/spec.md`]!.replace(
      "## ADDED Requirements",
      "## Requirements",
    );
    const p = await project(files);
    expect(of(await claims(p), "scenario.tested")).toEqual([]);
  });

  it("asks nothing about a REMOVED requirement — it is being retired, not built", async () => {
    const files = coherentFixture();
    files[`${DIR}/specs/${SPLIT}/spec.md`] = files[`${DIR}/specs/${SPLIT}/spec.md`]!.replace(
      "## ADDED Requirements",
      "## REMOVED Requirements",
    );
    const p = await project(files);
    expect(of(await claims(p), "scenario.tested")).toEqual([]);
  });

  it("reads only the feature's own artifacts — a feature with none has an empty checklist", async () => {
    const p = await project({ "features/FEAT-7-empty/intent.md": "# Nothing yet\n" });
    const c = await checklist(p, "FEAT-7");
    expect(c.claims).toEqual([]);
    expect(c.verified).toBe(false);
  });
});

describe("the claim ids", () => {
  it("are the same on a second run — two runs of the same feature are diffable", async () => {
    const p = await project();
    expect(ids(await claims(p))).toEqual(ids(await claims(p)));
  });

  it("survive reordering the artifacts they came from", async () => {
    // The id is a function of what the claim SAYS. Moving a scenario up the page
    // is not new work, and must not orphan an answer somebody already gave.
    const files = coherentFixture();
    const two = `# ${SPLIT} — delta for ${FEAT}

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Split across two payees
- **Then** two shares are recorded

#### Scenario: Reject a split that does not sum
- **Then** the split is rejected
`;
    const swapped = `# ${SPLIT} — delta for ${FEAT}

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Reject a split that does not sum
- **Then** the split is rejected

#### Scenario: Split across two payees
- **Then** two shares are recorded
`;
    files[`${DIR}/specs/${SPLIT}/spec.md`] = two;
    const before = ids(await claims(await project(files)));
    files[`${DIR}/specs/${SPLIT}/spec.md`] = swapped;
    expect(ids(await claims(await project(files)))).toEqual(before);
  });

  it("change when the claim changes — an answer cannot outlive the words it was about", async () => {
    const p = await project();
    const before = of(await claims(p), "scenario.tested")[0]!.id;

    const files = coherentFixture();
    files[`${DIR}/specs/${SPLIT}/spec.md`] = files[`${DIR}/specs/${SPLIT}/spec.md`]!.replace(
      "Split across two payees",
      "Split across three payees",
    );
    const after = of(await claims(await project(files)), "scenario.tested")[0]!.id;
    expect(after).not.toBe(before);
  });

  it("change when a scenario's BODY is rewritten under the same title", async () => {
    // The title survives but the Given/When/Then is new text: a recorded
    // "confirmed" about the old steps must not stand for steps nobody checked.
    const p = await project();
    const before = of(await claims(p), "scenario.tested")[0]!.id;

    const files = coherentFixture();
    files[`${DIR}/specs/${SPLIT}/spec.md`] = files[`${DIR}/specs/${SPLIT}/spec.md`]!.replace(
      "- **Then** two shares are recorded",
      "- **Then** three shares are recorded",
    );
    const after = of(await claims(await project(files)), "scenario.tested")[0]!.id;
    expect(after).not.toBe(before);
  });

  it("are not shared between features that happen to claim the same thing", async () => {
    // An answers file for FEAT-1 must never validate against FEAT-2.
    const files = coherentFixture();
    for (const [rel, body] of Object.entries(coherentFixture())) {
      if (rel.startsWith(DIR)) files[rel.replace("FEAT-1-split", "FEAT-2-split")] = body.replace(/FEAT-1/g, "FEAT-2");
    }
    const p = await project(files);
    const one = ids(await claims(p, FEAT));
    const two = ids(await claims(p, "FEAT-2"));
    // the same four claims, twice — and not one id in common
    expect(one).toHaveLength(4);
    expect(two).toHaveLength(4);
    expect(one.some((id) => two.includes(id))).toBe(false);
  });

  it("carry their kind, so a reader of the record knows what was being asked", async () => {
    const p = await project();
    for (const c of await claims(p)) expect(c.id.startsWith(`${c.kind}-`)).toBe(true);
  });

  it("come back in a fixed order: what exists, what it exposes, what calls it, what tests it", async () => {
    const p = await project();
    expect(kinds(await claims(p))).toEqual([
      "service.exists",
      "api.exposes",
      "c4.calls",
      "scenario.tested",
    ]);
  });
});

describe("recording the answers", () => {
  it("writes a record beside the feature that reads without loam", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    expect(res.code, res.out).toBe(0);

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.feature).toBe(FEAT);
    expect(doc.summary).toEqual({ claims: 4, confirmed: 4, unconfirmed: 0 });
    // the claim TEXT is in the file, not just its id: a reviewer reads this, not the checklist
    expect(doc.claims.map((c: { claim: string }) => c.claim).join(" ")).toContain("createSplit");
    expect(doc.claims[0].evidence).toEqual(["src/split/Service.ts:12"]);
  });

  it("keeps the evidence and the date, which is the whole point of a record", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const c of doc.claims) expect(c.evidence.length).toBeGreaterThan(0);
  });

  it("accepts an honest no — an unconfirmed claim is a successful record, not a failure", async () => {
    const p = await project();
    const cs = await claims(p);
    const file = await writeAnswers(p, [
      ...cs.slice(0, 3).map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
      { id: cs[3]!.id, verdict: "unconfirmed", note: "no test written yet" },
    ]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file);
    expect(res.code).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.summary.unconfirmed).toBe(1);
    expect(doc.claims.find((c: { verdict: string }) => c.verdict === "unconfirmed").note).toBe(
      "no test written yet",
    );
    // and it says so out loud rather than burying it in the file
    expect(res.out).toContain("no test written yet");
  });

  it("travels into features/archive/ with the feature", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    expect(p.exists(`features/archive/FEAT-1-split/verification.yaml`)).toBe(true);
  });
});

describe("what --record refuses", () => {
  /** Record a hand-built answer set and return the failure envelope. */
  async function refuse(p: Project, answers: unknown): Promise<Record<string, any>> {
    const file = await writeAnswers(p, answers);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    return json;
  }

  it("an id that is not on the checklist — the answer is about a question nobody asked", async () => {
    const p = await project();
    const cs = await claims(p);
    const json = await refuse(p, [
      ...cs.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
      { id: "scenario.tested-deadbeef", verdict: "confirmed", evidence: ["a.ts:1"] },
    ]);
    expect(json.error.code).toBe("answers-mismatch");
    expect(json.error.message).toContain("scenario.tested-deadbeef");
  });

  it("a claim with no answer — silence must not read as verified", async () => {
    const p = await project();
    const cs = await claims(p);
    const json = await refuse(
      p,
      cs.slice(1).map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
    );
    expect(json.error.code).toBe("answers-mismatch");
    expect(json.error.message).toContain(cs[0]!.id);
  });

  it("a claim answered twice — nothing decides which verdict counts", async () => {
    const p = await project();
    const cs = await claims(p);
    const json = await refuse(p, [
      ...cs.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
      { id: cs[0]!.id, verdict: "unconfirmed" },
    ]);
    expect(json.error.code).toBe("answers-mismatch");
  });

  it("a yes with no evidence — that is an assertion, and the record is for evidence", async () => {
    const p = await project();
    const cs = await claims(p);
    const json = await refuse(p, [
      { id: cs[0]!.id, verdict: "confirmed" },
      ...cs.slice(1).map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
    ]);
    expect(json.error.code).toBe("answers-unevidenced");
    expect(json.error.message).toContain(cs[0]!.id);
  });

  it("a verdict nobody defined — a typo must not pass as an answer", async () => {
    const p = await project();
    const cs = await claims(p);
    const json = await refuse(
      p,
      cs.map((c) => ({ id: c.id, verdict: "yes", evidence: ["a.ts:1"] })),
    );
    expect(json.error.code).toBe("answers-unreadable");
  });

  it("an answers file that is not JSON, or not answers at all", async () => {
    const p = await project();
    await writeFile(join(p.workDir, "junk.json"), "not json at all", "utf8");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", "junk.json", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("answers-unreadable");

    const missing = await runLoam(p.workDir, "verify", FEAT, "--record", "nope.json", "--json");
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).error.code).toBe("answers-unreadable");
  });

  it("writes nothing when it refuses — a rejected answer set must leave no half-record", async () => {
    const p = await project();
    const before = await treeHashes(p.docsDir);
    await refuse(p, [{ id: "nope", verdict: "confirmed", evidence: ["a.ts:1"] }]);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("recording into an archived feature — its verification is history now", async () => {
    const p = await project();
    const file = await confirmAll(p);
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });

  it("a feature that does not exist", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", "FEAT-99", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("unknown-target");
  });
});

describe("answering from the runner (--results)", () => {
  // The digests the emitter stamps for SCENARIOS_ONLY's two scenarios.
  const d1 = digestOf(SCENARIOS_ONLY, 0, 0);
  const d2 = digestOf(SCENARIOS_ONLY, 0, 1);

  it("confirms a claim only from a green run, and the record says the runner answered", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [{ digest: d1 }, { digest: d2, name: "Reject a split that does not sum" }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.verified).toBe(true);
    expect(payload.summary).toEqual({ claims: 2, confirmed: 2, unconfirmed: 0 });

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    for (const c of doc.claims) {
      expect(c.verdict).toBe("confirmed");
      expect(c.answered_by).toBe("runner");
    }
    // the evidence names the report and the scenario, so a reviewer can find the run
    expect(doc.claims[0].evidence[0]).toBe(
      "report.json: features/loam/split-a-payment.feature › Split across two payees",
    );

    // and read mode carries answered_by back out
    for (const c of (await checklist(p)).claims) {
      expect(c.verdict).toBe("confirmed");
      expect((c as Record<string, unknown>).answered_by).toBe("runner");
    }
  });

  it("a failed step is an unconfirmed claim, the note naming the step", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [
      { digest: d1, steps: ["passed", "failed", "skipped"] },
      { digest: d2 },
    ]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verified).toBe(false);
    expect(payload.summary).toEqual({ claims: 2, confirmed: 1, unconfirmed: 1 });

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const failed = doc.claims.find((c: { verdict: string }) => c.verdict === "unconfirmed");
    expect(failed.note).toContain("failed at step 2");
    expect(failed.answered_by).toBe("runner");
  });

  it("a scenario absent from the report is unconfirmed — not found", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [{ digest: d1 }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const missing = doc.claims.find((c: { verdict: string }) => c.verdict === "unconfirmed");
    expect(missing.claim).toContain("Reject a split that does not sum");
    expect(missing.note).toContain("not found in report");
  });

  it("a reworded spec matches nothing — the digest is the identity, never the name", async () => {
    const files = scenarioOnlyFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = SCENARIOS_ONLY.replace(
      "two shares are recorded",
      "three shares are recorded",
    );
    const p = await project(files);
    // the report was generated before the rewording: same scenario NAME, old digest
    const report = await writeReport(p, [{ digest: d1 }, { digest: d2, name: "Reject a split that does not sum" }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const drifted = doc.claims.find((c: { claim: string }) => c.claim.includes("Split across two payees"));
    expect(drifted.verdict).toBe("unconfirmed");
    expect(drifted.note).toContain("not found in report");
    // the untouched scenario still confirms — exactly the drift fails
    expect(doc.summary).toEqual({ claims: 2, confirmed: 1, unconfirmed: 1 });
  });

  it("a duplicate digest confirms only if every occurrence passed", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [
      { digest: d1 },
      { digest: d1, steps: ["failed"] },
      { digest: d2 },
    ]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const rerun = doc.claims.find((c: { claim: string }) => c.claim.includes("Split across two payees"));
    expect(rerun.verdict).toBe("unconfirmed");
    expect(rerun.note).toContain("failed at step 1");
    expect(rerun.note).toContain("1 of 2 matching runs failed");
  });

  it("skipped-only runs are not green", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [
      { digest: d1, steps: ["skipped", "skipped"] },
      { digest: d2 },
    ]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const skipped = doc.claims.find((c: { verdict: string }) => c.verdict === "unconfirmed");
    expect(skipped.note).toContain("skipped");
  });

  it("refuses a report it cannot read or recognize, naming it", async () => {
    const p = await project(scenarioOnlyFixture());
    await writeFile(join(p.workDir, "junk.json"), "not json at all", "utf8");
    const junk = await runLoam(p.workDir, "verify", FEAT, "--results", "junk.json", "--json");
    expect(junk.code).toBe(1);
    const j = JSON.parse(junk.stdout);
    expect(j.error.code).toBe("answers-unreadable");
    expect(j.error.message).toContain("junk.json");

    // valid JSON, recognizably not a cucumber report: refuse, never "all not found"
    await writeFile(join(p.workDir, "notcuke.json"), JSON.stringify({ features: [] }), "utf8");
    const shape = await runLoam(p.workDir, "verify", FEAT, "--results", "notcuke.json", "--json");
    expect(shape.code).toBe(1);
    const s = JSON.parse(shape.stdout);
    expect(s.error.code).toBe("answers-unreadable");
    expect(s.error.message).toContain("not a cucumber JSON report");
  });

  it("another feature's report confirms nothing — no false confirms, but an honest record", async () => {
    const p = await project(scenarioOnlyFixture());
    const report = await writeReport(p, [{ digest: digestOf(LIVING_SPEC) }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verified).toBe(false);
    expect(payload.summary.confirmed).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    for (const c of doc.claims) expect(c.verdict).toBe("unconfirmed");
  });

  it("arch scenarios match through the same digest — the claims and the emitter share the hash", async () => {
    const files = scenarioOnlyFixture();
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = ARCH_ONLY;
    const p = await project(files);
    const report = await writeReport(p, [
      { digest: d1 },
      { digest: d2, name: "Reject a split that does not sum" },
      { digest: digestOf(ARCH_ONLY), name: "Duplicate delivery" },
    ]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).verified).toBe(true);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const arch = doc.claims.find((c: { claim: string }) => c.claim.includes("arch.spec.md"));
    expect(arch.verdict).toBe("confirmed");
    expect(arch.answered_by).toBe("runner");
  });
});

describe("composing --results with --record", () => {
  const scenarioDigest1 = digestOf(FEATURE_SPEC);

  it("the runner's half and the agent's half make one complete record, mixed answered_by", async () => {
    const p = await project();
    const cs = await claims(p);
    const answers = await writeAnswers(
      p,
      cs
        .filter((c) => c.kind !== "scenario.tested")
        .map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] })),
    );
    const report = await writeReport(p, [{ digest: scenarioDigest1 }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", answers, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verified).toBe(true);
    expect(payload.summary).toEqual({ claims: 4, confirmed: 4, unconfirmed: 0 });

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    for (const c of doc.claims) {
      expect(c.answered_by).toBe(c.kind === "scenario.tested" ? "runner" : "agent");
    }
  });

  it("an answers entry for a scenario claim is refused — the runner owns it", async () => {
    const p = await project();
    const answers = await confirmAll(p); // all four claims, the scenario one included
    const report = await writeReport(p, [{ digest: scenarioDigest1 }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", answers, "--results", report, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("answers-mismatch");
    expect(json.error.message).toContain("runner owns");
    const scenarioId = (await claims(p)).find((c) => c.kind === "scenario.tested")!.id;
    expect(json.error.message).toContain(scenarioId);
  });

  it("--results alone refuses while non-scenario claims are outstanding, listing them", async () => {
    const p = await project();
    const report = await writeReport(p, [{ digest: scenarioDigest1 }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("answers-mismatch");
    expect(json.error.message).toContain("--record");
    for (const c of (await claims(p)).filter((c) => c.kind !== "scenario.tested")) {
      expect(json.error.message).toContain(c.id);
    }
    // and nothing was recorded
    expect(p.exists(RECORD)).toBe(false);
  });

  it("an archived feature's record is frozen against --results too", async () => {
    const p = await project();
    const report = await writeReport(p, [{ digest: scenarioDigest1 }]);
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", report, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });
});

describe("reading the verification back", () => {
  it("says verified only when every claim is confirmed against the current checklist", async () => {
    const p = await project();
    expect((await checklist(p)).verified).toBe(false);
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    const after = await checklist(p);
    expect(after.verified).toBe(true);
    expect(after.summary).toEqual({ claims: 4, confirmed: 4, unconfirmed: 0, unanswered: 0 });
  });

  it("carries each claim's verdict back, so nobody re-reads the YAML by hand", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    for (const c of await claims(p)) expect(c.verdict).toBe("confirmed");
  });

  it("calls the record stale when the feature changed after it was written", async () => {
    // The record answers a question set. Change the questions and it stops being
    // an answer — even though every line of it is still there.
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    await p.write(
      `${DIR}/specs/${SPLIT}/spec.md`,
      (await p.read(`${DIR}/specs/${SPLIT}/spec.md`)) +
        `\n#### Scenario: Reject an unbalanced split\n- **Then** it is rejected\n`,
    );
    const after = await checklist(p);
    expect(after.recorded.stale).toBe(true);
    expect(after.verified).toBe(false);
    expect(after.summary.unanswered).toBe(1);
  });

  it("reports a feature nobody has verified without inventing a record", async () => {
    const p = await project();
    const c = await checklist(p);
    expect(c.recorded).toBe(null);
    expect(c.verified).toBe(false);
    expect(c.summary.unanswered).toBe(4);
  });

  it("prints the claims and how to answer them when there is no --json", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT);
    expect(res.code).toBe(0);
    expect(res.out).toContain("Split across two payees");
    expect(res.out).toContain("--record");
  });
});

describe("archived features — the record is frozen history", () => {
  // Archive merges the feature's ops into the living openapi. Re-deriving the
  // checklist afterwards computes a SMALLER claim set — the api.exposes claims
  // vanish because their operations are living now — so the digest mismatches
  // and a faithful record would read "stale" forever with an untrue diagnosis:
  // archive changed the environment, not the feature. So verify does not
  // re-derive at all; it renders verification.yaml verbatim and says so.
  it("shows the record verbatim after archive, not a stale re-derivation", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);

    const c = await checklist(p);
    expect(c.frozen).toBe(true);
    expect(c.verified).toBe(true);
    // all four claims exactly as recorded — including the api.exposes claim
    // whose operation archive merged into the living openapi
    expect(c.summary).toEqual({ claims: 4, confirmed: 4, unconfirmed: 0 });
    expect(c.claims).toHaveLength(4);
    expect(c.claims.map((x: Claim) => x.kind)).toContain("api.exposes");
    // and no staleness verdict: there is nothing current to be stale against
    expect(c.recorded.stale).toBeUndefined();
  });

  it("says frozen in prose too, and never STALE", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p));
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);

    const res = await runLoam(p.workDir, "verify", FEAT);
    expect(res.code).toBe(0);
    expect(res.out).toContain("frozen");
    expect(res.out).toContain("createSplit");
    expect(res.out).not.toContain("STALE");
  });

  it("an archived feature nobody verified says exactly that — no invented checklist", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);

    const c = await checklist(p);
    expect(c.frozen).toBe(true);
    expect(c.recorded).toBe(null);
    expect(c.verified).toBe(false);
    // null, not zero claims — zero would falsely say the feature promised nothing
    expect(c.summary).toBe(null);
    expect(c.claims).toEqual([]);

    const res = await runLoam(p.workDir, "verify", FEAT);
    expect(res.code).toBe(0);
    expect(res.out).toContain("no verification record");
  });
});

describe("verification does not gate", () => {
  it("archive still ships a feature nobody verified", async () => {
    // Deliberate. Archive refuses an incoherent feature because loam COMPUTED the
    // incoherence from the documents. A verdict is somebody's word about code loam
    // never read, and making it the last obstacle before shipping is how a
    // checklist becomes a formality.
    const p = await project();
    expect((await checklist(p)).verified).toBe(false);
    const res = await runLoam(p.workDir, "archive", FEAT);
    expect(res.code).toBe(0);
  });

  it("archive ships one whose record says a claim was never confirmed", async () => {
    const p = await project();
    const cs = await claims(p);
    const file = await writeAnswers(p, [
      ...cs.slice(0, 3).map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
      { id: cs[3]!.id, verdict: "unconfirmed", note: "not built" },
    ]);
    expect((await runLoam(p.workDir, "verify", FEAT, "--record", file)).code).toBe(0);
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    // and the unconfirmed claim is preserved in the archive, where a reviewer finds it
    expect(await p.read("features/archive/FEAT-1-split/verification.yaml")).toContain("not built");
  });

  it("verify itself exits 0 whether or not anything is confirmed — it reports, it does not judge", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "verify", FEAT)).code).toBe(0);
  });
});

describe("the slash command that drives it", () => {
  it("is laid down by init and runs the real loop: checklist, evidence, record, report", async () => {
    const dir = await makeTmpDir("loam-verify-cmd-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await runLoam(dir, "init", "--docs", "./d");
    const body = await readFile(join(dir, ".claude", "commands", "loam-verify.md"), "utf8");
    expect(body).toContain("loam verify $1 --json");
    expect(body).toContain("--record");
    // the runner's half of the loop: generate the report, feed it back
    expect(body).toContain("--results report.json");
    expect(body).toContain("--format json:report.json");
    expect(body).toContain("file:line");
    // the refusals it will hit, and the honest way out of them
    expect(body).toContain("answers-unevidenced");
    expect(body).toContain("unconfirmed");
  });
});

describe("the machine contract", () => {
  it("reports paths repo-relative, so the output diffs across machines", async () => {
    const p = await project();
    expect((await checklist(p)).path).toBe(DIR);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p), "--json");
    expect(JSON.parse(res.stdout).path).toBe(RECORD);
  });

  it("reports a missing loam.json under the same code as every other command", async () => {
    const dir = await makeTmpDir("loam-verify-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const res = await runLoam(dir, "verify", FEAT, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("the record it wrote is the one it reports", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p), "--json");
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.summary.confirmed).toBe(4);
    const doc = parse(await readFile(join(p.docsDir, RECORD), "utf8")) as Record<string, any>;
    expect(doc.checklist).toBe(json.digest);
  });

  it("record mode reports `verified` itself — recording all-confirmed answers must not require a re-run", async () => {
    const p = await project();
    const cs = await claims(p);
    const partial = await writeAnswers(p, [
      ...cs.slice(0, 3).map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["a.ts:1"] })),
      { id: cs[3]!.id, verdict: "unconfirmed", note: "not yet" },
    ]);
    const short = JSON.parse(
      (await runLoam(p.workDir, "verify", FEAT, "--record", partial, "--json")).stdout,
    );
    expect(short.verified).toBe(false);

    const full = JSON.parse(
      (await runLoam(p.workDir, "verify", FEAT, "--record", await confirmAll(p), "--json")).stdout,
    );
    expect(full.verified).toBe(true);
    // and it agrees with what a read-mode re-run would have said
    expect((await checklist(p)).verified).toBe(true);
  });
});
