/**
 * The cucumber report, and the repository it has to be evidence FROM.
 *
 * A results file is only evidence if it describes the commit the attestation
 * names, so reading it and checking the repository are one subject: the git
 * helpers below are here because they answer the same question — is this
 * working tree the one the report was produced from.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolvePortableFileInside } from "../../core/kernel/path-safety.js";
import { readCucumberReport, type ReportScenario } from "../../core/results.js";
import { type Answer } from "../../core/verify/answers.js";
import { citedLine, pinnedDigest, sourceLines, type EvidencePin } from "../../core/verify/pins/pin.js";
import { type ConsumedReport, type ConsumedReports } from "../../core/verify/record.js";
import { type EvidencePins, type TokenMiss } from "./evidence/pins.js";
import { readReportArtifact } from "./evidence/read.js";

export type ResultsRead =
  | { ok: true; report: ConsumedReport; scenarios: ReportScenario[] }
  | { ok: false; code: "answers-unreadable"; message: string };

/**
 * The report as an artifact, not merely as a parse. The resolve/read/digest
 * plumbing lives in `./evidence/read.ts`, shared with `--contract-results`:
 * the bytes are digested and the file's mtime read, because loam cannot prove
 * a JSON file came from executing this commit and should stop implying
 * otherwise. It can say precisely which file it consumed, and that goes on
 * the record.
 */
export async function readResults(spelled: string, repoDir: string | undefined): Promise<ResultsRead> {
  const artifact = await readReportArtifact(spelled, repoDir, "cucumber JSON report");
  if (!artifact.ok) return artifact;
  const parsed = readCucumberReport(artifact.doc, spelled);
  if (!parsed.ok) return { ok: false, code: "answers-unreadable", message: parsed.message };
  return {
    ok: true,
    scenarios: parsed.scenarios,
    report: {
      path: artifact.spelled,
      digest: artifact.digest,
      mtime: artifact.mtime,
      scenarios: parsed.scenarios.length,
    },
  };
}

/**
 * The repository an attestation binds to and the commit it binds at — two
 * values only ever asked about together, so they travel as one and the
 * inconsistent pair (this repo, that commit) stops being representable.
 */
export interface AttestationBinding {
  repoDir: string;
  commit: string;
}

export type ServiceEvidenceCheck =
  /** Every citation held up; `pins`/`tokenMisses` are the stamp and the honesty it computed en route. */
  | ({ ok: true } & EvidencePins)
  | { ok: false; message: string };

/**
 * In federated mode, a confirmation is accepted only when its evidence holds up
 * in this repository: an agent's `file:line` resolves to a real line that is
 * unchanged at the attested commit, and each runner's evidence names the report
 * loam just read — the cucumber report for `runner`, the contract report for
 * `external-runner`. Legacy global mode deliberately keeps its original, looser
 * evidence contract for backward compatibility.
 *
 * The same pass now STAMPS what it validated: one `EvidencePin` per agent
 * citation, built where `committedFile`'s blob is already in hand (zero new
 * git calls), and one `TokenMiss` per citation whose blob does not contain the
 * claim's token (`tokens`, claim id → the literal the claim asserts). Runner
 * and contract answers get no pins — their evidence names a report entry, not
 * a file — and the legacy all-at-once form never calls this validator, so it
 * stamps nothing.
 */
