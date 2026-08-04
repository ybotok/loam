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
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/json.js";
import { listField, parseFrontmatter, withFrontmatterFields } from "../core/frontmatter.js";
import {
  contentDigest,
  emptySourcesMessage,
  encodeSourceIndex,
  missingSources,
  patternSources,
  sourcesDigest,
  unsafeSources,
  type SkippedSource,
  type SourceIndexEntry,
} from "../core/provenance.js";
import { SPEC_AXES, servicePaths } from "../core/repo.js";
import { message, rollbackStaged, stageWrites, swapStaged, type PlannedWrite } from "../core/staging.js";

interface VouchOptions {
  service?: string;
  json?: boolean;
}

export interface VouchRequest {
  docsDir: string;
  service: string;
  /** The service's own repo — what `sources` resolve against. */
  repoDir: string;
  /** The date to stamp. Injected rather than read off the clock, so it can be pinned. */
  today: string;
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
      /** Every spec-axis file stamped, in SPEC_AXES order: spec.md first, arch.spec.md behind it when present. */
      stamped: StampedSpec[];
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
        return fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
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

      const outcome = await vouch({
        docsDir: config.docsDir,
        service,
        repoDir: process.cwd(),
        today: today(new Date()),
      });
      if (!outcome.ok) return fail(json, outcome.code, outcome.message);

      // spec.md is required, so it always leads `stamped`; arch.spec.md is the
      // only possible second entry.
      const [spec, arch] = outcome.stamped;
      if (json) {
        emitJson({
          service,
          path: repoPath(config.docsDir, spec!.path),
          status: outcome.status,
          last_verified: outcome.lastVerified,
          sources: spec!.sources,
          sources_digest: spec!.digest,
          content_digest: spec!.contentDigest,
          files: spec!.files,
          skipped: spec!.skipped,
          // The architecture axis, same keys: null when the service has no
          // arch.spec.md, so a consumer can tell "none present" from an older
          // loam that never reported the axis. status/last_verified are not
          // repeated — the vouch is one act, and they hold for every file in it.
          archSpec:
            arch === undefined
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
      for (const [i, s] of outcome.stamped.entries()) {
        console.log(`${i > 0 ? "\n" : ""}${service} vouched — ${repoPath(config.docsDir, s.path)}\n`);
        console.log(`  status          ${outcome.status}`);
        console.log(`  last_verified   ${outcome.lastVerified}`);
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
  // before anything is written.
  const verified: VerifiedSpec[] = [];
  for (const axis of SPEC_AXES) {
    const path = paths[axis.key];
    if (!existsSync(path)) continue;
    const outcome = await verifySpec(req, path, axis.file);
    if (!outcome.ok) return outcome;
    verified.push(outcome);
  }

  const stamped: StampedSpec[] = [];
  const writes: PlannedWrite[] = [];
  for (const v of verified) {
    // Two passes on purpose: `content_digest` hashes the body BELOW the
    // frontmatter, and withFrontmatterFields promises that body byte-identical —
    // so hashing after the first stamp and writing the hash in a second one
    // yields a digest that is true of the file exactly as written. A re-vouch
    // takes the same road and refreshes every field, this one included.
    const restamped = withFrontmatterFields(v.raw, {
      status: "verified",
      last_verified: req.today,
      sources_digest: v.digest,
      // Beside the digest, what it was taken over. `sources_digest` alone can
      // only ever say THAT the code moved; the next `loam validate` reads this
      // back to say which files did.
      sources_files: encodeSourceIndex(v.index),
    });
    const bodyDigest = contentDigest(restamped);
    writes.push({ path: v.path, content: withFrontmatterFields(restamped, { content_digest: bodyDigest }) });
    stamped.push({
      path: v.path,
      file: v.file,
      digest: v.digest,
      contentDigest: bodyDigest,
      sources: v.sources,
      files: v.index.length,
      skipped: v.skipped,
    });
  }

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
  const raced = staged.filter((s, i) => s.before !== verified[i]!.raw);
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
  return { ok: true, status: "verified", lastVerified: req.today, stamped };
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
  const raw = await readFile(path, "utf8");
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

/**
 * The local calendar day. A vouch is a person saying "today I read this", so it
 * is their date, not UTC's — `toISOString` files an evening vouch in the
 * Americas under tomorrow.
 */
function today(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}


function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
