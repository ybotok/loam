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
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

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
