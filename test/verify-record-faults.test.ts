/**
 * The verification record's write path when something goes WRONG underneath it.
 *
 * `test/verify-concurrency.test.ts` pins the contended-but-healthy shapes: two
 * recorders landing, the lock waiting, the CAS refusing a third-party edit.
 * This file is its complement — every way the filesystem, a stray file, a
 * symlink or a hand-edited record can make the commit fail, and what loam owes
 * the operator in each case:
 *
 *  - a feature directory that will not take a write is `merge-failed` with
 *    "nothing was recorded", never an `internal` with a stack;
 *  - a rollback that could not put a file back names the file and says the repo
 *    may be HALF-WRITTEN — the one refusal that means "look at this by hand";
 *  - a temp file abandoned by a killed writer is litter, not damage: the old
 *    record is whole, `doctor` names the temp as a warning, and the next
 *    `--record` lands over it;
 *  - an editor that lands between the locked read and the swap is refused with
 *    `record-raced` naming a REPO-RELATIVE path, and their bytes survive;
 *  - a `verification.yaml` that is a dangling symlink is `record-unreadable`,
 *    not "no record" — the mislabel that made every later record impossible;
 *  - a `.loam-lock` nothing can interpret is `docs-busy` for the writer and a
 *    BLOCKER for `doctor`, because nothing is ever going to release it;
 *  - a summary balanced by hand with a NEGATIVE count reads as unreadable
 *    everywhere rather than as a verified feature;
 *  - evidence bigger than a default pipe buffer is evidence, not a refusal.
 *
 * Every refusal here is also asserted to have written nothing: a refusal that
 * leaves a partial record is the defect this whole write path exists to stop.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { constants, existsSync, statSync } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { coherentFixture, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";
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
  startRecord,
} from "./helpers/federated.js";
import { DOCS_LOCK } from "../src/core/staging/lock.js";
import { rollbackMessage, rollbackStaged, stageWrites, swapStaged } from "../src/core/staging/commit.js";
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

/** Commit whatever is in the repo under a fixed identity, so no machine's git config decides the test. */
function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", message],
    { cwd: repo },
  );
}

function attestedServices(record: Record<string, unknown>): string[] {
  return (record["attestations"] as Array<{ service: string }>).map((x) => x.service).sort();
}

/** One recorded run through the real CLI, so verification.yaml exists to be damaged. */
async function recordOnce(p: Project, service: string, evidence: string): Promise<string> {
  const repo = await serviceRepo(p, service);
  const answers = await answersFile(repo, await serviceClaims(p, service), evidence);
  const res = await spawnRecord(repo, service, answers);
  expect(res.code, res.out).toBe(0);
  return repo;
}

/** Root ignores file modes, so every chmod-based refusal here is unreachable as root. */
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

/* ------------------------------------------------------------------ */
/* A filesystem that refuses the write                                 */
/* ------------------------------------------------------------------ */

