/**
 * Deep invariant tests for src/core/spec.ts:
 *   parseRequirements / requirementsMissingScenarios / serializeRequirements / applyRequirementDelta
 *
 * Tests assert DESIRED behavior per SCHEMA.md ("Living spec vs delta") and the module
 * docstrings — not whatever the current implementation happens to do. Failing tests are
 * documented suspected bugs (see the structured report of the run).
 */
import { describe, it, expect } from "vitest";
import { LIVING_SPEC, FEATURE_SPEC } from "./helpers/harness.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  requirementsMissingScenarios,
  type Requirement,
  type DeltaKind,
} from "../src/core/spec.js";

/** Semantic view of a requirement: content modulo whitespace framing (serialize trims by contract). */
function sem(r: Requirement) {
  return {
    kind: r.kind,
    name: r.name,
    text: r.text.join("\n").trim(),
    operations: r.operations,
    scenarios: r.scenarios.map((s) => ({ name: s.name, body: s.lines.join("\n").trim() })),
  };
}

/** Build a Requirement literal for applyRequirementDelta tests. */
function req(
  kind: DeltaKind,
  name: string,
  opts: { text?: string[]; operations?: string[]; scenarios?: { name: string; lines: string[] }[] } = {},
): Requirement {
  return {
    kind,
    name,
    text: opts.text ?? [`The service SHALL ${name.toLowerCase()}.`],
    operations: opts.operations ?? [],
    scenarios: opts.scenarios ?? [{ name: `${name} works`, lines: ["- **Then** it works"] }],
  };
}

/* ------------------------------------------------------------------ */
/* Roundtrip normalization                                            */
/* ------------------------------------------------------------------ */

describe("roundtrip: parse ∘ serialize normalization", () => {
  it("living spec: parse(serialize(parse(md))) preserves all content with kind BASE", () => {
    const once = parseRequirements(LIVING_SPEC);
    const again = parseRequirements(serializeRequirements(once));
    expect(again.map(sem)).toEqual(once.map((r) => ({ ...sem(r), kind: "BASE" })));
  });

  it("feature delta: roundtrip preserves content, normalizing ADDED kind to BASE", () => {
    const once = parseRequirements(FEATURE_SPEC);
    expect(once).toHaveLength(1);
    expect(once[0]!.kind).toBe("ADDED");
    const again = parseRequirements(serializeRequirements(once));
    expect(again.map(sem)).toEqual(once.map((r) => ({ ...sem(r), kind: "BASE" })));
  });

  it("serialize is idempotent on its own output (exact string fixpoint)", () => {
    for (const md of [LIVING_SPEC, FEATURE_SPEC]) {
      const norm = serializeRequirements(parseRequirements(md));
      expect(serializeRequirements(parseRequirements(norm))).toBe(norm);
    }
  });

  it("serialized output ends with exactly one newline and contains no 3+ newline runs", () => {
    const out = serializeRequirements(parseRequirements(LIVING_SPEC));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(/\n{3,}/.test(out)).toBe(false);
  });

  it("multi-requirement, multi-scenario doc roundtrips preserving order", () => {
    const md = `## Requirements

### Requirement: Authorize payment
The service SHALL reserve funds.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **Then** funds are reserved

#### Scenario: Declined card
- **Given** an expired card
- **Then** authorization is refused

### Requirement: Capture payment
The service SHALL settle an authorized payment.

Operations: capturePayment

#### Scenario: Capture an authorized payment
- **Given** an authorized payment
- **Then** the payment is settled
`;
    const once = parseRequirements(md);
    expect(once.map((r) => r.name)).toEqual(["Authorize payment", "Capture payment"]);
    expect(once[0]!.scenarios.map((s) => s.name)).toEqual([
      "Successful authorization",
      "Declined card",
    ]);
    const again = parseRequirements(serializeRequirements(once));
    expect(again.map(sem)).toEqual(once.map(sem));
  });
});

/* ------------------------------------------------------------------ */
/* Content preservation through roundtrip                              */
/* ------------------------------------------------------------------ */

