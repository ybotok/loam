/**
 * `loam archive` against a requirement delta that opens with a UTF-8 byte-order mark.
 *
 * A BOM is one invisible byte, and until it was stripped it voided an entire
 * delta. `KIND_RE` is anchored `^##`, and real delta files routinely open with
 * `## MODIFIED Requirements` on line 1 (upstream OpenSpec writes them that way) —
 * so with a BOM in front of it that line stopped being a section heading, every
 * requirement in the file fell back to kind BASE, and `applyRequirementDelta`
 * skips BASE. Archive merged nothing, printed no error, and exited 0. Any editor
 * that writes UTF-8-with-BOM (Notepad, older Visual Studio, PowerShell `>`
 * redirection) produces exactly this file.
 *
 * The parse-level invariants live in test/spec.test.ts. This file exists because
 * the parse was not where the damage was: the damage was a green `loam archive`
 * that silently wrote nothing. So it drives the real command over a fixture on
 * disk and pins the outcome the author expected — the same living docs the same
 * delta produces without the mark, byte for byte.
 *
 * The fixture is built here rather than taken from the harness because the bug
 * needs the delta heading on LINE 1; the harness's FEATURE_SPEC opens with an `# H1`
 * title, which would absorb the BOM harmlessly and make every test below vacuous.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { parseRequirements } from "../src/core/document/spec.js";

/** Written escaped: a literal U+FEFF in this source would itself be invisible. */
const BOM = "\uFEFF";

const FEATURE_SPEC_PATH = "features/FEAT-1-split/specs/payment-split-service/spec.md";
const LIVING_SPEC_PATH = "services/payment-split-service/spec.md";

/**
 * The harness's feature delta with the `# H1` title removed, so `## ADDED
 * Requirements` is the first line — the OpenSpec shape a BOM actually breaks.
 */
const HEADING_FIRST_SPEC = `## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

/** The canonical coherent fixture, with `withBom` deciding whether the delta carries one. */
function fixture(withBom: boolean): Record<string, string> {
  return {
    ...coherentFixture(),
    [FEATURE_SPEC_PATH]: (withBom ? BOM : "") + HEADING_FIRST_SPEC,
  };
}

interface Archived {
  code: number;
  out: string;
  /** The living spec archive created, or "" if it created none. */
  living: string;
}

/**
 * Archive FEAT-1 over the fixture and hand back the exit code plus the living docs.
 * Sequential by construction — runLoam chdirs the process, so two of these must
 * never overlap.
 */
async function archived(withBom: boolean): Promise<Archived> {
  const p: Project = await makeProject(fixture(withBom));
  try {
    const res = await runLoam(p.workDir, "archive", "FEAT-1");
    return {
      code: res.code,
      out: res.out,
      living: p.exists(LIVING_SPEC_PATH) ? await p.read(LIVING_SPEC_PATH) : "",
    };
  } finally {
    await p.destroy();
  }
}

describe("a BOM-prefixed requirement delta survives loam archive", () => {
  it("the fixture puts the delta heading on line 1, where a BOM would sit", () => {
    // Guards the whole file against passing vacuously: the bug only bites a
    // heading the mark can actually reach.
    expect(HEADING_FIRST_SPEC.split("\n")[0]).toBe("## ADDED Requirements");
    expect(parseRequirements(BOM + HEADING_FIRST_SPEC)[0]!.kind).toBe("ADDED");
  });

  it("archive succeeds and the requirement reaches the living spec", async () => {
    const { code, living } = await archived(true);
    expect(code).toBe(0);
    expect(living).toContain("### Requirement: Split a payment");
  });

  it("the merge is a merge, not a silent no-op", async () => {
    // The precise old failure: kind degraded to BASE, BASE is skipped, so the
    // merge had nothing to apply and archive said so — or said nothing at all.
    const { out } = await archived(true);
    expect(out).toContain("1 requirement(s)");
    expect(out).not.toContain("nothing to merge");
  });

  it("the living docs are byte-for-byte what the same delta produces without the mark", async () => {
    // The strongest statement available: the BOM changes nothing downstream, not
    // merely that something got through.
    const withBom = await archived(true);
    const without = await archived(false);
    expect(withBom.living).toBe(without.living);
    expect(withBom.code).toBe(without.code);
  });

  it("the BOM itself is not carried into the living spec", async () => {
    // Stripping in the parser means the mark cannot survive into a merged document
    // and poison the next read of it.
    const { living } = await archived(true);
    expect(living.includes(BOM)).toBe(false);
  });

  it("the feature is archived, not left in flight as if nothing happened", async () => {
    const p = await makeProject(fixture(true));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(true);
      expect(p.exists("features/FEAT-1-split")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("validate --feature stays coherent with the BOM in place", async () => {
    // The gate reads the same file through the same parser. If it disagreed with
    // archive about what the delta says, one of the two would be lying — and the
    // coherence check would be gating on a document it had misread.
    const p = await makeProject(fixture(true));
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a BOM does not strand the requirement under a phantom prose heading", async () => {
    // The two bugs interact: before the strip, a BOM'd delta's requirements were
    // BASE under `## ADDED Requirements`, which is neither a delta section nor
    // `## Requirements`. Fixing only the not-merged warning would have turned
    // total silent loss into a confusing warning about a correct heading.
    const p = await makeProject(fixture(true));
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const codes = JSON.parse(res.stdout).targets[0].findings.map((f: { code: string }) => f.code);
      expect(codes).not.toContain("delta.requirement-not-merged");
    } finally {
      await p.destroy();
    }
  });
});
