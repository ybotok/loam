/**
 * Tests for the difference between "a test run said so" and "somebody said so"
 * (src/commands/verify.ts, src/core/verify.ts).
 *
 * `--record` may answer a `scenario.tested` claim, and that stays true: on a
 * fleet of legacy services the runnable suite is months away, and a done-check
 * nobody can complete is a done-check nobody runs. What must not stay true is
 * that the two answers read the same. A scenario claim's whole premise is that
 * a run answers it — its digest IS the tag `loam gherkin` stamps — so an agent's
 * answer is an ATTESTATION, and the record, the verdict and the code all say so.
 *
 * The invariants pinned here:
 *
 *  - a scenario claim confirmed by an agent leaves `verified` false and the
 *    verdict `attested`, with `verify.scenario-attested` naming the claims —
 *    exit 0 either way, because verify reports and does not gate;
 *  - a green digest-matched run is untouched: it still confirms, and still
 *    reads `verified`;
 *  - non-scenario claims are agent work by design — a service existing, an
 *    operation being exposed — and answering them does not attest anything;
 *  - the verdict is recounted from `claims[]`, so a record whose `summary`
 *    disagrees with its own answers is refused rather than believed, including
 *    on the post-ship path where the summary was the only thing anybody read;
 *  - `--results` writes down which file it consumed, because "answered by the
 *    runner" used to name no artifact at all;
 *  - two services wording one scenario identically hold TWO digests, because the
 *    body hash is salted by service: each repository's green run answers its own
 *    claim and cannot answer the other's — the shared-digest refusal that used to
 *    stand in for this is kept as the guard behind the salt;
 *  - a record written before the salt reads as stale, not as a half-answer: the
 *    rename is the one-time cost, and it has to be legible.
 */
import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { contestedDigests } from "../src/core/results.js";
import { scenarioBodyHash } from "../src/core/gherkin/digest.js";
import { type Claim as CoreClaim } from "../src/core/verify/checklist.js";
import { coherentFixture, makeProject, runLoam, FEATURE_SPEC, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const RECORD = "features/FEAT-1-split/verification.yaml";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(
  files: Record<string, string> = coherentFixture(),
  opts: { service?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

interface Claim {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: string;
  /** `scenario.tested` only — the tag a cucumber report has to carry. */
  digest?: string;
}

async function payload(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "verify", FEAT, ...args, "--json");
  return JSON.parse(res.stdout);
}

async function claims(p: Project): Promise<Claim[]> {
  return (await payload(p)).claims;
}

/** Confirm every claim `keep` selects, each with one line of evidence. */
async function answersFor(p: Project, keep: (c: Claim) => boolean = () => true): Promise<string> {
  const answers = (await claims(p))
    .filter(keep)
    .map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] }));
  await writeFile(join(p.workDir, "answers.json"), JSON.stringify({ answers }, null, 2), "utf8");
  return "answers.json";
}

/** A cucumber report whose one scenario carries FEATURE_SPEC's digest and ran green. */
async function greenReport(p: Project, name = "report.json"): Promise<string> {
  const digest = scenarioDigest("payment-split-service", parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines);
  const report = [
    {
      uri: "features/loam/split-a-payment.feature",
      name: "Split a payment",
      elements: [
        {
          name: "Split across two payees",
          type: "scenario",
          tags: [{ name: `@loam-digest-${digest}` }],
          steps: [{ result: { status: "passed" } }],
        },
      ],
    },
  ];
  await writeFile(join(p.workDir, name), JSON.stringify(report, null, 2), "utf8");
  return name;
}

/** coherentFixture with its one scenario removed: every claim left is an agent's to answer. */
function noScenariosFixture(): Record<string, string> {
  const files = coherentFixture();
  delete files["features/FEAT-1-split/specs/payment-split-service/spec.md"];
  return files;
}

/**
 * coherentFixture plus a second service whose spec words the scenario exactly
 * as the first one does — the ordinary way two teams describe the same
 * behaviour, and the one case where the digest identifies two questions.
 */
function twinScenarioFixture(): Record<string, string> {
  const files = coherentFixture();
  files["features/FEAT-1-split/specs/ledger-service/spec.md"] = FEATURE_SPEC.replace(
    "# payment-split-service —",
    "# ledger-service —",
  );
  return files;
}

