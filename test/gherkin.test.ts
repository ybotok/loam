/**
 * `loam gherkin` — the emission that turns spec scenarios into real `.feature`
 * files, and the staleness findings that keep them honest.
 *
 * The properties under test are the ones the design leans on: determinism
 * (same specs, same bytes), digest agreement with `loam verify`'s claim recipe
 * (one hash, two consumers), the `<gherkinDir>/loam/` ownership boundary
 * (rewrites and deletions inside, never a byte outside), and the vouch-style
 * refusal to run anywhere but the service's own repo.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  coherentFixture,
  makeProject,
  runLoam,
  treeHashes,
  FEATURE_SPEC,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  SERVICE_MODEL,
  type Project,
} from "./helpers/harness.js";
import {
  gherkinStampLine,
  parseStampedFeature,
  renderFeature,
  scenarioDigest,
  stepFromLine,
} from "../src/core/gherkin.js";
import { parseRequirements } from "../src/core/spec.js";
import { scenarioBodyHash } from "../src/core/verify.js";
import { LOAM_VERSION } from "../src/core/version.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(
  files: Record<string, string>,
  opts: { service?: string; gherkinDir?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

/** Write a file under the WORK dir (the service repo), not the docs repo. */
async function writeWork(p: Project, rel: string, content: string): Promise<void> {
  const abs = join(p.workDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

const readWork = (p: Project, rel: string): Promise<string> => readFile(join(p.workDir, rel), "utf8");

/** The living arch spec used across tests: one requirement, one scenario. */
const LIVING_ARCH_SPEC = `---
service: payment-service
status: draft
---

# payment-service — architecture

## Requirements

### Requirement: Events leave through the outbox
The service SHALL publish events through the transactional outbox.

Covers: paymentService

#### Scenario: Broker down at commit time
- **Given** an event in the outbox
- **When** the broker is unavailable
- **Then** the event is published once it returns
`;

/** Feature FEAT-1 arch delta for payment-split-service. */
const FEATURE_ARCH_SPEC = `# payment-split-service — arch delta for FEAT-1

## ADDED Requirements

### Requirement: Retries stay idempotent
The service SHALL apply createSplit idempotently under retry.

#### Scenario: Duplicate delivery
- **WHEN** the same split arrives twice
- **THEN** exactly one split is recorded
`;

/** coherentFixture plus the arch delta and a model for the new service. */
function fixtureWithArch(): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/specs/payment-split-service/arch.spec.md": FEATURE_ARCH_SPEC,
    "services/payment-split-service/model.likec4": `specification {
  element softwareSystem
}

model {
  paymentSplitService = softwareSystem 'payment-split-service'
}

views {
  view of paymentSplitService {
    include *
  }
}
`,
  };
}

/* ------------------------------------------------------------------ */
/* Step conversion                                                     */
/* ------------------------------------------------------------------ */

describe("step conversion", () => {
  it("promotes keyword bullets in every documented spelling, and only those", () => {
    expect(stepFromLine("- **Given** a valid card")).toEqual({ keyword: "Given", text: "a valid card" });
    expect(stepFromLine("- **WHEN** authorization is requested")).toEqual({
      keyword: "When",
      text: "authorization is requested",
    });
    expect(stepFromLine("- **THEN** the payment is authorized")).toEqual({
      keyword: "Then",
      text: "the payment is authorized",
    });
    expect(stepFromLine("- and the ledger is open")).toEqual({ keyword: "And", text: "the ledger is open" });
    expect(stepFromLine("* But the till is closed")).toEqual({ keyword: "But", text: "the till is closed" });
    expect(stepFromLine("+ given lowercase works")).toEqual({ keyword: "Given", text: "lowercase works" });
    expect(stepFromLine("- **Then:** with a colon")).toEqual({ keyword: "Then", text: "with a colon" });
    // not steps: no bullet, keyword glued to text, non-keyword bullet
    expect(stepFromLine("Given prose without a bullet")).toBeNull();
    expect(stepFromLine("- Givenx is not a keyword")).toBeNull();
    expect(stepFromLine("- just a note")).toBeNull();
  });

  it("keeps non-step prose as scenario description, before the steps, never dropped", () => {
    const [req] = parseRequirements(
      [
        "## Requirements",
        "",
        "### Requirement: Conversion",
        "Body text.",
        "",
        "#### Scenario: All the forms",
        "Some prose that stays.",
        "- **Given** a valid card",
        "- just a note bullet",
        "- **When** authorization is requested",
        "- **Then** the payment is authorized",
      ].join("\n"),
    );
    const { content } = renderFeature(req!, [], "0.0.0");
    expect(content).toContain("    Some prose that stays.");
    expect(content).toContain("    - just a note bullet");
    expect(content).toContain("    Given a valid card");
    expect(content).toContain("    When authorization is requested");
    expect(content).toContain("    Then the payment is authorized");
    // description renders before the first step
    expect(content.indexOf("just a note bullet")).toBeLessThan(content.indexOf("Given a valid card"));
  });
});

