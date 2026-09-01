/**
 * The version-2 journaled transaction: the record, the roll-FORWARD recovery,
 * and the boundaries a killed writer can actually stop at.
 *
 * Version 1 (`archive`/`unarchive`) recovers by UNDOING from a snapshot that
 * travels in the feature directory. None of the smaller writers — rebase,
 * vouch, new, gherkin — has one, so this journal records per file the digest of
 * both states plus the staged temp still holding the after-bytes, and recovery
 * carries the commit forward from what is already durable. What that has to be
 * worth, and what is pinned here:
 *
 *  - the record survives a round trip whole, and a record that cannot be
 *    trusted whole is graded as no record at all;
 *  - recovery from any boundary lands on the SAME tree a completed commit
 *    lands on, byte for byte — nothing swapped, half swapped, all swapped, and
 *    a half-finished deletion;
 *  - a file somebody edited since the crash, and a temp that is gone or no
 *    longer matches, are refused by name with nothing written — the
 *    refuse-to-choose doctrine, because completing over either destroys one of
 *    two truths;
 *  - the REAL command recovers before it does its own work, and says so;
 *  - every writer's stored `rerun` — the string `doctor` prints as the fix, and
 *    the one command string in loam that agent-commands-runnable.test.ts cannot
 *    see because it is journal DATA — parses against the real CLI;
 *  - a journal truncated mid-write is unreadable, and both certifying commands
 *    (`doctor`, `validate`) say so rather than grading the repo healthy.
 *
 * The technique is write-path-integrity.test.ts's `killMidCommit`, one version
 * up: drive stageWrites/writeTxnIntent/swapStaged(slice) to a chosen boundary
 * with the primitives, then either call recovery directly or run the real
 * command and watch it happen. No fault-injection hooks in src.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.js";
import { rollbackStaged, stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { COMMIT_INTENT, InterruptedCommitError } from "../src/core/staging/interrupted.js";
import { recoverForward } from "../src/core/staging/txn/forward.js";
import { readTxnIntent, writeTxnIntent, type TxnSpec } from "../src/core/staging/txn/journal.js";
import { sha256, type PlannedWrite, type StagedWrite } from "../src/core/staging/writes.js";
import {
  coherentFixture,
  LANDSCAPE,
  makeProject,
  makeTmpDir,
  runLoam,
  SERVICE_MODEL,
  treeHashes,
  writeFiles,
  type Project,
} from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/* ------------------------------------------------------------------ */
/* The scratch repo every boundary test commits into                   */
/* ------------------------------------------------------------------ */

const OLD_A = "# a\n\nthe bytes the killed run found\n";
const NEW_A = "# a\n\nthe bytes the killed run was writing\n";
const NEW_B = "# b\n\na file this commit creates\n";
const SIBLING = "a file no write in this suite touches\n";

/**
 * A repo in the PRE-state: `a/spec.md` as it was before the commit, plus a
 * sibling nothing plans to touch (so a stray directory prune or a too-wide
 * sweep shows up as a changed tree rather than passing unnoticed).
 */
