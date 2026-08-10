/**
 * Tests for `loam instructions` (src/commands/instructions.ts) — the workflow
 * protocols, served from the binary rather than from a file somebody generated
 * once.
 *
 * The command is small, and every one of its properties is load-bearing for a
 * reason outside itself:
 *
 *  - it reads NOTHING. No loam.json, no docs repo, no service. An agent runs
 *    this in the first minute in an unfamiliar repository, and `loam-adopt`'s
 *    own first step is to run `loam init` when there is no config — so a
 *    protocol that refused with `no-config` would be unreachable exactly when it
 *    is most needed;
 *  - it substitutes `$1`, `$2`, … from the arguments, and LEAVES an unsupplied
 *    one standing, because the bodies are written so `$2` reads as "the title
 *    goes here" and a blanked one hands an agent a command that parses, runs,
 *    and asks a different question;
 *  - the list with no argument is the menu, so every name on it has to be a name
 *    the command will actually print.
 */
import { describe, expect, it, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { SLASH_COMMANDS } from "../src/core/agent.js";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A bare directory: no loam.json, no docs repo, nothing wired. */
async function unwiredDir(): Promise<string> {
  const dir = await makeTmpDir("loam-instructions-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const WORKFLOW_NAMES = [
  "loam-adopt",
  "loam-feature",
  "loam-implement",
  "loam-check",
  "loam-verify",
  "loam-ship",
];

describe("the menu", () => {
  it("lists the six workflows when asked for none", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions");
    expect(res.code, res.out).toBe(0);
    for (const name of WORKFLOW_NAMES) expect(res.out).toContain(name);
  });

  it("gives the machine the same menu, each entry named, described and hinted", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ contractVersion: "1.0", ok: true, command: "instructions" });

    // In cycle order — adopt, feature, implement, check, verify, ship — because
    // the list is also the order the work happens in.
    expect(json.workflows.map((w: { name: string }) => w.name)).toEqual(WORKFLOW_NAMES);
    // The three fields a caller needs to build its own menu: what to run, what
    // it is for, and what to pass. `argumentHint` is the one that maps onto the
    // positional arguments this same command substitutes.
    for (const w of json.workflows) {
      expect(Object.keys(w).sort()).toEqual(["argumentHint", "description", "name"]);
      expect(typeof w.description).toBe("string");
      expect(w.description.length).toBeGreaterThan(0);
    }
    expect(json.workflows.find((w: { name: string }) => w.name === "loam-adopt").argumentHint).toBe(
      "<service-id>",
    );
  });

  it("every name it lists is one it will print — a menu of unreachable items is worse than none", async () => {
    const dir = await unwiredDir();
    for (const name of WORKFLOW_NAMES) {
      const res = await runLoam(dir, "instructions", name);
      expect(res.code, `${name}: ${res.out}`).toBe(0);
      expect(res.out.length).toBeGreaterThan(0);
    }
  });
});

describe("placeholder substitution", () => {
  it("puts the argument where the protocol says $1 goes", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-adopt", "payment-service");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("loam adopt --service payment-service --json");
    expect(res.out).toContain("services/payment-service/");
    // Nothing is left holding the place once it has been filled.
    expect(res.out).not.toContain("$1");
  });

  it("leaves an unsupplied $2 STANDING rather than blanking it", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-feature", "FEAT-42");
    expect(res.code, res.out).toBe(0);
    // `loam-feature` spells the scaffold as `loam new $1 --title "$2"`. Given
    // only the id, the id is filled in and the title placeholder is not:
    expect(res.out).toContain(`loam new FEAT-42 --title "$2"`);
    // …because the alternative is `--title ""`, which is not a broken command an
    // agent stops at. It parses, it runs, and it scaffolds a feature with an
    // empty title — the failure is invisible until somebody reads `loam list`.
    expect(res.out).not.toContain(`--title ""`);
  });

  it("treats an EMPTY argument as unsupplied, because that is the shape a tool actually sends", async () => {
    const dir = await unwiredDir();
    // Several tool dialects expand an absent positional to the empty string,
    // and `loam-feature`'s own pointer line quotes its second one
    // (`--title "$2"`), so `/loam-feature FEAT-42` arrives here as
    // `["FEAT-42", ""]`. `??` counted that as supplied and blanked the
    // placeholder — reaching the exact failure the test above describes by the
    // one path that test did not cover.
    const res = await runLoam(dir, "instructions", "loam-feature", "FEAT-42", "");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`loam new FEAT-42 --title "$2"`);
    expect(res.out).not.toContain(`--title ""`);
  });

  it("fills both when both are given", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-feature", "FEAT-42", "Split payments");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`loam new FEAT-42 --title "Split payments"`);
    expect(res.out).not.toContain("$2");
  });

  it("hands the machine the substituted protocol, not the template", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-feature", "FEAT-42", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: true, command: "instructions", workflow: "loam-feature" });
    expect(json.args).toEqual(["FEAT-42"]);
    // A consumer re-implementing the substitution on its side would be a second
    // copy of the rule — including the rule about what an unsupplied one does.
    expect(json.body).toContain("loam validate --feature FEAT-42 --json");
    expect(json.body).toContain(`loam new FEAT-42 --title "$2"`);
  });
});

