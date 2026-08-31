/**
 * `loam init --mcp` — the one delivery init makes that a machine reads.
 *
 * Everything else init writes is prose an agent has to be pointed at: command
 * files and Agent Skills, twenty dialects of the same six pointers. The MCP
 * facade is the typed one — every tool declares `readOnlyHint`, every result
 * carries `structuredContent` — and it was the only delivery that required a
 * human to hand-edit a JSON file before any of that could be reached. So the
 * claims graded here are the ones that make the flag worth having:
 *
 *   - the file is written ONLY with the flag, and is a third delivery rather
 *     than a variation on the other two: `--no-commands --no-skills --mcp`
 *     writes it, and `--tools` does not contradict it.
 *   - the launch form matches how loam is installed HERE, both branches. A
 *     fixed `"command": "loam"` would write an unlaunchable entry into exactly
 *     the repositories README tells people to make — the documented install is
 *     a per-repo devDependency, whose binary is on no PATH an MCP host has.
 *   - an existing `.mcp.json` is reported skipped and its bytes are untouched.
 *     Byte-for-byte the same existsSync-never-content rule every other init
 *     delivery follows: loam does not merge into a file a human owns.
 *   - and the one that matters — the config it wrote ACTUALLY STARTS A SERVER.
 *     A scaffolded JSON file that no host can launch is worse than none, and
 *     nothing short of spawning what the file spells can tell the two apart.
 *     That test drives the same real stdio session test/mcp-stdio.test.ts does,
 *     through the same spawn helper, differing in exactly one place: the binary
 *     and argv come out of the written file instead of being spelled here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNoLiveChildren, cliEntry, spawnProcess, tsxBin } from "./helpers/cli-process.js";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  assertNoLiveChildren();
});

/** A throwaway working directory with nothing — and no loam.json above it. */
async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir("loam-init-mcp-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Make `dir` look like a repository that took loam as a devDependency: the
 * local bin npm's shim writer would have left there.
 *
 * A `sh` shim rather than a copied binary, because what the assertion is about
 * is RESOLUTION — `npx --no loam` has to find this file from this working
 * directory — and what it resolves to only has to be a working loam. It execs
 * the same `tsx src/cli.ts` every other spawned-CLI test runs.
 */
async function installLocalBin(dir: string): Promise<string> {
  const bin = join(dir, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  const path = join(bin, "loam");
  await writeFile(path, `#!/bin/sh\nexec "${tsxBin}" "${cliEntry}" "$@"\n`, { mode: 0o755 });
  return path;
}

/** The `loam` server entry of the `.mcp.json` this run wrote. */
async function serverEntry(dir: string): Promise<{ command: string; args: string[] }> {
  const parsed = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  return parsed.mcpServers["loam"]!;
}

describe("init --mcp: the file", () => {
  it("is written only with the flag", async () => {
    const without = await throwawayDir();
    expect((await runLoam(without, "init", "--docs", "./d", "--create")).code).toBe(0);
    expect(existsSync(join(without, ".mcp.json"))).toBe(false);

    const with_ = await throwawayDir();
    expect((await runLoam(with_, "init", "--docs", "./d", "--create", "--mcp")).code).toBe(0);
    expect(existsSync(join(with_, ".mcp.json"))).toBe(true);
  });

  it("names the bare binary when loam is not installed into this repository", async () => {
    // Nothing in `node_modules/.bin` here, so the only launch form that can
    // work is whatever `loam` the host's PATH resolves — a global install.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp");
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { loam: { command: "loam", args: ["mcp"] } },
    });
  });

  it("names the npx form when it is — the install shape README documents", async () => {
    // The per-repo devDependency install: the binary exists, and it is on no
    // PATH an MCP host inherits. A fixed `"loam"` would have written an entry
    // that cannot launch into exactly these repositories. `--no` is part of
    // the claim: without it npx FETCHES a package named `loam` from the
    // registry when local resolution misses.
    const dir = await throwawayDir();
    await installLocalBin(dir);
    await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp");
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { loam: { command: "npx", args: ["--no", "loam", "mcp"] } },
    });
  });

  it("leaves no transaction journal behind — the write is a committed transaction", async () => {
    // It goes through the same journaled writer every other loam write does,
    // so a killed run leaves `.loam-commit` naming the file. A COMPLETED one
    // must not: a stray journal would make `loam doctor` report a freshly
    // scaffolded repository as half-written.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp");
    expect(Object.keys(await treeHashes(dir)).filter((p) => p.includes(".loam-commit"))).toEqual([]);
  });
});

