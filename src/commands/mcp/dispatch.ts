/**
 * In-process dispatch for one MCP tool call: build a fresh commander program
 * holding ONLY the read commands the tool table exposes, run the argv through
 * it, and hand back what the CLI would have printed.
 *
 * This is the proven harness pattern (test/helpers/harness.ts runLoamNow)
 * moved to the commands layer, minus the chdir: the server's own cwd IS the
 * workdir, so every call resolves loam.json exactly as the CLI would in that
 * directory — the server serves ONE repository, the one it started in, and
 * never changes directory. In-process rather than a child per call because a
 * child re-pays LikeC4/Langium startup on every validate, and because in dev
 * there is no built binary to exec.
 *
 * The capture is process-global (console, exitCode), which is safe under
 * exactly one condition the serve loop guarantees: calls are strictly
 * sequential — each one is awaited to completion before the next frame is
 * read — and `parseAsync` resolves only after the action has fully run (the
 * entire test suite rests on that same guarantee). Nothing here may be
 * module-level state: two serve sessions in one process (the tests do this)
 * must not see each other.
 *
 * NOTE for test/agents.test.ts's scan: registration happens through the
 * imported register functions; this module must never contain the literal
 * dot-command-paren call, comments included, or the CLI surface count breaks.
 */
import { Command, CommanderError } from "commander";
import { format } from "node:util";
import { emitJsonError } from "../../core/envelope/json.js";
import { registerValidate } from "../validate/validate.js";
import { registerStatus } from "../status/status.js";
import { registerList } from "../list/list.js";
import { registerShow } from "../show/show.js";
import { registerDelta } from "../delta/delta.js";
import { registerDiff } from "../diff/diff.js";
import { registerExplore } from "../explore.js";
import { registerDependencies } from "../dependencies.js";
import { registerDoctor } from "../doctor.js";
import { registerContext } from "../context/context.js";
import { registerGate } from "../gate/gate.js";
import { registerExplain } from "../explain/explain.js";
import { registerInstructions } from "../instructions.js";
import { registerSteps } from "../steps/steps.js";

export interface DispatchResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Console sinks for one dispatch — a value, not module state, so calls cannot share buffers. */
export interface Sinks {
  readonly stdout: string[];
  readonly stderr: string[];
}

/**
 * Every console method Node's Console writes to STDOUT — the protocol stream,
 * where one stray line corrupts the transport. Hooking only `log` was the
 * reviewed defect here: a `console.info` in any command, or in a dependency a
 * command loads, would have written straight into the client's frame stream
 * with every suite green. `warn`/`error` go to stderr, captured for the
 * server log rather than the wire.
 */
const STDOUT_METHODS = [
  "log", "info", "debug", "dir", "dirxml", "table",
  "group", "groupCollapsed", "groupEnd", "count", "countReset", "timeLog", "timeEnd",
] as const;
const STDERR_METHODS = ["warn", "error"] as const;

/**
 * Replace the console methods named above with sink writers; the returned
 * function restores every original. Captured output is `format(...)`ed, so
 * `table`/`group` lose their layout — acceptable on purpose: the invariant
 * bought here is that their BYTES stay off the protocol stream, not that
 * their rendering survives.
 */
export function captureConsole(sinks: Sinks): () => void {
  const target = console as unknown as Record<string, unknown>;
  const writer = (sink: string[]) => (...parts: unknown[]): void => {
    sink.push(format(...parts));
  };
  const toStdout = writer(sinks.stdout);
  const toStderr = writer(sinks.stderr);
  const original = new Map<string, unknown>();
  for (const [names, replacement] of [
    [STDOUT_METHODS, toStdout],
    [STDERR_METHODS, toStderr],
  ] as const) {
    for (const name of names) {
      // A method absent on this Node build has nothing to capture — and
      // nothing to restore, so it must not enter the map either.
      if (typeof target[name] !== "function") continue;
      original.set(name, target[name]);
      target[name] = replacement;
    }
  }
  return () => {
    for (const [name, method] of original) target[name] = method;
  };
}

/** Commander output codes whose printed output is the point, not a usage failure. */
const PASS_THROUGH = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

/**
 * The read-only program, output routed into `sinks`. configureOutput and
 * exitOverride are set BEFORE the register calls on purpose: commander copies
 * inherited settings onto a subcommand when it is created, so settings applied
 * after registration would leave every subcommand writing to the real stdout —
 * which for an MCP server is the protocol stream.
 */
function readProgram(sinks: Sinks): Command {
  const program = new Command();
  program.name("loam");
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => sinks.stdout.push(text),
    writeErr: (text) => sinks.stderr.push(text),
  });
  registerValidate(program);
  registerStatus(program);
  registerList(program);
  registerShow(program);
  registerDelta(program);
  registerDiff(program);
  registerExplore(program);
  registerDependencies(program);
  registerDoctor(program);
  registerContext(program);
  registerGate(program);
  registerExplain(program);
  // The two that read no config at all. They are here for the same reason they
  // are in MCP_TOOLS: an agent meets `instructions` and `steps` BEFORE the
  // repository is wired, and every generated skill's first line points at
  // `loam instructions <workflow>`. This list and MCP_TOOLS are two copies of
  // one roster, and nothing counted them against each other until a tool
  // advertised in `tools/list` and absent here answered a `tools/call` with
  // `unknown command 'instructions'` — an envelope that reads as the caller's
  // mistake. `test/mcp-serve.test.ts` now calls every advertised tool.
  registerInstructions(program);
  registerSteps(program);
  return program;
}

/**
 * Run one tool argv. Never throws: whatever goes wrong becomes an envelope in
 * `stdout` with `code` 1, so the serve loop's answer to THIS call is the only
 * thing affected — one bad call must never take the server down, and a
 * memoised rejection cannot exist because nothing here outlives the call.
 */
export async function runToolArgv(argv: readonly string[]): Promise<DispatchResult> {
  const sinks: Sinks = { stdout: [], stderr: [] };
  const previousExitCode = process.exitCode;
  const restoreConsole = captureConsole(sinks);
  process.exitCode = undefined;
  try {
    await readProgram(sinks).parseAsync(["node", "loam", ...argv]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (PASS_THROUGH.has(err.code)) {
        // Unreachable through the tool schemas (the argv builder refuses every
        // '-'-prefixed string, so --help/--version cannot arrive), kept for the
        // day it is not: the output already sits in the sinks; keep its code.
        if (process.exitCode === undefined) process.exitCode = err.exitCode;
      } else {
        // The same envelope cli.ts's catch emits for a usage error, so an MCP
        // caller still receives machine-readable JSON, not a bare exception.
        emitJsonError("invalid-option", err.message.replace(/^error: /, ""));
      }
    } else {
      // An unexpected throw from a command action: the CLI's own catch-all
      // (`internal`) — the one code with no stable meaning, carried so the
      // caller gets an envelope rather than a dead call.
      emitJsonError("internal", err instanceof Error ? err.message : String(err));
    }
  } finally {
    restoreConsole();
  }
  const code = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = previousExitCode;
  return { stdout: sinks.stdout.join("\n"), stderr: sinks.stderr.join("\n"), code };
}