/* ------------------------------------------------------------------ */
/* Emission                                                            */
/* ------------------------------------------------------------------ */

describe("feature mode", () => {
  it("emits one tagged .feature per ADDED/MODIFIED requirement, both axes", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("feature");
    expect(payload.feature).toBe("FEAT-1");
    expect(payload.root).toBe("features/loam");
    expect(payload.files.map((f: { path: string }) => f.path)).toEqual([
      "features/loam/split-a-payment.feature",
      "features/loam/arch--retries-stay-idempotent.feature",
    ]);

    const business = await readWork(p, "features/loam/split-a-payment.feature");
    expect(business.split("\n")[0]).toBe(gherkinStampLine(LOAM_VERSION));
    expect(business).toContain("@FEAT-1\n");
    expect(business).not.toContain("@architecture");
    expect(business).toContain("Feature: Split a payment");
    expect(business).toContain("    Given a payment of 100.00");
    expect(business).toContain("    When it is split 60/40");
    expect(business).toContain("    Then two shares are recorded");
    expect(business).toMatch(/ {2}@loam-digest-[0-9a-f]{16}\n {2}Scenario: Split across two payees/);

    const arch = await readWork(p, "features/loam/arch--retries-stay-idempotent.feature");
    expect(arch).toContain("@FEAT-1 @architecture");
    expect(arch).toContain("    When the same split arrives twice");
    const parsed = parseStampedFeature(arch)!;
    expect(parsed.tags).toEqual(["FEAT-1", "architecture"]);
    expect(parsed.featureName).toBe("Retries stay idempotent");
    expect(parsed.scenarios).toHaveLength(1);
  });

  it("stamps the EXACT digest loam verify folds into its claim ids", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--json");
    const payload = JSON.parse(res.stdout);

    const [req] = parseRequirements(FEATURE_SPEC);
    const expected = scenarioBodyHash(req!.scenarios[0]!.lines).slice(0, 16);
    expect(scenarioDigest(req!.scenarios[0]!.lines)).toBe(expected);
    expect(payload.files[0].digests).toEqual([expected]);
    const onDisk = await readWork(p, "features/loam/split-a-payment.feature");
    // as a TAG on the line above the Scenario keyword — cucumber's JSON report
    // carries tags per scenario, so the stamp survives the runner
    expect(onDisk).toMatch(new RegExp(` {2}@loam-digest-${expected}\\n {2}Scenario:`));
  });

  it("a feature with nothing for this service emits nothing and does not opt the repo in", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.files).toEqual([]);
    expect(payload.deleted).toEqual([]);
    // no empty loam/ left behind: that would read as "the whole suite is missing"
    expect(existsSync(join(p.workDir, "features", "loam"))).toBe(false);
  });
});

