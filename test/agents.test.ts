/**
 * Tests for the agent contract that `loam init` lays down
 * (src/core/agent.ts, wired through src/core/docs.ts and src/commands/init.ts).
 *
 * The process — new -> delta -> code -> validate -> archive — has so far lived
 * only in the head of whoever built the docs repo. AGENTS.md puts it where the
 * agent will actually look, and the slash commands give it the entry points.
 *
 * The bar: someone handed nothing but the docs repo and AGENTS.md can run the
 * cycle. So the tests check that every command in the cycle is named, and that
 * the two things nobody guesses — the operationId spine and the archive gate —
 * are spelled out.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";
import {
  AGENT_TOOLS,
  AGENTS_MD,
  PROTOCOLS as COMMAND_BODIES,
  SLASH_COMMANDS as COMMAND_FILES,
} from "../src/core/agent.js";
import { buildProgram } from "../src/cli.js";
import {
  agentsStaleFinding,
  agentsStampLine,
  agentsStampVersion,
  versionTrails,
} from "../src/core/agents-stamp.js";
import { LOAM_VERSION } from "../src/core/version.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir();
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const SLASH_COMMANDS = ["loam-feature", "loam-implement", "loam-check", "loam-ship"];

describe("AGENTS.md in the docs repo", () => {
  it("is scaffolded by init", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, "d", "AGENTS.md"))).toBe(true);
    expect(res.out).toContain("AGENTS.md");
  });

  it("names every command in the cycle", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    for (const cmd of ["loam new", "loam delta", "loam validate", "loam archive", "loam show"]) {
      expect(agents).toContain(cmd);
    }
  });

  it("spells out the operationId spine — the part nobody guesses", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("operationId");
    expect(agents).toContain("Operations:");
    expect(agents).toContain("metadata { op");
  });

  it("says that archive is gated on coherence and how to override it", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents.toLowerCase()).toContain("coherence");
    expect(agents).toContain("--approve");
  });

  it("tells the agent to read the machine contract rather than the prose", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("--json");
  });

  it("separates what a human authors from what the CLI derives", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("intent.md");
    expect(agents).toContain("delta.likec4");
    expect(agents).toContain("spec.md");
  });

  it("is never overwritten once it exists", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const mine = "# our own house rules\n";
    await writeFile(join(dir, "d", "AGENTS.md"), mine, "utf8");
    const second = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(second.code).toBe(0);
    expect(await readFile(join(dir, "d", "AGENTS.md"), "utf8")).toBe(mine);
    expect(second.out).not.toContain("scaffolded");
  });
});

describe("slash commands in the working repo", () => {
  it("are written into .claude/commands/ of the repo init runs in", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(res.code).toBe(0);
    for (const name of SLASH_COMMANDS) {
      expect(existsSync(join(dir, ".claude", "commands", `${name}.md`))).toBe(true);
    }
  });

  it("each one drives real loam commands, not vibes", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const read = (n: string): Promise<string> =>
      readFile(join(dir, ".claude", "commands", `${n}.md`), "utf8");
    expect(await read("loam-feature")).toContain("loam new");
    expect(await read("loam-implement")).toContain("loam delta");
    expect(await read("loam-check")).toContain("loam validate");
    expect(await read("loam-ship")).toContain("loam archive");
  });

  it("--no-commands leaves the command directory alone", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--no-commands");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".claude", "commands"))).toBe(false);
    // the docs-repo half still happens
    expect(existsSync(join(dir, "d", "AGENTS.md"))).toBe(true);
  });

  it("never overwrites a command the user has edited", async () => {
    const dir = await throwawayDir();
    await mkdir(join(dir, ".claude", "commands"), { recursive: true });
    const mine = "my own /loam-check\n";
    await writeFile(join(dir, ".claude", "commands", "loam-check.md"), mine, "utf8");

    const res = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(res.code).toBe(0);
    expect(await readFile(join(dir, ".claude", "commands", "loam-check.md"), "utf8")).toBe(mine);
    // the others are still laid down
    expect(existsSync(join(dir, ".claude", "commands", "loam-feature.md"))).toBe(true);
  });

  it("a second init reports nothing new", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const second = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(second.out).not.toContain("scaffolded");
  });
});

describe("multi-tool command generation (init --tools)", () => {
  // Path expectations pinned as literals, per tool, for one probe command: a
  // moved path must fail HERE, not in some user's repo — and the registry
  // growing a tool must extend this table (the exactness test below).
  //
  // `command: null` is Codex, which reads skills and registers no command files
  // at all; every other tool declares both deliveries. The skill column is the
  // Agent Skills convention — `<tool-dir>/skills/<name>/SKILL.md` — and its
  // directory is the tool's OWN, which for cline is not the directory its
  // commands go in.
  interface Pin {
    command: string[] | null;
    skill: string[];
  }
  const CHECK_FILE: Record<string, Pin> = {
    claude: {
      command: [".claude", "commands", "loam-check.md"],
      skill: [".claude", "skills", "loam-check", "SKILL.md"],
    },
    cursor: {
      command: [".cursor", "commands", "loam-check.md"],
      skill: [".cursor", "skills", "loam-check", "SKILL.md"],
    },
    "github-copilot": {
      command: [".github", "prompts", "loam-check.prompt.md"],
      skill: [".github", "skills", "loam-check", "SKILL.md"],
    },
    gemini: {
      command: [".gemini", "commands", "loam", "check.toml"],
      skill: [".gemini", "skills", "loam-check", "SKILL.md"],
    },
    opencode: {
      command: [".opencode", "commands", "loam-check.md"],
      skill: [".opencode", "skills", "loam-check", "SKILL.md"],
    },
    cline: {
      command: [".clinerules", "workflows", "loam-check.md"],
      skill: [".cline", "skills", "loam-check", "SKILL.md"],
    },
    "amazon-q": {
      command: [".amazonq", "prompts", "loam-check.md"],
      skill: [".amazonq", "skills", "loam-check", "SKILL.md"],
    },
    antigravity: {
      command: [".agent", "workflows", "loam-check.md"],
      skill: [".agent", "skills", "loam-check", "SKILL.md"],
    },
    auggie: {
      command: [".augment", "commands", "loam-check.md"],
      skill: [".augment", "skills", "loam-check", "SKILL.md"],
    },
    codex: { command: null, skill: [".codex", "skills", "loam-check", "SKILL.md"] },
    continue: {
      command: [".continue", "prompts", "loam-check.prompt"],
      skill: [".continue", "skills", "loam-check", "SKILL.md"],
    },
    crush: {
      command: [".crush", "commands", "loam", "check.md"],
      skill: [".crush", "skills", "loam-check", "SKILL.md"],
    },
    devin: {
      command: [".devin", "workflows", "loam-check.md"],
      skill: [".devin", "skills", "loam-check", "SKILL.md"],
    },
    factory: {
      command: [".factory", "commands", "loam-check.md"],
      skill: [".factory", "skills", "loam-check", "SKILL.md"],
    },
    junie: {
      command: [".junie", "commands", "loam-check.md"],
      skill: [".junie", "skills", "loam-check", "SKILL.md"],
    },
    kilocode: {
      command: [".kilocode", "workflows", "loam-check.md"],
      skill: [".kilocode", "skills", "loam-check", "SKILL.md"],
    },
    kiro: {
      command: [".kiro", "prompts", "loam-check.prompt.md"],
      skill: [".kiro", "skills", "loam-check", "SKILL.md"],
    },
    qwen: {
      command: [".qwen", "commands", "loam-check.md"],
      skill: [".qwen", "skills", "loam-check", "SKILL.md"],
    },
    roocode: {
      command: [".roo", "commands", "loam-check.md"],
      skill: [".roo", "skills", "loam-check", "SKILL.md"],
    },
    trae: {
      command: [".trae", "commands", "loam-check.md"],
      skill: [".trae", "skills", "loam-check", "SKILL.md"],
    },
  };
  it("the pinned path table covers exactly the registry — a new tool must be pinned here", () => {
    expect(Object.keys(CHECK_FILE).sort()).toEqual(Object.keys(AGENT_TOOLS).sort());
  });

  it("the pins agree with the registry itself, tool by tool, for both deliveries", () => {
    // The table above is a literal restatement of the registry; this is what
    // makes it one. A path helper edited to a new spelling fails here with the
    // tool named, rather than only on the one tool the --tools all test reads.
    for (const [id, pin] of Object.entries(CHECK_FILE)) {
      const tool = AGENT_TOOLS[id]!;
      expect(tool.path === undefined ? null : tool.path("loam-check"), `${id} command path`)
        .toEqual(pin.command);
      expect(tool.skill!.path("loam-check"), `${id} skill path`).toEqual(pin.skill);
    }
  });

  it("the claude wrapper is the historical byte format — description + argument-hint frontmatter", () => {
    // SLASH_COMMANDS derives through the claude adapter, so a reworded wrapper
    // would silently re-spell every already-initialized repo as unscaffolded.
    // The literal prefix pins the on-disk contract, not the derivation.
    expect(
      COMMAND_FILES["loam-adopt"]!.startsWith(
        "---\n" +
          "description: Adopt a service — write its baseline docs from its code, as draft, then validate\n" +
          "argument-hint: <service-id>\n" +
          "---\n\n",
      ),
    ).toBe(true);
  });

  it("--tools all lays down every tool's files, each in its own dialect, all driving real loam commands", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.tools).toEqual(Object.keys(AGENT_TOOLS));
    const read = (segs: string[]): Promise<string> => readFile(join(dir, ...segs), "utf8");
    for (const { command, skill } of Object.values(CHECK_FILE)) {
      for (const segs of command === null ? [skill] : [command, skill]) {
        expect(
          json.created.some((c: string) => c.endsWith(join(...segs))),
          `created is missing ${segs.join("/")}`,
        ).toBe(true);
        expect(await read(segs)).toContain("loam validate");
      }
    }
    // the wrapper is the tool's own dialect, not claude's everywhere
    const cmd = (id: string): Promise<string> => read(CHECK_FILE[id]!.command!);
    const claude = await cmd("claude");
    expect(claude).toMatch(/^---\ndescription: /);
    expect(claude).toContain("argument-hint:");
    expect(await cmd("cursor")).toMatch(/^---\nname: \/loam-check\n---\n\n/);
    const copilot = await cmd("github-copilot");
    expect(copilot).toMatch(/^---\ndescription: /);
    expect(copilot).not.toContain("argument-hint:");
    const gemini = await cmd("gemini");
    expect(gemini).toMatch(/^description = "/);
    expect(gemini).toContain('prompt = """');
    expect(gemini.endsWith('"""')).toBe(true);
    expect(await cmd("opencode")).toMatch(/^---\ndescription: /);
    // cline: a title line, no frontmatter block at the top (the body's own
    // markdown tables still carry `---` rows, so only the head is asserted)
    expect(await cmd("cline")).toMatch(/^# loam-check\n\n/);
    // and the dialects the registry grew after the first six
    expect(await cmd("amazon-q")).toMatch(/^---\ndescription: /);
    expect(await cmd("auggie")).toContain("argument-hint:");
    expect(await cmd("continue")).toMatch(
      /^---\nname: loam-check\ndescription: [^\n]+\ninvokable: true\n---\n\n/,
    );
    expect(await cmd("crush")).toMatch(/^---\nname: loam-check\ndescription: /);
    expect(await cmd("devin")).toMatch(/^---\nname: loam-check\ndescription: /);
    expect(await cmd("kilocode")).toMatch(/^# loam-check\n\n/);
    expect(await cmd("roocode")).toMatch(/^# loam-check\n\n/);
    expect(await cmd("trae")).toMatch(/^---\nname: loam-check\ndescription: /);
    // codex is skills-only: nothing under a command directory of its own
    expect(existsSync(join(dir, ".codex", "commands"))).toBe(false);
    expect(existsSync(join(dir, ".codex", "prompts"))).toBe(false);
  });

  it("every skill file is the Agent Skills header over the byte-identical shared body", async () => {
    // The whole point of the second delivery is that it is the SAME protocol —
    // a skill that drifts from its command is two contracts wearing one name.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all");
    for (const id of Object.keys(CHECK_FILE)) {
      const skill = await readFile(join(dir, ...CHECK_FILE[id]!.skill), "utf8");
      expect(skill, `${id} skill frontmatter`).toMatch(
        /^---\nname: loam-check\ndescription: [^\n]+\nallowed-tools: Bash\(loam [a-z-]+:\*\)(?:, Bash\(loam [a-z-]+:\*\))*\n---\n\n/,
      );
      // the body after the frontmatter is claude's body after ITS frontmatter
      const body = (s: string): string => s.slice(s.indexOf("\n---\n\n") + "\n---\n\n".length);
      expect(body(skill), `${id} skill body`).toBe(body(COMMAND_FILES["loam-check"]!));
    }
  });

  it("the pre-approved allowlist names every loam verb EXCEPT vouch", async () => {
    // `Bash(loam:*)` pre-approved the one command whose output is a claim about
    // a human act, which handed the agent that wrote a draft the power to
    // promote its own draft to `verified`. The refusal in commands/vouch.ts is
    // the other half; this is the half that makes the refusal something a person
    // sees rather than something an agent routes around.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const skill = await readFile(join(dir, ".claude", "skills", "loam-check", "SKILL.md"), "utf8");
    const allowed = /^allowed-tools: (.+)$/m.exec(skill)![1]!;

    expect(allowed).not.toContain("Bash(loam:*)");
    expect(allowed).not.toContain("vouch");
    // and it is an allowlist worth having: the verbs an agent actually runs are
    // on it, so this is not "ask about everything" wearing a different hat.
    for (const verb of ["adopt", "validate", "status", "new", "archive", "verify"]) {
      expect(allowed, verb).toContain(`Bash(loam ${verb}:*)`);
    }
  });

  it("--tools cursor,gemini replaces the default — no .claude/ appears", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "cursor,gemini");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".cursor", "commands", "loam-feature.md"))).toBe(true);
    expect(existsSync(join(dir, ".cursor", "skills", "loam-feature", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".gemini", "commands", "loam", "feature.toml"))).toBe(true);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    // the human output names what was generated for whom, per delivery
    expect(res.out).toContain("commands:  cursor, gemini");
    expect(res.out).toContain("skills:    cursor, gemini");
  });

  // NOT "the old behavior byte-for-byte", which this test was called and could
  // never check: both sides derive from the same emitter, so a change to what
  // loam writes moves them together and the assertion holds either way. What it
  // does pin is real and worth keeping — `init` and the export agree, and no
  // tool appears that nobody asked for — but the historical bytes are pinned by
  // the wrapper-prefix test above, which asserts a literal.
  it("no --tools in a bare repo is claude only, and the files match the export exactly", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    for (const [name, content] of Object.entries(COMMAND_FILES)) {
      expect(await readFile(join(dir, ".claude", "commands", `${name}.md`), "utf8")).toBe(content);
    }
    for (const other of [".cursor", ".gemini", ".github", ".opencode", ".clinerules"]) {
      expect(existsSync(join(dir, other)), `${other} appeared without --tools`).toBe(false);
    }
  });

  it("--no-skills writes commands only; --no-commands writes skills only", async () => {
    const commandsOnly = await throwawayDir();
    expect(
      (await runLoam(commandsOnly, "init", "--docs", "./d", "--create", "--no-skills")).code,
    ).toBe(0);
    expect(existsSync(join(commandsOnly, ".claude", "commands", "loam-check.md"))).toBe(true);
    expect(existsSync(join(commandsOnly, ".claude", "skills"))).toBe(false);

    const skillsOnly = await throwawayDir();
    expect(
      (await runLoam(skillsOnly, "init", "--docs", "./d", "--create", "--no-commands")).code,
    ).toBe(0);
    expect(existsSync(join(skillsOnly, ".claude", "commands"))).toBe(false);
    expect(existsSync(join(skillsOnly, ".claude", "skills", "loam-check", "SKILL.md"))).toBe(true);
  });

  it("both suppressions together write nothing, and report no tools", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--no-commands", "--no-skills", "--json",
    );
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    const json = JSON.parse(res.stdout);
    expect(json.tools).toEqual([]);
    // the docs-repo half still happens
    expect(existsSync(join(dir, "d", "AGENTS.md"))).toBe(true);
  });

  it("never overwrites another tool's edited command either", async () => {
    const dir = await throwawayDir();
    await mkdir(join(dir, ".cursor", "commands"), { recursive: true });
    const mine = "my own cursor /loam-check\n";
    await writeFile(join(dir, ".cursor", "commands", "loam-check.md"), mine, "utf8");

    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "cursor", "--json");
    expect(res.code).toBe(0);
    expect(await readFile(join(dir, ".cursor", "commands", "loam-check.md"), "utf8")).toBe(mine);
    const json = JSON.parse(res.stdout);
    expect(
      json.skipped.some((p: string) => p.endsWith(join(".cursor", "commands", "loam-check.md"))),
    ).toBe(true);
    // the untouched siblings are still laid down
    expect(existsSync(join(dir, ".cursor", "commands", "loam-feature.md"))).toBe(true);
  });

  it("a second init --tools all skips exactly what the first created, same paths, same order", async () => {
    const dir = await throwawayDir();
    const first = JSON.parse(
      (await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all", "--json")).stdout,
    );
    const second = JSON.parse(
      (await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all", "--json")).stdout,
    );
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(first.created);
  });

  it("an unknown tool id is refused — invalid-option naming it and the supported list, nothing scaffolded", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "cursor,roomba", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("roomba");
    expect(json.error.message).toContain("claude");
    // refused before anything was written — a typo must not half-initialize
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
    expect(existsSync(join(dir, "d"))).toBe(false);
    expect(existsSync(join(dir, "loam.json"))).toBe(false);
  });

  it("--tools with an empty value is refused, not silently claude", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", ",", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });

  it("duplicate ids collapse: --tools cursor,cursor writes each file once and reports cursor once", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "cursor,cursor", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.tools).toEqual(["cursor"]);
    const cursorFiles = json.created.filter((p: string) => p.includes(".cursor"));
    expect(cursorFiles).toEqual([...new Set(cursorFiles)]);
  });

  it("--tools with --no-commands is a contradiction, refused", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--no-commands", "--tools", "cursor", "--json",
    );
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("--no-commands");
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
  });

  it("--tools with --no-skills is the same contradiction, refused the same way", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--no-skills", "--tools", "cursor", "--json",
    );
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("--no-skills");
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
  });

  it("--tools with both suppressions names both in the refusal", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create",
      "--no-commands", "--no-skills", "--tools", "cursor", "--json",
    );
    expect(res.code).toBe(1);
    const message = JSON.parse(res.stdout).error.message;
    expect(message).toContain("--no-commands");
    expect(message).toContain("--no-skills");
  });
});

describe("the contract's claims are checked against the CLI, not asserted", () => {
  it("'every command takes --json' is true of every registration in src/commands/", async () => {
    // The sentence was written when it was aspiration; archive and init closed
    // the gap. This keeps it a fact: a new command without --json fails here.
    expect(AGENTS_MD).toContain("Every command takes `--json`");
    const commandsDir = new URL("../src/commands/", import.meta.url);
    const files = (await readdir(commandsDir)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    let registrations = 0;
    for (const f of files) {
      const src = await readFile(new URL(f, commandsDir), "utf8");
      // Registrations, not files — counted per `.command(`, because a module is
      // allowed to declare more than one (migrate-openspec.ts registers both
      // `audit-openspec` and `migrate-openspec`) and a per-file tally would
      // silently owe the program a command it never counted.
      //
      // `commands/` also holds shared policy that registers nothing — the
      // docs-repo refusals every reading command owes (docs-repo-gate.ts) live
      // here rather than in core because they call `fail` and decide how the
      // process ends. A module that declares no `.command(` declares no flags
      // either, so the claim does not reach it.
      const declared = src.match(/\.command\(/g)?.length ?? 0;
      if (declared === 0) continue;
      registrations += declared;
      expect(src, `${f} registers no --json flag — the AGENTS.md claim is now false`).toContain(
        '.option("--json"',
      );
    }
    // The floor is the CLI itself, not a number written down here. The old
    // `toBeGreaterThan(0)` was satisfied by any single surviving match, so the
    // accommodation above became a hole: a command module that stopped matching
    // `.command(` — a registration moved behind a helper, a builder, a differently
    // spelled call — simply dropped out of the scan, took its `--json` obligation
    // with it, and this test stayed green while the AGENTS.md sentence went false.
    // buildProgram() is the list of commands loam actually ships (that is why
    // src/cli.ts exports it), so every one of them must have been one of the
    // registrations read above — no file skipped by name, and none skipped by
    // accident either.
    expect(
      registrations,
      "a command loam registers was not seen by the `.command(` scan — the --json claim is unchecked for it",
    ).toBe(buildProgram().commands.length);
  });

  it("teaches the real usage-error contract: with --json even parser errors arrive as the envelope", () => {
    // The old paragraph taught a pre-exitOverride carve-out ("refused as plain
    // text ... unparseable output with exit 1 means the INVOCATION was wrong")
    // that commit 0fdbb4b inverted: cli-entry.test.ts pins that a mistyped flag
    // WITH --json yields {ok:false, error.code:"invalid-option"} on stdout.
    // The contract file must describe the binary that ships it.
    expect(AGENTS_MD).not.toMatch(/as plain text — so unparseable/);
    expect(AGENTS_MD).toMatch(/unknown flag[\s\S]{0,200}invalid-option/);
    expect(AGENTS_MD).toMatch(/--help.*--version.*pass through/s);
  });

  it("states --strict honestly: errors and warnings trip it, ok confirmations never do", () => {
    expect(AGENTS_MD).not.toMatch(/any finding\s+exists at all/);
    expect(AGENTS_MD).toMatch(/any error\s+or warning exists/);
    expect(AGENTS_MD).toMatch(/`ok`-severity findings are confirmations and never trip/);
  });

  it("does not overclaim runner exclusivity: --record without --results is the documented fallback", () => {
    expect(AGENTS_MD).not.toMatch(/no agent can SAY a scenario is tested/);
    expect(AGENTS_MD).toMatch(/ALWAYS pass `--results`/);
    // Asserted without the line wrap: the claim is the sentence, not its reflow.
    expect(AGENTS_MD).toMatch(/`--record` without `--results` is\s+the fallback/);
    expect(AGENTS_MD).toMatch(/answered_by: agent/);
    // The fallback is visible, and says what it costs.
    expect(AGENTS_MD).toMatch(/\*\*attested\*\*, not verified/);
    expect(AGENTS_MD).toContain("`verify.scenario-attested`");
  });
});

describe("the gate model reaches the docs", () => {
  it("AGENTS.md explains the two axes: severity for validate, gating for archive", () => {
    expect(AGENTS_MD).toContain("Severity and gating are two different questions");
    expect(AGENTS_MD).toMatch(/Advisory warnings never block/);
    expect(AGENTS_MD).toContain("overrides the gating issues — only those");
    // the one diverging code is named where the axes are explained
    expect(AGENTS_MD).toMatch(/delta\.requirement-not-merged[\s\S]{0,200}gates/);
    // the two plan-time codes live where the gate is explained
    expect(AGENTS_MD).toContain("living.requirement-outside-requirements");
    expect(AGENTS_MD).toContain("openapi.op-modified");
  });

  it("/loam-ship drives archive --json and branches on the stable codes", () => {
    const ship = COMMAND_BODIES["loam-ship"]!;
    expect(ship).toContain("loam archive $1 --json");
    expect(ship).toContain("--dry-run");
    for (const code of [
      "not-coherent",
      "living-outside-requirements",
      "archive-exists",
      "merge-failed",
      "rollback-incomplete",
    ]) {
      expect(ship, `loam-ship does not branch on ${code}`).toContain(`\`${code}\``);
    }
    // the split, stated where the agent reads it mid-flow
    expect(ship).toMatch(/warnings never block/i);
  });
});

describe("the /loam-check vocabulary", () => {
  it("carries the service-mode and phase-1/2 codes agents actually hit, organized by invocation", () => {
    const check = COMMAND_BODIES["loam-check"]!;
    for (const code of [
      // service-mode codes the table used to omit
      "service.no-model",
      "spine.op-undefined",
      "api.ungoverned",
      "frontmatter.field-missing",
      "spine.landscape-invalid",
      // phase-1/2 codes that were nowhere
      "service.unknown",
      "delta.no-delta-sections",
      "delta.nothing-tagged",
      "delta.added-near-duplicate",
      "sources.unverifiable-from-here",
      "living.requirement-outside-requirements",
    ]) {
      expect(check, `loam-check table is missing ${code}`).toContain(`\`${code}\``);
    }
    // organized by mode: each invocation gets its own table
    for (const header of ["--service <id>", "--feature <FEAT-id>", "--all", "loam archive"]) {
      expect(check).toContain(header);
    }
  });
});

describe("the abandonment path", () => {
  it("AGENTS.md says how to drop a feature, and that archived ones go through unarchive first", () => {
    expect(AGENTS_MD).toContain("git rm -r features/");
    expect(AGENTS_MD).toMatch(/never archived/);
    expect(AGENTS_MD).toContain("loam unarchive");
  });
});

describe("the version stamp — drift detection, never refresh", () => {
  interface Finding {
    severity: string;
    code: string;
    message: string;
  }
  interface Target {
    kind: string;
    id: string;
    valid: boolean;
    findings: Finding[];
  }
  const staleFindings = (payload: { targets: Target[] }): Finding[] =>
    payload.targets.flatMap((t) => t.findings.filter((f) => f.code === "agents.stale"));

  it("the stamp line is a LITERAL on-disk contract, pinned byte for byte", () => {
    // Every other assertion here builds its expectation by calling
    // agentsStampLine, so a reworded stamp plus its reworded regex would stay
    // green — while every AGENTS.md already initialized (including the ones
    // hand-bumped per the documented remedy below) would start warning "no
    // version stamp". If this fails you are changing a cross-version on-disk
    // format: teach STAMP_RE both spellings first, then bump this literal
    // deliberately.
    expect(agentsStampLine("0.0.0")).toBe("<!-- generated by loam v0.0.0 -->");
    // and the parser reads exactly those bytes back
    expect(agentsStampVersion("<!-- generated by loam v0.0.0 -->\n# Working in this docs repo\n")).toBe("0.0.0");
  });

  it("init writes the stamp, and validate --all on a fresh repo is quiet", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    // line 1, exactly the running binary's version — equal stamp, no finding
    expect(agents.split("\n")[0]).toBe(agentsStampLine(LOAM_VERSION));

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(res.code).toBe(0);
    expect(staleFindings(JSON.parse(res.stdout))).toEqual([]);
  });

  it("a removed stamp warns once — as the repo's finding, not any service's — and does not invalidate", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const path = join(dir, "d", "AGENTS.md");
    const withoutStamp = (await readFile(path, "utf8")).split("\n").slice(1).join("\n");
    await writeFile(path, withoutStamp, "utf8");

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(res.code).toBe(0); // a warning, not an error
    const payload = JSON.parse(res.stdout);
    expect(payload.valid).toBe(true);
    const stale = staleFindings(payload);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.severity).toBe("warn");
    expect(stale[0]!.message).toContain("no version stamp");
    // it belongs to the docs repo as a whole, so it rides the landscape target
    expect(
      payload.targets.find((t: Target) => t.findings.some((f) => f.code === "agents.stale")).kind,
    ).toBe("landscape");
  });

  it("hand-bumping the stamp silences it — the documented remedy for a curated file", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const path = join(dir, "d", "AGENTS.md");
    await writeFile(path, `${agentsStampLine(LOAM_VERSION)}\n# our own house rules\n`, "utf8");

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(staleFindings(JSON.parse(res.stdout))).toEqual([]);
  });

  it("a stamp NEWER than the binary is quiet: that is an old binary, not a stale file", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const path = join(dir, "d", "AGENTS.md");
    await writeFile(path, `${agentsStampLine("99.99.99")}\n# from the future\n`, "utf8");

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(staleFindings(JSON.parse(res.stdout))).toEqual([]);
  });

  it("rides the real landscape target when one exists, alongside its findings", async () => {
    const p = await makeProject(coherentFixture());
    cleanups.push(() => p.destroy());
    await p.write("AGENTS.md", "# hand-written, no stamp\n");

    const res = await runLoam(p.workDir, "validate", "--all", "--json");
    const payload = JSON.parse(res.stdout);
    const landscape = payload.targets.find((t: Target) => t.kind === "landscape");
    expect(landscape.id).toBe("landscape");
    const codes = landscape.findings.map((f: Finding) => f.code);
    // the fixture's own landscape finding (checkout-web has no directory) still leads
    expect(codes).toContain("landscape.service-undocumented");
    expect(codes).toContain("agents.stale");
    // exactly one landscape target: the finding joined it instead of forking a twin
    expect(payload.targets.filter((t: Target) => t.kind === "landscape")).toHaveLength(1);
  });

  // The binary sits at the version floor today, so "stamp lower than binary"
  // cannot be staged through the CLI — the comparison is pinned at the unit
  // seam validate calls instead.
  it("a stamp that trails the binary warns, naming both versions", () => {
    const stamped = `${agentsStampLine("0.0.0")}\n# Working in this docs repo\n`;
    const f = agentsStaleFinding(stamped, "0.2.0");
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("warn");
    expect(f!.code).toBe("agents.stale");
    expect(f!.message).toContain("v0.0.0");
    expect(f!.message).toContain("v0.2.0");
    expect(f!.message).toContain("--help");
  });

  it("an equal stamp, a missing file, and an unreadable stamp each resolve the documented way", () => {
    const at = (v: string): string => `${agentsStampLine(v)}\nbody\n`;
    // equal: quiet
    expect(agentsStaleFinding(at("0.2.0"), "0.2.0")).toBeNull();
    // no AGENTS.md at all: no contract to have drifted — silence, not a second meaning
    expect(agentsStaleFinding(null, "0.2.0")).toBeNull();
    // a stamp that does not read as a version is indistinguishable from none
    expect(agentsStaleFinding(at("yesterday"), "0.2.0")!.message).toContain("no version stamp");
    // the comparison itself: numeric fields, not string order
    expect(versionTrails("0.9.0", "0.10.0")).toBe(true);
    expect(versionTrails("1.0.0", "0.10.0")).toBe(false);
  });

  it("compares the prerelease line too — that is where a generated file's FORM moves", () => {
    // The bump this existed for and could not see. 0.1.0-beta.2 is the release
    // that turned every generated file from embedded protocol text into a
    // pointer at `loam instructions`, with a CHANGELOG telling readers to delete
    // the files and re-run `loam init`; comparing the numeric triple alone made
    // beta.1 and beta.2 indistinguishable, so the one upgrade that most needed
    // the warning was the one bump shape that could never raise it.
    expect(versionTrails("0.1.0-beta.1", "0.1.0-beta.2")).toBe(true);
    expect(versionTrails("0.1.0-beta.2", "0.1.0-beta.1")).toBe(false);
    expect(versionTrails("0.1.0-beta.2", "0.1.0-beta.2")).toBe(false);
    // numeric identifiers compare numerically, not as strings
    expect(versionTrails("0.1.0-beta.9", "0.1.0-beta.10")).toBe(true);
    // semver's other two rules: a prerelease trails its own final release, and
    // alphanumeric outranks numeric at the same position
    expect(versionTrails("0.1.0-beta.2", "0.1.0")).toBe(true);
    expect(versionTrails("0.1.0", "0.1.0-beta.2")).toBe(false);
    expect(versionTrails("0.1.0-1", "0.1.0-alpha")).toBe(true);
    // a longer identifier list outranks a prefix of itself
    expect(versionTrails("0.1.0-beta", "0.1.0-beta.1")).toBe(true);
    // and the release triple still wins over any suffix
    expect(versionTrails("0.1.0", "0.2.0-beta.1")).toBe(true);
    expect(versionTrails("0.2.0-beta.1", "0.1.0")).toBe(false);
  });

  it("reports a stale AGENTS.md across a prerelease bump, end to end", () => {
    const at = (v: string): string => `${agentsStampLine(v)}\nbody\n`;
    expect(agentsStaleFinding(at("0.1.0-beta.1"), "0.1.0-beta.2")!.message)
      .toContain("written by loam v0.1.0-beta.1");
    expect(agentsStaleFinding(at("0.1.0-beta.2"), "0.1.0-beta.2")).toBeNull();
  });
});

describe("the documented cycle actually runs", () => {
  it("new -> validate -> delta -> archive works end to end as AGENTS.md describes it", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");

    const created = await runLoam(dir, "new", "FEAT-1", "--title", "Split", "--new-service", "svc-a");
    expect(created.code).toBe(0);

    const validated = await runLoam(dir, "validate", "--feature", "FEAT-1");
    expect(validated.code).toBe(0);

    const projected = await runLoam(dir, "delta", "FEAT-1", "--service", "svc-a", "--json");
    expect(projected.code).toBe(0);
    expect(JSON.parse(projected.stdout).architecture.isNew).toBe(true);

    const shipped = await runLoam(dir, "archive", "FEAT-1");
    expect(shipped.code).toBe(0);
    expect(existsSync(join(dir, "d", "features", "archive", "FEAT-1-split"))).toBe(true);
    expect(existsSync(join(dir, "d", "services", "svc-a", "spec.md"))).toBe(true);
  });
});