async function preState(): Promise<string> {
  const root = await makeTmpDir("loam-txn-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "services/a/spec.md": OLD_A, "services/a/notes.md": SIBLING });
  return root;
}

/** The write set every boundary test drives: one overwrite, one create. */
function writeSet(root: string): PlannedWrite[] {
  return [
    { path: join(root, "services/a/spec.md"), content: NEW_A },
    { path: join(root, "services/b/spec.md"), content: NEW_B },
  ];
}

function txnSpec(root: string): TxnSpec {
  return { root, command: "rebase", rerun: "loam rebase FEAT-1", target: "FEAT-1" };
}

/**
 * Drive a journaled commit to a chosen boundary and stop there, exactly as a
 * SIGKILL between two renames would: the temps are on disk, the journal is
 * fsynced, and `opts.swaps` of the writes have landed.
 */
async function killMidTxn(
  root: string,
  writes: PlannedWrite[],
  opts: { swaps: number; spec?: TxnSpec },
): Promise<StagedWrite[]> {
  const staged = await stageWrites(writes);
  await writeTxnIntent(opts.spec ?? txnSpec(root), staged);
  await swapStaged(staged.slice(0, opts.swaps));
  return staged;
}

/** The tree a commit of `writeSet` that was never interrupted leaves behind. */
async function completedTree(): Promise<Record<string, string>> {
  const root = await preState();
  await swapStaged(await stageWrites(writeSet(root)));
  return treeHashes(root);
}

/** Recover `root`'s journal, or throw whatever the reader refuses with. */
async function recover(root: string) {
  const intent = await readTxnIntent(root);
  expect(intent, "the fixture must leave a readable v2 journal behind").not.toBeNull();
  return recoverForward(root, intent!);
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

describe("the version-2 journal", () => {
  it("round-trips every field a roll-forward needs", async () => {
    const root = await preState();
    const staged = await killMidTxn(root, writeSet(root), { swaps: 0 });

    const intent = await readTxnIntent(root);
    expect(intent).not.toBeNull();
    expect(intent).toMatchObject({
      version: 2,
      command: "rebase",
      rerun: "loam rebase FEAT-1",
      target: "FEAT-1",
      pid: process.pid,
    });
    expect(intent!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof intent!.host).toBe("string");

    // Paths are root-relative with forward slashes — the record must survive
    // being read on another machine, or under another checkout of this one.
    expect(intent!.files.map((f) => f.path)).toEqual(["services/a/spec.md", "services/b/spec.md"]);
    // The overwrite carries both digests; the create carries no before.
    expect(intent!.files[0]).toMatchObject({ before: sha256(OLD_A), after: sha256(NEW_A) });
    expect(intent!.files[1]).toMatchObject({ before: null, after: sha256(NEW_B) });
    // And the temp each after-digest is recoverable FROM, named relatively and
    // still on disk holding exactly those bytes.
    for (const [i, file] of intent!.files.entries()) {
      expect(file.tmp, file.path).not.toBeNull();
      expect(file.tmp!.startsWith("services/"), file.tmp!).toBe(true);
      expect(join(root, ...file.tmp!.split("/"))).toBe(staged[i]!.tmp);
      expect(sha256(await readFile(join(root, ...file.tmp!.split("/"))))).toBe(file.after);
    }
  });

  it("grades a record it cannot trust whole as no record at all", async () => {
    const root = await preState();
    await killMidTxn(root, writeSet(root), { swaps: 0 });
    const good = (await readTxnIntent(root))!;
    const path = join(root, COMMIT_INTENT);

    const broken: Array<[string, unknown]> = [
      // Version 1 is archive's snapshot journal: a DIFFERENT recovery, and the
      // v2 reader claiming it would roll a tree forward from temps that were
      // never staged.
      ["version 1", { ...good, version: 1 }],
      ["no version", { ...good, version: undefined }],
      ["a rerun that is not a string", { ...good, rerun: 42 }],
      ["no command", { ...good, command: undefined }],
      ["no target", { ...good, target: null }],
      ["a pid that is not a number", { ...good, pid: "4242" }],
      ["files that are not an array", { ...good, files: { "services/a/spec.md": "…" } }],
      ["a file with no path", { ...good, files: [{ ...good.files[0], path: undefined }] }],
      ["a before that is not a digest", { ...good, files: [{ ...good.files[0], before: "deadbeef" }] }],
      ["an after that is not a digest", { ...good, files: [{ ...good.files[0], after: 7 }] }],
      // A write with no temp recorded could never be rolled forward; the whole
      // record is refused so the impossibility is a `doctor` sentence rather
      // than a mid-recovery surprise.
      ["a write with no temp", { ...good, files: [{ ...good.files[0], tmp: null }] }],
    ];
    for (const [what, intent] of broken) {
      await writeFile(path, JSON.stringify(intent, null, 2) + "\n", "utf8");
      expect(await readTxnIntent(root), what).toBeNull();
    }

    // Not JSON at all — the shape a crash DURING the journal write leaves.
    await writeFile(path, '{"version":2,"command":"reba', "utf8");
    expect(await readTxnIntent(root)).toBeNull();
    // …and the control: the untouched record still reads.
    await writeFile(path, JSON.stringify(good, null, 2) + "\n", "utf8");
    expect(await readTxnIntent(root)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Recovery, boundary by boundary                                      */
/* ------------------------------------------------------------------ */

describe("roll-forward recovery at every commit boundary", () => {
  it("carries every file forward when nothing had swapped yet", async () => {
    const completed = await completedTree();
    const root = await preState();
    await killMidTxn(root, writeSet(root), { swaps: 0 });

    const recovery = await recover(root);
    expect(recovery.outcome).toBe("repaired");
    expect(recovery.repaired).toEqual(["services/a/spec.md", "services/b/spec.md"]);
    expect(recovery).toMatchObject({ command: "rebase", feature: "FEAT-1" });
    // Exactly the tree a run that was never killed produces: the temps are
    // consumed, the journal is gone, and no residue is left beside either file.
    expect(await treeHashes(root)).toEqual(completed);
    expect(existsSync(join(root, COMMIT_INTENT))).toBe(false);
  });

  it("carries the rest forward when half of them had", async () => {
    const completed = await completedTree();
    const root = await preState();
    await killMidTxn(root, writeSet(root), { swaps: 1 });
    // The half-commit is real: one write landed, the other did not.
    expect(await readFile(join(root, "services/a/spec.md"), "utf8")).toBe(NEW_A);
    expect(existsSync(join(root, "services/b/spec.md"))).toBe(false);

    const recovery = await recover(root);
    expect(recovery.outcome).toBe("repaired");
    expect(recovery.repaired).toEqual(["services/b/spec.md"]);
    expect(await treeHashes(root)).toEqual(completed);
    expect(existsSync(join(root, COMMIT_INTENT))).toBe(false);
  });

  it("says the commit had in fact finished when only the record's removal was lost", async () => {
    const completed = await completedTree();
    const root = await preState();
    await killMidTxn(root, writeSet(root), { swaps: 2 });

    const recovery = await recover(root);
    expect(recovery.outcome).toBe("completed");
    expect(recovery.repaired).toEqual([]);
    expect(await treeHashes(root)).toEqual(completed);
    expect(existsSync(join(root, COMMIT_INTENT))).toBe(false);
  });

  it("declares a rolled-back tree consistent instead of refusing over bytes that already agree", async () => {
    // The other way a journal outlives its commit: the swap threw, the REAL
    // rollback put everything back (temps discarded, the directory it had to
    // create pruned), and the crash landed before the record was removed.
    // Nothing swapped and no temps survive — the complete PRE-state is on
    // disk, which is one of the two states recovery promises.
    const root = await preState();
    const pre = await treeHashes(root);
    await rollbackStaged(await killMidTxn(root, writeSet(root), { swaps: 0 }));
    expect(await treeHashes(root)).toEqual({ ...pre, [COMMIT_INTENT]: expect.any(String) });

    const recovery = await recover(root);
    expect(recovery.outcome).toBe("consistent");
    expect(recovery.repaired).toEqual([]);
    expect(await treeHashes(root)).toEqual(pre);
    expect(existsSync(join(root, COMMIT_INTENT))).toBe(false);
  });

  it("finishes a deletion the killed run had not reached", async () => {
    // `services/a/notes.md` is the file being retired, beside a sibling that
    // keeps the directory alive: recovery prunes a parent its deletion emptied,
    // and this suite is about the deletion, not about that prune.
    const deletes = (root: string): PlannedWrite[] => [
      { path: join(root, "services/a/spec.md"), content: NEW_A },
      { path: join(root, "services/a/notes.md"), content: null },
    ];
    const twin = await preState();
    await swapStaged(await stageWrites(deletes(twin)));
    const completed = await treeHashes(twin);

    const root = await preState();
    await killMidTxn(root, deletes(root), { swaps: 1 });
    expect(existsSync(join(root, "services/a/notes.md"))).toBe(true);

    const recovery = await recover(root);
    expect(recovery.outcome).toBe("repaired");
    expect(recovery.repaired).toEqual(["services/a/notes.md"]);
    expect(existsSync(join(root, "services/a/notes.md"))).toBe(false);
    expect(await treeHashes(root)).toEqual(completed);
  });
});

/* ------------------------------------------------------------------ */
/* The three refusals                                                  */
/* ------------------------------------------------------------------ */

describe("what roll-forward refuses rather than choose between", () => {
  /** Assert `recover` refuses naming `named`, and that it moved not one byte. */
  async function refuses(root: string, named: string): Promise<void> {
    const before = await treeHashes(root);
    await expect(recover(root)).rejects.toBeInstanceOf(InterruptedCommitError);
    await expect(recover(root)).rejects.toThrow(named);
    expect(await treeHashes(root)).toEqual(before);
    // The record stays: nothing was decided, so the next reader gets the same
    // refusal rather than a repo that has quietly lost its one description.
    expect(existsSync(join(root, COMMIT_INTENT))).toBe(true);
  }

  it("a file that is in neither the before- nor the after-state", async () => {
    const root = await preState();
    await killMidTxn(root, writeSet(root), { swaps: 1 });
    await writeFile(join(root, "services/a/spec.md"), "# somebody else got here first\n", "utf8");
    await refuses(root, "services/a/spec.md");
  });

  it("a temp that is gone, when some of the commit had already landed", async () => {
    const root = await preState();
    const staged = await killMidTxn(root, writeSet(root), { swaps: 1 });
    await rm(staged[1]!.tmp!, { force: true });
    await refuses(root, "services/b/spec.md");
  });

  it("a temp whose bytes no longer match the digest recorded before the crash", async () => {
    const root = await preState();
    const staged = await killMidTxn(root, writeSet(root), { swaps: 1 });
    await writeFile(staged[1]!.tmp!, "# not what the journal promised\n", "utf8");
    await refuses(root, "services/b/spec.md");
  });
});

/* ------------------------------------------------------------------ */
/* The real command                                                    */
/* ------------------------------------------------------------------ */

/** Two services with one shared requirement, and a feature MODIFYING it in both. */
function rebaseFixture(): Record<string, string> {
  const living = (svc: string): string => `---
service: ${svc}
status: verified
---

# ${svc}

## Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
The service SHALL let a customer cancel an order.

#### Scenario: Cancellation succeeds
- **Given** an open order
- **When** the customer cancels it
- **Then** the order is cancelled
`;
  const modified = (svc: string): string => `# ${svc} — delta

## MODIFIED Requirements

### Requirement: Cancel an order
Requirement-ID: REQ-042
The service SHALL let a customer cancel an order within 30 minutes.

#### Scenario: Cancellation succeeds
- **Given** an open order
- **When** the customer cancels it
- **Then** the order is cancelled
`;
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": living("payment-service"),
    "services/checkout-web/model.likec4": `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata {
      service 'checkout-web'
    }
  }
}
`,
    "services/checkout-web/spec.md": living("checkout-web"),
    "features/FEAT-1-cancel/intent.md": `---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Cancel\n\nCancellation has a deadline.\n`,
    "features/FEAT-1-cancel/specs/payment-service/spec.md": modified("payment-service"),
    "features/FEAT-1-cancel/specs/checkout-web/spec.md": modified("checkout-web"),
  };
}

const PINNED = [
  "features/FEAT-1-cancel/specs/checkout-web/spec.md",
  "features/FEAT-1-cancel/specs/payment-service/spec.md",
];

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

describe("`loam rebase` over a journal its predecessor left", () => {
  it("recovers first, reports it in --json, and lands on the clean run's tree", async () => {
    // The reference: a rebase nothing interrupted, and the exact bytes it wrote.
    const clean = await project(rebaseFixture());
    expect((await runLoam(clean.workDir, "rebase", "FEAT-1", "--json")).code).toBe(0);
    const cleanTree = await treeHashes(clean.docsDir);
    const pinned = await Promise.all(PINNED.map((rel) => clean.read(rel)));

    // The same two writes, killed between them.
    const p = await project(rebaseFixture());
    await killMidTxn(
      p.docsDir,
      PINNED.map((rel, i) => ({ path: join(p.docsDir, rel), content: pinned[i]! })),
      { swaps: 1, spec: txnSpec(p.docsDir) },
    );
    expect(p.exists(COMMIT_INTENT)).toBe(true);

    const res = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.recovered).toMatchObject({ command: "rebase", feature: "FEAT-1", outcome: "repaired" });
    expect(payload.recovered.repaired).toEqual([PINNED[1]]);
    // Recovery produced the finished commit, not a starting point: the rebase
    // that follows finds both pins already current and writes nothing.
    expect(payload.written).toEqual([]);
    expect(await treeHashes(p.docsDir)).toEqual(cleanTree);
    expect(p.exists(COMMIT_INTENT)).toBe(false);
  });

  it("refuses commit-interrupted, and pins nothing, when a file was edited since the crash", async () => {
    const clean = await project(rebaseFixture());
    expect((await runLoam(clean.workDir, "rebase", "FEAT-1", "--json")).code).toBe(0);
    const pinned = await Promise.all(PINNED.map((rel) => clean.read(rel)));

    const p = await project(rebaseFixture());
    await killMidTxn(
      p.docsDir,
      PINNED.map((rel, i) => ({ path: join(p.docsDir, rel), content: pinned[i]! })),
      { swaps: 1, spec: txnSpec(p.docsDir) },
    );
    await p.write(PINNED[0]!, "# a third version nobody committed\n");
    const before = await treeHashes(p.docsDir);

    const res = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
    expect(res.code).toBe(1);
    const error = JSON.parse(res.stdout).error;
    expect(error.code).toBe("commit-interrupted");
    // Which file, by name: a refusal that only says "something is wrong" sends
    // the reader to diff the whole repo.
    expect(error.message).toContain(PINNED[0]);
    // Nothing pinned on top of a state loam could not explain, and the record
    // that describes it is still there.
    expect(await treeHashes(p.docsDir)).toEqual(before);
    expect(p.exists(COMMIT_INTENT)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The rerun templates                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every `rerun:` template in src/, as the journal would store it.
 *
 * These strings reach a human through journal DATA — `doctor` prints
 * `intent.rerun`, `status` puts it on the recover step — so
 * agent-commands-runnable.test.ts, which reads the literals a source file
 * PRINTS, cannot see them. This is the same check applied one level earlier:
 * extract the templates, substitute the interpolations, hand the tokens to the
 * real commander program.
 */
async function rerunTemplates(): Promise<string[]> {
  const src = new URL("../src/", import.meta.url);
  const names = (await readdir(src, { recursive: true })).filter((n) => n.endsWith(".ts")).sort();
  const out = new Set<string>();
  for (const name of names) {
    const text = await readFile(new URL(name, src), "utf8");
    for (const line of text.split("\n")) {
      const after = /\brerun:(.*)$/.exec(line)?.[1];
      if (after === undefined) continue;
      for (const m of [...after.matchAll(/`([^`]*)`/g), ...after.matchAll(/"([^"]*)"/g)]) {
        if (/^loam\s/.test(m[1]!)) out.add(m[1]!);
      }
    }
  }
  return [...out].sort();
}

/** The real program with every action replaced by a no-op — parsing only, no side effects. */
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

describe("every writer's stored rerun is a command loam has", () => {
  it("parses against the real commander program, interpolations filled in", async () => {
    const templates = await rerunTemplates();
    // The corpus is regex over source: a canary, so a broken extraction fails
    // here rather than passing vacuously. One line per journaled writer.
    expect(templates).toEqual([
      "loam gherkin",
      "loam gherkin ${scope.featureId}",
      // `init --example` copies the packaged example tree through the same
      // journaled writer as everything else, so an interrupted copy is rolled
      // forward by the next writer rather than leaving half a fleet on disk.
      // Its rerun stores the target directory, because the command means
      // nothing without one — a bare `loam init --example` would refuse.
      "loam init --example ${req.dir}",
      // `init --mcp` stores the bare flag: it writes exactly one file at a
      // fixed path in the repository it is run from, so the flag IS the whole
      // command and there is nothing to interpolate.
      "loam init --mcp",
      // The authoring launch mode writes the SAME file with a different server
      // argv, so its rerun must carry the flag that decides which — recovering
      // `--mcp-author` as `--mcp` would silently drop the author tools the
      // interrupted run was asked for.
      "loam init --mcp-author",
      "loam new ${featureId}",
      "loam rebase ${id}",
      // The living-corpus mode stores the bare flag: it takes no feature and no
      // interpolation, so the rerun is the whole command it recovers.
      "loam rebase --living",
      // Seed stores the `--from` it was given, not the bare verb: the fleet
      // file is the run's whole input and may live anywhere, so a rerun that
      // dropped the flag would re-run a DIFFERENT command against whatever
      // fleet.yaml happens to sit in the recovering caller's cwd.
      "loam seed --from ${fromArg}",
      // Every `loam subsystem` writer — sync, new, rm, move, rename — stores
      // the one repair spelling: sync recovers the journal and re-renders.
      "loam subsystem sync",
      "loam vouch --service ${req.service} --yes",
    ]);

    const failures: string[] = [];
    for (const template of templates) {
      const tokens = template.replace(/\$\{[^}]*\}/g, "PLACEHOLDER").split(/\s+/);
      try {
        await inertProgram().parseAsync(tokens.slice(1), { from: "user" });
      } catch (err) {
        failures.push(`${template} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(failures, `stored rerun template(s) the real CLI refuses:\n  ${failures.join("\n  ")}`).toEqual([]);
  });

  it("still catches a template the CLI would refuse", async () => {
    // The check above passes vacuously if parsing stopped failing. `loam vouch`
    // takes no positional, which is exactly how a rerun built the wrong way
    // (`loam vouch <service>`) would look.
    expect(await parseFailure(["vouch", "payment-service"])).toMatch(/too many arguments/);
    expect(await parseFailure(["vouch", "--service", "payment-service", "--yes"])).toBeNull();
  });
});

async function parseFailure(args: string[]): Promise<string | null> {
  try {
    await inertProgram().parseAsync(args, { from: "user" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/* ------------------------------------------------------------------ */
/* A journal truncated mid-write                                       */
/* ------------------------------------------------------------------ */

describe("a `.loam-commit` the crash caught mid-write", () => {
  /** The bytes an fsync that never completed leaves: valid JSON's opening, and nothing else. */
  const TRUNCATED = '{\n  "version": 2,\n  "command": "reba';

  it("is graded unreadable by doctor rather than parsed as healthy", async () => {
    const p = await project(coherentFixture());
    await p.write(COMMIT_INTENT, TRUNCATED);

    const res = await runLoam(p.workDir, "doctor", "--json");
    expect(res.code).toBe(1);
    const report = JSON.parse(res.stdout);
    expect(report.healthy).toBe(false);
    expect(report.findings.map((f: { code: string }) => f.code)).toContain("doctor.commit-unreadable");
    expect(report.writePath.intentUnreadable).toBe(true);
  });

  it("makes validate lead with docs.commit-interrupted in every mode, and refuse", async () => {
    const p = await project(coherentFixture());
    // The control: this fleet is green, so the exit 1 below is the journal.
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).code).toBe(0);
    await p.write(COMMIT_INTENT, TRUNCATED);

    for (const mode of [["--all"], ["--feature", "FEAT-1"]]) {
      const res = await runLoam(p.workDir, "validate", ...mode, "--json");
      expect(res.code, mode.join(" ")).toBe(1);
      const first = JSON.parse(res.stdout).targets[0].findings[0];
      expect(first, mode.join(" ")).toMatchObject({ severity: "error", code: "docs.commit-interrupted" });
    }
  });
});
