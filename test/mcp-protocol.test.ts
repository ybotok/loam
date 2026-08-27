/**
 * The pure half of `loam mcp` (src/core/mcp/): framing, JSON-RPC routing,
 * version negotiation, the tool table, and the argv boundary. No fixture, no
 * streams — every case is a function call, which is the point of keeping the
 * protocol out of the serve loop.
 */
import { describe, expect, it } from "vitest";
import { frame, splitFrames } from "../src/core/mcp/framing.js";
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  SUPPORTED_PROTOCOL_VERSIONS,
  initializeResult,
  routeLine,
  toolReply,
  type JsonRpcResponse,
} from "../src/core/mcp/protocol.js";
import { toArgv } from "../src/core/mcp/argv.js";
import { MCP_TOOLS, toInputSchema, toolByName } from "../src/core/mcp/tools.js";
import { MCP_COMMAND } from "../src/core/agent/agents-md/map/mcp.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { buildProgram } from "../src/cli.js";

/** The route outcome asserted to be an immediate reply, with its response. */
function replyOf(message: unknown): JsonRpcResponse {
  const outcome = routeLine(typeof message === "string" ? message : JSON.stringify(message));
  if (outcome.kind !== "reply") throw new Error(`expected a reply outcome, got '${outcome.kind}'`);
  return outcome.response;
}

const errorOf = (response: JsonRpcResponse): { code: number; message: string } =>
  response["error"] as { code: number; message: string };
const resultOf = (response: JsonRpcResponse): Record<string, unknown> =>
  response["result"] as Record<string, unknown>;

const request = (id: number, method: string, params?: unknown): Record<string, unknown> => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe("framing (newline-delimited JSON-RPC)", () => {
  it("splits complete frames from the unterminated tail", () => {
    expect(splitFrames("a\nb\nc")).toEqual({ lines: ["a", "b"], rest: "c" });
    expect(splitFrames("a\n")).toEqual({ lines: ["a"], rest: "" });
    expect(splitFrames("partial")).toEqual({ lines: [], rest: "partial" });
    expect(splitFrames("")).toEqual({ lines: [], rest: "" });
  });

  it("strips one trailing CR per frame — Windows clients end lines with CRLF", () => {
    expect(splitFrames("{\"a\":1}\r\n{\"b\":2}\r\n").lines).toEqual(["{\"a\":1}", "{\"b\":2}"]);
  });

  it("strips a leading BOM — PowerShell's pipeline encoder prepends one on Windows", () => {
    // Observed live: the first frame a PowerShell-driven client sends arrives
    // as ﻿{"jsonrpc"… and died -32700 before this strip existed.
    expect(splitFrames("﻿{\"a\":1}\n").lines).toEqual(["{\"a\":1}"]);
  });

  it("frame() ends with the delimiter and can never embed one", () => {
    // A newline INSIDE a string value is escaped by JSON.stringify, so the
    // serialized frame stays one line — the invariant the transport rests on.
    const framed = frame({ text: "two\nlines" });
    expect(framed.endsWith("\n")).toBe(true);
    expect(framed.slice(0, -1)).not.toContain("\n");
  });
});

describe("initialize", () => {
  it("echoes a supported requested version and answers the newest otherwise", () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(initializeResult({ protocolVersion: version })["protocolVersion"]).toBe(version);
    }
    expect(initializeResult({ protocolVersion: "1999-01-01" })["protocolVersion"]).toBe(LATEST_PROTOCOL_VERSION);
    expect(initializeResult({})["protocolVersion"]).toBe(LATEST_PROTOCOL_VERSION);
    expect(initializeResult(undefined)["protocolVersion"]).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("carries capabilities.tools, serverInfo with the real version, and the envelope instructions", () => {
    const result = resultOf(replyOf(request(1, "initialize", { protocolVersion: "2025-06-18" })));
    expect(result["capabilities"]).toEqual({ tools: {} });
    expect(result["serverInfo"]).toEqual({ name: "loam", version: LOAM_VERSION });
    expect(String(result["instructions"])).toContain("error.code");
  });
});

