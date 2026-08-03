/**
 * Format-compatibility tests for src/core/spec.ts against REAL OpenSpec markdown.
 *
 * src/core/spec.ts reimplements OpenSpec's requirement format from the outside. This
 * file is the evidence for that claim: it runs our parser over verbatim spec files
 * vendored from Fission-AI/OpenSpec (see test/fixtures/openspec/README.md for
 * provenance) and pins what we actually do with them — including what we get wrong.
 *
 * Unlike test/spec.test.ts, which asserts DESIRED behavior and treats a failure as a
 * suspected bug, this file pins OBSERVED behavior. A failure here means either our
 * parser changed or upstream OpenSpec's format did; both are worth a human looking.
 *
 * ============================================================================
 * FINDINGS — where we diverge from OpenSpec
 * ============================================================================
 *
 * Established by parsing all 157 spec files in OpenSpec commit 45cca5d (614
 * requirements, 1846 scenarios), and by reading OpenSpec's own parsers
 * (src/core/parsers/{markdown-parser,change-parser,spec-structure}.ts).
 *
 * WHAT WORKS. Requirement and scenario extraction is compatible on every real file:
 * all 614 requirements and 1846 scenarios are found, with the same delta kinds, and
 * round-trip is lossless (see "round-trip" below). Nested bullets, fenced blocks,
 * `**Reason for removal**:` metadata, CRLF, and non-ASCII names all survive.
 *
 * 1. `## Purpose` — DROPPED, and its absence makes our output unreadable by OpenSpec.
 *    OpenSpec REQUIRES a capability-level `## Purpose` section: `parseSpec` throws
 *    "Spec must have a Purpose section" without one, and 52 of the corpus files have
 *    it. We have no concept of it. parseRequirements ignores the prose and
 *    serializeRequirements never emits it.
 *
 * 2. `## Requirements` wrapper — DROPPED, same consequence. OpenSpec only reads
 *    requirements nested under `## Requirements`; `parseSpec` throws without it. We
 *    find `### Requirement:` anywhere, and serialize emits bare `### Requirement:`
 *    headings with no wrapper. Combined with (1): a living spec that survives our
 *    parse/serialize round-trip intact is still REJECTED by OpenSpec's own parser.
 *    Round-trip fidelity is not the same as interoperability.
 *
 * 3. `## RENAMED Requirements` — SILENTLY DROPPED. OpenSpec has a fourth delta
 *    operation, written as `- FROM: \`### Requirement: Old\`` / `- TO: \`...New\``.
 *    Our KIND_RE only knows ADDED|MODIFIED|REMOVED, so the section parses to zero
 *    requirements and the rename vanishes. Unused in the corpus but documented in
 *    OpenSpec's own conventions spec, so files in the wild may use it.
 *
 * 4. Requirements under prose headings in a delta — SILENTLY DROPPED AT MERGE.
 *    Older "complete future state" deltas put requirements under `## Behavior` /
 *    `## Error Handling` rather than under a delta heading. We parse them as kind
 *    BASE, and applyRequirementDelta skips BASE, so they never reach the living spec.
 *    Real case in the corpus: 6 of 8 requirements in the cli-archive fixture.
 *
 * 5. UTF-8 BOM — SILENTLY DROPS THE WHOLE DELTA. OpenSpec strips a leading BOM
 *    precisely so a header on line 1 still matches. We do not, and delta files
 *    routinely open with `## MODIFIED Requirements` on line 1 — so one invisible byte
 *    turns every requirement in the file into BASE and applyRequirementDelta merges
 *    nothing. No error, no warning, empty result. See the test below; this is a
 *    latent data-loss bug in our parser, not merely an unsupported feature.
 *
 * 6. Heading case — STRICTER THAN OPENSPEC. OpenSpec matches `### Requirement:` with
 *    a case-insensitive regex; ours is case-sensitive, so `### requirement: X` parses
 *    to nothing. No corpus file relies on this.
 *
 * 7. RFC-2119 keywords — NOT INTERPRETED. SHALL/MUST/SHOULD/MAY are load-bearing in
 *    OpenSpec prose but are opaque body text to us; we key coverage off scenarios
 *    only. OpenSpec agrees in practice (every living requirement in the corpus has at
 *    least one scenario), so this is a difference in emphasis, not a parse failure.
 *
 * 8. `Operations:` — OUR EXTENSION, absent upstream. Nothing in the corpus writes it,
 *    and nothing in the corpus accidentally matches our regex, so reading OpenSpec
 *    files never invents operationIds. But an OpenSpec file will always have empty
 *    `operations`, so the C4/OpenAPI link in `loam validate` is unreachable for
 *    adopted specs until a human adds the line.
 *
 * 9. Scenario names and empty scenarios — WE KEEP MORE. OpenSpec's Scenario is
 *    `{ rawText }`: the `#### Scenario:` title is discarded, and a scenario with an
 *    empty body is dropped entirely. We retain both. Strictly richer, so it is a
 *    compatibility risk only in the direction of us accepting what they would ignore.
 *
 * NOT A PROBLEM (checked, no divergence found): the `# H1` title line is dropped by
 * both; nested list indentation is preserved verbatim; `### Requirement:` quoted
 * inside a fenced block is body text for both (our fence tracker and their fence mask
 * agree, including on indented fences).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  requirementsMissingScenarios,
  KIND_RE,
  sectionHeadings,
  type DeltaKind,
} from "../src/core/spec.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/openspec/", import.meta.url));

/** Fixtures are read by URL rather than cwd — vitest runs each test file chdir'd. */
function fixture(rel: string): string {
  return readFileSync(FIXTURES + rel, "utf8");
}

