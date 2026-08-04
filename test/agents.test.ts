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
import { AGENT_TOOLS, AGENTS_MD, SLASH_COMMANDS as COMMAND_BODIES } from "../src/core/agent.js";
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
    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, "d", "AGENTS.md"))).toBe(true);
    expect(res.out).toContain("AGENTS.md");
  });

  it("names every command in the cycle", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    for (const cmd of ["loam new", "loam delta", "loam validate", "loam archive", "loam show"]) {
      expect(agents).toContain(cmd);
    }
  });

  it("spells out the operationId spine — the part nobody guesses", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("operationId");
    expect(agents).toContain("Operations:");
    expect(agents).toContain("metadata { op");
  });

  it("says that archive is gated on coherence and how to override it", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents.toLowerCase()).toContain("coherence");
    expect(agents).toContain("--approve");
  });

  it("tells the agent to read the machine contract rather than the prose", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("--json");
  });

  it("separates what a human authors from what the CLI derives", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("intent.md");
    expect(agents).toContain("delta.likec4");
    expect(agents).toContain("spec.md");
  });

  it("is never overwritten once it exists", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const mine = "# our own house rules\n";
    await writeFile(join(dir, "d", "AGENTS.md"), mine, "utf8");
    const second = await runLoam(dir, "init", "--docs", "./d");
    expect(second.code).toBe(0);
    expect(await readFile(join(dir, "d", "AGENTS.md"), "utf8")).toBe(mine);
    expect(second.out).not.toContain("scaffolded");
  });
});

describe("slash commands in the working repo", () => {
  it("are written into .claude/commands/ of the repo init runs in", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    for (const name of SLASH_COMMANDS) {
      expect(existsSync(join(dir, ".claude", "commands", `${name}.md`))).toBe(true);
    }
  });

  it("each one drives real loam commands, not vibes", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const read = (n: string): Promise<string> =>
      readFile(join(dir, ".claude", "commands", `${n}.md`), "utf8");
    expect(await read("loam-feature")).toContain("loam new");
    expect(await read("loam-implement")).toContain("loam delta");
    expect(await read("loam-check")).toContain("loam validate");
    expect(await read("loam-ship")).toContain("loam archive");
  });

  it("--no-commands leaves the repo alone", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--no-commands");
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

    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    expect(await readFile(join(dir, ".claude", "commands", "loam-check.md"), "utf8")).toBe(mine);
    // the others are still laid down
    expect(existsSync(join(dir, ".claude", "commands", "loam-feature.md"))).toBe(true);
  });

  it("a second init reports nothing new", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    const second = await runLoam(dir, "init", "--docs", "./d");
    expect(second.out).not.toContain("scaffolded");
  });
});

