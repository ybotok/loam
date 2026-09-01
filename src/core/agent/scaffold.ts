/**
 * The generated FILES: what a pointer file contains (the stub), what this
 * binary would write (SLASH_COMMANDS, plannedCommandFiles), and how the files
 * land and are detected on disk.
 *
 * The command and skill files go into the repo `init` runs in, because that is
 * where the agent is invoked — for whichever tools the repo shows signs of, via
 * the AGENT_TOOLS registry (tools/registry.ts): one shared body, a per-tool
 * path and wrapper. A delivery is refreshed only while its bytes still match
 * the digest loam recorded when it wrote them; a team's edits revoke that
 * authority and outrank ours.
 *
 * Two deliveries, one body. A slash command has to be TYPED, so it only ever
 * reaches an agent whose operator already knows loam exists. A skill is loaded
 * by the model itself when the task matches its `description`, which is how the
 * protocol reaches an agent that was never told about it. That difference is
 * the whole reason both are written by default.
 *
 * The per-tool command and skill files carry the same version stamp AGENTS.md
 * does (agents-md.ts), for the same reason and with the same answer:
 * `loam doctor` reports `doctor.agent-files-stale` without writing. A later
 * `loam init` can refresh only a digest-matched pointer. Without the stamp,
 * absence was the only drift doctor could see — a command file mangled to one
 * line left it saying `healthy: true`, which across a hundred repositories is
 * invisible rot with no repair path.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { agentsStampLine } from "./agents-stamp.js";
import { LOAM_VERSION } from "../envelope/version.js";
import type { AgentFileEmitter, CommandContent } from "./contract.js";
import { AGENT_COMMANDS } from "./protocol.js";
import { AGENT_TOOLS, CLAUDE } from "./tools/registry.js";

/**
 * What a generated file actually contains: the purpose, the spine, and the
 * command that prints the rest.
 *
 * The protocol itself stays in `body` and ships inside the binary, reachable as
 * `loam instructions <name>`. The file on disk gets a pointer to it, because
 * these two things go stale in opposite directions and only one of them can be
 * fixed. A generated file is refreshed only while its bytes still match the
 * digest loam recorded; any edit revokes that authority because your edits
 * outrank the template. Without that distinction a repo scaffolded a year ago
 * holds a year-old protocol: exact
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
 * has a spine instead of a protocol. That is the correct failure. The exact
 * diagnostic and lifecycle invocations belong to the binary-owned page; an
 * agent that cannot run loam cannot finish either kind from an embedded copy —
 * it can only try using a year-old flag.
 *
 * The last clause of the pointer is the one sentence here that changes what an
 * agent DOES rather than what it knows. `loam instructions loam-check` prints
 * 84 KB — about a fifth of a 100k-token window, 223 fix-table rows of which a
 * run needs two or three — and every file written from this stub opens by
 * telling the agent to run it. `--no-fix-tables` (commands/instructions.ts)
 * drops the rows, and `loam explain <code>` answers the one row the run turned
 * out to need in under 500 bytes. The flag is what makes the lazy path payable;
 * this sentence is what makes an agent take it.
 */
function stubBody(c: CommandContent): string {
  const steps = c.spine.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const entry = c.name === "loam-report"
    ? `This support protocol has two equivalent chat entry points: the explicit command a
user chooses, and the Agent Skill an unexpected-run request may load. Both reach
the same local, sanitized report; the agent owns the diagnostic steps.`
    : `This workflow has two equivalent chat entry points: the explicit command a user
chooses, and the Agent Skill a natural-language request may load. Both reach this
same body and must produce the same status/edit/validate loop; do not make the
user type the internal loam commands one by one.`;
  const output = c.name === "loam-report"
    ? `The runtime protocol decides which diagnostics are safe to run and what may enter the
report. Do not infer permission to retry a writer, repair files or send the result
from the broader lifecycle commands another generated skill may allow.`
    : `Every step above is a \`loam\` invocation, and each command's own \`--json\` output
carries what to do next: findings have stable codes, and \`loam status --json\` puts
the ordered \`next[]\` — each entry a code and the literal command — in one place.
Branch on the codes, never on the prose. The check workflow starts with
\`--no-fix-tables\`; use \`loam explain <code>\` for each code the run actually
reports, and remove that flag only when you deliberately need the complete table.`;
  return `${c.purpose}

${entry}

**Run this first.** It is the protocol, and it ships with the binary you are about
to call — so it names this loam's flags, its finding codes and its fix tables,
not the ones that were current when this repository was scaffolded:

    ${c.invocation}

The spine it fills in, so you can tell a run that went sideways from one that did not:

${steps}

${output}

This file is a pointer, not the protocol. loam may refresh it while its bytes still
match the digest recorded in loam.json. Editing it revokes that authority: your
changes outrank the template and stay untouched. Where this file and
\`loam instructions\` disagree, the command is right.
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
 * scaffolded before that holds the full protocol. A recorded, byte-identical
 * pointer can refresh; an older unrecorded file or any customized file cannot,
 * so an export cannot describe files this binary did not write.
 *
 * The protocol those older files carry is `PROTOCOLS`. Anything asserting on
 * protocol content wants that one — this answers "what would loam write here",
 * not "what does loam instruct".
 */
export const SLASH_COMMANDS: Record<string, string> = Object.fromEntries(
  AGENT_COMMANDS.map((c) => [c.name, CLAUDE.format(stubbed(c))]),
);

/** The two ways a command body reaches an agent. Both are on by default. */
export const DELIVERIES = ["commands", "skills"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const AGENT_PROFILES = ["full", "service", "docs"] as const;
export type AgentProfile = (typeof AGENT_PROFILES)[number];

const PROFILE_COMMANDS: Record<AgentProfile, ReadonlySet<string>> = {
  full: new Set(AGENT_COMMANDS.map((command) => command.name)),
  service: new Set(["loam-adopt", "loam-implement", "loam-check", "loam-verify", "loam-report"]),
  docs: new Set(["loam-feature", "loam-check", "loam-ship", "loam-report"]),
};

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
  profile: AgentProfile = "full",
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
      AGENT_COMMANDS.filter((command) => PROFILE_COMMANDS[profile].has(command.name)).map((c) => ({
        path: join(cwd, ...e.path(c.name)),
        content: e.format(stubbed(c)),
      })),
    );
  });
}

function contentDigest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function manifestPath(cwd: string, path: string): string {
  return relative(cwd, path).replaceAll("\\", "/");
}

export function updatedAgentFileManifest(
  cwd: string,
  planned: Array<{ path: string }>,
  existing: Readonly<Record<string, string>> | undefined,
  managed: Readonly<Record<string, string>>,
): Record<string, string> {
  const out = { ...existing };
  for (const file of planned) delete out[manifestPath(cwd, file.path)];
  return Object.assign(out, managed);
}

export interface AgentFileSync {
  created: string[];
  refreshed: string[];
  /** Repo-relative path -> digest of the bytes loam is allowed to refresh. */
  managed: Record<string, string>;
}

/**
 * Create missing files and refresh only files still byte-identical to the
 * digest recorded when loam last wrote them. A human edit breaks that equality
 * and therefore revokes loam's authority over the file without a marker block
 * or a prompt.
 */
export async function syncAgentCommands(req: {
  cwd: string;
  toolIds?: string[];
  delivery?: readonly Delivery[];
  profile?: AgentProfile;
  known?: Readonly<Record<string, string>>;
}): Promise<AgentFileSync> {
  const { cwd, toolIds = ["claude"], delivery = DELIVERIES, profile = "full", known = {} } = req;
  const out: AgentFileSync = { created: [], refreshed: [], managed: {} };
  for (const { path, content } of plannedCommandFiles(cwd, toolIds, delivery, profile)) {
    const key = manifestPath(cwd, path);
    const desired = contentDigest(content);
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      out.created.push(path);
      out.managed[key] = desired;
      continue;
    }
    const current = contentDigest(await readFile(path));
    if (current === desired) {
      out.managed[key] = desired;
      continue;
    }
    if (known[key] !== current) continue;
    await writeFile(path, content, "utf8");
    out.refreshed.push(path);
    out.managed[key] = desired;
  }
  return out;
}

/**
 * Backward-compatible create-only wrapper. Callers that own no digest manifest
 * leave every existing file alone and receive only the paths created.
 */
export async function scaffoldAgentCommands(
  cwd: string,
  toolIds: string[] = ["claude"],
  delivery: readonly Delivery[] = DELIVERIES,
): Promise<string[]> {
  return (await syncAgentCommands({ cwd, toolIds, delivery })).created;
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
