/**
 * The requirement baseline: `Based-On:`, `requirementDigest`, and `loam rebase`.
 *
 * The hole this closes is the one collision loam could not see. A MODIFIED
 * requirement carries its FULL new text, so archive REPLACES the living
 * requirement rather than merging into it — and `delta.modified-conflict` only
 * names the other feature while BOTH are in flight. The sequence a fleet
 * actually produces outlives that window:
 *
 *   1. FEAT-1 and FEAT-2 both MODIFY REQ-042. Both warn, neither is blocked.
 *   2. FEAT-1 archives and leaves `features/`, so it is no longer an active claim.
 *   3. FEAT-2 revalidates — GREEN, the warning is gone.
 *   4. FEAT-2 archives. Its pre-FEAT-1 text replaces FEAT-1's outright:
 *      `+0 ~1 -0`, exit 0, and nothing downstream can detect it afterwards
 *      (`unarchive FEAT-1` refuses `snapshot-stale`; `--force` takes FEAT-2 out too).
 *
 * A pin does not depend on timing, which is the whole reason it works. Families:
 *  - the digest: canonical, not bytes — stable across the reserialization
 *    archive performs, sensitive to everything that IS the requirement
 *  - the grammar: parsed, serialized, and STRIPPED on the way into living docs
 *  - the checks: missing (warn), stale (error + gates), invalid (three shapes)
 *  - the scenario above, end to end, through the real commands
 *  - `loam rebase`: what it writes, what it refuses to invent, what it preserves
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { deltaShapeIssues } from "../src/core/delta/delta.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { applyRequirementDelta } from "../src/core/document/apply.js";
import { serializeRequirements } from "../src/core/document/spec.js";
import { requirementDigest } from "../src/core/document/spec.js";
import { coherentFixture, makeProject, pinFor, runLoam, type Project } from "./helpers/harness.js";

const SVC = "payment-service";

const LIVING = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
The service SHALL let a customer cancel an order.

#### Scenario: Cancellation succeeds
- **Given** an open order
- **When** the customer cancels it
- **Then** the order is cancelled
`;

const PIN = pinFor(LIVING, "Cancel an order");

/** A MODIFIED delta for REQ-042 carrying `basedOn` (omit it for an unpinned one). */
function modified(body: string, basedOn?: string): string {
  return `# ${SVC} — delta

## MODIFIED Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
${basedOn === undefined ? "" : `Based-On: ${basedOn}\n`}${body}

#### Scenario: Cancellation succeeds
- **Given** an open order
- **When** the customer cancels it
- **Then** the order is cancelled
`;
}

/** Run the delta-shape check for FEAT-1 over a fixture, then clean up. */
async function shapeIssues(files: Record<string, string>): Promise<Issue[]> {
  const p: Project = await makeProject(files);
  try {
    return await deltaShapeIssues(p.docsDir, join(p.docsDir, "features", "FEAT-1-x"), "FEAT-1");
  } finally {
    await p.destroy();
  }
}

const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

