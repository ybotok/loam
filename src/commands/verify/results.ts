/**
 * The cucumber report, and the repository it has to be evidence FROM.
 *
 * A results file is only evidence if it describes the commit the attestation
 * names, so reading it and checking the repository are one subject: the git
 * helpers below are here because they answer the same question — is this
 * working tree the one the report was produced from.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type ErrorCode } from "../../core/envelope/json.js";
import { resolvePortableFileInside } from "../../core/kernel/path-safety.js";
import { readCucumberReport, type ReportScenario } from "../../core/results.js";
import { type Answer } from "../../core/verify/answers.js";
import { type ConsumedReport } from "../../core/verify/record.js";

export type ResultsRead =
  | { ok: true; report: ConsumedReport; scenarios: ReportScenario[] }
  | { ok: false; code: ErrorCode; message: string };

/**
 * The report as an artifact, not merely as a parse.
 *
 * `repoDir` is set in federated mode, and there the report must be a file
 * INSIDE the repository being attested, resolved by the same rules as evidence
 * (`resolvePortableFileInside`): an attestation says "at this commit, in this
 * repository", and a report living somewhere else answers for a run nobody
 * standing here can find. The legacy all-at-once form binds to no repository at
 * all, so it takes the path as spelled — its looser contract, unchanged.
 *
 * Either way the bytes are digested and the file's mtime read, because loam
 * cannot prove a JSON file came from executing this commit and should stop
 * implying otherwise. It can say precisely which file it consumed, and that
 * goes on the record.
 */
