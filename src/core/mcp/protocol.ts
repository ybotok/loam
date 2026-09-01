/**
 * Pure JSON-RPC 2.0 + MCP routing for `loam mcp` — parse one inbound frame,
 * decide the reply. Computes and returns only: the stream loop, the stdout
 * writes and the dispatcher live in `src/commands/mcp/`, so every decision
 * here is unit-testable without a stream in sight.
 *
 * Spec revision assumed: MCP 2025-06-18 (framing note in `./framing.ts`).
 * The lifecycle is deliberately NOT policed: this server is a stateless
 * facade over a stateless CLI, its capabilities never vary, and refusing a
 * tools/call that arrives before `initialize` would protect nothing — so
 * every request is answered on its own terms, whatever came first. What IS
 * refused: JSON-RPC batch arrays (removed in 2025-06-18; the older revisions
 * this server also negotiates allowed them, and that gap is deliberate — a
 * clear -32600 with the reason beats a half-implemented batch path no real
 * MCP client exercises).
 */
import { isRecord } from "../kernel/records.js";
import { LOAM_VERSION } from "../envelope/version.js";
import { toArgv } from "./argv.js";
import {
  MCP_TOOLS,
  READ_ONLY_ANNOTATIONS,
  toInputSchema,
  toolByName,
  type McpTool,
} from "./tools.js";
import { AGENTS_MD } from "../agent/agents-md.js";
import { PROTOCOLS } from "../agent/protocol.js";
import { withoutFixTables } from "../explain/fix-tables.js";

/** JSON-RPC 2.0 error codes this server emits. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/**
 * Newest first. `initialize` echoes the client's requested version when it is
 * one of these, else answers the newest — the negotiation rule the 2025-06-18
 * lifecycle spec states for servers. All three revisions are identical in
 * everything this facade implements (stdio framing, tools/list, tools/call
 * with text content) except batching, refused above.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const TOOL_OUTPUT_SCHEMA = {
  type: "object",
  required: ["contractVersion", "version", "ok"],
  properties: {
    contractVersion: { const: "1.0" },
    version: { type: "string" },
    ok: { type: "boolean" },
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

const RESOURCE_TEXT: Readonly<Record<string, string>> = {
  "loam://orientation": AGENTS_MD,
  ...Object.fromEntries(
    Object.entries(PROTOCOLS).map(([name, body]) => [`loam://instructions/${name}`, body]),
  ),
  "loam://instructions/loam-check/compact": withoutFixTables(PROTOCOLS["loam-check"]!),
};

/** A response id: echoed from the request, or null when no id could be read (parse errors). */
export type JsonRpcId = string | number;

export interface JsonRpcResponse extends Record<string, unknown> {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
}

export function resultResponse(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * `rpcCode`, not `code`: the stable-code drift collector
 * (test/helpers/stable-codes.ts) treats every function with a parameter named
 * `code` as an emitter of loam's stable code STRINGS and demands a literal at
 * each call site. A JSON-RPC numeric code is a different vocabulary — naming
 * the parameter into that scan would make the guard demand string literals
 * where the protocol requires numbers.
 */
export function errorResponse(id: JsonRpcId | null, rpcCode: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code: rpcCode, message } };
}

/**
 * What one inbound frame asks of the serve loop:
 * - `ignore`: a blank line, or a notification — nothing goes back.
 * - `reply`: answered here, in pure code; write the response.
 * - `call`: a validated tools/call — run `argv` through the dispatcher and
 *   wrap what comes back. The argv is fully built here so the loop never
 *   interprets arguments.
 */
export type RouteOutcome =
  | { readonly kind: "ignore" }
  | { readonly kind: "reply"; readonly response: JsonRpcResponse }
  | { readonly kind: "call"; readonly id: JsonRpcId; readonly toolName: string; readonly argv: readonly string[] };

const reply = (response: JsonRpcResponse): RouteOutcome => ({ kind: "reply", response });

