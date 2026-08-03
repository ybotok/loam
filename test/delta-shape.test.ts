/**
 * Deep invariant tests for the delta-vs-living check (src/core/delta.ts).
 *
 * A requirement delta is a diff against a living spec, and until now nothing
 * checked that the diff applied. Three ways it could lie silently:
 *
 *  - MODIFIED a requirement that does not exist -> archive created it as new;
 *  - REMOVED one that does not exist -> archive removed nothing;
 *  - ADDED one that already exists -> archive REPLACED the living requirement,
 *    scenarios and all, while the author believed they were adding.
 *
 * And a fourth, worse: a section heading that nearly matches the grammar
 * (`## ADDED Requirement`, singular) parses as BASE, so archive merges nothing
 * at all and says nothing about it.
 *
 * These run inside featureCoherence, so `archive` is gated on them.
 *
 * Families:
 *  - section-heading grammar: near misses vs legitimate non-delta sections
 *  - MODIFIED / REMOVED / ADDED against the living spec
 *  - features in flight: another active feature supplying the requirement
 *  - the gate: archive refuses, --approve overrides, validate reports the code
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { deltaShapeIssues } from "../src/core/delta.js";
import type { Issue } from "../src/core/issue.js";

const SVC = "payment-service";

/** Living spec for payment-service with one named requirement. */
const LIVING = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

/** A delta section with one requirement carrying a scenario. */
function section(heading: string, name: string): string {
  return `# ${SVC} — delta

${heading}

### Requirement: ${name}
The service SHALL do the thing.

#### Scenario: It happens
- **Given** a trigger
- **When** it fires
- **Then** the thing happens
`;
}

/** Run the shape check for FEAT-1 over a fixture, then clean up. */
async function shapeIssues(files: Record<string, string>): Promise<Issue[]> {
  const p: Project = await makeProject(files);
  try {
    return await deltaShapeIssues(p.docsDir, join(p.docsDir, "features", "FEAT-1-x"), "FEAT-1");
  } finally {
    await p.destroy();
  }
}

const codes = (issues: Issue[]): string[] => issues.map((i) => i.code);

describe("section-heading grammar", () => {
  it("accepts the three delta sections, in any case and spacing", async () => {
    for (const heading of [
      "## ADDED Requirements",
      "## Added Requirements",
      "##  MODIFIED  Requirements",
      "## removed requirements",
    ]) {
      const issues = await shapeIssues({
        [`services/${SVC}/spec.md`]: LIVING,
        "features/FEAT-1-x/specs/payment-service/spec.md": section(heading, "Authorize a payment"),
      });
      expect(codes(issues), heading).not.toContain("delta.unknown-section");
    }
  });

  it("catches the singular — `## ADDED Requirement` merges nothing today, silently", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## ADDED Requirement", "New thing"),
    });
    const issue = issues.find((i) => i.code === "delta.unknown-section")!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toContain("ADDED Requirement");
  });

  it("catches a synonym nobody implemented", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## NEW Requirements", "New thing"),
    });
    expect(codes(issues)).toContain("delta.unknown-section");
  });

  it("catches trailing punctuation", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## ADDED Requirements:", "New thing"),
    });
    expect(codes(issues)).toContain("delta.unknown-section");
  });

  it("leaves a plain `## Requirements` section alone — quoting the living state is legal", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## Requirements", "Authorize a payment"),
    });
    expect(codes(issues)).not.toContain("delta.unknown-section");
  });

  it("does not flag prose headings that merely mention requirements", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

## Notes on Requirements

Some context.

## Open Questions

## ADDED Requirements

### Requirement: New thing
The service SHALL do the thing.

#### Scenario: It happens
- **Given** a trigger
- **When** it fires
- **Then** the thing happens
`,
    });
    expect(codes(issues)).not.toContain("delta.unknown-section");
  });

  it("ignores a heading-shaped line inside a fenced block", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

## ADDED Requirements

### Requirement: New thing
The service SHALL do the thing.

\`\`\`markdown
## ADDED Requirement
\`\`\`

#### Scenario: It happens
- **Given** a trigger
- **When** it fires
- **Then** the thing happens
`,
    });
    expect(codes(issues)).not.toContain("delta.unknown-section");
  });
});