describe("multi-tool command generation (init --tools)", () => {
  // Path expectations pinned as literals, per tool, for one probe command: a
  // moved path must fail HERE, not in some user's repo — and the registry
  // growing a tool must extend this table (the exactness test below).
  const CHECK_FILE: Record<string, string[]> = {
    claude: [".claude", "commands", "loam-check.md"],
    cursor: [".cursor", "commands", "loam-check.md"],
    "github-copilot": [".github", "prompts", "loam-check.prompt.md"],
    gemini: [".gemini", "commands", "loam", "check.toml"],
    opencode: [".opencode", "commands", "loam-check.md"],
    cline: [".clinerules", "workflows", "loam-check.md"],
  };

  it("the pinned path table covers exactly the registry — a new tool must be pinned here", () => {
    expect(Object.keys(CHECK_FILE).sort()).toEqual(Object.keys(AGENT_TOOLS).sort());
  });

  it("the claude wrapper is the historical byte format — description + argument-hint frontmatter", () => {
    // SLASH_COMMANDS derives through the claude adapter, so a reworded wrapper
    // would silently re-spell every already-initialized repo as unscaffolded.
    // The literal prefix pins the on-disk contract, not the derivation.
    expect(
      COMMAND_BODIES["loam-adopt"]!.startsWith(
        "---\n" +
          "description: Adopt a service — write its baseline docs from its code, as draft, then validate\n" +
          "argument-hint: <service-id>\n" +
          "---\n\n",
      ),
    ).toBe(true);
  });

  it("--tools all lays down every tool's files, each in its own dialect, all driving real loam commands", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", "all", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.tools).toEqual(Object.keys(AGENT_TOOLS));
    const read = (segs: string[]): Promise<string> => readFile(join(dir, ...segs), "utf8");
    for (const segs of Object.values(CHECK_FILE)) {
      expect(
        json.created.some((c: string) => c.endsWith(join(...segs))),
        `created is missing ${segs.join("/")}`,
      ).toBe(true);
      expect(await read(segs)).toContain("loam validate");
    }
    // the wrapper is the tool's own dialect, not claude's everywhere
    const claude = await read(CHECK_FILE["claude"]!);
    expect(claude).toMatch(/^---\ndescription: /);
    expect(claude).toContain("argument-hint:");
    expect(await read(CHECK_FILE["cursor"]!)).toMatch(/^---\nname: \/loam-check\n---\n\n/);
    const copilot = await read(CHECK_FILE["github-copilot"]!);
    expect(copilot).toMatch(/^---\ndescription: /);
    expect(copilot).not.toContain("argument-hint:");
    const gemini = await read(CHECK_FILE["gemini"]!);
    expect(gemini).toMatch(/^description = "/);
    expect(gemini).toContain('prompt = """');
    expect(gemini.endsWith('"""')).toBe(true);
    expect(await read(CHECK_FILE["opencode"]!)).toMatch(/^---\ndescription: /);
    // cline: a title line, no frontmatter block at the top (the body's own
    // markdown tables still carry `---` rows, so only the head is asserted)
    expect(await read(CHECK_FILE["cline"]!)).toMatch(/^# loam-check\n\n/);
  });

  it("--tools cursor,gemini replaces the default — no .claude/ appears", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", "cursor,gemini");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".cursor", "commands", "loam-feature.md"))).toBe(true);
    expect(existsSync(join(dir, ".gemini", "commands", "loam", "feature.toml"))).toBe(true);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    // the human output names what was generated for whom
    expect(res.out).toContain("commands:  cursor, gemini");
  });

  it("no --tools is the old behavior byte-for-byte: claude only, the exported bodies exactly", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
    for (const [name, content] of Object.entries(COMMAND_BODIES)) {
      expect(await readFile(join(dir, ".claude", "commands", `${name}.md`), "utf8")).toBe(content);
    }
    for (const other of [".cursor", ".gemini", ".github", ".opencode", ".clinerules"]) {
      expect(existsSync(join(dir, other)), `${other} appeared without --tools`).toBe(false);
    }
  });

  it("never overwrites another tool's edited command either", async () => {
    const dir = await throwawayDir();
    await mkdir(join(dir, ".cursor", "commands"), { recursive: true });
    const mine = "my own cursor /loam-check\n";
    await writeFile(join(dir, ".cursor", "commands", "loam-check.md"), mine, "utf8");

    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", "cursor", "--json");
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
      (await runLoam(dir, "init", "--docs", "./d", "--tools", "all", "--json")).stdout,
    );
    const second = JSON.parse(
      (await runLoam(dir, "init", "--docs", "./d", "--tools", "all", "--json")).stdout,
    );
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(first.created);
  });

  it("an unknown tool id is refused — invalid-option naming it and the supported list, nothing scaffolded", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", "cursor,roomba", "--json");
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
    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", ",", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });

  it("duplicate ids collapse: --tools cursor,cursor writes each file once and reports cursor once", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--tools", "cursor,cursor", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.tools).toEqual(["cursor"]);
    const cursorFiles = json.created.filter((p: string) => p.includes(".cursor"));
    expect(cursorFiles).toEqual([...new Set(cursorFiles)]);
  });

  it("--tools with --no-commands is a contradiction, refused", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(
      dir, "init", "--docs", "./d", "--no-commands", "--tools", "cursor", "--json",
    );
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("--no-commands");
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
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
    for (const f of files) {
      const src = await readFile(new URL(f, commandsDir), "utf8");
      expect(src, `${f} registers no --json flag — the AGENTS.md claim is now false`).toContain(
        '.option("--json"',
      );
    }
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
    expect(AGENTS_MD).toMatch(/`--record` without `--results` is\nthe fallback/);
    expect(AGENTS_MD).toMatch(/answered_by: agent/);
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
    await runLoam(dir, "init", "--docs", "./d");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    // line 1, exactly the running binary's version — equal stamp, no finding
    expect(agents.split("\n")[0]).toBe(agentsStampLine(LOAM_VERSION));

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(res.code).toBe(0);
    expect(staleFindings(JSON.parse(res.stdout))).toEqual([]);
  });

  it("a removed stamp warns once — as the repo's finding, not any service's — and does not invalidate", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
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
    await runLoam(dir, "init", "--docs", "./d");
    const path = join(dir, "d", "AGENTS.md");
    await writeFile(path, `${agentsStampLine(LOAM_VERSION)}\n# our own house rules\n`, "utf8");

    const res = await runLoam(dir, "validate", "--all", "--json");
    expect(staleFindings(JSON.parse(res.stdout))).toEqual([]);
  });

  it("a stamp NEWER than the binary is quiet: that is an old binary, not a stale file", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");
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
});

describe("the documented cycle actually runs", () => {
  it("new -> validate -> delta -> archive works end to end as AGENTS.md describes it", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d");

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
