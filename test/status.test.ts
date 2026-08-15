/**
 * `loam status` — the projection over the files.
 *
 * Two properties are load-bearing and every other test here exists to protect
 * them. The command WRITES NOTHING, ever, in any mode — checked against a tree
 * hash rather than by inspection, so a future edit that starts caching a
 * derivation on disk fails here. And it REPORTS rather than gates: an
 * incomplete, incoherent, blocked feature still exits 0, because an agent runs
 * this command precisely because work is outstanding, and a non-zero exit would
 * make `set -e` and CI read "there is work to do" as a failure.
 *
 * The rest is the contract: the status vocabulary is closed, `next[]` is
 * ordered and never empty, and every entry carries a stable code and a literal
 * command.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  coherentFixture,
  makeProject,
  pinFor,
  runLoam,
  treeHashes,
  FEATURE_DELTA,
  FEATURE_OPENAPI,
  FEATURE_SPEC,
  LIVING_OPENAPI,
  LIVING_SPEC,
  SERVICE_MODEL,
  type Project,
} from "./helpers/harness.js";
import { COMMIT_INTENT } from "../src/core/staging.js";
import { ARTIFACT_STATUSES } from "../src/core/status/report.js";
import { buildVerification, featureChecklist, renderVerification, type Answer } from "../src/core/verify.js";

const FEAT_DIR = "features/FEAT-1-split";

interface NextStep {
  code: string;
  statement: string;
  command: string;
  artifact?: string;
  service?: string;
  path?: string;
}

interface Artifact {
  id: string;
  service: string | null;
  path: string;
  exists: boolean;
  required: boolean;
  status: string;
  blockedBy: string[];
}

async function statusJson(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const run = await runLoam(p.workDir, "status", ...args, "--json");
  return { ...JSON.parse(run.stdout), __code: run.code };
}

function codes(next: NextStep[]): string[] {
  return next.map((s) => s.code);
}

function artifact(payload: Record<string, any>, id: string, service?: string): Artifact {
  const found = (payload["artifacts"] as Artifact[]).find(
    (a) => a.id === id && (service === undefined || a.service === service),
  );
  if (!found) throw new Error(`no artifact '${id}'${service ? ` for ${service}` : ""}`);
  return found;
}

/**
 * A complete, current verification record beside the feature, written with the
 * very functions `loam verify --record` uses. Hand-rolling the YAML would mean
 * hand-rolling a checklist digest, which is a second implementation of the one
 * thing that decides whether a record is stale.
 */
async function recordVerification(
  p: Project,
  featureId: string,
  verdict: "confirmed" | "unconfirmed" = "confirmed",
): Promise<void> {
  const featureDir = join(p.docsDir, FEAT_DIR);
  const checklist = await featureChecklist(p.docsDir, featureDir, featureId);
  expect(checklist.claims.length).toBeGreaterThan(0);
  const answers: Answer[] = checklist.claims.map((c) => ({
    id: c.id,
    verdict,
    evidence: verdict === "confirmed" ? ["src/split.ts:12"] : [],
    // This helper exists to model a COMPLETE verification, and that means a
    // green run: a scenario claim answered by an agent reads as
    // `attested`, never `verified`, so the feature would never reach `done`.
    answered_by: "runner",
  }));
  await p.write(
    `${FEAT_DIR}/verification.yaml`,
    renderVerification(buildVerification(checklist, answers, "2026-08-01")),
  );
}

