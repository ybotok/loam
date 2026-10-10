/**
 * `loam mcp` — serve the read surface, plus bounded writers under `--author`.
 *
 * The action wires the real stdio triple into the serve loop and waits for
 * stdin EOF; everything with a decision in it lives in `./serve.ts`,
 * `./dispatch.ts` and `src/core/mcp/`. This module carries the one command
 * registration of the package (test/agents.test.ts counts registrations by
 * their literal spelling, so the sibling modules must never spell one).
 */
import type { Command } from "commander";
import { toolRunner } from "./dispatch.js";
import { serve } from "./serve.js";
import { MCP_TOOLS } from "../../core/mcp/tools.js";
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
      const tools = opts.author ? [...MCP_TOOLS, ...MCP_AUTHOR_TOOLS] : MCP_TOOLS;
      const run = toolRunner(tools);
      await serve({ input: process.stdin, output: process.stdout, log: process.stderr }, run, tools);
    });
}
