/**
 * The checked-in `validate --all` benchmark behind docs/BENCHMARKS.md.
 *
 * Builds the synthetic fleet from test/helpers/fleet-fixture.ts at benchmark
 * shape (120 services / 20 features — the scale suite's proportions ×4), writes
 * a workdir whose loam.json mirrors test/helpers/harness.ts makeProject, and
 * measures the BUILT CLI the way scripts/pilot-harness.mjs run() does: a fresh
 * `node dist/cli.js <args> --json` child process per run, so every run pays
 * real startup and parses from a cold in-process state (the OS page cache stays
 * warm — that is the documented policy, not an accident). Per command: one
 * discarded warm-up, then five measured runs, reported as the median; peak RSS
 * is sampled per run by polling `ps -o rss=` every 25ms and the table carries
 * the median of the five per-run peaks.
 *
 * Run it via `npm run bench:validate` after `npm run build`. Nothing here is a
 * vitest test on purpose: a wall-clock assertion inside the parallel suite
 * measures the host's load, not the code — test/scale.test.ts keeps only a
 * blow-up alarm, and the honest numbers live in the committed table.
 */
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus, platform, arch, totalmem, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fleetFiles, serviceCount, type FleetShape } from "../test/helpers/fleet-fixture.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The scale suite's 5/10/10/5 + 10, ×4 — recorded in docs/BENCHMARKS.md. */
const SHAPE: FleetShape = { apiless: 20, documented: 40, sourced: 40, vouched: 20, features: 20 };
/** A mid-fleet documented service, for the single-service drift measurement. */
const SINGLE_SERVICE = "svc-21";
const WARMUPS = 1;
const RUNS = 5;
const RSS_POLL_MS = 25;
const RUN_TIMEOUT_MS = 300_000;

interface Measured {
  ms: number;
  /** Peak resident set in bytes, the max of the 25ms `ps -o rss=` samples. */
  peakRss: number;
  stdout: string;
  exitCode: number;
}

/** One `ps -o rss=` sample in bytes; 0 when the process is already gone. */
function sampleRss(pid: number): Promise<number> {
  return new Promise((done) => {
    execFile("ps", ["-o", "rss=", "-p", String(pid)], (err, stdout) => {
      const kb = err ? 0 : Number.parseInt(stdout.trim(), 10);
      done(Number.isFinite(kb) ? kb * 1024 : 0);
    });
  });
}

/** One fresh-process run of the built CLI, exactly as the pilot harness spawns it. */
function runOnce(cliPath: string, args: string[], cwd: string): Promise<Measured> {
  return new Promise((done, failed) => {
    const started = performance.now();
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, timeout: RUN_TIMEOUT_MS });
    let peakRss = 0;
    let sampling = false;
    const poll = setInterval(() => {
      if (sampling || child.pid === undefined) return;
      sampling = true;
      void sampleRss(child.pid).then((rss) => {
        if (rss > peakRss) peakRss = rss;
        sampling = false;
      });
    }, RSS_POLL_MS);
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.resume();
    child.on("error", (err) => {
      clearInterval(poll);
      failed(err);
    });
    child.on("close", (code) => {
      clearInterval(poll);
      done({
        ms: performance.now() - started,
        peakRss,
        stdout: Buffer.concat(out).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}

/** Refuse to publish a timing for a run that did not do the work. */
function assertSound(label: string, run: Measured): void {
  if (run.exitCode !== 0) {
    throw new Error(`${label}: exit ${run.exitCode} — a failing run measures nothing`);
  }
  const payload = JSON.parse(run.stdout) as { ok?: boolean; valid?: boolean };
  if (payload.ok !== true || payload.valid === false) {
    throw new Error(`${label}: payload not ok/valid — a failing run measures nothing`);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

interface CommandResult {
  label: string;
  medianMs: number;
  runsMs: number[];
  peakRssBytes: number;
}

async function measureCommand(cliPath: string, args: string[], cwd: string): Promise<CommandResult> {
  const label = `loam ${args.join(" ")}`;
  for (let i = 0; i < WARMUPS; i += 1) assertSound(label, await runOnce(cliPath, args, cwd));
  const runs: Measured[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const run = await runOnce(cliPath, args, cwd);
    assertSound(label, run);
    runs.push(run);
  }
  return {
    label,
    medianMs: median(runs.map((r) => r.ms)),
    runsMs: runs.map((r) => Math.round(r.ms)),
    peakRssBytes: median(runs.map((r) => r.peakRss)),
  };
}

async function main(): Promise<void> {
  const cliFlag = process.argv.indexOf("--cli");
  const cliPath = resolve(cliFlag === -1 ? join(projectRoot, "dist", "cli.js") : (process.argv[cliFlag + 1] ?? ""));
  if (!existsSync(cliPath)) {
    throw new Error(`no CLI at ${cliPath} — run \`npm run build\` first (or pass --cli <path>)`);
  }

  const root = await mkdtemp(join(tmpdir(), "loam-bench-"));
  try {
    const workDir = join(root, "work");
    const docsDir = join(root, "docs");
    await mkdir(workDir, { recursive: true });
    const files = fleetFiles(SHAPE);
    for (const [rel, content] of Object.entries(files)) {
      const path = join(docsDir, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    await writeFile(join(workDir, "loam.json"), `${JSON.stringify({ docsDir }, null, 2)}\n`, "utf8");

    const services = serviceCount(SHAPE);
    const likec4Docs = 1 + services + SHAPE.features;
    const opEdges = services - SHAPE.apiless - 1 + SHAPE.features;
    const commands: string[][] = [
      ["validate", "--all", "--json"],
      ["validate", SINGLE_SERVICE, "--json"],
      ["list", "--json"],
    ];

    console.log(`fixture: ${services} services (${SHAPE.apiless}/${SHAPE.documented}/${SHAPE.sourced}/${SHAPE.vouched}), ${SHAPE.features} features`);
    console.log(`documents: ${likec4Docs} .likec4 (landscape + models + deltas), ${opEdges} op-linked edges`);
    console.log(`machine: ${platform()}/${arch()}, ${cpus().length}× ${cpus()[0]?.model ?? "unknown"}, ${mb(totalmem())} RAM`);
    console.log(`node: ${process.version}   cli: ${cliPath}   date: ${new Date().toISOString().slice(0, 10)}`);
    console.log(`policy: fresh process per run (warm page cache), ${WARMUPS} discarded warm-up + ${RUNS} measured, sequential`);
    console.log("");
    console.log("| command | median | runs (ms) | peak RSS (median of per-run peaks) |");
    console.log("|---|---|---|---|");
    for (const args of commands) {
      const result = await measureCommand(cliPath, args, workDir);
      console.log(
        `| \`${result.label}\` | ${Math.round(result.medianMs)} ms | ${result.runsMs.join(", ")} | ${mb(result.peakRssBytes)} |`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