describe("MODIFIED and REMOVED against the living spec", () => {
  it("a MODIFIED requirement that exists is clean", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## MODIFIED Requirements",
        "Authorize a payment",
      ),
    });
    expect(issues).toEqual([]);
  });

  it("a MODIFIED requirement that does not exist is an error, not a silent create", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## MODIFIED Requirements",
        "Phantom behaviour",
      ),
    });
    const issue = issues.find((i) => i.code === "delta.modified-unknown")!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toContain("Phantom behaviour");
    expect(issue.message).toContain("ADDED");
  });

  it("a MODIFIED requirement for a service with no living spec at all is an error", async () => {
    const issues = await shapeIssues({
      "features/FEAT-1-x/specs/ghost-service/spec.md": section(
        "## MODIFIED Requirements",
        "Phantom behaviour",
      ),
    });
    expect(codes(issues)).toContain("delta.modified-unknown");
  });

  it("a REMOVED requirement that exists is clean", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# delta

## REMOVED Requirements

### Requirement: Authorize a payment
`,
    });
    expect(issues).toEqual([]);
  });

  it("a REMOVED requirement that does not exist is an error — nothing to remove", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# delta

## REMOVED Requirements

### Requirement: Never existed
`,
    });
    const issue = issues.find((i) => i.code === "delta.removed-unknown")!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toContain("Never existed");
  });
});

describe("ADDED against the living spec", () => {
  it("a genuinely new requirement is clean", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## ADDED Requirements", "Refund a payment"),
    });
    expect(issues).toEqual([]);
  });

  it("ADDING a name that already exists is an error — archive would replace it, not add", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Authorize a payment",
      ),
    });
    const issue = issues.find((i) => i.code === "delta.added-duplicate")!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toContain("MODIFIED");
  });
});

describe("features in flight", () => {
  const other = (kind: string, name: string): Record<string, string> => ({
    "features/FEAT-2-other/specs/payment-service/spec.md": section(kind, name),
  });

  it("MODIFYING a requirement another ACTIVE feature adds is a warning that names the ordering", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      ...other("## ADDED Requirements", "Refund a payment"),
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## MODIFIED Requirements",
        "Refund a payment",
      ),
    });
    const issue = issues.find((i) => i.code === "delta.modified-pending")!;
    expect(issue.severity).toBe("warn");
    expect(issue.message).toContain("FEAT-2");
    expect(codes(issues)).not.toContain("delta.modified-unknown");
  });

  it("REMOVING a requirement another active feature adds is the same warning", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      ...other("## ADDED Requirements", "Refund a payment"),
      "features/FEAT-1-x/specs/payment-service/spec.md": `# delta

## REMOVED Requirements

### Requirement: Refund a payment
`,
    });
    expect(codes(issues)).toContain("delta.removed-pending");
  });

  it("two active features adding the same requirement collide", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      ...other("## ADDED Requirements", "Refund a payment"),
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Refund a payment",
      ),
    });
    const issue = issues.find((i) => i.code === "delta.added-conflict")!;
    expect(issue.severity).toBe("warn");
    expect(issue.message).toContain("FEAT-2");
  });

  it("another feature adding it for a DIFFERENT service rescues nothing", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-2-other/specs/other-service/spec.md": section(
        "## ADDED Requirements",
        "Refund a payment",
      ),
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## MODIFIED Requirements",
        "Refund a payment",
      ),
    });
    expect(codes(issues)).toContain("delta.modified-unknown");
  });

  it("an ARCHIVED feature does not count as in flight", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/archive/FEAT-2-old/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Refund a payment",
      ),
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## MODIFIED Requirements",
        "Refund a payment",
      ),
    });
    expect(codes(issues)).toContain("delta.modified-unknown");
  });

  it("a feature never accuses itself of being in flight", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Refund a payment",
      ),
    });
    expect(codes(issues)).not.toContain("delta.added-conflict");
  });
});

describe("the gate", () => {
  const ghostFixture = (): Record<string, string> => ({
    [`services/${SVC}/spec.md`]: LIVING,
    "features/FEAT-9-ghost/specs/payment-service/spec.md": section(
      "## MODIFIED Requirements",
      "Phantom behaviour",
    ),
  });

  it("validate --feature reports the code and fails", async () => {
    const p = await makeProject(ghostFixture());
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(false);
      const found = json.targets[0].findings.map((f: { code: string }) => f.code);
      expect(found).toContain("delta.modified-unknown");
    } finally {
      await p.destroy();
    }
  });

  it("archive refuses it, and the living spec is untouched", async () => {
    const p = await makeProject(ghostFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-9");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(await p.read(`services/${SVC}/spec.md`)).toBe(LIVING);
      expect(p.exists("features/FEAT-9-ghost")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("--approve still archives it — the old behaviour, now a deliberate choice", async () => {
    const p = await makeProject(ghostFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-9", "--approve");
      expect(res.code).toBe(0);
      expect(await p.read(`services/${SVC}/spec.md`)).toContain("Phantom behaviour");
    } finally {
      await p.destroy();
    }
  });

  it("the canonical coherent fixture stays clean", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("names the service the breach is in", async () => {
    const p = await makeProject(ghostFixture());
    try {
      const json = JSON.parse(
        (await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json")).stdout,
      );
      const finding = json.targets[0].findings.find(
        (f: { code: string }) => f.code === "delta.modified-unknown",
      );
      expect(finding.subject).toBe(SVC);
    } finally {
      await p.destroy();
    }
  });
});
