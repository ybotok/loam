/**
 * The registry of agent tools loam can scaffold for — one entry per tool: its
 * paths, its wrapper dialect, and the marker paths whose presence means the
 * tool is in use. Paths and wrappers follow each tool's own documented
 * convention and are pinned byte-for-byte in test/agents.test.ts.
 */
import type { AgentTool, DeliveredCommand } from "../contract.js";
import { argumentsLine, inputArguments, namedArguments } from "./arguments.js";
import { COPILOT_INSTRUCTIONS } from "./copilot.js";
import {
  claudeSkillsIn,
  copilotSkillsIn,
  describedMd,
  hintedMd,
  namedMd,
  skillsIn,
  titledMd,
  tomlBlock,
  tomlLine,
  unprefixed,
} from "./dialects.js";

/**
 * A registry entry that really does emit command files — both halves of the
 * command adapter present. The distinction is not hypothetical: `codex`
 * declares neither, on purpose. Naming it lets the one entry
 * scaffold.ts derives THROUGH carry that guarantee in its type, instead of at
 * the use site where the only way to state it was a pair of `!`.
 */
type CommandEmittingTool = AgentTool & Required<Pick<AgentTool, "path" | "format">>;

/**
 * The shape most entries share: `<dir>/<sub>/<name>.md` command files in the
 * given dialect, skills under `<dir>/skills/`, and the tool's own dot-directory
 * as its one sighting. An entry that departs from any of the three — another
 * extension, a namespace directory, a second marker, no commands at all — is
 * written out in full below, so the departure is what its entry shows.
 */
function dotTool(dir: string, sub: string, format: (c: DeliveredCommand) => string): CommandEmittingTool {
  return { path: (name) => [dir, sub, `${name}.md`], format, skill: skillsIn(dir), detect: [dir] };
}

/**
 * The original target and the default. SLASH_COMMANDS (scaffold.ts) derives
 * through this wrapper, and an already-initialized repo still reads as fully
 * scaffolded whatever it holds (`skipped` is existsSync, never content). What
 * the wrapper wraps carries a version stamp, which is the one thing about a
 * generated file loam will report on; see `stubbed`.
 *
 * The wrapper was byte-identical to what loam had always written until it
 * gained `arguments:` and spelled the placeholders `$feature`: Claude Code
 * counts `$N` from zero, so `$1` had been taking the SECOND argument (see
 * ./arguments.ts). A file loam wrote and nobody edited is
 * refreshed by the next `loam init`; an edited one is reported, never touched.
 *
 * It stands outside the registry object because SLASH_COMMANDS reaches for it
 * by name. That lookup was `AGENT_TOOLS["claude"]!.format!` — two assertions on
 * an exported const evaluated at import time, so renaming the key, or letting
 * this entry lose `format` the way `codex` legitimately has, would have thrown
 * a TypeError while the CLI entry point was still being loaded: before
 * `program.exitOverride()` exists, and therefore with no envelope around it.
 * Named and typed, both mistakes are typecheck failures instead. The registry
 * still lists it first, and the emitted bytes are unchanged.
 */
export const CLAUDE: CommandEmittingTool = {
  ...dotTool(
    ".claude",
    "commands",
    (c) =>
      `---\ndescription: ${c.description}\nargument-hint: ${c.argumentHint}\n${argumentsLine(c)}---\n\n` +
      namedArguments(c).body,
  ),
  // The one skill dialect of its own: Claude Code reads `when_to_use` and
  // `disallowed-tools`, which the Agent Skills format every other root follows
  // does not have (see `claudeSkillsIn`).
  skill: claudeSkillsIn(".claude"),
};

