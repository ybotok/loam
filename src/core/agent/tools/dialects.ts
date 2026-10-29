/**
 * How one shared command body is SPELLED per tool family: the markdown and
 * TOML wrapper dialects, and the Agent Skills convention. registry.ts builds
 * its entries from these — nothing here adds prose of its own, so the body
 * stays one source of truth however many tools spell it.
 */
import type { AgentFileEmitter, CommandContent, DeliveredCommand } from "../contract.js";
import { argumentsLine, namedArguments, wordedArguments } from "./arguments.js";

/**
 * The loam verbs a generated skill MAY pre-approve, so an agent that honors the
 * field stops asking permission for each call. Each skill pre-approves only the
 * ones its own pages instruct — see {@link instructedVerbs} — so this is the
 * ceiling, not what any one file carries. Everything else a command needs
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
 * A verb missing from a skill's list is not forbidden, only unapproved: the
 * agent asks, and the user says yes. That is the correct cost for this one.
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
export const LOAM_ALLOWED_VERBS = [
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
  "tasks",
  "unarchive",
  "validate",
  "verify",
  "views",
] as const;

/**
 * The verbs deliberately left OFF {@link LOAM_ALLOWED_VERBS}, each with the
 * reason it is off.
 *
 * A map rather than a paragraph, because "every verb but the named exclusions"
 * is only a checkable rule if the exclusions are a VALUE. test/agents.test.ts
 * reads this one: the approvable set must equal the CLI's registered commands
 * minus these keys, so an absent verb is either a decision recorded here or a
 * test failure — never something nobody can tell from a forgotten one, which
 * is what the previous list was. Only `vouch` had ever been reasoned in the
 * source, and its reason is the paragraph above, unchanged.
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

/**
 * The approvable verbs one skill's own texts instruct — its pointer and the
 * protocol that pointer prints — in {@link LOAM_ALLOWED_VERBS} order, with
 * `--version` first when a text asks for it.
 *
 * Least privilege, derived rather than kept. One list for every skill handed
 * `loam-verify` the writers `new`, `init`, `gherkin` and `rebase`, and
 * `loam-adopt` `archive` and `unarchive` — none of which either protocol runs.
 * Only `loam-report` had been narrowed, by a hand-kept list this derivation
 * reproduces exactly; a hand-kept list per skill would drift the way the
 * shared one did (see above), so the list is read off the instructions
 * themselves, by the same `loam <verb>` reading test/agents.test.ts applies to
 * prove every instructed verb is approved.
 *
 * Only the skill's OWN page. The reference pages a protocol points at name
 * nearly every verb between them — they cross-reference loam-adopt and the
 * spine — so following them would hand every skill the whole list back. A verb
 * met only there costs one permission prompt, which is the cost the paragraph
 * above already accepts.
 *
 * Any mention counts, prose included: a page that says "never run
 * `loam archive` here" pre-approves `archive`. That over-reach is the price of
 * a rule a test can state, and it is bounded by the protocol's own text — a
 * verb no page of this skill names is never approved by it.
 *
 * `loam-report` is where the over-reach would hurt, and why its list was kept
 * narrow by hand before this. It names the writers so an agent recognizes one
 * and does not retry it to reproduce a failure — and pre-approving them would
 * authorize exactly those writers while a bad run is being diagnosed. It names
 * them as bare verbs (`archive`, `vouch`), which this reading does not count;
 * test/agents.test.ts pins the report skill's list, so an edit that spells one
 * `loam archive` fails there instead of widening it.
 */
export function instructedVerbs(texts: readonly string[]): string[] {
  const named = new Set(
    texts.flatMap((t) => [...t.matchAll(/\bloam (--version|[a-z][a-z-]*)/g)].map((m) => m[1]!)),
  );
  const verbs: string[] = LOAM_ALLOWED_VERBS.filter((v) => named.has(v));
  return named.has("--version") ? ["--version", ...verbs] : verbs;
}

/**
 * Both spellings of every approved invocation: the global binary, and the
 * `npx` form typed in a repository that installs loam as a devDependency,
 * which is the install README and QUICKSTART teach. A rule for `loam` alone
 * matched nothing such an agent ran, so every call stopped for a prompt. The
 * bare forms come first, as they always did.
 */
