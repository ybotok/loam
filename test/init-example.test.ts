/**
 * `loam init --example <dir>` — the answer to "show me a working one".
 *
 * The defect this command closed was that an INSTALLED loam carried no example
 * at all: `files[]` shipped `dist` plus eight Markdown pages, no verb in
 * `--help` was demo/example/tour/sample, and every `--dry-run` needs a docs
 * repo that already exists. So the claims graded here are the ones that make
 * the flag worth having rather than the ones that are easy to assert:
 *
 *   - the copy is BYTE-IDENTICAL to the shipped tree, directories included.
 *     Anything less and the example a user runs is not the example
 *     test/examples.test.ts pins, and the two can disagree without either
 *     going red.
 *   - the copy is RUNNABLE where it lands — `loam status` and
 *     `loam validate --all` from inside it, with no loam.json written by hand
 *     and none anywhere above it. That is the whole point: the shipped tree
 *     carries its own `{"docsDir": "."}`, so the copy needs no second one, and
 *     writing one here would put loam's bytes over the example's.
 *   - the three commands it PRINTS parse against the real program. The
 *     `command:` literals are also scraped by
 *     test/agent-commands-runnable.test.ts; what that suite cannot see is the
 *     rendered line — the `cd` prefix and the padding are applied at print
 *     time, and the rendered line is what a person copies.
 *   - each refusal, by `error.code`. `--example` binds no repository and
 *     scaffolds no agent files, so `--docs`, `--service`, `--create` and
 *     `--tools` are each a different command spelled on the same line rather
 *     than a modifier — and naming that matrix is what keeps this a flag
 *     instead of a second command hiding inside `init`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.js";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const SHIPPED = fileURLToPath(new URL("../examples/docs", import.meta.url));

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** A throwaway working directory with nothing — and no loam.json above it. */
async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir("loam-init-example-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The real program with every action replaced by a no-op, so parsing an
 * invocation has no side effects. The same construction
 * test/agent-commands-runnable.test.ts uses, and for the same reason: nothing
 * here re-declares a flag, because a second copy of the wiring would agree
 * with itself and with nothing else.
 */
function inertProgram(): Command {
  const program = buildProgram();
  const silence = { writeOut: () => {}, writeErr: () => {} };
  program.configureOutput(silence);
  for (const cmd of program.commands) {
    cmd.action(() => {});
    cmd.configureOutput(silence);
    cmd.exitOverride();
  }
  return program;
}

/**
 * The `loam …` half of every printed tour line — the optional `cd` prefix and
 * the `# why` comment removed.
 *
 * Anchored on the tour's own shape (four spaces, then optionally `cd <dir> &&`,
 * then the command, then the comment column) rather than on "a line mentioning
 * loam": the header above prints an absolute path into this repository, and a
 * loose match would read whatever the checkout happens to be called.
 */
function printedCommands(out: string): string[] {
  const commands: string[] = [];
  for (const raw of out.split("\n")) {
    const line = /^ {4}(?:cd \S+ && )?loam (.*?)\s+# /.exec(raw.replace(/\r$/, ""));
    if (line !== null) commands.push(line[1]!);
  }
  return commands;
}

/** `--example` combined with a flag that asks for a write it never makes. */
const CONTRADICTIONS: Array<[flag: string, args: string[]]> = [
  ["--docs", ["--docs", "./elsewhere"]],
  ["--service", ["--service", "payment-service"]],
  ["--create", ["--create"]],
  ["--tools", ["--tools", "all"]],
];

describe("init --example: the copy", () => {
  it("is byte-identical to the shipped example tree", async () => {
    // treeHashes keys directories too, so a directory the copy failed to make
    // is as visible as a changed byte. Byte-for-byte and not "parses the
    // same": the tree ships with whatever line endings the clone has, and a
    // copy that normalised them would hand the user a fleet whose digests
    // differ from the one the suite pins.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo");
    expect(res.code).toBe(0);
    expect(await treeHashes(join(dir, "demo"))).toEqual(await treeHashes(SHIPPED));
  });

  it("leaves no transaction journal behind — the copy is a committed transaction, not a cp", async () => {
    // The copy goes through the same journaled transaction every other loam
    // writer uses, so a killed run leaves `.loam-commit` naming every file. A
    // COMPLETED one must not: the journal is cleared on success, and a stray
    // one would make `loam doctor` report the fresh example as a half-written
    // repository. (The equality above would also catch it; this names the
    // failure so a reader knows which mechanism it belongs to.)
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--example", "./demo");
    const copied = await treeHashes(join(dir, "demo"));
    expect(Object.keys(copied).filter((p) => p.includes(".loam-commit"))).toEqual([]);
  });

  it("accepts a directory that exists and is empty", async () => {
    const dir = await throwawayDir();
    await mkdir(join(dir, "demo"), { recursive: true });
    const res = await runLoam(dir, "init", "--example", "./demo");
    expect(res.code).toBe(0);
  });

  it("short-circuits the governing-config guard: a loam.json in an ancestor does not refuse it", async () => {
    // `--example` writes a fresh tree; it does not join a system. The guard it
    // skips exists to stop a second loam.json shadowing the one above it for a
    // subtree — a rule about binding a repository, which this flag never does.
    // Refusing here would be loam declining to show itself working because of
    // a config with no bearing on the copy.
    const dir = await throwawayDir();
    await writeFile(join(dir, "loam.json"), `${JSON.stringify({ docsDir: "docs" }, null, 2)}\n`, "utf8");
    const sub = join(dir, "sub");
    await mkdir(sub, { recursive: true });

    const res = await runLoam(sub, "init", "--example", "./demo");
    expect(res.code).toBe(0);
    // The control: the same directory refuses a plain `init`, so the pass
    // above is the short-circuit and not an absent guard.
    const plain = await runLoam(sub, "init", "--json");
    expect(plain.code).toBe(1);
    expect(JSON.parse(plain.stdout).error.code).toBe("already-exists");
  });
});

describe("init --example: the copy is runnable where it lands", () => {
  it("`loam status` and `loam validate --all` both work inside it, with no config written by hand", async () => {
    // The reason this command exists: the printed follow-ups must not
    // reproduce the `no-config` refusal it was built to kill. Nothing writes a
    // loam.json here — the shipped tree carries its own `{"docsDir": "."}`,
    // and a second one written by the copy would put loam's bytes over the
    // example's.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--example", "./demo");
    const demo = join(dir, "demo");

    const status = await runLoam(demo, "status", "--json");
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout).services.total).toBe(5);

    const validate = await runLoam(demo, "validate", "--all", "--json");
    expect(validate.code).toBe(0);
    const payload = JSON.parse(validate.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.summary.errors).toBe(0);
  });

  it("every command it prints parses against the real program", async () => {
    // loam instructs; an instruction that does not parse is a defect, and
    // these three are the first an evaluating user ever types. Parsed as
    // RENDERED — `cd ./demo && loam status` is one printed line, and the `cd`
    // half is the only part that is not loam.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo");
    const commands = printedCommands(res.out);
    expect(commands).toEqual(["status", "validate --all", "show FEAT-101"]);

    for (const command of commands) {
      await expect(
        inertProgram().parseAsync(command.split(" "), { from: "user" }),
        `loam ${command} — printed by init --example and rejected by the CLI`,
      ).resolves.toBeDefined();
    }
  });
});