/** The two digests twinScenarioFixture's one set of words hashes to, by owner. */
function twinDigests(): { mine: string; theirs: string } {
  const lines = parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines;
  return {
    mine: scenarioDigest("payment-split-service", lines),
    theirs: scenarioDigest("ledger-service", lines),
  };
}

describe("a scenario claim answered by an agent is attested, not run", () => {
  it("records the answer, and refuses to call it verified", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");
    // Exit 0: verify reports, it does not gate — the fallback still works.
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.summary.confirmed).toBe(json.summary.claims);
    expect(json.verified).toBe(false);
    expect(json.verdict).toBe("attested");
    expect(json.attested).toBe(1);

    const notice = json.notices[0];
    expect(notice.code).toBe("verify.scenario-attested");
    expect(notice.severity).toBe("warn");
    expect(notice.claims).toEqual([(await claims(p)).find((c) => c.kind === "scenario.tested")!.id]);

    // The answer itself is kept as given: the agent said confirmed, and the
    // record says confirmed, by an agent. Nothing is rewritten behind them.
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const scenario = doc.claims.find((c: Claim) => c.kind === "scenario.tested");
    expect(scenario.verdict).toBe("confirmed");
    expect(scenario.answered_by).toBe("agent");
  });

  it("says so again on every later read, and marks the claim line itself", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");

    const json = await payload(p);
    expect(json.verified).toBe(false);
    expect(json.verdict).toBe("attested");
    expect(json.notices[0].code).toBe("verify.scenario-attested");

    const text = await runLoam(p.workDir, "verify", FEAT);
    expect(text.out).toContain("[attested]");
    expect(text.out).toContain("⚠ verify.scenario-attested:");
    // The record answers every question, so the read view must not send an
    // agent back round the loop it has already run.
    expect(text.out).not.toContain("Answer each claim, then record the answers");
  });

  it("leaves the non-scenario claims alone — an agent's word is what they ask for", async () => {
    const p = await project(noScenariosFixture());
    const cs = await claims(p);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.some((c) => c.kind === "scenario.tested")).toBe(false);

    const json = JSON.parse(
      (await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json")).stdout,
    );
    expect(json.verified).toBe(true);
    expect(json.verdict).toBe("verified");
    expect(json.attested).toBe(0);
    expect(json.notices).toBeUndefined();
  });

  it("a record written before answered_by existed counts as attested — unknown is not a run", async () => {
    const p = await project();
    const before = await payload(p);
    await p.write(
      RECORD,
      [
        `feature: ${FEAT}`,
        "recorded: 2026-01-01",
        `checklist: ${before.digest}`,
        `summary: { claims: ${before.claims.length}, confirmed: ${before.claims.length}, unconfirmed: 0 }`,
        "claims:",
        ...before.claims.flatMap((c: Claim) => [
          `  - id: ${c.id}`,
          `    kind: ${c.kind}`,
          `    claim: ${JSON.stringify(c.claim)}`,
          "    verdict: confirmed",
          "    evidence: [src/split/Service.ts:12]",
        ]),
        "",
      ].join("\n"),
    );
    const json = await payload(p);
    expect(json.verdict).toBe("attested");
    expect(json.verified).toBe(false);
  });
});

describe("a green run still confirms, and says which report it read", () => {
  it("a digest-matched pass is verified, with no attestation notice", async () => {
    const p = await project();
    const report = await greenReport(p);
    const agent = await answersFor(p, (c) => c.kind !== "scenario.tested");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", agent, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.verified).toBe(true);
    expect(json.verdict).toBe("verified");
    expect(json.attested).toBe(0);
    expect(json.notices).toBeUndefined();
  });

  it("writes down the report it consumed — path, sha256 and mtime", async () => {
    const p = await project();
    const report = await greenReport(p);
    const agent = await answersFor(p, (c) => c.kind !== "scenario.tested");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", agent, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);

    const bytes = await readFile(join(p.workDir, report));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.report.path).toBe(report);
    expect(doc.report.digest).toBe(digest);
    expect(doc.report.scenarios).toBe(1);
    expect(typeof doc.report.mtime).toBe("string");
    expect(JSON.parse(res.stdout).report).toEqual(doc.report);
  });
});

