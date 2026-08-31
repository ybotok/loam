import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../../core/envelope/json.js";
import { gitIdentity } from "../../core/provenance/git.js";
import { today } from "../../core/provenance/stamp.js";
import { serviceTreePathOf } from "../../core/repo/service-target.js";
import { runPack } from "./pack/print.js";
import { confirmVouch } from "./prompt/confirm.js";
import { emitStampJson, printStamp } from "./report.js";
import { vouch } from "./run.js";
import { buildSamplePlan, type SamplePlan } from "./sample/plan.js";
import { printReadingList } from "./sample/print.js";

/**
 * `loam vouch` — the human act SCHEMA.md has always described as "promote draft
 * -> verified".
 *
 * Everything else loam checks is internal consistency, and an agent writing
 * fluent prose satisfies all of it. This is the one command that records a
 * person: they read the code, they say the document matches it, and loam stamps
 * a digest of what they read — and a digest of the document they read it
 * against, so neither side can move quietly. From then on `loam validate` can
 * tell the difference between a document nobody has checked, one that still
 * matches the code, one the code has moved out from under, and one whose own
 * prose changed after the stamp.
 *
 * "Records a person" was, for two releases, a thing this file said and did not
 * do. There was no `vouched_by`, no identity of any kind and no interactive
 * gate, so an agent could run it twice unattended and stamp `verified` both
 * times — while the skill files loam generates pre-approved `Bash(loam:*)`,
 * which meant the agent that wrote the draft was permitted to promote it. Three
 * things close that, and none of them is a signature: the stamp carries git's
 * `user.email` (`vouched_by`), the run refuses without a terminal or an explicit
 * `--yes`, and the generated allowlist names loam's read-only and authoring
 * verbs one by one instead of all of them (core/agent/tools/dialects.ts). What that buys is
 * attribution and a deliberate act, not proof — git config is a text file. A
 * reviewer can now ask a named person what they read, which is the question
 * `status: verified` was silently answering with nobody.
 *
 * The stamp is only worth what it claims, so vouch refuses everything it cannot
 * actually verify — a frontmatter block that will not parse (whose fields
 * nobody can read, and whose rewrite would lose the author's lines), a spec
 * with no sources, a glob pattern (no longer supported), a source that is
 * gone, a directory holding no files, or a repo that is not this service's —
 * and refuses without writing anything.
 *
 * "The document" is every spec-axis file the service has: spec.md always, and
 * arch.spec.md beside it when present — same frontmatter conventions, same
 * stamp, one vouch. The refusal discipline is per file but the vouch is
 * all-or-nothing per service: one unverifiable file refuses the whole run, so
 * a `verified` service never means "half-stamped".
 */

interface VouchOptions {
  service?: string;
  yes?: boolean;
  pack?: boolean;
  /** `--sample <n>` as typed — a string until it is proved to be a whole number. */
  sample?: string;
  json?: boolean;
}

