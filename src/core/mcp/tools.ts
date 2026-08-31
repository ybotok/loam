/**
 * The curated MCP tool table: which loam commands an MCP client can reach,
 * and how a JSON argument object becomes an argv the CLI already trusts.
 *
 * This base table is read-only. Opt-in writers live in `./author-tools.ts`;
 * vouch and a committing archive remain absent: an MCP caller is definitionally
 * an agent, `loam vouch` is a HUMAN act (the CLI refuses unattended runs with
 * vouch-unattended), and exposing it here would rebuild the hole the generated
 * skill files' allowlist was narrowed to close. verify is excluded with them: its read form and its
 * attesting `--record`/`--results`/`--contract-results` form are one command,
 * and a facade that exposes "only the read half" of a writer is one
 * flag-mapping bug away from exposing the writer.
 *
 * The inclusion of the two commands that read no CONFIG — `explain` and
 * `instructions` — is equally deliberate, and is recorded here because the
 * gap is otherwise re-derivable as an oversight: an agent meets both BEFORE
 * the repository is wired (every generated skill's first line is `loam
 * instructions <workflow>`, and `loam explain <code>` answers a code from a
 * run that has not happened yet), so an MCP-only host that could not reach
 * them could not fetch the protocol its own generated skill points at.
 *
 * Every table entry mirrors a real registration in `src/commands/` — same
 * positionals, same flags, same spellings — so the contract an MCP client
 * sees is the CLI contract, not a second one. `--json` is appended by
 * `toArgv` unconditionally: the tool result IS the machine envelope.
 */

import { TERMS } from "../explain/terms.js";

/**
 * The concept-term names, from the registry that owns them — `loam_explain`'s
 * schema description must not be a hand copy that silently trails TERMS.
 */
const TERM_LIST = TERMS.map(({ term }) => term).join(", ");

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

const SERVICE_FLAG = {
  property: "service",
  flag: "--service",
  kind: "string",
  description: "service id (defaults to the one loam.json configures)",
} as const;

/**
 * The tool annotations EVERY entry in this table carries — one shared literal,
 * because the table is read-only by construction and a per-tool copy is a
 * place for one of them to drift into claiming something else.
 *
 * `readOnlyHint` is the whole point: without it a host has no machine signal
 * that `loam_validate` or `loam_context` is safe, so a call that only reads
 * files falls into the same approval prompt as a mutating tool. Read-only
 * hints are what let a host auto-approve, and the reason the writers are
 * excluded from the table above is precisely so this hint can be true of
 * everything left. `openWorldHint: false` states the other half a host acts
 * on: loam reaches no network and no service — it reads the files in the
 * directory the server started in, and nothing else.
 *
 * `idempotentHint` and `destructiveHint` are deliberately ABSENT rather than
 * spelled `true`/`false`: MCP defines both as meaningful only when
 * `readOnlyHint` is false, so shipping them would be noise a reviewer has to
 * justify before deciding they mean nothing here.
 *
 * `outputSchema` lives in `./protocol.ts`, beside `toolReply`: the declaration
 * and the fallback structured envelope have to change together or a client is
 * promised structured content one branch can omit.
 */
