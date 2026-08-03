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
 * A fifth is the same silence reached by a legal route: a requirement under an
 * ordinary prose heading (`## Behavior`, `## Error Handling`) is BASE too, so it
 * never merges. Upstream OpenSpec deltas really are written that way, so the
 * answer is to report the loss, not to start merging prose sections. Only
 * `## Requirements` is exempt — quoting the living state inside a delta is legal.
 *
 * These run inside featureCoherence, so `archive` is gated on them.
 *
 * Families:
 *  - section-heading grammar: near misses vs legitimate non-delta sections
 *  - requirements a prose heading strands, and the gate around them
 *  - deltas that would merge nothing at all: requirements present, delta kinds absent
 *  - MODIFIED / REMOVED / ADDED against the living spec, including case drift
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
    // Nor the not-merged warning: `## Requirements` is the one non-delta heading
    // whose requirements are SUPPOSED not to merge, so flagging it would train
    // authors to ignore the warning everywhere else.
    expect(codes(issues)).not.toContain("delta.requirement-not-merged");
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

describe("requirements a prose heading strands", () => {
  /* A delta section heading is what gives a requirement its kind. Anything under a
   * different H2 parses as BASE, and applyRequirementDelta skips BASE — so the
   * requirement is written, passes every other check, and then never reaches a
   * living spec. `delta.unknown-section` does not cover this: `## Behavior` is not
   * a near miss of the grammar, it is simply another heading.
   *
   * OpenSpec's own older "complete future state" deltas are written this way (6 of
   * the 8 requirements in the cli-archive fixture), so this is a real authoring
   * shape, not a hypothetical typo. The fix is to make the loss visible, not to
   * merge it — merging prose headings would mean archive guessing which sections
   * are changes. */

  /** A delta with `name` under a delta section and `stranded` under `heading`. */
  function stranded(heading: string, ...names: string[]): string {
    return `# ${SVC} — delta

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund a payment.

#### Scenario: It happens
- **Then** the refund is recorded

${heading}

${names
  .map(
    (n) => `### Requirement: ${n}
The service SHALL do the thing.

#### Scenario: It happens
- **Then** the thing happens
`,
  )
  .join("\n")}`;
  }

  it("names the requirement, quotes the heading, and says archive will not merge it", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": stranded("## Behavior", "Capture a payment"),
    });
    const issue = issues.find((i) => i.code === "delta.requirement-not-merged")!;
    expect(issue.subject).toBe(SVC);
    expect(issue.message).toContain("Capture a payment");
    expect(issue.message).toContain("## Behavior");
    // The author must be able to act on the message without reading our source:
    // what happens, and what to do instead.
    expect(issue.message).toMatch(/not merge/i);
    expect(issue.message).toContain("## ADDED Requirements");
  });

  it("is a warning that GATES archive — the one check where the two axes diverge", async () => {
    // Severity and gating answer different questions (issue.ts). The document
    // is legal OpenSpec — an error would fail `loam validate` on every adopted
    // repo whose active deltas still use the shape — so severity stays warn.
    // But the merge would silently drop authored content, the exact loss this
    // module exists to prevent, so the issue gates archive all the same.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": stranded("## Behavior", "Capture a payment"),
    });
    const issue = issues.find((i) => i.code === "delta.requirement-not-merged")!;
    expect(issue.severity).toBe("warn");
    expect(issue.gates).toBe(true);
  });

  it("reports every stranded requirement, not just the first under the heading", async () => {
    // One warning per casualty: a count is what tells the author how much of their
    // delta is inert.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": stranded(
        "## Error Handling",
        "Reject an expired card",
        "Reject a duplicate capture",
      ),
    });
    const stray = issues.filter((i) => i.code === "delta.requirement-not-merged");
    expect(stray).toHaveLength(2);
    expect(stray.map((i) => i.message.includes("Reject an expired card"))).toContain(true);
    expect(stray.map((i) => i.message.includes("Reject a duplicate capture"))).toContain(true);
  });

  it("says nothing about the requirements that DO merge", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": stranded("## Behavior", "Capture a payment"),
    });
    expect(
      issues.filter((i) => i.message.includes("Refund a payment")),
      "the ADDED requirement is fine and must not be dragged into the warning",
    ).toEqual([]);
  });

  it("a delta made entirely of delta sections is silent", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## ADDED Requirements", "Refund a payment"),
    });
    expect(codes(issues)).not.toContain("delta.requirement-not-merged");
  });

  it("a near-miss heading reports both: the heading is wrong AND these requirements are lost", async () => {
    // Deliberate overlap. `delta.unknown-section` diagnoses the heading;
    // `delta.requirement-not-merged` enumerates what it costs. Neither alone tells
    // the author both what to fix and what they would have lost.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section("## ADDED Requirement", "New thing"),
    });
    expect(codes(issues)).toContain("delta.unknown-section");
    const issue = issues.find((i) => i.code === "delta.requirement-not-merged")!;
    expect(issue.message).toContain("New thing");
  });

  it("a `### Requirement:` quoted inside a fenced block is not a stranded requirement", async () => {
    // The fence tracker is shared with the rest of the parse, so documentation
    // that shows the format cannot be reported as lost content.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

## Notes

Authors write requirements like this:

\`\`\`markdown
### Requirement: Not a real requirement
\`\`\`

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund a payment.

#### Scenario: It happens
- **Then** the refund is recorded
`,
    });
    expect(codes(issues)).not.toContain("delta.requirement-not-merged");
  });

  it("a requirement above every heading is left alone — there is no heading to name", async () => {
    // The check reports a heading that strands a requirement. With no H2 at all
    // there is nothing to quote, and the file is not written in the delta grammar
    // in the first place; `## Requirements`-style quoting is the same judgement.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

### Requirement: Floating thing
The service SHALL do the thing.

#### Scenario: It happens
- **Then** the thing happens
`,
    });
    expect(codes(issues)).not.toContain("delta.requirement-not-merged");
  });
});

describe("the stranded-requirement gate", () => {
  /** FEAT-12 adds one requirement properly and strands another under `## Behavior`. */
  const strandedFixture = (): Record<string, string> => ({
    [`services/${SVC}/spec.md`]: LIVING,
    "features/FEAT-12-half/specs/payment-service/spec.md": `# ${SVC} — delta

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund a payment.

#### Scenario: It happens
- **Then** the refund is recorded

## Behavior

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: It happens
- **Then** the capture is recorded
`,
  });

  it("validate --feature passes but marks the finding as gating — the two answers, side by side", async () => {
    // The document is valid (warnings never gate validate); the merge is not
    // safe (`gates: true` — archive will refuse). An agent reading this output
    // knows both without running archive.
    const p = await makeProject(strandedFixture());
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-12", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(true);
      const finding = json.targets[0].findings.find(
        (f: { code: string }) => f.code === "delta.requirement-not-merged",
      );
      expect(finding.severity).toBe("warn");
      expect(finding.gates).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("archive refuses it — the loss lands at merge, so that is where it must stop", async () => {
    const p = await makeProject(strandedFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-12");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("Capture a payment");
      expect(await p.read(`services/${SVC}/spec.md`)).toBe(LIVING);
    } finally {
      await p.destroy();
    }
  });

  it("--approve archives, and the warning was telling the truth: the requirement is gone", async () => {
    // The point of the whole check. Before it, this outcome happened in silence.
    const p = await makeProject(strandedFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-12", "--approve");
      expect(res.code).toBe(0);
      const living = await p.read(`services/${SVC}/spec.md`);
      expect(living).toContain("Refund a payment");
      expect(living).not.toContain("Capture a payment");
    } finally {
      await p.destroy();
    }
  });
});

describe("a delta with requirements but no delta section at all", () => {
  /* The whole-file backstop. The near-miss check only sees single-word misses
   * (`## NEW Requirements`), and the stranded-requirement warning fires per
   * requirement — neither states the sum: this file, as written, merges NOTHING.
   * That is the BOM failure class reached by authoring instead of encoding, and
   * with LLM authors it arrives via headings no regex anticipates. */

  /** Two requirements, both under a prose heading — a delta that is all inert. */
  const inert = `# ${SVC} — delta

## Behavior

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: It happens
- **Then** the capture is recorded

### Requirement: Refund a payment
The service SHALL refund a payment.

#### Scenario: It happens
- **Then** the refund is recorded
`;

  it("is an error that names the file, counts the loss, and says the delta merges nothing", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": inert,
    });
    const issue = issues.find((i) => i.code === "delta.no-delta-sections")!;
    expect(issue.severity).toBe("error");
    expect(issue.subject).toBe(SVC);
    expect(issue.message).toContain("specs/payment-service/spec.md");
    expect(issue.message).toContain("2 requirement");
    expect(issue.message).toContain("merge nothing");
  });

  it("catches a multi-word near miss the heading check cannot see", async () => {
    // `## NEWLY ADDED Requirements` has two words before `Requirements`, so
    // NEAR_SECTION_RE never matches it — the whole-file check is what makes the
    // heading grammar impossible to dodge rather than merely hard.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## NEWLY ADDED Requirements",
        "New thing",
      ),
    });
    expect(codes(issues)).not.toContain("delta.unknown-section");
    expect(codes(issues)).toContain("delta.no-delta-sections");
  });

  it("catches a requirement above every heading — no heading needed to detect a no-op delta", async () => {
    // The stranded-requirement warning stays silent here (no heading to name);
    // the whole-file check does not care WHY nothing merges, only that it would.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

### Requirement: Floating thing
The service SHALL do the thing.

#### Scenario: It happens
- **Then** the thing happens
`,
    });
    expect(codes(issues)).toContain("delta.no-delta-sections");
  });

  it("a delta that only quotes the living state merges nothing, and is told so", async () => {
    // Quoting under `## Requirements` is legal AS A SECTION — the not-merged
    // warning stays exempt. But a file that is nothing but quotes is a delta that
    // does nothing, which is not a delta.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## Requirements",
        "Authorize a payment",
      ),
    });
    expect(codes(issues)).toContain("delta.no-delta-sections");
    expect(codes(issues)).not.toContain("delta.requirement-not-merged");
  });

  it("one delta-kind requirement rescues the file — mixing with quoted BASE is legal", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund a payment.

#### Scenario: It happens
- **Then** the refund is recorded

## Behavior

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: It happens
- **Then** the capture is recorded
`,
    });
    // The stranded requirement keeps its per-requirement warning; the whole-file
    // error is only for a delta with NO live payload at all.
    expect(codes(issues)).not.toContain("delta.no-delta-sections");
    expect(codes(issues)).toContain("delta.requirement-not-merged");
  });

  it("a file with no requirements at all is not a no-op delta — there is nothing to lose", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": `# ${SVC} — delta\n\nContext prose only.\n`,
    });
    expect(codes(issues)).not.toContain("delta.no-delta-sections");
  });

  it("validate --feature reports the code and fails — an error gates validate", async () => {
    const p = await makeProject({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-13-inert/specs/payment-service/spec.md": inert,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-13", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(false);
      const found = json.targets[0].findings.map((f: { code: string }) => f.code);
      expect(found).toContain("delta.no-delta-sections");
    } finally {
      await p.destroy();
    }
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

  it("ADDING a case variant of a living name warns, naming both spellings", async () => {
    // Merge identity is exact string equality, so 'Authorize A Payment' passes the
    // duplicate check and lands as a SECOND requirement beside the living one — the
    // drift vector when the author is an LLM. A warning, not an error: nothing
    // living is overwritten, and the author may genuinely mean a distinct name.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Authorize A Payment",
      ),
    });
    const issue = issues.find((i) => i.code === "delta.added-near-duplicate")!;
    expect(issue.severity).toBe("warn");
    expect(issue.subject).toBe(SVC);
    // Both spellings, verbatim — seeing the difference IS the fix.
    expect(issue.message).toContain("'Authorize A Payment'");
    expect(issue.message).toContain("'Authorize a payment'");
    expect(codes(issues)).not.toContain("delta.added-duplicate");
  });

  it("an exact duplicate is the replace error alone — near-duplicate never fires for the same pair", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      "features/FEAT-1-x/specs/payment-service/spec.md": section(
        "## ADDED Requirements",
        "Authorize a payment",
      ),
    });
    expect(codes(issues)).toContain("delta.added-duplicate");
    expect(codes(issues)).not.toContain("delta.added-near-duplicate");
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