describe("routing", () => {
  it("ping answers an empty result", () => {
    const response = replyOf(request(7, "ping"));
    expect(response.id).toBe(7);
    expect(resultOf(response)).toEqual({});
  });

  it("an unparseable line is -32700 with id null", () => {
    const response = replyOf("this is not json");
    expect(response.id).toBeNull();
    expect(errorOf(response).code).toBe(PARSE_ERROR);
  });

  it("a batch array is -32600 — batching left the protocol in 2025-06-18", () => {
    const response = replyOf([request(1, "ping"), request(2, "ping")]);
    expect(errorOf(response).code).toBe(INVALID_REQUEST);
  });

  it("a non-object and a wrong jsonrpc are -32600", () => {
    expect(errorOf(replyOf("42")).code).toBe(INVALID_REQUEST);
    expect(errorOf(replyOf({ jsonrpc: "1.0", id: 1, method: "ping" })).code).toBe(INVALID_REQUEST);
  });

  it("an unknown request method is -32601 — including LSP's 'shutdown'", () => {
    for (const method of ["resources/list", "shutdown", "frobnicate"]) {
      const response = replyOf(request(3, method));
      expect(response.id).toBe(3);
      expect(errorOf(response).code).toBe(METHOD_NOT_FOUND);
      expect(errorOf(response).message).toContain(method);
    }
  });

  it("notifications get no response, whatever their method", () => {
    for (const method of ["notifications/initialized", "notifications/cancelled", "no/such/thing"]) {
      expect(routeLine(JSON.stringify({ jsonrpc: "2.0", method })).kind).toBe("ignore");
    }
    // An explicit null id is treated as a notification too: null ids are
    // reserved for unanswerable errors, so a reply could never be correlated.
    expect(routeLine(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" })).kind).toBe("ignore");
  });

  it("a PRESENT malformed id is -32600 with id null, never silence — the client is waiting", () => {
    // An absent id is a notification; a present-but-unusable one is a REQUEST
    // whose reply cannot be correlated. Folding these together (the reviewed
    // defect) answered a malformed request with silence — a client hang.
    for (const raw of [
      "{\"jsonrpc\":\"2.0\",\"id\":{},\"method\":\"ping\"}",
      "{\"jsonrpc\":\"2.0\",\"id\":true,\"method\":\"ping\"}",
      "{\"jsonrpc\":\"2.0\",\"id\":[1],\"method\":\"ping\"}",
      // JSON.parse reads 1e999 as Infinity: a number, but not a usable id.
      "{\"jsonrpc\":\"2.0\",\"id\":1e999,\"method\":\"ping\"}",
    ]) {
      const response = replyOf(raw);
      expect(response.id, raw).toBeNull();
      expect(errorOf(response).code, raw).toBe(INVALID_REQUEST);
      expect(errorOf(response).message, raw).toContain("id");
    }
  });

  it("blank lines are ignored", () => {
    expect(routeLine("").kind).toBe("ignore");
    expect(routeLine("   ").kind).toBe("ignore");
  });
});

describe("tools/list", () => {
  it("offers exactly the twelve read-only commands — no writer is reachable", () => {
    const result = resultOf(replyOf(request(1, "tools/list")));
    const tools = result["tools"] as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool["name"]).sort()).toEqual([
      "loam_context",
      "loam_delta",
      "loam_dependencies",
      "loam_diff",
      "loam_doctor",
      "loam_explain",
      "loam_explore",
      "loam_gate",
      "loam_list",
      "loam_show",
      "loam_status",
      "loam_validate",
    ]);
    // The trust boundary, asserted from the other side: vouch is a HUMAN act
    // (the CLI refuses unattended runs), and archive/verify write — none of
    // them may ever appear here, under any name.
    for (const name of tools.map((tool) => String(tool["name"]))) {
      expect(name).not.toContain("vouch");
      expect(name).not.toContain("archive");
      expect(name).not.toContain("verify");
    }
  });

  it("every tool carries a name in the MCP grammar, a description naming its CLI form, and a closed object schema", () => {
    const result = resultOf(replyOf(request(1, "tools/list")));
    const tools = result["tools"] as Array<Record<string, unknown>>;
    for (const tool of tools) {
      expect(String(tool["name"])).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(String(tool["description"])).toContain("CLI equivalent: loam ");
      const schema = tool["inputSchema"] as Record<string, unknown>;
      expect(schema["type"]).toBe("object");
      expect(schema["additionalProperties"]).toBe(false);
      const properties = Object.keys(schema["properties"] as Record<string, unknown>);
      for (const required of (schema["required"] as string[] | undefined) ?? []) {
        expect(properties).toContain(required);
      }
    }
  });

  it("the AGENTS.md mcp section's hand-listed roster names every served command", () => {
    // map/mcp.ts cannot import MCP_TOOLS (package cycle: tools.ts reads
    // core/explain/terms.ts, which reads the agents-md sections), so its
    // roster is hand-written and this pin is what keeps it current: a tool
    // added to the table without its command named in the docs fails here.
    for (const tool of MCP_TOOLS) {
      expect(MCP_COMMAND, `AGENTS.md mcp section is missing '${tool.command}'`).toContain(tool.command);
    }
  });

  it("required is emitted only where a positional or a flag is required", () => {
    expect(toInputSchema(toolByName("loam_show")!)["required"]).toEqual(["target"]);
    expect(toInputSchema(toolByName("loam_status")!)["required"]).toBeUndefined();
    // The one required FLAG: diff without a base has no diff to compute, and
    // the schema must say so instead of an invalid-option envelope after the call.
    expect(toInputSchema(toolByName("loam_diff")!)["required"]).toEqual(["base"]);
  });
});

