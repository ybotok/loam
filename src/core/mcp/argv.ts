/**
 * How one MCP tool call's JSON arguments become an argv the CLI already
 * trusts — the boundary where an argument value could otherwise smuggle a
 * flag. The tool TABLE (what the tools are) lives in `./tools.ts`; this
 * module owns the crossing.
 */
import type { McpTool } from "./tools.js";

/** One checked step of argv construction: the tokens it yields, or the invalid-params problem. */
type Checked =
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false; readonly problem: string };

export type ArgvOutcome =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/**
 * A string value that argv would read as a flag is refused before any command
 * sees it: {"target": "--type"} must not become a parsed option. Commander
 * cannot make this distinction after the fact — by then the token IS a flag —
 * so the boundary is here, on every string that crosses, array members
 * included. No shell is ever involved, so this is the only smuggling path.
 */
function smuggled(property: string, value: string): string | null {
  return value.startsWith("-")
    ? `argument '${property}' value '${value}' begins with '-' — a value argv would read as a flag is refused`
    : null;
}

/** One string value checked for type and smuggling. */
function checkedString(property: string, value: unknown): Checked {
  if (typeof value !== "string") return { ok: false, problem: `argument '${property}' must be a string` };
  const bad = smuggled(property, value);
  return bad === null ? { ok: true, tokens: [value] } : { ok: false, problem: bad };
}

/** An array value checked member by member — rebuilt, not cast, so the claim is earned. */
function checkedStrings(property: string, value: unknown): Checked {
  if (!Array.isArray(value)) return { ok: false, problem: `argument '${property}' must be an array of strings` };
  const tokens: string[] = [];
  for (const entry of value) {
    const checked = checkedString(property, entry);
    if (!checked.ok) return checked;
    tokens.push(...checked.tokens);
  }
  return { ok: true, tokens };
}

function positionalTokens(tool: McpTool, args: Record<string, unknown>): Checked {
  const tokens: string[] = [];
  for (const positional of tool.positionals) {
    const value = args[positional.property];
    if (value === undefined) {
      if (positional.required) return { ok: false, problem: `required argument '${positional.property}' is missing` };
      continue;
    }
    const checked = positional.variadic
      ? checkedStrings(positional.property, value)
      : checkedString(positional.property, value);
    if (!checked.ok) return checked;
    tokens.push(...checked.tokens);
  }
  return { ok: true, tokens };
}

function flagTokens(tool: McpTool, args: Record<string, unknown>): Checked {
  const tokens: string[] = [];
  for (const flag of tool.flags) {
    const value = args[flag.property];
    if (value === undefined) {
      // The same refusal absent required positionals get: the client learns
      // "-32602 missing argument", not an invalid-option envelope after the
      // command already refused.
      if (flag.required === true) return { ok: false, problem: `required argument '${flag.property}' is missing` };
      continue;
    }
    if (flag.kind === "boolean") {
      if (typeof value !== "boolean") return { ok: false, problem: `argument '${flag.property}' must be a boolean` };
      if (value) tokens.push(flag.flag);
      continue;
    }
    const checked = flag.kind === "strings"
      ? checkedStrings(flag.property, value)
      : checkedString(flag.property, value);
    if (!checked.ok) return checked;
    // A repeatable flag repeats per value; a single-valued one appears once.
    for (const token of checked.tokens) tokens.push(flag.flag, token);
  }
  return { ok: true, tokens };
}

/**
 * The argv for one tool call — or the invalid-params problem that stops it.
 * `--json` is always appended: the envelope is the tool-result contract, and
 * a client cannot opt out of it into the human rendering. Unknown argument
 * names refuse rather than vanish — the schema says additionalProperties
 * false, and a server that enforced that only in the schema would silently
 * drop the typo'd argument of any client that skipped validation.
 */
export function toArgv(tool: McpTool, args: Record<string, unknown>): ArgvOutcome {
  const known = new Set([
    ...tool.positionals.map((p) => p.property),
    ...tool.flags.map((f) => f.property),
  ]);
  for (const property of Object.keys(args)) {
    if (!known.has(property)) {
      const allowed = known.size === 0 ? "no arguments" : [...known].join(", ");
      return { ok: false, problem: `unknown argument '${property}' for ${tool.name} — expected ${allowed}` };
    }
  }
  const positionals = positionalTokens(tool, args);
  if (!positionals.ok) return { ok: false, problem: positionals.problem };
  const flags = flagTokens(tool, args);
  if (!flags.ok) return { ok: false, problem: flags.problem };
  return {
    ok: true,
    argv: [tool.command, ...positionals.tokens, ...flags.tokens, ...(tool.fixed ?? []), "--json"],
  };
}
