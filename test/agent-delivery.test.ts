/**
 * Two facts `loam init` learns and records about the repo it runs in: WHICH
 * agent tools are in use here, and which ones it has generated for.
 *
 * Both exist because of the same failure. `init` wrote `.claude/commands/` and
 * nothing else, so a team on Cursor got a directory their editor never opens
 * and no sign that anything was wrong — the files were there, they were just
 * there for somebody else's tool. The scan below is what makes the default
 * answer depend on the repo instead of on a hard-coded guess, and `agentTools`
 * in loam.json is what lets a later `loam doctor` tell "this file is missing
 * because the binary grew a command" from "nobody ever selected this tool".
 *
 * The path/wrapper conventions themselves are pinned in test/agents.test.ts;
 * this file is about selection, not spelling.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, runLoam } from "./helpers/harness.js";
import { detectAgentTools, plannedCommandFiles } from "../src/core/agent/scaffold.js";
import { AGENT_TOOLS } from "../src/core/agent/tools/registry.js";
import { parseConfig } from "../src/core/envelope/config.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir();
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A repo that already carries `markers` — directories unless the name has a dot in it. */
async function repoWith(...markers: string[]): Promise<string> {
  const dir = await throwawayDir();
  for (const marker of markers) {
    const full = join(dir, marker);
    if (marker.split("/").pop()!.includes(".", 1)) {
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, "", "utf8");
    } else {
      await mkdir(full, { recursive: true });
    }
  }
  return dir;
}

