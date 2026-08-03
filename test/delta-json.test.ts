/**
 * Tests for `loam delta --json` (src/commands/delta.ts).
 *
 * `delta` is the command whose output is meant to BE a coding agent's task:
 * why the feature exists, what this service must do, and how the architecture
 * changes around it. In text form that is a briefing for a human; --json is the
 * same briefing an agent can consume without parsing prose. Scenarios carry
 * their Given/When/Then lines verbatim — they are the source for the tests the
 * agent is expected to write.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

const NEW_SVC = "payment-split-service";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

describe("--json contract", () => {
  it("carries the feature, the service and the repo-relative feature path", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.feature).toBe("FEAT-1");
      expect(json.service).toBe(NEW_SVC);
      expect(json.path).toBe("features/FEAT-1-split");
    });
  });

  it("carries the intent body with its frontmatter stripped", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.intent).toContain("Split payments");
      expect(json.intent).not.toContain("status: proposed");
    });
  });

  it("carries the requirement delta with scenarios verbatim — the agent writes tests from these", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.requirements).toHaveLength(1);
      const r = json.requirements[0];
      expect(r.kind).toBe("ADDED");
      expect(r.name).toBe("Split a payment");
      expect(r.operations).toEqual(["createSplit"]);
      expect(r.scenarios).toHaveLength(1);
      expect(r.scenarios[0].name).toBe("Split across two payees");
      expect(r.scenarios[0].lines.join("\n")).toContain("**Given** a payment of 100.00");
      expect(r.scenarios[0].lines.join("\n")).toContain("**Then** two shares are recorded");
    });
  });

  it("says whether the service is new and lists the edges around it", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.architecture.isNew).toBe(true);
      expect(json.architecture.inbound).toEqual([
        { service: "payment-service", op: "createSplit", title: "Calls createSplit" },
      ]);
      expect(json.architecture.outbound).toEqual([]);
    });
  });

  it("reports an untouched service honestly rather than inventing work", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", "kafka", "--json")).stdout,
      );
      expect(json.requirements).toEqual([]);
      expect(json.architecture).toEqual({ isNew: false, inbound: [], outbound: [], errors: [] });
    });
  });

  it("reports an unknown feature inside the envelope", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-999", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unknown-target");
    });
  });

  it("reports a missing service selection inside the envelope", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("invalid-option");
    });
  });

  it("reports a missing config inside the envelope", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("surfaces a broken delta as data, keeping the requirement half usable", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.architecture.errors.length).toBeGreaterThan(0);
      expect(json.requirements).toHaveLength(1);
    });
  });
});

describe("text output is unchanged", () => {
  it("still prints the human briefing", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC);
      expect(res.code).toBe(0);
      expect(res.out).toContain(`FEAT-1 · ${NEW_SVC}`);
      expect(res.out).toContain("Requirements:");
      expect(res.out).toContain("[ADDED] Split a payment");
      expect(res.out).toContain("Architecture:");
      expect(res.out).toContain(`NEW service — create ${NEW_SVC}`);
    });
  });
});