describe("living mode", () => {
  it("emits the full suite from spec.md + arch.spec.md, arch tagged, no feature tag", async () => {
    const p = await project(
      {
        "architecture/landscape.likec4": LANDSCAPE,
        "services/payment-service/model.likec4": SERVICE_MODEL,
        "services/payment-service/spec.md": LIVING_SPEC,
        "services/payment-service/arch.spec.md": LIVING_ARCH_SPEC,
        "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      },
      { service: "payment-service" },
    );
    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.mode).toBe("living");
    expect(payload.files.map((f: { path: string; axis: string }) => [f.path, f.axis])).toEqual([
      ["features/loam/authorize-a-payment.feature", "business"],
      ["features/loam/arch--events-leave-through-the-outbox.feature", "arch"],
    ]);

    const business = await readWork(p, "features/loam/authorize-a-payment.feature");
    // no feature tag and no @architecture — the digest tags are the only @ lines
    expect(business).not.toContain("@FEAT");
    expect(business).not.toContain("@architecture");
    expect(business.split("\n")[1]).toBe("Feature: Authorize a payment");
    const arch = await readWork(p, "features/loam/arch--events-leave-through-the-outbox.feature");
    expect(arch).toContain("@architecture\n");
    expect(arch).not.toContain("@FEAT");
    // the requirement's own text rides as the feature description
    expect(arch).toContain("  The service SHALL publish events through the transactional outbox.");
    expect(arch).toContain("  Covers: paymentService");
  });

  it("refuses when the service has no living spec — vouch's unknown-target", async () => {
    const p = await project({ "services/payment-service/model.likec4": SERVICE_MODEL }, { service: "payment-service" });
    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("unknown-target");
    expect(payload.error.message).toContain("loam adopt");
  });

  it("is deterministic: two runs, byte-identical tree", async () => {
    const p = await project(
      {
        "services/payment-service/model.likec4": SERVICE_MODEL,
        "services/payment-service/spec.md": LIVING_SPEC,
        "services/payment-service/arch.spec.md": LIVING_ARCH_SPEC,
      },
      { service: "payment-service" },
    );
    expect((await runLoam(p.workDir, "gherkin")).code).toBe(0);
    const first = await treeHashes(join(p.workDir, "features"));
    expect((await runLoam(p.workDir, "gherkin")).code).toBe(0);
    expect(await treeHashes(join(p.workDir, "features"))).toEqual(first);
  });

  it("disambiguates slug collisions deterministically, in document order", async () => {
    const spec = `---
service: payment-service
---

# payment-service

## Requirements

### Requirement: Retry!
The service SHALL retry.

#### Scenario: One
- **Given** a failure
- **Then** a retry

### Requirement: Retry?
The service SHALL ask first.

#### Scenario: Two
- **Given** a failure
- **Then** a question
`;
    const p = await project({ "services/payment-service/spec.md": spec }, { service: "payment-service" });
    const res = await runLoam(p.workDir, "gherkin", "--json");
    const payload = JSON.parse(res.stdout);
    expect(payload.files.map((f: { path: string; requirement: string }) => [f.path, f.requirement])).toEqual([
      ["features/loam/retry.feature", "Retry!"],
      ["features/loam/retry-2.feature", "Retry?"],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Ownership of <gherkinDir>/loam/                                     */
/* ------------------------------------------------------------------ */

describe("the loam/ ownership boundary", () => {
  it("living regeneration removes orphans inside loam/ and touches nothing outside it", async () => {
    const p = await project(
      { "services/payment-service/spec.md": LIVING_SPEC },
      { service: "payment-service" },
    );
    await writeWork(p, "features/loam/orphan.feature", "Feature: hand-made orphan\n");
    await writeWork(p, "features/loam/notes.md", "not a feature file\n");
    await writeWork(p, "features/handwritten.feature", "Feature: mine, outside loam/\n");
    await writeWork(p, "sentinel.txt", "untouched\n");

    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.deleted).toEqual(["features/loam/orphan.feature"]);
    expect(existsSync(join(p.workDir, "features/loam/orphan.feature"))).toBe(false);
    // only .feature files are loam's format; everything else survives even inside loam/
    expect(await readWork(p, "features/loam/notes.md")).toBe("not a feature file\n");
    expect(await readWork(p, "features/handwritten.feature")).toBe("Feature: mine, outside loam/\n");
    expect(await readWork(p, "sentinel.txt")).toBe("untouched\n");
  });

  it("feature regeneration owns only its own tag: renames are cleaned up, other features' files stay", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    const other = `${gherkinStampLine(LOAM_VERSION)}\n@FEAT-9\nFeature: Someone else's\n`;
    await writeWork(p, "features/loam/other.feature", other);

    expect((await runLoam(p.workDir, "gherkin", "FEAT-1")).code).toBe(0);
    expect(existsSync(join(p.workDir, "features/loam/split-a-payment.feature"))).toBe(true);

    // rename the requirement in the delta; the old file is FEAT-1's orphan
    await p.write(
      "features/FEAT-1-split/specs/payment-split-service/spec.md",
      FEATURE_SPEC.replace("Requirement: Split a payment", "Requirement: Divide a payment"),
    );
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--json");
    const payload = JSON.parse(res.stdout);
    expect(payload.deleted).toEqual(["features/loam/split-a-payment.feature"]);
    expect(existsSync(join(p.workDir, "features/loam/divide-a-payment.feature"))).toBe(true);
    expect(existsSync(join(p.workDir, "features/loam/split-a-payment.feature"))).toBe(false);
    // the @FEAT-9 file is not this scope's to delete
    expect(await readWork(p, "features/loam/other.feature")).toBe(other);
  });

  it("--dry-run reports the whole plan and writes nothing", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--dry-run", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.written).toBe(false);
    expect(payload.files).toHaveLength(2);
    expect(existsSync(join(p.workDir, "features"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Config: the service-repo gate and gherkinDir                        */
/* ------------------------------------------------------------------ */

describe("the service-repo gate", () => {
  it("refuses without a service — from a docs-repo checkout or with none configured", async () => {
    const p = await project(coherentFixture());
    const none = await runLoam(p.workDir, "gherkin", "--json");
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout).error.code).toBe("invalid-option");

    const elsewhere = await runLoam(p.workDir, "gherkin", "--service", "payment-service", "--json");
    expect(elsewhere.code).toBe(1);
    const payload = JSON.parse(elsewhere.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("not a service repo");
  });

  it("refuses another service's emission from this repo — the files land HERE", async () => {
    const p = await project(coherentFixture(), { service: "checkout-web" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--service", "payment-split-service", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("this repo is 'checkout-web'");
  });

  it("an unknown feature refuses with the archive-aware diagnosis", async () => {
    const p = await project(coherentFixture(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "gherkin", "FEAT-404", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("unknown-target");
  });
});

/* ------------------------------------------------------------------ */
/* validate: the staleness chain                                       */
/* ------------------------------------------------------------------ */

interface FindingLike {
  code: string;
  severity: string;
  message: string;
}

/** The gherkin.* findings validate reports for one service. */
async function gherkinValidate(p: Project, service: string): Promise<FindingLike[]> {
  const res = await runLoam(p.workDir, "validate", "--service", service, "--json");
  const payload = JSON.parse(res.stdout) as {
    targets: Array<{ id: string; findings: FindingLike[] }>;
  };
  return payload.targets
    .find((t) => t.id === service)!
    .findings.filter((f) => f.code.startsWith("gherkin."));
}

describe("validate: the staleness chain", () => {
  const livingFixture = (): Record<string, string> => ({
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/arch.spec.md": LIVING_ARCH_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
  });

  it("stays quiet before opting in, and grades current after generating", async () => {
    const p = await project(livingFixture(), { service: "payment-service" });
    expect(await gherkinValidate(p, "payment-service")).toEqual([]);

    expect((await runLoam(p.workDir, "gherkin")).code).toBe(0);
    const findings = await gherkinValidate(p, "payment-service");
    expect(findings.map((f) => [f.code, f.severity])).toEqual([["gherkin.current", "ok"]]);
  });

  it("gherkin.missing fires when the spec grows, and regeneration clears it", async () => {
    const p = await project(livingFixture(), { service: "payment-service" });
    await runLoam(p.workDir, "gherkin");
    await p.write(
      "services/payment-service/spec.md",
      LIVING_SPEC +
        "\n#### Scenario: Declined authorization\n- **Given** an invalid card\n- **When** authorization is requested\n- **Then** the payment is declined\n",
    );
    const findings = await gherkinValidate(p, "payment-service");
    expect(findings.map((f) => f.code)).toEqual(["gherkin.missing"]);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.message).toContain("'Declined authorization'");

    await runLoam(p.workDir, "gherkin");
    expect((await gherkinValidate(p, "payment-service")).map((f) => f.code)).toEqual(["gherkin.current"]);
  });

  it("a reworded scenario is stale AND missing — the old words untested, the new words unstamped", async () => {
    const p = await project(livingFixture(), { service: "payment-service" });
    await runLoam(p.workDir, "gherkin");
    await p.write(
      "services/payment-service/spec.md",
      LIVING_SPEC.replace("the payment is authorized", "the payment is authorized and receipted"),
    );
    const codes = (await gherkinValidate(p, "payment-service")).map((f) => f.code).sort();
    expect(codes).toEqual(["gherkin.missing", "gherkin.stale"]);

    await runLoam(p.workDir, "gherkin");
    expect((await gherkinValidate(p, "payment-service")).map((f) => f.code)).toEqual(["gherkin.current"]);
  });

  it("gherkin.orphaned fires per file when the requirement goes away, and regeneration removes the file", async () => {
    const p = await project(livingFixture(), { service: "payment-service" });
    await runLoam(p.workDir, "gherkin");
    // a rename is REMOVED + ADDED: the old file's requirement is gone, while its
    // digests still match the (renamed) living scenario — orphaned, not missing
    await p.write(
      "services/payment-service/spec.md",
      LIVING_SPEC.replace("Requirement: Authorize a payment", "Requirement: Capture a payment"),
    );
    const findings = await gherkinValidate(p, "payment-service");
    expect(findings.map((f) => f.code)).toEqual(["gherkin.orphaned"]);
    expect(findings[0]!.message).toContain("authorize-a-payment.feature");
    expect(findings[0]!.message).toContain("'Authorize a payment'");

    const regen = await runLoam(p.workDir, "gherkin", "--json");
    expect(JSON.parse(regen.stdout).deleted).toEqual(["features/loam/authorize-a-payment.feature"]);
    expect(existsSync(join(p.workDir, "features/loam/capture-a-payment.feature"))).toBe(true);
    expect((await gherkinValidate(p, "payment-service")).map((f) => f.code)).toEqual(["gherkin.current"]);
  });

  it("staleness reads gherkinDir too", async () => {
    const p = await project(livingFixture(), { service: "payment-service", gherkinDir: "bdd" });
    await runLoam(p.workDir, "gherkin");
    expect((await gherkinValidate(p, "payment-service")).map((f) => f.code)).toEqual(["gherkin.current"]);
  });
});

describe("the feature lifecycle: in flight, archived, abandoned", () => {
  it("in-flight files answer to their feature; after archive they grade current with no rewrite", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    expect((await runLoam(p.workDir, "gherkin", "FEAT-1")).code).toBe(0);

    // mid-flight: the requirements are nowhere in the living specs, and that is
    // not orphanhood — the files are tagged with an active feature
    expect((await gherkinValidate(p, "payment-split-service")).map((f) => f.code)).toEqual([
      "gherkin.current",
    ]);

    const before = await treeHashes(join(p.workDir, "features", "loam"));
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);

    // post-archive: the feature's scenarios ARE living scenarios now, digests
    // unchanged — the same bytes grade current against spec.md and arch.spec.md
    expect(await treeHashes(join(p.workDir, "features", "loam"))).toEqual(before);
    expect((await gherkinValidate(p, "payment-split-service")).map((f) => f.code)).toEqual([
      "gherkin.current",
    ]);
  });

  it("an abandoned feature's files become orphans — the tag names nothing active", async () => {
    const p = await project(fixtureWithArch(), { service: "payment-split-service" });
    await runLoam(p.workDir, "gherkin", "FEAT-1");
    await rm(join(p.docsDir, "features", "FEAT-1-split"), { recursive: true, force: true });

    const codes = (await gherkinValidate(p, "payment-split-service")).map((f) => f.code).sort();
    expect(codes).toEqual(["gherkin.orphaned", "gherkin.orphaned"]);
  });
});

describe("gherkinDir", () => {
  it("defaults to features/, honours loam.json, and refuses a malformed value", async () => {
    const p = await project(
      { "services/payment-service/spec.md": LIVING_SPEC },
      { service: "payment-service", gherkinDir: "bdd" },
    );
    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).root).toBe("bdd/loam");
    expect(existsSync(join(p.workDir, "bdd/loam/authorize-a-payment.feature"))).toBe(true);
    expect(existsSync(join(p.workDir, "features"))).toBe(false);

    // a non-string gherkinDir refuses the whole config, like a malformed docsDir
    await writeFile(
      join(p.workDir, "loam.json"),
      JSON.stringify({ docsDir: p.docsDir, service: "payment-service", gherkinDir: 5 }),
      "utf8",
    );
    const bad = await runLoam(p.workDir, "gherkin", "--json");
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).error.code).toBe("config-invalid");
  });
});
