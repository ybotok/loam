/**
 * The serve loop + in-process dispatch, driven end to end with PassThrough
 * streams — a whole MCP session in one fork, no child process, LikeC4 warm.
 *
 * The sharpest pin here is envelope parity: the text a tools/call returns
 * deep-equals what `loam validate --all --json` prints through the harness.
 * That is the item's "one machine contract, not two" as an assertion — any
 * later fork of the envelope inside the MCP path fails it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";
import { rm } from "node:fs/promises";
import { serve, type ToolRunner } from "../src/commands/mcp/serve.js";
import { captureConsole, runToolArgv, type Sinks } from "../src/commands/mcp/dispatch.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { MCP_TOOLS } from "../src/core/mcp/tools.js";
import { MCP_AUTHOR_TOOLS } from "../src/core/mcp/author-tools.js";

interface SessionResult {
  /** Every stdout frame, parsed — parsing IS the purity assertion, so it throws on a stray byte. */
  frames: Array<Record<string, unknown>>;
  /** Everything the server wrote to its log stream. */
  log: string;
}

/**
 * Run one whole session: write `chunks` to the server verbatim (framing is the
 * caller's business — that is what makes split-frame cases expressible), end
 * stdin, await the loop, parse stdout. chdir'd for the duration because
 * commands resolve loam.json through process.cwd(); serial within the file, so
 * nothing else observes the moved cwd.
 */
async function drive(cwd: string, chunks: readonly string[], runTool: ToolRunner = runToolArgv): Promise<SessionResult> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const input = new PassThrough();
    const output = new PassThrough();
    const log = new PassThrough();
    const outChunks: string[] = [];
    const logChunks: string[] = [];
    output.on("data", (chunk) => outChunks.push(String(chunk)));
    log.on("data", (chunk) => logChunks.push(String(chunk)));
    const done = serve({ input, output, log }, runTool);
    for (const chunk of chunks) input.write(chunk);
    input.end();
    await done;
    const frames = outChunks
      .join("")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return { frames, log: logChunks.join("") };
  } finally {
    process.chdir(previousCwd);
  }
}

/** One frame per message, each on its own line — the common case. */
function session(cwd: string, messages: readonly unknown[]): Promise<SessionResult> {
  return drive(cwd, messages.map((message) => JSON.stringify(message) + "\n"));
}

const request = (id: number, method: string, params?: unknown): Record<string, unknown> => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const call = (id: number, name: string, args: Record<string, unknown>): Record<string, unknown> =>
  request(id, "tools/call", { name, arguments: args });

const byId = (frames: SessionResult["frames"], id: number): Record<string, unknown> => {
  const found = frames.find((f) => f["id"] === id);
  if (found === undefined) throw new Error(`no response frame carries id ${id}`);
  return found;
};
const resultOf = (frames: SessionResult["frames"], id: number): Record<string, unknown> =>
  byId(frames, id)["result"] as Record<string, unknown>;
const errorOf = (frames: SessionResult["frames"], id: number): { code: number; message: string } =>
  byId(frames, id)["error"] as { code: number; message: string };
