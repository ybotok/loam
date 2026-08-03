/**
 * Deep invariant tests for `loam unarchive` (src/commands/unarchive.ts).
 *
 * unarchive is the only command that claims to UNDO a mutation of the living
 * docs, and a claimed undo that is really an approximation is worse than none:
 * it hands back docs that look restored and are not. So the central test here is
 * not "it ran" but "the docs repo is byte-identical to before the archive",
 * checked over every file and directory rather than the few the merge names.
 *
 * That bar is why unarchive restores a SNAPSHOT rather than inverting the merge.
 * The merge is not invertible: a MODIFIED requirement's previous text is nowhere
 * in the delta, and the landscape merge drops the feature tags, so the added
 * lines stop being identifiable the moment they land. The snapshot pins the one
 * thing that survives — the bytes.
 *
 * The refusals matter as much as the restore. unarchive says no to burying an
 * active feature, to a feature archived before snapshots existed, and to
 * restoring over changes made after the archive — each with its own stable code,
 * because a caller has to know which of them re-running could ever fix.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { parseRequirements } from "../src/core/spec.js";
import {
  coherentFixture,
  makeProject,
  runLoam,
  treeHashes,
  LANDSCAPE,
  LIVING_OPENAPI,
  type Project,
} from "./helpers/harness.js";

/** Living spec with a requirement whose text the feature will MODIFY. */
const LIVING_SPEC_TO_MODIFY = `---
service: payment-service
status: verified
owner: payments-team
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

/** The delta that rewrites it — and records nothing about what it replaced. */
const MODIFY_DELTA = `# payment-service — delta for FEAT-20

## MODIFIED Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment within 2 seconds.

Operations: authorizePayment

#### Scenario: Fast authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** it completes within 2 seconds
`;

function modifyFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC_TO_MODIFY,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-20-faster/specs/payment-service/spec.md": MODIFY_DELTA,
  };
}

describe("the round trip", () => {
  it("archive then unarchive leaves the docs repo byte-identical, down to the directories", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).not.toEqual(before);

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("restores a MODIFIED requirement's previous text — the thing no inverse merge could know", async () => {
    const p = await makeProject(modifyFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
      expect(await p.read("services/payment-service/spec.md")).toContain("within 2 seconds");

      expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
      const text = await p.read("services/payment-service/spec.md");
      expect(text).toBe(LIVING_SPEC_TO_MODIFY);
      const reqs = parseRequirements(text);
      expect(reqs[0]!.text.join("\n")).toContain("before capture");
      expect(reqs[0]!.scenarios.map((s) => s.name)).toEqual(["Successful authorization"]);
    } finally {
      await p.destroy();
    }
  });

  it("takes back the files and the directories the merge created", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);

      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(false);
      expect(
        p.exists("services/payment-split-service"),
        "a directory left behind empty is still the fleet claiming a service that was never merged",
      ).toBe(false);
      expect(p.exists("features/archive")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("re-opens the feature intact, and leaves no snapshot behind in it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const delta = await p.read("features/FEAT-1-split/delta.likec4");
      await runLoam(p.workDir, "archive", "FEAT-1");
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(await p.read("features/FEAT-1-split/delta.likec4")).toBe(delta);
      expect(p.exists("features/FEAT-1-split/.loam-before")).toBe(false);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("the re-opened feature can be archived again, to the same result", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const merged = await treeHashes(p.docsDir);
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // The snapshot carries a timestamp, so compare what the merge produced.
      const again = await treeHashes(p.docsDir);
      for (const [path, hash] of Object.entries(merged)) {
        if (path.includes(".loam-before")) continue;
        expect(again[path], path).toBe(hash);
      }
    } finally {
      await p.destroy();
    }
  });

  it("leaves `loam list` and `loam validate` seeing exactly what they saw before the archive", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const listed = await runLoam(p.workDir, "list", "--json");
      const validated = await runLoam(p.workDir, "validate", "--all", "--json");
      await runLoam(p.workDir, "archive", "FEAT-1");
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect((await runLoam(p.workDir, "list", "--json")).stdout).toBe(listed.stdout);
      expect((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).toBe(validated.stdout);
    } finally {
      await p.destroy();
    }
  });
});

describe("refusals", () => {
  async function archived(): Promise<Project> {
    const p = await makeProject(coherentFixture());
    await runLoam(p.workDir, "archive", "FEAT-1");
    return p;
  }

  it("refuses to bury an active feature of the same id, and changes nothing", async () => {
    const p = await archived();
    try {
      await p.write("features/FEAT-1-split/delta.likec4", "// work in flight\n");
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect(await p.read("features/FEAT-1-split/delta.likec4")).toBe("// work in flight\n");
    } finally {
      await p.destroy();
    }
  });

  it("names an active feature as `feature-active`, not as a missing target", async () => {
    const p = await archived();
    try {
      await p.write("features/FEAT-1-split/delta.likec4", "// work in flight\n");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "feature-active" } });
    } finally {
      await p.destroy();
    }
  });

  it("a feature archived before snapshots existed fails with an explanation, not a crash", async () => {
    const p = await archived();
    try {
      // Exactly what an older loam left behind: the feature, and no record of what it overwrote.
      await rm(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before"), { recursive: true });
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("version control");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("reports the missing snapshot under its own code", async () => {
    const p = await archived();
    try {
      await rm(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before"), { recursive: true });
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "snapshot-missing" } });
    } finally {
      await p.destroy();
    }
  });

  it("refuses when a merged file changed after the archive — that is a revert, not an undo", async () => {
    const p = await archived();
    try {
      const edited = (await p.read("services/payment-split-service/spec.md")) + "\nHand-edited since.\n";
      await p.write("services/payment-split-service/spec.md", edited);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("services/payment-split-service/spec.md");
      expect(await p.read("services/payment-split-service/spec.md")).toBe(edited);
    } finally {
      await p.destroy();
    }
  });

  it("--force says the discarding was meant, and does it", async () => {
    const p = await archived();
    try {
      await p.write("services/payment-split-service/spec.md", "hand-edited\n");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--force");
      expect(res.code).toBe(0);
      expect(res.out).toContain("discarding later changes");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("an unknown feature is an unknown target, and an ACTIVE feature is not unarchivable", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const missing = await runLoam(p.workDir, "unarchive", "FEAT-99", "--json");
      expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      // FEAT-1 exists, but only as an active feature — there is nothing to take back.
      const active = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(active.stdout).error.code).toBe("unknown-target");
    } finally {
      await p.destroy();
    }
  });

  it("without a loam.json it reports no-config like every other command", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await rm(join(p.workDir, "loam.json"));
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "no-config" } });
    } finally {
      await p.destroy();
    }
  });
});

describe("the machine contract", () => {
  it("names what was restored and what was taken back", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.feature).toBe("FEAT-1");
      expect(json.path).toBe("features/FEAT-1-split");
      expect(json.restored).toContain("architecture/landscape.likec4");
      expect(json.removed).toEqual(
        expect.arrayContaining([
          "services/payment-split-service/spec.md",
          "services/payment-split-service/openapi.yaml",
        ]),
      );
      expect(json.discarded).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("emits nothing but JSON on the success path, so one stream always parses", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(() => JSON.parse(res.out)).not.toThrow();
    } finally {
      await p.destroy();
    }
  });
});