describe("content preservation through roundtrip", () => {
  it("requirement body text and Operations line survive roundtrip exactly (trimmed)", () => {
    const [r] = parseRequirements(serializeRequirements(parseRequirements(LIVING_SPEC)));
    expect(sem(r!).text).toBe(
      "The service SHALL authorize a payment before capture.\n\nOperations: authorizePayment",
    );
    expect(r!.operations).toEqual(["authorizePayment"]);
  });

  it("a blank line inside a scenario body survives roundtrip", () => {
    const md = `### Requirement: Render receipt
The service SHALL render a receipt.

#### Scenario: Two-part receipt
- **Given** a paid order

- **Then** a receipt with header and footer is rendered
`;
    const once = parseRequirements(md);
    const again = parseRequirements(serializeRequirements(once));
    expect(sem(again[0]!).scenarios[0]!.body).toBe(
      "- **Given** a paid order\n\n- **Then** a receipt with header and footer is rendered",
    );
  });

  it("a fenced code block in a scenario body survives roundtrip verbatim", () => {
    const body = `- **Given** this request body:

\`\`\`json
{ "amount": 100.0, "shares": [60, 40] }
\`\`\`

- **Then** the split is created`;
    const md = `### Requirement: Create split
The service SHALL create splits.

#### Scenario: JSON payload
${body}
`;
    const once = parseRequirements(md);
    const again = parseRequirements(serializeRequirements(once));
    expect(again).toHaveLength(1);
    expect(sem(again[0]!).scenarios[0]!.body).toBe(body);
  });

  it("consecutive blank lines inside a fenced code block survive roundtrip (serialize must not collapse verbatim content)", () => {
    const body = `- **Given** this template:

\`\`\`text
line1


line2
\`\`\``;
    const md = `### Requirement: Preserve templates
The service SHALL store templates byte-for-byte.

#### Scenario: Blank-heavy template
${body}
`;
    const once = parseRequirements(md);
    expect(sem(once[0]!).scenarios[0]!.body).toBe(body); // parse alone keeps it
    const again = parseRequirements(serializeRequirements(once));
    expect(sem(again[0]!).scenarios[0]!.body).toBe(body);
  });

  it("Cyrillic requirement and scenario names with emoji survive roundtrip", () => {
    const md = `## Requirements

### Requirement: Разделение платежа
Сервис ДОЛЖЕН разделять платёж между получателями.

Operations: createSplit

#### Scenario: Успешное разделение 💸
- **Дано** платёж 100.00
- **Когда** делим 60/40
- **Тогда** записаны две доли
`;
    const once = parseRequirements(md);
    expect(once[0]!.name).toBe("Разделение платежа");
    expect(once[0]!.scenarios[0]!.name).toBe("Успешное разделение 💸");
    const again = parseRequirements(serializeRequirements(once));
    expect(again.map(sem)).toEqual(once.map(sem));
  });

  it("a requirement name containing a colon survives roundtrip intact", () => {
    const md = `### Requirement: Split: two-phase commit
The service SHALL split in two phases.

#### Scenario: Both phases succeed
- **Then** the split is durable
`;
    const once = parseRequirements(md);
    expect(once[0]!.name).toBe("Split: two-phase commit");
    const again = parseRequirements(serializeRequirements(once));
    expect(again[0]!.name).toBe("Split: two-phase commit");
  });

  it("a scenario name containing backticks survives roundtrip intact", () => {
    const md = `### Requirement: Idempotent create
The service SHALL be idempotent.

#### Scenario: calling \`createSplit\` twice
- **Then** one split exists
`;
    const again = parseRequirements(serializeRequirements(parseRequirements(md)));
    expect(again[0]!.scenarios[0]!.name).toBe("calling `createSplit` twice");
  });
});

/* ------------------------------------------------------------------ */
/* Parsing: delta kind sections                                        */
/* ------------------------------------------------------------------ */

describe("parsing: delta kind sections", () => {
  it("living spec requirements parse with kind BASE", () => {
    const reqs = parseRequirements(LIVING_SPEC);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.kind).toBe("BASE");
    expect(reqs[0]!.name).toBe("Authorize a payment");
  });

  it("ADDED / MODIFIED / REMOVED sections assign kinds per section", () => {
    const md = `## ADDED Requirements

### Requirement: New thing
Text.

#### Scenario: ok
- **Then** ok

## MODIFIED Requirements

### Requirement: Changed thing
Text.

#### Scenario: ok
- **Then** ok

## REMOVED Requirements

### Requirement: Old thing
`;
    const reqs = parseRequirements(md);
    expect(reqs.map((r) => [r.name, r.kind])).toEqual([
      ["New thing", "ADDED"],
      ["Changed thing", "MODIFIED"],
      ["Old thing", "REMOVED"],
    ]);
  });

  it("delta section heading is recognized case-insensitively", () => {
    const md = `## added requirements

### Requirement: X

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.kind).toBe("ADDED");
  });

  it("delta section heading tolerates extra interior and trailing whitespace", () => {
    const md = `##   MODIFIED   Requirements${"  "}

### Requirement: X

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.kind).toBe("MODIFIED");
  });

  it("a plain '## Notes' section after a delta section resets the kind to BASE", () => {
    const md = `## ADDED Requirements

### Requirement: New thing
The service SHALL do the thing.

#### Scenario: It works
- **Then** it works

## Notes

Rollout prose. The block below is documentation, not part of the delta.

### Requirement: Mentioned in notes
Prose only.

#### Scenario: Doc example
- **Then** nothing merges
`;
    const reqs = parseRequirements(md);
    expect(reqs.map((r) => r.name)).toEqual(["New thing", "Mentioned in notes"]);
    expect(reqs[0]!.kind).toBe("ADDED");
    // A requirement under an unrelated '## ' section must not inherit the stale
    // delta kind — otherwise archive would silently merge documentation prose.
    expect(reqs[1]!.kind).toBe("BASE");
  });
});

