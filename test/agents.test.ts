/**
 * Tests for the agent contract that `loam init` lays down
 * (src/core/agent/, wired through src/core/docs.ts and src/commands/init.ts).
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
import { createHash } from "node:crypto";
import { coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";
import { PROTOCOLS as COMMAND_BODIES, REFERENCE_PAGES } from "../src/core/agent/protocol.js";
import { SLASH_COMMANDS as COMMAND_FILES } from "../src/core/agent/scaffold.js";
import { AGENT_TOOLS } from "../src/core/agent/tools/registry.js";
import { UNAPPROVED } from "../src/core/agent/tools/dialects.js";
import { buildProgram } from "../src/cli.js";
import {
  agentsStaleFinding,
  agentsStampLine,
  agentsStampVersion,
  versionTrails,
} from "../src/core/agent/agents-stamp.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";

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

  it("defines service as a topology-neutral governed boundary", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("source of truth for a governed software");
    expect(agents).toContain("may be a modular monolith, a network service, a CLI or a worker");
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

  it("tells the agent how to READ the protocol it points at, not only to run it", async () => {
    // The generated check pointer itself selects the compact protocol. The
    // prose explains how to expand it deliberately and how to fetch one code,
    // so a model cannot accidentally pay for the 84 KB table on every run.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const clauses = [
      "loam instructions loam-check --no-fix-tables",
      "`loam explain <code>` for each code the run actually reports",
    ];
    // Both deliveries, because a skill that drifts from its command is two
    // contracts wearing one name — and it is the SKILL a model loads unasked.
    for (const segs of [
      [".claude", "commands", "loam-check.md"],
      [".claude", "skills", "loam-check", "SKILL.md"],
    ]) {
      const file = await readFile(join(dir, ...segs), "utf8");
      for (const clause of clauses) expect(file, `${segs.join("/")}: ${clause}`).toContain(clause);
    }
  });

  it("makes explicit commands and natural-language skills equivalent entry points", () => {
    const file = COMMAND_FILES["loam-feature"]!;
    expect(file).toContain("two equivalent chat entry points");
    expect(file).toContain("Agent Skill a natural-language request may load");
    expect(file).toContain("user type the internal loam commands one by one");
    for (const name of ["loam-feature", "loam-implement", "loam-check", "loam-verify", "loam-ship"]) {
      expect(AGENTS_MD).toContain(`/${name}`);
    }
    expect(AGENTS_MD).toContain("$loam-feature");
    expect(AGENTS_MD).toContain("Natural-language requests may load");
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
  // `command: null` is a skills-only target — Codex, which reads skills and
  // registers no command files at all, and `agents`, the vendor-neutral
  // `.agents/skills/` root several tools read in addition to their own; every
  // other tool declares both deliveries. The skill column is the Agent Skills
  // convention — `<tool-dir>/skills/<name>/SKILL.md` — and its directory is the
  // tool's OWN, which for cline is not the directory its commands go in.
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
    agents: { command: null, skill: [".agents", "skills", "loam-check", "SKILL.md"] },
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
    // and so is the vendor-neutral root, for the same reason: the six tools
    // that read `.agents/skills/` document no command file under `.agents/`, so
    // one written there would be bytes nothing ever opens.
    expect(existsSync(join(dir, ".agents", "skills", "loam-check", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "commands"))).toBe(false);
    expect(existsSync(join(dir, ".agents", "prompts"))).toBe(false);
  });

  it("the vendor-neutral root is detected by `.agents/skills`, never a bare `.agents/`", () => {
    // The same rule `github-copilot` is spelled out for: `.agents/` is a shared
    // root other conventions also write into, so a bare marker would
    // auto-scaffold into any repository where something else made the
    // directory. Pinned on the registry datum because that is where the
    // decision lives — a widened marker must fail here, not in a user's repo.
    expect(AGENT_TOOLS["agents"]!.detect).toEqual([".agents/skills"]);
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

  /** The `allowed-tools:` value a real `init` writes, read off the file on disk. */
  const emittedAllowlist = async (): Promise<string> => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const skill = await readFile(join(dir, ".claude", "skills", "loam-check", "SKILL.md"), "utf8");
    return /^allowed-tools: (.+)$/m.exec(skill)![1]!;
  };

  it("the pre-approved allowlist is an enumeration, and vouch is not in it", async () => {
    // `Bash(loam:*)` pre-approved the one command whose output is a claim about
    // a human act, which handed the agent that wrote a draft the power to
    // promote its own draft to `verified`. The refusal in commands/vouch.ts is
    // the other half; this is the half that makes the refusal something a person
    // sees rather than something an agent routes around.
    const allowed = await emittedAllowlist();

    expect(allowed).not.toContain("Bash(loam:*)");
    expect(allowed).not.toContain("vouch");
  });

  it("every loam verb the protocols instruct is pre-approved, or is named in UNAPPROVED", async () => {
    // The assertion that would have caught `steps`. The old spot check named
    // six verbs by hand and passed while `loam-implement` step 1 told the agent
    // to run `loam context` and step 5 called `loam steps` mandatory — both
    // unapproved, so the workflow stopped for a prompt at exactly the step its
    // own protocol calls required. Reading the instructions instead of a list
    // means the next protocol edit that reaches for a new verb fails here.
    //
    // Both corpora, because they instruct differently: PROTOCOLS is what
    // `loam instructions` prints, and SLASH_COMMANDS is the stub every
    // generated file carries — which is the only place `loam explain` is
    // taught, and it is the documented escape from an 84 KB protocol.
    const allowed = await emittedAllowlist();
    const registered = new Set(buildProgram().commands.map((c) => c.name()));
    const instructed = new Set<string>();
    for (const text of [...Object.values(COMMAND_BODIES), ...Object.values(COMMAND_FILES)]) {
      for (const [, verb] of text.matchAll(/`loam ([a-z][a-z-]*)/g)) {
        if (registered.has(verb!)) instructed.add(verb!);
      }
    }
    // A scan that matched nothing would satisfy every assertion below it.
    expect(instructed.size).toBeGreaterThan(10);
    for (const verb of [...instructed].sort()) {
      expect(
        allowed.includes(`Bash(loam ${verb}:*)`) || verb in UNAPPROVED,
        `the protocols instruct \`loam ${verb}\`, which is neither pre-approved nor in UNAPPROVED`,
      ).toBe(true);
    }
  });

  it("the allowlist is exactly the registered verbs minus UNAPPROVED — no silent third category", async () => {
    // dialects.ts may not compute this itself: deriving the list from the
    // command registry would make `core/` import `commands/`, which AGENTS.md
    // forbids. The TEST layer may do what core may not — it imports both sides
    // — so the equality core cannot express is checked here instead, and an
    // added command is either approved or explained rather than forgotten.
    const allowed = await emittedAllowlist();
    const registered = buildProgram().commands.map((c) => c.name());
    const emitted = [...allowed.matchAll(/Bash\(loam ([a-z][a-z-]*):\*\)/g)].map(([, v]) => v!);

    expect(emitted.sort()).toEqual(registered.filter((n) => !(n in UNAPPROVED)).sort());
    // and an exclusion is a decision about a real command, carrying a reason
    for (const [verb, why] of Object.entries(UNAPPROVED)) {
      expect(registered, `UNAPPROVED names \`${verb}\`, which loam does not register`).toContain(verb);
      expect(why.trim().length, `UNAPPROVED.${verb} has no reason written`).toBeGreaterThan(20);
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

  it("profiles install only the workflows a repository role needs", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--agent-profile", "docs", "--json",
    );
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.agentProfile).toBe("docs");
    expect(existsSync(join(dir, ".claude", "commands", "loam-feature.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "commands", "loam-check.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "commands", "loam-ship.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "commands", "loam-implement.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "skills", "loam-verify", "SKILL.md"))).toBe(false);
    const stored = JSON.parse(await readFile(join(dir, "loam.json"), "utf8"));
    expect(stored.agentProfile).toBe("docs");
  });

  it("refreshes a managed file only while its recorded digest still matches", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const path = join(dir, ".claude", "commands", "loam-check.md");
    const key = ".claude/commands/loam-check.md";
    const old = "<!-- generated by loam v0.0.0 -->\nold managed pointer\n";
    await writeFile(path, old, "utf8");
    const configPath = join(dir, "loam.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.agentFiles[key] = createHash("sha256").update(old).digest("hex");
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const res = await runLoam(dir, "init", "--json");
    const payload = JSON.parse(res.stdout);
    expect(payload.refreshed).toEqual([path]);
    expect(payload.skipped).not.toContain(path);
    expect(await readFile(path, "utf8")).toBe(COMMAND_FILES["loam-check"]);

    const customized = `${COMMAND_FILES["loam-check"]}\nTeam-specific note.\n`;
    await writeFile(path, customized, "utf8");
    const preserved = await runLoam(dir, "init", "--json");
    const preservedPayload = JSON.parse(preserved.stdout);
    expect(preservedPayload.refreshed).not.toContain(path);
    expect(preservedPayload.skipped).toContain(path);
    expect(await readFile(path, "utf8")).toBe(customized);
    const preservedConfig = JSON.parse(await readFile(configPath, "utf8"));
    expect(preservedConfig.agentFiles[key]).toBeUndefined();
  });

  it("refuses an unknown profile before writing any scaffold", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--create", "--agent-profile", "backend", "--json",
    );
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
    expect(existsSync(join(dir, "loam.json"))).toBe(false);
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

describe("AGENTS.md stays inside the budget its readers actually have", () => {
  /**
   * A ceiling, and now a REACHED one — which changes what it is for.
   *
   * AGENTS.md is auto-loaded from the working directory by every host that
   * reads agents.md, so its bytes are paid on every single invocation before
   * an agent has done anything. Two of those hosts truncate rather than
   * refuse, silently: Codex cuts the AGENTS.md chain at 32,768 bytes, and
   * Windsurf caps a workspace rule file at 12,000 characters. A file over
   * either limit loses its TAIL with no error at all — which is the archive
   * gate and the refusal vocabulary, the two sections an agent reaches last
   * and needs most.
   *
   * The file used to be 109,399 bytes and this ceiling used to be a bound on
   * how much worse it could get. Moving the four reference pages behind
   * `loam instructions` (src/core/agent/workflows/reference/reference.ts) put
   * it under the Codex cap for the first time, so the number is now that cap
   * rather than a made-up one, and clearing it is a property of the document
   * rather than an aspiration in a comment.
   *
   * The always-loaded file now clears Windsurf's smaller 12,000-character cap.
   * Detailed grammars and workflows are version-matched runtime resources;
   * this file keeps only enough to form the question and fetch the right one.
   */
  const CEILING = 12_000;

  it("the whole document fits in the smallest chain a host will read", () => {
    const bytes = Buffer.byteLength(AGENTS_MD, "utf8");
    expect(
      bytes,
      `AGENTS.md is ${bytes} B, over the ${CEILING} B smallest host cap. A host over this loses the TAIL ` +
        "silently. Find what is written twice, or what belongs " +
        "on a reference page, before raising it.",
    ).toBeLessThan(CEILING);
  });

  it("the per-invocation code inventory is not in the file at all", () => {
    // It is `loam instructions loam-codes` now. This is the assertion that the
    // move HAPPENED rather than being described: the inventory's own bullets
    // are the thing to look for, not the heading, because the heading stayed
    // behind on purpose (the three facts about the `--json` envelope are
    // orientation, and an agent needs them before it can form a question).
    const start = AGENTS_MD.indexOf("## Reading loam's output");
    expect(start, "the orientation section is gone or renamed").toBeGreaterThan(-1);
    const rest = AGENTS_MD.slice(start + 1);
    const next = rest.indexOf("\n## ");
    const section = next === -1 ? rest : rest.slice(0, next);
    const bytes = Buffer.byteLength(section, "utf8");
    expect(
      bytes,
      `\`## Reading loam's output\` is ${bytes} B. It is the three facts an agent needs BEFORE it ` +
        "can form a question; the inventory of which invocation raises which code belongs on " +
        "`loam instructions loam-codes`.",
    ).toBeLessThan(2_000);
    // The bullets themselves, sampled across the three modules the page is
    // assembled from, so a partial move fails as loudly as no move.
    for (const bullet of [
      "- `loam validate --service <id>` grades",
      "- `loam doctor` is read-only local/fleet preflight",
      "- `loam audit-openspec <root>`",
    ]) {
      expect(AGENTS_MD, `\`${bullet}…\` is back in AGENTS.md`).not.toContain(bullet);
    }
  });

  it("says out loud that the meanings live one command away", () => {
    // The pointer is what makes the missing gloss a design rather than a hole.
    // test/agent-contract.test.ts proves it resolves for every code named.
    expect(AGENTS_MD).toContain("`loam explain <code>`");
    expect(AGENTS_MD).toContain("`loam explain --codes --json`");
    expect(AGENTS_MD).toMatch(/Which codes an INVOCATION can raise/);
  });
});

/**
 * The reference pages, as a MECHANISM rather than as content.
 *
 * Two properties make the move a move instead of a deletion, and a future edit
 * can break either one alone — so they are asserted apart. Every page is
 * reachable by name from `loam instructions`, and `loam init` writes no file
 * for any of them. Merge the pages into `COMMANDS` and the first still passes
 * while the second fails; drop them from `PROTOCOLS` and the reverse.
 */
describe("the reference pages are printed, never scaffolded", () => {
  it("every page is reachable by name from the binary", async () => {
    const dir = await throwawayDir();
    expect(REFERENCE_PAGES.length).toBe(4);
    for (const page of REFERENCE_PAGES) {
      // Unwired on purpose: a page must print with no loam.json and no docs
      // repo, for the same reason the workflows must.
      const res = await runLoam(dir, "instructions", page.name);
      expect(res.code, `${page.name}: ${res.out}`).toBe(0);
      expect(Buffer.byteLength(res.stdout, "utf8")).toBeGreaterThan(5_000);
      // A page takes no arguments; the hint is empty rather than invented.
      expect(page.argumentHint).toBe("");
    }
  });

  it("AGENTS.md names each page with the exact command that prints it", () => {
    // A reference nobody can find is content deleted with extra steps. The
    // COMMAND is what is pinned, not a description of it: a renamed page has
    // to fail here rather than leave a pointer at nothing.
    for (const page of REFERENCE_PAGES) {
      expect(AGENTS_MD, `AGENTS.md never says \`loam instructions ${page.name}\``).toContain(
        `\`loam instructions ${page.name}\``,
      );
    }
  });

  it("init writes no file for any of them, in any tool's layout", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--create", "--tools", "all");
    expect(res.code, res.out).toBe(0);
    const written = (await readdir(dir, { recursive: true })).map(String);
    for (const page of REFERENCE_PAGES) {
      const hits = written.filter((f) => f.includes(page.name));
      expect(
        hits,
        `init wrote ${hits.join(", ")} for ${page.name}. The pages are printed by the binary; ` +
          "scaffolding them puts back the bytes the move took out, in every repo loam touches.",
      ).toEqual([]);
    }
    // The control: the six workflows ARE written, so an empty tree cannot pass
    // the assertion above by accident.
    expect(written.some((f) => f.includes("loam-check"))).toBe(true);
  });

  it("no page leaks into the generated-command corpus", () => {
    // The same property one level in, read off the exports rather than off a
    // scaffolded tree — this is the line a refactor actually crosses.
    for (const page of REFERENCE_PAGES) {
      expect(Object.keys(COMMAND_FILES)).not.toContain(page.name);
      expect(Object.keys(COMMAND_BODIES)).toContain(page.name);
    }
  });
});