/** A tool result's envelope, read back out of content[0].text. */
const envelopeOf = (result: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse((result["content"] as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;

describe("a full session over the coherent fixture", () => {
  let p: Project;
  let main: SessionResult;

  beforeAll(async () => {
    p = await makeProject(coherentFixture());
    main = await session(p.workDir, [
      request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      request(2, "tools/list"),
      call(3, "loam_status", {}),
      call(4, "loam_validate", { all: true }),
      call(5, "loam_list", { section: "bogus" }),
      call(6, "loam_show", { target: "no-such-thing" }),
    ]);
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("answers every id-carrying request, in order, and nothing else — stdout is frames only", () => {
    // 7 messages in, 6 responses out: the notification gets nothing. Parsing
    // already proved every stdout line is JSON; this pins that each one is a
    // JSON-RPC response frame for exactly the requests sent.
    expect(main.frames.map((f) => f["id"])).toEqual([1, 2, 3, 4, 5, 6]);
    for (const frame of main.frames) expect(frame["jsonrpc"]).toBe("2.0");
  });

  it("initialize: echoed version, tools capability, serverInfo, instructions", () => {
    const result = resultOf(main.frames, 1);
    expect(result["protocolVersion"]).toBe("2025-06-18");
    expect(result["capabilities"]).toEqual({ tools: {}, resources: {} });
    expect(result["serverInfo"]).toEqual({ name: "loam", version: LOAM_VERSION });
    expect(String(result["instructions"])).toContain("--json envelope");
  });

  it("tools/list serves the read tools MCP_TOOLS declares, each with a schema", () => {
    // Counted off MCP_TOOLS rather than a literal: the roster grew from twelve
    // to fourteen when `instructions` and `steps` landed, and a hand-typed
    // count is a test that has to be remembered rather than one that holds.
    const tools = resultOf(main.frames, 2)["tools"] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const tool of tools) {
      expect(typeof tool["name"]).toBe("string");
      expect(typeof tool["description"]).toBe("string");
      expect((tool["inputSchema"] as Record<string, unknown>)["type"]).toBe("object");
    }
  });

  it("a happy tools/call carries the envelope verbatim, parsed again as structuredContent, isError false", () => {
    const result = resultOf(main.frames, 3);
    expect(result["isError"]).toBe(false);
    const content = result["content"] as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("text");
    const envelope = envelopeOf(result);
    expect(envelope["ok"]).toBe(true);
    expect(envelope["contractVersion"]).toBe("1.0");
    expect(result["structuredContent"]).toEqual(envelope);
  });

  it("envelope parity: the MCP result IS the CLI's --json output — one contract, not two", async () => {
    const direct = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(direct.code).toBe(0);
    const viaMcp = resultOf(main.frames, 4);
    expect(viaMcp["isError"]).toBe(false);
    expect(envelopeOf(viaMcp)).toEqual(JSON.parse(direct.stdout));
    expect(viaMcp["structuredContent"]).toEqual(JSON.parse(direct.stdout));
  });

  it("a command-level refusal rides as an ok:false envelope with isError true — not a protocol error", () => {
    const invalidOption = resultOf(main.frames, 5);
    expect(invalidOption["isError"]).toBe(true);
    expect(envelopeOf(invalidOption)["error"]).toMatchObject({ code: "invalid-option" });
    const unknownTarget = resultOf(main.frames, 6);
    expect(unknownTarget["isError"]).toBe(true);
    expect(envelopeOf(unknownTarget)["error"]).toMatchObject({ code: "unknown-target" });
  });

  it("logging stays on the log stream: the startup line names the served directory", () => {
    expect(main.log).toContain("loam mcp: serving");
    expect(main.log).toContain("over stdio");
  });
});

describe("a repository the server cannot serve still answers coherently", () => {
  it("no loam.json: a refusal is isError true, a graded ok:true answer is not — even at exit 1", async () => {
    const bare = await makeTmpDir();
    try {
      const res = await session(bare, [
        call(1, "loam_status", {}),
        call(2, "loam_doctor", {}),
      ]);
      const status = resultOf(res.frames, 1);
      expect(status["isError"]).toBe(true);
      expect(envelopeOf(status)["error"]).toMatchObject({ code: "no-config" });
      // doctor in the same directory GRADES instead of refusing: ok:true,
      // healthy:false, exit 1. That frame is the isError contract's sharpest
      // case — the envelope wins over the exit code, so a host keeps the
      // structured answer instead of rendering a failed call — and its
      // presence is what proves the refused call above did not kill the loop.
      const doctor = resultOf(res.frames, 2);
      const graded = envelopeOf(doctor);
      expect(graded["ok"]).toBe(true);
      expect(graded["healthy"]).toBe(false);
      expect(doctor["isError"]).toBe(false);
      expect(doctor["structuredContent"]).toEqual(graded);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("protocol errors surface per call and never kill the loop", () => {
  it("garbage, batches, unknown methods, unknown tools and smuggled flags each get their own error frame", async () => {
    const bare = await makeTmpDir();
    try {
      const res = await drive(bare, [
        "this is not json\n",
        JSON.stringify([request(1, "ping")]) + "\n",
        JSON.stringify(request(1, "shutdown")) + "\n",
        JSON.stringify({ jsonrpc: "2.0", method: "no/such/notification" }) + "\n",
        JSON.stringify(call(2, "loam_vouch", {})) + "\n",
        JSON.stringify(call(3, "loam_show", { target: "--type" })) + "\n",
        JSON.stringify(request(4, "ping")) + "\n",
      ]);
      // Two null-id errors (parse error, batch), then per-id answers; the
      // notification contributes nothing. The final ping proves the loop is
      // still alive after every failure shape above.
      expect(res.frames.map((f) => f["id"])).toEqual([null, null, 1, 2, 3, 4]);
      expect((res.frames[0]!["error"] as { code: number }).code).toBe(-32700);
      expect((res.frames[1]!["error"] as { code: number }).code).toBe(-32600);
      expect(errorOf(res.frames, 1).code).toBe(-32601);
      expect(errorOf(res.frames, 2).code).toBe(-32602);
      expect(errorOf(res.frames, 2).message).toContain("loam_vouch");
      expect(errorOf(res.frames, 3).code).toBe(-32602);
      expect(byId(res.frames, 4)["result"]).toEqual({});
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("every advertised tool is a command the dispatcher can actually run", () => {
  it("no tool in MCP_TOOLS answers `unknown command` — the two rosters are one roster", async () => {
    // The hole this closes shipped once. `MCP_TOOLS` is what `tools/list`
    // advertises; `readProgram` in dispatch.ts is what `tools/call` runs, and
    // the two are separate lists because core/ may not import commands/. When
    // `loam_instructions` and `loam_steps` were added to the first and not the
    // second, `tools/list` promised fourteen tools and two of them answered
    // `{ ok: false, error: { code: "invalid-option", message: "unknown
    // command 'instructions'" } }` — an envelope that reads as the CALLER's
    // mistake, which is the worst shape a server-side gap can take. Every
    // suite stayed green: nothing called a tool it had just been told about.
    //
    // Run with no arguments beyond the command name: most tools then refuse
    // for a real reason (`no-config` in a bare directory), and that is fine —
    // this asserts only that the verb REACHES a command, never that it
    // succeeds.
    for (const tool of MCP_TOOLS) {
      const res = await runToolArgv([tool.command, "--json"]);
      expect(res.stdout, `${tool.name} produced no envelope`).not.toBe("");
      const envelope = JSON.parse(res.stdout) as { ok: boolean; error?: { message?: string } };
      const message = envelope.error?.message ?? "";
      expect(message, `${tool.name} -> ${tool.command}`).not.toContain("unknown command");
    }
  });

  it("the opt-in author roster reaches registered commands too", async () => {
    for (const tool of MCP_AUTHOR_TOOLS) {
      const res = await runToolArgv([tool.command, "--json"], true);
      expect(res.stdout, `${tool.name} produced no envelope`).not.toBe("");
      const envelope = JSON.parse(res.stdout) as { error?: { message?: string } };
      expect(envelope.error?.message ?? "", `${tool.name} -> ${tool.command}`).not.toContain("unknown command");
    }
  });
});

describe("console capture covers the whole stdout surface", () => {
  it("every stdout-writing console method lands in the stdout sink; warn and error in stderr", () => {
    // console.log alone was the reviewed defect: a console.info anywhere in a
    // command — or in a dependency it loads — wrote straight into the
    // client's protocol stream while every suite stayed green. This calls
    // each method the capture claims, so a method dropped from the hook list
    // fails here by name.
    const sinks: Sinks = { stdout: [], stderr: [] };
    const restore = captureConsole(sinks);
    try {
      console.log("via log");
      console.info("via info");
      console.debug("via debug");
      console.dir({ via: "dir" });
      console.table([{ via: "table" }]);
      console.group("via group");
      console.groupEnd();
      console.count("via count");
      console.countReset("via count");
      console.warn("via warn");
      console.error("via error");
    } finally {
      restore();
    }
    const out = sinks.stdout.join("\n");
    for (const label of ["via log", "via info", "via debug", "dir", "table", "via group", "via count"]) {
      expect(out).toContain(label);
    }
    expect(sinks.stderr).toEqual(["via warn", "via error"]);
    // and restore() actually restored: this log goes to the real console, not the sink.
    const before = sinks.stdout.length;
    console.debug("");
    expect(sinks.stdout.length).toBe(before);
  });
});

describe("a dispatcher failure is contained to its call", () => {
  it("a thrown tool run becomes -32603 for THAT id, named, and the loop reads on", async () => {
    // The real dispatcher converts everything it can into an envelope, so its
    // throw path is unreachable from a fixture — which is exactly why serve()
    // takes the runner as a parameter: the containment contract (one bad call
    // must never take the server down) is pinned here with a runner that dies.
    const boom: ToolRunner = async (argv) => {
      if (argv[0] === "doctor") throw new Error("dispatcher exploded");
      return { stdout: "{\"contractVersion\":\"1.0\",\"ok\":true}", stderr: "", code: 0 };
    };
    const bare = await makeTmpDir();
    try {
      const res = await drive(bare, [
        JSON.stringify(call(1, "loam_doctor", {})) + "\n",
        JSON.stringify(call(2, "loam_status", {})) + "\n",
      ], boom);
      expect(res.frames.map((f) => f["id"])).toEqual([1, 2]);
      expect(errorOf(res.frames, 1).code).toBe(-32603);
      expect(errorOf(res.frames, 1).message).toContain("loam_doctor");
      expect(errorOf(res.frames, 1).message).toContain("dispatcher exploded");
      expect((resultOf(res.frames, 2)["structuredContent"] as Record<string, unknown>)["ok"]).toBe(true);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("framing at the stream level", () => {
  it("one frame split across writes, two frames in one write, CRLF endings, and an EOF-terminated tail all parse", async () => {
    const bare = await makeTmpDir();
    try {
      const first = JSON.stringify(request(1, "ping"));
      const two = JSON.stringify(request(2, "ping")) + "\r\n" + JSON.stringify(request(3, "tools/list")) + "\r\n";
      const res = await drive(bare, [
        first.slice(0, 10),
        first.slice(10) + "\n",
        two,
        // The last frame has no trailing newline: EOF terminates it.
        JSON.stringify(request(4, "ping")),
      ]);
      expect(res.frames.map((f) => f["id"])).toEqual([1, 2, 3, 4]);
      expect((resultOf(res.frames, 3)["tools"] as unknown[]).length).toBe(MCP_TOOLS.length);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