describe("requirementDigest is over the canonical form, not the bytes", () => {
  const requirement = () => parseRequirements(LIVING)[0]!;

  it("survives the reserialization archive performs on every merge", () => {
    // The load-bearing property. `loam archive` rewrites a living spec's whole
    // requirements run through serializeRequirements, which normalizes framing
    // (a blank line lands under every heading). Hashing bytes would make every
    // unrelated archive invalidate every outstanding pin — a false collision
    // report on the one check whose value is that it fires only for real ones.
    const once = serializeRequirements([requirement()]);
    const twice = serializeRequirements(parseRequirements(once));
    expect(requirementDigest(parseRequirements(once)[0]!)).toBe(requirementDigest(requirement()));
    expect(requirementDigest(parseRequirements(twice)[0]!)).toBe(requirementDigest(requirement()));
  });

  it("ignores exactly the framing archive itself introduces", () => {
    // A blank line under the heading is what serializeRequirements writes, so a
    // hand-authored living spec and the same spec after any unrelated archive
    // hash identically — otherwise every archive would invalidate every
    // outstanding pin in the service.
    expect(
      pinFor(
        LIVING.replace(
          "### Requirement: Cancel an order\nRequirement-ID: REQ-042",
          "### Requirement: Cancel an order\n\nRequirement-ID: REQ-042",
        ),
        "Cancel an order",
      ),
    ).toBe(PIN);
    expect(pinFor(LIVING + "\n\n", "Cancel an order")).toBe(PIN);
  });

  it("treats a blank line INSIDE the body as content, because serialization does", () => {
    // Body blank lines survive verbatim — they are how paragraphs and fenced
    // blocks are written — so they are part of the requirement, and a human who
    // reflows one has edited it. Strict in the direction of "go re-read it",
    // which is the safe direction for a check that gates.
    expect(
      pinFor(LIVING.replace("REQ-042\nThe service", "REQ-042\n\nThe service"), "Cancel an order"),
    ).not.toBe(PIN);
  });

  it("ignores the delta bookkeeping around it — kind, section, and the pin itself", () => {
    const base = requirement();
    expect(requirementDigest({ ...base, kind: "MODIFIED" })).toBe(PIN);
    expect(requirementDigest({ ...base, section: "## Something Else" })).toBe(PIN);
    // A requirement's identity cannot depend on a pin pointing AT it, or no
    // baseline could ever be self-consistent.
    expect(requirementDigest({ ...base, basedOn: "0123456789abcdef" })).toBe(PIN);
    expect(
      requirementDigest({ ...base, text: ["Requirement-ID: REQ-042", "Based-On: 0123456789abcdef", ...base.text.slice(1)] }),
    ).toBe(PIN);
  });

  it("moves when anything that IS the requirement moves", () => {
    const changed = [
      LIVING.replace("cancel an order.", "cancel an order within 30 minutes."),
      LIVING.replace("### Requirement: Cancel an order", "### Requirement: Cancel an order early"),
      LIVING.replace("Requirement-ID: REQ-042", "Requirement-ID: REQ-043"),
      LIVING.replace("- **Then** the order is cancelled", "- **Then** the order is cancelled and refunded"),
      LIVING.replace("#### Scenario: Cancellation succeeds", "#### Scenario: Cancellation works"),
      LIVING + "\n#### Scenario: Extra\n- **Given** a thing\n",
    ];
    for (const md of changed) {
      const name = md.includes("Cancel an order early") ? "Cancel an order early" : "Cancel an order";
      expect(pinFor(md, name)).not.toBe(PIN);
    }
  });

  it("is 16 lowercase hex characters, like every other digest loam stamps", () => {
    expect(PIN).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ------------------------------------------------------------------ */
/* The grammar                                                         */
/* ------------------------------------------------------------------ */

describe("Based-On: is parsed, serialized, and never reaches a living document", () => {
  it("parses into basedOn, case-insensitively, keeping the line in text", () => {
    const r = parseRequirements(modified("The service SHALL do it.", PIN))[0]!;
    expect(r.basedOn).toBe(PIN);
    expect(r.text).toContain(`Based-On: ${PIN}`);
    expect(parseRequirements(modified("x.", PIN).replace("Based-On:", "based-on:"))[0]!.basedOn).toBe(PIN);
  });

  it("serializes directly under Requirement-ID, where rebase writes it", () => {
    const r = parseRequirements(LIVING)[0]!;
    const out = serializeRequirements([{ ...r, text: ["The service SHALL x."], basedOn: PIN }]);
    expect(out).toContain(`Requirement-ID: REQ-042\nBased-On: ${PIN}\n`);
  });

  it("is stripped by the merge — a living requirement never carries a pin", () => {
    const living = parseRequirements(LIVING);
    const delta = parseRequirements(modified("The service SHALL do it differently.", PIN));
    const merged = applyRequirementDelta(living, delta);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.basedOn).toBeUndefined();
    expect(merged[0]!.text.join("\n")).not.toContain("Based-On");
    expect(serializeRequirements(merged)).not.toContain("Based-On");
  });

  it("stripping is what keeps the NEXT feature's pin honest", () => {
    // Left in, the living document would grow a pin to a version of itself, and
    // the next baseline would be a hash of the previous feature's bookkeeping.
    const merged = applyRequirementDelta(
      parseRequirements(LIVING),
      parseRequirements(modified("The service SHALL do it differently.", PIN)),
    );
    const nextLiving = serializeRequirements(merged);
    expect(requirementDigest(parseRequirements(nextLiving)[0]!)).toBe(
      requirementDigest(parseRequirements(serializeRequirements(merged))[0]!),
    );
  });
});

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

describe("a pin that matches the living text says nothing", () => {
  it("is silent for MODIFIED and for REMOVED alike", async () => {
    expect(
      await shapeIssues({
        [`services/${SVC}/spec.md`]: LIVING,
        [`features/FEAT-1-x/specs/${SVC}/spec.md`]: modified("The service SHALL do it differently.", PIN),
      }),
    ).toEqual([]);
    expect(
      await shapeIssues({
        [`services/${SVC}/spec.md`]: LIVING,
        [`features/FEAT-1-x/specs/${SVC}/spec.md`]: `# delta

## REMOVED Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
Based-On: ${PIN}
`,
      }),
    ).toEqual([]);
  });

  it("resolves by exact heading too, for a delta carrying no stable ID", async () => {
    const legacyLiving = LIVING.replace("Requirement-ID: REQ-042\n", "");
    const files = {
      [`services/${SVC}/spec.md`]: legacyLiving,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: `# delta

## MODIFIED Requirements

### Requirement: Cancel an order
Based-On: ${pinFor(legacyLiving, "Cancel an order")}
The service SHALL do it differently.

#### Scenario: Cancellation succeeds
- **Given** an open order
- **When** the customer cancels it
- **Then** the order is cancelled
`,
    };
    expect(await shapeIssues(files)).toEqual([]);
  });
});

describe("a missing pin is a warning that GATES — unpinned is the silent-rollback shape", () => {
  it("warns, names the value to write, and gates the archive", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: modified("The service SHALL do it differently."),
    });
    const [issue, ...rest] = only(issues, "delta.baseline-missing");
    expect(rest).toEqual([]);
    // Warn, not error: the document is legal (an adopted corpus never had the
    // line), so `loam validate` stays green. Gating, because the merge is not
    // safe: an unpinned MODIFIED replaces whatever landed in between, which is
    // exactly the loss the pin exists to prevent. `--approve` remains the way
    // to say the unpinned merge is meant.
    expect(issue!.severity).toBe("warn");
    expect(gatesArchive(issue!)).toBe(true);
    // The fix is one command, and the value is in the message so an agent does
    // not have to go compute a digest to follow the advice.
    expect(issue!.message).toContain("loam rebase FEAT-1");
    expect(issue!.message).toContain(PIN);
  });

  it("is not reported for a requirement that addresses nothing living yet", async () => {
    // `delta.modified-pending` already owns that case: the fix is ordering, and
    // there is no living version to be based on until the other feature lands.
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: `# delta

## MODIFIED Requirements

### Requirement: Something else entirely
The service SHALL do a new thing.

#### Scenario: It happens
- **Given** a trigger
- **When** it fires
- **Then** it happens
`,
    });
    expect(only(issues, "delta.baseline-missing")).toEqual([]);
    expect(issues.map((i) => i.code)).toContain("delta.modified-unknown");
  });
});

