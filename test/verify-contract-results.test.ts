/**
 * Tests for `loam verify --contract-results` — the contract-test report as the
 * answer sheet for `api.exposes` claims.
 *
 * The invariants worth pinning are the ones the design leans on:
 *
 *  - only an entry whose status is exactly "passed" confirms, and it confirms
 *    the claim whose operationId it names — a failed or unknown status, and an
 *    operation the report never exercised, stay unconfirmed WITH the reason,
 *    because silence must never read as checked;
 *  - the record says an external runner answered (`answered_by:
 *    external-runner`, the `[contract]` mark) and pins the consumed file in
 *    `contractReport:` — provenance a reviewer can check by hand;
 *  - the verdict ladder does not move: a contract report can never answer a
 *    `scenario.tested` claim, so agent-confirmed scenarios still read
 *    `attested` however green the contract run — the non-weakening non-goal,
 *    pinned here so no later change can trade it away quietly;
 *  - under the flag the report OWNS every api.exposes claim in scope, exactly
 *    as `--results` owns the scenario claims, and an unreadable or
 *    unrecognizable report refuses rather than answering "not exercised" for
 *    everything — nobody-could-look must stay distinguishable from
 *    nothing-matched;
 *  - the vendored sample in test/fixtures/contract-results/ IS the documented
 *    shape: it must parse and behave exactly as SCHEMA.md says, so the format
 *    cannot drift from its own normative example.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { contractAnswers, readContractReport } from "../src/core/verify/evidence/contract.js";
import { answeredMark } from "../src/commands/verify/frozen.js";
import { validateServiceEvidence } from "../src/commands/verify/results.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { parseRequirements } from "../src/core/document/parse.js";
import {
  coherentFixture,
  makeProject,
  runLoam,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";
import { FEAT, RECORD, serviceRepo, SPLIT, type Claim } from "./helpers/federated.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string> = coherentFixture()): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

/** The whole checklist, via the machine contract. */
async function claims(p: Project): Promise<Claim[]> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout).claims as Claim[];
}

interface Entry {
  operationId?: unknown;
  status?: unknown;
  test?: string;
}

/** Write a generic contract-results report into the working repo. */
async function writeContract(p: Project, entries: Entry[], name = "contract.json"): Promise<string> {
  await writeFile(join(p.workDir, name), JSON.stringify({ loamContractReport: 1, results: entries }), "utf8");
  return name;
}

/** Confirm the given claims from an answers file, one evidence line each. */
async function writeAnswers(p: Project, cs: Claim[], evidence = "src/split/Service.ts:12"): Promise<string> {
  await writeFile(
    join(p.workDir, "answers.json"),
    JSON.stringify(cs.map((c) => ({ id: c.id, verdict: "confirmed", evidence: [evidence] }))),
    "utf8",
  );
  return "answers.json";
}

const notExposes = (cs: Claim[]): Claim[] => cs.filter((c) => c.kind !== "api.exposes");
const exposes = (cs: Claim[]): Claim[] => cs.filter((c) => c.kind === "api.exposes");

/** The record on disk, parsed — never a command's payload. */
async function recordDoc(p: Project): Promise<Record<string, any>> {
  return parse(await p.read(RECORD)) as Record<string, any>;
}