/* ------------------------------------------------------------------ */
/* Parsing: Operations lines                                           */
/* ------------------------------------------------------------------ */

describe("parsing: Operations lines", () => {
  it("comma+space list parses into individual operationIds, dropping empties", () => {
    const md = `### Requirement: R
Operations: createSplit, capturePayment, , authorizePayment

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.operations).toEqual([
      "createSplit",
      "capturePayment",
      "authorizePayment",
    ]);
  });

  it("singular 'Operation:' is accepted", () => {
    const md = `### Requirement: R
Operation: createSplit

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.operations).toEqual(["createSplit"]);
  });

  it("'operations:' is matched case-insensitively", () => {
    const md = `### Requirement: R
operations: createSplit

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.operations).toEqual(["createSplit"]);
  });

  it("an empty Operations line yields no operations", () => {
    const md = `### Requirement: R
Operations:${" "}

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.operations).toEqual([]);
  });

  it("an Operations line inside a scenario body does NOT attach to the requirement", () => {
    const md = `### Requirement: R
The service SHALL do things.

#### Scenario: mentions ops in prose
- **Given** the doc says "Operations: bogusOp"
Operations: bogusOp
- **Then** that is scenario body, not governance
`;
    const [r] = parseRequirements(md);
    expect(r!.operations).toEqual([]);
    expect(r!.scenarios[0]!.lines.join("\n")).toContain("Operations: bogusOp");
  });
});

/* ------------------------------------------------------------------ */
/* Parsing: structural edges                                           */
/* ------------------------------------------------------------------ */

describe("parsing: structural edges", () => {
  it("a scenario heading before any requirement does not crash and yields no requirements", () => {
    const md = `#### Scenario: orphan
- **Then** nothing

Some prose.
`;
    expect(parseRequirements(md)).toEqual([]);
  });

  it("a scenario directly after the requirement heading (no blank line, no text) still attaches", () => {
    const md = `### Requirement: Tight
#### Scenario: immediate
- **Then** attached
`;
    const [r] = parseRequirements(md);
    expect(r!.name).toBe("Tight");
    expect(r!.scenarios.map((s) => s.name)).toEqual(["immediate"]);
  });

  it("a requirement heading with no space after the colon still parses the name", () => {
    const md = `### Requirement:NoSpace

#### Scenario: ok
- **Then** ok
`;
    expect(parseRequirements(md)[0]!.name).toBe("NoSpace");
  });

  it("a CRLF document parses identically to the same LF document", () => {
    const lf = FEATURE_SPEC;
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(parseRequirements(crlf)).toEqual(parseRequirements(lf));
  });

  it("'### Requirement: fake' inside a fenced code block is scenario body, not a new requirement", () => {
    const md = `### Requirement: Render markdown
The service SHALL render markdown verbatim.

#### Scenario: Fenced example
- **Given** this payload:

\`\`\`markdown
### Requirement: fake
#### Scenario: fake inner
\`\`\`

- **Then** it renders unchanged
`;
    const reqs = parseRequirements(md);
    expect(reqs.map((r) => r.name)).toEqual(["Render markdown"]);
    expect(reqs[0]!.scenarios.map((s) => s.name)).toEqual(["Fenced example"]);
    expect(reqs[0]!.scenarios[0]!.lines.join("\n")).toContain("### Requirement: fake");
  });
});

/* ------------------------------------------------------------------ */
/* requirementsMissingScenarios                                        */
/* ------------------------------------------------------------------ */

describe("requirementsMissingScenarios", () => {
  it("a REMOVED requirement without scenarios is excluded", () => {
    const reqs = [req("REMOVED", "Gone", { scenarios: [] })];
    expect(requirementsMissingScenarios(reqs)).toEqual([]);
  });

  it("ADDED, MODIFIED, and BASE requirements with zero scenarios are all included", () => {
    const reqs = [
      req("ADDED", "A", { scenarios: [] }),
      req("MODIFIED", "M", { scenarios: [] }),
      req("BASE", "B", { scenarios: [] }),
    ];
    expect(requirementsMissingScenarios(reqs).map((r) => r.name)).toEqual(["A", "M", "B"]);
  });

  it("a requirement with at least one scenario is excluded", () => {
    const reqs = [req("BASE", "Covered"), req("BASE", "Uncovered", { scenarios: [] })];
    expect(requirementsMissingScenarios(reqs).map((r) => r.name)).toEqual(["Uncovered"]);
  });
});