describe("two services wording one scenario the same way are two digests", () => {
  /**
   * The salt is the whole fix. Before it, a scenario body hashed to the same 16
   * hex in every service that worded it that way, so `loam gherkin` could stamp
   * ONE tag into multiple repositories and one repository's green cucumber run
   * could appear to confirm claims from suites that never ran each other's
   * tests. `contestedDigests` closed the reachable half
   * by refusing to answer a shared digest at all, which traded a false
   * confirmation for a question nothing could ever answer. Salting by service
   * answers each one, in its own repository, correctly.
   */
  it("a green run answers its own service's claim and no other service's", async () => {
    const p = await project(twinScenarioFixture());
    const scenarios = (await claims(p)).filter((c) => c.kind === "scenario.tested");
    expect(scenarios).toHaveLength(2);
    // identical words, two services — and therefore two digests
    expect(twinDigests().mine).not.toBe(twinDigests().theirs);

    // the report carries payment-split-service's tag, because that is the repo
    // whose suite ran
    const report = await greenReport(p);
    const agent = await answersFor(p, (c) => c.kind !== "scenario.tested");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", agent, "--results", report, "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);

    const mine = scenarios.find((c) => c.subject === "payment-split-service")!;
    const theirs = scenarios.find((c) => c.subject === "ledger-service")!;
    expect(json.unconfirmed.map((c: Claim) => c.id)).toEqual([theirs.id]);

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const recorded = new Map(doc.claims.map((c: Claim) => [c.id, c]));
    expect((recorded.get(mine.id) as any).verdict).toBe("confirmed");
    expect((recorded.get(mine.id) as any).answered_by).toBe("runner");
    // ledger-service is not confirmed by somebody else's run — and the reason on
    // the record is the honest one: its tag is not in this report.
    expect((recorded.get(theirs.id) as any).verdict).toBe("unconfirmed");
    expect((recorded.get(theirs.id) as any).note).toContain("not found in report");
  });

  it("the generated suites carry different tags, so neither report can match the other", async () => {
    const p = await project(twinScenarioFixture(), { service: "payment-split-service" });

    const gen = await runLoam(p.workDir, "gherkin", FEAT, "--json");
    expect(gen.code, gen.out).toBe(0);
    const emitted: string[] = JSON.parse(gen.stdout).files.flatMap((f: { digests: string[] }) => f.digests);
    // the stamp `loam gherkin` writes IS the digest verify folds into this
    // service's claim — and it is not the one the other service's claim carries
    const { mine, theirs } = twinDigests();
    expect(emitted).toContain(mine);
    expect(emitted).not.toContain(theirs);
  });

  /**
   * `verify.digest-contested` is what remains of the reachable half, and the
   * salt has put it out of reach: a claim's digest is computed from the same
   * service the claim is filed under, so two subjects cannot share one short of
   * a truncated-sha256 collision. It stays as the guard that says so — asserted
   * here directly, because no fixture can produce the input any more.
   */
  it("the shared-digest guard still refuses, if a digest ever is shared", () => {
    const claim = (id: string, subject: string, digest: string): CoreClaim => ({
      id,
      kind: "scenario.tested",
      subject,
      claim: `${subject} tests it`,
      digest,
    });
    expect([
      ...contestedDigests([claim("a", "ledger-service", "ff"), claim("b", "payment-split-service", "ff")]),
    ]).toEqual([["ff", ["ledger-service", "payment-split-service"]]]);
    // one service repeating itself is genuinely one test, and is not a contest
    expect(contestedDigests([claim("a", "ledger-service", "ff"), claim("b", "ledger-service", "ff")]).size).toBe(0);
  });

  it("stays quiet on a checklist nobody contests", async () => {
    const p = await project();
    expect((await payload(p)).notices).toBeUndefined();
  });

  it("still answers a service whose scenario nobody else words the same way", async () => {
    const p = await project();
    expect((await claims(p)).filter((c) => c.kind === "scenario.tested")).toHaveLength(1);
    const res = await runLoam(
      p.workDir,
      "verify",
      FEAT,
      "--record",
      await answersFor(p, (c) => c.kind !== "scenario.tested"),
      "--results",
      await greenReport(p),
      "--json",
    );
    const json = JSON.parse(res.stdout);
    expect(json.verified).toBe(true);
    expect(json.notices).toBeUndefined();
  });
});

