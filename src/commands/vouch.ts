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
 * verbs one by one instead of all of them (core/agent.ts). What that buys is
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
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../core/envelope/config.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, repoPath, reportNoConfig, type ErrorCode } from "../core/envelope/json.js";
import { listField, parseFrontmatter, withFrontmatterFields } from "../core/document/frontmatter.js";
import {
  contentDigest,
  emptySourcesMessage,
  encodeSourceIndex,
  gitIdentity,
  missingSources,
  patternSources,
  sourcesDigest,
  today,
  unsafeSources,
  type SkippedSource,
  type SourceIndexEntry,
} from "../core/provenance.js";
import { SPEC_AXES, servicePaths } from "../core/repo.js";
import { plural } from "./format.js";
import {
  message,
  NotUtf8Error,
  readUtf8,
  rollbackStaged,
  stageWrites,
  swapStaged,
  type PlannedWrite,
} from "../core/staging.js";

interface VouchOptions {
  service?: string;
  yes?: boolean;
  json?: boolean;
}

export interface VouchRequest {
  docsDir: string;
  service: string;
  /** The service's own repo — what `sources` resolve against. */
  repoDir: string;
  /** The date to stamp. Injected rather than read off the clock, so it can be pinned. */
  today: string;
  /**
   * Who is vouching, as `vouched_by` is stamped — git's identity for `repoDir`.
   * Injected for the same reason `today` is: this function must be reproducible
   * from its arguments, and the resolution (and its refusal) belongs to the
   * command that can talk to a person about it.
   */
  vouchedBy: string;
}

/** One spec-axis file's share of a successful vouch. */
export interface StampedSpec {
  /** Absolute path of the file that was stamped. */
  path: string;
  /** The axis's filename — "spec.md" or "arch.spec.md". */
  file: string;
  /** Digest of the sources, as stamped into `sources_digest`. */
  digest: string;
  /** Digest of the document's own body, as stamped into `content_digest`. */
  contentDigest: string;
  /** The `sources` entries, as written in the frontmatter. */
  sources: string[];
  /** How many files those entries expanded to. */
  files: number;
  /**
   * Paths under those entries the digest would not hash. A vouch over a spec
   * with a skipped path is still a vouch — the person read what they read — but
   * they are told, because the stamp cannot go stale over bytes it never saw.
   */
  skipped: SkippedSource[];
}

