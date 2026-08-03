/**
 * Smoke test through the REAL CLI entry (src/cli.ts): the bin wiring, commander's
 * own error paths, and --version — none of which the in-process harness ever
 * executes. Spawns `tsx src/cli.ts` in a bare temp cwd (no loam.json: every case
 * here resolves before config is read).
 *
 * Pins:
 *   - --version / --help pass through commander untouched, exit 0.
 *   - the envelope invariant survives commander-level usage errors: unknown
 *     option or command WITH --json still yields {ok:false, error.code:
 *     "invalid-option"} on stdout (the exitOverride handler in src/cli.ts).
 *   - without --json, usage errors stay plain text on stderr, stdout empty.
 *   - `--json` after a `--` terminator does NOT count as asking for JSON
 *     (the jsonRequested() heuristic stops at the terminator).
 *
 * Each spawn costs about a second, so the six invocations are kicked off in
 * parallel at module scope and each test just awaits its own result.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliEntry = join(repoRoot, "src", "cli.ts");
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/** Bare cwd for every spawn — proves nothing here needs a loam.json. */
const workDir = mkdtempSync(join(tmpdir(), "loam-cli-entry-"));
afterAll(() => rm(workDir, { recursive: true, force: true }));

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(...args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    execFile(tsxBin, [cliEntry, ...args], { cwd: workDir }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

const runs = {
  version: runCli("--version"),
  help: runCli("--help"),
  unknownFlagJson: runCli("list", "--json", "--bogus"),
  unknownCommandJson: runCli("frobnicate", "--json"),
  unknownFlagText: runCli("list", "--bogus"),
  jsonAfterTerminator: runCli("list", "--bogus", "--", "--json"),
};

describe("real CLI entry", () => {
  it("--version prints the package.json version and exits 0", async () => {
    const r = await runs.version;
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  });

  it("--help prints usage and exits 0", async () => {
    const r = await runs.help;
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: loam");
    expect(r.stdout).toContain("validate");
  });

  it("unknown option with --json still yields the envelope on stdout", async () => {
    const r = await runs.unknownFlagJson;
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("invalid-option");
    expect(envelope.error.message).toContain("--bogus");
  });

  it("unknown command with --json yields the same envelope contract", async () => {
    const r = await runs.unknownCommandJson;
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("invalid-option");
  });

  it("unknown option without --json stays plain text on stderr", async () => {
    const r = await runs.unknownFlagText;
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option");
    expect(r.stdout.trim()).toBe("");
  });

  it("`--json` only after a -- terminator does not switch to JSON", async () => {
    const r = await runs.jsonAfterTerminator;
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option");
    expect(r.stdout.trim()).toBe("");
  });
});
