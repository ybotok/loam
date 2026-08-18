/**
 * `loam vouch` killed mid-commit, and two of them running at once.
 *
 * A vouch stamps every spec-axis file a service has — spec.md always,
 * arch.spec.md beside it — and the all-or-nothing verification exists so that
 * `verified` never means "half-stamped". Rollback closed the exception path
 * (vouch.test.ts pins that); it could do nothing at all about a SIGKILL between
 * the pair's two renames, which left spec.md claiming a person had read code
 * that arch.spec.md still called a draft, with no marker anywhere. And the
 * command took no lock, so two service repos could interleave over one docs
 * repo unimpeded.
 *
 * What is pinned here:
 *
 *  - the boundary between the two stamps leaves a version-2 journal, and
 *    `doctor` names it with the exact `loam vouch --service <svc> --yes` that
 *    recovers it;
 *  - ONE re-run rolls the pair forward to the tree a clean vouch produces, byte
 *    for byte, and stamps — the fix doctor prints has to work in a single go,
 *    which is why the journal is recovered BEFORE verification reads anything
 *    rather than only under the commit lock;
 *  - the boundary where only the record's removal was lost is where a vouch
 *    reports its own recovery on the ok arm;
 *  - the lock the roadmap called missing: a live holder is waited out and then
 *    answered `docs-busy`, with nothing stamped and the holder's lock intact;
 *  - two REAL processes vouching one service produce exactly one stamp, a
 *    stable refusal for the loser, and no residue.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, treeHashes, writeFiles, type Project } from "./helpers/harness.js";
import { spawnLoam } from "./helpers/cli-process.js";
import { parseFrontmatter, stringField } from "../src/core/document/frontmatter.js";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { COMMIT_INTENT } from "../src/core/staging/interrupted.js";
import { DOCS_LOCK } from "../src/core/staging/lock.js";
import { writeTxnIntent } from "../src/core/staging/txn/journal.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;
const ARCH = `services/${SVC}/arch.spec.md`;
const RERUN = `loam vouch --service ${SVC} --yes`;

/** The code both specs name as their sources — one file each, so the two stamps differ. */
const CODE = {
  "src/payment.ts": "export const authorize = () => true;\n",
  "src/outbox.ts": "export const relay = () => true;\n",
};

