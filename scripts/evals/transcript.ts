/**
 * One headless run's transcript, reduced to what a grader reads: the tool calls
 * in order, the final text, and what the run cost.
 *
 * Read from `claude -p --output-format stream-json --verbose` — one JSON event
 * per line. A tool call is a `tool_use` content block inside an `assistant`
 * event; the closing `result` event carries the final text, the turn count and
 * the cost. Anything else on the stream (system init, tool results, partial
 * messages) is not graded and is skipped, and so is a line that does not parse:
 * a transcript is evidence, and one torn line must not lose the rest of it.
 */

/** One tool call, as the model made it. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** What a grader reads of one run. */
export interface Transcript {
  calls: ToolCall[];
  /** The final assistant text, from the `result` event; "" when the run never closed. */
  final: string;
  /** False when the run ended in an error, hit its turn cap, or never closed. */
  completed: boolean;
  turns: number | null;
  costUsd: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Parse a stream-json transcript. Total: every input yields a transcript. */
export function parseTranscript(text: string): Transcript {
  const out: Transcript = { calls: [], final: "", completed: false, turns: null, costUsd: null };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let event: Record<string, unknown> | null;
    try {
      event = record(JSON.parse(line));
    } catch {
      continue;
    }
    if (event === null) continue;
    if (event["type"] === "assistant") {
      const content = record(event["message"])?.["content"];
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = record(block);
        if (b?.["type"] !== "tool_use" || typeof b["name"] !== "string") continue;
        out.calls.push({ name: b["name"], input: record(b["input"]) ?? {} });
      }
    } else if (event["type"] === "result") {
      out.final = typeof event["result"] === "string" ? event["result"] : "";
      out.completed = event["subtype"] === "success" && event["is_error"] !== true;
      out.turns = typeof event["num_turns"] === "number" ? event["num_turns"] : null;
      out.costUsd = typeof event["total_cost_usd"] === "number" ? event["total_cost_usd"] : null;
    }
  }
  return out;
}

/** The shell command a Bash call ran, or null for any other tool. */
export function bashCommand(call: ToolCall): string | null {
  return call.name === "Bash" && typeof call.input["command"] === "string" ? call.input["command"] : null;
}

/** The file a file-writing tool targeted, or null for a call that writes no file. */
export function writtenFile(call: ToolCall): string | null {
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(call.name)) return null;
  const path = call.input["file_path"] ?? call.input["notebook_path"];
  return typeof path === "string" ? path : null;
}

/** The skill a Skill call loaded, or null. */
export function skillLoaded(call: ToolCall): string | null {
  if (call.name !== "Skill") return null;
  const skill = call.input["skill"] ?? call.input["command"] ?? call.input["name"];
  return typeof skill === "string" ? skill.replace(/^\//, "") : null;
}