describe("loam status reports; it never writes and never gates", () => {
  it("writes nothing, in either scope and either mode", async () => {
    const p = await makeProject(coherentFixture());
    const before = await treeHashes(p.docsDir);
    for (const args of [
      ["status"],
      ["status", "--json"],
      ["status", "FEAT-1"],
      ["status", "FEAT-1", "--json"],
      ["status", "FEAT-1", "--service", "payment-split-service", "--json"],
    ]) {
      await runLoam(p.workDir, ...args);
    }
    expect(await treeHashes(p.docsDir)).toEqual(before);
    await p.destroy();
  });

  it("exits 0 on a feature that is incomplete AND incoherent — reporting is not gating", async () => {
    const files = coherentFixture();
    // A delta that does not parse: `validate --feature` exits 1 on exactly this.
    files[`${FEAT_DIR}/delta.likec4`] = "model { this is not likec4 (((";
    delete files[`${FEAT_DIR}/intent.md`];
    const p = await makeProject(files);

    const validate = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
    expect(validate.code).toBe(1);

    const status = await runLoam(p.workDir, "status", "FEAT-1", "--json");
    expect(status.code).toBe(0);
    const payload = JSON.parse(status.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.checks.coherent).toBe(false);
    expect(payload.feature.stage).toBe("missing");
    expect(codes(payload.next)).toContain("next.fix-coherence");
    await p.destroy();
  });

  it("still exits 0 in the human view", async () => {
    const files = coherentFixture();
    delete files[`${FEAT_DIR}/specs/payment-split-service/spec.md`];
    const p = await makeProject(files);
    const run = await runLoam(p.workDir, "status", "FEAT-1");
    expect(run.code).toBe(0);
    await p.destroy();
  });
});

describe("the feature payload", () => {
  it("lists every artifact with its status, path and whether it is owed", async () => {
    const p = await makeProject(coherentFixture());
    const payload = await statusJson(p, "FEAT-1");

    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("status");
    expect(payload.scope).toBe("feature");
    expect(payload.feature).toMatchObject({
      id: "FEAT-1",
      dirName: "FEAT-1-split",
      path: FEAT_DIR,
      archived: false,
      services: ["payment-split-service"],
      blockedBy: [],
    });
    expect(payload.service).toBeNull();

    // Every status value the payload can carry is from the closed set.
    for (const a of payload.artifacts as Artifact[]) {
      expect(ARTIFACT_STATUSES as readonly string[]).toContain(a.status);
      expect(a.path.startsWith(FEAT_DIR)).toBe(true);
      expect(a.path).not.toContain("\\");
    }

    expect(artifact(payload, "intent")).toMatchObject({
      status: "done",
      exists: true,
      required: true,
      path: `${FEAT_DIR}/intent.md`,
    });
    // payment-split-service does not exist in the living docs, so this feature
    // is the only thing that can give it a contract: the openapi is required.
    expect(artifact(payload, "openapi", "payment-split-service")).toMatchObject({
      required: true,
      exists: true,
      status: "done",
    });
    // arch.spec.md is optional everywhere: absent is not a defect, and `exists`
    // is what tells a reader there is no file.
    expect(artifact(payload, "arch-spec", "payment-split-service")).toMatchObject({
      required: false,
      exists: false,
      status: "done",
    });

    expect(payload.checks).toMatchObject({ ran: true, coherent: true, errors: 0, gating: 0 });
    expect(payload.verification).toMatchObject({ state: "absent", recorded: null, claims: 0 });
    await p.destroy();
  });

  it("every next step carries a stable code, a sentence and a literal command", async () => {
    const p = await makeProject(coherentFixture());
    const payload = await statusJson(p, "FEAT-1");
    expect(payload.next.length).toBeGreaterThan(0);
    for (const step of payload.next as NextStep[]) {
      expect(step.code).toMatch(/^next\.[a-z-]+$/);
      expect(step.statement.length).toBeGreaterThan(10);
      expect(step.command.startsWith("loam ")).toBe(true);
    }
    await p.destroy();
  });

  it("never returns an empty next[] — a finished feature's next step is to ship it", async () => {
    const p = await makeProject(coherentFixture());
    await recordVerification(p, "FEAT-1");
    const payload = await statusJson(p, "FEAT-1");

    expect(payload.feature.stage).toBe("done");
    expect(codes(payload.next)).toEqual(["next.archive"]);
    expect(payload.next[0].command).toBe("loam archive FEAT-1 --dry-run --json");
    expect(payload.next[0].statement).toContain("ship it");
    await p.destroy();
  });
});

