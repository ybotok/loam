import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { acquireDocsLockWaiting, DocsBusyError } from "../../core/staging/lock.js";
import { docsRepoReady } from "../policy/gate.js";
import { featureChecklist } from "../../core/verify/checklist.js";
import { readVerificationState } from "../../core/verify/file.js";
import { verificationPath } from "../../core/verify/record.js";
import { report } from "./report.js";
import { reportFrozen } from "./frozen.js";
import { record } from "./record.js";
import { type VerifyOptions } from "./record.js";


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

      // Before the lock, because the lock is a file INSIDE the docs repo: a
      // `docsDir` pointing at nothing used to surface as the lock file's own
      // ENOENT — an `internal` where the read side of this same command names
      // the misconfiguration. One gate, both modes, and the lock is only ever
      // created inside a directory that is a docs repo.
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
      let releaseLock: (() => Promise<void>) | null = null;
      if (recording) {
        try {
          releaseLock = await acquireDocsLockWaiting(docsDir, RECORD_LOCK_WAIT_MS);
        } catch (err) {
          if (err instanceof DocsBusyError) return fail(json, "docs-busy", err.message);
          throw err;
        }
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
          reportFrozen({ docsDir, featureDir: feature.dir, json }, feature.id, recorded);
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
            { docsDir, featureDir: feature.dir, json },
            checklist,
            {
              service: opts.service ?? config.service,
              repoDir: config.root ?? process.cwd(),
              previous: recorded,
              preImage: existing.state === "ok" ? existing.raw : null,
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

/**
 * How long a `--record` waits for the docs lock before answering `docs-busy`.
 * Long enough to sit out another record's or an archive's commit window;
 * bounded so a wedged lock (a live holder that hangs) cannot hang this
 * command with it.
 */
const RECORD_LOCK_WAIT_MS = 5_000;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */
