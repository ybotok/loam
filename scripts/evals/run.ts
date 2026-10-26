/**
 * loam's behavioural evals: each scenario, in each arm, N times, through a
 * headless Claude Code run — graded on what the agent DID (its tool calls) and
 * what it LEFT (the files), never on what it said it did.
 *
 *   npx tsx scripts/evals/run.ts --claude <path-to-claude> [--runs 3]
 *       [--scenario adopt-draft,ship-unmerged] [--arm loam|baseline|both]
 *       [--model <id>] [--max-budget-usd <n>] [--out <dir>] [--keep]
 *   npx tsx scripts/evals/run.ts --prepare-only [--scenario …] [--arm …]
 *
 * `--prepare-only` builds every workspace, prints the command a run would be
 * started with, and calls nothing: the free way to check the harness. A real run
 * costs money and is nondeterministic, which is why this is a script run at a
 * release, never a test in the gate (ANALYSIS-8 §4.2).
 *
 * The CLI is `--claude`, or `LOAM_EVAL_CLAUDE`, or `claude` on the PATH. Its
 * output goes to `--out` (default: a fresh temp directory): one transcript and
 * one grade file per run, `results.json`, and `report.md` — the table a release
 * would publish.
 *
 * ISOLATED BY DEFAULT. Each run gets an empty `CLAUDE_CONFIG_DIR`, so the
 * operator's own `~/.claude/CLAUDE.md`, skills, plugins and settings cannot
 * reach either arm — the only agent surface a run sees is the one the arm laid
 * down in the workspace. The price is authentication: an empty config dir holds
 * no login, so an isolated run needs `ANTHROPIC_API_KEY`. `--no-isolate` uses
 * the operator's config instead, and says so in the report, because its numbers
 * then measure that config too. `--bare` is NOT the isolation: it also skips
 * the project's own `.claude/skills/`, which is the loam arm under test
 * (code.claude.com/docs/en/headless, checked 2026-10-27).
 *
 * `claude plugin eval` would run this same A/B natively — isolated children, a
 * with/without ablation, graders like these — but only for a plugin, and
 * whether loam ships as one is ANALYSIS-8 §4.4's open decision. Until then,
 * this script; the scenarios move over as they are.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestsUnder, type Grade, type Workspace } from "./graders.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import { parseTranscript, type Transcript } from "./transcript.js";
import { ARMS, makeWorkspace, pathWith, type Arm } from "./workspace.js";

interface Options {
  claude: string;
  runs: number;
  scenarios: readonly Scenario[];
  arms: readonly Arm[];
  model: string | null;
  budgetUsd: string | null;
  out: string;
  keep: boolean;
  prepareOnly: boolean;
  isolate: boolean;
}

function options(argv: readonly string[]): Options {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  const wanted = value("--scenario")?.split(",") ?? null;
  const scenarios = wanted === null ? SCENARIOS : SCENARIOS.filter((s) => wanted.includes(s.id));
  if (wanted !== null && scenarios.length !== wanted.length) {
    throw new Error(`unknown scenario in '${wanted.join(",")}' — known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  }
  const arm = value("--arm") ?? "both";
  if (arm !== "both" && !ARMS.includes(arm as Arm)) throw new Error(`--arm takes loam, baseline or both, not '${arm}'`);
  return {
    claude: value("--claude") ?? process.env["LOAM_EVAL_CLAUDE"] ?? "claude",
    runs: Number(value("--runs") ?? "3"),
    scenarios,
    arms: arm === "both" ? ARMS : [arm as Arm],
    model: value("--model"),
    budgetUsd: value("--max-budget-usd"),
    out: value("--out") ?? mkdtempSync(join(tmpdir(), "loam-evals-")),
    keep: argv.includes("--keep"),
    prepareOnly: argv.includes("--prepare-only"),
    isolate: !argv.includes("--no-isolate"),
  };
}

/**
 * The tools a run may use without asking — the same list for both arms, so the
 * arms differ only in the surface under test. Reading and editing are free; the
 * shell is `loam` and read-only inspection. Anything else is denied (a headless
 * run cannot be asked), and the denial stays in the transcript.
 */
const ALLOWED_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "Skill", "TodoWrite",
  "Bash(loam *)", "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(grep *)", "Bash(find *)", "Bash(wc *)",
];

/** The argv one run is started with. */
export function claudeArgs(scenario: Scenario, opts: Pick<Options, "model" | "budgetUsd">): string[] {
  return [
    "-p", scenario.prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", String(scenario.maxTurns),
    "--permission-mode", "acceptEdits",
    "--allowedTools", ALLOWED_TOOLS.join(","),
    // No MCP in either arm: the server is an arm of its own, not part of these two.
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    // A run is evidence, not a session anybody resumes.
    "--no-session-persistence",
    ...(opts.model === null ? [] : ["--model", opts.model]),
    ...(opts.budgetUsd === null ? [] : ["--max-budget-usd", opts.budgetUsd]),
  ];
}