export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * The `loam_` prefix on every name: multi-server MCP hosts flatten tool names
 * into one namespace, and a bare `validate` collides with anybody else's.
 * Each description names the CLI command it mirrors, so the equivalence is
 * stated where the client reads it.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "loam_validate",
    command: "validate",
    description:
      "Validate a service (C4 + requirement coverage), a feature (delta + coverage), or the whole fleet. " +
      "CLI equivalent: loam validate [target] [--service <id>] [--feature <id>] [--all] [--strict] [--errors-only] --json",
    positionals: [
      {
        property: "target",
        required: false,
        variadic: false,
        description: "service or feature id (a feature wins when both match; service/feature force the reading)",
      },
    ],
    flags: [
      { ...SERVICE_FLAG, description: "service to validate (defaults to the configured service)" },
      { property: "feature", flag: "--feature", kind: "string", description: "validate a feature delta instead of a service" },
      { property: "all", flag: "--all", kind: "boolean", description: "validate every service and every active feature" },
      { property: "strict", flag: "--strict", kind: "boolean", description: "exit 1 on any warning too; the payload does not change" },
      { property: "errorsOnly", flag: "--errors-only", kind: "boolean", description: "print only errors and warnings; the payload does not change" },
    ],
  },
  {
    name: "loam_status",
    command: "status",
    description:
      "Where the work stands and what to do next, derived from the files. " +
      "CLI equivalent: loam status [feature] [--service <id>] --json",
    positionals: [
      { property: "feature", required: false, variadic: false, description: "feature id or directory name; omit for the whole repository" },
    ],
    flags: [{ ...SERVICE_FLAG, description: "narrow the per-service view to one service" }],
  },
  {
    name: "loam_list",
    command: "list",
    description:
      "List the services and features in the docs repo. " +
      "CLI equivalent: loam list [section] [--archived] [--needs-work] [--review-order] [--subsystem <name>] [--owners <path>] --json",
    positionals: [
      { property: "section", required: false, variadic: false, description: "services | features | capabilities (default: services + features)" },
    ],
    flags: [
      { property: "archived", flag: "--archived", kind: "boolean", description: "include archived features" },
      { property: "needsWork", flag: "--needs-work", kind: "boolean", description: "services only: every service below vouched, with what it is missing" },
      { property: "reviewOrder", flag: "--review-order", kind: "boolean", description: "with needsWork: order the worklist by fan-in, highest blast radius first" },
      { property: "subsystem", flag: "--subsystem", kind: "string", description: "services only: limit the listing to services filed under this subsystem, at any depth ('unfiled' selects the ones filed under none)" },
      { property: "owners", flag: "--owners", kind: "string", description: "services only: group the listing by owning team from this CODEOWNERS file (directory-pattern rules only; unsupported rules are listed as skipped, never guessed)" },
    ],
  },
  {
    name: "loam_show",
    command: "show",
    description:
      "Everything loam knows about a service or a feature. " +
      "CLI equivalent: loam show <target> [--type service|feature] --json",
    positionals: [
      { property: "target", required: true, variadic: false, description: "service id or feature id" },
    ],
    flags: [
      { property: "type", flag: "--type", kind: "string", description: "force the reading: service | feature" },
    ],
  },
  {
    name: "loam_delta",
    command: "delta",
    description:
      "Project a feature onto a service: why + requirement delta + C4 changes. " +
      "CLI equivalent: loam delta <featureId> [--service <id>] --json",
    positionals: [
      { property: "featureId", required: true, variadic: false, description: "feature id, e.g. FEAT-101" },
    ],
    flags: [{ ...SERVICE_FLAG, description: "service to project onto (defaults to the configured service)" }],
  },
  {
    name: "loam_explore",
    command: "explore",
    description:
      "Read the fleet around a change nobody has written down yet — writes nothing. " +
      "CLI equivalent: loam explore [service...] [--op <id>] [--capability <id>] [--as <FEAT>] --json",
    positionals: [
      { property: "services", required: false, variadic: true, description: "service ids the change starts from" },
    ],
    flags: [
      { property: "op", flag: "--op", kind: "strings", description: "seed from an operation instead of a service; repeatable" },
      { property: "capability", flag: "--capability", kind: "strings", description: "seed from a declared capability's realizing services; repeatable" },
      { property: "as", flag: "--as", kind: "string", description: "feature id for the suggested command line" },
    ],
  },
  {
    name: "loam_dependencies",
    command: "dependencies",
    description:
      "Dependencies and conflicts derived from active feature artifacts. " +
      "CLI equivalent: loam dependencies [featureId] --json",
    positionals: [
      { property: "featureId", required: false, variadic: false, description: "active feature id; omit for the whole in-flight graph" },
    ],
    flags: [],
  },
  {
    name: "loam_diff",
    command: "diff",
    description:
      "Semantic diff of the living docs against a base git ref of the docs repo — removals graded against their current consumers; read-only. " +
      "CLI equivalent: loam diff --base <ref> --json",
    positionals: [],
    flags: [
      {
        property: "base",
        flag: "--base",
        kind: "string",
        required: true,
        description: "base git ref of the docs repo (e.g. main, origin/main, a commit sha)",
      },
    ],
  },
  {
    name: "loam_doctor",
    command: "doctor",
    description:
      "Diagnose local loam configuration and docs-repo accessibility without writing. " +
      "CLI equivalent: loam doctor --json",
    positionals: [],
    flags: [],
  },
  {
    name: "loam_context",
    command: "context",
    description:
      "Assemble one service's whole docs slice as one deterministic briefing. " +
      "CLI equivalent: loam context <service> [--feature <FEAT>] --json",
    positionals: [
      { property: "service", required: true, variadic: false, description: "service id, e.g. payment-service" },
    ],
    flags: [
      { property: "feature", flag: "--feature", kind: "string", description: "narrow the in-flight section to this one feature" },
    ],
  },
  {
    name: "loam_gate",
    command: "gate",
    description:
      "Can this service deploy? A read-only query over recorded evidence — advisory by default. " +
      "CLI equivalent: loam gate [--service <id>] [--strict] --json",
    positionals: [],
    flags: [
      { ...SERVICE_FLAG, description: "the service being deployed (defaults to the configured service)" },
      { property: "strict", flag: "--strict", kind: "boolean", description: "exit 1 on any warning too; the payload does not change" },
    ],
  },
  {
    name: "loam_steps",
    command: "steps",
    description:
      "Inventory the step phrases of a service's scenarios — how many step definitions its suite needs. " +
      "CLI equivalent: loam steps [--service <id>] [--duplicates] --json",
    positionals: [],
    flags: [
      { ...SERVICE_FLAG, description: "service to inventory (defaults to the configured service)" },
      {
        property: "duplicates",
        flag: "--duplicates",
        kind: "boolean",
        description: "list only the near-duplicate groups — phrases that differ by an article or a trailing clause",
      },
    ],
  },
  {
    name: "loam_explain",
    command: "explain",
    description:
      "Explain a finding code, a refusal code, or a loam concept term, version-matched to this binary; reads no config and no docs repo. " +
      "CLI equivalent: loam explain [subject] --json",
    positionals: [
      {
        property: "subject",
        required: false,
        variadic: false,
        description: `finding code (spine.op-undefined), refusal code (docs-busy), or concept term (${TERM_LIST}); omit to list the terms`,
      },
    ],
    flags: [],
  },
  {
    name: "loam_instructions",
    command: "instructions",
    description:
      "Print a workflow protocol, version-matched to this binary; reads no config and no docs repo, so it answers " +
      "before the repository is wired. Ask for loam-check DELIBERATELY: it is by far the largest protocol " +
      "(its per-code fix tables are ~83 KB of the ~84 KB it prints), and noFixTables true returns the narrowed page " +
      "— every paragraph that introduces a table, none of the rows — after which loam_explain answers any one code " +
      "a run reports in under 500 bytes. " +
      "CLI equivalent: loam instructions [workflow] [args...] [--no-fix-tables] --json",
    positionals: [
      {
        property: "workflow",
        required: false,
        variadic: false,
        description: "workflow name (loam-adopt, loam-feature, …); omit to list them",
      },
      {
        property: "args",
        required: false,
        variadic: true,
        description: "values substituted for the protocol's $1, $2, … placeholders",
      },
    ],
    flags: [
      {
        // `noFixTables`, not `fixTables`, and the mismatch with commander's own
        // attribute name (`fixTables`, because `--no-` negates) is the point:
        // `toArgv` spells a true boolean as its flag string, so a property named
        // for the option's ATTRIBUTE would make `{fixTables: true}` emit
        // `--no-fix-tables` and turn the tables off. The JSON property is named
        // for what setting it true DOES.
        property: "noFixTables",
        flag: "--no-fix-tables",
        kind: "boolean",
        description: "drop the per-code fix tables; loam_explain answers any code a run reports",
      },
    ],
  },
];

export function toolByName(
  name: string,
  tools: readonly McpTool[] = MCP_TOOLS,
): McpTool | undefined {
  return tools.find((tool) => tool.name === name);
}

/** The MCP inputSchema for one tool: a closed object, so a typo'd argument refuses instead of vanishing. */
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
    additionalProperties: false,
  };
}

// How a tool call's JSON arguments become an argv — including the refusal of
// any string a shell-less argv would still read as a flag — lives in
// `./argv.ts`: the table above says WHAT the tools are, that module says how
// a call crosses into the CLI's own parsing.
