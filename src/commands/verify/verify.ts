import type { Command } from "commander";
import { configOrRefuse, fail, repoPath } from "../../core/envelope/json.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { type CommitRecovery } from "../../core/staging/interrupted.js";
import { LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { openCommitWindow } from "../../core/staging/recovery/recover.js";
import { docsRepoReady } from "../policy/gate.js";
import { featureChecklist } from "../../core/verify/checklist.js";
import { readVerificationState } from "../../core/verify/read/file.js";
import { report } from "./report.js";
import { reportFrozen } from "./frozen.js";
import { record } from "./record.js";
import { type VerifyOptions } from "./record.js";
import { diffAnswers, type AnswerFiles } from "./cross/diff.js";


export function registerVerify(program: Command): void {
  program
    .command("verify")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Check a shipped feature against its own promises: derive the claims, record the answers")
    .option("--record <file>", "record a JSON answer set against the current checklist")
    .option(
      "--results <file>",
      "answer the scenario.tested claims mechanically from a test report: cucumber JSON, or loam's runner-neutral loamScenarioReport JSON for any other runner",
    )
    .option(
      "--contract-results <file>",
      "answer the api.exposes claims mechanically from an API contract-test report (loam's generic contract-results JSON)",
    )
    .option(
      "--diff-answers <files...>",
      "cross-examine two independent answer sets against the current checklist (reads only, writes nothing)",
    )
    .option(
      "--service <id>",
      "record only this service's claims, bound to the current repository commit",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: VerifyOptions) => {
      const json = opts.json === true;

      const config = await configOrRefuse(json);
      if (config === null) return;
      const { docsDir } = config;
      const recording =
        opts.record !== undefined || opts.results !== undefined || opts.contractResults !== undefined;

      // --diff-answers is a third READ form (see the WRITING/READING split
      // below): it validates two answer sets against the same checklist and
      // writes nothing, so combining it with any recording flag is a
      // contradiction refused up front — before the binding, before the lock —
      // rather than a mode silently picked between the two.
      let diffFiles: AnswerFiles | null = null;
      if (opts.diffAnswers !== undefined) {
        if (recording) {
          return fail(
            json,
            "invalid-option",
            "--diff-answers is a read-only cross-examination: it validates both files and writes nothing, " +
              "so it cannot be combined with --record, --results or --contract-results. " +
              "Diff first, then record the answer set you stand behind.",
          );
        }
        // Commander's variadic form consumes arguments until the next --flag,
        // so a featureId placed AFTER the flag arrives here as a third file —
        // this refusal is what turns that mistake into a sentence instead of a
        // diff of the wrong files.
        const [a, b] = opts.diffAnswers;
        if (opts.diffAnswers.length !== 2 || a === undefined || b === undefined) {
          return fail(
            json,
            "invalid-option",
            "--diff-answers takes exactly two answer files: --diff-answers a.json b.json",
          );
        }
        diffFiles = { a, b };
      }

      // WRITING is bound to the repository; READING is not. An attestation
      // pins claims to this repo's git HEAD and to file:line evidence inside
      // it, so writing (--record, --results or --contract-results) with
      // `--service X` may only run where loam.json says this repo IS X —
      // vouch's and gherkin's refusal, for vouch's reason: from anywhere
      // else, that repository is somebody else's. Reading takes
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

      // Before the lock, because the lock is a file INSIDE the docs repo: a
      // `docsDir` pointing at nothing used to surface as the lock file's own
      // ENOENT — an `internal` where the read side of this same command names
      // the misconfiguration. "docs", not "services", in BOTH modes — and that
      // is a pinned contract, not looseness: the legacy all-at-once form
      // records against a features-only docs repo with no `services/` at all,
      // and it has always exited 0 there. The cost is real and accepted: a
      // typo'd `docsDir` pointing at some existing non-docs directory gets a
      // `.loam-lock` created and removed inside it. The gate above only
      // guarantees the directory exists.
      if (!docsRepoReady(json, docsDir, "docs")) return;

      // A record is a merge over the docs repo, so recording takes the docs
      // lock — the same one archive, unarchive and rebase hold — and takes it
      // HERE, before the feature is even resolved. Behind the lock, an archive
      // can rename this feature's directory into features/archive/ at any
      // moment; a feature resolved before the lock could have its record
      // written into the pre-move path, a file nothing will ever read again.
      // The waiting form rather than archive's refuse-fast one, because two
      // recorders for different services of one feature are both supposed to
      // land: the second waits out the first's sub-second window and merges
      // over what it left. Reading stays lock-free — it writes nothing.
      //
      // A journal under the lock means the last writer never finished. The
      // record's own authoritative read is about to happen; reading it over
      // a half-commit would merge against bytes no run ever produced — the
      // last docs-repo writer that could still silently treat a half-commit
      // as healthy. That refusal must release the lock like every other path
      // out, and once did not; `openCommitWindow` releases it before it answers.
      let releaseLock: (() => Promise<void>) | null = null;
      let recovered: CommitRecovery | null = null;
      if (recording) {
        const opened = await openCommitWindow(docsDir, LOCK_WAIT_MS);
        if (!opened.ok) return fail(json, opened.code, opened.message);
        releaseLock = opened.release;
        recovered = opened.recovered;
      }
      try {
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

        // The cross-examination lens leaves BEFORE the record is read below:
        // it never consumes verification.yaml, and the moment a
        // cross-examination is most needed is exactly when the record on disk
        // is too damaged to read and somebody is about to re-record over it —
        // the record-unreadable refusal must not bar the one command that
        // would inform that re-recording. The archived refusal still applies,
        // with the recording branch's code and reason: there is no current
        // checklist to answer, so the wrong thing is the option, not the
        // answer sets.
        if (diffFiles !== null) {
          if (feature.archived) {
            return fail(
              json,
              "invalid-option",
              `${feature.id} is archived — there is no current checklist to answer, so there is nothing to cross-examine; its record is frozen history. \`loam unarchive ${feature.id}\` first if the claims really need re-answering.`,
            );
          }
          await diffAnswers(
            { docsDir, featureDir: feature.dir, json },
            await featureChecklist(docsDir, feature.dir, feature.id),
            diffFiles,
            { lens: opts.service },
          );
          return;
        }

        // Before anything else: a record file that exists but will not read
        // is a refusal, not an absence. It holds somebody's answers and — in a
        // fleet — other repositories' attestations; treating it as "not verified"
        // let the next --record silently overwrite all of it, and made the read
        // view say "no record" about a file sitting right there.
        //
        // The path is the one FILE that failed, and the advice is that file's:
        // the record is several files now, and the recipe that is safe for a
        // service's own attestation file (delete it, record that service again)
        // is the one that erases a fleet's evidence when the file is the shared
        // one-file record — which is what this refusal used to tell everyone,
        // and what a miscounted record's "record again" looped back into.
        //
        // An in-flight feature's checklist is derived FIRST, because which of
        // those files count depends on it: a record kept as per-service files
        // answers the question being asked now, and only the caller knows what
        // that is (`core/verify/read/union.ts`). Read without it, a service
        // that recorded the current checklist could lose a same-day tie to one
        // that recorded an older one, and this view called the whole record
        // stale. An archived feature derives nothing — see below.
        const checklist = feature.archived ? null : await featureChecklist(docsDir, feature.dir, feature.id);
        const existing = await readVerificationState(feature.dir, checklist?.digest);
        if (existing.state === "unreadable") {
          return fail(
            json,
            "record-unreadable",
            `${repoPath(docsDir, existing.path)} exists but cannot be read as a verification record: ${existing.reason}. ` +
              `${existing.advice} loam will not overwrite a record it could not read.`,
          );
        }
        const recorded = existing.state === "ok" ? existing.verification : null;

        // But an archived feature never gets a re-derived checklist — see the
        // header. Its record is frozen history, and --record / --results refuse
        // alike: the code is `invalid-option` rather than `answers-mismatch`
        // because the answers were never compared to anything — there is no
        // current checklist to answer, so the wrong thing here is the option,
        // not the answer set. (`checklist` is null exactly when the feature is
        // archived — the test is spelled on it so the compiler knows the
        // in-flight path below has one.)
        if (checklist === null) {
          if (recording) {
            return fail(
              json,
              "invalid-option",
              `${feature.id} is archived — its verification is history now. \`loam unarchive ${feature.id}\` first if the answers really need to change.`,
            );
          }
          reportFrozen({ docsDir, featureDir: feature.dir, json }, feature.id, recorded);
          return;
        }

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
          //
          // `config.service` and not `opts.service ?? config.service`, though
          // the two are the same value: the binding refusal above lets a
          // recording `--service` through only when it EQUALS the configured
          // service. Taking the configured one keeps its brand — loam.json's
          // reader validated it against the id grammar — and that brand is
          // what `serviceRecordPath` demands before it joins the id into a
          // file name. The raw flag never reaches the join.
          await record(
            { docsDir, featureDir: feature.dir, json, recovered },
            checklist,
            {
              service: config.service,
              repoDir: config.root ?? process.cwd(),
              previous: existing.state === "ok" ? { verification: existing.verification, files: existing.files } : null,
            },
            opts,
          );
          return;
        }

        report({ docsDir, featureDir: feature.dir, json }, checklist, recorded, {
          lens: opts.service,
          bound: config.service,
        });
      } finally {
        // Released on every path out — a refusal that kept the lock would turn
        // one bad answer set into a wedged docs repo for everyone else.
        if (releaseLock !== null) await releaseLock();
      }
    });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */
