/**
 * How one MCP tool call's JSON arguments become an argv the CLI already
 * trusts — the boundary where an argument value could otherwise smuggle a
 * flag. The tool TABLE (what the tools are) lives in `./tools.ts`; this
 * module owns the crossing, and the inputSchema that declares it: the schema
 * a client validates against and the argv builder that refuses what it
 * forbids are one contract written twice, so they sit in one module.
 *
 * The SHAPE of a table entry lives here too, for the same reason one step
 * back: every field of it — a positional's order, a flag's `kind`, `required`
 * — is a statement about how the call crosses, and this module is the one
 * that reads each of them. The table only fills the shape in.
 */

/** A positional argument, in declaration order. A variadic one is always last. */
export interface ToolPositional {
  readonly property: string;
  readonly required: boolean;
  /** True when the JSON argument is an array of strings spread as trailing positionals. */
  readonly variadic: boolean;
  readonly description: string;
}

/** One CLI flag: `kind` decides both the JSON Schema type and the argv shape. */
export interface ToolFlag {
  readonly property: string;
  readonly flag: string;
  readonly kind: "string" | "boolean" | "strings";
  /**
   * Set when the CLI declares the option with `requiredOption` — the schema
   * then requires the property and the argv builder refuses its absence, so
   * a client learns the requirement from the schema instead of from an
   * invalid-option envelope after the call. The shape test asserts this
   * mirrors commander's own `mandatory`, both ways.
   */
  readonly required?: true;
  readonly description: string;
}

export interface McpTool {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly positionals: readonly ToolPositional[];
  readonly flags: readonly ToolFlag[];
  /** Arguments enforced by the server rather than exposed to the caller. */
  readonly fixed?: readonly string[];
  readonly annotations?: Readonly<Record<string, boolean>>;
}


/**
 * The MCP inputSchema for one tool: a closed object, so a typo'd argument
 * refuses instead of vanishing, with the required set and the positional order
 * `toArgv` enforces declared beside it.
 */
export function toInputSchema(tool: McpTool): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const positional of tool.positionals) {
    properties[positional.property] = positional.variadic
      ? { type: "array", items: { type: "string" }, description: positional.description }
      : { type: "string", description: positional.description };
  }
  for (const flag of tool.flags) {
    properties[flag.property] =
      flag.kind === "boolean"
        ? { type: "boolean", description: flag.description }
        : flag.kind === "strings"
          ? { type: "array", items: { type: "string" }, description: flag.description }
          : { type: "string", description: flag.description };
  }
  const required = [
    ...tool.positionals.filter((p) => p.required).map((p) => p.property),
    ...tool.flags.filter((f) => f.required === true).map((f) => f.property),
  ];
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...orderRule(tool),
    additionalProperties: false,
  };
}

/**
 * The rule `positionalTokens` enforces, declared: a positional after an
 * optional one needs it, because positionals reach argv by position and the
 * later value would otherwise be read in the earlier one's slot. Without it a
 * client that validated `{name: "smoke"}` for `loam_list` against the schema
 * it was given passed, and was then refused `-32602` by the server.
 *
 * Read off the declaration order rather than spelled per tool, so a tool that
 * gains a positional after an optional one is declared the day it is refused.
 * Each later positional needs every earlier OPTIONAL one; an earlier required
 * one is in `required` already.
 *
 * Two keywords, because presence means two things. A scalar that is present
 * always yields a token, so presence is the whole condition and
 * `dependentRequired` says exactly that. A variadic yields tokens only when it
 * has members: an empty one moves nothing into anybody's slot, and
 * `positionalTokens` serves it — `{args: []}` with no `workflow` is the
 * workflow list. `dependentRequired` there would forbid a call the server
 * answers, the same disagreement turned the other way, so the variadic's rule
 * sits under `dependentSchemas`: once it is present, either the earlier ones
 * are too or it is empty. `anyOf` rather than `if`/`then`, which says the same
 * but puts a `then` key on an object, and a thenable literal is one `await`
 * away from being called.
 */
function orderRule(tool: McpTool): Record<string, unknown> {
  const dependentRequired: Record<string, string[]> = {};
  const dependentSchemas: Record<string, unknown> = {};
  const earlier: string[] = [];
  for (const positional of tool.positionals) {
    if (earlier.length > 0 && positional.variadic) {
      dependentSchemas[positional.property] = {
        anyOf: [{ required: [...earlier] }, { properties: { [positional.property]: { maxItems: 0 } } }],
      };
    } else if (earlier.length > 0) {
      dependentRequired[positional.property] = [...earlier];
    }
    if (!positional.required) earlier.push(positional.property);
  }
  return {
    ...(Object.keys(dependentRequired).length > 0 ? { dependentRequired } : {}),
    ...(Object.keys(dependentSchemas).length > 0 ? { dependentSchemas } : {}),
  };
}

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

/**
 * The positionals, in declaration order — and refused when one would land in
 * another's slot.
 *
 * A positional reaches argv by POSITION, so an optional one left out leaves no
 * gap: whatever follows it moves up into its place. `loam_list` with `{name:
 * "services"}` built `list services` and answered ok:true with the services
 * listing, a wrong answer with nothing in it saying so; `loam_instructions`
 * with `{args: [...]}` and no `workflow` read the first arg as the workflow.
 * Refused here instead, as the invalid-params problem a missing REQUIRED
 * positional already is, naming the slot the caller left empty. A later
 * positional that yields no token — an empty variadic — moves nothing up, so
 * it passes. `orderRule` above declares the same rule in the advertised
 * schema; the two change together.
 */
function positionalTokens(tool: McpTool, args: Record<string, unknown>): Checked {
  const tokens: string[] = [];
  let absent: string | undefined;
  for (const positional of tool.positionals) {
    const value = args[positional.property];
    if (value === undefined) {
      if (positional.required) return { ok: false, problem: `required argument '${positional.property}' is missing` };
      absent ??= positional.property;
      continue;
    }
    const checked = positional.variadic
      ? checkedStrings(positional.property, value)
      : checkedString(positional.property, value);
    if (!checked.ok) return checked;
    if (absent !== undefined && checked.tokens.length > 0) {
      return {
        ok: false,
        problem:
          `argument '${positional.property}' requires '${absent}' — positionals are read in order, ` +
          `so without '${absent}' this value would be read as '${absent}'`,
      };
    }
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