describe("the argv boundary", () => {
  it("maps arguments positionally and per-flag, always appending --json", () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ["loam_validate", { all: true }, ["validate", "--all", "--json"]],
      ["loam_validate", { target: "payment-service", strict: true, errorsOnly: true },
        ["validate", "payment-service", "--strict", "--errors-only", "--json"]],
      ["loam_status", {}, ["status", "--json"]],
      ["loam_status", { feature: "FEAT-1", service: "payment-service" },
        ["status", "FEAT-1", "--service", "payment-service", "--json"]],
      ["loam_list", { section: "services", needsWork: true }, ["list", "services", "--needs-work", "--json"]],
      ["loam_show", { target: "FEAT-1", type: "feature" }, ["show", "FEAT-1", "--type", "feature", "--json"]],
      ["loam_delta", { featureId: "FEAT-1", service: "svc" }, ["delta", "FEAT-1", "--service", "svc", "--json"]],
      ["loam_explore", { services: ["a", "b"], op: ["x", "y"], as: "FEAT-2" },
        ["explore", "a", "b", "--op", "x", "--op", "y", "--as", "FEAT-2", "--json"]],
      ["loam_dependencies", { featureId: "FEAT-1" }, ["dependencies", "FEAT-1", "--json"]],
      ["loam_diff", { base: "origin/main" }, ["diff", "--base", "origin/main", "--json"]],
      ["loam_doctor", {}, ["doctor", "--json"]],
      ["loam_context", { service: "svc", feature: "FEAT-1" }, ["context", "svc", "--feature", "FEAT-1", "--json"]],
      ["loam_gate", { service: "svc", strict: true }, ["gate", "--service", "svc", "--strict", "--json"]],
    ];
    for (const [name, args, argv] of cases) {
      const built = toArgv(toolByName(name)!, args);
      expect(built, `${name} ${JSON.stringify(args)}`).toEqual({ ok: true, argv });
    }
  });

  it("a boolean flag set false is omitted, not spelled", () => {
    expect(toArgv(toolByName("loam_validate")!, { all: false })).toEqual({ ok: true, argv: ["validate", "--json"] });
  });

  it("refuses a missing required argument", () => {
    const built = toArgv(toolByName("loam_show")!, {});
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problem).toContain("target");
  });

  it("refuses a missing required flag the same way", () => {
    const built = toArgv(toolByName("loam_diff")!, {});
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problem).toContain("base");
  });

  it("refuses an unknown argument by name, listing what the tool takes", () => {
    const built = toArgv(toolByName("loam_status")!, { servcie: "typo" });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.problem).toContain("servcie");
      expect(built.problem).toContain("service");
    }
  });

  it("refuses every '-'-prefixed string — a JSON value must never become a flag", () => {
    const smugglings: Array<[string, Record<string, unknown>]> = [
      ["loam_show", { target: "--type" }],
      ["loam_validate", { service: "-x" }],
      ["loam_explore", { services: ["ok", "--as"] }],
      ["loam_explore", { op: ["--capability"] }],
    ];
    for (const [name, args] of smugglings) {
      const built = toArgv(toolByName(name)!, args);
      expect(built.ok, `${name} ${JSON.stringify(args)}`).toBe(false);
      if (!built.ok) expect(built.problem).toContain("begins with '-'");
    }
  });

  it("refuses wrong-typed values rather than coercing them", () => {
    for (const [name, args] of [
      ["loam_validate", { all: "yes" }],
      ["loam_show", { target: 7 }],
      ["loam_explore", { services: "not-an-array" }],
      ["loam_explore", { op: [1] }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(toArgv(toolByName(name)!, args).ok, `${name} ${JSON.stringify(args)}`).toBe(false);
    }
  });

  it("a valid tools/call routes to a call outcome carrying the built argv", () => {
    const outcome = routeLine(JSON.stringify(request(9, "tools/call", { name: "loam_validate", arguments: { all: true } })));
    expect(outcome).toEqual({ kind: "call", id: 9, toolName: "loam_validate", argv: ["validate", "--all", "--json"] });
    // The config-free tool crosses the same boundary: subject is one optional
    // positional, and --json is appended like everywhere else.
    const explain = routeLine(JSON.stringify(request(10, "tools/call", { name: "loam_explain", arguments: { subject: "docs-busy" } })));
    expect(explain).toEqual({ kind: "call", id: 10, toolName: "loam_explain", argv: ["explain", "docs-busy", "--json"] });
  });

  it("tools/call refusals are -32602: unknown tool, bad arguments shape, smuggled flag", () => {
    const unknown = replyOf(request(1, "tools/call", { name: "loam_vouch", arguments: {} }));
    expect(errorOf(unknown).code).toBe(INVALID_PARAMS);
    expect(errorOf(unknown).message).toContain("loam_vouch");
    expect(errorOf(replyOf(request(2, "tools/call", { name: "loam_show", arguments: "target" }))).code).toBe(INVALID_PARAMS);
    expect(errorOf(replyOf(request(3, "tools/call", { name: "loam_show", arguments: { target: "--type" } }))).code).toBe(INVALID_PARAMS);
    expect(errorOf(replyOf(request(4, "tools/call", {}))).code).toBe(INVALID_PARAMS);
  });
});