describe("the status vocabulary answers a different question per value", () => {
  it("missing — the artifact is owed and nothing stands in the way", async () => {
    const files = coherentFixture();
    delete files[`${FEAT_DIR}/intent.md`];
    const p = await makeProject(files);
    const payload = await statusJson(p, "FEAT-1");

    expect(artifact(payload, "intent")).toMatchObject({ status: "missing", exists: false });
    expect(payload.feature.stage).toBe("missing");
    const step = (payload.next as NextStep[])[0]!;
    expect(step.code).toBe("next.author-intent");
    expect(step.path).toBe(`${FEAT_DIR}/intent.md`);
    expect(step.artifact).toBe("intent");
    await p.destroy();
  });

  it("missing — a new service with no contract of its own", async () => {
    const files = coherentFixture();
    delete files[`${FEAT_DIR}/specs/payment-split-service/openapi.yaml`];
    const p = await makeProject(files);
    const payload = await statusJson(p, "FEAT-1");

    expect(artifact(payload, "openapi", "payment-split-service")).toMatchObject({
      status: "missing",
      required: true,
    });
    const step = (payload.next as NextStep[]).find((s) => s.code === "next.author-openapi")!;
    expect(step.service).toBe("payment-split-service");
    expect(step.command).toBe("loam delta FEAT-1 --service payment-split-service --json");
    await p.destroy();
  });

  it("done — an optional artifact a feature does not owe is not a hole", async () => {
    // payment-service exists in the living docs, so a delta touching it owes no
    // openapi.yaml at all; delta.likec4 is optional for a requirements-only change.
    const p = await makeProject({
      "architecture/landscape.likec4": coherentFixture()["architecture/landscape.likec4"]!,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      [`${FEAT_DIR}/intent.md`]: "---\nfeature: FEAT-1\n---\n\n# Split\n",
      [`${FEAT_DIR}/specs/payment-service/spec.md`]: FEATURE_SPEC.replace(
        "payment-split-service",
        "payment-service",
      ),
    });
    const payload = await statusJson(p, "FEAT-1");
    expect(artifact(payload, "delta")).toMatchObject({ status: "done", exists: false, required: false });
    expect(artifact(payload, "openapi", "payment-service")).toMatchObject({
      status: "done",
      exists: false,
      required: false,
    });
    await p.destroy();
  });

  it("draft — the file is on disk and a shared check reports an error against it", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/delta.likec4`] = "model { broken (((";
    const p = await makeProject(files);
    const payload = await statusJson(p, "FEAT-1");

    expect(artifact(payload, "delta")).toMatchObject({ status: "draft", exists: true });
    expect(payload.checks.coherent).toBe(false);
    expect(payload.feature.stage).toBe("draft");
    // The issue arrives in validate's own serialization, so one breach is one
    // shape wherever it is reported.
    expect(payload.checks.issues[0]).toMatchObject({ severity: "error", code: "delta.invalid" });
    expect(payload.checks.issues[0]).toHaveProperty("details");
    const step = (payload.next as NextStep[]).find((s) => s.code === "next.fix-coherence")!;
    expect(step.command).toBe("loam validate FEAT-1 --json");
    await p.destroy();
  });

  it("blocked — a record cannot be authored before there is anything to derive a checklist from", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": coherentFixture()["architecture/landscape.likec4"]!,
      "services/payment-service/spec.md": LIVING_SPEC,
      [`${FEAT_DIR}/intent.md`]: "---\nfeature: FEAT-1\n---\n\n# Split\n",
    });
    const payload = await statusJson(p, "FEAT-1");

    const record = artifact(payload, "verification");
    expect(record.status).toBe("blocked");
    expect(record.blockedBy).toContain("spec");
    // The feature touches nothing at all, which is its own step.
    expect(codes(payload.next)).toContain("next.touch-service");
    expect(payload.feature.stage).toBe("missing");
    await p.destroy();
  });

  it("blocked — another feature in flight has to archive first", async () => {
    const files = coherentFixture();
    // FEAT-2 MODIFIES the requirement FEAT-1 adds: FEAT-1 has to land first.
    files["features/FEAT-2-later/intent.md"] = "---\nfeature: FEAT-2\n---\n\n# Later\n";
    files["features/FEAT-2-later/specs/payment-split-service/spec.md"] =
      `# payment-split-service — delta for FEAT-2\n\n` +
      `## MODIFIED Requirements\n\n### Requirement: Split a payment\nThe service SHALL split differently.\n\n` +
      `#### Scenario: Split across three payees\n- **Given** a payment\n- **When** split\n- **Then** three shares\n`;
    const p = await makeProject(files);
    const payload = await statusJson(p, "FEAT-2");

    expect(payload.feature.blockedBy).toEqual(["FEAT-1"]);
    expect(payload.feature.stage).toBe("blocked");
    const step = (payload.next as NextStep[]).find((s) => s.code === "next.archive-first")!;
    expect(step.statement).toContain("FEAT-1");
    expect(step.command).toBe("loam dependencies FEAT-2 --json");
    await p.destroy();
  });

  it("ready — the documents hold up and the obligation is outside them", async () => {
    const p = await makeProject(coherentFixture());
    await recordVerification(p, "FEAT-1", "unconfirmed");
    const payload = await statusJson(p, "FEAT-1");

    expect(artifact(payload, "verification")).toMatchObject({ status: "ready", exists: true });
    expect(payload.feature.stage).toBe("ready");
    expect(payload.verification).toMatchObject({ state: "recorded", confirmed: 0, recorded: "2026-08-01" });
    const step = (payload.next as NextStep[]).find((s) => s.code === "next.verify-unconfirmed")!;
    expect(step.command).toBe("loam verify FEAT-1 --json");
    await p.destroy();
  });
});

