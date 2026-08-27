/**
 * The one rule `loam status` is held to: **it may be more pessimistic than the
 * gates, never greener.**
 *
 * `status` is the first question an agent asks, and it is a projection — it
 * re-derives its answer from the files through the same functions `validate`
 * and `archive` call. A projection that runs a SUBSET of what the gates run is
 * not merely incomplete: it is confidently wrong in one direction only, and
 * that direction is the expensive one. Every finding this file was written for
 * had the same shape — status printed "authored, coherent and verified — ship
 * it" about a tree `loam archive` exits 1 on, or about a record `loam verify`
 * calls unverified.
 *
 * So the assertion is a relation between three commands on ONE tree, not a
 * golden payload:
 *
 *     status ships it  ⟹  validate --feature accepts  AND  archive --dry-run accepts
 *
 * It is deliberately the contrapositive of "never greener" and nothing more.
 * status is allowed to be redder than either gate (it takes the UNION of the
 * two, and they refuse on different questions — is the DOCUMENT valid, is the
 * MERGE safe), so an equality here would be a false statement dressed as a
 * test, failing on trees where status is right.
 *
 * `expectAgreesWithGates` is applied to every fixture below, damaged and clean
 * alike, so a future case is covered by writing the damage — and the clean
 * control asserts the relation is not vacuously true, which is the way a
 * one-directional invariant usually rots: make everything red and it can never
 * be violated.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import {
  coherentFixture,
  makeProject,
  runLoam,
  FEATURE_SPEC,
  LIVING_SPEC,
  type Project,
} from "./helpers/harness.js";
import { FLEET_NEXT_LIMIT } from "../src/core/status/fleet/next.js";
import { type Answer, type AnsweredBy, type Verdict } from "../src/core/verify/answers.js";
import { buildVerification } from "../src/core/verify/build.js";
import { featureChecklist } from "../src/core/verify/checklist.js";
import { renderVerification } from "../src/core/verify/store/render.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-split";
const SVC = "payment-split-service";

interface NextStep {
  code: string;
  statement: string;
  command: string;
}

interface StatusPayload {
  ok: boolean;
  feature: { id: string; stage: string; services: string[] };
  checks: { ran: boolean; coherent: boolean; errors: number; warnings: number; gating: number };
  verification: { state: string; verdict: string; claims: number; confirmed: number; attested: number };
  next: NextStep[];
}

/**
 * What the three commands say about one feature on one tree.
 *
 * All three are run through the real CLI rather than by calling the core
 * functions: the defect being guarded against was never in a core function, it
 * was in what the command chose to look at, and a test that calls
 * `featureStatus` directly cannot see the difference.
 */
interface Verdicts {
  status: StatusPayload;
  /** `status` claiming everything: nothing outstanding, and the only step left is to ship. */
  shipsIt: boolean;
  validateAccepts: boolean;
  archiveAccepts: boolean;
  codes: string[];
}

async function verdicts(p: Project, feature = FEAT): Promise<Verdicts> {
  const statusRun = await runLoam(p.workDir, "status", feature, "--json");
  const validate = await runLoam(p.workDir, "validate", "--feature", feature, "--json");
  const archive = await runLoam(p.workDir, "archive", feature, "--dry-run", "--json");
  const status = JSON.parse(statusRun.stdout) as StatusPayload;
  // `next[]` is never empty and its last entry is always `next.archive`, so
  // "nothing outstanding" is the archive step standing ALONE — the branch that
  // prints "ship it". Reading the stage alone would miss a feature reported
  // `done` that still lists work above it.
  const only = status.next.length === 1 ? status.next[0] : undefined;
  return {
    status,
    shipsIt:
      status.feature.stage === "done" && only?.code === "next.archive" && only.statement.includes("ship it"),
    validateAccepts: validate.code === 0,
    archiveAccepts: archive.code === 0,
    codes: status.next.map((s) => s.code),
  };
}

/**
 * The invariant. Everything else in this file is a fixture that feeds it.
 *
 * The message names the two gates explicitly because the failure it reports is
 * always the same bug wearing a new code, and the reader's first question is
 * which gate status has run ahead of.
 */
