/**
 * The pure half of `loam mcp` (src/core/mcp/): framing, JSON-RPC routing,
 * version negotiation, the tool table, and the argv boundary. No fixture, no
 * streams — every case is a function call, which is the point of keeping the
 * protocol out of the serve loop.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
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
import { MCP_AUTHOR_TOOLS } from "../src/core/mcp/author-tools.js";
import { MCP_COMMAND } from "../src/core/agent/agents-md/map/mcp.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { buildProgram } from "../src/cli.js";
import { moduleEdges } from "../scripts/source-graph.mjs";

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
    expect(result["capabilities"]).toEqual({ tools: {}, resources: {} });
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
    for (const method of ["shutdown", "frobnicate"]) {
      const response = replyOf(request(3, method));
      expect(response.id).toBe(3);
      expect(errorOf(response).code).toBe(METHOD_NOT_FOUND);
      expect(errorOf(response).message).toContain(method);
    }
  });

  it("lists and reads version-matched orientation and workflow resources", () => {
    const listed = resultOf(replyOf(request(4, "resources/list")))["resources"] as Array<Record<string, unknown>>;
    expect(listed.some(({ uri }) => uri === "loam://orientation")).toBe(true);
    expect(listed.some(({ uri }) => uri === "loam://instructions/loam-check")).toBe(true);
    expect(listed.some(({ uri }) => uri === "loam://instructions/loam-check/compact")).toBe(true);

    const read = resultOf(replyOf(request(5, "resources/read", { uri: "loam://orientation" })));
    const contents = read["contents"] as Array<Record<string, unknown>>;
    expect(String(contents[0]!["text"])).toContain("loam instructions");
    const compact = resultOf(replyOf(request(6, "resources/read", {
      uri: "loam://instructions/loam-check/compact",
    })))["contents"] as Array<Record<string, unknown>>;
    expect(String(compact[0]!["text"]).length).toBeLessThan(5_000);
    expect(errorOf(replyOf(request(7, "resources/read", { uri: "loam://missing" }))).code).toBe(INVALID_PARAMS);
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
  it("offers exactly the fourteen read-only commands — no writer is reachable", () => {
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
      "loam_instructions",
      "loam_list",
      "loam_show",
      "loam_status",
      "loam_steps",
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

  it("every base tool is read-only and declares the common envelope output schema", () => {
    // Without this a host has no machine signal that loam_validate or
    // loam_context is safe, so a call that only reads files falls into the same
    // approval path as a mutating tool — which is what excluding the writers
    // from the table was FOR. One shared literal, asserted per tool: a tool
    // that grew its own annotations object is exactly the drift worth failing.
    const result = resultOf(replyOf(request(1, "tools/list")));
    const tools = result["tools"] as Array<Record<string, unknown>>;
    expect(tools.length).toBe(MCP_TOOLS.length);
    for (const tool of tools) {
      const name = String(tool["name"]);
      expect(tool["annotations"], name).toEqual({ readOnlyHint: true, openWorldHint: false });
      const output = tool["outputSchema"] as Record<string, unknown>;
      expect(output["type"], name).toBe("object");
      expect(output["required"], name).toEqual(["contractVersion", "version", "ok"]);
    }
  });

  it("opt-in author tools advertise mutations while archive remains an enforced dry-run", () => {
    const tools = [...MCP_TOOLS, ...MCP_AUTHOR_TOOLS];
    const listed = resultOf((() => {
      const routed = routeLine(JSON.stringify(request(1, "tools/list")), tools);
      if (routed.kind !== "reply") throw new Error("expected a reply");
      return routed.response;
    })())["tools"] as Array<Record<string, unknown>>;
    expect(listed.find(({ name }) => name === "loam_new")?.["annotations"]).toMatchObject({ readOnlyHint: false });
    expect(listed.find(({ name }) => name === "loam_archive_plan")?.["annotations"]).toMatchObject({ readOnlyHint: true });

    const routed = routeLine(JSON.stringify(request(2, "tools/call", {
      name: "loam_archive_plan",
      arguments: { featureId: "FEAT-1" },
    })), tools);
    expect(routed).toEqual({
      kind: "call",
      id: 2,
      toolName: "loam_archive_plan",
      argv: ["archive", "FEAT-1", "--dry-run", "--json"],
    });
    expect(errorOf(replyOf(request(3, "tools/call", { name: "loam_new", arguments: { featureId: "FEAT-1" } }))).code)
      .toBe(INVALID_PARAMS);
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
      ["loam_steps", { service: "svc", duplicates: true }, ["steps", "--service", "svc", "--duplicates", "--json"]],
      // The variadic positional, and the negated boolean. `noFixTables: true`
      // spells `--no-fix-tables`: the JSON property is named for what setting
      // it true DOES, not for commander's `fixTables` attribute, because
      // toArgv spells a true boolean as its flag string and the two names
      // would otherwise mean opposite things.
      ["loam_instructions", { workflow: "loam-implement", args: ["FEAT-101", "payment-service"] },
        ["instructions", "loam-implement", "FEAT-101", "payment-service", "--json"]],
      ["loam_instructions", { workflow: "loam-check", noFixTables: true },
        ["instructions", "loam-check", "--no-fix-tables", "--json"]],
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

  it("unparseable stdout stays verbatim and gains a schema-valid failure envelope", () => {
    const reply = toolReply({ stdout: "not json at all", stderr: "", code: 0 });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect((reply.result["content"] as Array<{ text: string }>)[0]!.text).toBe("not json at all");
    expect(reply.result["structuredContent"]).toMatchObject({
      contractVersion: "1.0",
      version: LOAM_VERSION,
      ok: false,
      error: { code: "internal" },
      raw: "not json at all",
    });
    expect(reply.result["isError"]).toBe(true);
  });

  it("valid non-object JSON takes the same structured failure path", () => {
    const reply = toolReply({ stdout: "[]", stderr: "", code: 0 });
    if (reply.kind !== "result") throw new Error("expected a result");
    expect(reply.result["structuredContent"]).toMatchObject({ ok: false, raw: "[]" });
    expect(reply.result["isError"]).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* The read-only claim, derived                                      */