describe("the verification record is read, never re-derived speculatively", () => {
  it("absent — the step is to start verifying", async () => {
    const p = await makeProject(coherentFixture());
    const payload = await statusJson(p, "FEAT-1");
    expect(artifact(payload, "verification").status).toBe("missing");
    expect(codes(payload.next)).toContain("next.verify");
    await p.destroy();
  });

  it("stale — the feature moved after the answers were written", async () => {
    const p = await makeProject(coherentFixture());
    await recordVerification(p, "FEAT-1");
    // Re-word a scenario: the claim ids change, so the record answers a
    // checklist nobody is asking any more.
    await p.write(
      `${FEAT_DIR}/specs/payment-split-service/spec.md`,
      FEATURE_SPEC.replace("two shares are recorded", "three shares are recorded"),
    );
    const payload = await statusJson(p, "FEAT-1");

    expect(payload.verification.state).toBe("stale");
    expect(artifact(payload, "verification").status).toBe("draft");
    const step = (payload.next as NextStep[]).find((s) => s.code === "next.verify")!;
    expect(step.statement).toContain("moved");
    await p.destroy();
  });

  it("unreadable — the file is never reported as absent", async () => {
    const p = await makeProject(coherentFixture());
    await p.write(`${FEAT_DIR}/verification.yaml`, "this: [is not, a record\n");
    const payload = await statusJson(p, "FEAT-1");

    expect(payload.verification.state).toBe("unreadable");
    expect(artifact(payload, "verification")).toMatchObject({ status: "draft", exists: true });
    await p.destroy();
  });
});

describe("features that need a scenario, a pin, or a service", () => {
  it("next.author-scenarios names the count and the first requirement, once per file", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/specs/payment-split-service/spec.md`] =
      `# payment-split-service — delta for FEAT-1\n\n## ADDED Requirements\n\n` +
      `### Requirement: Split a payment\nThe service SHALL split.\n\nOperations: createSplit\n\n` +
      `### Requirement: Audit a split\nThe service SHALL audit.\n`;
    const p = await makeProject(files);
    const payload = await statusJson(p, "FEAT-1");

    const steps = (payload.next as NextStep[]).filter((s) => s.code === "next.author-scenarios");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.statement).toContain("2 requirement(s)");
    expect(steps[0]!.statement).toContain("Split a payment");
    expect(steps[0]!.service).toBe("payment-split-service");
    await p.destroy();
  });

  it("next.rebase fires on a MODIFIED requirement with no Based-On:, and clears once pinned", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/specs/payment-service/spec.md`] =
      `# payment-service — delta for FEAT-1\n\n## MODIFIED Requirements\n\n` +
      `### Requirement: Authorize a payment\nThe service SHALL authorize twice.\n\nOperations: authorizePayment\n\n` +
      `#### Scenario: Successful authorization\n- **Given** a card\n- **When** asked\n- **Then** authorized\n`;
    const p = await makeProject(files);
    expect(codes((await statusJson(p, "FEAT-1")).next)).toContain("next.rebase");

    const pin = pinFor(LIVING_SPEC, "Authorize a payment");
    await p.write(
      `${FEAT_DIR}/specs/payment-service/spec.md`,
      files[`${FEAT_DIR}/specs/payment-service/spec.md`]!.replace(
        "The service SHALL authorize twice.",
        `Based-On: ${pin}\n\nThe service SHALL authorize twice.`,
      ),
    );
    expect(codes((await statusJson(p, "FEAT-1")).next)).not.toContain("next.rebase");
    await p.destroy();
  });
});

