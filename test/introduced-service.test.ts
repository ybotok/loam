/**
 * A service an ACTIVE feature introduces — `features/<FEAT>/specs/<svc>/` and no
 * `services/<svc>/` until the feature archives — answered by the three read
 * commands that used to refuse it as unknown.
 *
 * `loam tasks` already listed work for such a service while `loam show <svc>`
 * said "No service or feature", `loam context <svc>` said `unknown-service`, and
 * `loam steps --service <svc>` told its implementer to `loam adopt` code that
 * does not exist yet. Each now answers from the introducing feature's delta and
 * says, in both renderings, that the service is not in the living docs.
 *
 * Pinned beside the new answers: a name that is neither living nor introduced
 * still gets today's refusal byte for byte (only the near-miss hint may now
 * name an introduced service), and a living service's payload carries none of
 * the new keys.
 *
 * The canonical fixture is the case: FEAT-1 introduces payment-split-service,
 * and payment-service is living.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FEATURE_SPEC,
  coherentFixture,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-split-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(
  files: Record<string, string>,
  opts: { service?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

/** A second active feature that introduces the same service — the conflict case. */
function twoIntroducers(): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-2-split-again/intent.md":
      "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Split again\n\nA rival take on splitting.\n",
    "features/FEAT-2-split-again/specs/payment-split-service/spec.md": FEATURE_SPEC.replace(
      "### Requirement: Split a payment",
      "### Requirement: Split a payment evenly",
    ),
  };
}

describe("loam show <introduced service>", () => {
  it("shows the feature delta instead of refusing, and says the service is not living", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "show", SVC);
    expect(res.code).toBe(0);
    expect(res.out).toContain(`${SVC}   introduced by FEAT-1 (in flight) — not in the living docs until it archives`);
    expect(res.out).toContain(`FEAT-1   features/FEAT-1-split/specs/${SVC}`);
    expect(res.out).toMatch(/✓ spec\.md +\+1 ~0 -0 requirements · 1 scenario/);
    expect(res.out).toMatch(/✓ openapi\.yaml +1 operation/);
    expect(res.out).toMatch(/- arch\.spec\.md/);
    expect(res.out).toContain("[ADDED] Split a payment  (1 scenario)  → createSplit");
    expect(res.out).toContain("POST /splits  createSplit");
    expect(res.out).toContain("loam show FEAT-1");
    expect(res.out).toContain(`loam delta FEAT-1 --service ${SVC}`);
    expect(res.out).toContain(`loam tasks FEAT-1 --service ${SVC}`);
    // `--type service` forces the same reading; `--type feature` keeps its refusal.
    expect((await runLoam(p.workDir, "show", SVC, "--type", "service")).out).toContain("introduced by FEAT-1");
    const asFeature = await runLoam(p.workDir, "show", SVC, "--type", "feature", "--json");
    expect(asFeature.code).toBe(1);
    expect(JSON.parse(asFeature.stdout).error).toEqual({
      code: "unknown-target",
      message: `No feature '${SVC}' in ${p.docsDir}.`,
    });
  });

  it("--json is a service payload marked living: false, with the delta per introducing feature", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "show", SVC, "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: true, command: "show", type: "service", id: SVC, living: false, introducedBy: ["FEAT-1"] });
    expect(json.introductions).toHaveLength(1);
    const [intro] = json.introductions;
    expect(intro).toMatchObject({
      feature: "FEAT-1",
      path: `features/FEAT-1-split/specs/${SVC}`,
      has: { spec: true, archSpec: false, openapi: true, asyncapi: false },
      added: 1,
      modified: 0,
      removed: 0,
      operations: ["createSplit"],
      archSpec: { requirements: 0, scenarios: 0, entries: [] },
      next: ["loam show FEAT-1", `loam delta FEAT-1 --service ${SVC}`, `loam tasks FEAT-1 --service ${SVC}`],
    });
    expect(intro.requirements).toEqual([
      { name: "Split a payment", kind: "ADDED", scenarios: 1, operations: ["createSplit"], covers: [] },
    ]);
    expect(intro.api.unreadable).toBe(false);
    expect(intro.api.changes.map((c: { operationId: string }) => c.operationId)).toEqual(["createSplit"]);
    // The living payload is untouched: none of the new keys appear on it.
    const living = JSON.parse((await runLoam(p.workDir, "show", "payment-service", "--json")).stdout);
    expect(living.type).toBe("service");
    expect(living).not.toHaveProperty("living");
    expect(living).not.toHaveProperty("introducedBy");
  });
});

