/**
 * How one shared command body is SPELLED per tool family: the markdown and
 * TOML wrapper dialects, and the Agent Skills convention. registry.ts builds
 * its entries from these — nothing here adds prose of its own, so the body
 * stays one source of truth however many tools spell it.
 */
import type { AgentFileEmitter, CommandContent } from "../contract.js";

/**
 * The loam verbs a generated file pre-approves, so an agent that honors the
 * field stops asking permission for each call. Everything else a command needs
 * (Read, Write, the service's own test runner) stays under the user's normal
 * permission settings, and a tool that does not know the field ignores it.
 *
 * Enumerated rather than spelled `Bash(loam:*)`, for one verb's sake. `vouch`
 * is the only command in loam whose output is a claim about a HUMAN act — a
 * person read the code and says the document matches it — and a blanket
 * allowlist pre-approved it, which handed the agent that wrote a draft the
 * power to promote its own draft to `verified` without anybody being asked.
 * That inverts the argument loam makes everywhere else: it holds test evidence
 * to "an agent must not be able to SAY a scenario is tested", and then let one
 * say a spec matches the code. `vouch` now refuses without a terminal or
 * `--yes` (commands/vouch.ts) — this list is the other half, so the refusal is
 * something a person sees rather than something an agent routes around.
 *
 * A verb missing from this list is not forbidden, only unapproved: the agent
 * asks, and the user says yes. That is the correct cost for this one.
 *
 * The rule the list obeys is **every verb the CLI registers except the keys of
 * {@link UNAPPROVED}**, and it admits no silent third category: a verb is
 * either here or there, with a written reason. The rule it does NOT obey is
 * "read-only" — that is false of `subsystem`, which writes, and it was never
 * what this list did anyway: `archive`, `rebase` and `new` all write, and all
 * three have been on it since the day the wildcard came off.
 *
 * The rule is written down because a hand-kept list drifts, and this one had.
 * Seventeen of the twenty-nine registered verbs were on it, and three of the
 * twelve missing ones were instructed by loam's own protocols: `loam-implement`
 * opens with `loam context` and calls `loam steps` mandatory before a step
 * definition is written, and `loam-check`'s fix table says to run
 * `loam subsystem sync`. Each stalled on a permission prompt at exactly the
 * step its own protocol calls required. It was worst for `explain`: every
 * generated file now tells the agent to read the protocol narrow
 * (`loam instructions <workflow> --no-fix-tables`) and then look up the codes
 * the run actually reported — so the one command that makes an 84 KB page
 * payable was the one the skill could not invoke unasked.
 */
const LOAM_ALLOWED_VERBS = [
  "adopt",
  "archive",
  "context",
  "delta",
  "dependencies",
  "diff",
  "doctor",
  "explain",
  "explore",
  "gate",
  "gherkin",
  "init",
  "instructions",
  "list",
  "new",
  "rebase",
  "show",
  "status",
  "steps",
  "subsystem",
  "unarchive",
  "validate",
  "verify",
] as const;

/**
 * The verbs deliberately left OFF {@link LOAM_ALLOWED_VERBS}, each with the
 * reason it is off.
 *
 * A map rather than a paragraph, because "every verb but the named exclusions"
 * is only a checkable rule if the exclusions are a VALUE. test/agents.test.ts
 * reads this one: the emitted allowlist must equal the CLI's registered
 * commands minus these keys, so an absent verb is either a decision recorded
 * here or a test failure — never something nobody can tell from a forgotten
 * one, which is what the previous list was. Only `vouch` had ever been reasoned
 * in the source, and its reason is the paragraph above, unchanged.
 *
 * The equality is checked in the test layer and cannot be computed here:
 * deriving the allowlist from the command registry would mean `core/`
 * importing `commands/`, which AGENTS.md forbids outright.
 */