/**
 * Salting the scenario digest by service renamed every `scenario.tested` claim
 * id — an id folds in the first 8 hex of the body hash — and with them the
 * checklist digest. The project has paid that one-time cost before (folding
 * scenario BODIES into the ids), and paying it LEGIBLY is the whole condition:
 * a verification.yaml written by the previous loam has to read as answering a
 * different checklist, never as silently half-matching this one.
 */
describe("a record written before the service salt reads as stale, not as an answer", () => {
  /**
   * FEATURE_SPEC's scenario claim id, from a body hash the caller supplies —
   * the NUL-joined claim tuple `claimId` builds. Hand-rolled so the pre-salt id
   * can be reconstructed exactly; the test below feeds it BOTH recipes and
   * checks the salted one against the id loam actually wrote, so a wrong
   * reconstruction fails rather than passing on any old mismatch.
   */
  function scenarioClaimId(bodyHash: string): string {
    const req = parseRequirements(FEATURE_SPEC)[0]!;
    const tuple = [
      FEAT,
      "scenario.tested",
      "payment-split-service",
      req.id ?? req.name,
      req.scenarios[0]!.name,
      bodyHash.slice(0, 8),
    ].join("\u0000");
    return `scenario.tested-${createHash("sha256").update(tuple).digest("hex").slice(0, 8)}`;
  }

  it("reports STALE and leaves the renamed claim unanswered", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");

    // rewrite the fresh record into the one the previous loam would have written
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    const current = doc.claims.find((c: Claim) => c.kind === "scenario.tested").id;
    const body = parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines.join("\n").trim();
    // the reconstruction is the real recipe: salted, it reproduces the id loam wrote
    expect(scenarioClaimId(scenarioBodyHash("payment-split-service", parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines))).toBe(current);
    // unsalted, it is what the previous loam wrote — a different question
    const preSalt = scenarioClaimId(createHash("sha256").update(body).digest("hex"));
    expect(preSalt).not.toBe(current);
    doc.claims = doc.claims.map((c: Claim) => (c.kind === "scenario.tested" ? { ...c, id: preSalt } : c));
    doc.checklist = createHash("sha256")
      .update(
        doc.claims
          .map((c: Claim) => c.id)
          .sort()
          .join("\n"),
      )
      .digest("hex")
      .slice(0, 16);
    await p.write(RECORD, JSON.stringify(doc, null, 2));

    const json = await payload(p);
    expect(json.recorded.stale).toBe(true);
    expect(json.verdict).toBe("unverified");
    expect(json.claims.find((c: Claim) => c.kind === "scenario.tested").verdict).toBe("unanswered");
    // the claims it never renamed still read as answered — the record is stale,
    // not unreadable, and the diagnosis names the part that moved
    expect(json.summary.unanswered).toBe(1);
    expect(json.summary.confirmed).toBe(json.summary.claims - 1);

    const prose = await runLoam(p.workDir, "verify", FEAT);
    expect(prose.out).toContain("STALE");
  });
});

describe("a record that contradicts itself is refused, not believed", () => {
  /** Rewrite the record's summary to claim more confirmations than its claims hold. */
  async function overstate(p: Project, path = RECORD): Promise<void> {
    const doc = parse(await p.read(path)) as Record<string, any>;
    doc.claims[0].verdict = "unconfirmed";
    doc.claims[0].evidence = [];
    await p.write(path, JSON.stringify(doc, null, 2));
  }

  it("refuses a live record whose summary disagrees with its claims", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");
    await overstate(p);

    const res = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("record-unreadable");
    expect(json.error.message).toContain("verify.record-miscounted");
  });

  it("refuses it after archive too — where the summary was the whole verdict", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    const archived = "features/archive/FEAT-1-split/verification.yaml";
    await overstate(p, archived);

    const res = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.message).toContain("verify.record-miscounted");
  });

  it("carries the attested verdict into the frozen view after archive", async () => {
    const p = await project();
    await runLoam(p.workDir, "verify", FEAT, "--record", await answersFor(p), "--json");
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);

    const json = await payload(p);
    expect(json.frozen).toBe(true);
    expect(json.verified).toBe(false);
    expect(json.verdict).toBe("attested");
    expect(json.notices[0].code).toBe("verify.scenario-attested");
  });
});
