/**
 * `loam verify <FEAT>` — the done-check.
 *
 * Two modes, one subject. Without `--record`/`--results` it derives the
 * checklist from the feature's own artifacts and reports it, together with
 * whatever has already been answered. With answers it records them, refusing
 * everything that does not correspond to the current checklist — and the
 * answers come from two places that never overlap: `--results
 * <cucumber-report.json>` answers every `scenario.tested` claim mechanically
 * (digest-matched against the report's `@loam-digest-…` tags — only a green
 * run confirms one), `--record <answers.json>` takes an agent's answers for
 * exactly the rest. Either alone is legal only when it covers the whole
 * checklist; the complete-record invariant survives the split.
 *
 * An ARCHIVED feature is the one place the checklist is NOT derived. Archive
 * merged the feature's operations into the living openapi, so re-deriving here
 * computes a smaller claim set, the digest mismatches, and a faithful record
 * reads "stale" forever with an untrue diagnosis — archive changed the
 * environment, not the feature. So verify renders verification.yaml verbatim as
 * frozen history, and `--record` refuses: it would answer a checklist nobody
 * can re-derive.
 *
 * It reports; it does not gate. Archive refuses an incoherent feature because
 * loam COMPUTED the incoherence from the documents in front of it. A verdict
 * here is somebody's word about code loam never read, and making it the last
 * obstacle before shipping is how a checklist turns into a formality — the
 * cheapest way past a gate is always to say yes.
 */
import type { Command } from "commander";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import { resolvePortableFileInside } from "../core/path-safety.js";
import { featuresDir, resolveFeature } from "../core/repo.js";
import { readCucumberReport, runnerAnswers } from "../core/results.js";
import {
  buildVerification,
  buildFederatedVerification,
  checkAnswers,
  featureChecklist,
  readVerification,
  verificationPath,
  writeVerification,
  type Answer,
  type AnsweredBy,
  type Checklist,
  type Verification,
} from "../core/verify.js";

interface VerifyOptions {
  record?: string;
  results?: string;
  service?: string;
  json?: boolean;
}

/** A claim plus what has been said about it. `unanswered` is the honest default. */
interface ClaimStatus {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: "confirmed" | "unconfirmed" | "unanswered";
  answered_by?: AnsweredBy;
  evidence: string[];
  note?: string;
}

export function registerVerify(program: Command): void {
  program
    .command("verify")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Check a shipped feature against its own promises: derive the claims, record the answers")
    .option("--record <file>", "record a JSON answer set against the current checklist")
    .option(
      "--results <file>",
      "answer the scenario.tested claims mechanically from a cucumber JSON test report",
    )
    .option(
      "--service <id>",
      "record only this service's claims, bound to the current repository commit",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: VerifyOptions) => {
      const json = opts.json === true;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      if (opts.service !== undefined && config.service !== undefined && config.service !== opts.service) {
        return fail(
          json,
          "service-mismatch",
          `This repository is configured as service '${config.service}', so it cannot attest claims for '${opts.service}'.`,
        );
      }

      // Archived features resolve too: a shipped feature's verification is worth
      // reading back, and it travelled into the archive with everything else.
      const feature = await resolveFeature(docsDir, featureId, "include");
      if (!feature) {
        return fail(json, "unknown-target", `No feature '${featureId}' under ${featuresDir(docsDir)}.`);
      }

      // But an archived feature never gets a re-derived checklist — see the
      // header. Its record is frozen history, and --record / --results refuse
      // alike: the code is `invalid-option` rather than `answers-mismatch`
      // because the answers were never compared to anything — there is no
      // current checklist to answer, so the wrong thing here is the option,
      // not the answer set.
      if (feature.archived) {
        if (opts.record !== undefined || opts.results !== undefined) {
          return fail(
            json,
            "invalid-option",
            `${feature.id} is archived — its verification is history now. \`loam unarchive ${feature.id}\` first if the answers really need to change.`,
          );
        }
        reportFrozen(docsDir, feature.dir, feature.id, await readVerification(feature.dir), json);
        return;
      }

      const checklist = await featureChecklist(docsDir, feature.dir, feature.id);

      if (opts.record !== undefined || opts.results !== undefined) {
        await record(docsDir, feature.dir, checklist, opts, json);
        return;
      }

      report(docsDir, feature.dir, checklist, await readVerification(feature.dir), json);
    });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function statuses(checklist: Checklist, recorded: Verification | null): ClaimStatus[] {
  const subjects = new Map(checklist.claims.map((claim) => [claim.id, claim.subject]));
  const attested =
    recorded?.schema !== 2
      ? null
      : new Set(
          (recorded.attestations ?? []).flatMap((attestation) =>
            attestation.claims.filter((id) => subjects.get(id) === attestation.service),
          ),
        );
  const byId = new Map(
    (recorded?.claims ?? [])
      .filter((claim) => attested === null || attested.has(claim.id))
      .map((claim) => [claim.id, claim]),
  );
  return checklist.claims.map((c) => {
    const answer = byId.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      subject: c.subject,
      claim: c.claim,
      verdict: answer?.verdict ?? "unanswered",
      ...(answer?.answered_by === undefined ? {} : { answered_by: answer.answered_by }),
      evidence: answer?.evidence ?? [],
      ...(answer?.note === undefined ? {} : { note: answer.note }),
    };
  });
}