export const UNAPPROVED: Record<string, string> = {
  "audit-openspec":
    "the OpenSpec on-ramp: a one-time migration a person drives against a foreign workspace, named by no workflow protocol",
  mcp: "a long-running stdio server rather than a call that returns — an agent that starts it inside a step waits forever",
  "migrate-openspec":
    "the same on-ramp, and `--apply` materializes a whole target tree from a mapping only a human can have filled in",
  open: "writes a `.code-workspace` for a person's editor; the output is aimed at the human, and no protocol step reads it",
  seed: "templates the fleet map from a human-authored fleet.yaml — who exists and who calls whom is the one thing no generator may state",
  vouch:
    "a claim about a HUMAN act, so an agent must not be able to SAY a spec matches the code; the refusal has to be something a person sees rather than something an agent routes around",
};

const LOAM_ALLOWED_TOOLS = LOAM_ALLOWED_VERBS.map((v) => `Bash(loam ${v}:*)`).join(", ");

/**
 * Incident collection is intentionally narrower than a lifecycle workflow.
 * The body names writers so an agent can recognize and avoid retrying them;
 * inheriting the lifecycle allowlist would nevertheless pre-authorize those
 * same writers while diagnosing a bad run. Version, doctor and status are the
 * complete command set the reporting protocol asks to execute.
 */
const REPORT_ALLOWED_TOOLS = [
  "Bash(loam --version)",
  "Bash(loam doctor:*)",
  "Bash(loam instructions:*)",
  "Bash(loam status:*)",
].join(", ");

const skillAllowedTools = (c: CommandContent): string =>
  c.name === "loam-report" ? REPORT_ALLOWED_TOOLS : LOAM_ALLOWED_TOOLS;

/**
 * The Agent Skills convention loam EMITS: `<root>/skills/<name>/SKILL.md`, YAML
 * frontmatter, then the shared body verbatim — where `<root>` is whatever the
 * calling registry entry passes.
 *
 * It used to say that every tool in the registry which reads skills spells the
 * path this way. That was an unevidenced universal, and the `agents` entry
 * falsifies it: `.agents/skills/` is a vendor-neutral root several tools read
 * INSTEAD of their own dot-directory, not another tool's directory. Where a
 * path is documented by the tool, the citation lives on that tool's registry
 * entry — this helper states only what it writes.
 *
 * `description` is load-bearing in a way no command file's is — it is the only
 * thing the model sees before deciding whether to load the skill — so it comes
 * from the same `CommandContent.description` the command wrappers use rather
 * than a second, skill-flavoured copy that could drift into a better pitch for
 * a worse protocol.
 */
export const skillsIn = (dir: string): AgentFileEmitter => ({
  path: (name) => [dir, "skills", name, "SKILL.md"],
  format: (c) =>
    `---\nname: ${c.name}\ndescription: ${c.description}\n` +
    `allowed-tools: ${skillAllowedTools(c)}\n---\n\n${c.body}`,
});

/**
 * TOML basic-string escapes for the one non-markdown format. Today's bodies
 * carry neither backslashes nor `"""`, but the escape is what keeps a future
 * body edit from silently corrupting the generated TOML.
 */
export const tomlLine = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
export const tomlBlock = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"""/g, '""\\"');

/* The four markdown command dialects the registry actually needs. Shared so a
 * tool's entry is its PATH and its dialect's name — the part that differs —
 * instead of a wall of near-identical template literals. `claude` deliberately
 * spells its own wrapper inline even though `hintedMd` matches it byte for
 * byte: an edit made here for some other tool must not be able to re-spell the
 * one format that is frozen. */
/** Description-only frontmatter — the most common dialect by a wide margin. */
export const describedMd = (c: CommandContent): string =>
  `---\ndescription: ${c.description}\n---\n\n${c.body}`;
/** Description plus Claude's `argument-hint`, for the tools that copied it. */
export const hintedMd = (c: CommandContent): string =>
  `---\ndescription: ${c.description}\nargument-hint: ${c.argumentHint}\n---\n\n${c.body}`;
/** Name plus description — the Cascade-style workflow frontmatter. */
export const namedMd = (c: CommandContent): string =>
  `---\nname: ${c.name}\ndescription: ${c.description}\n---\n\n${c.body}`;
/** No frontmatter at all: a title line is the whole wrapper. */
export const titledMd = (c: CommandContent): string => `# ${c.name}\n\n${c.body}`;

/** The `loam-` prefix a namespace directory carries instead of the file name. */
export const unprefixed = (name: string): string => name.replace(/^loam-/, "");
