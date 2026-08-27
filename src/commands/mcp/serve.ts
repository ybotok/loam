/**
 * The MCP stdio loop: read newline-delimited JSON-RPC frames from `input`,
 * answer on `output`, log on `log`. Streams are injected so the tests drive
 * a whole session in-process with PassThrough pairs; `loam mcp` passes the
 * real stdio triple.
 *
 * Two invariants everything else leans on:
 *
 * - `output` carries protocol frames and NOTHING else — every byte goes
 *   through `frame()`. Command output cannot leak here: the dispatcher hooks
 *   console and commander's own writers, and no command in src/ writes to
 *   process.stdout directly (verified at implementation time; the dispatcher
 *   comment records the guarantee it needs). Logging — the startup line, a
 *   tool's captured stderr — goes to `log`, which MCP permits.
 *
 * - Frames are handled STRICTLY SEQUENTIALLY: each one is awaited before the
 *   next is looked at. This is not an optimization opportunity — the
 *   dispatcher's console capture is process-global, so two overlapping calls
 *   would interleave their captured output into each other's envelopes.
 *
 * The loop ends when `input` ends: per the MCP stdio lifecycle the client
 * closes stdin to shut the server down, so EOF resolves this promise, the
 * action resolves, and cli.ts — the only process-exit decider — lets the
 * process drain to exit 0. No signal handling, no exit call here.
 */
import type { Readable, Writable } from "node:stream";
import { frame, splitFrames } from "../../core/mcp/framing.js";
import {
  INTERNAL_ERROR,
  errorResponse,
  resultResponse,
  routeLine,
  toolReply,
} from "../../core/mcp/protocol.js";
import type { RouteOutcome } from "../../core/mcp/protocol.js";
import type { DispatchResult } from "./dispatch.js";

export interface ServeIo {
  readonly input: Readable;
  readonly output: Writable;
  readonly log: Writable;
}

/** The dispatcher, as a parameter: serve() stays testable with a stub and owns no registration. */
export type ToolRunner = (argv: readonly string[]) => Promise<DispatchResult>;

export async function serve(io: ServeIo, runTool: ToolRunner): Promise<void> {
  // One startup line, to stderr only — a client is entitled to a stdout that
  // has never carried anything but frames, from the very first byte.
  io.log.write(`loam mcp: serving ${process.cwd()} over stdio\n`);
  // Decode at the stream, not per chunk: a UTF-8 code point split across two
  // chunks would corrupt if each chunk were stringified on its own.
  io.input.setEncoding("utf8");
  let rest = "";
  for await (const chunk of io.input) {
    const split = splitFrames(rest + String(chunk));
    rest = split.rest;
    for (const line of split.lines) await handleLine(line, io, runTool);
  }
  // A final frame the client sent without a trailing newline is still a frame:
  // EOF terminates it exactly as the delimiter would have.
  if (rest.trim() !== "") await handleLine(rest, io, runTool);
}

async function handleLine(line: string, io: ServeIo, runTool: ToolRunner): Promise<void> {
  const outcome: RouteOutcome = routeLine(line);
  if (outcome.kind === "ignore") return;
  if (outcome.kind === "reply") {
    io.output.write(frame(outcome.response));
    return;
  }
  await handleCall(outcome, io, runTool);
}

/** One tools/call, contained: whatever this call does, the loop survives it. */
async function handleCall(
  call: Extract<RouteOutcome, { kind: "call" }>,
  io: ServeIo,
  runTool: ToolRunner,
): Promise<void> {
  try {
    const run = await runTool(call.argv);
    if (run.stderr.trim() !== "") {
      // A command's diagnostics are server-side logging, never protocol bytes.
      io.log.write(`loam mcp: ${call.toolName} stderr: ${run.stderr.trim()}\n`);
    }
    const reply = toolReply(run);
    io.output.write(frame(
      reply.kind === "result"
        ? resultResponse(call.id, reply.result)
        : errorResponse(call.id, reply.code, reply.message),
    ));
  } catch (err) {
    // The dispatcher already converts everything it can into an envelope, so
    // reaching here means the failure was outside it (or in the wrapping
    // itself). It becomes a JSON-RPC error for THIS id — the caller learns
    // which call died, with the reason — and the loop reads the next frame.
    const detail = err instanceof Error ? err.message : String(err);
    io.output.write(frame(errorResponse(call.id, INTERNAL_ERROR, `${call.toolName} failed: ${detail}`)));
  }
}
