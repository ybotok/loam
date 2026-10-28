/**
 * The checked-in `validate --all` benchmark behind docs/BENCHMARKS.md.
 *
 * Builds the synthetic fleet from test/helpers/fleet-fixture.ts at benchmark
 * shape (120 services / 20 features — the scale suite's services ×4, features ×2), writes
 * a workdir whose loam.json mirrors test/helpers/harness.ts makeProject, and
 * measures the BUILT CLI in a fresh
 * `node dist/cli.js <args> --json` child process per run, so every run pays
 * real startup and parses from a cold in-process state (the OS page cache stays
 * warm — that is the documented policy, not an accident). Per command: one
 * discarded warm-up, then five measured runs, reported as the median; peak RSS
 * is sampled per run by polling `ps -o rss=` every 25ms and the table carries
 * the median of the five per-run peaks.
 *
 * `--fixture map-heavy` measures the OTHER shape instead: the generated fleet
 * of test/helpers/map-heavy-fixture.ts, whose weight is in an ~8k-line map and
 * whose 78 models extend it (most of them comment-only) — the shape a pilot
 * fleet measured at 56 s for `validate --all` while the default fixture
 * answered in under a second. Its generated views are written once by the
 * CLI's own `subsystem sync` before anything is timed.
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
import { MAP_HEAVY_FEATURE, MAP_HEAVY_SHAPE, mapHeavyFiles } from "../test/helpers/map-heavy-fixture.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The scale suite's 5/10/10/5 shape, services ×4 and features ×2 — recorded in docs/BENCHMARKS.md. */
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

/** One fresh-process run of the built CLI: a cold child process per measurement. */
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

/**
 * `--against <cli>`: the same commands, alternating the two CLIs run by run —
 * one warm-up each, then `RUNS` rounds with the order flipped every round — so
 * whatever else the host is doing lands on both columns alike. Sequential
 * blocks cannot promise that on a shared machine: measured 2026-10-28, five
 * sequential runs of one command spread from 60 s to 123 s while other test
 * suites came and went, which turned a before/after table into a table of
 * the host's load. The fixture is prepared by `--cli` alone; both CLIs then
 * read the same tree.
 */
async function compareInterleaved(after: string, before: string, commands: string[][], cwd: string): Promise<void> {
  if (!existsSync(before)) throw new Error(`no CLI at ${before} for --against`);
  console.log(`against: ${before}`);
  console.log(`policy: fresh process per run, interleaved — 1 warm-up each, then ${RUNS} rounds alternating which CLI runs first`);
  console.log("");
  console.log("| command | before (median) | after (median) | runs before (ms) | runs after (ms) |");
  console.log("|---|---|---|---|---|");
  for (const args of commands) {
    const label = `loam ${args.join(" ")}`;
    for (const cli of [before, after]) assertSound(label, await runOnce(cli, args, cwd));
    const runs = { before: [] as number[], after: [] as number[] };
    for (let i = 0; i < RUNS; i += 1) {
      const order = i % 2 === 0 ? (["before", "after"] as const) : (["after", "before"] as const);
      for (const side of order) {
        const run = await runOnce(side === "before" ? before : after, args, cwd);
        assertSound(label, run);
        runs[side].push(Math.round(run.ms));
      }
    }
    console.log(
      `| \`${label}\` | ${median(runs.before)} ms | ${median(runs.after)} ms | ${runs.before.join(", ")} | ${runs.after.join(", ")} |`,
    );
  }
}

/** A fixture the benchmark can time: its files, what it prints about itself, and the commands it measures. */
interface Fixture {
  files: Record<string, string>;
  describe: string[];
  commands: string[][];
  /** Run once over the written tree before any timing — the map-heavy fleet's generated views. */
  prepare: string[][];
}

/** The 120-service fleet the first two committed tables in docs/BENCHMARKS.md were measured on. */
function benchmarkFixture(): Fixture {
  const services = serviceCount(SHAPE);
  const likec4Docs = 1 + services + SHAPE.features;
  const opEdges = services - SHAPE.apiless - 1 + SHAPE.features;
  return {
    files: fleetFiles(SHAPE),
    describe: [
      `fixture: ${services} services (${SHAPE.apiless}/${SHAPE.documented}/${SHAPE.sourced}/${SHAPE.vouched}), ${SHAPE.features} features`,
      `documents: ${likec4Docs} .likec4 (landscape + models + deltas), ${opEdges} op-linked edges`,
    ],
    commands: [
      ["validate", "--all", "--json"],
      ["validate", SINGLE_SERVICE, "--json"],
      ["list", "--json"],
    ],
    // Without the generated `architecture/services.likec4` (0.2.0-alpha.16 made
    // its absence `subsystem.views-stale`, an error) `validate --all` exits 1
    // and every run of this fixture was refused as measuring nothing.
    prepare: [["subsystem", "sync"]],
  };
}