describe("the contract's claims are checked against the CLI, not asserted", () => {
  it("'every command takes --json' is true of every registration in src/commands/", async () => {
    // The sentence was written when it was aspiration; archive and init closed
    // the gap. This keeps it a fact: a new command without --json fails here.
    expect(AGENTS_MD).toContain("Every command takes `--json`");
    const commandsDir = new URL("../src/commands/", import.meta.url);
    // Recursive, because a command module is allowed to be a package: `validate`
    // outgrew one file and became `commands/validate/`, and a flat readdir
    // stopped seeing its registration — the scan lost a command and the count
    // below is what said so. Any command that splits next is covered already.
    const files = (await readdir(commandsDir, { recursive: true })).filter((f) =>
      f.endsWith(".ts"),
    );
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

  // Both claims moved out of AGENTS.md when the reference pages were split
  // out, and they moved to DIFFERENT pages — which is why each names its own
  // rather than sharing one constant. `--strict` travels with the refusal
  // vocabulary onto `loam instructions loam-codes`; the recording form travels
  // with the done-check onto `loam instructions loam-done-check`. The text is
  // verbatim in both cases, so the assertions followed it rather than being
  // relaxed. Reading the PROTOCOL body and not the generated command file is
  // the same choice codes-drift makes: the file is a pointer, and the claim
  // lives in what it points at.
  const CODES = COMMAND_BODIES["loam-codes"]!;
  const DONE_CHECK = COMMAND_BODIES["loam-done-check"]!;

  it("states --strict honestly: errors and warnings trip it, ok confirmations never do", () => {
    expect(CODES).not.toMatch(/any finding\s+exists at all/);
    expect(CODES).toMatch(/any error\s+or warning exists/);
    expect(CODES).toMatch(/`ok`-severity findings are confirmations and never trip/);
  });

  it("does not overclaim runner exclusivity: --record without --results is the documented fallback", () => {
    expect(DONE_CHECK).not.toMatch(/no agent can SAY a scenario is tested/);
    expect(DONE_CHECK).toMatch(/ALWAYS pass `--results`/);
    // Asserted without the line wrap: the claim is the sentence, not its reflow.
    expect(DONE_CHECK).toMatch(/`--record` without `--results` is\s+the fallback/);
    expect(DONE_CHECK).toMatch(/answered_by: agent/);
    // The fallback is visible, and says what it costs.
    expect(DONE_CHECK).toMatch(/\*\*attested\*\*, not verified/);
    expect(DONE_CHECK).toContain("`verify.scenario-attested`");
  });

  it("AGENTS.md's step 7 still sends the reader to the page that holds it", () => {
    // The half of the move that makes the two tests above legitimate rather
    // than a relocation of the goalposts: a claim that is only on a page is
    // only reachable if the file names the page.
    expect(AGENTS_MD).toContain("`loam instructions loam-done-check`");
    // Step 7 itself, not merely the index — a reader following the cycle must
    // meet the pointer where the work is, not only in a list at the end.
    expect(AGENTS_MD).toMatch(/7\. \*\*Verify\*\*[\s\S]{0,900}loam instructions loam-done-check/);
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

describe("the version stamp — drift detection independent of safe refresh", () => {
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
  it("new -> author -> validate -> delta -> archive works end to end as AGENTS.md describes it", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--create");

    const created = await runLoam(dir, "new", "FEAT-1", "--title", "Split", "--new-service", "svc-a");
    expect(created.code).toBe(0);

    // The cycle's step 4 is AUTHORING, and it is gated, not advisory: the
    // scaffold as written must never archive. This is the regression the
    // placeholder gate exists for — the unauthored scaffold used to fold a
    // literal `TODO — name the behaviour` requirement into the living spec at
    // exit 0.
    const unauthored = await runLoam(dir, "archive", "FEAT-1");
    expect(unauthored.code).toBe(1);
    expect(existsSync(join(dir, "d", "services", "svc-a"))).toBe(false);

    const feat = join(dir, "d", "features", "FEAT-1-split");
    await writeFile(
      join(feat, "intent.md"),
      `---\nfeature: FEAT-1\ntitle: Split\nstatus: proposed\n---\n\n# Split\n\n## Why\n\nPayments arrive as one amount and need to land on several ledgers.\n\n## Scope\n\nsvc-a only.\n`,
    );
    const delta = await readFile(join(feat, "delta.likec4"), "utf8");
    await writeFile(
      join(feat, "delta.likec4"),
      delta.replace("TODO — what this service owns", "Owns payment splitting"),
    );
    await writeFile(
      join(feat, "specs", "svc-a", "spec.md"),
      `# svc-a — requirement delta for FEAT-1\n\n## ADDED Requirements\n\n### Requirement: Split a payment\nRequirement-ID: FEAT-1.svc-a.split\n\nThe service SHALL split a payment across ledgers.\n\n#### Scenario: Even split\n- **Given** a payment of 10\n- **When** it is split two ways\n- **Then** each ledger records 5\n`,
    );

    const validated = await runLoam(dir, "validate", "--feature", "FEAT-1");
    expect(validated.code).toBe(0);

    const projected = await runLoam(dir, "delta", "FEAT-1", "--service", "svc-a", "--json");
    expect(projected.code).toBe(0);
    expect(JSON.parse(projected.stdout).architecture.isNew).toBe(true);

    const shipped = await runLoam(dir, "archive", "FEAT-1");
    expect(shipped.code).toBe(0);
    expect(existsSync(join(dir, "d", "features", "archive", "FEAT-1-split"))).toBe(true);
    const living = await readFile(join(dir, "d", "services", "svc-a", "spec.md"), "utf8");
    expect(living).toContain("Split a payment");
    expect(living).not.toContain("TODO");
  });
});