/** Written escaped: a literal U+FEFF in this source would itself be invisible. */
const BOM = "\uFEFF";

/** [name, scenarioCount] for a living spec; delta kind is always BASE there. */
type LivingRow = [string, number];
/** [kind, name, scenarioCount] for a delta spec. */
type DeltaRow = [DeltaKind, string, number];

const LIVING: Array<{ file: string; rows: LivingRow[] }> = [
  {
    file: "living/cli-list.spec.md",
    rows: [
      ["Command Execution", 2],
      ["Task Counting", 1],
      ["Output Format", 2],
      ["Flags", 2],
      ["Empty State", 2],
      ["Error Handling", 2],
      ["Sorting", 1],
    ],
  },
  {
    file: "living/artifact-graph.spec.md",
    rows: [
      ["Schema Loading", 6],
      ["Build Order Calculation", 4],
      ["State Detection", 5],
      ["Ready Artifact Query", 4],
      ["Completion Check", 2],
      ["Blocked Query", 3],
      ["Schema Directory Structure", 4],
    ],
  },
  {
    file: "living/openspec-conventions.spec.md",
    rows: [
      ["Structured conventions for specs and changes", 1],
      ["Behavior-First Specification Boundary", 2],
      ["Progressive Rigor", 2],
      ["Project Structure", 1],
      ["Structured Format for Behavioral Specs", 3],
      ["Header-Based Requirement Identification", 3],
      ["Change Storage Convention", 5],
      ["Archive Process Enhancement", 2],
      ["Proposal Format", 1],
      ["Change Review", 1],
      ["Structured Format Adoption", 1],
      // En-dash in the name, not a hyphen — pins that we do not mangle it.
      ["Verb–Noun CLI Command Structure", 3],
    ],
  },
];

const DELTA: Array<{ file: string; rows: DeltaRow[] }> = [
  {
    file: "delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md",
    rows: [
      ["REMOVED", "Display Format", 1],
      ["MODIFIED", "Diff Output", 1],
      ["ADDED", "Validation", 1],
    ],
  },
  {
    file: "delta/2025-12-28-restructure-schema-directories__artifact-graph.spec.md",
    rows: [
      ["MODIFIED", "Schema Loading", 6],
      ["ADDED", "Schema Directory Structure", 4],
    ],
  },
  {
    file: "delta/2026-02-17-merge-init-experimental__cli-init.spec.md",
    rows: [
      ["MODIFIED", "Directory Creation", 1],
      ["MODIFIED", "AI Tool Configuration", 2],
      ["MODIFIED", "Skill Generation", 1],
      ["MODIFIED", "Slash Command Generation", 1],
      ["MODIFIED", "Success Output", 2],
      ["MODIFIED", "Config File Generation", 2],
      ["MODIFIED", "Non-Interactive Mode", 3],
      ["MODIFIED", "Experimental Command Alias", 1],
      // REMOVED requirements carry only `**Reason**` / `**Migration**` prose.
      ["REMOVED", "File Generation", 0],
      ["REMOVED", "AI Tool Configuration Details", 0],
      ["REMOVED", "Slash Command Configuration", 0],
      ["REMOVED", "Root instruction stub", 0],
    ],
  },
  {
    file: "delta/2025-08-19-add-skip-specs-archive-option__cli-archive.spec.md",
    rows: [
      // Finding 4: everything under `## Behavior` / `## Error Handling` lands as BASE.
      ["BASE", "Change Selection", 2],
      ["BASE", "Task Completion Check", 2],
      ["BASE", "Archive Process", 3],
      ["BASE", "Spec Update Process", 3],
      ["BASE", "Confirmation Behavior", 3],
      ["BASE", "Error Conditions", 1],
      ["ADDED", "Skip Specs Option", 1],
      ["ADDED", "Non-blocking confirmation", 1],
    ],
  },
];

