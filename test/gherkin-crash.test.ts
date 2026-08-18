/**
 * `loam gherkin` killed mid-emission, and two of them running at once.
 *
 * This is the writer the roadmap named: a sequential write/delete loop in the
 * SERVICE repo — the one repository nothing else of loam's ever looked at — so
 * a kill between two `.feature` files left a half-old, half-new suite with no
 * marker anywhere, and the next run happily graded its own wreckage. What
 * replaced it commits through the same journaled transaction the docs-repo
 * writers use, with its lock and its journal in `<gherkinDir>/loam/`, the
 * directory loam owns outright.
 *
 * Pinned here:
 *
 *  - the boundary between two swaps leaves a version-2 journal IN THE SERVICE
 *    REPO, and `doctor` — standing in that repo, with `service` configured —
 *    finds it through its service-repo scan and prints `loam gherkin` as the fix;
 *  - re-running recovers before it reads a single spec (the emission is
 *    deterministic, so "the clean tree" is a byte comparison) and reports the
 *    recovery in `--json`;
 *  - the commit compares each staged pre-image against the bytes RECONCILE
 *    graded, so a `.feature` somebody edited or created between the planning and
 *    the swap is refused by name — never buried;
 *  - the invariant the two dotfiles' placement rests on: the suite walk skips
 *    dot-named entries, so `.loam-lock` and `.loam-commit` are not orphans to
 *    delete and not staleness findings to report;
 *  - a zero-op run still takes no lock and creates no root;
 *  - two REAL processes leave the tree a solo run leaves, with no residue.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";
import { spawnLoam } from "./helpers/cli-process.js";
import { commitEmission } from "../src/commands/gherkin/commit.js";
import { type ActionRow, type Emission } from "../src/commands/gherkin/reconcile.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { planEmission } from "../src/core/gherkin/emit.js";
import { featureFilesUnder } from "../src/core/gherkin/stale.js";
import { SPEC_AXES } from "../src/core/repo/paths.js";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { COMMIT_INTENT } from "../src/core/staging/interrupted.js";
import { DOCS_LOCK } from "../src/core/staging/lock.js";
import { writeTxnIntent } from "../src/core/staging/txn/journal.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SVC = "payment-service";
/** Two requirements, so the emission has a boundary between two files to be killed at. */
const SPEC = `---
service: ${SVC}
status: draft
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: Capture succeeds
- **Given** an authorization
- **When** capture is requested
- **Then** the funds move
`;

const EMITTED = ["authorize-a-payment.feature", "capture-a-payment.feature"];

function fixture(spec = SPEC): Record<string, string> {
  const files = coherentFixture();
  files[`services/${SVC}/spec.md`] = spec;
  return files;
}

/** The service repo: `p.workDir` carries loam.json naming the service, and owns the suite. */
async function serviceProject(spec = SPEC): Promise<Project> {
  const p = await makeProject(fixture(spec), { service: SVC });
  cleanups.push(() => p.destroy());
  return p;
}

/** `<gherkinDir>/loam/` — the one directory this command may touch. */
const rootOf = (p: Project): string => join(p.workDir, "features", "loam");

/**
 * What a completed emission put in the root, and the `rerun` its journal would
 * have carried — one record, because a boundary is only reproducible against
 * the exact files and the exact repair string the killed run owned. Feature
 * scope stores `loam gherkin <FEAT>`, living scope a bare `loam gherkin`.
 */
interface Emitted {
  names: string[];
  bytes: string[];
  rerun: string;
  service: string;
}

/** The suite an emission nothing interrupted leaves, and the bytes of each file in it. */
async function cleanEmission(): Promise<{ tree: Record<string, string>; emitted: Emitted }> {
  const p = await serviceProject();
  const res = await runLoam(p.workDir, "gherkin", "--json");
  expect(res.code, res.out).toBe(0);
  return {
    tree: await treeHashes(join(p.workDir, "features")),
    emitted: {
      names: EMITTED,
      bytes: await Promise.all(EMITTED.map((name) => readFile(join(rootOf(p), name), "utf8"))),
      rerun: "loam gherkin",
      service: SVC,
    },
  };
}

