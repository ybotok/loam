/**
 * `loam init --example <dir>`: copy the example fleet OUT OF the installed
 * binary, so somebody evaluating loam can watch it work before modelling a
 * single boundary of their own.
 *
 * The defect this exists to kill was measured, not imagined. `npm i -g
 * @ybotok/loam` used to deliver no example at all — `files[]` shipped `dist`
 * and eight Markdown pages, `examples/` was excluded, no verb in `--help` was
 * demo/example/tour/sample, and all three `--dry-run` flags need a docs repo
 * that already exists. So the first honest question an evaluating team asks —
 * "show me a working one" — was answered with "model your own boundaries
 * first, then come back". `examples` joining `files[]` is the other half of
 * this change; this is the half that hands the tree to the user.
 *
 * A flag on `init` rather than a command of its own, and the flag/command line
 * is exactly the contradiction matrix below: `--example` shares init's SUBJECT
 * (this directory is about to become a loam workspace) and shares nothing else
 * with it — no repository is bound, no agent files are scaffolded, no
 * `docsDir` is recorded. A second verb would have re-litigated all of that.
 */
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitJson, fail } from "../../core/envelope/json.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import { stageWrites } from "../../core/staging/commit.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { planWrite, type PlannedWrite } from "../../core/staging/writes.js";

/**
 * The packaged example fleet, found relative to THIS module rather than to
 * `process.cwd()` or to any config: the tree is part of the artifact, and the
 * whole point of the flag is that it works in a directory that has nothing in
 * it yet.
 *
 * `../../../` is the package root from both layouts, which is why the path is
 * written once instead of probed: this module is `src/commands/init/` in the
 * repository and `dist/commands/init/` in the tarball, three levels below the
 * root either way. `scripts/package-smoke.mjs` proves the tarball half by
 * running the shipped binary, and `examples` is in `REVIEWED_PACKAGE_FILES`
 * (scripts/package-docs.mjs) so the tree cannot leave the package without the
 * release preflight blocking.
 */
const EXAMPLE_TREE = resolve(fileURLToPath(new URL("../../../examples/docs/", import.meta.url)));

/**
 * The three commands the copy exists to make runnable, each with what it
 * demonstrates. `cd` is prefixed to the first one at print time — it is the
 * one line that is about the caller's shell rather than about loam.
 *
 * Spelled as `command:` string literals deliberately: that is the shape
 * test/agent-commands-runnable.test.ts scrapes out of `src/**` (its
 * `nextCommands`, the one `loam status`'s next[] steps use), so all three are
 * parsed against the real commander program at gate time. loam ships
 * instructions; an instruction that does not parse is a defect, and these are
 * the first three an evaluating user ever types. The sibling table in
 * first-hour.ts is reached by IMPORT instead, because its rows are tuples that
 * no scrape can see — two mechanisms, one obligation.
 */
const TOUR = [
  { command: "loam status", why: "what to do next, derived from the files" },
  { command: "loam validate --all", why: "the gate CI runs: 0 errors, 10 deliberate warnings" },
  { command: "loam show FEAT-101", why: "one in-flight feature, end to end" },
];

export interface ExampleRequest {
  /** `--example <dir>` exactly as typed: what `cd` is spelled with in the epilogue. */
  dir: string;
  /**
   * Which of `--docs`, `--service`, `--create`, `--tools` were actually
   * passed. Computed by the caller because only it can tell a typed `--docs`
   * from commander's default.
   */
  conflicts: string[];
  json: boolean;
}

/**
 * Copy the packaged example fleet to `req.dir`, or refuse.
 *
 * Nothing here consults `loam.json`, and that is the point of the
 * short-circuit its caller performs: `--example` writes a FRESH tree, it does
 * not join a system, so init's governing-config guard — which refuses when a
 * `loam.json` in an ancestor already governs this directory — is a rule about
 * a question this flag never asks.
 */
