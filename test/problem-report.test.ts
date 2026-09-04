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
    expect(report).toContain("loam-reports/NNN-YYYY-MM-DD-<short-slug>.md");
    expect(report).toContain("<redacted>");
    expect(report).toContain("Never re-run");
    expect(report).toContain("do not upload");
    expect(report).toContain("## Expected");
    expect(report).toContain("## Actual");
    expect(report).toContain("## Minimal safe reproduction");
    expect(report).toContain("## Sanitization");
  });

  /**
   * The naming half of the protocol, which used to stop at a collision breaker.
   *
   * `YYYY-MM-DD-<slug>.md` plus "a numeric suffix when the path exists" means
   * that in a directory of eleven reports none of them has a suffix, and the
   * discriminating part of every name sits far to the right of what a terminal,
   * a file picker or a chat message shows. Four of the eleven here shared their
   * first eleven characters and were different incidents. An ordinal in front
   * is the same computation applied unconditionally, where it is visible.
   */
  it("gives every report an ordinal, and names where the next one comes from", () => {
    const report = PROTOCOLS["loam-report"]!;
    expect(report).toContain("loam-reports/NNN-YYYY-MM-DD-<short-slug>.md");
    // "at least three digits" and not "three-digit": `reports.next` widens past
    // three rather than reusing a number, so a page promising three digits
    // describes a field that does not keep the promise.
    expect(report).toMatch(/at least three digits, zero-padded/);
    expect(report).toContain("widens past three digits");
    // The agent is told to ASK rather than to count the directory itself: the
    // ordinal doctor computes and the one an agent derives must not be two
    // answers, and only one of them is tested.
    expect(report).toContain("`reports.next`");
    expect(report).toContain("`001`");
    // A collision is still never an overwrite — the rule survived the change,
    // it only stopped being the reason a number exists.
    expect(report).toMatch(/Never\s+overwrite a different incident/);
    // And the point of the number: a report becomes citable.
    expect(report).toContain("never by filename");
  });

  /**
   * W9: `reports.dir` is the repository root PLUS `loam-reports/`, and the
   * protocol used to gloss it as "the directory holding the `loam.json`" — an
   * agent joining the two writes `loam-reports/loam-reports/NNN-….md`.
   *
   * Beside it, the ordinal guard: the existence check is on the PATH while the
   * promise is about the ORDINAL, so two concurrent authors can hold one number
   * and neither run notices.
   */
  it("says what `reports.dir` already contains, and how a shared ordinal is settled", () => {
    const report = PROTOCOLS["loam-report"]!;
    expect(report).toContain("already on the end");
    expect(report).toMatch(/never joined onto\s+`loam-reports\/` a second time/);
    expect(report).toMatch(/re-run `loam doctor --json` after writing/);
    expect(report).toContain("renames itself to the next free");
  });

  /**
   * The status a report claims is a header FIELD. Read anywhere in the file it
   * convicted the reports that QUOTE this template — which several do, because
   * an agent reporting that the protocol is wrong pastes the protocol — in
   * EITHER markdown spelling, which is why the sentence names both: this
   * template is printed as an indented block, so a fence-only promise was one
   * the reader could not keep about the protocol's own text.
   */
  it("says where `loam doctor` reads the status line from, in both quoting shapes", () => {
    const report = PROTOCOLS["loam-report"]!;
    expect(report).toContain("HEADER FIELD BLOCK");
    expect(report).toMatch(/the lines above the first `##` heading, quoted code skipped/);
    expect(report).toContain("an indented block, which is the shape THIS template is");
  });

  /**
   * The one piece of state a report actually has. Three of the eleven reports
   * in this repository were already closed and one was superseded, and every
   * bit of that lived outside the files in whoever remembered — a report that
   * had been sent looked exactly like one written a minute ago.
   */
  it("carries a status field, its vocabulary, and how a report is closed", () => {
    const report = PROTOCOLS["loam-report"]!;
    expect(report).toContain("- Status: open");
    for (const value of ["`open`", "`sent`", "`fixed in <version>`", "`superseded by <NNN>`"]) {
      expect(report, value).toContain(value);
    }
    // Closed in the file itself: an index would be a second place to keep in
    // step, and the workaround that added one is what this replaces.
    expect(report).toContain("Close a report by editing its own");
    // doctor now reads the directory, and the safety boundary is unchanged by
    // it — this is the sentence that says so.
    expect(report).toContain("nothing is transmitted");
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