/** One line off the wire → what to do about it. Total: every input maps to an outcome, nothing throws. */
export function routeLine(line: string, tools: readonly McpTool[] = MCP_TOOLS): RouteOutcome {
  if (line.trim() === "") return { kind: "ignore" };
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return reply(errorResponse(null, PARSE_ERROR, `Parse error: ${detail}`));
  }
  if (Array.isArray(message)) {
    // JSON-RPC batching was removed in MCP 2025-06-18; see the module comment
    // for why the older negotiated revisions refuse it too instead of half-supporting it.
    return reply(errorResponse(null, INVALID_REQUEST, "Invalid Request: JSON-RPC batch arrays are not supported"));
  }
  if (!isRecord(message)) {
    return reply(errorResponse(null, INVALID_REQUEST, "Invalid Request: a message must be a JSON object"));
  }
  const rawId = message["id"];
  // Three id states, kept apart because they demand opposite answers. ABSENT
  // (or an explicit null, reserved for unanswerable errors) is a notification.
  // A PRESENT id that is not a string or a finite number — an object, a bool,
  // an array, a JSON `1e999` that parsed to Infinity — is a malformed REQUEST:
  // the client is waiting on a reply, and folding it into the notification
  // branch answers with silence, which for a request is a hang, not an error.
  const validId = typeof rawId === "string" || (typeof rawId === "number" && Number.isFinite(rawId)) ? rawId : null;
  if (message["jsonrpc"] !== "2.0") {
    return reply(errorResponse(validId, INVALID_REQUEST, "Invalid Request: jsonrpc must be the string \"2.0\""));
  }
  const method = message["method"];
  if (typeof method !== "string") {
    return reply(errorResponse(validId, INVALID_REQUEST, "Invalid Request: method must be a string"));
  }
  if (!("id" in message) || rawId === null) return { kind: "ignore" };
  if (validId === null) {
    // id null in the response: the request's own id is unusable, and null is
    // exactly the id JSON-RPC reserves for that answer.
    return reply(errorResponse(null, INVALID_REQUEST, "Invalid Request: id must be a string or a finite number"));
  }
  return routeRequest(validId, method, message["params"], tools);
}

function routeRequest(
  id: JsonRpcId,
  method: string,
  params: unknown,
  tools: readonly McpTool[],
): RouteOutcome {
  switch (method) {
    case "initialize":
      return reply(resultResponse(id, initializeResult(params)));
    case "ping":
      return reply(resultResponse(id, {}));
    case "tools/list":
      // No pagination: the whole tool table fits in one page, so `nextCursor`
      // is omitted rather than emitted empty — the spec reads an absent
      // cursor as "done".
      return reply(resultResponse(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: toInputSchema(tool),
          outputSchema: TOOL_OUTPUT_SCHEMA,
          // Base tools share the read-only default; opt-in authoring tools
          // carry their own mutation annotations in author-tools.ts.
          annotations: tool.annotations ?? READ_ONLY_ANNOTATIONS,
        })),
      }));
    case "resources/list":
      return reply(resultResponse(id, {
        resources: Object.keys(RESOURCE_TEXT).map((uri) => ({
          uri,
          name: uri === "loam://orientation" ? "loam orientation" : uri.slice("loam://instructions/".length),
          description:
            uri === "loam://orientation"
              ? "Small always-loaded map of a loam repository"
              : "Version-matched loam workflow, support protocol or reference page",
          mimeType: "text/markdown",
        })),
      }));
    case "resources/read":
      return routeResourceRead(id, params);
    case "tools/call":
      return routeToolCall(id, params, tools);
    default:
      // Everything else — including a literal `shutdown`, which is LSP's
      // lifecycle and not MCP's (the MCP stdio lifecycle ends at stdin EOF).
      return reply(errorResponse(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
  }
}

function routeResourceRead(id: JsonRpcId, params: unknown): RouteOutcome {
  if (!isRecord(params) || typeof params["uri"] !== "string") {
    return reply(errorResponse(id, INVALID_PARAMS, "resources/read requires params.uri"));
  }
  const uri = params["uri"];
  const text = RESOURCE_TEXT[uri];
  if (text === undefined) {
    return reply(errorResponse(id, INVALID_PARAMS, `Unknown resource '${uri}'`));
  }
  return reply(resultResponse(id, { contents: [{ uri, mimeType: "text/markdown", text }] }));
}

