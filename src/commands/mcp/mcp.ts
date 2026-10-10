/**
 * `loam mcp` — serve the read surface, plus bounded writers under `--author`.
 *
 * The action asks `mcpToolTable` which table its flag selects and hands it,
 * with the real stdio triple, to `startMcp`, which resolves the table once and
 * serves it until stdin EOF; everything else with a decision in it lives in
 * `./serve.ts`, `./dispatch.ts` and `src/core/mcp/`. This module carries the
 * one command registration of the package (test/agents.test.ts counts
 * registrations by their literal spelling, so the sibling modules must never
 * spell one).
 */
import type { Command } from "commander";
import { toolRunner } from "./dispatch.js";
import { serve, type ServeIo } from "./serve.js";
import { MCP_TOOLS, type McpTool } from "../../core/mcp/tools.js";
import { MCP_AUTHOR_TOOLS } from "../../core/mcp/author-tools.js";

interface McpOptions {
  author?: boolean;
}

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Serve loam commands as MCP tools over stdio (JSON-RPC 2.0)")
    .option("--author", "opt in to safe authoring tools; vouch and committing archive stay excluded")
    // Declared for the uniform surface every command owes (`--json` is
    // mandatory, test/agents.test.ts), and it is not inert: it governs the one
    // pre-loop surface this command has — a usage error like `loam mcp --bogus`
    // aborts before the action runs, and cli.ts's catch reads raw argv to
    // decide whether that refusal is an envelope. Once the loop runs, stdout
    // is JSON-RPC frames either way; there is no human rendering to switch off.
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: McpOptions) => {
      await startMcp(mcpToolTable(opts.author === true), {
        input: process.stdin,
        output: process.stdout,
        log: process.stderr,
      });
    });
}

/**
 * The table `loam mcp` serves: the read surface, and the bounded writers after
 * it only when the server was launched with `--author`.
 *
 * A function of its own, exported, because nothing pinned it inline. The
 * in-process tests hand `startMcp` a table directly and the stdio smoke
 * spawned `loam mcp` only without the flag, so this choice written as
 * `MCP_TOOLS` alone left every test green — while every config `loam init
 * --mcp-author` writes launches `loam mcp --author`, and those hosts would
 * have lost the authoring tools without a word. test/mcp-serve.test.ts holds
 * both values here; test/mcp-stdio.test.ts spawns `loam mcp --author` and holds
 * the flag to it.
 */
export function mcpToolTable(author: boolean): readonly McpTool[] {
  return author ? [...MCP_TOOLS, ...MCP_AUTHOR_TOOLS] : MCP_TOOLS;
}

/**
 * The action's body: serve `tools` on `io` until its input ends — or refuse
 * before the first byte when the table itself is defective.
 *
 * Exported, with the stdio triple injected, so the startup refusal is pinned
 * WHERE it happens. A test of `toolRunner` alone could not see the wiring
 * here: rewritten as `(argv) => toolRunner(tools)(argv)`, every call would
 * build its own runner, the refusal would move back to every `tools/call`, and
 * a test that only called `toolRunner` would still pass.
 */
export function startMcp(tools: readonly McpTool[], io: ServeIo): Promise<void> {
  // No docs-repo gate at startup, deliberately (the add-command preamble
  // decision): a launch-time refusal would print a non-JSON-RPC line into
  // the client's protocol stream and kill the handshake with nothing a
  // client can parse. Every tool call flows through the same command path
  // the CLI uses, so a missing or broken loam.json arrives as the ordinary
  // `no-config`/`config-invalid` envelope in a tool result — readable, and
  // actionable, by the agent on the other end. The server serves the
  // repository it was started in (each call resolves loam.json through
  // process.cwd()) and never changes directory.
  // One table decides both what `tools/list` advertises and which commands
  // a `tools/call` can reach (`./dispatch.ts`'s `toolRunner`).
  //
  // `toolRunner` is the ONE launch-time refusal, and it is not the gate the
  // paragraph above declines: it throws only when the table itself names a
  // command with no registrar — a defect in the shipped binary that no
  // repository state causes and no client can repair. Refusing here, before
  // the first frame, costs the handshake; answering it per call instead
  // turned every `tools/call` into an `internal` envelope, the correctly
  // wired tools included. Without `--json` (how a client launches it) the
  // message goes to stderr through cli.ts's catch, and stdout stays empty.
  const run = toolRunner(tools);
  return serve(io, run, tools);
}