function report(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  recorded: Verification | null,
  json: boolean,
): void {
  const claims = statuses(checklist, recorded);
  const count = (v: string): number => claims.filter((c) => c.verdict === v).length;
  const summary = {
    claims: claims.length,
    confirmed: count("confirmed"),
    unconfirmed: count("unconfirmed"),
    unanswered: count("unanswered"),
  };
  // A record that answers a different question set is not an answer to this one,
  // however complete it looks — so staleness disqualifies it as a whole.
  const stale = recorded !== null && recorded.checklist !== checklist.digest;
  const verified = recorded !== null && !stale && claims.length > 0 && summary.confirmed === claims.length;

  if (json) {
    emitJson({
      feature: checklist.feature,
      path: repoPath(docsDir, featureDir),
      digest: checklist.digest,
      verified,
      summary,
      recorded:
        recorded === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: recorded.recorded,
              checklist: recorded.checklist,
              stale,
              ...(recorded.attestations === undefined ? {} : { attestations: recorded.attestations }),
            },
      claims,
    });
    return;
  }

  console.log(`${checklist.feature} — ${plural(claims.length, "claim")} derived from ${repoPath(docsDir, featureDir)}\n`);
  if (claims.length === 0) {
    console.log("  Nothing to check: this feature's delta, specs and openapi promise nothing yet.");
    return;
  }
  for (const c of claims) {
    console.log(`  ${MARK[c.verdict]} ${c.id}  ${c.claim}${byRunner(c.answered_by)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }

  console.log("");
  if (recorded === null) {
    console.log(`  Not verified — no ${repoPath(docsDir, verificationPath(featureDir))}.`);
  } else {
    console.log(
      `  Recorded ${recorded.recorded} — ${summary.confirmed} confirmed, ${summary.unconfirmed} unconfirmed, ${summary.unanswered} unanswered.`,
    );
    if (stale) {
      console.log("  STALE: the feature changed after this was recorded. Answer the claims above again.");
    }
    for (const attestation of recorded.attestations ?? []) {
      console.log(
        `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}, ${plural(attestation.claims.length, "claim")}).`,
      );
    }
  }
  if (!verified) {
    console.log("\n  Answer each claim, then record the answers:\n");
    console.log('    [{ "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/x.ts:42"] }]');
    console.log(`\n    loam verify ${checklist.feature} --record answers.json`);
    console.log("\n  A claim you cannot show evidence for is `unconfirmed` — say why in `note`.");
  }
}

/**
 * The frozen view: an archived feature's record, verbatim. No checklist is
 * derived and no staleness is judged — there is nothing current to judge
 * against, and pretending otherwise is how a true record reads as a lie.
 * `frozen` is the marker a consumer branches on; `verified` comes from the
 * record's own summary, because the record is all there is. No record at all is
 * reported as exactly that — with `summary: null`, not zero claims, which would
 * falsely say the feature promised nothing.
 */
function reportFrozen(
  docsDir: string,
  featureDir: string,
  featureId: string,
  v: Verification | null,
  json: boolean,
): void {
  if (json) {
    emitJson({
      feature: featureId,
      path: repoPath(docsDir, featureDir),
      frozen: true,
      verified: v !== null && v.summary.claims > 0 && v.summary.confirmed === v.summary.claims,
      summary: v === null ? null : v.summary,
      recorded:
        v === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: v.recorded,
              checklist: v.checklist,
              ...(v.attestations === undefined ? {} : { attestations: v.attestations }),
            },
      claims: v === null ? [] : v.claims,
    });
    return;
  }

  if (v === null) {
    console.log(
      `${featureId} is archived and has no verification record — nothing was recorded before it shipped.`,
    );
    return;
  }

  console.log(
    `${featureId} — verification recorded ${v.recorded}, frozen at archive (${repoPath(docsDir, featureDir)})\n`,
  );
  for (const c of v.claims) {
    console.log(`  ${MARK[c.verdict]} ${c.id}  ${c.claim}${byRunner(c.answered_by)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }
  console.log(
    `\n  Recorded ${v.recorded} — ${v.summary.confirmed} confirmed, ${v.summary.unconfirmed} unconfirmed.`,
  );
  console.log(
    "  This checklist is frozen at record time: the feature is archived and its claims are not re-derived.",
  );
  for (const attestation of v.attestations ?? []) {
    console.log(
      `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}).`,
    );
  }
}