function expectAgreesWithGates(v: Verdicts, tree: string): void {
  if (!v.shipsIt) return;
  expect(
    v.validateAccepts && v.archiveAccepts,
    `status says '${tree}' is ready to ship, but ` +
      `validate --feature ${v.validateAccepts ? "accepts" : "REFUSES"} it and ` +
      `archive --dry-run ${v.archiveAccepts ? "accepts" : "REFUSES"} it. ` +
      "status is a projection over the gates and may only ever be more pessimistic than they are.",
  ).toBe(true);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A record beside the feature, written with the functions `loam verify` itself
 * uses. Hand-rolling the YAML would mean hand-rolling a checklist digest, which
 * is a second implementation of the one thing that decides staleness.
 *
 * `by` is the whole point of several fixtures below: a `scenario.tested` claim
 * answered by an `agent` is somebody's word about a test, and it must not read
 * the same as a `runner`'s digest-matched green run.
 */
async function record(
  p: Project,
  opts: { verdict?: Verdict; by?: AnsweredBy } = {},
): Promise<void> {
  const verdict = opts.verdict ?? "confirmed";
  const checklist = await featureChecklist(p.docsDir, join(p.docsDir, FEAT_DIR), FEAT);
  expect(checklist.claims.length).toBeGreaterThan(0);
  const answers: Answer[] = checklist.claims.map((c) => ({
    id: c.id,
    verdict,
    evidence: verdict === "confirmed" ? ["src/split.ts:12"] : [],
    answered_by: opts.by ?? "runner",
  }));
  await p.write(
    `${FEAT_DIR}/verification.yaml`,
    renderVerification(buildVerification(checklist, answers, "2026-08-01")),
  );
}

/** A requirement with no `#### Scenario:` — an ERROR in `validate --feature`. */
const BARE_REQUIREMENT = `
### Requirement: Reconcile the ledger
The service SHALL reconcile the split ledger nightly.
`;

/**
 * A requirement under a prose heading. Legal OpenSpec, so `validate` grades it
 * valid — and `archive` refuses, because the merge would silently drop it
 * (`delta.requirement-not-merged`, the one warning in the codebase that gates).
 * This is the exact divergence status used to print "ship it" across.
 */
const STRANDED_REQUIREMENT = `
## Behavior

### Requirement: Record the split ledger
The service SHALL record every split in a ledger.

#### Scenario: A ledger entry is written
- **Given** a split
- **When** it is recorded
- **Then** a ledger entry exists
`;

/**
 * One capability requirement, written into BOTH the living document and the
 * feature's delta below — which is what makes the delta an ADDED that lands on
 * a requirement that already exists, and so a gate archive refuses on.
 */
const CAPABILITY_REQUIREMENT = `### Requirement: Refund within five days
Requirement-ID: REF-1
The fleet SHALL return a customer's money within five days.

#### Scenario: A refund is asked for
- **Given** a settled payment
- **When** a refund is requested
- **Then** the money is returned within five days
`;

/* ------------------------------------------------------------------ */

describe("status is never greener than the gates on the same tree", () => {
  it("the relation is not vacuous — a clean tree with a run-answered record does ship", async () => {
    const p = await makeProject(coherentFixture());
    await record(p);
    const v = await verdicts(p);
    expect(v.validateAccepts).toBe(true);
    expect(v.archiveAccepts).toBe(true);
    expect(v.shipsIt).toBe(true);
    expectAgreesWithGates(v, "clean");
    await p.destroy();
  });

  it("a gating WARNING archive refuses on — validate grades it valid, status must not ship it", async () => {
    const p = await makeProject(coherentFixture());
    await record(p);
    await p.write(`${FEAT_DIR}/specs/${SVC}/spec.md`, FEATURE_SPEC + STRANDED_REQUIREMENT);
    await record(p);
    const v = await verdicts(p);

    // The premise: the two gates genuinely disagree here. Without it the case
    // proves nothing, and it is precisely the disagreement status was blind to.
    expect(v.validateAccepts).toBe(true);
    expect(v.archiveAccepts).toBe(false);

    expectAgreesWithGates(v, "gating warning");
    expect(v.shipsIt).toBe(false);
    expect(v.status.feature.stage).toBe("draft");
    expect(v.status.checks.gating).toBeGreaterThan(0);
    expect(v.codes).toContain("next.fix-coherence");
    // And it has to SAY that the gate archive refuses on is one validate calls
    // valid — an author who only reads exit codes never finds out otherwise.
    expect(v.status.next.find((s) => s.code === "next.fix-coherence")!.statement).toMatch(/GATES?/);
    await p.destroy();
  });

  it("a capability delta the archive gate refuses — the business corpus is not a blind spot", async () => {
    // The feature-local capability delta is a SECOND requirements corpus, and
    // status projects over the same gates for both or it projects over half of
    // them. This fixture's delta ADDs a requirement the living capability
    // document already carries: archive refuses (the merge would REPLACE it,
    // scenarios and all), so status may not report the feature ready.
    const p = await makeProject(coherentFixture());
    await p.write(
      "capabilities/refunds/spec.md",
      `# Refunds\n\nA customer can get their money back.\n\n## Requirements\n\n${CAPABILITY_REQUIREMENT}`,
    );
    await p.write(
      `${FEAT_DIR}/capabilities/refunds/spec.md`,
      `# refunds — delta for ${FEAT}\n\n## ADDED Requirements\n\n${CAPABILITY_REQUIREMENT}`,
    );
    await record(p);
    const v = await verdicts(p);

    expect(v.archiveAccepts).toBe(false);
    expectAgreesWithGates(v, "capability delta the gate refuses");
    expect(v.shipsIt).toBe(false);
    expect(v.status.checks.gating).toBeGreaterThan(0);
    await p.destroy();
  });

  it("a requirement with no scenario — validate's error, invisible to status until now", async () => {
    const p = await makeProject(coherentFixture());
    await p.write(`${FEAT_DIR}/specs/${SVC}/spec.md`, FEATURE_SPEC + BARE_REQUIREMENT);
    await record(p);
    const v = await verdicts(p);

    expect(v.validateAccepts).toBe(false);
    expectAgreesWithGates(v, "bare requirement");
    expect(v.status.checks.coherent).toBe(false);
    expect(v.status.checks.errors).toBeGreaterThan(0);
    expect(v.codes).toContain("next.author-scenarios");
    await p.destroy();
  });

  it("intent.md frontmatter that names another feature — the other error source validate runs", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/intent.md`] =
      "---\nfeature: FEAT-999\nstatus: proposed\n---\n\n# Split payments\n\nLet a payment be split.\n";
    const p = await makeProject(files);
    await record(p);
    const v = await verdicts(p);

    expect(v.validateAccepts).toBe(false);
    expectAgreesWithGates(v, "frontmatter mismatch");
    expect(v.status.checks.coherent).toBe(false);
    expect(v.status.checks.errors).toBeGreaterThan(0);
    await p.destroy();
  });

  it("a record answering nothing is not a verified feature", async () => {
    const p = await makeProject(coherentFixture());
    // A record with an empty `claims:` list: `unconfirmed + unanswered === 0`
    // is true of it, which is how it used to read as done. Every reader in
    // verify.ts has always required `claims > 0` as well.
    await p.write(
      `${FEAT_DIR}/verification.yaml`,
      "feature: FEAT-1\nrecorded: 2026-08-01\nchecklist: 0000000000000000\nsummary:\n  claims: 0\n  confirmed: 0\n  unconfirmed: 0\nclaims: []\n",
    );
    const v = await verdicts(p);

    expectAgreesWithGates(v, "zero-claim record");
    expect(v.shipsIt).toBe(false);
    expect(v.status.feature.stage).not.toBe("done");
    expect(v.status.verification.verdict).not.toBe("verified");
    await p.destroy();
  });

  it("a scenario claim confirmed on an agent's word is marked, and does not ship as verified", async () => {
    const p = await makeProject(coherentFixture());
    await record(p, { by: "agent" });
    const v = await verdicts(p);

    expectAgreesWithGates(v, "agent-attested record");
    // The fallback stays, and it is VISIBLE. `verified` is verify's own
    // three-valued verdict, read from its exported helper rather than
    // re-derived here, so status inherits the meaning instead of forking it.
    expect(v.status.verification.verdict).toBe("attested");
    expect(v.status.verification.attested).toBeGreaterThan(0);
    expect(v.shipsIt).toBe(false);
    expect(v.status.feature.stage).toBe("ready");
    expect(v.codes).toContain("next.verify-attested");
    await p.destroy();
  });

  it("a record whose summary contradicts its own claims is never reported at face value", async () => {
    const p = await makeProject(coherentFixture());
    await record(p, { verdict: "unconfirmed" });
    const yaml = await p.read(`${FEAT_DIR}/verification.yaml`);
    // The summary block says everything is confirmed; the claims say otherwise.
    // Reading the block is how `2 of 2 confirmed` appeared beside a record
    // `verify --json` calls unverified.
    const lied = yaml.replace(/^  confirmed: \d+$/m, "  confirmed: 2").replace(/^  unconfirmed: \d+$/m, "  unconfirmed: 0");
    expect(lied).not.toBe(yaml);
    await p.write(`${FEAT_DIR}/verification.yaml`, lied);
    const v = await verdicts(p);

    expectAgreesWithGates(v, "miscounted record");
    expect(v.shipsIt).toBe(false);
    expect(v.status.verification.verdict).not.toBe("verified");
    // Either the reader refuses the file outright or the counts are recounted
    // from `claims:`. What it may never be is the summary's own number.
    expect(v.status.verification.state === "unreadable" || v.status.verification.confirmed === 0).toBe(true);
    await p.destroy();
  });

  it("an unwritten contract for an adopted service is owed, not waved through", async () => {
    const files = coherentFixture();
    // The service directory exists — adopted, spec written, no contract yet —
    // and the feature governs an operation on it. Keying the question on the
    // DIRECTORY answered "none owed" for the very openapi.yaml the same payload
    // reports `spec-api.op-undefined` about.
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(/payment-service/g, SVC);
    delete files[`${FEAT_DIR}/specs/${SVC}/openapi.yaml`];
    const p = await makeProject(files);
    await record(p);
    const v = await verdicts(p);

    expect(v.validateAccepts).toBe(false);
    expectAgreesWithGates(v, "adopted service with no contract");
    const api = (v.status as unknown as { artifacts: Array<Record<string, unknown>> }).artifacts.find(
      (a) => a["id"] === "openapi" && a["service"] === SVC,
    )!;
    expect(api["required"]).toBe(true);
    expect(api["status"]).toBe("missing");
    expect(v.codes).toContain("next.author-openapi");
    await p.destroy();
  });

  it("a feature waiting on another one never ships, whatever the gates say", async () => {
    const files = coherentFixture();
    // A second feature MODIFYING what the first one adds: dependencies.ts calls
    // that an ordering fact, and the blocked one may not archive first.
    files["features/FEAT-2-ledger/intent.md"] =
      "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Ledger\n\nRecord splits.\n";
    files[`features/FEAT-2-ledger/specs/${SVC}/spec.md`] =
      `# ${SVC} — delta for FEAT-2\n\n## MODIFIED Requirements\n\n### Requirement: Split a payment\nThe service SHALL split a payment across payees, and log it.\n\nOperations: createSplit\n\n#### Scenario: Split across two payees\n- **Given** a payment of 100.00\n- **When** it is split 60/40\n- **Then** two shares are recorded and logged\n`;
    const p = await makeProject(files);
    const v = await verdicts(p, "FEAT-2");

    expectAgreesWithGates(v, "blocked feature");
    expect(v.shipsIt).toBe(false);
    expect(v.status.feature.stage).not.toBe("done");
    await p.destroy();
  });
});