export const AGENT_TOOLS: Record<string, AgentTool> = {
  claude: CLAUDE,
  // Cursor invokes by flat file name (`/loam-check`); its frontmatter `name`
  // field spells that invocation form.
  cursor: dotTool(".cursor", "commands", (c) => `---\nname: /${c.name}\n---\n\n${c.body}`),
  // Copilot prompt files: `.prompt.md` extension, description-only frontmatter,
  // arguments as `${input:…}` — the one spelling Copilot fills in. Only VS
  // Code's local harness reads prompt files; the CLI, the cloud agent and VS
  // Code's Copilot harness read skills, so the skills carry `argument-hint`.
  // Detection cannot use `.github/` — almost every repo has one and almost none
  // of them means Copilot — so it looks for the files Copilot itself reads:
  // `.github/mcp.json`, no dot, is the CLI's repository MCP config.
  "github-copilot": {
    path: (name) => [".github", "prompts", `${name}.prompt.md`],
    format: (c) => describedMd(inputArguments(c)),
    skill: copilotSkillsIn(".github"),
    instructions: COPILOT_INSTRUCTIONS,
    detect: [
      ".github/copilot-instructions.md",
      ".github/instructions",
      ".github/prompts",
      ".github/agents",
      ".github/skills",
      ".github/workflows/copilot-setup-steps.yml",
      ".github/mcp.json",
    ],
  },
  // Gemini: TOML, and a namespace DIRECTORY — `.gemini/commands/loam/check.toml`
  // is invoked as `/loam:check`, so the file name drops the `loam-` prefix the
  // flat-named tools carry.
  gemini: {
    path: (name) => [".gemini", "commands", "loam", `${unprefixed(name)}.toml`],
    format: (c) =>
      `description = "${tomlLine(c.description)}"\nprompt = """\n${tomlBlock(c.body)}"""`,
    skill: skillsIn(".gemini"),
    detect: [".gemini"],
  },
  // OpenCode substitutes `$1` in its commands, so they keep it. Its project
  // config, `opencode.json` (or `.jsonc`), is as sure a sighting as
  // `.opencode/`, which a repository that only configures OpenCode lacks.
  opencode: { ...dotTool(".opencode", "commands", describedMd), detect: [".opencode", "opencode.json", "opencode.jsonc"] },
  // Cline reads workflows from `.clinerules/` — plain markdown, no frontmatter —
  // but its skills from `.cline/`. The two directories are unrelated, so both
  // count as a sighting.
  cline: {
    path: (name) => [".clinerules", "workflows", `${name}.md`],
    format: titledMd,
    skill: skillsIn(".cline"),
    detect: [".cline", ".clinerules"],
  },
  // Amazon Q surfaces these as its PROMPT library, not as commands: the file is
  // invoked `@loam-check`, never `/loam-check`. Same file shape regardless.
  "amazon-q": dotTool(".amazonq", "prompts", describedMd),
  // Antigravity's directory is `.agent/`, which is why the id and the directory
  // do not match here as they do almost everywhere else.
  antigravity: dotTool(".agent", "workflows", describedMd),
  // Auggie is the Augment CLI: id `auggie`, directory `.augment/`.
  auggie: dotTool(".augment", "commands", hintedMd),
  // Skills-only, deliberately: Codex does not load custom command files (its
  // custom prompts were removed in 0.117), so it declares no command emitter at
  // all rather than laying down files nothing will ever open.
  //
  // The skills go to `.agents/skills/`, the one root Codex documents — "Codex
  // scans `.agents/skills` in every directory from your current working
  // directory up to the repository root" (Build skills,
  // developers.openai.com/codex/skills; checked 2026-10-27) — and the same bytes
  // the `agents` entry writes, so choosing both writes each file once.
  //
  // It used to be `.codex/skills/`, which Codex never documented and still
  // loads (Codex PR #10317 calls it the older location, slated for removal) —
  // and Codex lists a skill found in both roots twice. So `retired` names the
  // old root: the next `loam init` for codex removes the copies there that loam
  // wrote and nobody edited since, and reports the rest (`retireMovedAgentFiles`,
  // scaffold.ts). `detect` stays `.codex`, the directory Codex itself makes.
  codex: {
    skill: skillsIn(".agents"),
    detect: [".codex"],
    retired: [".codex/skills/"],
  },
  // Continue's prompt files take a bare `.prompt` extension, and `invokable`
  // is what promotes one from a template to something you can call.
  continue: {
    path: (name) => [".continue", "prompts", `${name}.prompt`],
    format: (c) =>
      `---\nname: ${c.name}\ndescription: ${c.description}\ninvokable: true\n---\n\n${c.body}`,
    skill: skillsIn(".continue"),
    detect: [".continue"],
  },
  // Crush namespaces like Gemini does — `.crush/commands/loam/check.md` is
  // `/loam:check` — but stays markdown.
  crush: {
    path: (name) => [".crush", "commands", "loam", `${unprefixed(name)}.md`],
    format: namedMd,
    skill: skillsIn(".crush"),
    detect: [".crush"],
  },
  // Devin Desktop, formerly Windsurf: Cascade-style workflows, and the rename
  // moved the directory from `.windsurf/` to `.devin/`. New files go to the new
  // directory; a repo still holding the old one is still a Devin repo, so both
  // are sightings.
  devin: {
    path: (name) => [".devin", "workflows", `${name}.md`],
    format: namedMd,
    skill: skillsIn(".devin"),
    detect: [".devin", ".windsurf"],
  },
  factory: dotTool(".factory", "commands", hintedMd),
  junie: dotTool(".junie", "commands", describedMd),
  // Kilo Code workflows carry no frontmatter — the title line is all the
  // wrapper there is.
  kilocode: dotTool(".kilocode", "workflows", titledMd),
  // Kiro uses Copilot's `.prompt.md` extension under its own directory.
  kiro: {
    path: (name) => [".kiro", "prompts", `${name}.prompt.md`],
    format: describedMd,
    skill: skillsIn(".kiro"),
    detect: [".kiro"],
  },
  // Qwen Code retired its TOML commands in favour of markdown + frontmatter,
  // so this is markdown despite the Gemini lineage.
  qwen: dotTool(".qwen", "commands", describedMd),
  // Roo/Zoo Code: id `roocode`, directory `.roo/`, no frontmatter.
  roocode: dotTool(".roo", "commands", titledMd),
  trae: dotTool(".trae", "commands", namedMd),
  // The vendor-neutral skills root, and the only id here that names no vendor.
  // `.agents/skills/<name>/SKILL.md` is read by seven of the tools that already
  // have entries above, each documenting it in its own words:
  //
  //   Cursor — "Skills are automatically loaded from `.agents/skills/`,
  //     `.cursor/skills/`, `~/.agents/skills/` … and `~/.cursor/skills/`"
  //     (Agent Skills, cursor.com/docs/skills).
  //   GitHub Copilot — "For project skills, specific to a single repository,
  //     create a `.github/skills`, `.claude/skills`, or `.agents/skills`
  //     directory in your repository" (Adding agent skills for GitHub Copilot,
  //     docs.github.com/en/copilot → customize-cloud-agent/add-skills).
  //   Codex — "Codex scans `.agents/skills` in every directory from your
  //     current working directory up to the repository root" (Build skills,
  //     developers.openai.com/codex/skills).
  //   Gemini CLI — `.agents/skills/` is the workspace-tier alias for
  //     `.gemini/skills/`, and "within the same tier … takes precedence over
  //     the `.gemini/skills/` directory" (docs/cli/skills.md in
  //     google-gemini/gemini-cli).
  //   Zed — "Skills are loaded from `~/.agents/skills/` and
  //     `<worktree>/.agents/skills/` only" (Agent Skills, zed.dev/docs/ai/skills).
  //   Roo Code — `.agents/skills/` is its cross-agent project location, ranked
  //     below `.roo/skills/` at the same level (Skills,
  //     docs.roocode.com/features/skills).
  //   OpenCode — "Project agent-compatible: `.agents/skills/<name>/SKILL.md`",
  //     beside `.opencode/skills/` and `.claude/skills/` (Agent Skills,
  //     opencode.ai/docs/skills, checked 2026-10-27).
  //
  // Skills only, for the reason spelled out on `codex`: not one of those seven
  // documents a COMMAND file under this root, so a `.agents/commands/` would be
  // files nothing will ever open — the thing this entry exists to stop.
  //
  // Purely ADDITIVE, and that is the design rather than an implementation
  // detail. No tool above loses or re-points its own skill path: a repo already
  // carrying `.claude/skills/` keeps getting them there. This entry is for the
  // team that would rather have ONE copy those seven read than seven copies of the
  // same bytes, and choosing that is the user's call — which is why selecting
  // `agents` adds a target and never removes one.
  //
  // `detect` is `.agents/skills`, never a bare `.agents/`, for exactly
  // `github-copilot`'s reason. `.agents/` is a shared root that other
  // conventions also write into, so a bare marker would auto-scaffold into any
  // repository where something else had made the directory — the failure that
  // rules out `.github/` one entry up. It is also NOT `antigravity`'s
  // `.agent/`: one letter apart, unrelated conventions, and `existsSync` on
  // either says nothing about the other.
  agents: {
    skill: skillsIn(".agents"),
    detect: [".agents/skills"],
  },
};
