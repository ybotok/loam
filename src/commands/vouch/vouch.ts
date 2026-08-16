import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { gitIdentity } from "../../core/provenance/git.js";
import { today } from "../../core/provenance/stamp.js";
import { plural } from "../policy/format.js";
import { vouch } from "./run.js";

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
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: VouchOptions) => {
      const json = opts.json === true;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }

      const service = opts.service ?? config.service;
      if (service === undefined) {
        return fail(json, "invalid-option", NO_SERVICE_MESSAGE);
      }
      // Vouching hashes the code the doc was written from, so it can only run
      // where that code is. From anywhere else the paths are someone else's.
      if (config.service !== service) {
        const here =
          config.service === undefined ? "this is not a service repo" : `this repo is '${config.service}'`;
        return fail(
          json,
          "invalid-option",
          `Cannot vouch for '${service}' from here: ${here}. \`sources\` resolve against the service's own repo — run it there.`,
        );
      }

      // The repo root, not the cwd — see the comment on `repoDir` below; the
      // identity has to be asked of the same directory the sources resolve in,
      // or a subdirectory with its own git config would answer for it.
      const repoDir = config.root ?? process.cwd();

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
      if (opts.yes !== true) {
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
        if (!(await confirmVouch(service, vouchedBy, config.docsDir))) {
          return fail(json, "vouch-declined", `Nothing was stamped for '${service}'.`);
        }
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
      });
      if (!outcome.ok) return fail(json, outcome.code, outcome.message);

      const { spec, archSpec: arch } = outcome.stamped;
      if (json) {
        emitJson({
          service,
          path: repoPath(config.docsDir, spec.path),
          status: outcome.status,
          last_verified: outcome.lastVerified,
          vouched_by: outcome.vouchedBy,
          sources: spec.sources,
          sources_digest: spec.digest,
          content_digest: spec.contentDigest,
          files: spec.files,
          skipped: spec.skipped,
          // The architecture axis, same keys: null when the service has no
          // arch.spec.md, so a consumer can tell "none present" from an older
          // loam that never reported the axis. status/last_verified are not
          // repeated — the vouch is one act, and they hold for every file in it.
          archSpec:
            arch === null
              ? null
              : {
                  path: repoPath(config.docsDir, arch.path),
                  sources: arch.sources,
                  sources_digest: arch.digest,
                  content_digest: arch.contentDigest,
                  files: arch.files,
                  skipped: arch.skipped,
                },
        });
        return;
      }
      // spec.md first, arch.spec.md behind it when present — the order the
      // person who vouched reads them in, and the order the axes are declared.
      for (const [i, s] of [spec, ...(arch === null ? [] : [arch])].entries()) {
        console.log(`${i > 0 ? "\n" : ""}${service} vouched — ${repoPath(config.docsDir, s.path)}\n`);
        console.log(`  status          ${outcome.status}`);
        console.log(`  last_verified   ${outcome.lastVerified}`);
        console.log(`  vouched_by      ${outcome.vouchedBy}`);
        console.log(
          `  sources_digest  ${s.digest}  (${plural(s.files, "file")} from ${plural(s.sources.length, "source")})`,
        );
        console.log(`  content_digest  ${s.contentDigest}`);
        // Said at the moment of stamping, not only later by `loam validate`:
        // this is the one screen the person who vouched is actually looking at,
        // and what it lists is the part of the tree their promise does not cover.
        if (s.skipped.length > 0) {
          console.log(`\n  ⚠ ${plural(s.skipped.length, "path")} under those sources went unhashed:`);
          for (const skip of s.skipped) console.log(`      ${skip.path} — ${skip.reason}`);
        }
      }
      console.log(
        `\n\`loam validate\` will now say when that code moves out from under the spec — or when the spec moves under its own stamp.`,
      );
    });
}

/**
 * Ask, on a terminal, and answer only on an explicit yes.
 *
 * The question states what is about to be claimed rather than asking for
 * assent to a verb: "vouch?" invites a reflex, and the whole value of this
 * command is that the reflex is the thing being interrupted. Default is no —
 * a bare Enter, a closed stdin and a Ctrl-C all mean the same thing, because
 * the only answer that may stamp a document is one somebody typed.
 */
async function confirmVouch(service: string, vouchedBy: string, docsDir: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `\nVouching for '${service}' records that YOU read the code and say ` +
        `${docsDir}/services/${service}/ describes it.\n` +
        `It will be stamped \`status: verified\`, \`vouched_by: ${vouchedBy}\`.\n` +
        "loam has not checked this and cannot: every other check it runs is internal " +
        "consistency, which well-written prose satisfies on its own.\n",
    );
    const answer = await rl.question("Have you read the code? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Stamp `status`, `last_verified`, `sources_digest` and `content_digest` into
 * a service's living specs — spec.md, and arch.spec.md beside it when the
 * service has one — leaving every body byte-identical.
 *
 * Nothing is written unless all four can be stamped truthfully for EVERY file —
 * a half-stamp (verified, but with no digest behind it; or one file stamped and
 * its sibling not) is exactly the claim this command exists to stop being
 * possible, so every present file is verified before any is written — and the
 * writing itself is staged and swapped in like archive's merge, so a failure
 * between the pair's two writes rolls the first back instead of leaving it.
 * The two digests are the two halves of one promise: `sources_digest` pins the
 * code that was read, `content_digest` pins the words it was read against, so
 * `loam validate` can see either side move.
 */
