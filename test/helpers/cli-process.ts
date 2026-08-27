/**
 * The spawned-CLI vocabulary: one place that knows how to run the REAL entry
 * (`tsx src/cli.ts`) as a child process, with the two disciplines every
 * spawn here owes the suite — a deadline, and a reaping guarantee.
 *
 * It is a separate file so harness.ts stays in-process-only; the two are the
 * SAME vocabulary (AGENTS.md: do not invent a second harness), split along
 * the one line that matters: harness.ts's runLoam shares this process's cwd,
 * console and exitCode, so it can never overlap itself, while a spawned child
 * has its own everything and is how concurrency is exercised for real.
 * test/helpers/federated.ts's startRecord builds on the registry here rather
 * than keeping its own child bookkeeping.
 *
 * Every child is tracked from spawn to close; `assertNoLiveChildren` is the
 * executable form of the roadmap's "no leaked processes" — stress suites call
 * it in afterEach so a wedged tsx child fails THAT test with a pid, instead
 * of surfacing three files later as a 120-second runner timeout that reads
 * like nondeterminism. Module-scope spawns (cli-entry.test.ts kicks its six
 * off at import time, deliberately) are tracked the same way: their registry
 * entries clear when they close, which is long before any afterEach asks.
 */
import { execFile, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
export const cliEntry = join(repoRoot, "src", "cli.ts");

export interface SpawnedResult {
  /** Exit status; -1 when the child never reached one (spawn failure, or our own deadline kill). */
  code: number;
  stdout: string;
  stderr: string;
}

const live = new Set<ChildProcess>();

/** Track a child created elsewhere (federated.ts's startRecord) under the same reaping guarantee. */
export function trackChild(child: ChildProcess): void {
  live.add(child);
  child.on("close", () => live.delete(child));
}

/**
 * One child process, bounded. SIGKILL rather than SIGTERM on the deadline:
 * the children here are tsx processes mid-parse, and a graceful shutdown of
 * a process we already decided is wedged only moves the hang into the kill.
 */
export function spawnProcess(
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; stdin?: string },
): Promise<SpawnedResult> {
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        cwd: opts?.cwd,
        encoding: "utf8",
        timeout: opts?.timeoutMs ?? 60_000,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        live.delete(child);
        resolve({ code: err === null ? 0 : typeof err.code === "number" ? err.code : -1, stdout, stderr });
      },
    );
    live.add(child);
    // Written whole and closed at once: the child sees its entire input and
    // then EOF, so nothing here ever waits on a response before writing more —
    // the discipline that keeps stdio-protocol tests free of interactive waits.
    // (execFile's child exposes stdin like any spawn; the buffered-output
    // convenience and the deadline discipline above are why it stays.)
    if (opts?.stdin !== undefined) {
      // Swallowed: a child SIGKILLed by the deadline can close its pipe before
      // this write flushes, and the EPIPE would otherwise crash the fork as an
      // unhandled stream error. The deadline verdict (code -1 above) is the
      // failure report; the broken pipe adds nothing to it.
      child.stdin?.on("error", () => {});
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });
}

/** The real CLI in a real process: `tsx src/cli.ts <args>` in `cwd`. */
export function spawnLoam(cwd: string, ...args: string[]): Promise<SpawnedResult> {
  return spawnProcess(tsxBin, [cliEntry, ...args], { cwd });
}

/**
 * The real MCP server end to end: `tsx src/cli.ts mcp` in `cwd`, every request
 * line fed up front, stdin closed immediately. The server answers each frame in
 * order and exits on the EOF — so the child's lifetime is bounded by its input,
 * not by any timing assumption, and the 60s deadline above only ever fires on a
 * genuine wedge.
 */
export function spawnLoamStdio(cwd: string, requestLines: readonly string[]): Promise<SpawnedResult> {
  return spawnProcess(tsxBin, [cliEntry, "mcp"], { cwd, stdin: requestLines.join("\n") + "\n" });
}

/**
 * Throws if any spawned child is still alive — with its pid and argv, so the
 * leak is attributed to the test that made it, not to the file that happened
 * to run 120 seconds later.
 */
export function assertNoLiveChildren(): void {
  if (live.size === 0) return;
  const names = [...live].map((c) => `pid ${c.pid ?? "?"}: ${c.spawnargs.slice(-3).join(" ")}`);
  throw new Error(`live child process(es) leaked past the test that spawned them: ${names.join("; ")}`);
}