export function registerVouch(program: Command): void {
  program
    .command("vouch")
    .description(
      "Vouch for a service's living specs: stamp spec.md, and arch.spec.md when present, verified against the code they describe",
    )
    .option("--service <id>", "service to vouch for (defaults to the configured service)")
    .option(
      "--yes",
      "skip the confirmation — required when stdin is not a terminal, and still records `vouched_by`",
    )
    .option(
      "--pack",
      "print the re-vouch reading pack — the doc-body diff since the last vouch, the source files that moved, and the sections already covered — then exit without vouching; read-only, nothing is stamped",
    )
    .option(
      "--sample <n>",
      "vouch after reading a deterministic sample of <n> sections per spec file — the stamp records `vouch_scope: sampled`, `loam list` shows `vouched (sampled)`, and `loam validate` reports `sources.sampled-vouch` until a full vouch clears it",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: VouchOptions) => {
      const json = opts.json === true;

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;

      const service = opts.service ?? config.service;
      if (service === undefined) {
        return fail(json, "invalid-option", NO_SERVICE_MESSAGE);
      }
      // Vouching hashes the code the doc was written from, so it can only run
      // where that code is. From anywhere else the paths are someone else's.
      //
      // TWO conditions, two codes, and the split is the whole point. Both used
      // to answer `invalid-option`, whose `loam explain` row says the
      // invocation itself is wrong — contradictory flags, a mistyped one, a
      // value that cannot be right. Here the invocation is perfectly correct
      // and the REPOSITORY is the wrong one, so that code sent a user whose
      // flags were fine off to re-read their flags, and left CI and agents
      // unable to tell "run this in the service repo" from "you typed the flag
      // wrong". `loam verify --record --service` already draws exactly this
      // line for exactly this reason (see commands/verify/verify.ts); vouch
      // and gherkin now answer the same pair, so a caller branching on
      // `error.code` gets one answer from all three. The messages are
      // unchanged — only the code moved.
      if (config.service === undefined) {
        return fail(
          json,
          "repository-unavailable",
          `Cannot vouch for '${service}' from here: this is not a service repo. \`sources\` resolve against the service's own repo — run it there.`,
        );
      }
      if (config.service !== service) {
        return fail(
          json,
          "service-mismatch",
          `Cannot vouch for '${service}' from here: this repo is '${config.service}'. \`sources\` resolve against the service's own repo — run it there.`,
        );
      }

      // The repo root, not the cwd — see the comment on `repoDir` below; the
      // identity has to be asked of the same directory the sources resolve in,
      // or a subdirectory with its own git config would answer for it.
      const repoDir = config.root ?? process.cwd();

      // The flag's own grammar, before anything is read or hashed: `--sample`
      // decides what the run CLAIMS, so a value nobody can read must not reach
      // a stamp. Whole numbers only, and at least one — `0` is a vouch that
      // read nothing, and there is already a way to record that (do not
      // vouch). Checked before `--pack` below so a typo is refused the same
      // way in both modes.
      let sampleSize: number | undefined;
      if (opts.sample !== undefined) {
        if (!/^\d+$/.test(opts.sample.trim()) || Number(opts.sample) < 1) {
          return fail(
            json,
            "invalid-option",
            `--sample expects a positive whole number of sections; got '${opts.sample}'. ` +
              "Nothing was read and nothing was stamped.",
          );
        }
        sampleSize = Number(opts.sample);
      }

      // The reading pack: read-only, so it runs BEFORE — and instead of —
      // every write-path gate below (identity, TTY, `--yes`, lock, journal),
      // which all defend the stamp; pack/pack.ts's banner carries the full
      // reasoning. It runs AFTER the wrong-repo gate above on purpose: the
      // source delta resolves `sources` here. `--yes` does not compose — it
      // is the unattended stamp, and a pack that stamped would defeat the
      // read it just prescribed.
      if (opts.pack === true) {
        if (opts.yes === true) {
          return fail(
            json,
            "invalid-option",
            "--pack is the reading list and --yes is the unattended stamp; a pack that immediately " +
              `stamped would defeat the read it just prescribed. Run --pack, read it, then \`loam vouch --service ${service}\`.`,
          );
        }
        // `--sample` composes with the pack instead of conflicting with it:
        // the pack is the reading list, and a sampled vouch's reading list is
        // the sample. Passing it here makes the pack print the sections the
        // subsequent `loam vouch --sample <n>` will stamp for — the same
        // derivation from the same seed, so the two cannot prescribe
        // different documents.
        return runPack({ docsDir: config.docsDir, service: config.service, repoDir, json, sample: sampleSize });
      }

      // Who. Before any reading, because a run that cannot name a person has
      // nothing to offer at the end of it and should not spend a digest finding
      // that out.
      const vouchedBy = await gitIdentity(repoDir);
      if (vouchedBy === null) {
        return fail(
          json,
          "vouch-unattributable",
          `Cannot vouch for '${service}': git names no \`user.email\` in ${repoDir}, so the stamp would ` +
            "record a claim with nobody behind it — which is the one thing `status: verified` must not mean. " +
            "Set it (`git config user.email you@example.com`) and re-run.",
        );
      }

      // Whether a person is actually here. `vouch` is the only command in loam
      // whose output is a claim about a HUMAN act — every other check is
      // internal consistency, which fluent prose satisfies — and it used to run
      // unattended, unattributed, twice in a row, stamping `verified` both
      // times. Meanwhile the generated skill files pre-approved `Bash(loam:*)`,
      // so the same agent that wrote the draft was permitted to promote it.
      // That inverts loam's own argument about test evidence: an agent must not
      // be able to SAY a scenario is tested, and it must not be able to say a
      // spec matches the code either. The allowlist no longer covers this
      // command (core/agent/tools/dialects.ts), and nothing but a terminal or an explicit
      // `--yes` gets past here.
      const attended = opts.yes === true;
      if (!attended) {
        if (process.stdin.isTTY !== true) {
          return fail(
            json,
            "vouch-unattended",
            `Cannot vouch for '${service}' with nothing on the other end of stdin: this command records that ` +
              "a PERSON read the code and says the document matches it, and nobody was asked. Run it from a " +
              "terminal, or pass --yes to state that you are standing behind it anyway — `vouched_by` records " +
              `${vouchedBy} either way.`,
          );
        }
        // `--json` and a prompt do not compose: the envelope is one JSON
        // document on stdout, and a question printed beside it is not parseable
        // by the consumer that asked for it. A JSON caller is a program, so it
        // gets the same answer a pipe does — say so with --yes.
        if (json) {
          return fail(
            json,
            "vouch-unattended",
            `Cannot vouch for '${service}' in --json mode without --yes: the confirmation is a question for a ` +
              "person, and it cannot be asked on a stream whose whole contract is one JSON document.",
          );
        }
      }

      // The reading list is built BEFORE the question and AFTER the attendance
      // gates: a run that cannot ask anybody anything must not spend two
      // source-tree digests finding that out, and a person must not be asked
      // to confirm a sample nobody has shown them. Every refusal a vouch can
      // raise about these documents fires in here, so it lands before the read
      // rather than after it.
      let sample: SamplePlan | undefined;
      if (sampleSize !== undefined) {
        const built = await buildSamplePlan({ docsDir: config.docsDir, service: config.service, repoDir, n: sampleSize });
        if (!built.ok) return fail(json, built.code, built.message);
        sample = built.plan;
        if (!json) printReadingList(sample, service);
      }
      const servicePath = await serviceTreePathOf(config.docsDir, service);
      if (!attended && !(await confirmVouch({ service, vouchedBy, docsDir: config.docsDir, servicePath, sample }))) {
        return fail(json, "vouch-declined", `Nothing was stamped for '${service}'.`);
      }

      const outcome = await vouch({
        docsDir: config.docsDir,
        // The guard above proved `service` IS `config.service`, and only the
        // latter carries the parse (`loam.json`'s `service` field is validated
        // at load). Same string, but only one spelling is pathable.
        service: config.service,
        vouchedBy,
        // The repo root, not the cwd. `sources:` are spelled relative to the
        // repository — that is what they mean in the frontmatter and what
        // `loam validate` resolves them against — so vouching from a
        // subdirectory used to report every real source as missing
        // (`sources-path-missing`) and refuse the stamp. `config.root` is the
        // directory loam.json was found in, which is the only definition of
        // "this repo" that does not move with the caller.
        repoDir,
        today: today(new Date()),
        // Absent for an ordinary vouch, which is what makes an ordinary vouch
        // CLEAR a prior sample's scope rather than leave it standing.
        ...(sample === undefined ? {} : { sample }),
      });
      if (!outcome.ok) return fail(json, outcome.code, outcome.message);

      const report = { service, docsDir: config.docsDir, outcome, ...(sample === undefined ? {} : { sample }) };
      if (json) return emitStampJson(report);
      printStamp(report);
    });
}