describe("a feature directory the commit cannot write", () => {
  it.skipIf(asRoot)("refuses merge-failed saying nothing was recorded, and leaves the old record byte for byte", async () => {
    // A read-only feature directory is not a bug in loam, and it used to escape
    // as `internal` with a stack — sending the reader looking for one. What the
    // operator needs is the sentence that says their record is intact.
    const p = await project();
    const repo = await recordOnce(p, SPLIT, "proof.ts:2");
    const before = await readFile(join(p.docsDir, RECORD));
    const dir = join(p.docsDir, DIR);

    await chmod(dir, 0o555);
    try {
      const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", "answers.json", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("merge-failed");
      expect(payload.error.message).toContain("nothing was recorded");
      expect((await readFile(join(p.docsDir, RECORD))).equals(before)).toBe(true);
      // The refusal happened under the docs lock, and released it on the way out.
      expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it.skipIf(asRoot)("answers merge-failed from commitVerification itself, with no staging residue beside the record", async () => {
    // The same refusal one layer down: even if the command's mapping changed,
    // the commit's own vocabulary for "staging never got off the ground" is
    // merge-failed — `trust the repo` — and never `rollback-incomplete`.
    const p = await project();
    await recordOnce(p, SPLIT, "proof.ts:2");
    const featureDir = join(p.docsDir, DIR);
    const state = await readVerificationState(featureDir);
    if (state.state !== "ok") throw new Error(`fixture record unreadable: ${JSON.stringify(state)}`);

    await chmod(featureDir, 0o555);
    try {
      const outcome = await commitVerification(featureDir, state.verification, state.raw, p.docsDir);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("merge-failed");
        expect(outcome.message).toContain("nothing was recorded");
      }
    } finally {
      await chmod(featureDir, 0o755);
    }
    expect((await readdir(featureDir)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* A rollback that could not finish                                    */
/* ------------------------------------------------------------------ */

describe("a rollback the staging layer could not complete", () => {
  it("names the file it left alone and says the repo may be half-written", async () => {
    // This is the `rollback-incomplete` sentence `commitVerification` prints,
    // pinned where it is reachable. Two things have to hold for it to mean
    // anything: a rollback must REFUSE to overwrite a file somebody else wrote
    // after this run did (restoring the pre-image there would destroy their
    // work while reporting a clean failure), and the message must say
    // half-written rather than report a tidy `merge-failed`.
    const p = await project();
    const target = join(p.docsDir, DIR, "scratch.yaml");
    await writeFile(target, "the bytes before this run\n", "utf8");

    const staged = await stageWrites([{ path: target, content: "the bytes this run wrote\n" }]);
    await swapStaged(staged);
    // A third writer lands on the file AFTER this run swapped its own bytes in.
    await writeFile(target, "somebody else's bytes\n", "utf8");

    const failures = await rollbackStaged(staged);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(target);
    expect(await readFile(target, "utf8")).toBe("somebody else's bytes\n");

    const sentence = rollbackMessage(new Error("rename failed"), failures, "written");
    expect(sentence).toContain("ROLLBACK INCOMPLETE");
    expect(sentence).toContain("half-written");
    expect(sentence).toContain(target);
  });
});

/* ------------------------------------------------------------------ */
/* A writer killed between staging and swap                            */
/* ------------------------------------------------------------------ */

describe("a temp file abandoned beside the record", () => {
  it("leaves the record whole, is named by doctor as a warning, and blocks no later record", async () => {
    // The constructed post-crash state: staging's temp beside the target, the
    // target untouched — exactly what a SIGKILL after stageWrites leaves. It is
    // litter, not damage, and a `--record` that refused to run over it would
    // turn one killed process into a feature nobody can ever verify again.
    const p = await project();
    await recordOnce(p, SPLIT, "proof.ts:2");
    const recordPath = join(p.docsDir, RECORD);
    const before = await readFile(recordPath);

    const staged = await stageWrites([{ path: recordPath, content: "half-written staging bytes" }]);
    const temp = staged[0]!.tmp!;
    expect(existsSync(temp)).toBe(true);
    expect((await readFile(recordPath)).equals(before)).toBe(true);

    const doctor = await runLoam(p.workDir, "doctor", "--json");
    const report = JSON.parse(doctor.stdout);
    expect(report.writePath.temps).toContain(relative(p.docsDir, temp).split(/[\\/]/).join("/"));
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "doctor.staging-temps", severity: "warning" }),
    );
    // A never-linked temp is not a reason to call the repo blocked.
    expect(report.healthy).toBe(true);

    const paymentRepo = await serviceRepo(p, PAYMENT);
    const answers = await answersFile(paymentRepo, await serviceClaims(p, PAYMENT), "proof.ts:2");
    const res = await spawnRecord(paymentRepo, PAYMENT, answers);
    expect(res.code, res.out).toBe(0);
    expect(attestedServices(await recordOnFile(p))).toEqual([PAYMENT, SPLIT].sort());
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* An editor inside the locked window                                  */
/* ------------------------------------------------------------------ */

/**
 * Open the FIFO for writing without ever blocking on it.
 *
 * `open(fifo, "w")` blocks until a reader arrives, which is precisely the
 * signal this test wants — but a CLI that refuses BEFORE it reads the answers
 * would leave that open pending forever and hang the worker instead of failing
 * the test. O_NONBLOCK turns the same signal into a poll: ENXIO means no reader
 * yet, success means the CLI has the FIFO open and is waiting on its bytes.
 */
async function openFifoOnceRead(path: string, deadlineMs: number): Promise<Awaited<ReturnType<typeof open>>> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await open(path, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENXIO" || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

describe("an edit that lands between the locked read and the swap", () => {
  it.skipIf(process.platform === "win32")("refuses record-raced naming the repo-relative path, and the editor's bytes survive", async () => {
    // The answers file is read AFTER the authoritative read under the lock, so a
    // FIFO for `--record` is the one place a test can stop a REAL run inside the
    // window the compare-and-set exists for. Before the CAS, the merge computed
    // from bytes that no longer existed was written straight over the editor.
    const p = await project();
    await recordOnce(p, SPLIT, "proof.ts:2");
    const paymentRepo = await serviceRepo(p, PAYMENT);
    const claims = await serviceClaims(p, PAYMENT);
    const fifo = join(paymentRepo, "answers.fifo");
    execFileSync("mkfifo", [fifo]);

    const pending = startRecord(paymentRepo, PAYMENT, "answers.fifo");
    try {
      const writer = await openFifoOnceRead(fifo, 45_000);
      // The CLI is now past its authoritative read and blocked on the answers.
      const recordPath = join(p.docsDir, RECORD);
      const edited = (await readFile(recordPath, "utf8")) + "# edited-by-test\n";
      await writeFile(recordPath, edited, "utf8");

      await writer.write(
        JSON.stringify(claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["proof.ts:2"] }))) + "\n",
      );
      await writer.close();

      const res = await pending.done;
      expect(res.code, res.out).toBe(1);
      const payload = JSON.parse(res.out.slice(res.out.indexOf("{")));
      expect(payload.error.code).toBe("record-raced");
      // Repo-relative, not absolute: the path is quoted back to somebody
      // standing in a service repo, where the docs repo's absolute path is
      // meaningless — and it must be the record's path, not the docs root's.
      // Taken out of the message rather than compared to a constant, so an
      // absolute path smuggled in by `repoPath` would fail here.
      const named = /(\S*verification\.yaml)/.exec(payload.error.message as string)?.[1];
      expect(named).toBe(RECORD);
      expect(named!.startsWith("/")).toBe(false);
      expect(payload.error.message).not.toContain(p.docsDir);

      // The third party's bytes are exactly as they left them, and the lock is free.
      expect(await readFile(recordPath, "utf8")).toBe(edited);
      expect((await readdir(join(p.docsDir, DIR))).filter((n) => n.includes(".tmp"))).toEqual([]);
      expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
    } finally {
      pending.child.kill("SIGKILL");
    }
  }, 90_000);
});

/* ------------------------------------------------------------------ */
/* verification.yaml as a symlink                                      */
/* ------------------------------------------------------------------ */

describe("a verification.yaml that is a symlink", () => {
  it("refuses record-unreadable and says symlink when the target does not exist", async () => {
    // `existsSync` folds a dangling link into "absent", and that mislabel was a
    // trap: the read said "no record" while the commit's exclusive link(2) saw
    // the link itself and refused EEXIST, so every `--record` answered
    // `record-raced` with advice (re-run) that could never work.
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    const link = join(p.docsDir, RECORD);
    await symlink(join(p.docsDir, DIR, "no-such-target.yaml"), link);

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");

    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("record-unreadable");
    expect(payload.error.message).toContain("symlink");
    // Refused means untouched: the link is still a link and nothing was staged.
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect((await readdir(join(p.docsDir, DIR))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("is replaced by the swap when it points at a real record outside the docs repo, whose bytes are left alone", async () => {
    // A rename(2) replaces the LINK, never the file behind it. That is the
    // containment property worth pinning: a record symlinked out of the docs
    // repo cannot make loam write into somebody else's tree, and the record
    // that lands afterwards is a regular file inside the feature directory.
    const p = await project();
    await recordOnce(p, SPLIT, "proof.ts:2");
    const link = join(p.docsDir, RECORD);
    const outside = join(dirname(p.workDir), "outside-docs");
    await mkdir(outside, { recursive: true });
    const target = join(outside, "target.yaml");
    const bytes = await readFile(link);
    await writeFile(target, bytes);
    await rm(link);
    await symlink(target, link);

    const paymentRepo = await serviceRepo(p, PAYMENT);
    const answers = await answersFile(paymentRepo, await serviceClaims(p, PAYMENT), "proof.ts:2");
    const res = await runLoam(paymentRepo, "verify", FEAT, "--service", PAYMENT, "--record", answers, "--json");

    expect(res.code, res.out).toBe(0);
    expect((await readFile(target)).equals(bytes)).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(false);
    expect(attestedServices(await recordOnFile(p))).toEqual([PAYMENT, SPLIT].sort());
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* A lock nothing can interpret                                        */
/* ------------------------------------------------------------------ */

describe("a .loam-lock that names no holder", () => {
  it("answers docs-busy after the bounded wait, with nothing recorded", async () => {
    // A crash between the lock's create and its flush leaves an empty file.
    // `breakStaleLock` rightly refuses to guess about it, so the wait can only
    // ever run out — but it must run OUT, not hang, and it must write nothing.
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const answers = await answersFile(repo, await serviceClaims(p, SPLIT), "proof.ts:2");
    await writeFile(join(p.docsDir, DOCS_LOCK), "", "utf8");
    const before = await treeHashes(p.docsDir);

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", answers, "--json");

    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");
    expect(existsSync(join(p.docsDir, RECORD))).toBe(false);
    // Including the lock itself: a refusal must not eat the file it waited on.
    expect(await treeHashes(p.docsDir)).toEqual(before);
  }, 30_000);

  it("is graded by doctor as a blocker whose fix is to delete it", async () => {
    // "Wait and re-run" is advice that can never work here, so the finding may
    // not be the warning a live holder gets: nothing will ever release this
    // lock, and every writing command refuses `docs-busy` while it is there.
    const p = await project();
    await writeFile(join(p.docsDir, DOCS_LOCK), "", "utf8");

    const res = await runLoam(p.workDir, "doctor", "--json");

    expect(res.code).toBe(1);
    const report = JSON.parse(res.stdout);
    expect(report.ok).toBe(true);
    expect(report.healthy).toBe(false);
    expect(report.writePath.lock).toMatchObject({ path: DOCS_LOCK, unreadable: true });
    const locked = (report.findings as Array<{ code: string }>).find((f) => f.code === "doctor.docs-locked");
    expect(locked).toBeDefined();
    expect(locked).toMatchObject({ severity: "blocker" });
    expect((locked as unknown as { message: string }).message).toContain("cannot be read");
    expect((locked as unknown as { fix: string }).fix).toContain("Delete");
  });
});

/* ------------------------------------------------------------------ */
/* The docs-repo gate                                                  */
/* ------------------------------------------------------------------ */

describe("the docs-repo gate", () => {
  it("refuses docs-missing in read mode, inventing nothing at the path that is not there", async () => {
    // "Zero claims" and "I could not look" are opposite facts, and read mode
    // used to answer a docsDir that does not exist with a report over neither.
    // The record-mode half of this gate — the refusal that has to happen BEFORE
    // the lock file could be created inside a directory that is not a docs repo
    // — is pinned in verify-concurrency.test.ts; read mode takes no lock at all,
    // so there is nothing about ordering for this test to say.
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const missing = join(dirname(p.workDir), "no-such-docs");
    await writeFile(join(repo, "loam.json"), JSON.stringify({ docsDir: missing, service: SPLIT }, null, 2) + "\n", "utf8");
    const before = await treeHashes(p.docsDir);

    const res = await runLoam(repo, "verify", FEAT, "--json");

    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-missing");
    expect(existsSync(missing)).toBe(false);
    // And the real docs repo it was not looking at is untouched.
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* Two runs of one service, one after the other                        */
/* ------------------------------------------------------------------ */

describe("recording one service twice in a row", () => {
  it("keeps exactly the second run's answers, with no trace of the first", async () => {
    // Sequential runs are the case a merge must get right by construction: the
    // second reads what the first committed and REPLACES that service's
    // contribution whole. A record left holding one claim from each run would
    // be a record nobody wrote and nobody could reproduce.
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const claims = await serviceClaims(p, SPLIT);
    const first = await answersFile(repo, claims, "proof.ts:1", "answers-1.json");
    const second = await answersFile(repo, claims, "proof.ts:2", "answers-2.json");

    const a = await spawnRecord(repo, SPLIT, first);
    expect(a.code, a.out).toBe(0);
    const b = await spawnRecord(repo, SPLIT, second);
    expect(b.code, b.out).toBe(0);

    const record = await recordOnFile(p);
    const evidence = (record["claims"] as Array<{ subject: string; evidence: string[] }>)
      .filter((c) => c.subject === SPLIT)
      .map((c) => c.evidence[0]);
    expect(evidence.length).toBeGreaterThan(0);
    expect(new Set(evidence)).toEqual(new Set(["proof.ts:2"]));
    expect((record["attestations"] as Array<{ service: string }>).filter((x) => x.service === SPLIT)).toHaveLength(1);
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* A summary balanced by hand                                          */
/* ------------------------------------------------------------------ */

describe("a record whose summary balances its books with a negative count", () => {
  it("reads as unreadable everywhere rather than as a verified feature", async () => {
    // `unanswered: -2` is the one value that lets a hand-edited summary agree
    // with itself while contradicting the claims below it: every comparison
    // `summaryDisagreement` makes rebalances, and the recount then reports one
    // confirmed claim out of one — `verified` — over a record where two of
    // three claims are unconfirmed. Nothing loam writes is ever negative.
    const p = await project();
    await recordOnce(p, SPLIT, "proof.ts:2");
    const recordPath = join(p.docsDir, RECORD);
    const record = parse(await readFile(recordPath, "utf8")) as {
      claims: Array<{ verdict: string }>;
      summary: Record<string, number>;
    };
    const flipped = 2;
    for (const claim of record.claims.slice(-flipped)) claim.verdict = "unconfirmed";
    record.summary = {
      claims: record.claims.length - flipped,
      confirmed: record.claims.length - flipped,
      unconfirmed: flipped,
      unanswered: -flipped,
    };
    await writeFile(recordPath, stringify(record), "utf8");

    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(read.code).toBe(1);
    expect(JSON.parse(read.stdout).error.code).toBe("record-unreadable");

    const status = await runLoam(p.workDir, "status", FEAT, "--json");
    const verification = JSON.parse(status.stdout).verification as { state: string; verdict: string };
    expect(verification.state).toBe("unreadable");
    expect(verification.verdict).toBe("unverified");
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* Evidence larger than a default pipe buffer                          */
/* ------------------------------------------------------------------ */

describe("evidence in a file bigger than a megabyte", () => {
  it("is accepted, because the git read that binds it to the commit is not capped at 1 MiB", async () => {
    // `git show <commit>:<path>` is how evidence is bound to the attested
    // commit. Under execFile's default 1 MiB maxBuffer the child was killed the
    // moment a generated client crossed it, reported as "git could not be run",
    // and sound evidence was refused with `answers-unevidenced`.
    const p = await project();
    const repo = await serviceRepo(p, SPLIT);
    const big = join(repo, "generated-client.ts");
    await writeFile(big, "// evidence line for a generated client\n".repeat(30_000), "utf8");
    expect(statSync(big).size).toBeGreaterThan(1.1 * 1024 * 1024);
    commitAll(repo, "generated client");

    const claims = await serviceClaims(p, SPLIT);
    await writeFile(
      join(repo, "answers.json"),
      JSON.stringify(
        claims.map((c, i) => ({
          id: c.id,
          verdict: "confirmed",
          evidence: [i === 0 ? "generated-client.ts:10" : "proof.ts:2"],
        })),
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const res = await runLoam(repo, "verify", FEAT, "--service", SPLIT, "--record", "answers.json", "--json");

    expect(res.code, res.out).toBe(0);
    const recorded = (await recordOnFile(p))["claims"] as Array<{ evidence: string[] }>;
    expect(recorded.flatMap((c) => c.evidence)).toContain("generated-client.ts:10");
  }, 60_000);
});
