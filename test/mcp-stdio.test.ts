/**
 * One end-to-end smoke through the REAL entry: `tsx src/cli.ts mcp` as a
 * child process over a coherent fixture. Everything of substance is pinned
 * in-process by test/mcp-serve.test.ts (which is also where coverage comes
 * from — a child process is not instrumented); what only a real spawn can
 * prove is the bin wiring: stdin EOF ends the loop, cli.ts lets the process
 * drain to exit 0, and real stdout carries frames and nothing else.
 *
 * Flakiness discipline: every request line is written up front and stdin is
 * closed immediately (spawnLoamStdio), so there are no response-timed writes
 * and no polling — the child's lifetime is bounded by its input, under
 * cli-process.ts's 60s SIGKILL deadline and reap tracking.
 */
import { afterAll, describe, expect, it } from "vitest";
import { coherentFixture, makeProject } from "./helpers/harness.js";
import { assertNoLiveChildren, spawnLoamStdio } from "./helpers/cli-process.js";
import { MCP_TOOLS } from "../src/core/mcp/tools.js";

const p = await makeProject(coherentFixture());

/** Kicked off once at module scope, cli-entry.test.ts-style; each test reads its slice. */
const run = spawnLoamStdio(p.workDir, [
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } }),
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "loam_status", arguments: {} } }),
]);

afterAll(async () => {
  await run;
  assertNoLiveChildren();
  await p.destroy();
});

describe("the real stdio server", () => {
  it("exits 0 on stdin EOF — the MCP stdio lifecycle, through the real cli.ts exit path", async () => {
    expect((await run).code).toBe(0);
  });

  it("stdout is exclusively protocol frames, one per request", async () => {
    const { stdout } = await run;
    const frames = stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(frames.map((frame) => frame["id"])).toEqual([1, 2, 3]);
    for (const frame of frames) expect(frame["jsonrpc"]).toBe("2.0");
  });

  it("answers the handshake, the tool list, and a real tool call from the fixture repo", async () => {
    const { stdout } = await run;
    const frames = stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { id?: number; result?: Record<string, unknown> });
    const init = frames.find((frame) => frame.id === 1)!.result!;
    expect(init["protocolVersion"]).toBe("2025-06-18");
    expect((init["serverInfo"] as Record<string, unknown>)["name"]).toBe("loam");
    const tools = frames.find((frame) => frame.id === 2)!.result!["tools"] as unknown[];
    // Counted off MCP_TOOLS: the roster is what this asserts arrived intact
    // over the real pipe, not how many entries it happened to have the day
    // the test was written.
    expect(tools).toHaveLength(MCP_TOOLS.length);
    const status = frames.find((frame) => frame.id === 3)!.result!;
    expect(status["isError"]).toBe(false);
    const envelope = JSON.parse((status["content"] as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;
    expect(envelope["ok"]).toBe(true);
  });

  it("the startup line went to stderr, not stdout", async () => {
    expect((await run).stderr).toContain("loam mcp: serving");
  });
});
