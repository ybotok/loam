/**
 * Evidence pins, both halves.
 *
 * WRITE: a federated `--record` stamps, per agent-confirmed `file:line`
 * citation, the cited file's normalized sha256 at the attested commit, the
 * cited line's text and the claim's token — and warns once, at record time,
 * when a cited blob does not contain the string its claim asserts. The stamp
 * is additive (schema stays 2, pinless records stay legal forever), and a
 * present-but-broken pins block makes the record unreadable and therefore
 * never overwritten — the contract-report precedent.
 *
 * READ: `loam validate`, standing in the service's own repository, re-checks
 * every pin its attested ACTIVE records carry against the working tree and
 * reports drift under the `evidence.*` findings — and ONLY demotes reviewer
 * confidence: no grade flips `valid`, moves an exit code without `--strict`,
 * or touches a verdict. From the docs repo the family is silent by design.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  coherentFixture,
  makeProject,
  runLoam,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";
import {
  answersFile,
  allClaims,
  FEAT,
  RECORD,
  serviceClaims,
  serviceRepo,
  SPLIT,
  recordOnFile,
} from "./helpers/federated.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { parseRequirements } from "../src/core/document/parse.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * The service the pins in this suite belong to is the one FEAT-1 introduces,
 * so `coherentFixture()` alone gives it no `services/` directory — and the
 * service target refuses a directory that does not exist (`service.unknown`)
 * before any axis runs, the pin lint included. A minimal C4 model makes the
 * target gradable (absent spec/contract stay warnings) without touching the
 * feature's checklist: claim ids derive from the delta and the specs/ dirs,
 * neither of which this file changes.
 */
const SPLIT_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  paymentSplitService = softwareSystem 'payment-split-service' {
    description 'Splits a payment across payees'
    api = container 'api'
  }
}