interface RunResult {
  scenario: string;
  arm: Arm;
  run: number;
  completed: boolean;
  turns: number | null;
  costUsd: number | null;
  grades: Record<string, Grade>;
}

function runOnce(scenario: Scenario, arm: Arm, n: number, opts: Options): RunResult | null {
  const laid = makeWorkspace(arm, scenario);
  const ws: Workspace = { ...laid, before: digestsUnder(laid.root, laid.root) };
  const args = claudeArgs(scenario, opts);
  if (opts.prepareOnly) {
    console.log(`${scenario.id} · ${arm}\n  workspace: ${ws.root}\n  cwd:       ${ws.cwd}\n  command:   ${opts.claude} ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);
    return null;
  }
  // The config dir sits OUTSIDE the workspace, where the agent's file tools do not look.
  const config = opts.isolate ? mkdtempSync(join(tmpdir(), "loam-eval-config-")) : null;
  const started = spawnSync(opts.claude, args, {
    cwd: ws.cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: pathWith(ws.root), ...(config === null ? {} : { CLAUDE_CONFIG_DIR: config }) },
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  });
  const dir = join(opts.out, scenario.id, arm);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${n}.jsonl`), started.stdout ?? "", "utf8");
  if ((started.stderr ?? "") !== "") writeFileSync(join(dir, `${n}.stderr.txt`), started.stderr, "utf8");
  const transcript: Transcript = parseTranscript(started.stdout ?? "");
  const grades = Object.fromEntries(scenario.graders.map((g) => [g.id, g.grade({ transcript, workspace: ws })]));
  const result: RunResult = {
    scenario: scenario.id, arm, run: n,
    completed: transcript.completed, turns: transcript.turns, costUsd: transcript.costUsd, grades,
  };
  writeFileSync(join(dir, `${n}.grade.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (config !== null) rmSync(config, { recursive: true, force: true });
  if (!opts.keep) rmSync(ws.root, { recursive: true, force: true });
  return result;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The report: one row per scenario and arm, one column per grader, passes over runs. */
export function report(results: readonly RunResult[], scenarios: readonly Scenario[]): string {
  const lines = ["| scenario | arm | completed | " + "grades | median turns | median cost |", "|---|---|---|---|---|---|"];
  for (const scenario of scenarios) {
    for (const arm of ARMS) {
      const rows = results.filter((r) => r.scenario === scenario.id && r.arm === arm);
      if (rows.length === 0) continue;
      const grades = scenario.graders
        .map((g) => `${g.id} ${rows.filter((r) => r.grades[g.id]?.pass === true).length}/${rows.length}`)
        .join(" · ");
      const turns = median(rows.flatMap((r) => (r.turns === null ? [] : [r.turns])));
      const cost = median(rows.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd])));
      lines.push(
        `| ${scenario.id} | ${arm} | ${rows.filter((r) => r.completed).length}/${rows.length} | ${grades} | ` +
          `${turns ?? "?"} | ${cost === null ? "?" : `$${cost.toFixed(2)}`} |`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function main(): void {
  const opts = options(process.argv.slice(2));
  if (!opts.prepareOnly && opts.isolate && process.env["ANTHROPIC_API_KEY"] === undefined) {
    // Refused up front rather than discovered per run as thirty "not logged in"
    // transcripts graded zero: an isolated run has no login but the key.
    console.error("isolated runs authenticate with ANTHROPIC_API_KEY, and it is not set — set it, or pass --no-isolate to use your own config");
    process.exitCode = 1;
    return;
  }
  const results: RunResult[] = [];
  for (const scenario of opts.scenarios) {
    for (const arm of opts.arms) {
      for (let n = 1; n <= (opts.prepareOnly ? 1 : opts.runs); n++) {
        const result = runOnce(scenario, arm, n, opts);
        if (result === null) continue;
        results.push(result);
        const passed = Object.values(result.grades).filter((g) => g.pass).length;
        console.log(`${scenario.id} · ${arm} · run ${n}: ${passed}/${scenario.graders.length} grades, ${result.turns ?? "?"} turns`);
      }
    }
  }
  if (opts.prepareOnly) return;
  writeFileSync(join(opts.out, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  const note = opts.isolate ? "" : "\n_Run with --no-isolate: the operator's own Claude Code config applied to both arms._\n";
  writeFileSync(join(opts.out, "report.md"), report(results, opts.scenarios) + note, "utf8");
  console.log(`\n${report(results, opts.scenarios)}\nwritten to ${opts.out}`);
}

/** Run, or merely imported by a test? The realpath rule src/cli.ts and payload-sizes.ts use. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