export async function initExample(req: ExampleRequest): Promise<void> {
  const { json } = req;

  // The contradiction matrix, and naming it is what keeps `--example` a FLAG
  // rather than a second command hiding inside `init`. Each of these four asks
  // for a write that `--example` does not make: `--docs` and `--create` name a
  // docs repo to point at or scaffold, `--service` binds this repository to a
  // service, `--tools` selects agent files to generate. `--example` binds no
  // repository and scaffolds no agent files, so none of them is a modifier of
  // it — each is a different command spelled on the same line, and arbitrating
  // between them would be inventing which one the caller meant.
  //
  // `--force`, `--no-commands` and `--no-skills` are deliberately NOT here:
  // each only SUPPRESSES something (a refusal, a set of generated files) that
  // this path already does not do, so none of them contradicts anything.
  if (req.conflicts.length > 0) {
    fail(
      json,
      "invalid-option",
      `--example contradicts ${req.conflicts.join(" and ")}: --example copies the packaged example ` +
        "fleet into a fresh directory — it binds no repository, records no docsDir and generates no " +
        "agent files. Copy the example first, then run loam init in the repository you are onboarding.",
    );
    return;
  }

  const target = resolve(process.cwd(), req.dir);
  const occupant = await occupancy(target);
  if (occupant !== null) {
    fail(
      json,
      "already-exists",
      `${target} ${occupant}. --example writes a whole tree and never merges into one that is ` +
        "already there. Name a directory that does not exist yet, or an empty one.",
    );
    return;
  }

  const writes = await planCopy(target);
  const staged = await stageWrites(writes);
  // The journaled transaction every other loam writer uses, and not `cp`,
  // because the failure mode is the same one it exists for: a copy killed
  // half way leaves a directory that LOOKS like a docs repo and validates as a
  // broken one, and the reader has no way to tell that from an example that
  // was always wrong. The journal's root is the target, so a killed run leaves
  // `.loam-commit` beside the half-tree naming every file — and every write is
  // an exclusive create (nothing here exists yet), so two `--example` runs
  // racing for one directory serialise into the same `already-exists` the
  // occupancy check above gives, exactly as `loam new` does for a feature id.
  //
  // No docs lock is taken, and that is the one place this departs from
  // new/seed: the lock serialises writers against a SHARED docs repo, and the
  // target here is a directory this run is creating. There is no predecessor
  // commit to recover in a tree that does not exist yet.
  const committed = await commitStaged(
    { root: target, command: "init", rerun: `loam init --example ${req.dir}`, target: "example" },
    staged,
    "copied",
  );
  if (!committed.ok) {
    if (committed.raced) {
      fail(
        json,
        "already-exists",
        `${target} was created by another writer while this copy was being staged — nothing was ` +
          "written. Name a directory that does not exist yet, or an empty one.",
      );
      return;
    }
    fail(json, committed.code, committed.message);
    return;
  }

  report(req, target, writes);
}

/**
 * Why `target` cannot be written into, as the clause a refusal reads with — or
 * null when it is free.
 *
 * A path that exists and is not a directory is refused by the same code as a
 * non-empty directory on purpose: the caller's question is "may I have this
 * name?", and the answer is no for the same reason either way.
 */
async function occupancy(target: string): Promise<string | null> {
  if (!existsSync(target)) return null;
  if (!statSync(target).isDirectory()) return "already exists and is not a directory";
  return (await readdir(target)).length > 0 ? "already exists and is not empty" : null;
}

/** Every file of the packaged tree, planned as an exclusive create under `target`. */
async function planCopy(target: string): Promise<PlannedWrite[]> {
  const paths = await treePaths(EXAMPLE_TREE);
  // BYTES, never text: `readFile` without an encoding, straight into the
  // planned write. A round trip through a string would substitute U+FFFD for
  // every byte loam does not understand (core/staging/writes.ts records the
  // defect), and the contract this command is tested against is that the copy
  // is byte-identical to the tree that shipped.
  return inOrder(paths, async (rel) =>
    planWrite(join(target, ...rel.split("/")), await readFile(join(EXAMPLE_TREE, ...rel.split("/")))),
  );
}

/**
 * Every FILE under `root`, relative with forward slashes, in a stable order.
 *
 * Sorted per directory so the write order — and therefore the transaction
 * journal — is the same on every host, whatever order the filesystem
 * enumerates in. Directories are not carried: the example tree has no empty
 * one, and `stageWrites` makes each file's parent on the way in.
 */
async function treePaths(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    // Sequential, and the ordering IS the reason: `out` is one shared
    // accumulator and its order is the journal's order.
    for (const entry of entries) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${rel}/`);
      else out.push(rel);
    }
  };
  await walk(root, "");
  return out;
}

/** The two views of a finished copy. Neither reads the tree again. */
function report(req: ExampleRequest, target: string, writes: PlannedWrite[]): void {
  const created = writes.map((w) => w.path);
  if (req.json) {
    emitJson({ command: "init", example: { source: EXAMPLE_TREE, dir: target }, created });
    return;
  }

  console.log("Example fleet copied.");
  console.log(`  from:  ${EXAMPLE_TREE}`);
  console.log(`  to:    ${target}`);
  console.log(`  files: ${created.length} — five services, four features, and its own loam.json`);
  console.log("         the tree governs itself, so every command below resolves to this fleet");

  // The first line carries the `cd` because the tree governs itself: these
  // commands answer about THIS fleet only when they are run from inside it.
  // The width is computed over the printed lines, `cd` included, so the
  // comment column is straight.
  const prefix = `cd ${req.dir} && `;
  const lines = TOUR.map((step, i) => ({
    text: i === 0 ? `${prefix}${step.command}` : step.command,
    why: step.why,
  }));
  const width = Math.max(...lines.map((line) => line.text.length));
  console.log("  next — run it:");
  for (const line of lines) console.log(`    ${line.text.padEnd(width)}   # ${line.why}`);
}