export async function readResults(spelled: string, repoDir: string | undefined): Promise<ResultsRead> {
  let path: string;
  if (repoDir === undefined) {
    path = resolve(process.cwd(), spelled);
  } else {
    try {
      path = resolvePortableFileInside(repoDir, spelled, "test report");
    } catch (err) {
      return {
        ok: false,
        code: "answers-unreadable",
        message:
          `Cannot answer from ${spelled}: ${err instanceof Error ? err.message : String(err)}. ` +
          "A federated attestation rests on a report inside the repository it attests — give the path relative to the repo root.",
      };
    }
  }

  let bytes: Buffer;
  let mtime: Date;
  try {
    bytes = await readFile(path);
    mtime = (await stat(path)).mtime;
  } catch (err) {
    return {
      ok: false,
      code: "answers-unreadable",
      message: `Cannot read ${spelled} as a cucumber JSON report: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "answers-unreadable",
      message: `Cannot read ${spelled} as a cucumber JSON report: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const parsed = readCucumberReport(doc, spelled);
  if (!parsed.ok) return { ok: false, code: "answers-unreadable", message: parsed.message };
  return {
    ok: true,
    scenarios: parsed.scenarios,
    report: {
      path: spelled,
      digest: createHash("sha256").update(bytes).digest("hex"),
      mtime: mtime.toISOString(),
      scenarios: parsed.scenarios.length,
    },
  };
}

/**
 * In federated mode, a confirmation is accepted only when its evidence holds up
 * in this repository: an agent's `file:line` resolves to a real line that is
 * unchanged at the attested commit, and the runner's evidence names the report
 * loam just read. Legacy global mode deliberately keeps its original, looser
 * evidence contract for backward compatibility.
 */
export async function validateServiceEvidence(
  answers: Answer[],
  repoDir: string,
  commit: string,
  report?: ConsumedReport,
): Promise<string | null> {
  if (report !== undefined) {
    // Most reports are build output and untracked, and `git diff` is quiet on
    // those — nothing here invents a rule for them. One the repository DOES
    // carry has to match the commit being attested, like any other file the
    // evidence rests on.
    const clean = await git(repoDir, ["diff", "--quiet", commit, "--", report.path]);
    if (clean.code !== 0) {
      // Only `1` is git ANSWERING — "that file differs". Every other non-zero
      // code is git failing to answer at all: no git on PATH, a fork that never
      // happened, a child killed by a CI timeout or the OOM killer. Testing for
      // `1` alone made those silently pass the check, so the one run that most
      // needs the binding — the one where the machine is falling over — is the
      // one that would mint an attestation whose report was never bound to the
      // commit. An unanswered check is not a passed one, so the unknown refuses
      // on the same terms as the known, and `clean.stderr` carries whatever
      // account of itself the child managed to leave.
      return clean.code === 1
        ? `The test report '${report.path}' is committed to this repository and differs from ${commit.slice(0, 12)} — commit it or attest the commit it belongs to.`
        : `Cannot tell whether the test report '${report.path}' is bound to ${commit.slice(0, 12)} — git could not be run to completion: ${clean.stderr || "git diff failed"}`;
    }
  }
  for (const answer of answers) {
    if (answer.verdict !== "confirmed") continue;
    if (answer.answered_by === "runner") {
      // The runner's evidence is a scenario inside the report, not a file:line
      // in the source — there is nothing to resolve. What must hold is that it
      // names THAT report: an answer pointing anywhere else is not this run's.
      const stray = answer.evidence.filter((e) => report === undefined || !e.startsWith(`${report.path}: `));
      if (stray.length > 0) {
        return `Claim ${answer.id} has runner evidence ${stray.map((e) => `'${e}'`).join(", ")} that does not name the report loam read.`;
      }
      continue;
    }
    for (const evidence of answer.evidence) {
      const match = /^(.+):([1-9]\d*)$/.exec(evidence);
      if (match === null) {
        return `Claim ${answer.id} has evidence '${evidence}' — service evidence must be a canonical relative file:line.`;
      }
      const relativePath = match[1]!;
      const line = Number(match[2]);
      let absolutePath: string;
      try {
        absolutePath = resolvePortableFileInside(repoDir, relativePath, `evidence for ${answer.id}`);
      } catch (err) {
        return `Claim ${answer.id} has unsafe evidence '${evidence}': ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        const info = await stat(absolutePath);
        if (!info.isFile()) {
          return `Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' is not a regular file.`;
        }
        const source = await readFile(absolutePath, "utf8");
        const lines = source.split(/\r\n|\n|\r/).length;
        if (line > lines) {
          return `Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' has only ${lines} line(s).`;
        }
        const committed = await committedFile(repoDir, commit, relativePath);
        if (!committed.ok) {
          return `Claim ${answer.id} has evidence '${evidence}' that is not bound to ${commit.slice(0, 12)}: ${committed.message}`;
        }
        const committedLines = committed.source.split(/\r\n|\n|\r/).length;
        if (line > committedLines) {
          return `Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' has only ${committedLines} line(s) at ${commit.slice(0, 12)}.`;
        }
      } catch (err) {
        return `Claim ${answer.id} has unreadable evidence '${evidence}': ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }
  return null;
}

type CommitResult = { ok: true; commit: string } | { ok: false; message: string };
type CommittedFileResult = { ok: true; source: string } | { ok: false; message: string };

/** Require the evidence blob to exist at HEAD and have no uncommitted edits. */
export async function committedFile(repoDir: string, commit: string, path: string): Promise<CommittedFileResult> {
  const clean = await git(repoDir, ["diff", "--quiet", commit, "--", path]);
  if (clean.code !== 0) {
    return {
      ok: false,
      message: clean.code === 1 ? `'${path}' has uncommitted changes` : clean.stderr || "git diff failed",
    };
  }
  const blob = await git(repoDir, ["show", `${commit}:${path}`]);
  if (blob.code !== 0) {
    return { ok: false, message: blob.stderr || `'${path}' is not tracked by that commit` };
  }
  return { ok: true, source: blob.stdout };
}

interface GitResult {
  /**
   * Git's own exit status, or `-1` for "git could not be run to completion" —
   * no git on PATH, a spawn failure, a child killed by a signal (the deadline
   * below included), or output past the declared cap. Callers read specific
   * meaning into small numbers (`1` from `git diff --quiet` is "that file
   * differs"), so a run that never reached an exit status must not borrow one
   * of them.
   */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * How long one git question may take, and how much it may say. Both bounds
 * exist because every call in this module now runs while `loam verify --record`
 * HOLDS the docs lock: a `git rev-parse` blocked on a credential-helper prompt
 * used to hang this process forever with the lock in hand, wedging every
 * archive, rebase and record in the fleet behind a live pid that
 * `breakStaleLock` rightly refuses to break. The timeout mirrors
 * `core/provenance/git.ts`; the cap is sized for `git show` of a source file
 * an attestation cites (the default 1 MiB refused sound evidence the moment a
 * generated client crossed it), not for arbitrary blobs.
 */
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function git(repoDir: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile(
      "git",
      ["-C", repoDir, ...args],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
      done({
        // `error.code` is an exit status only when it is a number: a spawn
        // failure reports an errno string ("ENOENT") and a signal-killed child
        // reports none at all. Folding those onto 1 would state that `git diff`
        // found a difference — a Ctrl-C or an OOM kill during
        // `loam verify --record` would read as an uncommitted edit and refuse
        // a sound attestation. -1 is not a status git assigns, so both diff
        // sites fall to their stderr-carrying arm and say what happened.
        code: error === null ? 0 : typeof error.code === "number" ? error.code : -1,
        stdout,
        // A child that never ran writes nothing to stderr, so its only account
        // of itself is on the error; without this the refusal would name no
        // cause at all. A child WE killed gets its account written for it: the
        // deadline exists for a git blocked on a credential-helper prompt, and
        // the raw "Command failed: git …" says nothing about a deadline — the
        // operator re-runs, waits the same 10 s, and reads the same message,
        // with the actual fix (GIT_TERMINAL_PROMPT=0, or the helper) never
        // reachable from it.
        stderr:
          error !== null && error.killed && error.signal !== null
            ? `git did not answer within ${GIT_TIMEOUT_MS / 1000}s and was stopped — a prompt or a hung remote; GIT_TERMINAL_PROMPT=0 disables credential prompts`
            : stderr.trim() || (error === null ? "" : error.message),
      });
    });
  });
}

/** Resolve HEAD without a shell, so repository paths remain data, never code. */
export async function repositoryCommit(repoDir: string): Promise<CommitResult> {
  const result = await git(repoDir, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (result.code !== 0) {
    return {
      ok: false,
      message: `Federated verification requires a git repository with a committed HEAD: ${result.stderr || "git rev-parse failed"}`,
    };
  }
  const commit = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    return { ok: false, message: `Git returned an invalid HEAD commit '${commit}'.` };
  }
  return { ok: true, commit };
}
