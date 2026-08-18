/**
 * The verification record's write path under contention and failure — the
 * roadmap's P0 exit criteria as executable pins.
 *
 * verification.yaml used to go down as one plain writeFile from an unlocked
 * read. Everything here pins what replaced that:
 *
 *  - two REAL processes recording different services of one feature both land,
 *    in either order, and both attestations are on the file afterwards — the
 *    later one waits out the docs lock and merges, it does not refuse and it
 *    does not overwrite;
 *  - a same-service race has a deterministic shape: runs serialize, each write
 *    is a whole record, and the survivor is exactly one run's answer set —
 *    never an interleaving of the two;
 *  - the commit is staged-and-renamed over the exact bytes the merge consumed,
 *    so a third-party edit between the locked read and the swap refuses with
 *    `record-raced` and the edit survives untouched;
 *  - a write killed between staging and swap leaves the OLD record whole and a
 *    temp file `doctor` names — never truncated YAML. That one is pinned in
 *    test/verify-record-faults.test.ts, over a temp `stageWrites` really made:
 *    the copy here spelled the temp's name by hand and so kept passing whether
 *    or not staging still wrote that shape;
 *  - the lock is released on every refusal path, and a holder that outlives
 *    the bounded wait is answered with `docs-busy`, nothing read or written.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import {
  answersFile,
  DIR,
  FEAT,
  PAYMENT,
  RECORD,
  recordOnFile,
  serviceClaims,
  serviceRepo,
  SPLIT,
  spawnRecord,
} from "./helpers/federated.js";
import { stageWrites } from "../src/core/staging/commit.js";
import { COMMIT_INTENT } from "../src/core/staging/interrupted.js";
import { acquireDocsLock, acquireDocsLockWaiting, DocsBusyError, DOCS_LOCK } from "../src/core/staging/lock.js";
import { writeTxnIntent } from "../src/core/staging/txn/journal.js";
import { readVerificationState } from "../src/core/verify/file.js";
import { commitVerification } from "../src/core/verify/store/commit.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(): Promise<Project> {
  const p = await makeProject(coherentFixture());
  cleanups.push(() => p.destroy());
  return p;
}

/* ------------------------------------------------------------------ */
/* Two real processes                                                  */
/* ------------------------------------------------------------------ */

