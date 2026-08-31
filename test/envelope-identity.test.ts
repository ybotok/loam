/**
 * The two keys that identify a `--json` envelope before its payload is read.
 *
 * `version` — the BINARY's version, and deliberately not `contractVersion`,
 * which is the envelope SHAPE's. Before it existed only `instructions` and
 * `explain` said which loam produced their output, so a consumer holding a
 * `status`, `validate`, `list`, `context` or `gate` payload could not apply the
 * caution `docs.binary-behind` exists to express — a green run from an old
 * binary is worth less than it looks — and could not see a mixed-version fleet
 * in the contract at all. OpenSpec documents the same shape as its own,
 * now-unfixable defect: one versioned surface out of many.
 *
 * `command` — the success payload's discriminator. It was on six commands and
 * missing from the rest, so an MCP host multiplexing envelopes (which is what
 * every tool result is) had to sniff for the presence of `valid` or `services`
 * to tell one answer from another.
 *
 * Both are checked against `buildProgram()` — the registry the binary itself
 * runs — rather than a list of command names written here, because a list
 * written here is one a new command can be added without touching, which is
 * exactly how `command` came to be on six commands out of twenty-nine.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../src/cli.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type RunResult } from "./helpers/harness.js";

const COMMANDS_DIR = fileURLToPath(new URL("../src/commands/", import.meta.url));

/** The registry, sorted once: every `loam <verb>` the binary actually ships. */
const REGISTERED = buildProgram()
  .commands.map((command) => command.name())
  .sort();

/**
 * Commands that answer with no envelope of their own. An entry here is a claim
 * about the command, not a place to park one that simply has no test yet.
 */
const NO_ENVELOPE = new Map<string, string>([
  [
    "mcp",
    "a stdio MCP server rather than a command that answers: it FORWARDS other commands' envelopes, "
      + "so the discriminator a host reads off a tool result is theirs, not one this command writes.",
  ],
]);

/** Every `.ts` under src/commands/, including the sub-packages. */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("the command discriminator", () => {
  /**
   * Read off the source rather than by running everything, because the claim is
   * about commands loam HAS, not about the ones a fixture happens to be able to
   * exercise: `seed`, `diff` and the two OpenSpec commands need fixtures of
   * their own, and their payloads owe the key just the same.
   *
   * Two call sites build their payload in a helper beside the emit
   * (`archive/run.ts`'s `payload()`, `vouch/pack/print.ts`'s `packPayload()`),
   * which is why the scan is per FILE: a payload assembled three lines away is
   * still this module's payload.
   */
  it("every command that answers in JSON names itself, and names a command loam registers", async () => {
    const named = new Set<string>();
    for (const path of await sourceFiles(COMMANDS_DIR)) {
      const source = await readFile(path, "utf8");
      if (!source.includes("emitJson(")) continue;
      const names = [...source.matchAll(/command: "([a-z-]+)"/g)].map((match) => match[1]!);
      expect(names, `${path} emits an envelope and names no command`).not.toEqual([]);
      for (const name of names) {
        expect(REGISTERED, `${path} names '${name}', which loam does not register`).toContain(name);
        named.add(name);
      }
    }
    expect([...named].sort()).toEqual(REGISTERED.filter((name) => !NO_ENVELOPE.has(name)));
  });
});

/**
 * How one command is driven to a success envelope.
 *
 * `run` executes inside a fresh `coherentFixture()` project — a sequence, so a
 * command whose subject has to exist first (`unarchive` needs something
 * archived) can say so; the LAST run is the one measured. `bare` runs in an
 * empty directory, for the one command whose whole job is that there is no
 * project yet. `unexercised` names the reason no invocation appears, and the
 * suite that owns the fixture instead.
 */
type Invocation =
  | { readonly run: readonly (readonly string[])[] }
  | { readonly bare: readonly string[] }
  | { readonly unexercised: string };

const FEATURE = "FEAT-1";
const SERVICE = "payment-service";

