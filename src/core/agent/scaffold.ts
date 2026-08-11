/**
 * The generated FILES: what a pointer file contains (the stub), what this
 * binary would write (SLASH_COMMANDS, plannedCommandFiles), and how the files
 * land and are detected on disk.
 *
 * The command and skill files go into the repo `init` runs in, because that is
 * where the agent is invoked — for whichever tools the repo shows signs of, via
 * the AGENT_TOOLS registry (tools/registry.ts): one shared body, a per-tool
 * path and wrapper. Neither delivery is ever overwritten: the files are
 * starting points, and a team's edits to them outrank ours.
 *
 * Two deliveries, one body. A slash command has to be TYPED, so it only ever
 * reaches an agent whose operator already knows loam exists. A skill is loaded
 * by the model itself when the task matches its `description`, which is how the
 * protocol reaches an agent that was never told about it. That difference is
 * the whole reason both are written by default.
 *
 * The per-tool command and skill files carry the same version stamp AGENTS.md
 * does (agents-md.ts), for the same reason and with the same answer:
 * `loam doctor` reports `doctor.agent-files-stale` and never rewrites. Without
 * it, absence was the only drift loam could see — a command file mangled to one
 * line left doctor saying `healthy: true`, which across a hundred repositories
 * is invisible rot with no repair path.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentsStampLine } from "./agents-stamp.js";
import { LOAM_VERSION } from "../envelope/version.js";
import type { AgentFileEmitter, CommandContent } from "./contract.js";
import { COMMANDS } from "./protocol.js";
import { AGENT_TOOLS, CLAUDE } from "./tools/registry.js";

/**
 * What a generated file actually contains: the purpose, the spine, and the
 * command that prints the rest.
 *
 * The protocol itself stays in `body` and ships inside the binary, reachable as
 * `loam instructions <name>`. The file on disk gets a pointer to it, because
 * these two things go stale in opposite directions and only one of them can be
 * fixed. A generated file is written once, never regenerated (that is the
 * never-overwrite contract, and it is deliberate — your edits outrank the
 * template), so a repo scaffolded a year ago holds a year-old protocol: exact
 * flags, exact finding codes, exact step order, all of it asserted with total
 * confidence by a file whose reader has no way to know it is describing a
 * different release. That is not a hypothetical failure mode. It is the one
 * every project shipping generated agent instructions has had, and the fix
 * everybody reaches for — regenerate on upgrade — trades it for silently
 * overwriting what a human wrote.
 *
 * Thinning the file is the third option. What remains is what does not move
 * between releases: what this workflow is for, and the verbs in order. What
 * leaves is everything version-shaped. `doctor.agent-files-stale` still reports
 * a file whose stamp has fallen behind, and now has almost nothing to be right
 * about — which is the point.
 *
 * The trade is real and worth stating: an agent that cannot execute `loam` now
 * has a spine instead of a protocol. That is the correct failure. Every step
 * below the spine is a loam invocation, so an agent that cannot run loam was
 * never going to complete this workflow from the file either — it was going to
 * try, using a year-old flag.
 */
function stubBody(c: CommandContent): string {
  const steps = c.spine.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  return `${c.purpose}

**Run this first.** It is the protocol, and it ships with the binary you are about
to call — so it names this loam's flags, its finding codes and its fix tables,
not the ones that were current when this repository was scaffolded:

    ${c.invocation}

The spine it fills in, so you can tell a run that went sideways from one that did not:

${steps}

Every step above is a \`loam\` invocation, and each command's own \`--json\` output
carries what to do next: findings have stable codes, and \`loam status --json\` puts
the ordered \`next[]\` — each entry a code and the literal command — in one place.
Branch on the codes, never on the prose.

This file is a pointer, not the protocol. loam wrote it once and will never
rewrite it, so your edits here outrank the template and nothing will quietly
undo them. Where this file and \`loam instructions\` disagree, the command is right.
`;
}

/**
 * The command body a file actually gets: the pointer, under the same version
 * stamp AGENTS.md carries.
 *
 * The stamp is applied once, here, rather than in twenty wrappers — it is a
 * fact about loam, not about a tool's dialect, and a per-wrapper copy is twenty
 * chances to forget it. It rides at the top of the BODY (not the file) because
 * every dialect puts something of its own first: YAML frontmatter, a TOML key,
 * a title line. An HTML comment is invisible in all of them, and
 * `agentsStampVersion` matches it wherever in the file it lands.
 *
 * A repo initialized before stamping existed has unstamped files, which is
 * exactly what `doctor.agent-files-stale` is for: nobody has confirmed that
 * those instructions still describe this binary.
 */
const stubbed = (c: CommandContent): CommandContent => ({
  ...c,
  body: `${agentsStampLine(LOAM_VERSION)}\n\n${stubBody(c)}`,
});

/**
 * The Claude-format files, keyed by command name: exactly what **this** binary
 * would write, derived through the same adapter that writes them, so the export
 * and a freshly scaffolded repo can never disagree.
 *
 * Read that scope literally. It used to be described as the on-disk contract of
 * every repo initialized before `--tools` existed, and that is no longer true
 * of anything but a fresh scaffold: a file holds the STUB now, every repo
 * scaffolded before that holds the full protocol, and because loam never
 * regenerates a generated file the two disagree permanently and on purpose. An
 * export cannot describe files this binary did not write.
 *
 * The protocol those older files carry is `PROTOCOLS`. Anything asserting on
 * protocol content wants that one — this answers "what would loam write here",
 * not "what does loam instruct".
 */
export const SLASH_COMMANDS: Record<string, string> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, CLAUDE.format(stubbed(c))]),
);

/** The two ways a command body reaches an agent. Both are on by default. */
export const DELIVERIES = ["commands", "skills"] as const;
export type Delivery = (typeof DELIVERIES)[number];

/**
 * Every file the selected tools would lay down, in creation order — the same
 * list `init` probes for `skipped` BEFORE the scaffold runs, so created +
 * skipped is the same list on every repo.
 *
 * Called with two arguments it returns EVERYTHING the binary would write under
 * default delivery: commands and skills both. That is the contract callers
 * outside this module depend on — `loam doctor` asks "what should be here?"
 * and a half-answer would report a fully-scaffolded repo as fully scaffolded
 * while ignoring every skill file. The name predates the second delivery and is
 * kept because it is imported elsewhere; `delivery` narrows it.
 */
export function plannedCommandFiles(
  cwd: string,
  toolIds: string[],
  delivery: readonly Delivery[] = DELIVERIES,
): Array<{ path: string; content: string }> {
  return toolIds.flatMap((id) => {
    const tool = AGENT_TOOLS[id];
    if (tool === undefined) throw new Error(`unknown agent tool: ${id}`);
    const emitters: AgentFileEmitter[] = [];
    // A tool declares only the deliveries it actually reads, so an absent
    // emitter is a fact about the tool, never a reason to fall back to some
    // other tool's convention.
    const { path, format, skill } = tool;
    if (delivery.includes("commands") && path !== undefined && format !== undefined) {
      emitters.push({ path, format });
    }
    if (delivery.includes("skills") && skill !== undefined) emitters.push(skill);
    return emitters.flatMap((e) =>
      COMMANDS.map((c) => ({ path: join(cwd, ...e.path(c.name)), content: e.format(stubbed(c)) })),
    );
  });
}

/**
 * Write the command and skill files for the selected tools into `cwd`. Existing
 * files are left alone — the never-overwrite contract covers every tool and
 * every delivery, not just the default one. Returns the paths created.
 */
export async function scaffoldAgentCommands(
  cwd: string,
  toolIds: string[] = ["claude"],
  delivery: readonly Delivery[] = DELIVERIES,
): Promise<string[]> {
  const created: string[] = [];
  for (const { path, content } of plannedCommandFiles(cwd, toolIds, delivery)) {
    if (existsSync(path)) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    created.push(path);
  }
  return created;
}

/**
 * The registry ids whose marker paths are present in `cwd` — what `loam init`
 * writes for when nobody passed `--tools`.
 *
 * A repo with `.cursor/` and no Claude Code used to get `.claude/commands/`
 * and nothing it could actually run. Presence is the whole test, and existence
 * (not directory-ness) is what is asked, because a marker is as often a file as
 * a directory — `.github/copilot-instructions.md` is the honest signal for
 * Copilot where `.github/` itself is noise.
 */
export function detectAgentTools(cwd: string): string[] {
  return Object.entries(AGENT_TOOLS)
    .filter(([, tool]) => tool.detect.some((marker) => existsSync(join(cwd, marker))))
    .map(([id]) => id);
}
