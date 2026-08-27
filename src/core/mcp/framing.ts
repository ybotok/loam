/**
 * MCP stdio framing — the ONE module that knows how protocol messages are
 * delimited on the wire.
 *
 * Assumed spec revision: 2025-06-18 (unchanged on this point since
 * 2024-11-05): the MCP stdio transport is newline-delimited JSON-RPC — one
 * UTF-8 encoded message per line, and messages MUST NOT contain embedded
 * newlines. It is NOT LSP's Content-Length header framing, which this facade
 * was once at risk of assuming because both protocols are JSON-RPC over
 * stdio. If a framing correction is ever needed, it is a change to this
 * module alone: the serve loop consumes `splitFrames`/`frame` and never
 * touches delimiter bytes itself.
 */

export interface FrameSplit {
  /** Complete frames, in arrival order, each with its delimiter (and any trailing CR) removed. */
  readonly lines: readonly string[];
  /** The bytes after the last delimiter — a frame still arriving. Feed it back in front of the next chunk. */
  readonly rest: string;
}

/**
 * Split buffered input into complete frames plus the unterminated tail.
 * Stateless on purpose: the caller owns `rest` as a local, so no state can
 * leak between serve sessions the way module-level buffering would.
 */
export function splitFrames(buffered: string): FrameSplit {
  const parts = buffered.split("\n");
  // split() never returns an empty array, so pop() always yields a string —
  // the text after the final "\n", which is "" when the chunk ended on one.
  const rest = parts.pop() ?? "";
  return { lines: parts.map(bareFrame), rest };
}

/**
 * One frame stripped of transport debris: a trailing CR (Windows clients end
 * lines with \r\n, and the frame is the JSON text, not the carriage return)
 * and a leading U+FEFF. The BOM case was observed, not imagined: PowerShell's
 * pipeline encoder prepends one when it feeds a native process, so a Windows
 * client's very first `initialize` died with -32700 while every later frame
 * worked. A BOM can never begin valid JSON, so stripping it drops no message.
 */
function bareFrame(line: string): string {
  const noBom = line.startsWith("﻿") ? line.slice(1) : line;
  return noBom.endsWith("\r") ? noBom.slice(0, -1) : noBom;
}

/**
 * One outbound frame. JSON.stringify escapes every newline inside string
 * values, so the serialized form of a message object can never contain the
 * delimiter — which is the invariant the transport rests on.
 */
export function frame(message: Record<string, unknown>): string {
  return JSON.stringify(message) + "\n";
}