const ALL_FILES = [...LIVING.map((f) => f.file), ...DELTA.map((f) => f.file)];

/* ------------------------------------------------------------------ */
/* Extraction: every requirement and scenario in the real files        */
/* ------------------------------------------------------------------ */

describe("real OpenSpec living specs yield exactly the requirements they declare", () => {
  for (const { file, rows } of LIVING) {
    it(`${file}: ${rows.length} requirements, all kind BASE, with the pinned scenario counts`, () => {
      const reqs = parseRequirements(fixture(file));
      expect(reqs.map((r): LivingRow => [r.name, r.scenarios.length])).toEqual(rows);
      expect(reqs.every((r) => r.kind === "BASE")).toBe(true);
    });
  }

  it("every living requirement upstream has at least one scenario, so our coverage rule never fires on them", () => {
    // OpenSpec does not enforce this in its parser, but its authors hold the line in
    // practice — which is why `loam validate`'s scenario rule can be applied to an
    // adopted OpenSpec repo without a wave of false positives.
    for (const { file } of LIVING) {
      expect(requirementsMissingScenarios(parseRequirements(fixture(file)))).toEqual([]);
    }
  });

  it("scenario names are retained, unlike OpenSpec which keeps only the scenario body", () => {
    const reqs = parseRequirements(fixture("living/artifact-graph.spec.md"));
    expect(reqs[0]!.scenarios.map((s) => s.name)).toEqual([
      "Valid schema loaded",
      "Invalid schema rejected",
      "Cyclic dependencies detected",
      "Invalid dependency reference",
      "Duplicate artifact IDs rejected",
      "Schema directory not found",
    ]);
  });
});

describe("real OpenSpec delta specs yield the delta kinds they declare", () => {
  for (const { file, rows } of DELTA) {
    it(`${file}: ${rows.length} requirements with the pinned kinds and scenario counts`, () => {
      const reqs = parseRequirements(fixture(file));
      expect(reqs.map((r): DeltaRow => [r.kind, r.name, r.scenarios.length])).toEqual(rows);
    });
  }

  it("a REMOVED requirement with no scenario is not reported as missing coverage", () => {
    // Upstream writes these as a heading plus `**Reason**:` prose. Flagging them
    // would make every real OpenSpec removal look like an authoring error.
    const reqs = parseRequirements(
      fixture("delta/2026-02-17-merge-init-experimental__cli-init.spec.md"),
    );
    const removed = reqs.filter((r) => r.kind === "REMOVED");
    expect(removed.map((r) => r.scenarios.length)).toEqual([0, 0, 0, 0]);
    expect(requirementsMissingScenarios(reqs)).toEqual([]);
  });

  it("removal-rationale prose stays attached to the requirement body", () => {
    const [removed] = parseRequirements(
      fixture("delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md"),
    );
    expect(removed!.text.join("\n")).toContain("**Reason for removal**:");
  });
});

/* ------------------------------------------------------------------ */
/* Round-trip over real files                                          */
/* ------------------------------------------------------------------ */

describe("round-trip over real OpenSpec files", () => {
  for (const file of ALL_FILES) {
    it(`${file}: serialize ∘ parse preserves every requirement name and scenario name`, () => {
      const once = parseRequirements(fixture(file));
      const again = parseRequirements(serializeRequirements(once));
      expect(again.map((r) => [r.name, r.scenarios.map((s) => s.name)])).toEqual(
        once.map((r) => [r.name, r.scenarios.map((s) => s.name)]),
      );
    });

    it(`${file}: requirement and scenario bodies survive the round-trip verbatim (modulo edge trimming)`, () => {
      const body = (md: string) =>
        parseRequirements(md).map((r) => [
          r.text.join("\n").trim(),
          r.scenarios.map((s) => s.lines.join("\n").trim()),
        ]);
      const once = parseRequirements(fixture(file));
      expect(body(serializeRequirements(once))).toEqual(body(fixture(file)));
    });

    it(`${file}: serialize is a fixpoint on its own output`, () => {
      const norm = serializeRequirements(parseRequirements(fixture(file)));
      expect(serializeRequirements(parseRequirements(norm))).toBe(norm);
    });
  }

  it("nested bullets under a THEN step keep their indentation through the round-trip", () => {
    const scenarioBody = (md: string) =>
      parseRequirements(md)
        .find((r) => r.name === "Diff Output")!
        .scenarios[0]!.lines.join("\n")
        .trim();
    const md = fixture("delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md");
    expect(scenarioBody(md)).toContain("\n  - Clearly shows the current version on the left");
    expect(scenarioBody(serializeRequirements(parseRequirements(md)))).toBe(scenarioBody(md));
  });

  it("markup quoted inside a fenced block is body text, never structure", () => {
    // OpenSpec's meta-spec quotes `### Requirement:` and `## RENAMED Requirements`
    // inside indented fences while describing the format. Treating those as headings
    // would invent requirements that do not exist.
    const reqs = parseRequirements(fixture("living/openspec-conventions.spec.md"));
    const renames = reqs
      .find((r) => r.name === "Header-Based Requirement Identification")!
      .scenarios.find((s) => s.name === "Handling requirement renames")!;
    expect(renames.lines.join("\n")).toContain("## RENAMED Requirements");
    expect(renames.lines.join("\n")).toContain("- FROM: `### Requirement: Old Name`");
    expect(reqs.map((r) => r.name)).not.toContain("Old Name");
  });
});