/** The pilot-shaped fleet (see the banner); its counts are test/helpers/map-heavy-fixture.ts's `MAP_HEAVY_SHAPE`. */
function mapHeavyFixture(): Fixture {
  const shape = MAP_HEAVY_SHAPE;
  const files = mapHeavyFiles(shape);
  const lines = files["architecture/landscape.likec4"]?.split("\n").length ?? 0;
  return {
    files,
    describe: [
      `fixture: map-heavy — ${shape.services} services in ${shape.subsystems} subsystems, ${shape.externals} external systems, ` +
        `${shape.databases} stores, ${shape.groups} groups, ${shape.edges} edges (${shape.kinds} kinds, ${shape.tags} tags)`,
      `documents: a ${lines}-line landscape with ${shape.mapViews} views, ${shape.drilldownViews} hand-written views beside it, ` +
        `${shape.services} extending models (${shape.services - shape.drawnModels} comment-only), ` +
        `one feature over ${shape.featureServices} services with ${shape.featureRequirements} requirements`,
    ],
    commands: [
      ["validate", "--all", "--json"],
      ["validate", "--feature", MAP_HEAVY_FEATURE, "--json"],
      // svc-3 draws an interior; svc-40 is a comment-only placeholder.
      ["validate", "svc-3", "--json"],
      ["validate", "svc-40", "--json"],
      ["list", "--json"],
    ],
    prepare: [["subsystem", "sync"]],
  };
}

async function main(): Promise<void> {
  const cliFlag = process.argv.indexOf("--cli");
  const cliPath = resolve(cliFlag === -1 ? join(projectRoot, "dist", "cli.js") : (process.argv[cliFlag + 1] ?? ""));
  if (!existsSync(cliPath)) {
    throw new Error(`no CLI at ${cliPath} — run \`npm run build\` first (or pass --cli <path>)`);
  }
  const fixtureFlag = process.argv.indexOf("--fixture");
  const fixtureName = fixtureFlag === -1 ? "benchmark" : process.argv[fixtureFlag + 1];
  if (fixtureName !== "benchmark" && fixtureName !== "map-heavy") {
    throw new Error(`unknown --fixture '${fixtureName ?? ""}' — 'benchmark' (the default) or 'map-heavy'`);
  }
  const fixture = fixtureName === "map-heavy" ? mapHeavyFixture() : benchmarkFixture();

  const root = await mkdtemp(join(tmpdir(), "loam-bench-"));
  try {
    const workDir = join(root, "work");
    const docsDir = join(root, "docs");
    await mkdir(workDir, { recursive: true });
    for (const [rel, content] of Object.entries(fixture.files)) {
      const path = join(docsDir, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    await writeFile(join(workDir, "loam.json"), `${JSON.stringify({ docsDir }, null, 2)}\n`, "utf8");
    for (const args of fixture.prepare) {
      const prepared = await runOnce(cliPath, args, workDir);
      if (prepared.exitCode !== 0) throw new Error(`loam ${args.join(" ")}: exit ${prepared.exitCode} — the fixture is not ready`);
    }

    for (const line of fixture.describe) console.log(line);
    console.log(`machine: ${platform()}/${arch()}, ${cpus().length}× ${cpus()[0]?.model ?? "unknown"}, ${mb(totalmem())} RAM`);
    console.log(`node: ${process.version}   cli: ${cliPath}   date: ${new Date().toISOString().slice(0, 10)}`);
    const againstFlag = process.argv.indexOf("--against");
    if (againstFlag !== -1) {
      await compareInterleaved(cliPath, resolve(process.argv[againstFlag + 1] ?? ""), fixture.commands, workDir);
      return;
    }
    console.log(`policy: fresh process per run (warm page cache), ${WARMUPS} discarded warm-up + ${RUNS} measured, sequential`);
    console.log("");
    console.log("| command | median | runs (ms) | peak RSS (median of per-run peaks) |");
    console.log("|---|---|---|---|");
    for (const args of fixture.commands) {
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