describe("answering api.exposes from a contract report (--contract-results)", () => {
  it("a passed entry confirms the claim mechanically, and the record pins the report", async () => {
    const p = await project();
    const report = await writeContract(p, [
      { operationId: "createSplit", status: "passed", test: "POST /splits per contract" },
    ]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    // The pin is the file's real bytes, not a claim about them.
    const bytes = await readFile(join(p.workDir, report));
    expect(payload.contractReport).toMatchObject({
      path: report,
      digest: createHash("sha256").update(bytes).digest("hex"),
      operations: 1,
      format: "generic",
    });

    const doc = await recordDoc(p);
    const claim = doc.claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("confirmed");
    expect(claim.answered_by).toBe("external-runner");
    expect(claim.evidence).toEqual(["contract.json: POST /splits per contract"]);
    expect(doc.contractReport.digest).toBe(payload.contractReport.digest);

    // and the read view carries it all back out
    const read = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout);
    expect(read.recorded.contractReport).toMatchObject({ path: report, operations: 1 });
    const readClaim = read.claims.find((c: Claim) => c.kind === "api.exposes") as Record<string, unknown>;
    expect(readClaim["answered_by"]).toBe("external-runner");
  });

  it("a failed entry is an unconfirmed claim, the note saying so — and the run still records", async () => {
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "failed", test: "contract check" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verified).toBe(false);
    const doc = await recordDoc(p);
    const claim = doc.claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("unconfirmed");
    expect(claim.note).toContain("failed");
    expect(claim.note).toContain("contract check");
    expect(claim.answered_by).toBe("external-runner");
    // a partial result is announced, not merely countable — on the read view,
    // where verify.claims-open lives (the record path prints the ✗ lines)
    const read = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout);
    expect(read.notices.map((n: { code: string }) => n.code)).toContain("verify.claims-open");
  });

  it("an operation the report never exercised is unconfirmed — not exercised, by name", async () => {
    const p = await project();
    const report = await writeContract(p, []);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const claim = (await recordDoc(p)).claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("unconfirmed");
    expect(claim.note).toContain("not exercised");
    expect(claim.note).toContain("createSplit");
  });

  it("an unknown status is named, never rounded to a verdict — 'covered' does not confirm", async () => {
    // The exact word matters: it is Specmatic's coverage vocabulary, and the
    // reason no vendor report is parsed directly is that "covered" includes
    // exercised-and-FAILED. A transform that forwards it must see it refused.
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "covered" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const claim = (await recordDoc(p)).claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("unconfirmed");
    expect(claim.note).toContain("status 'covered' is not 'passed'");
  });

  it("a re-run confirms only if every occurrence passed", async () => {
    const p = await project();
    const report = await writeContract(p, [
      { operationId: "createSplit", status: "passed" },
      { operationId: "createSplit", status: "failed" },
    ]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const claim = (await recordDoc(p)).claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("unconfirmed");
    expect(claim.note).toContain("1 of 2 matching entries did not pass");
  });

  it("the human view marks the line [contract] and names the report", async () => {
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const recorded = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers);
    expect(recorded.code, recorded.out).toBe(0);
    expect(recorded.out).toContain("1 api.exposes claim answered by the contract test run (contract.json)");
    expect(recorded.out).toContain("Contract report read: contract.json (sha256 ");
    const read = await runLoam(p.workDir, "verify", FEAT);
    expect(read.out).toContain("[contract]");
  });
});

describe("ownership and refusals", () => {
  it("an answers-file entry for an api.exposes claim is refused while the report owns it — nothing written", async () => {
    const p = await project();
    const all = await claims(p);
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, all);
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("answers-mismatch");
    expect(err.message).toContain(exposes(all)[0]!.id);
    expect(p.exists(RECORD)).toBe(false);
  });

  it("--contract-results alone refuses while claims outside its kind are outstanding, listing them", async () => {
    const p = await project();
    const all = await claims(p);
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("answers-mismatch");
    expect(err.message).toContain("--contract-results answers only the api.exposes claims");
    for (const c of notExposes(all)) expect(err.message).toContain(c.id);
    expect(p.exists(RECORD)).toBe(false);
  });

  it("refuses a report it cannot read or recognize, naming the accepted shape — never 'all not exercised'", async () => {
    const p = await project();
    const answers = await writeAnswers(p, notExposes(await claims(p)));

    await writeFile(join(p.workDir, "junk.json"), "not json at all", "utf8");
    const junk = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "junk.json", "--record", answers, "--json");
    expect(junk.code).toBe(1);
    expect(JSON.parse(junk.stdout).error.code).toBe("answers-unreadable");
    expect(JSON.parse(junk.stdout).error.message).toContain("junk.json");

    // valid JSON, recognizably not the shape: refuse, and teach the shape
    await writeFile(join(p.workDir, "other.json"), JSON.stringify({ results: [] }), "utf8");
    const other = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "other.json", "--record", answers, "--json");
    expect(other.code).toBe(1);
    expect(JSON.parse(other.stdout).error.code).toBe("answers-unreadable");
    expect(JSON.parse(other.stdout).error.message).toContain("loamContractReport");

    // a version this parser does not read fails closed rather than guessing
    await writeFile(join(p.workDir, "v2.json"), JSON.stringify({ loamContractReport: 2, results: [] }), "utf8");
    const v2 = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "v2.json", "--record", answers, "--json");
    expect(v2.code).toBe(1);
    expect(JSON.parse(v2.stdout).error.message).toContain("version 1");

    // a malformed entry refuses the file, named by position
    await writeFile(
      join(p.workDir, "bad-entry.json"),
      JSON.stringify({ loamContractReport: 1, results: [{ status: "passed" }] }),
      "utf8",
    );
    const bad = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "bad-entry.json", "--record", answers, "--json");
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).error.message).toContain("entry 1");

    expect(p.exists(RECORD)).toBe(false);
  });

  it("a path that is a directory, and a file that is not UTF-8, refuse with the file named — never internal", async () => {
    const p = await project();
    const answers = await writeAnswers(p, notExposes(await claims(p)));

    await mkdir(join(p.workDir, "reportdir"));
    const dir = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "reportdir", "--record", answers, "--json");
    expect(dir.code).toBe(1);
    const dirErr = JSON.parse(dir.stdout).error;
    expect(dirErr.code).toBe("answers-unreadable");
    expect(dirErr.message).toContain("reportdir");

    await writeFile(join(p.workDir, "latin1.json"), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    const latin = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "latin1.json", "--record", answers, "--json");
    expect(latin.code).toBe(1);
    const latinErr = JSON.parse(latin.stdout).error;
    expect(latinErr.code).toBe("answers-unreadable");
    expect(latinErr.message).toContain("not valid UTF-8");

    expect(p.exists(RECORD)).toBe(false);
  });

  it("refuses on an archived feature exactly as --record does", async () => {
    const p = await project();
    const archived = await runLoam(p.workDir, "archive", FEAT);
    expect(archived.code, archived.out).toBe(0);
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });
});