/* ------------------------------------------------------------------ */
/* applyRequirementDelta algebra                                       */
/* ------------------------------------------------------------------ */

describe("applyRequirementDelta algebra", () => {
  const living = () => [req("BASE", "Alpha"), req("BASE", "Beta"), req("BASE", "Gamma")];

  it("ADDED appends at the end with kind BASE", () => {
    const out = applyRequirementDelta(living(), [req("ADDED", "Delta-new")]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma", "Delta-new"]);
    expect(out[3]!.kind).toBe("BASE");
  });

  it("MODIFIED replaces in place, preserving position", () => {
    const changed = req("MODIFIED", "Beta", { text: ["The service SHALL do Beta v2."] });
    const out = applyRequirementDelta(living(), [changed]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(out[1]!.text).toEqual(["The service SHALL do Beta v2."]);
    expect(out[1]!.kind).toBe("BASE");
  });

  it("REMOVED deletes the named requirement", () => {
    const out = applyRequirementDelta(living(), [req("REMOVED", "Beta", { scenarios: [] })]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Gamma"]);
  });

  it("REMOVED of a missing requirement is a no-op", () => {
    const out = applyRequirementDelta(living(), [req("REMOVED", "Nope", { scenarios: [] })]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("applying the same mixed delta twice equals applying it once (idempotence)", () => {
    const delta = [
      req("ADDED", "Delta-new"),
      req("MODIFIED", "Beta", { text: ["v2"] }),
      req("REMOVED", "Gamma", { scenarios: [] }),
    ];
    const once = applyRequirementDelta(living(), delta);
    const twice = applyRequirementDelta(once, delta);
    expect(twice).toEqual(once);
  });

  it("every requirement in the merged result has kind BASE", () => {
    const delta = [
      req("ADDED", "Delta-new"),
      req("MODIFIED", "Alpha", { text: ["v2"] }),
    ];
    const out = applyRequirementDelta(living(), delta);
    expect(out.map((r) => r.kind)).toEqual(["BASE", "BASE", "BASE", "BASE"]);
  });

  it("does not mutate its living or delta inputs", () => {
    const liv = living();
    const delta = [
      req("ADDED", "Delta-new"),
      req("MODIFIED", "Beta", { text: ["v2"] }),
      req("REMOVED", "Gamma", { scenarios: [] }),
    ];
    const livSnap = structuredClone(liv);
    const deltaSnap = structuredClone(delta);
    applyRequirementDelta(liv, delta);
    expect(liv).toEqual(livSnap);
    expect(delta).toEqual(deltaSnap);
  });

  it("MODIFIED of a requirement that does not exist upserts (appends) rather than dropping the change", () => {
    // Lenient upsert keeps the living spec complete; `loam validate` is where the
    // authoring error should be caught. Flagged as a design question: a typo'd
    // name silently becomes a new requirement while the original stays stale.
    const out = applyRequirementDelta(living(), [req("MODIFIED", "Beta v2 (typo)", { text: ["v2"] })]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma", "Beta v2 (typo)"]);
    expect(out[3]!.kind).toBe("BASE");
  });

  it("ADDED colliding with an existing name replaces it in place — never a duplicate name", () => {
    // Invariant that must hold either way: the merged living spec has no duplicate
    // names. Current semantics silently overwrite the living content (flagged as a
    // design question — data loss without a warning).
    const out = applyRequirementDelta(living(), [req("ADDED", "Beta", { text: ["overwritten"] })]);
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(out[1]!.text).toEqual(["overwritten"]);
    const names = out.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("REMOVED leaves no requirement with that name even when the living list has duplicates", () => {
    const liv = [req("BASE", "Dup"), req("BASE", "Middle"), req("BASE", "Dup")];
    const out = applyRequirementDelta(liv, [req("REMOVED", "Dup", { scenarios: [] })]);
    expect(out.filter((r) => r.name === "Dup")).toEqual([]);
    expect(out.map((r) => r.name)).toEqual(["Middle"]);
  });

  it("applying a delta to an empty living set keeps ADDED/MODIFIED as BASE and drops REMOVED (archive bootstrap)", () => {
    const delta = [
      req("ADDED", "First"),
      req("MODIFIED", "Second"),
      req("REMOVED", "Ghost", { scenarios: [] }),
    ];
    const out = applyRequirementDelta([], delta);
    expect(out.map((r) => [r.name, r.kind])).toEqual([
      ["First", "BASE"],
      ["Second", "BASE"],
    ]);
  });
});
