import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  PROTOCOLS,
  SUPPORT_PAGES,
  WORKFLOWS,
} from "../src/core/agent/protocol.js";
import {
  type AgentProfile,
  plannedCommandFiles,
  SLASH_COMMANDS,
} from "../src/core/agent/scaffold.js";

describe("the loam-report support protocol", () => {
  it("is discoverable without becoming a seventh lifecycle workflow", () => {
    expect(WORKFLOWS).toHaveLength(6);
    expect(WORKFLOWS.map((row) => row.name)).not.toContain("loam-report");
    expect(SUPPORT_PAGES.map((row) => row.name)).toEqual(["loam-report"]);
    expect(PROTOCOLS["loam-report"]).toBeDefined();
  });

  it("produces a separate local artifact and preserves the safety boundary", () => {
    const report = PROTOCOLS["loam-report"]!;
    expect(report).toContain("loam-reports/YYYY-MM-DD-<short-slug>.md");
    expect(report).toContain("<redacted>");
    expect(report).toContain("Never re-run");
    expect(report).toContain("do not upload");
    expect(report).toContain("## Expected");
    expect(report).toContain("## Actual");
    expect(report).toContain("## Minimal safe reproduction");
    expect(report).toContain("## Sanitization");
  });

  it("ships as both command and Agent Skill in every profile", () => {
    const profiles: AgentProfile[] = ["full", "service", "docs"];
    for (const profile of profiles) {
      const paths = plannedCommandFiles("repo", ["claude"], undefined, profile).map((f) => f.path);
      expect(paths).toContain(join("repo", ".claude", "commands", "loam-report.md"));
      expect(paths).toContain(join("repo", ".claude", "skills", "loam-report", "SKILL.md"));
    }
  });

  it("keeps generated files thin and gives automatic discovery a precise trigger", () => {
    const pointer = SLASH_COMMANDS["loam-report"]!;
    expect(pointer).toContain("loam instructions loam-report");
    expect(pointer).not.toContain("## Minimal safe reproduction");

    const skill = plannedCommandFiles("repo", ["claude"], ["skills"])
      .find((file) => file.path.endsWith(join("loam-report", "SKILL.md")))!;
    expect(skill.content).toContain("description: Record unexpected loam or agent behavior");
    expect(skill.content).toContain("loam instructions loam-report");
    expect(skill.content).toContain("allowed-tools: Bash(loam --version), Bash(loam doctor:*)");
    expect(skill.content).not.toContain("Bash(loam archive:*)");
    expect(skill.content).not.toContain("Bash(loam new:*)");
  });
});
