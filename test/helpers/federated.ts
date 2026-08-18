/**
 * The fixture vocabulary for a FEDERATED verification: the service repos that
 * stand around `coherentFixture()`, the checklist they answer, and the two ways
 * a suite can run `--record` against them.
 *
 * It sits beside `harness.ts` rather than inside it because it is a narrower
 * subject with a narrower audience. `harness.ts` builds a docs repo and runs a
 * command in it — every suite needs that. This builds the OTHER side of a
 * federation: a git repository with its own `loam.json`, a committed file for
 * evidence to point at, and a HEAD for an attestation to bind to. Four suites
 * had grown their own copy of it (`verify`, `verify-federation`,
 * `verify-concurrency`, `verify-record-faults`), and four copies of a fixture
 * are four places a change to the record's contract has to be found.
 *
 * Everything here is deliberately pinned to `coherentFixture()`'s one feature.
 * These helpers are not a general fixture builder — a suite testing a different
 * fleet writes its own — so the ids are constants rather than parameters, and
 * `spawnRecord` can take a repo, a service and an answer set and nothing else.
 */
import { execFile, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { parse } from "yaml";
import { cliEntry, trackChild, tsxBin } from "./cli-process.js";
import { runLoam, type Project } from "./harness.js";

/** The feature `coherentFixture()` carries, and the paths and services around it. */
export const FEAT = "FEAT-1";
export const DIR = "features/FEAT-1-split";
export const RECORD = `${DIR}/verification.yaml`;
export const SPLIT = "payment-split-service";
export const PAYMENT = "payment-service";

/**
 * A claim as `loam verify --json` reports it. Every field the four suites read
 * between them: two of them only ever look at `id` and `subject`, and the wider
 * shape costs them nothing.
 */
export interface Claim {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: string;
}

/**
 * A service repository beside the docs project: its own loam.json naming the
 * service, one committed file to point evidence at, and a git HEAD to bind to.
 *
 * `name` is the directory to build it in, and the one sentinel value
 * `"primary"` means the docs project's OWN workdir — the shape a suite needs
 * when the repository under test is the one `runLoam` is already standing in,
 * rather than a second one beside it.
 */
export async function serviceRepo(p: Project, service: string, name = service): Promise<string> {
  const repo = name === "primary" ? p.workDir : join(dirname(p.workDir), name);
  await mkdir(repo, { recursive: true });
  await writeFile(
    join(repo, "loam.json"),
    JSON.stringify({ docsDir: p.docsDir, service }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(join(repo, "proof.ts"), "export const proof = true;\n// implementation evidence\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "loam.json", "proof.ts"], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", "fixture"],
    { cwd: repo },
  );
  return repo;
}

/** The whole checklist, read from the docs project (nothing is narrowed). */
export async function allClaims(p: Project): Promise<Claim[]> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout).claims as Claim[];
}

/** The claims one service owns — what `--record --service <id>` is allowed to answer. */
export async function serviceClaims(p: Project, service: string): Promise<Claim[]> {
  return (await allClaims(p)).filter((claim) => claim.subject === service);
}

/** An answer set confirming every claim on the same piece of evidence. */
export async function answersFile(
  dir: string,
  claims: Claim[],
  evidence = "proof.ts:2",
  name = "answers.json",
): Promise<string> {
  await writeFile(
    join(dir, name),
    JSON.stringify(
      claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: [evidence] })),
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return name;
}

export interface PendingRecord {
  done: Promise<{ code: number; out: string }>;
  child: ChildProcess;
}

/**
 * A REAL process, not the in-process harness: the whole CLI entry, its own cwd,
 * its own lock contention.
 *
 * The child handle is returned beside its result because a suite that has to
 * interleave with a run still in flight needs both — something to synchronise
 * against, and something to kill when the interleaving goes wrong rather than
 * hang the whole file.
 */
export function startRecord(repo: string, service: string, answers: string): PendingRecord {
  const child = execFile(tsxBin, [cliEntry, "verify", FEAT, "--service", service, "--record", answers, "--json"], {
    cwd: repo,
  });
  trackChild(child);
  const done = new Promise<{ code: number; out: string }>((resolve) => {
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
  return { done, child };
}

/** {@link startRecord} for the callers that only want the outcome. */
export function spawnRecord(repo: string, service: string, answers: string): Promise<{ code: number; out: string }> {
  return startRecord(repo, service, answers).done;
}

/** The record as it is ON DISK — parsed from the file, never from a command's payload. */
export async function recordOnFile(p: Project): Promise<Record<string, unknown>> {
  return parse(await readFile(join(p.docsDir, RECORD), "utf8")) as Record<string, unknown>;
}
