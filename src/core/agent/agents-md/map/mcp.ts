/**
 * The `loam mcp` entry of the command map — its own section module for
 * `./lenses/gate.ts`'s exact reason: command-map.ts sits against the 300-line limit,
 * so the MCP facade's documentation lives one package down and is
 * concatenated after the map. It introduces no codes of its own: every tool
 * result is an existing envelope, which is the point of the section.
 *
 * Same assembly contract as every section: ../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 *
 * The command names in the roster below are HAND-LISTED: importing
 * core/mcp/tools.ts from here would close a package cycle (tools.ts reads
 * core/explain/terms.ts, which reads this package's siblings for its pin
 * sources). test/mcp-protocol.test.ts pins this string against MCP_TOOLS
 * instead: a tool added to the table without its name here fails there.
 */
export const MCP_COMMAND = `- \`loam mcp\` serves the read commands — validate, status, list, show, delta,
  diff, explore, dependencies, doctor, context, gate, explain — as MCP tools over stdio
  (JSON-RPC 2.0), for hosts that reach tools through MCP rather than a shell:
  configure the host to launch \`loam mcp\` in the repository the tools should
  answer for. Every tool result carries the same \`--json\` envelope the CLI
  prints, verbatim, so everything above about codes and envelopes applies
  unchanged — branch on \`ok\` and \`error.code\` exactly as you would reading
  the command's stdout. The writing commands are deliberately not exposed
  (\`vouch\` above all: it is a human act, and an MCP caller is an agent);
  run those through the CLI, where the permission flow is yours.
`;