/**
 * Drive the emission's commit to a boundary between two `.feature` swaps and
 * stop there: the journal is fsynced into the owned root, the temps hold the
 * rest, and `swaps` of the files have landed.
 */
async function killMidEmission(p: Project, emitted: Emitted, swaps: number): Promise<void> {
  const root = rootOf(p);
  const staged = await stageWrites(
    emitted.names.map((name, i) => ({ path: join(root, name), content: emitted.bytes[i]! })),
  );
  await writeTxnIntent({ root, command: "gherkin", rerun: emitted.rerun, target: emitted.service }, staged);
  await swapStaged(staged.slice(0, swaps));
}

/* ------------------------------------------------------------------ */
/* The boundary                                                        */
/* ------------------------------------------------------------------ */

describe("an emission killed between two .feature swaps", () => {
  it("leaves the journal in the service repo, where doctor now looks for it", async () => {
    const { emitted } = await cleanEmission();
    const p = await serviceProject();
    await killMidEmission(p, emitted, 1);

    // Half a suite: the first file landed, the second did not — and the record
    // sits in the SERVICE repo, not the docs repo.
    expect(existsSync(join(rootOf(p), EMITTED[0]!))).toBe(true);
    expect(existsSync(join(rootOf(p), EMITTED[1]!))).toBe(false);
    expect(existsSync(join(rootOf(p), COMMIT_INTENT))).toBe(true);
    expect(p.exists(COMMIT_INTENT)).toBe(false);

    const res = await runLoam(p.workDir, "doctor", "--json");
    expect(res.code).toBe(1);
    const report = JSON.parse(res.stdout);
    const codes = report.findings.map((f: { code: string }) => f.code);
    expect(codes).toContain("doctor.commit-interrupted");
    // The scoped scan is what found it: the docs repo's own write path is clean.
    expect(report.writePath.intent).toBeNull();
    expect(report.serviceWritePath.intent).toMatchObject({ version: 2, command: "gherkin", rerun: "loam gherkin" });
    // The temp still holding the unswapped file is NOT litter — it is the one
    // durable copy of the after-bytes the journal's roll-forward renames in.
    // Grading it doctor.staging-temps put "delete any that remain" beside a
    // blocker whose fix is "re-run to recover", and an operator who obeyed
    // the warning converted a one-command repair into a manual VCS restore.
    expect(codes).not.toContain("doctor.staging-temps");
    const fix = report.findings.find((f: { code: string }) => f.code === "doctor.commit-interrupted").fix;
    expect(fix).toContain("loam gherkin");
  });

  it("re-running recovers before it reads a spec, and lands on the clean emission byte for byte", async () => {
    const { tree, emitted } = await cleanEmission();
    const p = await serviceProject();
    await killMidEmission(p, emitted, 1);

    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.recovered).toMatchObject({
      command: "gherkin",
      feature: SVC,
      outcome: "repaired",
      repaired: [EMITTED[1]],
    });
    // Deterministic emission makes this a byte comparison: recovery plus the
    // run that followed it produced exactly the suite a clean run produces.
    expect(await treeHashes(join(p.workDir, "features"))).toEqual(tree);
    expect(existsSync(join(rootOf(p), COMMIT_INTENT))).toBe(false);
    expect(existsSync(join(rootOf(p), DOCS_LOCK))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* validate, standing in the service repo                              */
/* ------------------------------------------------------------------ */

describe("a half-committed suite is not merely stale", () => {
  it("leads the service target with docs.commit-interrupted and gates, instead of warning", async () => {
    // The freshness chain grades a half-committed suite `gherkin.*` — every one
    // of them warn severity, which never gates — so CI over the exact tree
    // `doctor` calls a blocker went green and merged. The journal outranks all
    // of it: same code and same lead position validate already gives the docs
    // repo's own journal, for the one journal that does not live there.
    const { emitted } = await cleanEmission();
    const p = await serviceProject();

    // The control first: this service grades green-enough to exit 0 before the
    // kill, so the exit 1 below is the journal and nothing else.
    expect((await runLoam(p.workDir, "validate", "--json")).code).toBe(0);
    await killMidEmission(p, emitted, 1);

    const res = await runLoam(p.workDir, "validate", "--json");
    expect(res.code).toBe(1);
    const target = JSON.parse(res.stdout).targets[0];
    expect(target.id).toBe(SVC);
    expect(target.findings[0]).toMatchObject({ severity: "error", code: "docs.commit-interrupted" });
    expect(target.findings[0].message).toContain(emitted.rerun);
    // It came from the SERVICE repo's scan: the docs repo has no journal at all.
    expect(p.exists(COMMIT_INTENT)).toBe(false);
    // …and the gherkin findings it outranks are all still warnings, which is
    // exactly why leading with an error is what changes the exit code.
    for (const f of target.findings.filter((x: { code: string }) => x.code.startsWith("gherkin."))) {
      expect(f.severity, f.code).toBe("warn");
    }
  });

  it("says the same thing about the docs repo's own journal — one code, two scans", async () => {
    const p = await serviceProject();
    await p.write(COMMIT_INTENT, JSON.stringify(JOURNAL_SHAPE, null, 2) + "\n");

    const res = await runLoam(p.workDir, "validate", "--json");
    expect(res.code).toBe(1);
    const findings = JSON.parse(res.stdout).targets.flatMap((t: { findings: unknown[] }) => t.findings);
    expect(findings[0]).toMatchObject({ severity: "error", code: "docs.commit-interrupted" });
  });
});

/**
 * A version-2 record as a killed writer leaves it, for the branch that only
 * READS one. The digests are syntactically real (all the strict reader checks)
 * and belong to no file: nothing here is repairable and nothing is repaired.
 */
const JOURNAL_SHAPE = {
  version: 2,
  command: "gherkin",
  rerun: "loam gherkin",
  target: SVC,
  pid: 4242,
  host: "build-box",
  at: "2026-08-01T10:00:00.000Z",
  files: [
    {
      path: "loam/authorize-a-payment.feature",
      before: "a".repeat(64),
      after: "b".repeat(64),
      tmp: "loam/.authorize-a-payment.feature.loam-4242-0-1754042400000.tmp",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* The repair outlives the feature it names                            */
/* ------------------------------------------------------------------ */

/** FEAT-1's own delta for payment-split-service, on both axes — a two-file feature emission. */
function splitFixture(): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/specs/payment-split-service/arch.spec.md": `# payment-split-service — arch delta for FEAT-1

## ADDED Requirements

### Requirement: Retries stay idempotent
The service SHALL apply createSplit idempotently under retry.

#### Scenario: Duplicate delivery
- **WHEN** the same split arrives twice
- **THEN** exactly one split is recorded
`,
    "services/payment-split-service/model.likec4": `specification {
  element softwareSystem
}

model {
  paymentSplitService = softwareSystem 'payment-split-service'
}

views {
  view of paymentSplitService {
    include *
  }
}
`,
  };
}

const SPLIT = "payment-split-service";

async function splitProject(): Promise<Project> {
  const p = await makeProject(splitFixture(), { service: SPLIT });
  cleanups.push(() => p.destroy());
  return p;
}

describe("a journal whose stored rerun names a feature that has since archived", () => {
  it("is still rolled forward by that exact command, before it refuses the archived id", async () => {
    // The repair `doctor` prints is `loam gherkin FEAT-1`, and a feature does
    // not stay in flight while somebody notices the crash. Resolving the
    // argument first made that printed repair unrunnable: `unknown-target` came
    // back and the root stayed wedged forever, with no other command in loam
    // that would ever look at it. Recovery now runs before the id resolves.
    const clean = await splitProject();
    const emitRes = await runLoam(clean.workDir, "gherkin", "FEAT-1", "--json");
    expect(emitRes.code, emitRes.out).toBe(0);
    const names = (JSON.parse(emitRes.stdout).files as { path: string }[]).map((f) =>
      f.path.replace("features/loam/", ""),
    );
    const emitted: Emitted = {
      names,
      bytes: await Promise.all(names.map((n) => readFile(join(rootOf(clean), n), "utf8"))),
      rerun: "loam gherkin FEAT-1",
      service: SPLIT,
    };
    const cleanTree = await treeHashes(join(clean.workDir, "features"));

    const p = await splitProject();
    await killMidEmission(p, emitted, 1);
    // The feature ships while the suite is still half-written.
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(0);

    // The printed repair, verbatim.
    const res = await runLoam(p.workDir, "gherkin", "FEAT-1", "--json");

    // Whatever it answers about the id — today an `unknown-target` refusal,
    // because FEAT-1 is archived — the recovery is not conditional on it.
    expect(existsSync(join(rootOf(p), COMMIT_INTENT))).toBe(false);
    expect(await treeHashes(join(p.workDir, "features"))).toEqual(cleanTree);
    expect(await residueIn(rootOf(p))).toEqual([]);

    expect(res.code).toBe(1);
    const error = JSON.parse(res.stdout).error;
    expect(error.code).toBe("unknown-target");
    expect(error.message).toContain("archived");
  });
});

/* ------------------------------------------------------------------ */
/* The graded-bytes compare                                            */
/* ------------------------------------------------------------------ */

/**
 * The rows a real reconcile would hand the commit, built from the real planner
 * so the bytes are the emission's own. Only `path`, `action`, `content` and
 * `raw` reach `commitEmission`; the rest of the row is carried whole rather
 * than faked, so this cannot drift from what the planner actually produces.
 */
function plannedRows(root: string): Emission[] {
  const [specAxis] = SPEC_AXES;
  return planEmission([{ axis: specAxis, reqs: parseRequirements(SPEC) }], {
    service: SVC,
    version: LOAM_VERSION,
  }).map((f) => ({ ...f, path: join(root, f.fileName) }));
}

/** The dotfiles and staging litter a refused commit must not leave behind. */
async function residueIn(root: string): Promise<string[]> {
  return (await readdir(root)).filter((n) => n === DOCS_LOCK || n === COMMIT_INTENT || n.endsWith(".tmp"));
}

describe("the commit compares against the bytes reconcile graded", () => {
  it("refuses by name when a .feature moved between the grading and the swap", async () => {
    const p = await serviceProject();
    expect((await runLoam(p.workDir, "gherkin", "--json")).code).toBe(0);
    const root = rootOf(p);
    const rows = plannedRows(root);
    const onDisk = await readFile(rows[0]!.path);

    // A "replaced" row whose graded bytes are NOT what is on disk: exactly the
    // state a hand edit between reconcile's read and the commit produces.
    const writes: ActionRow[] = [
      { ...rows[0]!, action: "replaced", raw: Buffer.from("Feature: bytes reconcile never read\n") },
    ];
    const outcome = await commitEmission({ root, service: SVC, scope: { mode: "living" } }, { writes, orphans: [] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("merge-failed");
    expect(outcome.message).toContain(rows[0]!.path);
    // Refused, not buried: the author's file is byte-identical and no residue
    // sits beside it.
    expect(await readFile(rows[0]!.path)).toEqual(onDisk);
    expect(await residueIn(root)).toEqual([]);
  });

  it("refuses to overwrite a .feature that appeared at a planned create's path", async () => {
    const p = await serviceProject();
    const root = rootOf(p);
    await mkdir(root, { recursive: true });
    const rows = plannedRows(root);
    // Planned as a create (the path was absent when the plan was graded), and
    // then somebody put a file there. The exclusive link(2) is what makes
    // "never overwritten" mechanical rather than a promise.
    const mine = "Feature: mine, written after the plan was graded\n";
    await writeFile(rows[0]!.path, mine, "utf8");

    const writes: ActionRow[] = [{ ...rows[0]!, action: "written" }];
    const outcome = await commitEmission({ root, service: SVC, scope: { mode: "living" } }, { writes, orphans: [] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("merge-failed");
    expect(outcome.message).toContain("refused to overwrite");
    expect(await readFile(rows[0]!.path, "utf8")).toBe(mine);
    expect(await residueIn(root)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* What the dotfiles' placement rests on                               */
/* ------------------------------------------------------------------ */

describe("loam's own dotfiles inside the owned root", () => {
  it("are invisible to the suite walk — the invariant that lets them live there", async () => {
    // `.loam-lock` and `.loam-commit` sit in the same flat directory the
    // emission owns. Everything that reads that directory reads it through
    // `featureFilesUnder`, and the reason a lock file is not an orphan to
    // delete (nor a staleness finding to report) is this one skip.
    const p = await serviceProject();
    const root = rootOf(p);
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writeFile(join(root, "real.feature"), "Feature: real\n", "utf8");
    await writeFile(join(root, DOCS_LOCK), '{"pid":1}\n', "utf8");
    await writeFile(join(root, COMMIT_INTENT), '{"version":2}\n', "utf8");
    await writeFile(join(root, ".hand-written.feature"), "Feature: dot named\n", "utf8");
    await writeFile(join(root, ".hidden", "nested.feature"), "Feature: under a dot dir\n", "utf8");

    expect(await featureFilesUnder(root)).toEqual([join(root, "real.feature")]);
  });

  it("are not graded gherkin.orphaned by validate", async () => {
    const p = await serviceProject();
    expect((await runLoam(p.workDir, "gherkin", "--json")).code).toBe(0);
    const root = rootOf(p);
    await writeFile(join(root, DOCS_LOCK), '{"pid":1,"host":"h","at":"now"}\n', "utf8");
    await writeFile(join(root, COMMIT_INTENT), '{"version":2,"command":"gherkin"}\n', "utf8");

    const res = await runLoam(p.workDir, "validate", "--json");
    const findings = JSON.parse(res.stdout).targets.flatMap((t: { findings: unknown[] }) => t.findings);
    expect(findings.map((f: { code: string }) => f.code)).not.toContain("gherkin.orphaned");
  });
});

/* ------------------------------------------------------------------ */
/* Zero-op                                                             */
/* ------------------------------------------------------------------ */

describe("a run with nothing to emit", () => {
  it("creates no root and no lock — an empty loam/ is a claim about the whole suite", async () => {
    const p = await serviceProject(`---\nservice: ${SVC}\nstatus: draft\n---\n\n# payment-service\n\nNothing written down yet.\n`);
    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).files).toEqual([]);
    expect(existsSync(join(p.workDir, "features"))).toBe(false);
  });

  it("re-emits a current suite to the same bytes, and hands the lock and the journal back", async () => {
    // Not a zero-op — a living re-run REPLACES every untagged file — which is
    // exactly why it is worth pinning here: it is a full journaled commit whose
    // whole observable effect must be nothing, with neither dotfile left behind.
    const p = await serviceProject();
    expect((await runLoam(p.workDir, "gherkin", "--json")).code).toBe(0);
    const before = await treeHashes(join(p.workDir, "features"));

    const again = await runLoam(p.workDir, "gherkin", "--json");
    expect(again.code, again.out).toBe(0);
    expect(JSON.parse(again.stdout).files.map((f: { action: string }) => f.action)).toEqual(["replaced", "replaced"]);
    expect(await treeHashes(join(p.workDir, "features"))).toEqual(before);
    expect(await residueIn(rootOf(p))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Two real processes                                                  */
/* ------------------------------------------------------------------ */

describe("two processes emitting the same suite", () => {
  it("land on the solo run's tree, and any loser refuses rather than half-writing", async () => {
    const solo = await serviceProject();
    expect((await runLoam(solo.workDir, "gherkin", "--json")).code).toBe(0);
    const soloTree = await treeHashes(join(solo.workDir, "features"));

    const p = await serviceProject();
    const runs = await Promise.all([
      spawnLoam(p.workDir, "gherkin", "--json"),
      spawnLoam(p.workDir, "gherkin", "--json"),
    ]);
    const output = runs.map((r) => r.stdout + r.stderr).join("\n---\n");
    expect(runs.filter((r) => r.code === 0).length, output).toBeGreaterThanOrEqual(1);
    for (const failed of runs.filter((r) => r.code !== 0)) {
      const payload = JSON.parse(failed.stdout);
      expect(payload.ok).toBe(false);
      // Either the lock never came free, or this run planned a create for a
      // path the winner had already filled — refused, never overwritten.
      expect(["docs-busy", "merge-failed"]).toContain(payload.error.code);
    }

    expect(await treeHashes(join(p.workDir, "features"))).toEqual(soloTree);
    expect(await residueIn(rootOf(p))).toEqual([]);
  }, 60_000);
});