const MARK: Record<string, string> = { confirmed: "✓", unconfirmed: "✗", unanswered: "?" };

/** The runner's verdicts are marked in prose; the agent's are the unmarked default. */
function byRunner(who: AnsweredBy | undefined): string {
  return who === "runner" ? "  [runner]" : "";
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

async function record(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  opts: VerifyOptions,
  json: boolean,
): Promise<void> {
  const service = opts.service;
  const scopedClaims =
    service === undefined ? checklist.claims : checklist.claims.filter((claim) => claim.subject === service);
  if (service !== undefined && scopedClaims.length === 0) {
    return fail(
      json,
      "unknown-service",
      `The current ${checklist.feature} checklist has no claims owned by service '${service}'.`,
    );
  }

  // The runner's half: with --results, every scenario.tested claim is the
  // report's to answer — matched by digest, confirmed only by a green run.
  const runnerClaims =
    opts.results === undefined ? [] : scopedClaims.filter((c) => c.kind === "scenario.tested");
  const agentClaims =
    opts.results === undefined ? scopedClaims : scopedClaims.filter((c) => c.kind !== "scenario.tested");

  let fromRunner: Answer[] = [];
  if (opts.results !== undefined) {
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(resolve(process.cwd(), opts.results), "utf8"));
    } catch (err) {
      return fail(
        json,
        "answers-unreadable",
        `Cannot read ${opts.results} as a cucumber JSON report: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const report = readCucumberReport(doc, opts.results);
    if (!report.ok) return fail(json, "answers-unreadable", report.message);
    fromRunner = runnerAnswers(runnerClaims, report.scenarios, opts.results);
  }

  // The agent's half — exactly what the runner does not own. --results alone
  // is legal only when the runner owns the whole checklist: anything left over
  // refuses with the ids, the same discipline as a claim with no answer.
  let raw: unknown = [];
  if (opts.record !== undefined) {
    try {
      raw = JSON.parse(await readFile(resolve(process.cwd(), opts.record), "utf8"));
    } catch (err) {
      return fail(
        json,
        "answers-unreadable",
        `Cannot read ${opts.record}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (agentClaims.length > 0 && opts.results !== undefined) {
    return fail(
      json,
      "answers-mismatch",
      `--results answers only the scenario.tested claims; ${agentClaims.length} claim(s) have no answer: ` +
        `${agentClaims.map((c) => c.id).join(", ")}. Record them with --record <answers.json> alongside --results.`,
    );
  }

  const checked = checkAnswers(
    agentClaims,
    raw,
    opts.results === undefined ? undefined : new Set(runnerClaims.map((c) => c.id)),
  );
  if (!checked.ok) return fail(json, checked.code, checked.message);

  let serviceCommit: string | undefined;
  if (service !== undefined) {
    const commit = await repositoryCommit(process.cwd());
    if (!commit.ok) return fail(json, "repository-unavailable", commit.message);
    serviceCommit = commit.commit;
    const evidenceFailure = await validateServiceEvidence(checked.answers, process.cwd(), serviceCommit);
    if (evidenceFailure !== null) return fail(json, "answers-unevidenced", evidenceFailure);
  }

  const recorded = today(new Date());
  let verification: Verification;
  if (service === undefined) {
    verification = buildVerification(checklist, [...fromRunner, ...checked.answers], recorded);
  } else {
    verification = buildFederatedVerification(
      checklist,
      service,
      [...fromRunner, ...checked.answers],
      await readVerification(featureDir),
      recorded,
      serviceCommit!,
    );
  }
  const path = await writeVerification(featureDir, verification);
  const unconfirmed = verification.claims.filter((c) => c.verdict === "unconfirmed");

  // The same judgment read mode makes (see report): the record just written IS
  // the current checklist's answer, so `stale` is false by construction and the
  // remaining question is whether every claim was confirmed. Without this field
  // an agent that recorded all-confirmed answers would have to re-run verify
  // just to learn the state it created.
  const verified =
    verification.summary.claims > 0 && verification.summary.confirmed === verification.summary.claims;

  if (json) {
    emitJson({
      feature: verification.feature,
      path: repoPath(docsDir, path),
      digest: verification.checklist,
      verified,
      recorded: verification.recorded,
      summary: verification.summary,
      ...(verification.attestations === undefined ? {} : { attestations: verification.attestations }),
      unconfirmed: unconfirmed.map((c) => ({ id: c.id, claim: c.claim, ...(c.note === undefined ? {} : { note: c.note }) })),
    });
    return;
  }

  console.log(`${verification.feature} verification recorded — ${repoPath(docsDir, path)}\n`);
  console.log(
    `  ${verification.summary.confirmed} of ${plural(verification.summary.claims, "claim")} confirmed with evidence.`,
  );
  if (opts.results !== undefined) {
    console.log(
      `  ${plural(fromRunner.length, "scenario claim")} answered by the test runner (${opts.results})` +
        `${opts.record === undefined ? "" : `, ${checked.answers.length} by ${opts.record}`}.`,
    );
  }
  if (service !== undefined) {
    const attestation = verification.attestations?.find((item) => item.service === service);
    if (attestation !== undefined) {
      console.log(`  ${service} attested at git commit ${attestation.commit}.`);
    }
  }
  for (const c of unconfirmed) {
    console.log(`  ✗ ${c.claim}${c.note === undefined ? "" : ` — ${c.note}`}`);
  }
  const unanswered = verification.summary.unanswered ?? 0;
  console.log(
    unanswered > 0
      ? `\n  Partial federation — ${plural(unanswered, "claim")} remain unanswered for their owning service repositories.`
      : unconfirmed.length === 0
        ? "\n  The record travels with the feature into features/archive/."
        : "\n  Recorded as it stands. Nothing gates on this — it is what a reviewer reads later, so leave it true.",
  );
}

/**
 * In federated mode, a confirmation is accepted only when every evidence item
 * resolves to a real line in this repository. Legacy global mode deliberately
 * keeps its original, looser evidence contract for backward compatibility.
 */
async function validateServiceEvidence(
  answers: Answer[],
  repoDir: string,
  commit: string,
): Promise<string | null> {
  for (const answer of answers) {
    if (answer.verdict !== "confirmed") continue;
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
async function committedFile(repoDir: string, commit: string, path: string): Promise<CommittedFileResult> {
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
  code: number;
  stdout: string;
  stderr: string;
}

function git(repoDir: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile("git", ["-C", repoDir, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      done({
        code: error === null ? 0 : ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1),
        stdout,
        stderr: stderr.trim(),
      });
    });
  });
}

/** Resolve HEAD without a shell, so repository paths remain data, never code. */
async function repositoryCommit(repoDir: string): Promise<CommitResult> {
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

/**
 * The local calendar day, like `vouch`: a record is somebody saying "today I
 * looked", and `toISOString` files an evening in the Americas under tomorrow.
 */
function today(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}


function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