describe("a stale pin is an error and gates the merge", () => {
  it("names both digests and the command that repins", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: modified("The service SHALL do it differently.", "0123456789abcdef"),
    });
    const [issue, ...rest] = only(issues, "delta.baseline-stale");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("0123456789abcdef");
    expect(issue!.message).toContain(PIN);
    expect(issue!.message).toContain("loam rebase FEAT-1");
    // No baseline-missing alongside it: the pin exists, it is simply old.
    expect(only(issues, "delta.baseline-missing")).toEqual([]);
  });

  it("fires for REMOVED too, with wording about deletion rather than replacement", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: `# delta

## REMOVED Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
Based-On: 0123456789abcdef
`,
    });
    const [issue] = only(issues, "delta.baseline-stale");
    expect(issue!.message).toContain("delete what they landed");
  });
});

describe("a pin nobody can evaluate is refused outright", () => {
  it("rejects a value that is not a digest", async () => {
    for (const value of ["yesterday", "REQ-042", "0123456789ABCDEF", "0123456789abcde", ""]) {
      const issues = await shapeIssues({
        [`services/${SVC}/spec.md`]: LIVING,
        [`features/FEAT-1-x/specs/${SVC}/spec.md`]: modified("The service SHALL do it differently.", value),
      });
      const [issue, ...rest] = only(issues, "delta.baseline-invalid");
      expect(issue, `expected delta.baseline-invalid for '${value}'`).toBeDefined();
      expect(rest).toEqual([]);
      expect(issue!.severity).toBe("error");
      // Not ALSO called stale: rebase is not what fixes a malformed pin.
      expect(only(issues, "delta.baseline-stale")).toEqual([]);
    }
  });

  it("rejects two pins on one requirement", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: modified(
        `Based-On: ${PIN}\nThe service SHALL do it differently.`,
        PIN,
      ),
    });
    const [issue, ...rest] = only(issues, "delta.baseline-invalid");
    expect(rest).toEqual([]);
    expect(issue!.message).toContain("declares Based-On 2 times");
    expect(only(issues, "delta.baseline-stale")).toEqual([]);
  });

  it("rejects a pin on an ADDED requirement — there is no living version to be based on", async () => {
    const issues = await shapeIssues({
      [`services/${SVC}/spec.md`]: LIVING,
      [`features/FEAT-1-x/specs/${SVC}/spec.md`]: `# delta

## ADDED Requirements

### Requirement: Refund an order
Based-On: ${PIN}
The service SHALL refund a cancelled order.

#### Scenario: Refund succeeds
- **Given** a cancelled order
- **When** a refund is requested
- **Then** the payment is refunded
`,
    });
    const [issue, ...rest] = only(issues, "delta.baseline-invalid");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("no living version to be based on");
  });
});

