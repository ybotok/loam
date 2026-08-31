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
import { PROTOCOLS } from "../src/core/agent/protocol.js";
import { SLASH_COMMANDS } from "../src/core/agent/scaffold.js";
import { parseFixRows, withoutFixTables } from "../src/core/explain/fix-tables.js";
import { explainSubject } from "../src/core/explain/lookup.js";
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

/**
 * The four reference pages, in the order AGENTS.md's own index names them.
 * They are on the menu but they are not workflows — see the separation test
 * below for why that distinction is asserted rather than assumed.
 */
const REFERENCE_NAMES = ["loam-codes", "loam-spine", "loam-authoring", "loam-done-check"];

describe("the menu", () => {
  it("lists the six workflows when asked for none", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions");
    expect(res.code, res.out).toBe(0);
    for (const name of WORKFLOW_NAMES) expect(res.out).toContain(name);
  });

  it("lists the reference pages too, and under their own heading", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions");
    expect(res.code, res.out).toBe(0);
    for (const name of REFERENCE_NAMES) expect(res.out).toContain(name);

    // The separation, not just the presence. These pages are the sections that
    // left the scaffolded AGENTS.md; they carry no steps, take no arguments and
    // are not part of the cycle. A flat list of ten names would read as a
    // ten-step process — the one thing the six-step cycle must not be confused
    // with — so every page has to fall AFTER the reference heading and every
    // workflow before it.
    const split = res.out.indexOf("reference pages");
    expect(split, "the pages are listed with nothing saying they are not workflows").toBeGreaterThan(
      -1,
    );
    for (const name of WORKFLOW_NAMES) {
      expect(res.out.indexOf(name), `${name} listed below the reference heading`).toBeLessThan(
        split,
      );
    }
    for (const name of REFERENCE_NAMES) {
      expect(res.out.indexOf(name), `${name} listed among the workflows`).toBeGreaterThan(split);
    }
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
    // A SECOND key, not six more entries in the first. A caller iterating
    // `workflows` to drive the cycle must not pick up documentation as steps,
    // and one that never learned about pages is unaffected by their arrival.
    expect(json.references.map((r: { name: string }) => r.name)).toEqual(REFERENCE_NAMES);
    // The three fields a caller needs to build its own menu: what to run, what
    // it is for, and what to pass. `argumentHint` is the one that maps onto the
    // positional arguments this same command substitutes.
    for (const w of [...json.workflows, ...json.references]) {
      expect(Object.keys(w).sort()).toEqual(["argumentHint", "description", "name"]);
      expect(typeof w.description).toBe("string");
      expect(w.description.length).toBeGreaterThan(0);
    }
    expect(json.workflows.find((w: { name: string }) => w.name === "loam-adopt").argumentHint).toBe(
      "<service-id>",
    );
    // A page takes nothing. The empty hint is what says so; an invented
    // "<none>" would read as an argument somebody could pass.
    for (const r of json.references) expect(r.argumentHint).toBe("");
  });

  it("every name it lists is one it will print — a menu of unreachable items is worse than none", async () => {
    const dir = await unwiredDir();
    for (const name of [...WORKFLOW_NAMES, ...REFERENCE_NAMES]) {
      const res = await runLoam(dir, "instructions", name);
      expect(res.code, `${name}: ${res.out}`).toBe(0);
      expect(res.out.length).toBeGreaterThan(0);
    }
  });

  it("a reference page prints whole, and `--no-fix-tables` is honest about having nothing to drop", async () => {
    // The flag exists for /loam-check, whose fix tables are 83 KB of the 84 it
    // prints. The pages carry no fix table — they are prose and bullets — so
    // the narrowed page is the page. Asserted rather than assumed because the
    // stripper and the parser share one block detection (core/explain/
    // fix-tables.ts): a grammar change that started matching a bullet list
    // would silently delete a reference page's body, and nothing else would
    // notice.
    const dir = await unwiredDir();
    for (const name of REFERENCE_NAMES) {
      const whole = await runLoam(dir, "instructions", name);
      const narrowed = await runLoam(dir, "instructions", name, "--no-fix-tables");
      expect(narrowed.code, `${name}: ${narrowed.out}`).toBe(0);
      expect(narrowed.stdout, `${name} lost content to --no-fix-tables`).toBe(whole.stdout);
      expect(parseFixRows(whole.stdout)).toEqual([]);
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

  it("treats the LITERAL placeholder as unsupplied, because three dialects substitute nothing", async () => {
    // One body serves twenty tool dialects and keeps Claude's `$1` convention
    // in all of them, so the generated stub says `loam instructions loam-adopt
    // $1` verbatim — and Cline, Kilo Code and Roo Code hand that `$1` straight
    // to this command. It used to refuse with `invalid-option` ('$1' is not a
    // service id), which failed the literal first instruction of the workflow.
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-adopt", "$1");
    expect(res.code, res.out).toBe(0);
    // The whole protocol, with the placeholder still reading "the service id
    // goes here" — the same page `loam instructions loam-adopt` prints.
    expect(res.out).toContain("$1");
    expect(res.out).toContain("loam init --docs");

    const json = await runLoam(dir, "instructions", "loam-adopt", "$1", "--json");
    expect(json.code, json.out).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, workflow: "loam-adopt" });
  });

  it("does the same for a two-placeholder stub, position by position", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-implement", "$1", "$2");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("$1");
    expect(res.out).toContain("$2");
  });

  it("still refuses a real argument that merely CONTAINS a placeholder", async () => {
    // The predicate is `^\$[1-9]$` and not "has a dollar in it". `FEAT-$1` is
    // something a caller typed, it is not a service id, and a protocol built
    // around it would name a target no loam command accepts.
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-adopt", "FEAT-$1", "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("invalid-option");
    expect(err.message).toContain("FEAT-$1");
    expect(err.message).toContain("no slashes");
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
    // the same sentence `loam adopt` would print — one grammar, in core/kernel/ids/service.ts
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

/**
 * `--no-fix-tables`, and the one property that makes narrowing safe.
 *
 * /loam-check prints 83,731 bytes — roughly 21k tokens, 223 fix-table rows —
 * and every generated command and skill file opens by telling an agent to run
 * it. An agent that obeys its own skill spends about a fifth of a 100k window
 * before the first check has run, and the rows it needs are the two or three
 * codes that run actually reported. `loam explain spine.op-undefined --json`
 * answers one of those in 473 bytes, which is the lazy path this flag makes
 * payable.
 *
 * The flag is opt-in and off by default because the six protocol pages are the
 * text agents are wired against; the first test is what makes "byte-identical
 * by default" a fact rather than an intention.
 */
describe("narrowing the protocol", () => {
  it("changes nothing by default — all six print the shipped body, byte for byte", async () => {
    const dir = await unwiredDir();
    for (const name of WORKFLOW_NAMES) {
      const res = await runLoam(dir, "instructions", name);
      expect(res.code, `${name}: ${res.out}`).toBe(0);
      // Against the shipped constant rather than a string recorded here: the
      // claim is "the default output did not move", and only the source of the
      // body can carry it. The trailing newlines are the command's own trim
      // (console.log adds one back).
      expect(res.stdout, name).toBe(PROTOCOLS[name]!.replace(/\n+$/, ""));
    }
  });

  it("drops every row and keeps every paragraph that says which scope graded it", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "instructions", "loam-check", "--no-fix-tables");
    expect(res.code, res.out).toBe(0);

    // The introducing paragraphs stay. They are not decoration: each one names
    // the scope its rows were graded in, and two codes mean different things in
    // two of them (`spec.merge-conflict` on a living document and on a delta of
    // it). Without them the surviving prose stops saying which run it describes.
    for (const intro of [
      "`--service <id>` — one service's own axes",
      "`--feature <FEAT-id>` — a change's three axes",
      "`--all` — everything above for every target",
      "`loam archive` — breaches the merge computation sees",
      "confirmations — the `ok`-severity findings",
    ]) {
      expect(res.stdout, intro).toContain(intro);
    }

    // …and not one table line survives, header or row.
    expect(res.stdout).not.toContain("| code | what it means | what to do |");
    expect(res.stdout.split("\n").filter((line) => line.startsWith("|"))).toEqual([]);
    // Each collapsed block says what went and how to get it back — and the
    // counts are DERIVED from the full body rather than typed here. A literal
    // ("95 rows") is a test that has to be remembered: adding one fix-table row
    // reddens it with an off-by-one that says nothing about the behaviour under
    // test, which is that every dropped row is accounted for and none is lost.
    const fullRows = PROTOCOLS["loam-check"]!.split("\n").filter((line) => line.startsWith("| `")).length;
    const omissions = [...res.stdout.matchAll(/\((\d+) rows? omitted — run `loam explain <code>`/g)];
    expect(omissions.length, "one collapsed line per table").toBeGreaterThan(1);
    expect(omissions.reduce((sum, m) => sum + Number(m[1]), 0)).toBe(fullRows);
    // and the singular is spelled as a singular, since one table has one row
    expect(res.stdout).toContain("(1 row omitted — run `loam explain <code>`");

    // It composes with `--json` instead of forking the envelope: the narrowed
    // page rides in the SAME `body` field, so no key is added or renamed. That
    // view needs it most — the whole table is one JSON string, which is why
    // `--json` is the larger of the two.
    const json = await runLoam(dir, "instructions", "loam-check", "--json", "--no-fix-tables");
    expect(json.code, json.out).toBe(0);
    const payload = JSON.parse(json.stdout);
    expect(Object.keys(payload).sort()).toEqual(
      ["args", "body", "command", "contractVersion", "ok", "version", "workflow"],
    );
    expect(payload.body).toBe(withoutFixTables(PROTOCOLS["loam-check"]!));
    expect(payload.body).not.toContain("| code |");
  });

  /**
   * The tripwire, and the reason the stripper shares the parser's block
   * detection instead of carrying a regex of its own.
   *
   * A narrowed protocol makes exactly one promise — that the rows it dropped
   * are reachable one at a time through `loam explain`. A stripper that
   * disagreed with the parser about where a table begins would break that
   * promise silently: the page would still read perfectly, and the codes it
   * told the agent to look up would not be there. So every code the narrowing
   * removes from a body is asked of the real lookup, and the SCOPE each row was
   * graded in is asked of the narrowed text — which is what convicts a strip
   * that ate an introducing paragraph along with its table.
   */
  it("every code it drops is still answerable by explainSubject, in a scope the page still names", () => {
    for (const [name, body] of Object.entries(PROTOCOLS)) {
      const rows = parseFixRows(body);
      const narrowed = withoutFixTables(body);

      if (rows.length === 0) {
        // Four of the six carry no fix table at all, so there is nothing to
        // narrow and the flag must be a no-op on them rather than a reformat.
        expect(narrowed, `${name} has no tables and must come back untouched`).toBe(body);
        continue;
      }

      const dropped = new Set<string>();
      for (const row of rows) {
        for (const code of row.codes) if (!narrowed.includes(code)) dropped.add(code);
        // The scope label comes from the paragraph above the table; the strip
        // keeps that paragraph, so the label is still findable in the page.
        expect(narrowed, `${name}: the intro naming '${row.scope}' went with its table`).toContain(
          row.scope,
        );
      }

      expect(dropped.size, `${name} narrowed and dropped no code at all`).toBeGreaterThan(0);
      for (const code of dropped) {
        const explanation = explainSubject(code);
        expect(explanation, `${name}: \`${code}\` is dropped and nothing explains it`).not.toBeNull();
        expect(explanation!.kind, code).toBe("finding");
      }
    }
  });

  it("drops the whole of /loam-check's corpus, so the tripwire above cannot pass vacuously", () => {
    // A floor, not the exact count: rows are added with new codes, and a test
    // that had to be edited for each one would be edited without being read.
    // What it convicts is a strip that quietly stopped stripping.
    const body = PROTOCOLS["loam-check"]!;
    expect(parseFixRows(body).length).toBeGreaterThan(200);
    const narrowed = withoutFixTables(body);
    expect(narrowed.length).toBeLessThan(body.length / 10);
  });
});