describe("loam context <introduced service>", () => {
  it("briefs from the one introducing feature's delta, marked living: false", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "context", SVC, "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({
      ok: true,
      command: "context",
      service: SVC,
      living: false,
      introducedBy: ["FEAT-1"],
      path: `features/FEAT-1-split/specs/${SVC}`,
      feature: "FEAT-1",
      maturity: "empty",
      requirements: [],
      operations: [],
    });
    expect(json.features.map((f: { feature: string }) => f.feature)).toEqual(["FEAT-1"]);
    expect(json.features[0].requirements.map((r: { name: string }) => r.name)).toEqual(["Split a payment"]);
    expect(json.features[0].architecture.isNew).toBe(true);
    // Naming the introducer is the implement protocol's form, and it answers the same.
    const named = await runLoam(p.workDir, "context", SVC, "--feature", "FEAT-1", "--json");
    expect(named.code).toBe(0);
    expect(JSON.parse(named.stdout)).toEqual(json);
    // A living service's pack carries none of the new keys.
    const living = JSON.parse((await runLoam(p.workDir, "context", "payment-service", "--json")).stdout);
    expect(living).not.toHaveProperty("living");
    expect(living).not.toHaveProperty("introducedBy");
  });

  it("the Markdown view says so first, and does not list living artifacts as missing", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "context", SVC);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(
      `features/FEAT-1-split/specs/${SVC} · introduced by FEAT-1 (in flight) — not in the living docs until it archives`,
    );
    expect(res.stdout).not.toContain("missing:");
    expect(res.stdout).toContain("## In flight (narrowed to FEAT-1)");
    expect(res.stdout).toContain("### Requirement: [ADDED] Split a payment");
    expect(res.stdout).toContain(`next: loam delta FEAT-1 --service ${SVC}`);
  });

  it("several introducers and no --feature refuses, naming them and the flag; --feature picks one", async () => {
    const p = await project(twoIntroducers());
    const both = await runLoam(p.workDir, "context", SVC, "--json");
    expect(both.code).toBe(1);
    const err = JSON.parse(both.stdout).error;
    expect(err.code).toBe("invalid-option");
    expect(err.message).toContain("FEAT-1, FEAT-2");
    expect(err.message).toContain("--feature");
    const picked = await runLoam(p.workDir, "context", SVC, "--feature", "FEAT-2", "--json");
    expect(picked.code).toBe(0);
    const json = JSON.parse(picked.stdout);
    expect(json).toMatchObject({ feature: "FEAT-2", introducedBy: ["FEAT-1", "FEAT-2"], living: false });
    expect(json.features[0].requirements.map((r: { name: string }) => r.name)).toEqual(["Split a payment evenly"]);
  });

  it("--feature naming a feature that does not introduce it is unknown-service, pointing at the one that does", async () => {
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-3-other/intent.md": "---\nfeature: FEAT-3\nstatus: proposed\n---\n\n# Other\n\nUnrelated.\n",
      "features/FEAT-3-other/specs/payment-service/spec.md": FEATURE_SPEC.replace("ADDED", "MODIFIED"),
    });
    const res = await runLoam(p.workDir, "context", SVC, "--feature", "FEAT-3", "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("unknown-service");
    expect(err.message).toContain("FEAT-3 does not introduce it — FEAT-1 does");
    expect(err.message).toContain("--feature FEAT-1");
  });

  it("an unreadable delta contract is still a hole: exit 1 with ok true", async () => {
    const p = await project({
      ...coherentFixture(),
      [`features/FEAT-1-split/specs/${SVC}/openapi.yaml`]: "openapi: [unclosed\n",
    });
    const res = await runLoam(p.workDir, "context", SVC, "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.features[0].openapi.unreadable).toBe(true);
  });
});

describe("loam steps --service <introduced service>", () => {
  it("inventories the feature delta's phrases and says the source is the delta, not a living spec", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "steps", "--service", SVC, "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({
      ok: true,
      service: SVC,
      living: false,
      introducedBy: ["FEAT-1"],
      specs: [`features/FEAT-1-split/specs/${SVC}/spec.md`],
      steps: 3,
      phrases: 3,
      catalogue: { present: false, path: `services/${SVC}/steps.yaml`, entries: 0 },
    });
    const human = await runLoam(p.workDir, "steps", "--service", SVC);
    expect(human.code).toBe(0);
    expect(human.out).toContain(`steps ${SVC} — 3 written step(s), 3 distinct phrase(s)`);
    expect(human.out).toContain(
      `read from the feature delta, not a living spec: features/FEAT-1-split/specs/${SVC}/ — ${SVC} is introduced by FEAT-1`,
    );
    // Writing the catalogue where it belongs would mint the service early, so
    // the absent-catalogue advice is not the living one.
    expect(human.out).not.toContain("Write one");
    expect(human.out).toContain("lands with the service when FEAT-1 archives");
    // The living payload is untouched.
    const living = JSON.parse((await runLoam(p.workDir, "steps", "--service", "payment-service", "--json")).stdout);
    expect(living.service).toBe("payment-service");
    expect(living).not.toHaveProperty("living");
  });

  it("answers the same for the bound service, with no --service", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "steps", "--json");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ service: SVC, living: false, steps: 3 });
  });
});

describe("a name that is neither living nor introduced keeps today's refusal", () => {
  it("show, context and steps refuse exactly as before", async () => {
    const p = await project(coherentFixture());
    const show = await runLoam(p.workDir, "show", "ghost-service", "--json");
    expect(show.code).toBe(1);
    expect(JSON.parse(show.stdout).error).toEqual({
      code: "unknown-target",
      message: `No service or feature 'ghost-service' in ${p.docsDir}.`,
    });
    const context = await runLoam(p.workDir, "context", "ghost-service", "--json");
    expect(context.code).toBe(1);
    expect(JSON.parse(context.stdout).error).toEqual({
      code: "unknown-service",
      message: `No service 'ghost-service' under ${p.docsDir}/services/.`,
    });
    const steps = await runLoam(p.workDir, "steps", "--service", "ghost-service", "--json");
    expect(steps.code).toBe(1);
    const stepsError = JSON.parse(steps.stdout).error;
    expect(stepsError.code).toBe("unknown-target");
    expect(stepsError.message).toMatch(/^No living spec at .*ghost-service.spec\.md\. Run `loam adopt` for 'ghost-service' first\.$/);
  });

  it("the near-miss hint now names an introduced service too", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "context", "payment-splt-service", "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("unknown-service");
    expect(err.message).toContain(`'${SVC}'`);
  });

  it("an archived introducer no longer counts — the service is living then, or nothing", async () => {
    const files = coherentFixture();
    const archived: Record<string, string> = {};
    for (const [path, body] of Object.entries(files)) {
      archived[path.replace("features/FEAT-1-split/", "features/archive/FEAT-1-split/")] = body;
    }
    const p = await project(archived);
    const res = await runLoam(p.workDir, "show", SVC, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("unknown-target");
  });
});