function bashRules(verbs: readonly string[]): string {
  const rule = (prefix: string, v: string): string =>
    v.startsWith("--") ? `Bash(${prefix} ${v})` : `Bash(${prefix} ${v}:*)`;
  return [...verbs.map((v) => rule("loam", v)), ...verbs.map((v) => rule("npx loam", v))].join(", ");
}

const skillAllowedTools = (c: DeliveredCommand): string =>
  bashRules(instructedVerbs([c.body, c.protocol]));

/**
 * The `argument-hint` line, quoted: a hint opens with `[` or `<` and holds a
 * `"` or a `|`, which a YAML reader parses as a sequence, a tag or a broken
 * scalar. Absent where a command takes no argument at all.
 */
const hintLine = (c: CommandContent): string =>
  c.argumentHint === "" ? "" : `argument-hint: ${JSON.stringify(c.argumentHint)}\n`;

/**
 * The Agent Skills convention loam EMITS: `<root>/skills/<name>/SKILL.md`, YAML
 * frontmatter, then the shared body — its arguments in words, since no host
 * outside Claude Code substitutes into a skill (see ./arguments.ts) — where
 * `<root>` is whatever the calling registry entry passes.
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
    `allowed-tools: ${skillAllowedTools(c)}\n---\n\n${wordedArguments(c).body}`,
});

/**
 * Copilot's skill dialect: the Agent Skills header plus `argument-hint`, which
 * Copilot documents for skills and shows when one is invoked by name — and
 * skills, not prompt files, are what every Copilot surface reads (the CLI and
 * the cloud agent have no prompt files at all).
 *
 * Its own emitter rather than a line in {@link skillsIn}, for the reason
 * {@link claudeSkillsIn} gives: the Agent Skills specification does not list
 * the field, and Anthropic's own strict readers refuse a key outside it. So it
 * goes where the host that reads it is documented, `.github/skills/`, and not
 * into the shared roots several hosts read.
 */
export const copilotSkillsIn = (dir: string): AgentFileEmitter => ({
  path: (name) => [dir, "skills", name, "SKILL.md"],
  format: (c) =>
    `---\nname: ${c.name}\ndescription: ${c.description}\n` + hintLine(c) +
    `allowed-tools: ${skillAllowedTools(c)}\n---\n\n${wordedArguments(c).body}`,
});

/**
 * Claude Code's skill dialect: the Agent Skills header plus the fields only
 * Claude Code documents (code.claude.com/docs/en/skills, checked 2026-10-27).
 *
 * `when_to_use` carries the trigger the shared description deliberately does
 * not: Claude Code appends it to `description` in the skill listing, the one
 * thing the model reads before choosing a skill, and both together are cut at
 * 1,536 characters. `argument-hint` is what autocomplete shows, and
 * `arguments` names the placeholders the body spells `$feature` — Claude Code
 * counts `$N` from zero, so a numbered placeholder took the wrong argument (see
 * ./arguments.ts). `disallowed-tools` removes `vouch` from the pool while the
 * skill is active — the "never vouch" every protocol states in prose becomes a
 * refusal by the host. Both tool lists clear with the user's next message.
 *
 * Only here. The other skill roots follow the Agent Skills specification, whose
 * frontmatter has none of these fields, and a stricter reader of that format
 * than Claude Code — which ignores what it does not know — could reject the
 * file.
 */
export const claudeSkillsIn = (dir: string): AgentFileEmitter => ({
  path: (name) => [dir, "skills", name, "SKILL.md"],
  format: (c) =>
    `---\nname: ${c.name}\ndescription: ${c.description}\n` +
    (c.whenToUse === undefined ? "" : `when_to_use: ${c.whenToUse}\n`) +
    hintLine(c) + argumentsLine(c) +
    `allowed-tools: ${skillAllowedTools(c)}\n` +
    `disallowed-tools: ${bashRules(["vouch"])}\n---\n\n${namedArguments(c).body}`,
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