views {
  view of paymentSplitService {
    include *
  }
}
`;

async function project(): Promise<Project> {
  const p = await makeProject({
    ...coherentFixture(),
    "services/payment-split-service/model.likec4": SPLIT_MODEL,
  });
  cleanups.push(() => p.destroy());
  return p;
}

/**
 * The evidence file the pins in this suite cite: line 2 holds the api.exposes
 * claim's token (`createSplit`), so an untouched tree grades clean on every
 * axis including the token scan.
 */
const IMPL = [
  "// payment split entry points",
  "export function createSplit(total: number) {",
  "  return total;",
  "}",
  "",
].join("\n");
const CITED_LINE = "export function createSplit(total: number) {";

/** Write and COMMIT a file in the service repo — pins bind to the attested commit. */
async function commitFile(repo: string, name: string, content: string): Promise<void> {
  await writeFile(join(repo, name), content, "utf8");
  execFileSync("git", ["add", name], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", `add ${name}`],
    { cwd: repo },
  );
}

/** A green cucumber report for FEATURE_SPEC's one scenario, digest-tagged. */
function greenReport(): unknown {
  const digest = scenarioDigest(SPLIT, parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines);
  return [
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
}

/** Commit impl.ts and record every SPLIT claim on `impl.ts:2` from the service repo. */
async function recordPinned(p: Project, repo: string): Promise<void> {
  await commitFile(repo, "impl.ts", IMPL);
  const claims = await serviceClaims(p, SPLIT);
  const file = await answersFile(repo, claims, "impl.ts:2");
  const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json");
  expect(res.code, res.out).toBe(0);
}

/** One service target's findings out of a `validate --service <SPLIT> --json` run. */
async function splitFindings(cwd: string, ...flags: string[]): Promise<{ code: number; valid: boolean; findings: Array<Record<string, any>> }> {
  const res = await runLoam(cwd, "validate", "--service", SPLIT, "--json", ...flags);
  const payload = JSON.parse(res.stdout);
  const target = payload.targets.find((t: { kind: string; id: string }) => t.kind === "service" && t.id === SPLIT);
  expect(target, res.out).toBeDefined();
  return { code: res.code, valid: payload.valid, findings: target.findings };
}

const codesOf = (findings: Array<Record<string, any>>): string[] => findings.map((f) => f["code"] as string);
const evidenceCodes = (findings: Array<Record<string, any>>): string[] =>
  codesOf(findings).filter((c) => c.startsWith("evidence."));

/* ------------------------------------------------------------------ */
/* Write side: what --record stamps                                    */
/* ------------------------------------------------------------------ */

describe("federated --record stamps evidence pins", () => {
  it("one pin per agent citation — sha256, line text, token — and none on runner answers", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await commitFile(repo, "impl.ts", IMPL);
    await writeFile(join(repo, "report.json"), JSON.stringify(greenReport()), "utf8");
    const agentClaims = (await serviceClaims(p, SPLIT)).filter((c) => c.kind !== "scenario.tested");
    const answers = await answersFile(repo, agentClaims, "impl.ts:2");
    const res = await runLoam(
      repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--results", "report.json", "--json",
    );
    expect(res.code, res.out).toBe(0);

    const doc = (await recordOnFile(p)) as { claims: Array<Record<string, any>> };
    const api = doc.claims.find((c) => c["kind"] === "api.exposes")!;
    expect(api["evidence_pins"]).toHaveLength(1);
    const pin = api["evidence_pins"][0];
    expect(pin.path).toBe("impl.ts");
    expect(pin.line).toBe(2);
    expect(pin.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.text).toBe(CITED_LINE);
    expect(pin.token).toBe("createSplit");

    // A claim that asserts no literal pins the citation without a token.
    const exists = doc.claims.find((c) => c["kind"] === "service.exists")!;
    expect(exists["evidence_pins"]).toHaveLength(1);
    expect(exists["evidence_pins"][0].token).toBeUndefined();

    // The runner's evidence names a report entry, not a file — nothing to pin.
    const scenario = doc.claims.find((c) => c["kind"] === "scenario.tested")!;
    expect(scenario["answered_by"]).toBe("runner");
    expect(scenario["evidence_pins"]).toBeUndefined();

    // The read view passes the pins through as an additive payload key…
    const read = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout);
    const readApi = read.claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(readApi.evidence_pins).toHaveLength(1);
    expect(readApi.evidence_pins[0].token).toBe("createSplit");

    // …and so does the frozen view after archive, verbatim.
    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    const frozen = JSON.parse((await runLoam(p.workDir, "verify", FEAT, "--json")).stdout);
    expect(frozen.frozen).toBe(true);
    const frozenApi = frozen.claims.find((c: { kind: string }) => c.kind === "api.exposes");
    expect(frozenApi.evidence_pins[0].text).toBe(CITED_LINE);
  });

  it("the legacy all-at-once form stamps no pins — it binds to no commit", async () => {
    const p = await project();
    const all = await allClaims(p);
    const file = await answersFile(p.workDir, all, "proof.ts:2", "all.json");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code, res.out).toBe(0);
    const doc = (await recordOnFile(p)) as { claims: Array<Record<string, any>> };
    expect(doc.claims.length).toBeGreaterThan(0);
    for (const claim of doc.claims) expect(claim["evidence_pins"]).toBeUndefined();
  });

  it("a cited line longer than the cap pins exactly 200 characters", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    const long = ["// header", `// createSplit ${"x".repeat(300)}`, ""].join("\n");
    await commitFile(repo, "impl.ts", long);
    const claims = await serviceClaims(p, SPLIT);
    const file = await answersFile(repo, claims, "impl.ts:2");
    expect((await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json")).code).toBe(0);
    const doc = (await recordOnFile(p)) as { claims: Array<Record<string, any>> };
    const pin = doc.claims.find((c) => c["kind"] === "api.exposes")!["evidence_pins"][0];
    expect(pin.text).toHaveLength(200);
    expect(pin.text.startsWith("// createSplit")).toBe(true);
  });

  it("a cited blob without the claim's token warns verify.evidence-token-missing and moves nothing", async () => {
    const p = await project();
    // serviceRepo's committed proof.ts does NOT contain 'createSplit'.
    const repo = await serviceRepo(p, SPLIT, "split-work");
    const claims = await serviceClaims(p, SPLIT);
    const file = await answersFile(repo, claims, "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    const codes = (json.notices as Array<{ code: string }>).map((n) => n.code);
    expect(codes).toContain("verify.evidence-token-missing");
    // Verdict-neutral: the attested honesty line still fires beside it, and the
    // verdict is exactly what a token-satisfied run would compute.
    expect(codes).toContain("verify.scenario-attested");
    const notice = (json.notices as Array<Record<string, any>>).find((n) => n["code"] === "verify.evidence-token-missing")!;
    const apiId = claims.find((c) => c.kind === "api.exposes")!.id;
    expect(notice["claims"]).toContain(apiId);
    expect(notice["message"]).toContain("createSplit");
    expect(json.verdict).toBe("unverified"); // payment-service's c4.calls claim is honestly unanswered
    // The pin OMITS a token the attested blob never contained: the record-time
    // notice above is the one honesty surface for that fact, and a stamped
    // token here would make every later validate repeat "no longer contains"
    // about a file that never did — with a re-record that re-derives the same
    // state as the only offered repair.
    const doc = (await recordOnFile(p)) as { claims: Array<Record<string, any>> };
    expect(doc.claims.find((c) => c["kind"] === "api.exposes")!["evidence_pins"][0].token).toBeUndefined();
    // So the untouched tree grades CLEAN from the service repo — warned once,
    // not yellow forever.
    const { findings } = await splitFindings(repo);
    expect(evidenceCodes(findings)).toEqual(["evidence.checked"]);
  });

  it("a hand-broken pins block is record-unreadable and never overwritten; a stripped one still reads", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    const sound = await p.read(RECORD);
    // The answers to retry with, prepared BEFORE the damage: every read lens
    // refuses an unreadable record too, so nothing here may go through verify.
    const claims = await serviceClaims(p, SPLIT);
    const file = await answersFile(repo, claims, "impl.ts:2");

    // Break ONE pin's shape the way a hand edit does: a quoted line number.
    const broken = sound.replace("line: 2", 'line: "2"');
    expect(broken).not.toBe(sound);
    await p.write(RECORD, broken);
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("record-unreadable");
    // The never-overwrite assertion: the damaged bytes are exactly as the hand left them.
    expect(await p.read(RECORD)).toBe(broken);

    // Absent is fine: strip every pins key and the record reads again —
    // the regression guard for every record written before pins existed.
    const doc = parse(sound) as { claims: Array<Record<string, unknown>> } & Record<string, unknown>;
    for (const claim of doc.claims) delete claim["evidence_pins"];
    await p.write(RECORD, stringify(doc, { lineWidth: 0 }));
    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(read.code, read.out).toBe(0);
    expect(JSON.parse(read.stdout).recorded).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Read side: loam validate in the service repo                        */
/* ------------------------------------------------------------------ */

describe("loam validate re-checks the pins in the service repo", () => {
  it("an untouched tree grades evidence.checked, ok, and valid stays true", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    const { valid, findings } = await splitFindings(repo);
    expect(valid).toBe(true);
    const checked = findings.find((f) => f["code"] === "evidence.checked")!;
    expect(checked["severity"]).toBe("ok");
    expect(checked["message"]).toContain("3 evidence pin(s)");
    expect(checked["message"]).toContain("1 feature record(s)");
    expect(evidenceCodes(findings)).toEqual(["evidence.checked"]);
  });

  it("a deleted cited file grades evidence.unresolved, per citation, claims named", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    await rm(join(repo, "impl.ts"));
    const { findings } = await splitFindings(repo);
    const finding = findings.find((f) => f["code"] === "evidence.unresolved")!;
    expect(finding["severity"]).toBe("warn");
    expect(finding["details"]).toHaveLength(3); // three claims, one citation each
    const apiId = (await serviceClaims(p, SPLIT)).find((c) => c.kind === "api.exposes")!.id;
    expect((finding["details"] as string[]).some((d) => d.includes(apiId) && d.includes("impl.ts:2"))).toBe(true);
    expect(codesOf(findings)).not.toContain("evidence.checked");
  });

  it("a file changed around a surviving cited line grades evidence.moved and nothing harsher", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    await writeFile(join(repo, "impl.ts"), `${IMPL}// audit trail\n`, "utf8");
    const { findings } = await splitFindings(repo);
    const codes = evidenceCodes(findings);
    expect(codes).toContain("evidence.moved");
    expect(codes).not.toContain("evidence.line-changed");
    expect(codes).not.toContain("evidence.token-missing");
    expect(codes).not.toContain("evidence.unresolved");
  });

  it("an edited cited line grades evidence.line-changed, old and new text in the detail", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    const edited = IMPL.replace(CITED_LINE, "export function createSplit(total: number, memo: string) {");
    await writeFile(join(repo, "impl.ts"), edited, "utf8");
    const { findings } = await splitFindings(repo);
    const codes = evidenceCodes(findings);
    expect(codes).toContain("evidence.line-changed");
    expect(codes).not.toContain("evidence.moved");
    expect(codes).not.toContain("evidence.token-missing"); // the token survived the edit
    const finding = findings.find((f) => f["code"] === "evidence.line-changed")!;
    expect((finding["details"] as string[])[0]).toContain(CITED_LINE);
    expect((finding["details"] as string[])[0]).toContain("memo: string");
  });

  it("a vanished token grades evidence.token-missing — even where the digest would otherwise clear", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    await writeFile(join(repo, "impl.ts"), IMPL.replaceAll("createSplit", "buildSplit"), "utf8");
    const { findings } = await splitFindings(repo);
    const codes = evidenceCodes(findings);
    expect(codes).toContain("evidence.token-missing");
    const finding = findings.find((f) => f["code"] === "evidence.token-missing")!;
    expect((finding["details"] as string[])[0]).toContain("createSplit");
    expect(finding["severity"]).toBe("warn");
  });

  it("an unreadable record is a finding, never a silent skip — the hand-broken-pins CI hole", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    // The damage a service repo's CI most plausibly meets: somebody "fixed" a
    // pin by hand and broke the record's shape. The lint family must NAME it —
    // this CI job never runs verify, so a skip here reads as a clean fleet.
    await p.write(RECORD, (await p.read(RECORD)).replace("line: 2", 'line: "2"'));
    const { code, valid, findings } = await splitFindings(repo);
    const finding = findings.find((f) => f["code"] === "evidence.record-unreadable")!;
    expect(finding, JSON.stringify(findings)).toBeDefined();
    expect(finding["severity"]).toBe("warn");
    expect(finding["message"]).toContain("verification.yaml");
    expect(finding["message"]).toContain("repair");
    // Demote-only holds here too: a warn, valid stays true, exit stays 0.
    expect(code).toBe(0);
    expect(valid).toBe(true);
    expect(codesOf(findings)).not.toContain("evidence.checked");
  });

  it("a record predating pins grades ok evidence.unpinned — quiet, never yellow", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    // Strip the pins the way a record written by an older loam simply lacks them.
    const doc = parse(await p.read(RECORD)) as { claims: Array<Record<string, unknown>> } & Record<string, unknown>;
    for (const claim of doc.claims) delete claim["evidence_pins"];
    await p.write(RECORD, stringify(doc, { lineWidth: 0 }));
    const { valid, findings } = await splitFindings(repo);
    expect(valid).toBe(true);
    const unpinned = findings.find((f) => f["code"] === "evidence.unpinned")!;
    expect(unpinned["severity"]).toBe("ok");
    expect(unpinned["message"]).toContain("3 agent-confirmed citation(s)");
    expect(evidenceCodes(findings)).toEqual(["evidence.unpinned"]);
  });

  it("from the docs repo the whole family is silent — the blind spot is already named", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    await rm(join(repo, "impl.ts")); // real drift, invisible from over here
    // p.workDir's loam.json binds no service, so this run stands in no repo.
    const { findings } = await splitFindings(p.workDir);
    expect(evidenceCodes(findings)).toEqual([]);
    // The target WAS graded — silence is the family's absence, not a skipped run.
    expect(codesOf(findings)).toContain("c4.valid");
  });

  it("drift never gates: exit 0 and valid true without --strict, exit 1 with it", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    await recordPinned(p, repo);
    await rm(join(repo, "impl.ts"));
    const plain = await splitFindings(repo);
    expect(plain.code).toBe(0);
    expect(plain.valid).toBe(true);
    const strict = await splitFindings(repo, "--strict");
    expect(strict.code).toBe(1);
    expect(strict.valid).toBe(true); // the payload does not change; the exit code is the lever
  });

  it("a CRLF working tree over an LF blob grades evidence.checked — endings are config, not drift", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    // autocrlf=input: `git add` stores the blob LF while the file on disk stays
    // CRLF — exactly the split a Windows checkout lives with. An unnormalized
    // digest recipe grades this evidence.moved forever, which is the false
    // positive this test makes unshippable.
    execFileSync("git", ["config", "core.autocrlf", "input"], { cwd: repo });
    await commitFile(repo, "impl.ts", IMPL.replaceAll("\n", "\r\n"));
    const claims = await serviceClaims(p, SPLIT);
    const file = await answersFile(repo, claims, "impl.ts:2");
    expect((await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json")).code).toBe(0);
    const { findings } = await splitFindings(repo);
    expect(evidenceCodes(findings)).toEqual(["evidence.checked"]);
    // The pinned text is the trimmed line either way — no \r rides into the record.
    const doc = (await recordOnFile(p)) as { claims: Array<Record<string, any>> };
    expect(doc.claims.find((c) => c["kind"] === "api.exposes")!["evidence_pins"][0].text).toBe(CITED_LINE);
  });
});