/* ------------------------------------------------------------------ */
/* The scenario, end to end                                            */
/* ------------------------------------------------------------------ */

describe("two features rewriting one requirement", () => {
  /** Two features, both MODIFYING REQ-042, each written against the pre-merge living text. */
  async function twoFeatures(pin: boolean): Promise<Project> {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING;
    for (const [id, slug, body] of [
      ["FEAT-2", "refund", "The service SHALL let a customer cancel an order and refund it."],
      ["FEAT-3", "window", "The service SHALL let a customer cancel an order within 30 minutes."],
    ] as const) {
      files[`features/${id}-${slug}/intent.md`] = `---\nfeature: ${id}\nstatus: proposed\n---\n\n# ${id}\n\nWhy.\n`;
      files[`features/${id}-${slug}/specs/${SVC}/spec.md`] = modified(body, pin ? PIN : undefined);
    }
    return makeProject(files);
  }

  it("is refused after the first lands — the window the in-flight warning cannot see", async () => {
    const p = await twoFeatures(true);
    try {
      // Both in flight: the older warning names the other feature, and blocks neither.
      const before = await runLoam(p.workDir, "validate", "FEAT-2", "--json");
      expect(before.stdout).toContain("delta.modified-conflict");

      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      expect(await p.read(`services/${SVC}/spec.md`)).toContain("refund it");

      // FEAT-2 is archived, so it is no longer an active claim: this is exactly
      // where FEAT-3 used to go green and overwrite it.
      const after = await runLoam(p.workDir, "validate", "FEAT-3", "--json");
      expect(after.stdout).not.toContain("delta.modified-conflict");
      expect(after.stdout).toContain("delta.baseline-stale");

      const blocked = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "delta.baseline-stale", gates: true }),
      );
      // And the first feature's text is still there.
      expect(await p.read(`services/${SVC}/spec.md`)).toContain("refund it");
    } finally {
      await p.destroy();
    }
  });

  it("without pins the archive refuses — the silent rollback needs a human's --approve now", async () => {
    // This used to be the loss itself: both unpinned archives exited 0 and the
    // second reverted the first with `+0 ~1 -0` and nobody told. The gate turns
    // that into a refusal at the FIRST unpinned archive; the rollback can still
    // be chosen, but only by name, with the flag whose help text says "may
    // corrupt the living docs".
    const p = await twoFeatures(false);
    try {
      const blocked = await runLoam(p.workDir, "archive", "FEAT-2", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        issues: Array<{ code: string; gates: boolean; overridable: boolean }>;
      };
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "delta.baseline-missing", gates: true, overridable: true }),
      );
      // Nothing was merged by the refused run.
      expect(await p.read(`services/${SVC}/spec.md`)).not.toContain("refund it");

      // The deliberate path: --approve archives both, and the second DOES
      // revert the first — that loss is now a choice somebody made twice, not
      // a default nobody saw.
      expect((await runLoam(p.workDir, "archive", "FEAT-2", "--approve")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-3", "--approve")).code).toBe(0);
      const living = await p.read(`services/${SVC}/spec.md`);
      expect(living).toContain("within 30 minutes");
      expect(living).not.toContain("refund it");
    } finally {
      await p.destroy();
    }
  });

  it("rebase then archive is the way through, and the pin does not reach the living doc", async () => {
    const p = await twoFeatures(true);
    try {
      await runLoam(p.workDir, "archive", "FEAT-2");
      const rebased = await runLoam(p.workDir, "rebase", "FEAT-3");
      expect(rebased.code).toBe(0);
      // The command says the requirement MOVED — restamping is not resolving.
      expect(rebased.out).toContain("moved since this delta was written");

      expect((await runLoam(p.workDir, "archive", "FEAT-3")).code).toBe(0);
      const living = await p.read(`services/${SVC}/spec.md`);
      expect(living).toContain("within 30 minutes");
      expect(living).not.toContain("Based-On");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* loam rebase                                                         */
/* ------------------------------------------------------------------ */

describe("loam rebase", () => {
  /** One feature MODIFYING REQ-042, unpinned unless `pin` says otherwise. */
  async function oneFeature(pin?: string): Promise<Project> {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING;
    files["features/FEAT-2-x/intent.md"] = `---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# FEAT-2\n\nWhy.\n`;
    files[`features/FEAT-2-x/specs/${SVC}/spec.md`] = modified("The service SHALL do it differently.", pin);
    return makeProject(files);
  }

  const DELTA = `features/FEAT-2-x/specs/${SVC}/spec.md`;

  it("pins an unpinned requirement under its Requirement-ID and leaves every other byte", async () => {
    const p = await oneFeature();
    try {
      const before = await p.read(DELTA);
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      expect(run.code).toBe(0);
      const payload = JSON.parse(run.stdout) as {
        pins: Array<{ status: string; from: string | null; to: string }>;
        written: string[];
      };
      expect(payload.pins).toEqual([
        expect.objectContaining({ status: "pinned", from: null, to: PIN, kind: "MODIFIED" }),
      ]);
      expect(payload.written).toEqual([DELTA]);

      const after = await p.read(DELTA);
      expect(after).toContain(`Requirement-ID: REQ-042\nBased-On: ${PIN}\n`);
      // Exactly one line added, everything else identical.
      expect(after.split("\n").filter((l) => !l.startsWith("Based-On:")).join("\n")).toBe(before);
    } finally {
      await p.destroy();
    }
  });

  it("reports an already-current pin as unchanged and writes nothing", async () => {
    const p = await oneFeature(PIN);
    try {
      const before = await p.read(DELTA);
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      const payload = JSON.parse(run.stdout) as { pins: Array<{ status: string }>; written: string[] };
      expect(payload.pins[0]!.status).toBe("unchanged");
      expect(payload.written).toEqual([]);
      expect(await p.read(DELTA)).toBe(before);
    } finally {
      await p.destroy();
    }
  });

  it("replaces a stale pin in place rather than adding a second one", async () => {
    const p = await oneFeature("0123456789abcdef");
    try {
      await runLoam(p.workDir, "rebase", "FEAT-2");
      const after = await p.read(DELTA);
      expect(after).toContain(`Based-On: ${PIN}`);
      expect(after).not.toContain("0123456789abcdef");
      expect(after.match(/Based-On:/g)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("--dry-run reports the plan and writes nothing", async () => {
    const p = await oneFeature();
    try {
      const before = await p.read(DELTA);
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--dry-run", "--json");
      const payload = JSON.parse(run.stdout) as {
        dryRun: boolean;
        pins: Array<{ status: string }>;
        written: string[];
      };
      expect(payload.dryRun).toBe(true);
      expect(payload.pins[0]!.status).toBe("pinned");
      expect(payload.written).toEqual([]);
      expect(await p.read(DELTA)).toBe(before);
    } finally {
      await p.destroy();
    }
  });

  it("refuses to invent a pin for a requirement the living spec does not have", async () => {
    const p = await oneFeature();
    try {
      await p.write(
        DELTA,
        `# delta\n\n## MODIFIED Requirements\n\n### Requirement: Not living yet\nThe service SHALL do a new thing.\n`,
      );
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      const payload = JSON.parse(run.stdout) as {
        pins: Array<{ status: string; to: string | null }>;
        written: string[];
      };
      expect(payload.pins[0]).toMatchObject({ status: "unresolved", to: null });
      expect(payload.written).toEqual([]);
      expect(await p.read(DELTA)).not.toContain("Based-On");
    } finally {
      await p.destroy();
    }
  });

  it("leaves ADDED requirements alone — they have no living version", async () => {
    const p = await oneFeature();
    try {
      await p.write(
        DELTA,
        `# delta\n\n## ADDED Requirements\n\n### Requirement: Refund an order\nThe service SHALL refund.\n\n#### Scenario: It works\n- **Given** x\n`,
      );
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      const payload = JSON.parse(run.stdout) as { pins: unknown[]; written: string[] };
      expect(payload.pins).toEqual([]);
      expect(payload.written).toEqual([]);
      expect(await p.read(DELTA)).not.toContain("Based-On");
    } finally {
      await p.destroy();
    }
  });

  it("preserves CRLF line endings and a missing trailing newline", async () => {
    const p = await oneFeature();
    try {
      const crlf = modified("The service SHALL do it differently.").replace(/\n/g, "\r\n").replace(/\r\n$/, "");
      await p.write(DELTA, crlf);
      await runLoam(p.workDir, "rebase", "FEAT-2");
      const after = await p.read(DELTA);
      expect(after).toContain(`Based-On: ${PIN}\r\n`);
      expect(after.endsWith("\n")).toBe(false);
      // No stray bare \n introduced anywhere.
      expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    } finally {
      await p.destroy();
    }
  });

  it("refuses an unknown feature and a service the feature does not touch", async () => {
    const p = await oneFeature();
    try {
      const missing = await runLoam(p.workDir, "rebase", "FEAT-404");
      expect(missing.code).toBe(1);
      const wrong = await runLoam(p.workDir, "rebase", "FEAT-2", "--service", "not-a-service");
      expect(wrong.code).toBe(1);
      expect(wrong.out).toContain("carries no requirement delta");
      expect(wrong.out).toContain(SVC);
    } finally {
      await p.destroy();
    }
  });

  it("is idempotent: a second run reports unchanged and writes nothing", async () => {
    const p = await oneFeature();
    try {
      await runLoam(p.workDir, "rebase", "FEAT-2");
      const once = await p.read(DELTA);
      const again = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      const payload = JSON.parse(again.stdout) as { pins: Array<{ status: string }>; written: string[] };
      expect(payload.pins[0]!.status).toBe("unchanged");
      expect(payload.written).toEqual([]);
      expect(await p.read(DELTA)).toBe(once);
    } finally {
      await p.destroy();
    }
  });
});