/* ------------------------------------------------------------------ */
/* Merge algebra against a real archived change                        */
/* ------------------------------------------------------------------ */

describe("merging a real archived OpenSpec change", () => {
  // The 2025-12-28 change is already archived upstream, so its delta and the living
  // artifact-graph spec it produced are both in the fixture set. Re-applying it is
  // the closest thing to an end-to-end check of `loam archive` against real data.
  const living = () => parseRequirements(fixture("living/artifact-graph.spec.md"));
  const delta = () =>
    parseRequirements(
      fixture("delta/2025-12-28-restructure-schema-directories__artifact-graph.spec.md"),
    );

  it("re-applying an already-archived delta to its living spec changes nothing", () => {
    expect(serializeRequirements(applyRequirementDelta(living(), delta()))).toBe(
      serializeRequirements(living()),
    );
  });

  it("MODIFIED lands in place and ADDED does not duplicate an existing requirement", () => {
    const merged = applyRequirementDelta(living(), delta());
    expect(merged.map((r) => r.name)).toEqual(living().map((r) => r.name));
    expect(merged.every((r) => r.kind === "BASE")).toBe(true);
  });

  it("a delta merged onto an empty living set keeps ADDED/MODIFIED and drops REMOVED", () => {
    const merged = applyRequirementDelta(
      [],
      parseRequirements(fixture("delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md")),
    );
    expect(merged.map((r) => r.name)).toEqual(["Diff Output", "Validation"]);
  });
});

/* ------------------------------------------------------------------ */
/* Gaps: OpenSpec constructs we do NOT support                         */
/* ------------------------------------------------------------------ */

describe("gap: capability-level sections are dropped, so our output is not readable by OpenSpec", () => {
  it("`## Purpose` prose is not captured anywhere in the parse result", () => {
    for (const { file } of LIVING) {
      const md = fixture(file);
      const purposeProse = md
        .split("\n")
        .slice(md.split("\n").findIndex((l) => l.startsWith("## Purpose")) + 1)
        .find((l) => l.trim())!;
      expect(purposeProse).toBeTruthy();
      const parsed = JSON.stringify(parseRequirements(md));
      expect(parsed).not.toContain(purposeProse);
    }
  });

  it("serialized output has neither `## Purpose` nor `## Requirements`, which OpenSpec's parseSpec requires", () => {
    // OpenSpec's MarkdownParser.parseSpec throws "Spec must have a Purpose section"
    // and "Spec must have a Requirements section". Round-tripping a living spec
    // through us therefore produces a file OpenSpec can no longer read — the gap that
    // matters most if a repo is ever shared between the two tools.
    const out = serializeRequirements(parseRequirements(fixture("living/cli-list.spec.md")));
    expect(sectionHeadings(out)).toEqual([]);
    expect(out.startsWith("### Requirement:")).toBe(true);
  });

  it("the `# H1` capability title is dropped", () => {
    const md = fixture("living/cli-list.spec.md");
    const title = md.split("\n")[0]!;
    expect(title).toBe("# List Command Specification");
    expect(serializeRequirements(parseRequirements(md))).not.toContain(title);
  });
});