describe("init --mcp: a third delivery, not a variation on the other two", () => {
  it("is written even when both prose deliveries are suppressed", async () => {
    // `--no-commands` and `--no-skills` each say "write none of that kind".
    // Neither says anything about the machine delivery, so neither suppresses
    // it — which is also why `--mcp` needs no contradiction guard against them.
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--no-commands", "--no-skills", "--mcp",
    );
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "commands"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "skills"))).toBe(false);
  });

  it("does not contradict --tools: one selects agent files, the other writes a host config", async () => {
    // The existing refusal is `--tools` against a `--no-*`, and its reason is
    // that one selects the files to generate while the other suppresses them.
    // `--mcp` neither selects nor suppresses any of those files.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "cursor", "--mcp", "--json");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).ok).toBe(true);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(dir, ".cursor", "commands", "loam-check.md"))).toBe(true);
  });
});

describe("init --mcp: never merges into a file somebody owns", () => {
  it("reports an existing .mcp.json skipped and does not touch a byte of it", async () => {
    const dir = await throwawayDir();
    const mine = `${JSON.stringify({ mcpServers: { other: { command: "other", args: [] } } }, null, 4)}\n`;
    await writeFile(join(dir, ".mcp.json"), mine, "utf8");

    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.skipped).toContain(join(dir, ".mcp.json"));
    expect(payload.created).not.toContain(join(dir, ".mcp.json"));
    // No parse, no key merge, no reformat: the four-space indent and the
    // caller's own server entry are exactly as they were.
    expect(await readFile(join(dir, ".mcp.json"), "utf8")).toBe(mine);
  });

  it("prints the key to paste, in the launch form this install shape needs", async () => {
    // The human half of the skip. A refusal that only says "already there"
    // leaves the caller to work out the entry themselves — from a WORKFLOW.md
    // example that names the bare binary, which is the wrong one here.
    const dir = await throwawayDir();
    await installLocalBin(dir);
    await writeFile(join(dir, ".mcp.json"), "{}\n", "utf8");

    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp");
    expect(res.code).toBe(0);
    expect(res.out).toContain(`"loam": {`);
    expect(res.out).toContain(`"command": "npx"`);
    expect(res.out).toContain(`"--no"`);
  });
});

describe("init --mcp: the machine contract", () => {
  it("the path appears in created, in the same list every other scaffolded path uses", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.created).toContain(join(dir, ".mcp.json"));
    expect(payload.skipped).not.toContain(join(dir, ".mcp.json"));
  });
});

describe("init --mcp: the config actually launches a server", () => {
  // Skipped on Windows only because of the SHIM, not the claim: npm's local
  // bin is three files there (`loam`, `loam.cmd`, `loam.ps1`) and `execFile`
  // without a shell resolves none of them, so a Windows run would be grading
  // the fixture rather than the config. The Linux gate runs it for real.
  it.skipIf(process.platform === "win32")(
    "spawning exactly what .mcp.json spells answers the initialize handshake",
    async () => {
      const dir = await throwawayDir();
      await installLocalBin(dir);
      await runLoam(dir, "init", "--docs", "./d", "--create", "--mcp");

      // The one difference from test/mcp-stdio.test.ts: the binary and argv are
      // READ OUT OF THE FILE loam just wrote. Anything spelled here instead
      // would prove that `loam mcp` works, which was never in doubt — what is
      // in doubt is whether the config points at it.
      const entry = await serverEntry(dir);
      const requests = [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "init-mcp", version: "0" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "loam_status", arguments: {} } }),
      ];
      // Every request written up front and stdin closed immediately, the
      // discipline spawnLoamStdio keeps: the child's lifetime is bounded by
      // its input, so there is no response-timed write and nothing to poll.
      const run = await spawnProcess(entry.command, entry.args, {
        cwd: dir,
        stdin: `${requests.join("\n")}\n`,
      });

      expect(run.code, `stderr: ${run.stderr}`).toBe(0);
      const frames = run.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { id?: number; result?: Record<string, unknown> });
      const init = frames.find((frame) => frame.id === 1)!.result!;
      expect(init["protocolVersion"]).toBe("2025-06-18");
      expect((init["serverInfo"] as Record<string, unknown>)["name"]).toBe("loam");
      // And it is serving THIS repository — the whole point of a per-repo
      // config file is that the server answers for the directory it names.
      const status = frames.find((frame) => frame.id === 2)!.result!;
      expect(status["isError"]).toBe(false);
      expect((status["structuredContent"] as Record<string, unknown>)["ok"]).toBe(true);
    },
  );
});
