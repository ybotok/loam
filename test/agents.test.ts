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
import { makeTmpDir, runLoam } from "./helpers/harness.js";
import { AGENTS_MD, SLASH_COMMANDS as COMMAND_BODIES } from "../src/core/agent.js";

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

  it("names the one carve-out honestly: the option parser's own errors stay text", () => {
    expect(AGENTS_MD).toMatch(/option parser/);
    expect(AGENTS_MD).toMatch(/before loam runs/);
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
