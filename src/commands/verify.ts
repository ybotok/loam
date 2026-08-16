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
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../core/envelope/config.js";
import { emitJson, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/envelope/json.js";
import { resolvePortableFileInside } from "../core/kernel/path-safety.js";
import { today } from "../core/provenance/stamp.js";
import { missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";
import { contestedDigests, readCucumberReport, runnerAnswers, type ReportScenario } from "../core/results.js";
import { checkAnswers, type Answer, type AnsweredBy } from "../core/verify/answers.js";
import { buildFederatedVerification, buildVerification, type DiscardedAnswer } from "../core/verify/build.js";
import { featureChecklist, type Checklist, type Claim } from "../core/verify/checklist.js";
import { readVerificationState, writeVerification } from "../core/verify/file.js";
import { attestedNotice, tallyAnswers, tallyRecord, type AnsweredClaim, type ConsumedReport, type Verification, type VerifyNotice, verificationPath, verificationVerdict } from "../core/verify/record.js";
import { plural } from "./policy/format.js";

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
      const recording = opts.record !== undefined || opts.results !== undefined;

      // WRITING is bound to the repository; READING is not. An attestation
      // pins claims to this repo's git HEAD and to file:line evidence inside
      // it, so `--record --service X` may only run where loam.json says this
      // repo IS X — vouch's and gherkin's refusal, for vouch's reason: from
      // anywhere else, that repository is somebody else's. Reading takes
      // `--service` as a pure lens (which claims are checkout-web's, and what
      // has it said?) and needs no binding at all, because it writes nothing.
      if (recording && opts.service !== undefined) {
        if (config.service === undefined) {
          return fail(
            json,
            "repository-unavailable",
            `Cannot attest for '${opts.service}' from here: this is not a service repo — loam.json declares no \`service\`. ` +
              `A federated attestation binds the answers to this repository's git HEAD and to evidence inside it, so the repository has to say which service it is. ` +
              `Add "service": "${opts.service}" to loam.json, or record it from that service's own repo.`,
          );
        }
        if (config.service !== opts.service) {
          return fail(
            json,
            "service-mismatch",
            `This repository is configured as service '${config.service}', so it cannot attest claims for '${opts.service}'.`,
          );
        }
      }

      // Archived features resolve too: a shipped feature's verification is worth
      // reading back, and it travelled into the archive with everything else.
      const feature = await resolveFeature(docsDir, featureId, "include");
      if (!feature) {
        // repo.ts's sentence, not a second copy of it. Resolving with "include"
        // means the archived branch inside it cannot fire here — an archived
        // feature resolves — so the text is exactly what it was; what changes is
        // that a reworded miss message can no longer leave this one behind.
        return fail(json, "unknown-target", await missingFeatureMessage(docsDir, featureId));
      }

      // Before anything else: a verification.yaml that exists but will not read
      // is a refusal, not an absence. It holds somebody's answers and — in a
      // fleet — other repositories' attestations; treating it as "not verified"
      // let the next --record silently overwrite all of it, and made the read
      // view say "no record" about a file sitting right there.
      const existing = await readVerificationState(feature.dir);
      if (existing.state === "unreadable") {
        return fail(
          json,
          "record-unreadable",
          `${repoPath(docsDir, verificationPath(feature.dir))} exists but cannot be read as a verification record: ${existing.reason}. ` +
            (existing.code === "verify.record-miscounted"
              ? "Record the answers again rather than editing the counts: a summary made to agree by hand still says nothing about what was checked."
              : "It is plain YAML — repair it by hand, or delete it and record again. loam will not overwrite a record it could not read."),
        );
      }
      const recorded = existing.state === "ok" ? existing.verification : null;

      // But an archived feature never gets a re-derived checklist — see the
      // header. Its record is frozen history, and --record / --results refuse
      // alike: the code is `invalid-option` rather than `answers-mismatch`
      // because the answers were never compared to anything — there is no
      // current checklist to answer, so the wrong thing here is the option,
      // not the answer set.
      if (feature.archived) {
        if (recording) {
          return fail(
            json,
            "invalid-option",
            `${feature.id} is archived — its verification is history now. \`loam unarchive ${feature.id}\` first if the answers really need to change.`,
          );
        }
        reportFrozen(docsDir, feature.dir, feature.id, recorded, json);
        return;
      }

      const checklist = await featureChecklist(docsDir, feature.dir, feature.id);

      if (recording) {
        // Standing in a service repo, `--service` is what the repo already
        // says: omitting it must not fall back to the legacy all-at-once form,
        // which claims the whole fleet's checklist on this one repo's word.
        //
        // The repo root, not the cwd — `vouch`'s and `gherkin`'s reason. An
        // attestation names a commit and rests on evidence resolved inside
        // "this repository", and `config.root` is the directory loam.json was
        // actually found in. Off `process.cwd()`, running from a subdirectory
        // silently changed all three: evidence resolved against the
        // subdirectory, `--results` had to live in it, and `git rev-parse` ran
        // there — a submodule or nested checkout under it would have named
        // somebody else's commit on this repository's attestation.
        await record(
          docsDir,
          feature.dir,
          checklist,
          opts.service ?? config.service,
          config.root ?? process.cwd(),
          recorded,
          opts,
          json,
        );
        return;
      }

      report(docsDir, feature.dir, checklist, recorded, json, {
        lens: opts.service,
        bound: config.service,
      });
    });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function statuses(checklist: Checklist, claims: Checklist["claims"], recorded: Verification | null): ClaimStatus[] {
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
  return claims.map((c) => {
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

/**
 * The read view.
 *
 * `lens` is `--service`: the same checklist, narrowed to the claims that
 * service's code answers. It exists because in a ten-repo fleet the whole
 * checklist is never one repository's business, and an agent that cannot ask
 * "what do I still owe on FEAT-1?" answers the question by guessing. Narrowing
 * narrows the verdict too — `verified` then means "every claim owned by this
 * service is confirmed", which is why the payload names the service it applied.
 *
 * `bound` is loam.json's `service` — what this repository says it is. It only
 * shapes the footer, and it is the whole of how federation is discoverable:
 * the recording form printed here is the one that will actually work from here.
 */
function report(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  recorded: Verification | null,
  json: boolean,
  scope: { lens?: string; bound?: string } = {},
): void {
  const lens = scope.lens;
  const owners = [...new Set(checklist.claims.map((c) => c.subject))].sort();
  const scoped = lens === undefined ? checklist.claims : checklist.claims.filter((c) => c.subject === lens);
  const claims = statuses(checklist, scoped, recorded);
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
  const tally = tallyAnswers(claims);
  const verdict = verificationVerdict(tally, stale);
  // `verified` keeps its name and its type, and loses its old meaning: a
  // scenario claim on an agent's word is answered, not run, so it no longer
  // reads the same as a green suite. `verdict` carries the distinction.
  const verified = verdict === "verified";
  // Contest is derivable from the checklist alone, so the read view says it
  // too: an agent looking at what it owes should learn that a second service
  // answers the same claim BEFORE it runs a suite whose report cannot be
  // attributed. Always from the whole checklist, never the lens — a shared
  // digest is a fact about the feature, and a narrowed view is the one place it
  // would otherwise be invisible.
  const notices = [...noticesFor(claims, checklist.feature), ...contestedNotices(checklist.claims)];

  if (json) {
    emitJson({
      feature: checklist.feature,
      path: repoPath(docsDir, featureDir),
      digest: checklist.digest,
      // Named only when narrowed, so a consumer can never mistake a service's
      // verdict for the feature's.
      ...(lens === undefined ? {} : { service: lens, checklistClaims: checklist.claims.length }),
      verified,
      verdict,
      attested: tally.attested,
      summary,
      services: owners,
      recorded:
        recorded === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: recorded.recorded,
              checklist: recorded.checklist,
              stale,
              ...(recorded.attestations === undefined ? {} : { attestations: recorded.attestations }),
              ...(recorded.report === undefined ? {} : { report: recorded.report }),
            },
      claims,
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  const scopeNote =
    lens === undefined ? "" : ` owned by ${lens} (of ${plural(checklist.claims.length, "claim")} on the checklist)`;
  console.log(
    `${checklist.feature} — ${plural(claims.length, "claim")}${scopeNote} derived from ${repoPath(docsDir, featureDir)}\n`,
  );
  if (claims.length === 0) {
    console.log(
      lens === undefined
        ? "  Nothing to check: this feature's delta, specs and openapi promise nothing yet."
        : `  No claim on this checklist is owned by '${lens}'.${owners.length > 0 ? ` The services that own claims here are ${owners.join(", ")}.` : ""}`,
    );
    return;
  }
  for (const c of claims) {
    console.log(`  ${MARK[c.verdict]} ${c.id}  [${c.subject}]  ${c.claim}${answeredMark(c)}`);
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
      if (attestation.report !== undefined) console.log(`      from ${reportLine(attestation.report)}`);
    }
    if (recorded.report !== undefined) console.log(`  Answered from ${reportLine(recorded.report)}.`);
  }
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
  // An attested record has answered every question — telling it to "answer each
  // claim" would send an agent round a loop it has already run. The notice
  // above names the one thing left, which is a test run.
  if (verdict === "unverified") {
    console.log("\n  Answer each claim, then record the answers:\n");
    console.log('    [{ "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/x.ts:42"] }]');
    console.log(`\n    loam verify ${checklist.feature} --record answers.json${recordSuffix(scope, owners)}`);
    for (const line of federationNote(scope, owners)) console.log(line);
    console.log("\n  A claim you cannot show evidence for is `unconfirmed` — say why in `note`.");
  }
}

/**
 * The `--service` the printed form should carry. It comes from loam.json, never
 * from the checklist: the only attestation this repository can make is its own,
 * and a hint naming a service that lives somewhere else is a hint that fails.
 */
function recordSuffix(scope: { lens?: string; bound?: string }, owners: string[]): string {
  if (scope.bound !== undefined) return ` --service ${scope.bound}`;
  return owners.length > 1 || scope.lens !== undefined ? " --service <svc>" : "";
}

/** Why the form above has a `--service` on it — the one place federation is taught. */
function federationNote(scope: { lens?: string; bound?: string }, owners: string[]): string[] {
  if (scope.bound !== undefined) {
    const others = owners.filter((s) => s !== scope.bound);
    return [
      "",
      `  This repository is ${scope.bound}, so it attests only ${scope.bound}'s claims, bound to its git HEAD.`,
      ...(others.length === 0
        ? []
        : [`  The claims owned by ${others.join(", ")} are recorded the same way from those repositories.`]),
    ];
  }
  if (owners.length > 1 || scope.lens !== undefined) {
    return [
      "",
      `  This checklist spans ${plural(owners.length, "service")} (${owners.join(", ")}) — each attests its own claims`,
      "  from its own repository, where loam.json names that service.",
    ];
  }
  return [];
}

/**
 * The frozen view: an archived feature's record, verbatim. No checklist is
 * derived and no staleness is judged — there is nothing current to judge
 * against, and pretending otherwise is how a true record reads as a lie.
 * `frozen` is the marker a consumer branches on.
 *
 * The verdict is recounted from `claims[]`, never taken from `summary`: this is
 * the post-ship verdict on a feature nobody can re-derive a checklist for, so a
 * record whose counts had drifted from its own answers reported a shipped
 * feature as fully confirmed. (A record that contradicts itself never reaches
 * here — `readVerificationState` refuses it — so the recount and the summary
 * agree; the recount is what says WHY.) No record at all is reported as exactly
 * that, with `summary: null`, not zero claims, which would falsely say the
 * feature promised nothing.
 */
function reportFrozen(
  docsDir: string,
  featureDir: string,
  featureId: string,
  v: Verification | null,
  json: boolean,
): void {
  const tally = v === null ? null : tallyRecord(v);
  const verdict = tally === null ? "unverified" : verificationVerdict(tally);
  const notices = v === null ? [] : noticesFor(v.claims, featureId);

  if (json) {
    emitJson({
      feature: featureId,
      path: repoPath(docsDir, featureDir),
      frozen: true,
      verified: verdict === "verified",
      verdict,
      attested: tally?.attested ?? 0,
      summary: v === null ? null : v.summary,
      recorded:
        v === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: v.recorded,
              checklist: v.checklist,
              ...(v.attestations === undefined ? {} : { attestations: v.attestations }),
              ...(v.report === undefined ? {} : { report: v.report }),
            },
      claims: v === null ? [] : v.claims,
      ...(notices.length === 0 ? {} : { notices }),
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
    // `subject` is absent in records written before schema 2 — an old record
    // must read as itself, not gain a service it never named.
    const subject = c.subject === undefined ? "" : `  [${c.subject}]`;
    console.log(`  ${MARK[c.verdict]} ${c.id}${subject}  ${c.claim}${answeredMark(c)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }
  const counts = tallyRecord(v);
  console.log(`\n  Recorded ${v.recorded} — ${counts.confirmed} confirmed, ${counts.unconfirmed} unconfirmed.`);
  console.log(
    "  This checklist is frozen at record time: the feature is archived and its claims are not re-derived.",
  );
  for (const attestation of v.attestations ?? []) {
    console.log(
      `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}).`,
    );
    if (attestation.report !== undefined) console.log(`      from ${reportLine(attestation.report)}`);
  }
  if (v.report !== undefined) console.log(`  Answered from ${reportLine(v.report)}.`);
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
}

const MARK: Record<string, string> = { confirmed: "✓", unconfirmed: "✗", unanswered: "?" };

/**
 * Who answered, where that changes what the verdict means. `[runner]` is a
 * digest-matched green run; `[attested]` is a scenario claim confirmed on
 * somebody's word — the same ✓, a weaker fact, and it must be visible on the
 * line itself and not only in the summary. Everything else is unmarked: an
 * agent's answer about a service existing or an operation being exposed is
 * exactly what the checklist asks for.
 */
function answeredMark(c: AnsweredClaim): string {
  if (c.answered_by === "runner") return "  [runner]";
  return c.kind === "scenario.tested" && c.verdict === "confirmed" ? "  [attested]" : "";
}

/** Everything a verify surface has to say about a set of answers beyond the counts. */
function noticesFor(claims: readonly AnsweredClaim[], feature: string): VerifyNotice[] {
  const attested = attestedNotice(claims, feature);
  return attested === null ? [] : [attested];
}

/**
 * The claims one report could not attribute: a scenario digest — and therefore
 * an `@loam-digest-…` tag — that more than one service claims.
 *
 * This is now a GUARD rather than a diagnosis of ordinary authoring. Until the
 * digest was salted by service, two services wording a scenario identically
 * really did share one tag, and this is what stopped one repository's green run
 * from confirming the other's claim. `scenarioBodyHash` folds the owning
 * service into the hash, so a claim's digest is computed from the same service
 * the claim is filed under and two subjects cannot share one short of a
 * truncated-sha256 collision. It stays because the invariant is worth asserting
 * where it is relied on: if this ever fires, a digest is answering for two
 * services and no report can say which, so nothing here may confirm.
 *
 * Derived from claims rather than from a report, so the read view raises it too
 * — the collision exists the moment the checklist does, and learning about it
 * from a `--results` run that already happened is learning too late.
 */
function contestedNotices(claims: readonly Claim[]): VerifyNotice[] {
  const contested = contestedDigests(claims);
  if (contested.size === 0) return [];
  const shared = [...contested].map(([digest, services]) => `${digest} (${services.join(", ")})`);
  return [
    {
      code: "verify.digest-contested",
      severity: "warn",
      message:
        `${plural(contested.size, "scenario digest")} claimed by more than one service: ${shared.join("; ")}. ` +
        "The digest is salted by service, so this is a hash collision, not shared wording — but one report still " +
        "cannot say whose suite ran them, so a shared --results run leaves them unconfirmed. " +
        "Record each service's claims from its own repository with --service.",
      claims: claims.filter((c) => c.digest !== undefined && contested.has(c.digest)).map((c) => c.id),
    },
  ];
}

/** The report a `--results` run consumed, as one line a reviewer can check by hand. */
function reportLine(r: ConsumedReport): string {
  return `${r.path} (sha256 ${r.digest.slice(0, 12)}…, ${plural(r.scenarios, "tagged scenario")}, written ${r.mtime})`;
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

/**
 * `repoDir` is the repository an attestation is ABOUT: the commit it names, the
 * tree its evidence must resolve inside, and where a `--results` report has to
 * live. It is threaded rather than read here because it comes from
 * `config.root`, and a `process.cwd()` in this function was the whole bug —
 * from a subdirectory, "this repo" quietly became that subdirectory.
 */
async function record(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  service: string | undefined,
  repoDir: string,
  previous: Verification | null,
  opts: VerifyOptions,
  json: boolean,
): Promise<void> {
  // The legacy all-at-once form answers the WHOLE checklist on one repository's
  // word and writes a schema-1 record — no attestations, no commits. Run over a
  // federated record it does not merge and it does not migrate: it erases every
  // other service's commit-bound attestation, and the erasure is invisible
  // afterwards because what replaces it is a well-formed, plausible record. So
  // it refuses, and names the repositories whose word is on the file.
  const attested = previous?.schema === 2 ? (previous.attestations ?? []) : [];
  if (service === undefined && attested.length > 0) {
    const services = [...new Set(attested.map((a) => a.service))].sort();
    return fail(
      json,
      "record-federated",
      `${repoPath(docsDir, verificationPath(featureDir))} is a federated record: ${plural(services.length, "service")} (${services.join(", ")}) have attested claims against their own git commits. ` +
        "Recording without --service would replace all of it with one unattested answer set. " +
        `Record this service's claims from its own repo instead: \`loam verify ${checklist.feature} --record answers.json --service <svc>\`.`,
    );
  }

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
  let consumed: ConsumedReport | undefined;
  if (opts.results !== undefined) {
    // A federated record attests for THIS repository, so its report has to be a
    // file inside it — see readResults.
    const read = await readResults(opts.results, service === undefined ? undefined : repoDir);
    if (!read.ok) return fail(json, read.code, read.message);
    consumed = read.report;
    fromRunner = runnerAnswers(runnerClaims, read.scenarios, consumed.path);
  }

  // The agent's half — exactly what the runner does not own. --results alone
  // is legal only when the runner owns the whole checklist: anything left over
  // refuses with the ids, the same discipline as a claim with no answer.
  let raw: unknown = [];
  if (opts.record !== undefined) {
    try {
      // The one path that stays cwd-relative, and deliberately: the answer set
      // is a file the caller just wrote and hands to the command, not part of
      // the repository being attested. Nothing on the record points at it.
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
    { feature: checklist.feature, ...(service === undefined ? {} : { service }) },
  );
  if (!checked.ok) return fail(json, checked.code, checked.message);

  let serviceCommit: string | undefined;
  if (service !== undefined) {
    const commit = await repositoryCommit(repoDir);
    if (!commit.ok) return fail(json, "repository-unavailable", commit.message);
    serviceCommit = commit.commit;
    // Both halves, one validator. The runner's evidence used to skip it
    // entirely: `--results` minted confirmations whose evidence strings nothing
    // ever checked, in the one mode that promises every answer is bound to this
    // repository at this commit.
    const evidenceFailure = await validateServiceEvidence(
      [...fromRunner, ...checked.answers],
      repoDir,
      serviceCommit,
      consumed,
    );
    if (evidenceFailure !== null) return fail(json, "answers-unevidenced", evidenceFailure);
  }

  const recorded = today(new Date());
  let verification: Verification;
  let discarded: DiscardedAnswer[] = [];
  if (service === undefined) {
    verification = buildVerification(checklist, [...fromRunner, ...checked.answers], recorded, consumed);
  } else {
    const built = buildFederatedVerification(
      checklist,
      service,
      [...fromRunner, ...checked.answers],
      previous,
      recorded,
      serviceCommit!,
      consumed,
    );
    verification = built.verification;
    discarded = built.discarded;
  }
  const path = await writeVerification(featureDir, verification);
  const unconfirmed = verification.claims.filter((c) => c.verdict === "unconfirmed");

  // The same judgment read mode makes (see report): the record just written IS
  // the current checklist's answer, so `stale` is false by construction and the
  // remaining question is whether every claim was confirmed — and, now, by
  // whom. Counted from the claims, not from the summary this same call wrote.
  // Without these fields an agent that recorded all-confirmed answers would
  // have to re-run verify just to learn the state it created.
  const tally = tallyRecord(verification);
  const verdict = verificationVerdict(tally);
  const verified = verdict === "verified";
  const notices = [...noticesFor(verification.claims, verification.feature), ...contestedNotices(runnerClaims)];

  if (json) {
    emitJson({
      feature: verification.feature,
      path: repoPath(docsDir, path),
      digest: verification.checklist,
      verified,
      verdict,
      attested: tally.attested,
      recorded: verification.recorded,
      summary: verification.summary,
      ...(verification.attestations === undefined ? {} : { attestations: verification.attestations }),
      ...(consumed === undefined ? {} : { report: consumed }),
      unconfirmed: unconfirmed.map((c) => ({ id: c.id, claim: c.claim, ...(c.note === undefined ? {} : { note: c.note }) })),
      ...(discarded.length === 0 ? {} : { discarded }),
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  console.log(`${verification.feature} verification recorded — ${repoPath(docsDir, path)}\n`);
  console.log(`  ${tally.confirmed} of ${plural(tally.claims, "claim")} confirmed with evidence.`);
  if (consumed !== undefined) {
    console.log(
      `  ${plural(fromRunner.length, "scenario claim")} answered by the test runner (${opts.results})` +
        `${opts.record === undefined ? "" : `, ${checked.answers.length} by ${opts.record}`}.`,
    );
    console.log(`  Report read: ${reportLine(consumed)}.`);
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

  // What the previous record answered and this one does not. A federated write
  // is a partial write, so the first one over an all-at-once record drops every
  // answer it cannot attribute to a commit — correct, but silence here reads as
  // loam having lost the answers, and nobody goes looking for what to re-record.
  if (discarded.length > 0) {
    const off = discarded.filter((d) => d.reason === "off-checklist").length;
    console.log(
      `\n  ${plural(discarded.length, "earlier answer")} from ${repoPath(docsDir, verificationPath(featureDir))} ${discarded.length === 1 ? "is" : "are"} not carried into this record:`,
    );
    for (const d of discarded) {
      console.log(
        `    - ${d.id}${d.subject === undefined ? "" : ` [${d.subject}]`}  ${d.claim}` +
          (d.reason === "off-checklist"
            ? "  (the feature changed; nothing asks this any more)"
            : "  (no commit attestation binds it — its service must record it again)"),
      );
    }
    if (discarded.length > off) {
      console.log(
        `    Each owning service records its own with \`loam verify ${verification.feature} --record answers.json --service <svc>\` in its repo.`,
      );
    }
  }
  console.log("");
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
  console.log(
    tally.unanswered > 0
      ? `  Partial federation — ${plural(tally.unanswered, "claim")} remain unanswered for their owning service repositories.`
      : verdict === "attested"
        ? "  Recorded as attested, not verified: the record travels into features/archive/ saying so."
        : unconfirmed.length === 0
          ? "  The record travels with the feature into features/archive/."
          : "  Recorded as it stands. Nothing gates on this — it is what a reviewer reads later, so leave it true.",
  );
}

type ResultsRead =
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
async function readResults(spelled: string, repoDir: string | undefined): Promise<ResultsRead> {
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
async function validateServiceEvidence(
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
  /**
   * Git's own exit status, or `-1` for "git could not be run to completion" —
   * no git on PATH, a spawn failure, or a child killed by a signal. Callers
   * read specific meaning into small numbers (`1` from `git diff --quiet` is
   * "that file differs"), so a run that never reached an exit status must not
   * borrow one of them.
   */
  code: number;
  stdout: string;
  stderr: string;
}

function git(repoDir: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile("git", ["-C", repoDir, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
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
        // cause at all.
        stderr: stderr.trim() || (error === null ? "" : error.message),
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