describe("wrapping a tool run", () => {
  it("ships the envelope verbatim as text, parsed as structuredContent, isError from the exit code", () => {
    const envelope = "{\n  \"contractVersion\": \"1.0\",\n  \"ok\": true\n}";
    const reply = toolReply({ stdout: envelope, stderr: "", code: 0 });
    expect(reply).toEqual({
      kind: "result",
      result: {
        content: [{ type: "text", text: envelope }],
        structuredContent: { contractVersion: "1.0", ok: true },
        isError: false,
      },
    });
  });

  it("a refusing envelope (ok:false) is isError true — MCP puts refusals in-band", () => {
    const envelope = "{\"contractVersion\":\"1.0\",\"ok\":false,\"error\":{\"code\":\"no-config\",\"message\":\"m\"}}";
    const reply = toolReply({ stdout: envelope, stderr: "", code: 1 });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect(reply.result["isError"]).toBe(true);
    expect((reply.result["structuredContent"] as Record<string, unknown>)["ok"]).toBe(false);
  });

  it("an ok:true envelope that exits 1 is NOT isError — the envelope wins over the exit code", () => {
    // doctor with blockers, validate on an invalid fleet, gate verdict:fail,
    // and both projections' silent-hole exits all answer ok:true with exit 1:
    // a graded answer, not a failed call. A host renders isError:true as "the
    // call failed" and may discard structuredContent — which for loam_gate
    // discards the verdict the caller asked for.
    const envelope = "{\"contractVersion\":\"1.0\",\"ok\":true,\"command\":\"doctor\",\"healthy\":false}";
    const reply = toolReply({ stdout: envelope, stderr: "", code: 1 });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect(reply.result["isError"]).toBe(false);
    expect((reply.result["structuredContent"] as Record<string, unknown>)["healthy"]).toBe(false);
  });

  it("an empty stdout is a protocol error, never a quiet result — 'nobody could look' stays distinguishable", () => {
    const reply = toolReply({ stdout: "", stderr: "boom", code: 1 });
    expect(reply.kind).toBe("error");
    if (reply.kind === "error") {
      expect(reply.code).toBe(INTERNAL_ERROR);
      expect(reply.message).toContain("boom");
    }
  });

  it("unparseable stdout still reaches the caller verbatim, without a pretend structuredContent", () => {
    const reply = toolReply({ stdout: "not json at all", stderr: "", code: 0 });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect((reply.result["content"] as Array<{ text: string }>)[0]!.text).toBe("not json at all");
    expect("structuredContent" in reply.result).toBe(false);
  });

  it("only with no envelope to consult does the exit code decide isError", () => {
    const broken = (code: number) => {
      const reply = toolReply({ stdout: "not json at all", stderr: "", code });
      if (reply.kind !== "result") throw new Error("expected a result");
      return reply.result["isError"];
    };
    expect(broken(1)).toBe(true);
    expect(broken(0)).toBe(false);
  });
});