describe("--service narrows the view without moving the verdict", () => {
  it("narrows the artifact table and the per-service steps", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/delta.likec4`] = FEATURE_DELTA;
    files[`${FEAT_DIR}/specs/payment-service/spec.md`] = FEATURE_SPEC.replace(
      "payment-split-service",
      "payment-service",
    );
    const p = await makeProject(files);

    const all = await statusJson(p, "FEAT-1");
    expect(all.feature.services).toEqual(["payment-service", "payment-split-service"]);
    expect(all.service).toBeNull();

    const one = await statusJson(p, "FEAT-1", "--service", "payment-split-service");
    expect(one.service).toBe("payment-split-service");
    // The feature's own service list stays complete — a narrowed view that also
    // hid the other services would read as a feature that touches one.
    expect(one.feature.services).toEqual(["payment-service", "payment-split-service"]);
    const services = new Set((one.artifacts as Artifact[]).map((a) => a.service));
    expect(services).toEqual(new Set([null, "payment-split-service"]));
    await p.destroy();
  });

  it("the feature's stage is graded over every service, not just the one in view", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/specs/payment-service/.keep`] = "";
    const p = await makeProject(files);
    // payment-service has a specs/ directory and no spec.md at all: the feature
    // is `missing` regardless of which service the reader asked about.
    const narrowed = await statusJson(p, "FEAT-1", "--service", "payment-split-service");
    expect(narrowed.feature.stage).toBe("missing");
    expect((narrowed.artifacts as Artifact[]).every((a) => a.service !== "payment-service")).toBe(true);
    await p.destroy();
  });

  it("refuses a service the feature does not touch", async () => {
    const p = await makeProject(coherentFixture());
    const run = await runLoam(p.workDir, "status", "FEAT-1", "--service", "nope", "--json");
    expect(run.code).toBe(1);
    const payload = JSON.parse(run.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("unknown-service");
    expect(payload.error.message).toContain("payment-split-service");
    await p.destroy();
  });
});