describe("two real processes recording one feature", () => {
  it("different services: both runs land and both attestations are on the file", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT);
    const paymentRepo = await serviceRepo(p, PAYMENT);
    const splitAnswers = await answersFile(splitRepo, await serviceClaims(p, SPLIT), "proof.ts:2");
    const paymentAnswers = await answersFile(paymentRepo, await serviceClaims(p, PAYMENT), "proof.ts:2");

    const [a, b] = await Promise.all([
      spawnRecord(splitRepo, SPLIT, splitAnswers),
      spawnRecord(paymentRepo, PAYMENT, paymentAnswers),
    ]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);

    const record = await recordOnFile(p);
    const services = (record["attestations"] as Array<{ service: string }>).map((x) => x.service).sort();
    expect(services).toEqual([PAYMENT, SPLIT].sort());
    // And the file is a record loam itself will read back, not merely YAML.
    const state = await readVerificationState(join(p.docsDir, DIR));
    expect(state.state).toBe("ok");
  }, 30_000);

  it("the same service twice: runs serialize and the survivor is exactly one run's answer set", async () => {
    const p = await project();
    const repoA = await serviceRepo(p, SPLIT, "split-a");
    const repoB = await serviceRepo(p, SPLIT, "split-b");
    const claims = await serviceClaims(p, SPLIT);
    const answersA = await answersFile(repoA, claims, "proof.ts:1");
    const answersB = await answersFile(repoB, claims, "proof.ts:2");

    const [a, b] = await Promise.all([spawnRecord(repoA, SPLIT, answersA), spawnRecord(repoB, SPLIT, answersB)]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);

    const record = await recordOnFile(p);
    const attested = (record["attestations"] as Array<{ service: string }>).filter((x) => x.service === SPLIT);
    expect(attested).toHaveLength(1);
    // Whole-record semantics: every claim carries the SAME run's evidence.
    // A mix of the two would mean one write landed inside the other.
    const evidence = (record["claims"] as Array<{ subject: string; evidence: string[] }>)
      .filter((c) => c.subject === SPLIT)
      .map((c) => c.evidence[0]);
    expect(new Set(evidence).size).toBe(1);
    expect(["proof.ts:1", "proof.ts:2"]).toContain(evidence[0]);
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* The lock                                                            */
/* ------------------------------------------------------------------ */

describe("the docs lock around --record", () => {
  it("waits out a live holder and then lands, instead of refusing on first contact", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");

    const release = await acquireDocsLock(p.docsDir);
    const pending = runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");
    // Held for a beat — long enough that a refuse-fast form would already have
    // answered docs-busy — then released while the record is still waiting.
    await new Promise((r) => setTimeout(r, 300));
    await release();
    const res = await pending;
    expect(res.code, res.out).toBe(0);
    expect(existsSync(join(p.docsDir, RECORD))).toBe(true);
  });

  it("a holder that never leaves is answered docs-busy after the bounded wait, nothing written", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    // This test's own live pid: the stale-lock breaker must not touch it.
    const lockPath = join(p.docsDir, DOCS_LOCK);
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, host: hostname(), at: "now" }) + "\n", "utf8");

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");
    expect(existsSync(join(p.docsDir, RECORD))).toBe(false);
    // The refusal did not eat the holder's lock either.
    expect(existsSync(lockPath)).toBe(true);
  }, 20_000);

  it("a docsDir that does not exist refuses docs-missing before any lock is created", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const broken = { docsDir: join(dirname(p.workDir), "no-such-docs"), service: SPLIT };
    await writeFile(join(repo, "loam.json"), JSON.stringify(broken, null, 2) + "\n", "utf8");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", "answers.json", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-missing");
    // No lock file was invented inside the directory that is not a docs repo.
    expect(existsSync(join(broken.docsDir, DOCS_LOCK))).toBe(false);
  });

  it("a refusal under the lock still releases it", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", "no-such-answers.json", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("answers-unreadable");
    expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
  });

  it("acquireDocsLockWaiting: bounded — a deadline that passes rethrows DocsBusyError", async () => {
    const p = await project();
    const release = await acquireDocsLock(p.docsDir);
    try {
      await expect(acquireDocsLockWaiting(p.docsDir, 120)).rejects.toBeInstanceOf(DocsBusyError);
    } finally {
      await release();
    }
    // Free again: the waiting form acquires immediately and releases cleanly.
    const releaseWaiting = await acquireDocsLockWaiting(p.docsDir, 120);
    await releaseWaiting();
    expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The commit                                                          */
/* ------------------------------------------------------------------ */

describe("commitVerification", () => {
  /** One recorded run, read back: a real Verification plus the exact bytes under it. */
  async function recordedState(p: Project) {
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    const state = await readVerificationState(join(p.docsDir, DIR));
    if (state.state !== "ok") throw new Error(`fixture record unreadable: ${JSON.stringify(state)}`);
    return state;
  }

  it("a third-party edit between the read and the commit refuses record-raced and survives", async () => {
    const p = await project();
    const state = await recordedState(p);
    const path = join(p.docsDir, RECORD);
    const edited = state.raw.toString("utf8") + "# a human annotated this by hand\n";
    await writeFile(path, edited, "utf8");

    const outcome = await commitVerification(join(p.docsDir, DIR), state.verification, state.raw, p.docsDir);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("record-raced");
    // The edit is byte-identical on disk, and no staging residue sits beside it.
    expect(await readFile(path, "utf8")).toBe(edited);
    const dir = await readdir(join(p.docsDir, DIR));
    expect(dir.filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("a record that appeared after an absent read refuses record-raced rather than replacing it", async () => {
    const p = await project();
    const state = await recordedState(p);
    // The caller read "absent" (preImage null) — but the file exists now.
    const outcome = await commitVerification(join(p.docsDir, DIR), state.verification, null, p.docsDir);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("record-raced");
    expect((await readVerificationState(join(p.docsDir, DIR))).state).toBe("ok");
  });

  it("a matching pre-image commits atomically: new bytes, no temp residue", async () => {
    const p = await project();
    const state = await recordedState(p);
    const outcome = await commitVerification(join(p.docsDir, DIR), state.verification, state.raw, p.docsDir);
    expect(outcome.ok).toBe(true);
    const after = await readVerificationState(join(p.docsDir, DIR));
    expect(after.state).toBe("ok");
    const dir = await readdir(join(p.docsDir, DIR));
    expect(dir.filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* A predecessor's interrupted commit                                  */
/* ------------------------------------------------------------------ */

/**
 * `--record` was the last docs-repo writer that could still treat a
 * half-commit as healthy: it took the lock, read the record authoritatively,
 * and merged — over whatever bytes a killed `rebase`, `vouch` or `new` had
 * left. It now recovers (or refuses) inside that same held lock, before the
 * read.
 */
describe("a version-2 journal in the docs repo", () => {
  /**
   * A commit killed before its one swap: the journal is fsynced, the temp holds
   * the after-bytes, nothing has landed. The file is a docs-root note nothing
   * in the fleet reads, on purpose — the question here is whether `--record`
   * recovers, and a target that fed the checklist would change the claim ids
   * this test's answers were written against.
   */
  async function killedRebase(p: Project): Promise<string> {
    const note = join(p.docsDir, "NOTES.md");
    const staged = await stageWrites([{ path: note, content: "carried forward by recovery\n" }]);
    await writeTxnIntent(
      { root: p.docsDir, command: "rebase", rerun: "loam rebase FEAT-1", target: FEAT },
      staged,
    );
    return note;
  }

  it("is rolled forward before the authoritative read, and rides the payload", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    const note = await killedRebase(p);

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).recovered).toMatchObject({
      command: "rebase",
      feature: FEAT,
      outcome: "repaired",
    });
    // The commit was finished, the record landed on top of it, and the journal
    // is gone — a record written over a half-commit is the state this closes.
    expect(await readFile(note, "utf8")).toBe("carried forward by recovery\n");
    expect(existsSync(join(p.docsDir, RECORD))).toBe(true);
    expect(existsSync(join(p.docsDir, COMMIT_INTENT))).toBe(false);
    expect((await readVerificationState(join(p.docsDir, DIR))).state).toBe("ok");
  });

  it("that cannot be read refuses commit-interrupted, and the record is never written", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    // The bytes a crash DURING the journal write leaves: nothing can grade it.
    await writeFile(join(p.docsDir, COMMIT_INTENT), '{"version":2,"command":"reba', "utf8");

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("commit-interrupted");
    expect(existsSync(join(p.docsDir, RECORD))).toBe(false);
    // The record it could not grade is left for a human to reconcile.
    expect(existsSync(join(p.docsDir, COMMIT_INTENT))).toBe(true);
    // And the lock is back, like every other refusal under it: the recovery
    // sits INSIDE the try whose finally releases, so this path cannot turn one
    // unreadable journal into a docs repo wedged for the whole fleet. It once
    // sat outside, and did exactly that.
    expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
  });
});
