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
 * actually verify — a spec with no sources, a source that is gone, a pattern
 * matching no file, or a repo that is not this service's — and refuses without
 * writing anything.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, reportNoConfig, type ErrorCode } from "../core/json.js";
import { listField, parseFrontmatter, withFrontmatterFields } from "../core/frontmatter.js";
import { contentDigest, missingSources, sourcesDigest } from "../core/provenance.js";
import { servicePaths } from "../core/repo.js";
import { repoPath } from "./list.js";

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

export type VouchOutcome =
  | {
      ok: true;
      /** Absolute path of the spec that was stamped. */
      path: string;
      status: "verified";
      lastVerified: string;
      digest: string;
      /** Digest of the document's own body, as stamped into `content_digest`. */
      contentDigest: string;
      /** The `sources` entries, as written in the frontmatter. */
      sources: string[];
      /** How many files those entries expanded to. */
      files: number;
    }
  | { ok: false; code: Extract<ErrorCode, "unknown-target" | "sources-absent" | "sources-path-missing">; message: string };

export function registerVouch(program: Command): void {
  program
    .command("vouch")
    .description("Vouch for a service's living spec: stamp it verified against the code it describes")
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

      if (json) {
        emitJson({
          service,
          path: repoPath(config.docsDir, outcome.path),
          status: outcome.status,
          last_verified: outcome.lastVerified,
          sources: outcome.sources,
          sources_digest: outcome.digest,
          content_digest: outcome.contentDigest,
          files: outcome.files,
        });
        return;
      }
      console.log(`${service} vouched — ${repoPath(config.docsDir, outcome.path)}\n`);
      console.log(`  status          ${outcome.status}`);
      console.log(`  last_verified   ${outcome.lastVerified}`);
      console.log(
        `  sources_digest  ${outcome.digest}  (${plural(outcome.files, "file")} from ${plural(outcome.sources.length, "source")})`,
      );
      console.log(`  content_digest  ${outcome.contentDigest}`);
      console.log(
        `\n\`loam validate\` will now say when that code moves out from under the spec — or when the spec moves under its own stamp.`,
      );
    });
}

/**
 * Stamp `status`, `last_verified`, `sources_digest` and `content_digest` into
 * a service's living spec, leaving the body byte-identical.
 *
 * Nothing is written unless all four can be stamped truthfully — a half-stamp
 * (verified, but with no digest behind it) is exactly the claim this command
 * exists to stop being possible. The two digests are the two halves of one
 * promise: `sources_digest` pins the code that was read, `content_digest` pins
 * the words it was read against, so `loam validate` can see either side move.
 */
export async function vouch(req: VouchRequest): Promise<VouchOutcome> {
  const path = servicePaths(req.docsDir, req.service).spec;
  if (!existsSync(path)) {
    return {
      ok: false,
      code: "unknown-target",
      message: `No living spec at ${path}. Run \`loam adopt\` for '${req.service}' first.`,
    };
  }

  const raw = await readFile(path, "utf8");
  const sources = listField(parseFrontmatter(raw), "sources");
  if (sources.length === 0) {
    return {
      ok: false,
      code: "sources-absent",
      message: `${req.service}: spec.md names no sources — there is nothing to vouch it against. Add \`sources:\` naming the code it was written from.`,
    };
  }

  const missing = missingSources(req.repoDir, sources);
  if (missing.length > 0) {
    return {
      ok: false,
      code: "sources-path-missing",
      message: `${req.service}: ${missing.length} source(s) do not exist — ${missing.join(", ")}. Vouching now would stamp a claim about code that is not there.`,
    };
  }

  const { digest, files } = await sourcesDigest(req.repoDir, sources);
  if (files.length === 0) {
    // A pattern anchored at a real directory that matches no file: the paths
    // "resolve", but a digest over nothing never changes, so the stamp would
    // read as current forever.
    return {
      ok: false,
      code: "sources-absent",
      message: `${req.service}: the sources listed match no files — ${sources.join(", ")}. A digest over nothing would read as current forever.`,
    };
  }

  // Two passes on purpose: `content_digest` hashes the body BELOW the
  // frontmatter, and withFrontmatterFields promises that body byte-identical —
  // so hashing after the first stamp and writing the hash in a second one
  // yields a digest that is true of the file exactly as written. A re-vouch
  // takes the same road and refreshes every field, this one included.
  const stamped = withFrontmatterFields(raw, {
    status: "verified",
    last_verified: req.today,
    sources_digest: digest,
  });
  const bodyDigest = contentDigest(stamped);
  await writeFile(path, withFrontmatterFields(stamped, { content_digest: bodyDigest }), "utf8");
  return {
    ok: true,
    path,
    status: "verified",
    lastVerified: req.today,
    digest,
    contentDigest: bodyDigest,
    sources,
    files: files.length,
  };
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