describe("gap: `## RENAMED Requirements` is unrecognized and the rename is lost", () => {
  it("KIND_RE matches the three kinds we implement and not RENAMED", () => {
    expect(KIND_RE.test("## ADDED Requirements")).toBe(true);
    expect(KIND_RE.test("## MODIFIED Requirements")).toBe(true);
    expect(KIND_RE.test("## REMOVED Requirements")).toBe(true);
    expect(KIND_RE.test("## RENAMED Requirements")).toBe(false);
  });

  it("a RENAMED section written in OpenSpec's documented syntax parses to nothing", () => {
    // Syntax taken verbatim from the `Handling requirement renames` scenario in
    // living/openspec-conventions.spec.md, which the round-trip suite above reads.
    const md = [
      "## RENAMED Requirements",
      "- FROM: `### Requirement: Old Name`",
      "- TO: `### Requirement: New Name`",
      "",
    ].join("\n");
    expect(parseRequirements(md)).toEqual([]);
    expect(applyRequirementDelta([], parseRequirements(md))).toEqual([]);
  });
});

describe("gap: delta requirements under prose headings never reach the living spec", () => {
  const file = "delta/2025-08-19-add-skip-specs-archive-option__cli-archive.spec.md";

  it("the legacy delta really does put requirements under prose headings", () => {
    expect(sectionHeadings(fixture(file)).map((h) => h.text)).toEqual([
      "## Purpose",
      "## Command Syntax",
      "## Behavior",
      "## Error Handling",
      "## Why These Decisions",
      "## ADDED Requirements",
    ]);
  });

  it("merging it keeps only the 2 requirements under `## ADDED Requirements`, silently discarding 6", () => {
    const reqs = parseRequirements(fixture(file));
    expect(reqs).toHaveLength(8);
    expect(applyRequirementDelta([], reqs).map((r) => r.name)).toEqual([
      "Skip Specs Option",
      "Non-blocking confirmation",
    ]);
  });
});

describe("gap: a UTF-8 BOM silently voids an entire delta", () => {
  const file = "delta/2026-02-17-merge-init-experimental__cli-init.spec.md";

  it("the delta heading is on line 1, where a BOM would sit", () => {
    expect(fixture(file).split("\n")[0]).toBe("## MODIFIED Requirements");
  });

  it("with a BOM prepended, every MODIFIED requirement degrades to BASE and the merge yields nothing", () => {
    // OpenSpec strips the BOM for exactly this reason. We do not, so a spec authored
    // on Windows merges as a no-op with no error. Pinned as observed behavior, not
    // endorsed: fixing it means normalizing input in parseRequirements.
    const withBom = parseRequirements(BOM + fixture(file));
    expect(withBom).toHaveLength(12);
    expect(withBom.filter((r) => r.kind === "MODIFIED")).toEqual([]);
    expect(withBom.filter((r) => r.kind === "BASE")).toHaveLength(8);
    expect(applyRequirementDelta([], withBom)).toEqual([]);
  });
});

describe("gap: heading matching is stricter than OpenSpec's", () => {
  it("a lowercase `### requirement:` heading parses to nothing where OpenSpec accepts it", () => {
    expect(parseRequirements("### requirement: Lowercase\n\n#### Scenario: x\n- **THEN** y\n")).toEqual(
      [],
    );
  });

  it("no upstream file relies on this — every requirement heading in the fixtures is canonically cased", () => {
    // Counted, not just `.every()`-ed: an empty match set would make this vacuous.
    const headings = ALL_FILES.flatMap((f) =>
      fixture(f).split("\n").filter((l) => /^#{1,6}\s*requirement:/i.test(l)),
    );
    expect(headings).toHaveLength(51);
    expect(headings.filter((h) => !h.startsWith("### Requirement: "))).toEqual([]);
  });
});

describe("gap: OpenSpec semantics we do not interpret", () => {
  it("RFC-2119 keywords are opaque body text — coverage is keyed off scenarios only", () => {
    const [first] = parseRequirements(fixture("living/cli-list.spec.md"));
    expect(first!.text.join("\n")).toContain("SHALL");
    // Nothing on Requirement records the modal verb; `text` is the only place it lives.
    expect(Object.keys(first!)).toEqual(["kind", "name", "text", "operations", "scenarios"]);
  });

  it("no real OpenSpec file yields operations, because `Operations:` is a loam-only line", () => {
    for (const file of ALL_FILES) {
      for (const r of parseRequirements(fixture(file))) expect(r.operations).toEqual([]);
    }
  });

  it("no upstream prose accidentally trips the `Operations:` regex", () => {
    // If it did, adopting an OpenSpec repo would invent operationIds that no OpenAPI
    // document declares, and `loam validate`'s contract check would fail on import.
    for (const file of ALL_FILES) {
      expect(fixture(file).split("\n").filter((l) => /^\s*Operations?:/i.test(l))).toEqual([]);
    }
  });
});