describe("the fleet payload", () => {
  it("counts the services, stages every feature, and hands off per feature", async () => {
    const files = coherentFixture();
    files["services/orphan-service/model.likec4"] =
      "specification { element softwareSystem }\nmodel { s = softwareSystem 'orphan-service' }\n";
    const p = await makeProject(files);
    const payload = await statusJson(p);

    expect(payload.scope).toBe("fleet");
    expect(payload.service).toBeNull();
    expect(payload.services).toEqual({ total: 2, undocumented: 1, draft: 1, vouched: 0 });
    expect(payload.features).toHaveLength(1);
    expect(payload.features[0]).toMatchObject({
      id: "FEAT-1",
      dirName: "FEAT-1-split",
      path: FEAT_DIR,
      stage: "ready",
      missing: [],
    });
    expect(payload.order).toEqual(["FEAT-1"]);

    // `next.fleet-gate` is always last while anything is in flight: it names
    // the command CI runs, which the fleet form never used to mention.
    expect(codes(payload.next)).toEqual(["next.adopt", "next.feature", "next.fleet-gate"]);
    expect((payload.next as NextStep[])[0]!.command).toBe("loam adopt --service orphan-service --json");
    expect((payload.next as NextStep[])[1]!.command).toBe("loam status FEAT-1 --json");
    expect((payload.next as NextStep[]).at(-1)!.command).toBe("loam validate --all --json");
    await p.destroy();
  });

  it("counts a vouched service separately from a merely documented one", async () => {
    const files = coherentFixture();
    files["services/payment-service/spec.md"] = LIVING_SPEC.replace(
      "status: verified",
      "status: verified\nsources:\n  - src/\nsources_digest: abc123",
    );
    const p = await makeProject(files);
    expect((await statusJson(p)).services).toEqual({
      total: 1,
      undocumented: 0,
      draft: 0,
      vouched: 1,
    });
    await p.destroy();
  });

  it("orders the steps most-unblocking first: ship what is done before authoring what is not", async () => {
    const files = coherentFixture();
    files["features/FEAT-9-bare/specs/payment-service/.keep"] = "";
    const p = await makeProject(files);
    await recordVerification(p, "FEAT-1");
    const payload = await statusJson(p);

    expect(codes(payload.next)).toEqual(["next.archive", "next.feature", "next.fleet-gate"]);
    expect((payload.next as NextStep[])[0]!.command).toBe("loam archive FEAT-1 --dry-run --json");
    const later = (payload.features as Array<Record<string, any>>).find((f) => f.id === "FEAT-9")!;
    expect(later.stage).toBe("missing");
    expect(later.missing).toContain("intent");
    await p.destroy();
  });

  it("says so explicitly when there is nothing outstanding", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": coherentFixture()["architecture/landscape.likec4"]!,
      "services/payment-service/spec.md": LIVING_SPEC,
      // A spec with no model.likec4 is an incomplete service, which is itself
      // outstanding work (`next.complete-service`) — so the fixture has to be
      // complete for "nothing outstanding" to be the thing under test.
      "services/payment-service/model.likec4": SERVICE_MODEL,
    });
    const payload = await statusJson(p);
    expect(payload.features).toEqual([]);
    expect(codes(payload.next)).toEqual(["next.fleet-clean"]);
    expect((payload.next as NextStep[])[0]!.command).toBe("loam validate --all --json");
    await p.destroy();
  });

  it("--service narrows the fleet to one service and the features touching it", async () => {
    const files = coherentFixture();
    files["services/other-service/spec.md"] = LIVING_SPEC.replace("payment-service", "other-service");
    const p = await makeProject(files);

    const narrowed = await statusJson(p, "--service", "other-service");
    expect(narrowed.service).toBe("other-service");
    expect(narrowed.services.total).toBe(1);
    expect(narrowed.features).toEqual([]);

    const run = await runLoam(p.workDir, "status", "--service", "nope", "--json");
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).error.code).toBe("unknown-service");
    await p.destroy();
  });
});

/**
 * The journal `loam archive` writes before its first swap, as a killed run
 * leaves it: version 1, a command, a restore direction, and the files whose
 * bytes are now of unknown provenance. Written by hand rather than by killing a
 * real commit because the question under test is what `status` READS off it —
 * write-path-integrity.test.ts owns the other half, that archive puts it there
 * and repairs from it.
 */
const INTERRUPTED_ARCHIVE = {
  version: 1,
  command: "archive",
  restore: "before",
  pid: 4242,
  host: "build-box",
  at: "2026-08-01T10:00:00.000Z",
  feature: "FEAT-1",
  moveFrom: FEAT_DIR,
  moveTo: "features/archive/FEAT-1-split",
  files: [{ path: "services/payment-service/spec.md", before: null, after: null }],
};