describe("status names the implementation half of the flow", () => {
  it("sends the author to `loam delta` and `loam gherkin`, not just to validate", async () => {
    const files = coherentFixture();
    delete files[`${FEAT_DIR}/specs/${SVC}/spec.md`];
    const p = await makeProject(files);
    const payload = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as StatusPayload;

    // The step that states the work to do on a spec is `loam delta` — the
    // command that briefs it. next[] used to name only `validate`, which grades.
    const author = payload.next.find((s) => s.code === "next.author-spec")!;
    expect(author.command).toBe(`loam delta ${FEAT} --service ${SVC} --json`);
    await p.destroy();
  });

  it("names `loam gherkin` wherever there are scenarios and no run has answered them", async () => {
    const p = await makeProject(coherentFixture());
    const payload = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as StatusPayload;
    const test = payload.next.find((s) => s.code === "next.generate-tests")!;
    expect(test.command).toBe(`loam gherkin ${FEAT} --service ${SVC}`);
    // Run from the docs repo, the step has to say whose repository to run it in
    // — `loam gherkin` refuses anywhere else.
    expect(test.statement).toContain(SVC);
    await p.destroy();
  });

  it("binds the recording step to this repository when the config says which service it is", async () => {
    const p = await makeProject(coherentFixture(), { service: SVC });
    await record(p, { verdict: "unconfirmed" });
    const payload = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as StatusPayload;
    const step = payload.next.find((s) => s.code === "next.attest-service")!;
    expect(step.command).toContain(`--service ${SVC}`);
    await p.destroy();
  });
});

