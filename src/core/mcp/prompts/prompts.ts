/**
 * What an MCP host learns before it calls anything: the server's
 * `instructions`, and the workflows as prompts (`prompts/list`,
 * `prompts/get`).
 *
 * Both exist for the hosts with no shell — Claude Desktop, claude.ai, ChatGPT
 * — which reach loam only through this server. They could read every protocol
 * as a resource, but a resource is something a host attaches, not something a
 * user starts: no `/loam-feature` appeared anywhere, and a client that asked
 * for `prompts/list` was told `-32601`. And with tool search on by default, a
 * host loads tool NAMES up front and little else, so `instructions` was the one
 * paragraph a model read before choosing a tool — and it said only how to read
 * an envelope.
 *
 * A prompt is the same page `loam instructions` prints, from the same
 * `PROTOCOLS` the resources are built from, so the three deliveries cannot
 * disagree about what a workflow says.
 */
import { AGENT_COMMANDS, placeholderProblems, protocolFor } from "../../agent/protocol.js";
import { ARGUMENTS } from "../../agent/tools/arguments.js";
import { QUOTED_TEXT_RULE } from "../../envelope/quoted.js";
import { printedPage } from "../../explain/fix-tables.js";
import { isRecord } from "../../kernel/records.js";

/**
 * The `instructions` string `initialize` returns. Hosts cap it — 4,096
 * characters is the common limit, and test/mcp-protocol.test.ts holds it under
 * that — so it says what loam answers and where to start, and leaves the rest
 * to the pages it names.
 */
export const SERVER_INSTRUCTIONS =
  "loam keeps a fleet's architecture (a LikeC4 C4 model), requirements, and API and event contracts as " +
  "plain files in a docs repository, and checks that they agree: each relationship's operation exists in " +
  "the target's OpenAPI or AsyncAPI, each operation is governed by a requirement, each requirement has " +
  "scenarios. It never reads service code and reaches no network.\n\n" +
  "Start with loam_status: its next[] is the ordered work queue, each entry a code and the literal command. " +
  "loam_show describes one service or feature, loam_context assembles one service's whole slice, and " +
  "loam_validate grades a target. Findings carry stable codes: branch on the code, never on the prose, and " +
  "ask loam_explain about any code you do not know.\n\n" +
  "Who calls an operation, before you change or remove it: loam_explore with op set to its operationId. " +
  "What a change would touch: loam_explore with the services it starts from.\n\n" +
  "The workflows are prompts here, and pages from loam_instructions: loam-adopt, loam-feature, " +
  "loam-implement, loam-check, loam-verify, loam-ship, and loam-report for a run that went wrong. Read the " +
  "one you are following before acting on it. loam-check comes without its per-code fix tables; " +
  "loam_explain answers a reported code on its own.\n\n" +
  "Every tool result is a loam --json envelope (contractVersion 1.0): branch on ok, and on error.code when " +
  "ok is false — the same machine contract the CLI prints. The tools only read, unless the server was " +
  "started with --author; loam vouch is a person's act and is never offered here.\n\n" +
  // Tool results quote the docs repo verbatim — intent, requirement bodies,
  // scenarios — and a host with no shell may never load a protocol page, so
  // this paragraph is the one place it is sure to read the fence
  // (envelope/quoted.ts).
  QUOTED_TEXT_RULE;

/**
 * The `prompts/list` entries: one per generated workflow, in cycle order, with
 * the support protocol last — the set `loam init` writes command files for.
 *
 * Every argument is optional, and that is the protocols' own rule rather than a
 * shortcut: an unsupplied placeholder is left standing in the page, which then
 * reads as "the feature id goes here" (see `protocolFor`).
 */
export function listPrompts(): Array<Record<string, unknown>> {
  return AGENT_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    // The names Claude Code's `$feature` and Copilot's `${input:feature}` use too.
    arguments: c.placeholders.map((kind) => {
      const { name, description } = ARGUMENTS[kind];
      return { name, description, required: false };
    }),
  }));
}

/** A `prompts/get` answer, or why the request cannot have one. */
export type PromptOutcome =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | { readonly ok: false; readonly problem: string };

/**
 * One workflow as a prompt: the page `loam instructions <name> <args…>` prints
 * — narrow for loam-check, as on the command line — as a single user message.
 *
 * The arguments are checked the way the command checks them
 * (`placeholderProblems`), so a prompt cannot render a page around a value no
 * loam command accepts, and a name the prompt does not declare is refused
 * rather than dropped: a misspelled `servce` would otherwise leave the
 * placeholder standing and the caller none the wiser.
 */
export function getPrompt(params: unknown): PromptOutcome {
  if (!isRecord(params) || typeof params["name"] !== "string") {
    return { ok: false, problem: "prompts/get requires params.name naming a prompt" };
  }
  const name = params["name"];
  const command = AGENT_COMMANDS.find((c) => c.name === name);
  if (command === undefined) {
    return { ok: false, problem: `Unknown prompt '${name}' — this server offers: ${AGENT_COMMANDS.map((c) => c.name).join(", ")}` };
  }
  const given = params["arguments"] ?? {};
  if (!isRecord(given)) return { ok: false, problem: "prompts/get params.arguments must be an object when present" };
  const names = command.placeholders.map((kind) => ARGUMENTS[kind].name);
  for (const [key, value] of Object.entries(given)) {
    if (!names.includes(key)) {
      return { ok: false, problem: `Prompt '${name}' takes ${names.length === 0 ? "no arguments" : names.join(", ")}, not '${key}'` };
    }
    if (typeof value !== "string") return { ok: false, problem: `Argument '${key}' must be a string` };
  }
  const args = names.map((key) => (given[key] as string | undefined) ?? "");
  const problems = placeholderProblems(name, args);
  if (problems !== null) return { ok: false, problem: problems.join(" ") };
  const text = printedPage(name, protocolFor(name, args)!, undefined);
  return {
    ok: true,
    result: {
      description: command.description,
      messages: [{ role: "user", content: { type: "text", text } }],
    },
  };
}