/** coherentFixture with a sourced spec.md AND a sourced arch.spec.md: one vouch, two files. */
function vouchFixture(): Record<string, string> {
  const files = coherentFixture();
  files[SPEC] = `---
service: ${SVC}
status: draft
owner: payments-team
sources:
  - src/payment.ts
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
  files[ARCH] = `---
service: ${SVC}
status: draft
owner: payments-team
sources:
  - src/outbox.ts
---

# payment-service — architecture

## Requirements

### Requirement: Publish through the outbox
The service SHALL publish events through the transactional outbox.

Covers: paymentService.api

#### Scenario: Broker outage
- **Given** the broker is down
- **When** an event is written
- **Then** the event is delivered after recovery
`;
  return files;
}

/** The docs project whose workDir doubles as payment-service's own repo. */
async function voucherRepo(): Promise<Project> {
  const p = await makeProject(vouchFixture(), { service: SVC });
  cleanups.push(() => p.destroy());
  await writeFiles(p.workDir, CODE);
  return p;
}

/** The tree a vouch nothing interrupted leaves, and the exact bytes it wrote into each file. */
async function cleanVouch(): Promise<{ tree: Record<string, string>; post: string[] }> {
  const p = await voucherRepo();
  const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
  expect(res.code, res.out).toBe(0);
  return { tree: await treeHashes(p.docsDir), post: [await p.read(SPEC), await p.read(ARCH)] };
}

/**
 * Drive the vouch commit to a boundary between its two stamps and stop there,
 * as a SIGKILL would: the temps hold the stamped bytes, the journal is fsynced,
 * and `swaps` of the pair have landed.
 */
async function killMidVouch(p: Project, post: string[], swaps: number): Promise<void> {
  const staged = await stageWrites([
    { path: join(p.docsDir, SPEC), content: post[0]! },
    { path: join(p.docsDir, ARCH), content: post[1]! },
  ]);
  await writeTxnIntent({ root: p.docsDir, command: "vouch", rerun: RERUN, target: SVC }, staged);
  await swapStaged(staged.slice(0, swaps));
}

const statusOf = async (p: Project, rel: string): Promise<string | undefined> =>
  stringField(parseFrontmatter(await p.read(rel)), "status");

/* ------------------------------------------------------------------ */
/* The boundary between the two stamps                                 */
/* ------------------------------------------------------------------ */

describe("a vouch killed between spec.md and arch.spec.md", () => {
  it("leaves a journal doctor names, with the re-run that repairs it as the fix", async () => {
    const { post } = await cleanVouch();
    const p = await voucherRepo();
    await killMidVouch(p, post, 1);

    // The half-stamp is real, and it is exactly what `verified` must never mean.
    expect(await statusOf(p, SPEC)).toBe("verified");
    expect(await statusOf(p, ARCH)).toBe("draft");
    expect(p.exists(COMMIT_INTENT)).toBe(true);

    const res = await runLoam(p.workDir, "doctor", "--json");
    expect(res.code).toBe(1);
    const finding = JSON.parse(res.stdout).findings.find(
      (f: { code: string }) => f.code === "doctor.commit-interrupted",
    );
    expect(finding, res.stdout).toBeDefined();
    expect(finding.severity).toBe("blocker");
    // The stored rerun, verbatim — not a guess at which command owns the repair.
    expect(finding.fix).toContain(RERUN);
    expect(finding.message).toContain(SPEC);
    expect(finding.message).toContain(ARCH);
  });

  it("is repaired by ONE re-run, which then stamps cleanly and says what it recovered", async () => {
    // The fix `doctor` prints has to work in one go. Recovery under the commit
    // lock alone could not do that: it changes files verification has already
    // read, so the run's own raced check refused a sound stamp and the repair
    // took two runs. The journal is now rolled forward BEFORE verification
    // reads a byte — one existsSync when there is nothing to do — with the
    // under-lock recovery kept as the backstop for a crash in between.
    const { tree, post } = await cleanVouch();
    const p = await voucherRepo();
    await killMidVouch(p, post, 1);
    expect(await statusOf(p, ARCH)).toBe("draft");

    const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).recovered).toMatchObject({
      command: "vouch",
      feature: SVC,
      outcome: "repaired",
      repaired: [ARCH],
    });
    // One run, and the docs are byte-identical to a vouch nothing interrupted —
    // with the record gone and both files carrying the same stamp.
    expect(await treeHashes(p.docsDir)).toEqual(tree);
    expect(p.exists(COMMIT_INTENT)).toBe(false);
    expect(await statusOf(p, ARCH)).toBe("verified");
  });

  it("reports its own recovery on the ok arm when only the record's removal was lost", async () => {
    const { tree, post } = await cleanVouch();
    const p = await voucherRepo();
    await killMidVouch(p, post, 2);

    const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).recovered).toMatchObject({
      command: "vouch",
      feature: SVC,
      outcome: "completed",
      repaired: [],
    });
    expect(await treeHashes(p.docsDir)).toEqual(tree);
    expect(p.exists(COMMIT_INTENT)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The lock                                                            */
/* ------------------------------------------------------------------ */

describe("the docs lock around the stamp", () => {
  it("waits out a holder that never leaves, then answers docs-busy with nothing stamped", async () => {
    const p = await voucherRepo();
    // This test's own live pid: the stale-lock breaker must not touch it.
    const lockPath = join(p.docsDir, DOCS_LOCK);
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, host: hostname(), at: "now" }) + "\n", "utf8");
    const before = await treeHashes(p.docsDir);

    const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");
    // Neither file stamped, no staging residue, and the holder's lock is intact
    // — a refusal that ate somebody else's lock would be worse than the wait.
    expect(await statusOf(p, SPEC)).toBe("draft");
    expect(await statusOf(p, ARCH)).toBe("draft");
    expect(await treeHashes(p.docsDir)).toEqual(before);
    expect(existsSync(lockPath)).toBe(true);
  }, 20_000);
});

/* ------------------------------------------------------------------ */
/* Two real processes                                                  */
/* ------------------------------------------------------------------ */

describe("two processes vouching the same service", () => {
  it("leaves one coherent stamp, and any loser refuses stably — never a half-stamp", async () => {
    const { tree } = await cleanVouch();
    const p = await voucherRepo();

    const [a, b] = await Promise.all([
      spawnLoam(p.workDir, "vouch", "--yes", "--json"),
      spawnLoam(p.workDir, "vouch", "--yes", "--json"),
    ]);
    const runs = [a, b];
    // Spawn timing decides whether the two UNLOCKED read halves overlap. When
    // they do, exactly one commit wins and the other refuses; when the runs
    // serialise, the second re-reads the stamped tree and legitimately
    // re-stamps it to identical bytes — two exit 0s and one truth. Both are
    // correct; what this pin forbids is a half-stamp or an unstable refusal,
    // so the accepted outcomes are stated rather than assumed from timing.
    const losers = runs.filter((r) => r.code !== 0);
    expect(losers.length, runs.map((r) => r.stdout + r.stderr).join("\n---\n")).toBeLessThanOrEqual(1);
    for (const run of losers) {
      const loser = JSON.parse(run.stdout);
      expect(loser.ok).toBe(false);
      expect(["vouch-raced", "docs-busy"]).toContain(loser.error.code);
    }

    // One coherent stamp on disk: the same tree one vouch alone produces.
    expect(await treeHashes(p.docsDir)).toEqual(tree);
    const residue = (await readdir(p.docsDir)).filter((n) => n === DOCS_LOCK || n === COMMIT_INTENT);
    expect(residue).toEqual([]);
    for (const dir of [`services/${SVC}`, "."]) {
      expect((await readdir(join(p.docsDir, dir))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    }
  }, 60_000);
});