const initJson = async (dir: string, ...args: string[]): Promise<Record<string, any>> => {
  const res = await runLoam(dir, "init", "--docs", "./d", "--create", ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
};

const readConfig = async (dir: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(join(dir, "loam.json"), "utf8"));

describe("detectAgentTools — what the repo says it uses", () => {
  it("every registry entry declares at least one marker, and every marker is a dot-path or names its tool", () => {
    // The scan is only as good as the markers; a tool added without one would
    // be silently undetectable and nobody would notice until a user's repo.
    // A marker outside a dot-directory must carry the tool's own name
    // (`opencode.json`), so no generic file can claim a tool.
    for (const [id, tool] of Object.entries(AGENT_TOOLS)) {
      expect(tool.detect.length, `${id} declares no detection marker`).toBeGreaterThan(0);
      for (const marker of tool.detect) {
        expect(marker.startsWith(".") || marker.startsWith(`${id}.`), `${id} marker ${marker}`).toBe(true);
      }
    }
  });

  it("finds nothing in an empty directory", async () => {
    expect(detectAgentTools(await throwawayDir())).toEqual([]);
  });

  it("finds each tool by its own dot-directory, and only that tool", async () => {
    expect(detectAgentTools(await repoWith(".cursor"))).toEqual(["cursor"]);
    expect(detectAgentTools(await repoWith(".gemini"))).toEqual(["gemini"]);
    expect(detectAgentTools(await repoWith(".codex"))).toEqual(["codex"]);
  });

  it("reports several at once, in registry order", async () => {
    const dir = await repoWith(".trae", ".cursor", ".claude");
    expect(detectAgentTools(dir)).toEqual(["claude", "cursor", "trae"]);
  });

  it("cline answers to either of its two unrelated directories", async () => {
    // Its workflows live in .clinerules/ and its skills in .cline/; neither is
    // derivable from the other, so both count as a sighting.
    expect(detectAgentTools(await repoWith(".cline"))).toEqual(["cline"]);
    expect(detectAgentTools(await repoWith(".clinerules"))).toEqual(["cline"]);
    expect(detectAgentTools(await repoWith(".cline", ".clinerules"))).toEqual(["cline"]);
  });

  it("devin answers to its old windsurf directory too", async () => {
    expect(detectAgentTools(await repoWith(".windsurf"))).toEqual(["devin"]);
  });

  it("a bare .github/ is NOT copilot — that would fire in nearly every repo", async () => {
    expect(detectAgentTools(await repoWith(".github"))).toEqual([]);
    expect(detectAgentTools(await repoWith(".github/workflows"))).toEqual([]);
  });

  it("a copilot marker FILE counts, not only a marker directory", async () => {
    // detectionPaths are files as often as directories; requiring a directory
    // would miss the single most common Copilot signal there is.
    expect(detectAgentTools(await repoWith(".github/copilot-instructions.md"))).toEqual([
      "github-copilot",
    ]);
    expect(detectAgentTools(await repoWith(".github/prompts"))).toEqual(["github-copilot"]);
    // the Copilot CLI's repository MCP config has no dot after `.github/`
    expect(detectAgentTools(await repoWith(".github/mcp.json"))).toEqual(["github-copilot"]);
    expect(detectAgentTools(await repoWith(".github/.mcp.json"))).toEqual([]);
  });

  it("opencode answers to its project config as well as its directory", async () => {
    expect(detectAgentTools(await repoWith("opencode.json"))).toEqual(["opencode"]);
    expect(detectAgentTools(await repoWith("opencode.jsonc"))).toEqual(["opencode"]);
  });
});

describe("init without --tools writes for what it found", () => {
  it("a repo with .cursor/ gets cursor files and no .claude/ at all", async () => {
    const dir = await repoWith(".cursor");
    const json = await initJson(dir);
    expect(json.detected).toEqual(["cursor"]);
    expect(json.tools).toEqual(["cursor"]);
    expect(existsSync(join(dir, ".cursor", "commands", "loam-check.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor", "skills", "loam-check", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("a repo with several gets all of them", async () => {
    const dir = await repoWith(".cursor", ".gemini", ".codex");
    const json = await initJson(dir);
    expect(json.tools).toEqual(["cursor", "gemini", "codex"]);
    expect(existsSync(join(dir, ".gemini", "commands", "loam", "check.toml"))).toBe(true);
    // codex's skills go to the root Codex documents
    expect(existsSync(join(dir, ".agents", "skills", "loam-check", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".codex", "skills"))).toBe(false);
  });

  it("a bare repo still falls back to claude — the behavior that existed before the scan", async () => {
    const dir = await throwawayDir();
    const json = await initJson(dir);
    expect(json.detected).toEqual([]);
    expect(json.tools).toEqual(["claude"]);
    expect(existsSync(join(dir, ".claude", "commands", "loam-check.md"))).toBe(true);
  });

  it("the human output names the scan when the scan is what decided", async () => {
    const dir = await repoWith(".cursor");
    const res = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(res.out).toContain("detected:  cursor");
  });

  it("--tools overrides the scan, and `detected` still reports what was there", async () => {
    // The two keys answer different questions: what the repo shows, and what
    // was written for. An agent comparing them learns whether they disagree.
    const dir = await repoWith(".cursor");
    const json = await initJson(dir, "--tools", "gemini");
    expect(json.detected).toEqual(["cursor"]);
    expect(json.tools).toEqual(["gemini"]);
    expect(existsSync(join(dir, ".cursor", "commands"))).toBe(false);
  });

  it("a repo initialized once detects ITSELF on the second run — no new files, no drift", async () => {
    // The first run's own output is a marker, so the second run must reach the
    // same selection and skip everything. A scan that widened here would write
    // for a tool nobody chose, forever.
    const dir = await repoWith(".cursor");
    const first = await initJson(dir);
    const second = await initJson(dir);
    expect(second.tools).toEqual(first.tools);
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(first.created);
  });
});

describe("agentTools in loam.json — the record of what was generated for", () => {
  it("init records the tools it wrote for", async () => {
    const dir = await repoWith(".cursor");
    await initJson(dir);
    expect((await readConfig(dir)).agentTools).toEqual(["cursor"]);
  });

  it("a second init accumulates instead of replacing — the earlier files are still on disk", async () => {
    const dir = await throwawayDir();
    await initJson(dir); // claude, by fallback
    await initJson(dir, "--tools", "gemini");
    expect((await readConfig(dir)).agentTools).toEqual(["claude", "gemini"]);
    // and both tools' files really are there, which is what the list claims
    expect(existsSync(join(dir, ".claude", "commands", "loam-check.md"))).toBe(true);
    expect(existsSync(join(dir, ".gemini", "commands", "loam", "check.toml"))).toBe(true);
  });

  it("re-selecting a recorded tool does not duplicate it", async () => {
    const dir = await throwawayDir();
    await initJson(dir, "--tools", "cursor");
    await initJson(dir, "--tools", "cursor");
    expect((await readConfig(dir)).agentTools).toEqual(["cursor"]);
  });

  it("a run that generated nothing records nothing", async () => {
    const dir = await throwawayDir();
    await initJson(dir, "--no-commands", "--no-skills");
    expect((await readConfig(dir)).agentTools).toBeUndefined();
  });

  it("a run that generated nothing does not erase what an earlier run recorded", async () => {
    const dir = await throwawayDir();
    await initJson(dir, "--tools", "cursor");
    await initJson(dir, "--no-commands", "--no-skills");
    expect((await readConfig(dir)).agentTools).toEqual(["cursor"]);
  });

  it("absent is legal: a loam.json without it loads, as one from an older binary must", () => {
    const config = parseConfig(JSON.stringify({ docsDir: "../docs" }), "/repo");
    expect(config.agentTools).toBeUndefined();
  });

  it("an id this binary has never heard of loads — a NEWER binary may have written it", () => {
    const config = parseConfig(
      JSON.stringify({ docsDir: "../docs", agentTools: ["claude", "some-tool-from-2027"] }),
      "/repo",
    );
    expect(config.agentTools).toEqual(["claude", "some-tool-from-2027"]);
  });

  it("a malformed value refuses the config by name, the way every other field does", () => {
    for (const bad of ["claude", [1], [""], {}]) {
      expect(() => parseConfig(JSON.stringify({ docsDir: "../d", agentTools: bad }), "/repo"))
        .toThrow(/"agentTools" must be an array of non-empty strings/);
    }
  });
});

describe("plannedCommandFiles — the two-argument contract other commands read", () => {
  it("called with two arguments it plans EVERY file init would write, both deliveries", async () => {
    // `loam doctor` asks this question to decide whether a repo is fully
    // scaffolded. A commands-only answer would call a repo with no skill files
    // complete, which is the exact drift this delivery was added to close.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all");
    for (const { path } of plannedCommandFiles(dir, Object.keys(AGENT_TOOLS))) {
      expect(existsSync(path), `init never wrote ${path}`).toBe(true);
    }
  });

  it("the third argument narrows it, and the two halves partition the whole", () => {
    const ids = Object.keys(AGENT_TOOLS);
    const all = plannedCommandFiles("/repo", ids).map((f) => f.path);
    const commands = plannedCommandFiles("/repo", ids, ["commands"]).map((f) => f.path);
    const skills = plannedCommandFiles("/repo", ids, ["skills"]).map((f) => f.path);
    expect([...commands, ...skills].sort()).toEqual([...all].sort());
    expect(commands.filter((p) => skills.includes(p))).toEqual([]);
    // codex contributes to one half only
    expect(commands.some((p) => p.includes(".agents"))).toBe(false);
    expect(skills.some((p) => p.includes(join(".agents", "skills")))).toBe(true);
    // and shares that half's root with `agents`: each path is planned once
    expect(new Set(all).size).toBe(all.length);
    expect(plannedCommandFiles("/repo", ["codex", "agents"])).toEqual(plannedCommandFiles("/repo", ["agents"]));
  });

  it("an unknown id throws rather than planning a half-empty scaffold", () => {
    expect(() => plannedCommandFiles("/repo", ["roomba"])).toThrow(/unknown agent tool: roomba/);
  });
});

describe("codex: the move from .codex/skills/ to .agents/skills/", () => {
  /** A repo initialized for codex the way loam used to: its skills, and their digests, under `.codex/skills/`. */
  async function scaffoldedTheOldWay(): Promise<string> {
    const dir = await throwawayDir();
    await initJson(dir, "--tools", "codex", "--agent-profile", "service");
    const config = await readConfig(dir);
    const moved: Record<string, string> = {};
    for (const [key, digest] of Object.entries(config.agentFiles as Record<string, string>)) {
      const old = key.replace(/^\.agents\/skills\//, ".codex/skills/");
      await mkdir(join(dir, old, ".."), { recursive: true });
      await writeFile(join(dir, old), await readFile(join(dir, key), "utf8"), "utf8");
      moved[old] = digest;
    }
    await rm(join(dir, ".agents"), { recursive: true, force: true });
    await writeFile(join(dir, "loam.json"), `${JSON.stringify({ ...config, agentFiles: moved }, null, 2)}\n`, "utf8");
    return dir;
  }

  it("removes the copies loam wrote and nobody edited, and leaves an edited one where it is", async () => {
    const dir = await scaffoldedTheOldWay();
    const edited = join(dir, ".codex", "skills", "loam-check", "SKILL.md");
    await writeFile(edited, `${await readFile(edited, "utf8")}\nOur own note.\n`, "utf8");

    const res = await runLoam(dir, "init", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.superseded).toEqual([edited]);
    expect(json.removed).toContain(join(dir, ".codex", "skills", "loam-adopt", "SKILL.md"));
    expect(json.removed).not.toContain(edited);
    expect(existsSync(join(dir, ".codex", "skills", "loam-adopt"))).toBe(false);
    expect(existsSync(edited)).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "loam-check", "SKILL.md"))).toBe(true);
    // `.codex/` stays: it is how the next init finds Codex
    expect(existsSync(join(dir, ".codex"))).toBe(true);

    // the manifest forgets what was removed and keeps the edited file's record
    const agentFiles = Object.keys((await readConfig(dir)).agentFiles);
    expect(agentFiles).toContain(".codex/skills/loam-check/SKILL.md");
    expect(agentFiles).not.toContain(".codex/skills/loam-adopt/SKILL.md");
    expect(agentFiles).toContain(".agents/skills/loam-adopt/SKILL.md");
  });

  it("touches nothing under .codex/ when codex is not selected", async () => {
    const dir = await scaffoldedTheOldWay();
    const res = await runLoam(dir, "init", "--tools", "claude", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).removed).toEqual([]);
    expect(existsSync(join(dir, ".codex", "skills", "loam-adopt", "SKILL.md"))).toBe(true);
  });
});