describe("an interrupted commit outranks every other answer", () => {
  it("stages every feature `blocked` and leads with the repair, in both forms", async () => {
    const p = await makeProject(coherentFixture());
    // Without the journal this repository is finished and its one step is "ship
    // it" — which is precisely the answer a half-written commit must not be
    // allowed to give, in either form.
    await recordVerification(p, "FEAT-1");
    expect((await statusJson(p, "FEAT-1")).feature.stage).toBe("done");
    expect((await statusJson(p)).features[0].stage).toBe("done");

    await p.write(COMMIT_INTENT, JSON.stringify(INTERRUPTED_ARCHIVE, null, 2) + "\n");

    const feature = await statusJson(p, "FEAT-1");
    expect(feature.feature.stage).toBe("blocked");
    expect((feature.next as NextStep[])[0]!.code).toBe("next.recover-commit");
    expect((feature.next as NextStep[])[0]!.command).toBe("loam archive FEAT-1");
    expect(feature.interrupted).toMatchObject({ command: "archive", feature: "FEAT-1", unreadable: false });

    // The fleet form is the one that used to disagree: it read presence only,
    // saw every artifact on disk, and answered `done` over the same repo.
    const fleet = await statusJson(p);
    expect(fleet.features[0].stage).toBe("blocked");
    expect((fleet.next as NextStep[])[0]!.code).toBe("next.recover-commit");
    expect(codes(fleet.next)).not.toContain("next.archive");
    // `blocked` with no blocker named: the repository is what the work waits
    // on, and the recover step above already says so. Keying this sentence off
    // the stage alone printed "FEAT-1 is waiting on ."
    const line = (fleet.next as NextStep[]).find((s) => s.code === "next.feature")!;
    expect(line.statement).toBe("FEAT-1 is at 'blocked'.");
    await p.destroy();
  });

  it("reports who and when as null when the journal omits them, rather than dropping the keys", async () => {
    const p = await makeProject(coherentFixture());
    // A journal that parses — `readCommitIntent` validates only the fields a
    // repair needs — and carries none of the three labels a reader places the
    // crash against. `JSON.stringify` drops an undefined value, so an uncoerced
    // field left `--json` with no field at all and printed the word "undefined"
    // at a human.
    await p.write(
      COMMIT_INTENT,
      JSON.stringify({ ...INTERRUPTED_ARCHIVE, host: undefined, pid: undefined, at: undefined }, null, 2) + "\n",
    );

    const payload = await statusJson(p, "FEAT-1");
    expect(payload.interrupted).toMatchObject({ command: "archive", host: null, pid: null, at: null });
    expect(Object.keys(payload.interrupted)).toEqual(expect.arrayContaining(["host", "pid", "at"]));

    const run = await runLoam(p.workDir, "status", "FEAT-1");
    expect(run.stdout).not.toContain("pid undefined");
    await p.destroy();
  });
});

describe("archived features and unknown targets", () => {
  it("an archived feature is answered with 'it shipped', not 'no such feature'", async () => {
    const files = coherentFixture();
    const p = await makeProject(files);
    const archive = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(archive.code).toBe(0);

    const payload = await statusJson(p, "FEAT-1");
    expect(payload.feature.archived).toBe(true);
    expect(payload.feature.stage).toBe("done");
    // Nothing is re-graded: the delta is already folded into the living docs.
    expect(payload.checks).toMatchObject({ ran: false, coherent: true, errors: 0, issues: [] });
    expect(payload.feature.blockedBy).toEqual([]);
    expect(codes(payload.next)).toEqual(["next.archived"]);
    expect((payload.next as NextStep[])[0]!.command).toBe("loam show FEAT-1 --json");
    await p.destroy();
  });

  it("refuses a feature that does not exist", async () => {
    const p = await makeProject(coherentFixture());
    const run = await runLoam(p.workDir, "status", "FEAT-404", "--json");
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).error.code).toBe("unknown-target");
    await p.destroy();
  });

  it("refuses when there is no loam.json, and when docsDir points at nothing", async () => {
    const p = await makeProject(coherentFixture());
    const noConfig = await runLoam(p.docsDir, "status", "--json");
    expect(noConfig.code).toBe(1);
    expect(JSON.parse(noConfig.stdout).error.code).toBe("no-config");

    const gone = await makeProject({});
    await gone.destroy();
    const run = await runLoam(gone.workDir, "status", "--json").catch(() => null);
    expect(run === null || run.code === 1).toBe(true);
    await p.destroy();
  });

  it("refuses a docsDir that is not a docs repo rather than reporting an empty fleet", async () => {
    const p = await makeProject({ "notes.md": "# not a docs repo\n" });
    const run = await runLoam(p.workDir, "status", "--json");
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).error.code).toBe("services-missing");
    await p.destroy();
  });
});