describe("the fleet form is navigation, and it always names the gate", () => {
  it("caps next[] and says how many steps it left out", async () => {
    const files = coherentFixture();
    for (let i = 0; i < FLEET_NEXT_LIMIT + 5; i++) {
      // A service directory with a model and no spec.md: undocumented, which is
      // one `next.adopt` each. Fifteen of them is a fleet mid-adoption.
      files[`services/svc-${i}/model.likec4`] = `specification {\n  element softwareSystem\n}\n\nmodel {\n  s${i} = softwareSystem 'svc-${i}'\n}\n`;
    }
    const p = await makeProject(files);
    const payload = JSON.parse((await runLoam(p.workDir, "status", "--json")).stdout) as {
      next: NextStep[];
    };

    const elided = payload.next.find((s) => s.code === "next.elided");
    expect(elided, "a fleet with more steps than the cap must say how many were left out").toBeTruthy();
    expect(elided!.statement).toMatch(/^\d+ more step\(s\)/);
    // The cap, plus the elision notice, plus the gate — nothing else.
    expect(payload.next.length).toBe(FLEET_NEXT_LIMIT + 2);
    await p.destroy();
  });

  it("sends a repository with work in it to `loam validate --all` — the command CI runs", async () => {
    const p = await makeProject(coherentFixture());
    const payload = JSON.parse((await runLoam(p.workDir, "status", "--json")).stdout) as {
      next: NextStep[];
    };
    const last = payload.next.at(-1)!;
    expect(last.code).toBe("next.fleet-gate");
    expect(last.command).toBe("loam validate --all --json");
    await p.destroy();
  });

  it("reports a documented service that nothing models — the fleet gate's own complaint", async () => {
    const files = coherentFixture();
    delete files["services/payment-service/model.likec4"];
    const p = await makeProject(files);
    const payload = JSON.parse((await runLoam(p.workDir, "status", "--json")).stdout) as {
      next: NextStep[];
    };
    expect(payload.next.map((s) => s.code)).toContain("next.complete-service");
    await p.destroy();
  });
});

