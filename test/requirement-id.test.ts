import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { deltaShapeIssues } from "../src/core/delta.js";
import {
  applyRequirementDelta,
  parseRequirements,
  requirementIdProblems,
  serializeRequirements,
} from "../src/core/document/spec.js";
import { featureChecklist } from "../src/core/verify.js";
import {
  LIVING_SPEC,
  coherentFixture,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";
const ID = "payments.authorize";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

function requirement(
  heading: string,
  id: string | undefined,
  section = "## Requirements",
): string {
  return `${section}

### Requirement: ${heading}
${id === undefined ? "" : `Requirement-ID: ${id}\n`}
The service SHALL authorize a payment.

#### Scenario: Authorization succeeds
- **Then** the payment is authorized
`;
}

describe("Requirement-ID grammar and round trip", () => {
  it("parses and serializes an authored ID without changing its body", () => {
    const markdown = requirement("Authorize payment", ID);
    const [parsed] = parseRequirements(markdown);
    expect(parsed!.id).toBe(ID);
    expect(parseRequirements(serializeRequirements([parsed!]))[0]!.id).toBe(ID);
    expect(serializeRequirements([parsed!]).match(/Requirement-ID:/g)).toHaveLength(1);
  });

  it("keeps legacy requirements valid and name-addressable", () => {
    const [parsed] = parseRequirements(requirement("Authorize payment", undefined));
    expect(parsed!.id).toBeUndefined();
    expect(requirementIdProblems([parsed!])).toEqual([]);
  });

  it("reports invalid, repeated, and duplicate declarations", () => {
    const invalid = parseRequirements(requirement("Invalid", "not valid"));
    const repeated = parseRequirements(
      requirement("Repeated", "one").replace(
        "Requirement-ID: one",
        "Requirement-ID: one\nRequirement-ID: two",
      ),
    );
    const duplicate = parseRequirements(
      `${requirement("First", "same")}
### Requirement: Second
Requirement-ID: same

#### Scenario: It works
- **Then** it works
`,
    );
    expect(requirementIdProblems(invalid).map((p) => p.kind)).toEqual(["invalid"]);
    expect(requirementIdProblems(repeated).map((p) => p.kind)).toContain("repeated");
    expect(requirementIdProblems(duplicate).map((p) => p.kind)).toContain("duplicate");
  });
});

describe("stable-ID delta algebra", () => {
  const living = () => parseRequirements(requirement("Authorize payment", ID));

  it("MODIFIED renames the heading in place when the ID stays stable", () => {
    const delta = parseRequirements(requirement("Authorize card payment", ID, "## MODIFIED Requirements"));
    const merged = applyRequirementDelta(living(), delta);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("Authorize card payment");
    expect(merged[0]!.id).toBe(ID);
  });

  it("REMOVED selects by ID even when its explanatory heading differs", () => {
    const delta = parseRequirements(requirement("Retired authorization", ID, "## REMOVED Requirements"));
    expect(applyRequirementDelta(living(), delta)).toEqual([]);
  });

  it("a legacy MODIFIED preserves an ID already present in the living requirement", () => {
    const delta = parseRequirements(requirement("Authorize payment", undefined, "## MODIFIED Requirements"));
    const merged = applyRequirementDelta(living(), delta);
    expect(merged[0]!.id).toBe(ID);
    expect(parseRequirements(serializeRequirements(merged))[0]!.id).toBe(ID);
  });

  it("refuses when an ID and heading point at different living requirements", () => {
    const two = parseRequirements(
      `${requirement("Authorize payment", ID)}
### Requirement: Capture payment
Requirement-ID: payments.capture

#### Scenario: Capture succeeds
- **Then** the payment is captured
`,
    );
    const delta = parseRequirements(requirement("Capture payment", ID, "## MODIFIED Requirements"));
    expect(() => applyRequirementDelta(two, delta)).toThrow(/ambiguous requirement identity/);
  });
});

describe("delta-shape and validate findings", () => {
  it("accepts a MODIFIED rename selected by stable ID", async () => {
    const p = await project({
      [`services/${SVC}/spec.md`]: requirement("Authorize payment", ID),
      "features/FEAT-9-rename/specs/payment-service/spec.md": requirement(
        "Authorize card payment",
        ID,
        "## MODIFIED Requirements",
      ),
    });
    const issues = await deltaShapeIssues(
      p.docsDir,
      join(p.docsDir, "features/FEAT-9-rename"),
      "FEAT-9",
    );
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("flags ID/name collisions instead of selecting one silently", async () => {
    const p = await project({
      [`services/${SVC}/spec.md`]: `${requirement("Authorize payment", ID)}
### Requirement: Capture payment
Requirement-ID: payments.capture

#### Scenario: Capture succeeds
- **Then** the payment is captured
`,
      "features/FEAT-9-rename/specs/payment-service/spec.md": requirement(
        "Capture payment",
        ID,
        "## MODIFIED Requirements",
      ),
    });
    const issues = await deltaShapeIssues(
      p.docsDir,
      join(p.docsDir, "features/FEAT-9-rename"),
      "FEAT-9",
    );
    expect(issues.map((issue) => issue.code)).toContain("delta.requirement-identity-collision");
  });

  it("reports malformed and duplicate IDs from feature validation", async () => {
    const p = await project({
      "features/FEAT-9-ids/specs/payment-service/spec.md": `${requirement(
        "One",
        "bad id",
        "## ADDED Requirements",
      )}
### Requirement: Two
Requirement-ID: stable.same

#### Scenario: Two works
- **Then** it works

### Requirement: Three
Requirement-ID: stable.same

#### Scenario: Three works
- **Then** it works
`,
    });
    const result = await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json");
    const codes = JSON.parse(result.stdout).targets[0].findings.map(
      (finding: { code: string }) => finding.code,
    );
    expect(result.code).toBe(1);
    expect(codes).toContain("delta.requirement-id-invalid");
    expect(codes).toContain("delta.requirement-id-duplicate");
  });

  it("reports invalid IDs in living service validation", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(
      "The service SHALL authorize",
      "Requirement-ID: invalid id\n\nThe service SHALL authorize",
    );
    const p = await project(files);
    const result = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
    const codes = JSON.parse(result.stdout).targets[0].findings.map(
      (finding: { code: string }) => finding.code,
    );
    expect(result.code).toBe(1);
    expect(codes).toContain("spec.requirement-id-invalid");
  });
});

describe("verification and archive integration", () => {
  it("keeps a scenario claim ID across a requirement heading rename", async () => {
    const files = coherentFixture();
    const path = "features/FEAT-1-split/specs/payment-split-service/spec.md";
    files[path] = files[path]!.replace(
      "### Requirement: Split a payment",
      "### Requirement: Split a payment\nRequirement-ID: payments.split",
    );
    const beforeProject = await project(files);
    const before = (await featureChecklist(
      beforeProject.docsDir,
      join(beforeProject.docsDir, "features/FEAT-1-split"),
      "FEAT-1",
    )).claims.find((claim) => claim.kind === "scenario.tested")!.id;

    const renamed = { ...files };
    renamed[path] = renamed[path]!.replace("Split a payment", "Divide a payment");
    const afterProject = await project(renamed);
    const after = (await featureChecklist(
      afterProject.docsDir,
      join(afterProject.docsDir, "features/FEAT-1-split"),
      "FEAT-1",
    )).claims.find((claim) => claim.kind === "scenario.tested")!.id;
    expect(after).toBe(before);
  });

  it("archives a stable-ID MODIFIED rename into one living requirement", async () => {
    const p = await project({
      [`services/${SVC}/spec.md`]: requirement("Authorize payment", ID),
      "features/FEAT-9-rename/intent.md": "# Rename authorization\n",
      "features/FEAT-9-rename/specs/payment-service/spec.md": requirement(
        "Authorize card payment",
        ID,
        "## MODIFIED Requirements",
      ),
    });
    const result = await runLoam(p.workDir, "archive", "FEAT-9");
    expect(result.code, result.out).toBe(0);
    const living = parseRequirements(await p.read(`services/${SVC}/spec.md`));
    expect(living.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: ID, name: "Authorize card payment" },
    ]);
    expect(p.exists("features/archive/FEAT-9-rename/specs/payment-service/spec.md")).toBe(true);
  });
});