/**
 * A second spec service exposing the SAME operationId the feature already
 * adds for payment-split-service. operationIds are unique per contract
 * document, not per fleet — this is the shape that let one service's report
 * confirm a service its suite never touched.
 */
const LEDGER_OPENAPI = `openapi: 3.1.0
info:
  title: ledger-service
  version: "1.0"
paths:
  /ledger-splits:
    post:
      operationId: createSplit
      summary: Record a split in the ledger
      responses:
        "201":
          description: Created
`;

function contestedFixture(): Record<string, string> {
  const files = coherentFixture();
  files["features/FEAT-1-split/specs/ledger-service/openapi.yaml"] = LEDGER_OPENAPI;
  return files;
}

describe("one operationId, two services — the contested join", () => {
  it("a shared report confirms neither claim: no entry names a service, so nobody's suite is attributable", async () => {
    const p = await project(contestedFixture());
    const all = await claims(p);
    const contested = exposes(all);
    // the fixture really is the repro: two subjects, one operationId
    expect(contested.map((c) => c.subject).sort()).toEqual(["ledger-service", SPLIT]);
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(all));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verified).toBe(false);
    for (const c of (await recordDoc(p)).claims.filter((c: { kind: string }) => c.kind === "api.exposes")) {
      expect(c.verdict).toBe("unconfirmed");
      expect(c.note).toContain("more than one service");
      expect(c.note).toContain("ledger-service");
      expect(c.note).toContain(SPLIT);
      expect(c.note).toContain("--service");
    }
    const notice = payload.notices.find((n: { code: string }) => n.code === "verify.operation-contested");
    expect(notice, res.out).toBeDefined();
    expect([...notice.claims].sort()).toEqual(contested.map((c) => c.id).sort());
    expect(notice.message).toContain("--service");
  });

  it("--service gives the report an owner: the narrowed checklist has one subject, so nothing is contested", async () => {
    const p = await project(contestedFixture());
    const repo = await serviceRepo(p, SPLIT, "primary");
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const local = (await claims(p)).filter((c) => c.subject === SPLIT && c.kind !== "api.exposes");
    const answers = await writeAnswers(p, local, "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect((payload.notices ?? []).map((n: { code: string }) => n.code)).not.toContain("verify.operation-contested");
    const mine = (await recordDoc(p)).claims.find(
      (c: { kind: string; subject?: string }) => c.kind === "api.exposes" && c.subject === SPLIT,
    );
    expect(mine.verdict).toBe("confirmed");
    expect(mine.answered_by).toBe("external-runner");
  });
});