describe("an unreadable artifact is a refusal that names something", () => {
  /**
   * A directory where a file belongs is the commonest way a docs repo is
   * malformed, and Node reports reading one as EISDIR with NO `path` — which
   * is exactly the shape the catch block used to rethrow. One such directory
   * killed both forms of `status` with a bare `internal: EISDIR`, naming
   * neither the file nor the feature, and taking every other feature with it.
   */
  async function withDirectoryForFile(rel: string): Promise<Project> {
    const files = coherentFixture();
    delete files[rel];
    const p = await makeProject(files);
    await mkdir(join(p.docsDir, rel), { recursive: true });
    return p;
  }

  it("refuses with a code and names the feature instead of throwing EISDIR", async () => {
    const p = await withDirectoryForFile(`${FEAT_DIR}/intent.md`);
    const run = await runLoam(p.workDir, "status", FEAT, "--json");
    const payload = JSON.parse(run.stdout) as { ok: boolean; error: { code: string; message: string } };

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("repository-unavailable");
    expect(payload.error.code).not.toBe("internal");
    expect(payload.error.message).toContain(FEAT);
    expect(payload.error.message).toContain("EISDIR");
    await p.destroy();
  });

  it("says the same thing in the human view rather than printing a stack", async () => {
    const p = await withDirectoryForFile(`${FEAT_DIR}/intent.md`);
    const run = await runLoam(p.workDir, "status", FEAT);
    expect(run.out).toContain(FEAT);
    expect(run.out).not.toContain("at Object.");
    await p.destroy();
  });

  it("one malformed feature does not take the others down", async () => {
    const p = await withDirectoryForFile(`${FEAT_DIR}/intent.md`);
    await p.write(
      "features/FEAT-2-ledger/intent.md",
      "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Ledger\n\nRecord splits.\n",
    );
    const run = await runLoam(p.workDir, "status", "FEAT-2", "--json");
    const payload = JSON.parse(run.stdout) as { ok: boolean };
    expect(payload.ok).toBe(true);
    await rm(join(p.docsDir, FEAT_DIR, "intent.md"), { recursive: true });
    await p.destroy();
  });
});