export async function validateServiceEvidence(
  answers: Answer[],
  binding: AttestationBinding,
  reports: ConsumedReports,
  tokens: ReadonlyMap<string, string>,
): Promise<ServiceEvidenceCheck> {
  const { repoDir, commit } = binding;
  const err = (message: string): ServiceEvidenceCheck => ({ ok: false, message });
  const pins = new Map<string, EvidencePin[]>();
  const tokenMisses: TokenMiss[] = [];
  for (const report of [reports.results, reports.contract]) {
    if (report === undefined) continue;
    // Most reports are build output and untracked, and `git diff` is quiet on
    // those — nothing here invents a rule for them. One the repository DOES
    // carry has to match the commit being attested, like any other file the
    // evidence rests on. Both reports independently: each is its own file
    // making its own claim about this commit.
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
      return err(
        clean.code === 1
          ? `The test report '${report.path}' is committed to this repository and differs from ${commit.slice(0, 12)} — commit it or attest the commit it belongs to.`
          : `Cannot tell whether the test report '${report.path}' is bound to ${commit.slice(0, 12)} — git could not be run to completion: ${clean.stderr || "git diff failed"}`,
      );
    }
  }
  for (const answer of answers) {
    if (answer.verdict !== "confirmed") continue;
    if (answer.answered_by === "runner" || answer.answered_by === "external-runner") {
      // A runner's evidence is an entry inside its report, not a file:line in
      // the source — there is nothing to resolve. What must hold is that it
      // names THAT report: an answer pointing anywhere else is not this run's.
      const report = answer.answered_by === "runner" ? reports.results : reports.contract;
      const stray = answer.evidence.filter((e) => report === undefined || !e.startsWith(`${report.path}: `));
      if (stray.length > 0) {
        return err(`Claim ${answer.id} has runner evidence ${stray.map((e) => `'${e}'`).join(", ")} that does not name the report loam read.`);
      }
      continue;
    }
    for (const evidence of answer.evidence) {
      const match = /^(.+):([1-9]\d*)$/.exec(evidence);
      if (match === null) {
        return err(`Claim ${answer.id} has evidence '${evidence}' — service evidence must be a canonical relative file:line.`);
      }
      const relativePath = match[1]!;
      const line = Number(match[2]);
      let absolutePath: string;
      try {
        absolutePath = resolvePortableFileInside(repoDir, relativePath, `evidence for ${answer.id}`);
      } catch (cause) {
        return err(`Claim ${answer.id} has unsafe evidence '${evidence}': ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      try {
        const info = await stat(absolutePath);
        if (!info.isFile()) {
          return err(`Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' is not a regular file.`);
        }
        const source = await readFile(absolutePath, "utf8");
        const lines = sourceLines(source).length;
        if (line > lines) {
          return err(`Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' has only ${lines} line(s).`);
        }
        const committed = await committedFile(repoDir, commit, relativePath);
        if (!committed.ok) {
          return err(`Claim ${answer.id} has evidence '${evidence}' that is not bound to ${commit.slice(0, 12)}: ${committed.message}`);
        }
        // The pin, built from the blob just fetched. `citedLine` is undefined
        // exactly when the line is past the committed file's end — the refusal
        // this validator already owed — so the bounds check and the pinned
        // text can never disagree about where lines fall.
        const text = citedLine(committed.source, line);
        if (text === undefined) {
          const committedLines = sourceLines(committed.source).length;
          return err(`Claim ${answer.id} has evidence '${evidence}', but '${relativePath}' has only ${committedLines} line(s) at ${commit.slice(0, 12)}.`);
        }
        // The token scan happens here, per citation, because the blob is in
        // hand and record time is when the answerer can still re-read what
        // they cited. Substring, never a parse: the claim asserts a literal.
        // A blob that does NOT contain the token is warned once (the notice
        // built from `tokenMisses`) and the pin then omits the token — see
        // EvidencePin.token for why re-litigating a never-there token at
        // every later validate would be a false sentence with no repair.
        const token = tokens.get(answer.id);
        const held = token !== undefined && committed.source.includes(token);
        if (token !== undefined && !held) tokenMisses.push({ id: answer.id, evidence, token });
        const list = pins.get(answer.id) ?? [];
        list.push({
          path: relativePath,
          line,
          file_sha256: pinnedDigest(committed.source),
          text,
          ...(held && token !== undefined ? { token } : {}),
        });
        pins.set(answer.id, list);
      } catch (cause) {
        return err(`Claim ${answer.id} has unreadable evidence '${evidence}': ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }
  return { ok: true, pins, tokenMisses };
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