describe("the verdict ladder does not move", () => {
  // The non-weakening non-goal, as a test: whatever a contract report says
  // about api.exposes, `attested` versus `verified` turns on scenario claims
  // alone. If either half of this ever flips, the tier boundary moved.
  it("agent-confirmed scenarios stay attested however green the contract run", async () => {
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verdict).toBe("attested");
    expect(payload.verified).toBe(false);
    expect(payload.notices.map((n: { code: string }) => n.code)).toContain("verify.scenario-attested");
  });

  it("runner-confirmed scenarios plus a contract-confirmed api.exposes read verified", async () => {
    const p = await project();
    const all = await claims(p);
    const digest = scenarioDigest(SPLIT, parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines, "business");
    await writeFile(
      join(p.workDir, "report.json"),
      JSON.stringify([
        {
          name: "Split a payment",
          elements: [
            {
              name: "Split across two payees",
              tags: [{ name: `@loam-digest-${digest}` }],
              steps: [{ result: { status: "passed" } }],
            },
          ],
        },
      ]),
      "utf8",
    );
    const contract = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const rest = all.filter((c) => c.kind !== "api.exposes" && c.kind !== "scenario.tested");
    const answers = await writeAnswers(p, rest);
    const res = await runLoam(p.workDir, "verify", FEAT, "--results", "report.json", "--contract-results", contract, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.verdict).toBe("verified");
    expect(payload.verified).toBe(true);
    // three channels, three provenances, one record
    const byKind = new Map((await recordDoc(p)).claims.map((c: any) => [c.kind, c.answered_by]));
    expect(byKind.get("scenario.tested")).toBe("runner");
    expect(byKind.get("api.exposes")).toBe("external-runner");
    expect(byKind.get("c4.calls")).toBe("agent");
  });
});

describe("federated binding", () => {
  it("the attestation carries the contract report, resolved inside the repo and bound to its commit", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "primary");
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const local = (await claims(p)).filter((c) => c.subject === SPLIT && c.kind !== "api.exposes");
    const answers = await writeAnswers(p, local, "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.attestations).toHaveLength(1);
    expect(payload.attestations[0].contractReport).toMatchObject({ path: report, operations: 1, format: "generic" });
    // on disk, the pin lives INSIDE the attestation — pruned with its answers
    const doc = await recordDoc(p);
    expect(doc.schema).toBe(2);
    expect(doc.attestations[0].contractReport.path).toBe(report);
    expect(doc.contractReport).toBeUndefined();
    // and the read view prints the attestation's pin where a reviewer looks
    const text = await runLoam(repo, "verify", FEAT);
    expect(text.out).toContain(`from ${report} (sha256 `);
  });

  it("refuses a contract report outside the attesting repository", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "primary");
    const local = (await claims(p)).filter((c) => c.subject === SPLIT && c.kind !== "api.exposes");
    const answers = await writeAnswers(p, local, "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--contract-results", "../outside.json", "--record", answers, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("answers-unreadable");
    expect(p.exists(RECORD)).toBe(false);
  });

  it("refuses a committed contract report that differs from the attested commit", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "primary");
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    execFileSync("git", ["add", report], { cwd: repo });
    execFileSync(
      "git",
      ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", "report"],
      { cwd: repo },
    );
    // now the committed file and the bytes loam reads disagree
    await writeContract(p, [
      { operationId: "createSplit", status: "passed", test: "edited after commit" },
    ]);
    const local = (await claims(p)).filter((c) => c.subject === SPLIT && c.kind !== "api.exposes");
    const answers = await writeAnswers(p, local, "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("answers-unevidenced");
    expect(err.message).toContain("differs from");
    expect(p.exists(RECORD)).toBe(false);
  });

  it("external-runner evidence must name the contract report loam read", async () => {
    // Not reachable through the CLI — contractAnswers only ever writes the
    // report's own path — so the validator arm is pinned directly: it is what
    // stops a hand-crafted or future caller minting contract confirmations
    // whose evidence points at a file nobody consumed.
    const failure = await validateServiceEvidence(
      [{ id: "api.exposes-x", verdict: "confirmed", evidence: ["other.json: entry"], answered_by: "external-runner" }],
      { repoDir: process.cwd(), commit: "a".repeat(40) },
      {},
      new Map(),
    );
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.message).toContain("does not name the report loam read");
  });
});

describe("the vendored sample is the documented shape", () => {
  const FIXTURE = fileURLToPath(new URL("./fixtures/contract-results/report.json", import.meta.url));

  it("resolves against the harness fleet: the feature's operation confirms, off-checklist entries are skipped — failures included", async () => {
    const p = await project();
    await writeFile(join(p.workDir, "contract.json"), await readFile(FIXTURE));
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", "contract.json", "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    // three entries, three distinct operations — the pin counts operations
    expect(payload.contractReport.operations).toBe(3);
    const doc = await recordDoc(p);
    const claim = doc.claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(claim.verdict).toBe("confirmed");
    expect(claim.answered_by).toBe("external-runner");
    // capturePayment FAILED in the sample and is not on this feature's
    // checklist: it must influence nothing — skipped means skipped
    expect(doc.claims.every((c: { note?: string }) => !(c.note ?? "").includes("capturePayment"))).toBe(true);
  });

  it("parses to exactly the runs the README describes", async () => {
    const parsed = readContractReport(JSON.parse(await readFile(FIXTURE, "utf8")), "report.json");
    expect(parsed.ok, parsed.ok ? "" : parsed.message).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.runs.map((r) => [r.operationId, r.status])).toEqual([
      ["createSplit", "passed"],
      ["authorizePayment", "passed"],
      ["capturePayment", "failed"],
    ]);
  });
});