describe("the human view", () => {
  it("prints the artifact table, the findings and the numbered steps with their command", async () => {
    const files = coherentFixture();
    files[`${FEAT_DIR}/delta.likec4`] = "model { broken (((";
    const p = await makeProject(files);
    const run = await runLoam(p.workDir, "status", "FEAT-1");

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("loam status FEAT-1 — draft");
    expect(run.stdout).toContain("artifacts");
    expect(run.stdout).toContain(`${FEAT_DIR}/intent.md`);
    // An artifact that is `done` because none is owed says so — `done` beside a
    // path that does not exist is the one row a reader misreads.
    expect(run.stdout).toContain("(not written — none owed)");
    expect(run.stdout).toContain("findings");
    expect(run.stdout).toContain("✗ delta.invalid:");
    // The command sits on its own line under the statement, doctor's layout.
    expect(run.stdout).toMatch(/next\.fix-coherence: .*\n\s+run: loam validate FEAT-1 --json/);
    await p.destroy();
  });

  it("prints the fleet rollup, the ordering and the per-feature stage", async () => {
    const files = coherentFixture();
    files["features/FEAT-2-later/intent.md"] = "---\nfeature: FEAT-2\n---\n\n# Later\n";
    files["features/FEAT-2-later/specs/payment-split-service/spec.md"] =
      `# payment-split-service — delta for FEAT-2\n\n## MODIFIED Requirements\n\n` +
      `### Requirement: Split a payment\nThe service SHALL split differently.\n\n` +
      `#### Scenario: Split across three\n- **Given** a payment\n- **When** split\n- **Then** shares\n`;
    const p = await makeProject(files);
    const run = await runLoam(p.workDir, "status");

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("1 service(s) · 2 feature(s) in flight");
    expect(run.stdout).toContain("undocumented");
    expect(run.stdout).toContain("order         FEAT-1 → FEAT-2");
    expect(run.stdout).toContain("waiting on FEAT-1");
    expect(run.stdout).toMatch(/next\.feature: .*\n\s+run: loam status FEAT-\d+ --json/);
    await p.destroy();
  });

  it("names the service in the narrowed view and the record in the verification line", async () => {
    const p = await makeProject(coherentFixture());
    await recordVerification(p, "FEAT-1");
    const run = await runLoam(p.workDir, "status", "FEAT-1", "--service", "payment-split-service");
    expect(run.stdout).toContain("narrowed to   payment-split-service");
    // The line now carries verify's own verdict beside the state.
    expect(run.stdout).toMatch(/verification\s+recorded · verified\s+\d+\/\d+ confirmed/);
    expect(run.stdout).toContain("(recorded 2026-08-01)");
    await p.destroy();
  });
});

describe("status is a projection, not a second opinion", () => {
  it("agrees with `loam validate --feature` about whether the feature is coherent", async () => {
    for (const [delta, coherent] of [
      [FEATURE_DELTA, true],
      ["model { broken (((", false],
    ] as const) {
      const files = coherentFixture();
      files[`${FEAT_DIR}/delta.likec4`] = delta;
      const p = await makeProject(files);

      const validate = JSON.parse((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).stdout);
      const status = await statusJson(p, "FEAT-1");
      expect(status.checks.coherent).toBe(coherent);
      expect(validate.valid).toBe(coherent);
      await p.destroy();
    }
  });

  it("agrees with `loam dependencies` about which feature has to land first", async () => {
    const files = coherentFixture();
    files["features/FEAT-2-later/intent.md"] = "---\nfeature: FEAT-2\n---\n\n# Later\n";
    files["features/FEAT-2-later/specs/payment-split-service/openapi.yaml"] = FEATURE_OPENAPI;
    files["features/FEAT-2-later/specs/payment-split-service/spec.md"] =
      `# payment-split-service — delta for FEAT-2\n\n## MODIFIED Requirements\n\n` +
      `### Requirement: Split a payment\nThe service SHALL split differently.\n\n` +
      `#### Scenario: Split across three\n- **Given** a payment\n- **When** split\n- **Then** shares\n`;
    const p = await makeProject(files);

    const deps = JSON.parse((await runLoam(p.workDir, "dependencies", "--json")).stdout);
    const fleet = await statusJson(p);
    expect(fleet.order).toEqual(deps.order);
    const later = (fleet.features as Array<Record<string, any>>).find((f) => f.id === "FEAT-2")!;
    const node = (deps.nodes as Array<Record<string, any>>).find((n) => n.id === "FEAT-2")!;
    expect(later.blockedBy).toEqual(node.dependsOn);
    await p.destroy();
  });
});