export type VouchOutcome =
  | {
      ok: true;
      status: "verified";
      lastVerified: string;
      /** The identity stamped into every file this vouch touched. */
      vouchedBy: string;
      /**
       * Every spec-axis file stamped. Named, not ordered: spec.md is required
       * for a vouch to happen at all, and arch.spec.md is the only other file
       * one can touch, so the type is what says which is which. An array said it
       * in a comment instead, and every reader had to assert non-emptiness to
       * reach the file that comment promised was there.
       */
      stamped: { spec: StampedSpec; archSpec: StampedSpec | null };
    }
  | {
      ok: false;
      // The last three are the commit phase failing: `vouch-raced` says the
      // document moved under the run and nothing was written at all,
      // `merge-failed` says the rollback held (nothing was stamped, re-running
      // can work), `rollback-incomplete` says it did not and the message lists
      // the files.
      code: Extract<
        ErrorCode,
        | "unknown-target"
        | "sources-absent"
        | "sources-path-missing"
        // The spec is there but is not UTF-8 text: a diagnosable state, not the
        // unexpected throw `internal` is for.
        | "repository-unavailable"
        | "vouch-raced"
        | "merge-failed"
        | "rollback-incomplete"
      >;
      message: string;
    };

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
      // command (core/agent.ts), and nothing but a terminal or an explicit
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
        service,
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
export async function vouch(req: VouchRequest): Promise<VouchOutcome> {
  const paths = servicePaths(req.docsDir, req.service);
  if (!existsSync(paths.spec)) {
    return {
      ok: false,
      code: "unknown-target",
      message: `No living spec at ${paths.spec}. Run \`loam adopt\` for '${req.service}' first.`,
    };
  }

  // Verify first, stamp after: spec.md is required (checked above), arch.spec.md
  // rides when it exists, and one file that cannot be verified refuses the run
  // before anything is written. The two axes are walked by name rather than
  // accumulated in a loop, because everything downstream needs to know WHICH
  // file it is holding — the required one or the optional one — and a loop can
  // only say that positionally.
  const [specAxis, archAxis] = SPEC_AXES;
  const specVerified = await verifySpec(req, paths[specAxis.key], specAxis.file);
  if (!specVerified.ok) return specVerified;
  let archVerified: VerifiedSpec | null = null;
  if (existsSync(paths[archAxis.key])) {
    const outcome = await verifySpec(req, paths[archAxis.key], archAxis.file);
    if (!outcome.ok) return outcome;
    archVerified = outcome;
  }
  const verified: VerifiedSpec[] = [specVerified, ...(archVerified === null ? [] : [archVerified])];

  const specPlan = planStamp(specVerified, req);
  const archPlan = archVerified === null ? null : planStamp(archVerified, req);
  const writes: PlannedWrite[] = [specPlan.write, ...(archPlan === null ? [] : [archPlan.write])];

  // Commit through archive's stage-and-swap machinery (core/staging.ts) rather
  // than a writeFile per file: every stamp is computed above in memory, so a
  // plain sequential write could only die BETWEEN the pair's writes — spec.md
  // verified, arch.spec.md still carrying the old stamp — the exact half-stamped
  // state the all-or-nothing verification exists to rule out, lost at the last
  // step to a full disk. Staging parks each file's new bytes beside it, swaps by
  // rename(2), and on failure restores what already swapped from its pre-image.
  const staged = await stageWrites(writes);

  // One shared docs repo, ten service repos, and nothing stopping two of them
  // from vouching at once. Between reading a spec and swapping the stamp in
  // there is a window in which somebody else's vouch (or an editor, or a merge)
  // can land in the same file — and because the new bytes were computed from
  // the OLD ones, swapping them in would take that stamp back out without a
  // word. `stageWrites` has already read what is on disk right now, so the
  // check is a comparison, not another read: if the file is not what was
  // verified, this run is describing a document that no longer exists.
  // Bytes, not text: `stageWrites` reads the file as a Buffer (a string
  // comparison against it is never equal, which made every vouch report
  // `vouch-raced` and stamp nothing). A file that is GONE is still a race —
  // `null` is not "empty", it is "the document this run described is not
  // there any more".
  // Joined by path, not by index: pairing the two lists positionally assumed
  // `stageWrites` returns one entry per planned write in order — true today,
  // promised nowhere, and a compare-and-set that silently compares the wrong
  // pair would stamp over somebody else's vouch. A staged write no verified
  // file claims has nothing to be compared against, so it counts as raced;
  // fail-closed is the only safe direction here.
  const verifiedByPath = new Map(verified.map((v) => [v.path, v] as const));
  const raced = staged.filter((s) => {
    const v = verifiedByPath.get(s.write.path);
    return v === undefined || s.before === null || !s.before.equals(Buffer.from(v.raw, "utf8"));
  });
  if (raced.length > 0) {
    // Nothing has swapped yet, so the rollback is only the temp files going
    // away — the other writer's stamp is left exactly as it landed.
    await rollbackStaged(staged);
    return {
      ok: false,
      code: "vouch-raced",
      message:
        `${req.service}: ${raced.map((s) => s.write.path).join(", ")} changed while this vouch was running — ` +
        `another vouch or an edit landed first. Nothing was stamped: re-read the document and re-run.`,
    };
  }

  try {
    await swapStaged(staged);
  } catch (err) {
    const failures = await rollbackStaged(staged);
    // Archive's two answers to "can I trust the repo?", reused rather than
    // minting vouch-only codes — a caller branches on the same fact either way:
    // rolled back → nothing changed, re-running can work; incomplete → the
    // files listed need a human. Only the prose is vouch's own.
    return failures.length > 0
      ? {
          ok: false,
          code: "rollback-incomplete",
          message: `${message(err)} — ROLLBACK INCOMPLETE, these files may be half-stamped and need checking by hand: ${failures.join(", ")}`,
        }
      : {
          ok: false,
          code: "merge-failed",
          message: `${message(err)} — the vouch was rolled back, no spec was stamped`,
        };
  }
  return {
    ok: true,
    status: "verified",
    lastVerified: req.today,
    vouchedBy: req.vouchedBy,
    stamped: { spec: specPlan.stamped, archSpec: archPlan === null ? null : archPlan.stamped },
  };
}

/**
 * One verified file's share of the commit: the bytes to write, and the record
 * of what was stamped into them. Kept beside each other because they are the
 * same computation — the report must describe the file that was actually
 * written, not a second guess at it.
 */
function planStamp(v: VerifiedSpec, req: VouchRequest): { write: PlannedWrite; stamped: StampedSpec } {
  // Two passes on purpose: `content_digest` hashes the body BELOW the
  // frontmatter, and withFrontmatterFields promises that body byte-identical —
  // so hashing after the first stamp and writing the hash in a second one
  // yields a digest that is true of the file exactly as written. A re-vouch
  // takes the same road and refreshes every field, this one included.
  const restamped = withFrontmatterFields(v.raw, {
    status: "verified",
    last_verified: req.today,
    // WHO, beside when. Without it `status: verified` recorded that the word
    // had been written and nothing about who wrote it, so a vouch and an
    // agent's own draft left the same trace in the document — the one
    // distinction this command exists to make.
    vouched_by: req.vouchedBy,
    sources_digest: v.digest,
    // Beside the digest, what it was taken over. `sources_digest` alone can
    // only ever say THAT the code moved; the next `loam validate` reads this
    // back to say which files did.
    sources_files: encodeSourceIndex(v.index),
  });
  const bodyDigest = contentDigest(restamped);
  return {
    write: { path: v.path, content: withFrontmatterFields(restamped, { content_digest: bodyDigest }) },
    stamped: {
      path: v.path,
      file: v.file,
      digest: v.digest,
      contentDigest: bodyDigest,
      sources: v.sources,
      files: v.index.length,
      skipped: v.skipped,
    },
  };
}