describe("the tool table mirrors the CLI registrations", () => {
  it("is internally consistent: derived names, at most one variadic positional, last", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toBe(`loam_${tool.command}`);
      expect(tool.positionals.filter((p) => p.variadic).length).toBeLessThanOrEqual(1);
      if (tool.positionals.some((p) => p.variadic)) {
        expect(tool.positionals.at(-1)!.variadic).toBe(true);
      }
    }
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(MCP_TOOLS.length);
  });

  it("every advertised flag and positional exists on the registered command, shape for shape", () => {
    // Against buildProgram() itself, not a restatement: the serve tests parse
    // only the arguments their sessions happen to pass (--all and little
    // else), so a table flag misspelling — loam_validate advertising
    // --errors_only, say — would ship as a tool schema clients validate
    // against and an invalid-option refusal at every call. Commander's own
    // registrations are the one source of truth for what parses; this walks
    // the whole table against them.
    const program = buildProgram();
    for (const tool of MCP_TOOLS) {
      const command = program.commands.find((candidate) => candidate.name() === tool.command);
      expect(command, `${tool.name} names unregistered command '${tool.command}'`).toBeDefined();
      const longs = command!.options.map((option) => option.long);
      expect(longs, `${tool.command} must accept the --json toArgv always appends`).toContain("--json");
      for (const flag of tool.flags) {
        expect(longs, `${tool.name} advertises ${flag.flag}, which ${tool.command} does not declare`).toContain(flag.flag);
        const option = command!.options.find((candidate) => candidate.long === flag.flag)!;
        // A value-taking kind must map to a value-taking option and a boolean
        // kind to a bare flag — a mismatch either drops a value or starves one.
        expect(
          option.required || option.optional,
          `${tool.name}.${flag.property} kind '${flag.kind}' vs ${flag.flag}'s value arity`,
        ).toBe(flag.kind !== "boolean");
        // Both ways: a table flag marked required must be commander-mandatory
        // (or the schema over-promises), and a mandatory option must be marked
        // (or a client only learns the requirement from a refusal envelope).
        expect(
          option.mandatory,
          `${tool.name}.${flag.property} required vs ${flag.flag}'s mandatory`,
        ).toBe(flag.required === true);
      }
      const registered = command!.registeredArguments;
      expect(
        registered.length,
        `${tool.name} declares ${tool.positionals.length} positionals; ${tool.command} registers ${registered.length}`,
      ).toBe(tool.positionals.length);
      tool.positionals.forEach((positional, index) => {
        const argument = registered[index]!;
        expect(argument.required, `${tool.name} positional '${positional.property}' required`).toBe(positional.required);
        expect(argument.variadic, `${tool.name} positional '${positional.property}' variadic`).toBe(positional.variadic);
      });
    }
  });
});