describe("init --example: the refusals", () => {
  it("refuses already-exists when the target exists and is not empty", async () => {
    const dir = await throwawayDir();
    await mkdir(join(dir, "demo"), { recursive: true });
    await writeFile(join(dir, "demo", "notes.md"), "mine\n", "utf8");

    const res = await runLoam(dir, "init", "--example", "./demo", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("already-exists");
    // And nothing was written over: --example never merges into a tree that is
    // already there, so the one file the caller had is still the only one.
    expect(Object.keys(await treeHashes(join(dir, "demo")))).toEqual(["notes.md"]);
  });

  it("refuses already-exists when the target exists and is not a directory", async () => {
    const dir = await throwawayDir();
    await writeFile(join(dir, "demo"), "occupied\n", "utf8");
    const res = await runLoam(dir, "init", "--example", "./demo", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("already-exists");
  });

  it.each(CONTRADICTIONS)("refuses invalid-option when combined with %s", async (flag, args) => {
    // Each of these asks for a write --example does not make: --docs and
    // --create name a docs repo to point at or scaffold, --service binds this
    // repository, --tools selects agent files to generate. Arbitrating between
    // them would be inventing which command the caller meant.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo", ...args, "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain(flag);
    // The refusal is a refusal: nothing was copied.
    expect(await treeHashes(dir)).toEqual({});
  });

  it("refuses the contradiction BEFORE grading a --service id, so the caller is told the real problem", async () => {
    // `--service` is validated at the top of init, ahead of every other guard.
    // Under `--example` the id is never used, so refusing it as malformed
    // would send the caller off to fix a name that is not the mistake.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo", "--service", "Not An Id", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("--example contradicts --service");
  });

  it("does not refuse --no-commands, --no-skills or --force: each only suppresses something it never does", async () => {
    // The contradiction matrix is four flags, not seven, and the line is which
    // ones ask for a DIFFERENT write. These three only ever subtract — a
    // refusal, a set of generated files — and --example generates none of it,
    // so none of them contradicts anything.
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo", "--no-commands", "--no-skills", "--force");
    expect(res.code).toBe(0);
    expect(await treeHashes(join(dir, "demo"))).toEqual(await treeHashes(SHIPPED));
  });
});

describe("init --example: the machine contract", () => {
  it("--json names the source, the target and every file written", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--example", "./demo", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("init");
    expect(payload.example.source).toBe(SHIPPED);
    expect(payload.example.dir).toBe(join(dir, "demo"));
    // Every file of the shipped tree, and nothing else. Directory keys are
    // dropped: `created` is a list of writes.
    const expected = Object.keys(await treeHashes(SHIPPED)).filter((p) => !p.endsWith("/"));
    expect((payload.created as string[]).length).toBe(expected.length);
    expect(payload.created).toContain(join(dir, "demo", "loam.json"));
  });
});