describe("refusals", () => {
  it("fails on a workflow nobody ships, and lists the ones it does", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-nope", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    // `unknown-target`, the same code `show` uses for a name resolving to
    // nothing — one breach, one code, whichever command met it.
    expect(json).toMatchObject({ ok: false, error: { code: "unknown-target" } });
    // The known set is small and closed, so it is listed: a caller that mistyped
    // one of six names should not need a second command to see them.
    for (const name of WORKFLOW_NAMES) expect(json.error.message).toContain(name);
  });
});

describe("the pointer the generated files carry", () => {
  it("runs every `loam instructions …` line loam writes into a command file", async () => {
    // The whole trade of the pointer form is that the file defers to this
    // command. A pointer whose one instruction exits 1 leaves an agent with no
    // protocol at all — a state the fat body could not reach — so every
    // invocation loam writes has to actually run. `loam-check`'s used to carry
    // a `$1` its body never uses, and the argument hint's FIRST form is
    // `--all`, so the file said `loam instructions loam-check --all`.
    const dir = await unwiredDir();
    for (const [name, file] of Object.entries(SLASH_COMMANDS)) {
      const line = file.split("\n").find((l) => l.trim().startsWith("loam instructions "));
      expect(line, `${name} carries no instructions line`).toBeDefined();
      // `$1`/`$2` stand for what a tool substitutes; a plausible value each.
      const argv = line!.trim().replace(/\$1/g, "FEAT-101").replace(/\$2/g, "payment-service");
      const res = await runLoam(dir, ...argv.split(/\s+/).slice(1));
      expect(res.code, `${name}: \`${argv}\` exited ${res.code}\n${res.out}`).toBe(0);
      expect(res.out.length).toBeGreaterThan(0);
    }
  });

  it("takes a leading-dash argument as data, because one validate target is spelled --all", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-check", "--all");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("loam validate --all --json");
    // …and a declared flag is still a flag, not swallowed as an argument.
    const json = await runLoam(dir, "instructions", "loam-check", "--json");
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout).workflow).toBe("loam-check");
  });
});

describe("what it reads", () => {
  it("succeeds in a directory with no loam.json at all", async () => {
    const dir = await unwiredDir();

    // The contrast is the point. Every other command needs the repo wired, and
    // says so here:
    const wired = await runLoam(dir, "list", "--json");
    expect(wired.code).toBe(1);
    expect(JSON.parse(wired.stdout).error.code).toBe("no-config");

    // …and this one does not, because the protocol it prints is the one whose
    // step 0 is `loam init`. It cannot be the step that requires an init.
    const res = await runLoam(dir, "instructions", "loam-adopt", "payment-service");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("loam init --docs");
  });
});

/**
 * It substitutes, and now it checks first.
 *
 * `loam instructions loam-adopt "$PWD"` — a shell habit, and one an agent
 * reaches for — rendered a protocol reading `services//Users/someone/work/svc/`
 * and `--service /Users/someone/…`, a whole page of confident instructions
 * built around a value no loam command will accept. The commands downstream all
 * refuse it, and refuse it well, so a bad brief could never become bad
 * documentation; the cost was a page of work done against a target that could
 * not exist, and the cheapest place to say so is the command that was told the
 * argument IS a service id.
 */
describe("the arguments it substitutes have to be the things they stand for", () => {
  it("refuses a path where a service id belongs, and prints no protocol at all", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-adopt", "/Users/someone/work/svc", "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("invalid-option");
    // the same sentence `loam adopt` would print — one grammar, in core/kernel/ids.ts
    expect(err.message).toContain("no slashes");
    expect(err.message).toContain("$1");
  });

  it("refuses a feature-id placeholder that is not one", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-ship", "the payments thing", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.message).toContain("FEAT-101");
  });

  it("leaves the free-text placeholder free — a feature title is any string", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-feature", "FEAT-101", "Split payments 50/50");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("Split payments 50/50");
  });

  it("still leaves an unsupplied placeholder standing", async () => {
    // The refusal must not have become "you did not pass one": a protocol
    // printed with `$1` in it reads as "the service id goes here", which is the
    // whole point of printing it before you know the id.
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-adopt");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("$1");
  });

  it("checks the position, not merely the presence: $2 of loam-implement is a service", async () => {
    const dir = await unwiredDir();
    const ok = await runLoam(dir, "instructions", "loam-implement", "FEAT-101", "payment-service");
    expect(ok.code, ok.out).toBe(0);

    const bad = await runLoam(dir, "instructions", "loam-implement", "FEAT-101", "../etc", "--json");
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).error.message).toContain("$2");
  });
});
