/**
 * The concurrency-stability proof: N sequential full-suite runs at the
 * CONFIGURED parallelism, each classified, none retried.
 *
 *     node scripts/gate-stress.mjs                 # 3 runs of npm test's suite
 *     node scripts/gate-stress.mjs --runs 5
 *     node scripts/gate-stress.mjs --coverage      # 3 runs with thresholds enforced
 *
 * Three runs are three verdicts, never three attempts: the script exits 1 if
 * ANY run had ANY failure, and prints each failure's class (product /
 * runner-policy / coverage-threshold / infrastructure) from
 * gate-stress-classify.mjs. It deliberately passes no --retry, no
 * --no-file-parallelism and no pool overrides — the roadmap's exit criterion
 * is the suite passing AS CONFIGURED, and a weakened pool would prove a
 * different claim. An `infrastructure` verdict stops after run 1: a host that
 * forbids a required primitive fails once with its named cause, and repeating
 * the refusal twice more would add nothing.
 *
 * Behavior counts are compared across runs; a run that passes with FEWER
 * tests than its siblings is flagged runner-policy — a dropped file is the
 * silent shape of an incomplete run.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRun } from "./gate-stress-classify.mjs";

const args = process.argv.slice(2);
const coverage = args.includes("--coverage");
const runsFlag = args.indexOf("--runs");
const runs = runsFlag === -1 ? 3 : Number(args[runsFlag + 1]);
if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs takes a positive integer");
  process.exit(1);
}

const testFiles = (await readdir("test")).filter((f) => f.endsWith(".test.ts")).sort();
const scratch = await mkdtemp(join(tmpdir(), "loam-gate-stress-"));

/** One vitest child, captured. The 45-minute ceiling matches the CI job's own. */
function vitest(reportPath) {
  const flags = ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`];
  if (coverage) flags.splice(2, 0, "--coverage");
  return new Promise((done) => {
    const child = execFile(
      "npx",
      flags,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 45 * 60 * 1000, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        done({ exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : -1, stdout, stderr });
      },
    );
    child.stdout?.pipe(process.stdout);
  });
}

const results = [];
for (let i = 1; i <= runs; i += 1) {
  console.log(`\n=== gate-stress run ${i}/${runs}${coverage ? " (coverage)" : ""} ===`);
  const reportPath = join(scratch, `run-${i}.json`);
  const { exitCode, stderr } = await vitest(reportPath);
  let report = null;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    report = null;
  }
  const discoveredFiles = testFiles.map((f) => join(process.cwd(), "test", f));
  const outcome = classifyRun({ report, stderrText: stderr, exitCode, discoveredFiles, coverage });
  const total = report?.numTotalTests ?? null;
  results.push({ run: i, exitCode, total, ...outcome });
  console.log(`run ${i}: exit ${exitCode}, tests ${total ?? "?"}, verdict ${outcome.verdict}`);
  for (const f of outcome.failures) {
    console.log(`  [${f.class}] ${f.file ?? ""}${f.test ? ` > ${f.test}` : ""}`);
  }
  if (outcome.verdict === "infrastructure") {
    console.log("host forbids a required primitive — one classified failure is the whole answer; not rerunning");
    break;
  }
}

// A quieter kind of failure: two green runs that did not run the same suite.
const totals = new Set(results.filter((r) => r.total !== null).map((r) => r.total));
if (totals.size > 1) {
  console.log(`behavior counts differ across runs (${[...totals].join(", ")}) — flagged runner-policy`);
  results.push({ run: 0, exitCode: null, total: null, verdict: "runner-policy", failures: [] });
}

await rm(scratch, { recursive: true, force: true });

const red = results.filter((r) => r.verdict !== "clean");
console.log(`\n${results.length} run(s): ${red.length === 0 ? "all clean" : `${red.length} not clean`}`);
process.exit(red.length === 0 ? 0 : 1);
