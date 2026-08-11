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
 */
const LOAM_ALLOWED_VERBS = [
  "adopt",
  "archive",
  "delta",
  "dependencies",
  "doctor",
  "explore",
  "gherkin",
  "init",
  "instructions",
  "list",
  "new",
  "rebase",
  "show",
  "status",
  "unarchive",
  "validate",
  "verify",
] as const;

const LOAM_ALLOWED_TOOLS = LOAM_ALLOWED_VERBS.map((v) => `Bash(loam ${v}:*)`).join(", ");

/**
 * The Agent Skills convention, which every tool in the registry that reads
 * skills at all spells the same way: `<tool-dir>/skills/<name>/SKILL.md`, YAML
 * frontmatter, then the shared body verbatim.
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
    `allowed-tools: ${LOAM_ALLOWED_TOOLS}\n---\n\n${c.body}`,
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