describe("the record survives people", () => {
  it("a hand-written contractReport without `format` still reads — the docs teach four fields", async () => {
    // The generated AGENTS.md enumerates the pin as path/sha256/mtime/count;
    // a block faithful to that teaching must not unread the whole record over
    // a fifth field no reader dereferences.
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const doc = await recordDoc(p);
    expect(doc.contractReport.format).toBe("generic"); // loam itself always writes it
    delete doc.contractReport.format;
    await p.write(RECORD, JSON.stringify(doc));
    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(read.code, read.out).toBe(0);
    expect(JSON.parse(read.stdout).recorded.contractReport.path).toBe(report);
  });

  it("a hand-annotated record with extra keys — inside contractReport too — still reads", async () => {
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const res = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const doc = await recordDoc(p);
    doc["reviewed_by"] = "somebody";
    doc.contractReport["annotation"] = "checked by hand 2026-08-26";
    await p.write(RECORD, JSON.stringify(doc));
    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(read.code, read.out).toBe(0);
    expect(JSON.parse(read.stdout).recorded.contractReport.path).toBe(report);
  });

  it("the frozen post-archive view keeps the pin and the [contract] mark", async () => {
    const p = await project();
    const report = await writeContract(p, [{ operationId: "createSplit", status: "passed" }]);
    const answers = await writeAnswers(p, notExposes(await claims(p)));
    const recorded = await runLoam(p.workDir, "verify", FEAT, "--contract-results", report, "--record", answers, "--json");
    expect(recorded.code, recorded.out).toBe(0);
    const archived = await runLoam(p.workDir, "archive", FEAT);
    expect(archived.code, archived.out).toBe(0);

    const json = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout);
    expect(json.frozen).toBe(true);
    expect(json.recorded.contractReport).toMatchObject({ path: report, operations: 1 });

    const text = await runLoam(p.workDir, "verify", FEAT);
    expect(text.out).toContain("[contract]");
    expect(text.out).toContain("Contract report read: contract.json (sha256 ");
  });
});

describe("the parser, directly — branches no CLI path can reach", () => {
  it("a scenario claim carrying external-runner reads [attested], never [contract] — the mark agrees with the tally", () => {
    // file.ts accepts any answered_by string on purpose (hand edits, future
    // loams), and attestedClaims counts a confirmed scenario claim as attested
    // whenever the runner did not answer it — external-runner included. The
    // mark uses the same predicate, or it calls the tally a liar.
    expect(
      answeredMark({ id: "x", kind: "scenario.tested", verdict: "confirmed", answered_by: "external-runner" }),
    ).toBe("  [attested]");
    expect(answeredMark({ id: "x", kind: "api.exposes", verdict: "confirmed", answered_by: "external-runner" })).toBe(
      "  [contract]",
    );
  });

  it("a claim without an operationId fails closed instead of throwing or confirming", () => {
    const answers = contractAnswers(
      [{ id: "api.exposes-x", kind: "api.exposes", subject: SPLIT, claim: "..." }],
      [{ operationId: "createSplit", status: "passed" }],
      "contract.json",
    );
    expect(answers).toHaveLength(1);
    expect(answers[0]!.verdict).toBe("unconfirmed");
    expect(answers[0]!.note).toContain("no operationId");
  });

  it("results that are not an array, and non-object entries, refuse by name", () => {
    const noResults = readContractReport({ loamContractReport: 1, results: "green" }, "r.json");
    expect(noResults.ok).toBe(false);
    if (!noResults.ok) expect(noResults.message).toContain("results");
    const badEntry = readContractReport({ loamContractReport: 1, results: [7] }, "r.json");
    expect(badEntry.ok).toBe(false);
    if (!badEntry.ok) expect(badEntry.message).toContain("entry 1");
    const noStatus = readContractReport(
      { loamContractReport: 1, results: [{ operationId: "x", status: "" }] },
      "r.json",
    );
    expect(noStatus.ok).toBe(false);
    if (!noStatus.ok) expect(noStatus.message).toContain("no status");
  });
});
