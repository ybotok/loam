/**
 * `loam mcp` — serve the read-only commands as MCP tools over stdio.
 *
 * The action wires the real stdio triple into the serve loop and waits for
 * stdin EOF; everything with a decision in it lives in `./serve.ts`,
 * `./dispatch.ts` and `src/core/mcp/`. This module carries the one command
 * registration of the package (test/agents.test.ts counts registrations by
 * their literal spelling, so the sibling modules must never spell one).
 */
import type { Command } from "commander";
import { runToolArgv } from "./dispatch.js";
import { serve } from "./serve.js";

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Serve the read-only commands as MCP tools over stdio (JSON-RPC 2.0)")
    // Declared for the uniform surface every command owes (`--json` is
    // mandatory, test/agents.test.ts), and it is not inert: it governs the one
    // pre-loop surface this command has — a usage error like `loam mcp --bogus`
    // aborts before the action runs, and cli.ts's catch reads raw argv to
    // decide whether that refusal is an envelope. Once the loop runs, stdout
    // is JSON-RPC frames either way; there is no human rendering to switch off.
    .option("--json", "emit the machine contract instead of the human view")
    .action(async () => {
      // No docs-repo gate at startup, deliberately (the add-command preamble
      // decision): a launch-time refusal would print a non-JSON-RPC line into
      // the client's protocol stream and kill the handshake with nothing a
      // client can parse. Every tool call flows through the same command path
      // the CLI uses, so a missing or broken loam.json arrives as the ordinary
      // `no-config`/`config-invalid` envelope in a tool result — readable, and
      // actionable, by the agent on the other end. The server serves the
      // repository it was started in (each call resolves loam.json through
      // process.cwd()) and never changes directory.
      await serve({ input: process.stdin, output: process.stdout, log: process.stderr }, runToolArgv);
    });
}
