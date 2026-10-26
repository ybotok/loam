/**
 * The eval harness's own parts — the transcript reader and the graders — over
 * synthetic transcripts. A real eval run is a paid, nondeterministic script run
 * at a release (scripts/evals/run.ts); what can be pinned here is that the
 * harness reads a run the way it says it does, so a number it reports is about
 * the agent and not about a grader that misread the stream.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashCommand, parseTranscript, skillLoaded, writtenFile } from "../scripts/evals/transcript.js";
import {
  digestsUnder,
  neverRan,
  protocolFirst,
  shellWrites,
  untouched,
  validatedLast,
  type Workspace,
} from "../scripts/evals/graders.js";
import { claudeArgs, report } from "../scripts/evals/run.js";
import { SCENARIOS } from "../scripts/evals/scenarios.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** One stream-json line per event, as `claude -p --output-format stream-json --verbose` writes them. */
function stream(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}
const tool = (name: string, input: Record<string, unknown>): unknown => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] },
});
const result = (text: string, subtype = "success"): unknown => ({
  type: "result", subtype, is_error: subtype !== "success", result: text, num_turns: 7, total_cost_usd: 0.42,
});

const NO_WORKSPACE: Workspace = { root: "/nowhere", cwd: "/nowhere", docs: "/nowhere", before: new Map() };
const evidence = (text: string): { transcript: ReturnType<typeof parseTranscript>; workspace: Workspace } =>
  ({ transcript: parseTranscript(text), workspace: NO_WORKSPACE });

describe("parseTranscript", () => {
  it("reads the tool calls in order, the final text, the turns and the cost — and survives a torn line", () => {
    const t = parseTranscript(
      stream(
        { type: "system", subtype: "init", tools: ["Bash"] },
        tool("Bash", { command: "loam status --json" }),
        tool("Write", { file_path: "/w/docs/x.md", content: "x" }),
      ) + "\n{torn" + "\n" + stream(result("done")),
    );
    expect(t.calls.map((c) => c.name)).toEqual(["Bash", "Write"]);
    expect(bashCommand(t.calls[0]!)).toBe("loam status --json");
    expect(writtenFile(t.calls[1]!)).toBe("/w/docs/x.md");
    expect(t).toMatchObject({ final: "done", completed: true, turns: 7, costUsd: 0.42 });
  });

  it("a run that hit its turn cap, or never closed, did not complete", () => {
    expect(parseTranscript(stream(result("", "error_max_turns"))).completed).toBe(false);
    expect(parseTranscript(stream(tool("Bash", { command: "ls" }))).completed).toBe(false);
  });

  it("names the skill a Skill call loaded, whichever key carries it", () => {
    expect(skillLoaded({ name: "Skill", input: { skill: "loam-adopt" } })).toBe("loam-adopt");
    expect(skillLoaded({ name: "Skill", input: { command: "/loam-check" } })).toBe("loam-check");
    expect(skillLoaded({ name: "Bash", input: { command: "loam" } })).toBeNull();
  });
});

describe("graders", () => {
  it("protocol-first: the skill or `loam instructions` before the first write, not after it", () => {
    const g = protocolFirst("loam-adopt");
    expect(g.grade(evidence(stream(tool("Skill", { skill: "loam-adopt" }), tool("Write", { file_path: "a" })))).pass).toBe(true);
    expect(g.grade(evidence(stream(tool("Bash", { command: "loam instructions loam-adopt refund-service" }))))).toMatchObject({ pass: true });
    expect(g.grade(evidence(stream(tool("Write", { file_path: "a" }), tool("Skill", { skill: "loam-adopt" }))))).toMatchObject({ pass: false });
    expect(g.grade(evidence(stream(tool("Skill", { skill: "loam-check" }))))).toMatchObject({ pass: false });
  });

  it("validated-last: a write after the last validate fails it, a shell write included", () => {
    const write = tool("Edit", { file_path: "a" });
    const validate = tool("Bash", { command: "loam validate --all --json" });
    expect(validatedLast.grade(evidence(stream(write, validate))).pass).toBe(true);
    expect(validatedLast.grade(evidence(stream(validate, write))).pass).toBe(false);
    expect(validatedLast.grade(evidence(stream(validate, tool("Bash", { command: "sed -i 's/a/b/' spec.md" })))).pass).toBe(false);
    expect(validatedLast.grade(evidence(stream(tool("Bash", { command: "ls" })))).pass).toBe(true);
  });

  it("shellWrites tells a write from a redirect that writes nothing", () => {
    expect(shellWrites("echo x > spec.md")).toBe(true);
    expect(shellWrites("cat <<'EOF' >> notes.md")).toBe(true);
    expect(shellWrites("sed -i.bak 's/a/b/' f")).toBe(true);
    expect(shellWrites("ls 2>&1")).toBe(false);
    expect(shellWrites("grep -r x . > /dev/null")).toBe(false);
    expect(shellWrites("loam validate --all > out.json")).toBe(false);
  });

  it("neverRan matches a command, wherever in the line it sits", () => {
    const g = neverRan("no-archive", "", /\bloam archive\b(?![^\n;&|]*--dry-run)/);
    expect(g.grade(evidence(stream(tool("Bash", { command: "loam archive FEAT-101 --dry-run --json" })))).pass).toBe(true);
    expect(g.grade(evidence(stream(tool("Bash", { command: "cd docs && loam archive FEAT-101" })))).pass).toBe(false);
  });

  it("untouched: compares bytes against what setup recorded, so a shell edit cannot hide", () => {
    const root = mkdtempSync(join(tmpdir(), "loam-evals-test-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "svc", "features", "loam"), { recursive: true });
    writeFileSync(join(root, "svc", "features", "loam", "a.feature"), "Feature: a\n");
    const ws: Workspace = { root, cwd: join(root, "svc"), docs: root, before: digestsUnder(root, root) };
    const g = untouched("generated-untouched", "", (w) => join(w.cwd, "features", "loam"));
    expect(g.grade({ transcript: parseTranscript(""), workspace: ws }).pass).toBe(true);
    writeFileSync(join(root, "svc", "features", "loam", "a.feature"), "Feature: b\n");
    expect(g.grade({ transcript: parseTranscript(""), workspace: ws })).toMatchObject({ pass: false });
  });
});

describe("the runner", () => {
  it("starts every scenario the same way in both arms: stream-json, no MCP, loam on the allowlist", () => {
    for (const scenario of SCENARIOS) {
      const args = claudeArgs(scenario, { model: null, budgetUsd: "2" });
      expect(args).toContain("stream-json");
      expect(args).toContain("--strict-mcp-config");
      expect(args.join(" ")).toContain("Bash(loam *)");
      expect(args.slice(args.indexOf("--max-budget-usd"))[1]).toBe("2");
    }
  });

  it("reports passes over runs, per grader, per arm", () => {
    const scenario = SCENARIOS.find((s) => s.id === "ship-unmerged")!;
    const grades = Object.fromEntries(scenario.graders.map((g, i) => [g.id, { pass: i % 2 === 0, detail: "" }]));
    const md = report(
      [
        { scenario: "ship-unmerged", arm: "loam", run: 1, completed: true, turns: 10, costUsd: 0.5, grades },
        { scenario: "ship-unmerged", arm: "loam", run: 2, completed: false, turns: 20, costUsd: 1.5, grades },
      ],
      [scenario],
    );
    expect(md).toContain("| ship-unmerged | loam | 1/2 |");
    expect(md).toContain(`${scenario.graders[0]!.id} 2/2`);
    expect(md).toContain("| 15 | $1.00 |");
  });
});