function routeToolCall(
  id: JsonRpcId,
  params: unknown,
  tools: readonly McpTool[],
): RouteOutcome {
  if (!isRecord(params) || typeof params["name"] !== "string") {
    return reply(errorResponse(id, INVALID_PARAMS, "tools/call requires params.name naming a tool"));
  }
  const tool = toolByName(params["name"], tools);
  if (tool === undefined) {
    const names = tools.map((t) => t.name).join(", ");
    return reply(errorResponse(id, INVALID_PARAMS, `Unknown tool '${params["name"]}' — this server offers: ${names}`));
  }
  const rawArgs = params["arguments"] ?? {};
  if (!isRecord(rawArgs)) {
    return reply(errorResponse(id, INVALID_PARAMS, "tools/call params.arguments must be an object when present"));
  }
  const built = toArgv(tool, rawArgs);
  if (!built.ok) return reply(errorResponse(id, INVALID_PARAMS, built.problem));
  return { kind: "call", id, toolName: tool.name, argv: built.argv };
}

/**
 * The `initialize` result. The version rule: echo the requested revision when
 * this server supports it, otherwise answer the newest it does — the client
 * then decides whether it can live with that (2025-06-18 lifecycle,
 * "Version Negotiation").
 */
export function initializeResult(params: unknown): Record<string, unknown> {
  const requested = isRecord(params) ? params["protocolVersion"] : undefined;
  const negotiated =
    typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion: negotiated,
    capabilities: {
      // The sets never change while the server lives, so no
      // listChanged notification is declared — announcing one and never
      // sending it would be a promise, not a capability.
      tools: {},
      resources: {},
    },
    serverInfo: { name: "loam", version: LOAM_VERSION },
    instructions:
      "Every tool result is a loam --json envelope (contractVersion 1.0): branch on ok, " +
      "and on error.code when ok is false — the same machine contract the CLI prints.",
  };
}

/** What the dispatcher hands back from one tool call, before it becomes a protocol reply. */
export interface ToolRunOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type ToolReply =
  | { readonly kind: "result"; readonly result: Record<string, unknown> }
  | { readonly kind: "error"; readonly code: number; readonly message: string };

/**
 * One tool run wrapped as an MCP tool result. The envelope rides VERBATIM in
 * content[0].text — one machine contract, not two — and again parsed as
 * structuredContent for clients that read that field.
 *
 * `isError` follows the ENVELOPE's `ok`, and the exit code only when no
 * envelope could be parsed. The two disagree on purpose for half the tool
 * set: validate, doctor, gate, context and delta all have graded answers
 * that exit 1 while reporting `ok: true` — an invalid fleet, a blocked
 * doctor, a `verdict: "fail"` deploy gate. Those exits are CI levers, not
 * call failures, and an MCP host renders `isError: true` as "the call
 * failed" and may discard structuredContent — which for loam_gate would
 * discard the exact verdict the caller asked for. `ok: false` is the one
 * signal that means "loam refused to answer", so it is the one isError
 * mirrors; the exit-code fallback exists only for stdout that parsed as no
 * envelope at all.
 *
 * An EMPTY stdout is a protocol error, not a quiet result: with `--json` on
 * every argv, a command that printed no envelope is a command whose answer
 * was lost, and "nobody could look" must stay distinguishable from any
 * genuine envelope — even a refusing one.
 */
export function toolReply(run: ToolRunOutcome): ToolReply {
  if (run.stdout.trim() === "") {
    const hint = run.stderr.trim() === "" ? "" : ` stderr: ${run.stderr.trim()}`;
    return {
      kind: "error",
      code: INTERNAL_ERROR,
      message: `the command exited ${run.code} without printing a --json envelope, so there is no result to return.${hint}`,
    };
  }
  let structured: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    // structuredContent must be an object; the envelope always is.
    structured = isRecord(parsed) ? parsed : undefined;
  } catch {
    // The fallback below handles both invalid JSON and valid non-object JSON.
  }
  if (structured === undefined) {
    // Preserve the bytes in content, but keep the declared output contract:
    // an MCP client should never have to branch on the absence of
    // structuredContent after tools/list promised a schema.
    structured = {
      contractVersion: "1.0",
      version: LOAM_VERSION,
      ok: false,
      error: {
        code: "internal",
        message: "the command did not print a JSON object envelope",
      },
      raw: run.stdout,
    };
  }
  const envelopeOk = structured?.["ok"];
  return {
    kind: "result",
    result: {
      content: [{ type: "text", text: run.stdout }],
      structuredContent: structured,
      isError: typeof envelopeOk === "boolean" ? !envelopeOk : run.code !== 0,
    },
  };
}