/* ---------------------------------------------------------------- */

/**
 * The staging modules that PERFORM a commit — take the snapshot, run the
 * transaction, roll a journal forward, restore. Every writing command reaches
 * one of these; no read command reaches any.
 *
 * `src/core/staging/txn/` as a whole is NOT the seam, and the difference is
 * measured rather than assumed: `txn/journal.ts` is a READ as well as a write,
 * and validate, status, doctor and gate all reach it (through
 * core/status/interrupted.ts and core/staging/recovery/) to REPORT an
 * interrupted commit they will not touch. Same for `staging/commit.ts`,
 * `interrupted.ts`, `writes.ts` and `lock.ts` — journal.ts imports the first
 * three, so any of them as the target convicts four honest readers. The four
 * below are the ones a read command never reaches, which is what makes them
 * the seam and not just a list of files.
 */
const COMMIT_EXECUTORS = [
  "src/core/staging/snapshot.ts",
  "src/core/staging/txn/transaction.ts",
  "src/core/staging/txn/forward.ts",
  "src/core/staging/recovery/recover.ts",
] as const;

/**
 * Commands that write, one per shape of writer, used as the guard's NEGATIVE
 * control: a rule nobody has proved CAN fail is an attestation wearing a
 * test's clothes. If a refactor moves the commit seam, this list stops
 * reaching it and the control goes red — instead of the guard silently passing
 * for everything, which is the failure mode of every "must not reach X" check.
 */
const KNOWN_WRITERS = ["vouch", "archive", "unarchive", "new", "seed", "gherkin", "rebase", "subsystem", "verify"] as const;

/**
 * `command` → every module its imports transitively reach, from
 * `scripts/source-graph.mjs` — the same graph `arch:check` collapses to
 * packages and `meta:check` collapses to subjects. Reusing it rather than
 * re-walking imports here is the point of that module: a second copy would
 * exempt `import type` on one side and not the other, and this guard would
 * then convict an edge the architecture gate has already decided is not one.
 */
async function importClosures(): Promise<(command: string) => Set<string>> {
  const { modules, edges } = await moduleEdges(join(import.meta.dirname, ".."));
  const out = new Map<string, string[]>();
  for (const module of modules) out.set(module, []);
  for (const { from, to } of edges) out.get(from)?.push(to);
  return (command: string): Set<string> => {
    // A command is a directory (`src/commands/validate/`) or a single module
    // (`src/commands/explore.ts`); both spellings are live in this repository,
    // so both are roots.
    const roots = modules.filter(
      (module: string) => module === `src/commands/${command}.ts` || module.startsWith(`src/commands/${command}/`),
    );
    const seen = new Set<string>(roots);
    const stack = [...roots];
    while (stack.length > 0) {
      for (const next of out.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  };
}

describe("the read-only claim is derived, not attested", () => {
  it("no served command's import closure reaches a module that performs a commit", async () => {
    // This is what makes `annotations.readOnlyHint: true` a fact about the
    // code rather than a promise in a comment: add a writer to MCP_TOOLS and
    // this goes red, instead of the server shipping a false hint that tells
    // every host it is safe to auto-approve.
    const closureOf = await importClosures();
    for (const tool of MCP_TOOLS) {
      const closure = closureOf(tool.command);
      expect(closure.size, `${tool.name}: no module resolved for src/commands/${tool.command}`).toBeGreaterThan(0);
      for (const executor of COMMIT_EXECUTORS) {
        expect(
          closure.has(executor),
          `${tool.name} reaches ${executor} — a command that can commit must not be an MCP tool`,
        ).toBe(false);
      }
    }
  });

  it("the control: every known writer DOES reach one, so the guard can still fail", async () => {
    const closureOf = await importClosures();
    for (const writer of KNOWN_WRITERS) {
      const closure = closureOf(writer);
      expect(
        COMMIT_EXECUTORS.some((executor) => closure.has(executor)),
        `'${writer}' no longer reaches any commit executor — the seam moved, and the guard above now proves nothing`,
      ).toBe(true);
    }
  });
});

describe("the tool table mirrors the CLI registrations", () => {
  it("is internally consistent: derived names, at most one variadic positional, last", () => {
    const tools = [...MCP_TOOLS, ...MCP_AUTHOR_TOOLS];
    for (const tool of tools) {
      expect(tool.name.startsWith("loam_")).toBe(true);
      if (tool.name !== "loam_archive_plan") expect(tool.name).toBe(`loam_${tool.command}`);
      expect(tool.positionals.filter((p) => p.variadic).length).toBeLessThanOrEqual(1);
      if (tool.positionals.some((p) => p.variadic)) {
        expect(tool.positionals.at(-1)!.variadic).toBe(true);
      }
    }
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
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
    for (const tool of [...MCP_TOOLS, ...MCP_AUTHOR_TOOLS]) {
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
      for (const fixed of tool.fixed ?? []) {
        expect(longs, `${tool.name} enforces ${fixed}, which ${tool.command} does not declare`).toContain(fixed);
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