/** A spec-axis file whose sources all check out, carrying what the stamp needs. */
interface VerifiedSpec {
  ok: true;
  path: string;
  file: string;
  /** The file exactly as read — what the stamp is applied to. */
  raw: string;
  sources: string[];
  digest: string;
  /** Per-file shas, in digest order — what `sources_files` is stamped from. */
  index: SourceIndexEntry[];
  skipped: SkippedSource[];
}

/**
 * The per-file half of the refusal discipline: everything vouch cannot verify
 * about ONE spec file, checked the same way for spec.md and arch.spec.md.
 */
async function verifySpec(
  req: VouchRequest,
  path: string,
  file: string,
): Promise<VerifiedSpec | Extract<VouchOutcome, { ok: false }>> {
  // Through readUtf8, so the round trip below is exact: the stamp is computed
  // from `raw` and the race check compares `Buffer.from(raw)` against the bytes
  // on disk, which only agree if the file decoded without substitutions. A
  // non-UTF-8 spec is refused by name rather than stamped as verified with
  // every undecodable byte replaced. Refused HERE rather than left to the CLI's
  // top-level handler, which would report a diagnosable state as `internal`.
  // What it replaces is a diagnosis that was worse than none: a UTF-16 spec
  // decoded to a document with no frontmatter loam could find, so vouch refused
  // it as `sources-absent` — "names no sources" — over a file whose `sources:`
  // line is right there.
  let raw: string;
  try {
    raw = await readUtf8(path);
  } catch (err) {
    if (!(err instanceof NotUtf8Error)) throw err;
    return {
      ok: false,
      code: "repository-unavailable",
      message: `${req.service}: ${file} cannot be vouched for — ${err.message}`,
    };
  }
  const fm = parseFrontmatter(raw);
  // Before any sources reasoning: a header that does not parse hides whatever
  // fields the author wrote, so "names no sources" would be a false diagnosis —
  // and if the file ever reached the stamp, withFrontmatterFields' rule for
  // unreadable headers is replace-don't-merge, which would silently discard the
  // author's owner/service/sources lines. Refuse before the write path can see
  // the file. The code stays `sources-absent` — for vouch's purposes the
  // sources ARE unreadable-hence-absent, and the message carries the real
  // diagnosis — rather than minting a new ErrorCode for one refusal.
  if (fm.malformed) {
    return {
      ok: false,
      code: "sources-absent",
      message:
        `${req.service}: ${file} has a frontmatter block that cannot be read as YAML — ` +
        `its fields (\`sources\` included) are unreadable, and stamping would rewrite the header wholesale, ` +
        `losing what the author wrote. Fix the YAML between the \`---\` fences ` +
        `(\`loam validate\` reports it as \`frontmatter.malformed\`), then re-run.`,
    };
  }
  const sources = listField(fm, "sources");
  if (sources.length === 0) {
    return {
      ok: false,
      code: "sources-absent",
      message: `${req.service}: ${file} names no sources — there is nothing to vouch it against. Add \`sources:\` naming the code it was written from.`,
    };
  }

  // spec.md's refusals predate the second axis and keep their exact wording;
  // where they did not name the file, only the newer axis adds it.
  const label = file === "spec.md" ? req.service : `${req.service}: ${file}`;

  // Before the existence check: a pattern is not a path that "does not exist",
  // it is an entry loam no longer reads at all, and the refusal has to say so.
  const patterns = patternSources(sources);
  if (patterns.length > 0) {
    return {
      ok: false,
      code: "sources-path-missing",
      message: `${label}: ${patterns.length} source(s) are glob patterns — ${patterns.join(", ")}. Patterns are no longer supported: name files or directories (a directory already covers everything beneath it). A stamp over a pattern would vouch for a file set nobody can be sure of.`,
    };
  }

  const unsafe = unsafeSources(req.repoDir, sources);
  if (unsafe.length > 0) {
    return {
      ok: false,
      code: "sources-path-missing",
      message: `${label}: ${unsafe.length} source(s) escape the service repo — ${unsafe.join(", ")}. Sources must be relative paths contained by this repository, including through symlinks; vouch will not hash files outside it.`,
    };
  }

  const missing = missingSources(req.repoDir, sources);
  if (missing.length > 0) {
    return {
      ok: false,
      code: "sources-path-missing",
      message: `${label}: ${missing.length} source(s) do not exist — ${missing.join(", ")}. Vouching now would stamp a claim about code that is not there.`,
    };
  }

  const { digest, index, skipped } = await sourcesDigest(req.repoDir, sources);
  if (index.length === 0) {
    // A directory that exists but holds no files — or only ones the walk leaves
    // out: dot-entries, `node_modules`, anything the repository itself ignores.
    // The paths "resolve", but a digest over nothing never changes, so the stamp
    // would read as current forever. The sentence comes from provenance.ts so
    // that `loam validate` can grade the same state in the same words instead of
    // going green on a document this command refuses.
    return { ok: false, code: "sources-absent", message: emptySourcesMessage(label, sources) };
  }
  return { ok: true, path, file, raw, sources, digest, index, skipped };
}