const INVOCATIONS: Record<string, Invocation> = {
  adopt: { run: [["adopt", "--json"]] },
  archive: { run: [["archive", FEATURE, "--dry-run", "--json"]] },
  "audit-openspec": { unexercised: "needs an OpenSpec tree; test/migrate-openspec-command.test.ts owns that fixture" },
  context: { run: [["context", SERVICE, "--json"]] },
  delta: { run: [["delta", FEATURE, "--json"]] },
  dependencies: { run: [["dependencies", "--json"]] },
  diff: { unexercised: "needs a committed base ref in the docs repo; test/diff.test.ts owns that fixture" },
  doctor: { run: [["doctor", "--json"]] },
  explain: { run: [["explain", "--json"]] },
  explore: { run: [["explore", SERVICE, "--json"]] },
  gate: { run: [["gate", "--json"]] },
  gherkin: { run: [["gherkin", FEATURE, "--dry-run", "--json"]] },
  init: { bare: ["init", "--docs", "./d", "--create", "--json"] },
  instructions: { run: [["instructions", "--json"]] },
  list: { run: [["list", "--json"]] },
  mcp: { unexercised: NO_ENVELOPE.get("mcp")! },
  "migrate-openspec": { unexercised: "needs an OpenSpec tree and a mapping file; test/migrate-openspec-command.test.ts owns that fixture" },
  new: { run: [["new", "FEAT-9", "--title", "A second feature", "--json"]] },
  open: { run: [["open", "--json"]] },
  rebase: { run: [["rebase", FEATURE, "--dry-run", "--json"]] },
  seed: { unexercised: "needs a fleet.yaml written for it; test/seed.test.ts owns that fixture" },
  show: { run: [["show", SERVICE, "--json"]] },
  status: { run: [["status", "--json"]] },
  steps: { run: [["steps", "--json"]] },
  subsystem: { run: [["subsystem", "list", "--json"]] },
  unarchive: { run: [["archive", FEATURE, "--approve"], ["unarchive", FEATURE, "--json"]] },
  validate: { run: [["validate", "--json"]] },
  verify: { run: [["verify", FEATURE, "--json"]] },
  vouch: { run: [["vouch", "--pack", "--json"]] },
};

const EXERCISED: Array<[string, Invocation]> = REGISTERED.map(
  (name) => [name, INVOCATIONS[name]!] as [string, Invocation],
).filter(([, invocation]) => !("unexercised" in invocation));

describe("the binary version on the envelope", () => {
  /**
   * The exhaustiveness guard, and the reason this file is worth its length: a
   * command added tomorrow with no entry here fails THIS test, not one three
   * releases later when somebody notices its envelope says nothing about which
   * loam wrote it.
   */
  it("the invocation table covers exactly the commands loam registers", () => {
    expect(Object.keys(INVOCATIONS).sort()).toEqual(REGISTERED);
  });

  it.each(EXERCISED)("%s stamps LOAM_VERSION and its own name on the success envelope", async (name, invocation) => {
    const project = "bare" in invocation ? null : await makeProject(coherentFixture(), { service: SERVICE });
    const bare = project === null ? await makeTmpDir() : null;
    const dir = project?.workDir ?? bare!;
    try {
      const runs = "bare" in invocation ? [invocation.bare] : invocation.run;
      let result: RunResult | undefined;
      for (const argv of runs) result = await runLoam(dir, ...argv);
      expect(result!.code, `loam ${name} did not succeed:\n${result!.out}`).toBe(0);
      const envelope = JSON.parse(result!.stdout) as Record<string, unknown>;
      expect(envelope["ok"]).toBe(true);
      // Not a regex over a version SHAPE: the point is that the envelope says
      // which build answered, and a shape assertion would pass for any of them.
      expect(envelope["version"], `loam ${name} stamped no binary version`).toBe(LOAM_VERSION);
      expect(envelope["command"], `loam ${name} did not name itself`).toBe(name);
      // Beside it, never inside it: the shape and the build version
      // independently, so a release does not read as a contract break.
      expect(envelope["contractVersion"]).toBe("1.0");
    } finally {
      if (project !== null) await project.destroy();
      if (bare !== null) await rm(bare, { recursive: true, force: true });
    }
  });
});

describe("the binary version on a refusal", () => {
  /**
   * A refusal is the envelope a consumer is most likely to be holding at the
   * moment the build matters — "this loam does not have that flag, that code,
   * that behaviour" is a question about the binary, and an unversioned refusal
   * makes it unanswerable.
   */
  it("carries version and contractVersion, and no command", async () => {
    const bare = await makeTmpDir();
    try {
      const result = await runLoam(bare, "status", "--json");
      expect(result.code).toBe(1);
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(envelope["ok"]).toBe(false);
      expect((envelope["error"] as { code: string }).code).toBe("no-config");
      expect(envelope["version"]).toBe(LOAM_VERSION);
      expect(envelope["contractVersion"]).toBe("1.0");
      // The deliberate absence, pinned so nobody "fixes" it: the error emitter
      // has no command in scope, and putting one there costs either
      // module-level mutable state — which leaks across the forked test
      // processes and across invocations in a long-running host — or one more
      // argument threaded through `fail()`, `reportNoConfig()` and every deep
      // helper that refuses. A consumer that needs to know which command
      // refused made the call itself.
      expect(envelope["command"]).toBeUndefined();
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
