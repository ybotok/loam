/**
 * Does this spec still describe the code it points at?
 *
 * One spec, read against the sources it declares. It answers only about what it
 * could check, and says which sources it skipped — a vouch over a spec whose
 * sources could not be read would be the claim this command exists to prevent.
 */
import { existsSync } from "node:fs";
import { listField, parseFrontmatter } from "../../../core/document/frontmatter.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { PathableService } from "../../../core/kernel/ids/service.js";
import { missingSources, patternSources, unsafeSources } from "../../../core/provenance/sources.js";
import { emptySourcesMessage, sourcesDigest, type SourceIndexEntry } from "../../../core/provenance/stamp.js";
import type { SkippedSource } from "../../../core/provenance/walk.js";
import { SPEC_AXES } from "../../../core/repo/paths.js";
import { locateServicePaths } from "../../../core/repo/service-target.js";
import { NotUtf8Error, readUtf8 } from "../../../core/staging/writes.js";

/** A spec-axis file whose sources all check out, carrying what the stamp needs. */
export interface VerifiedSpec {
  ok: true;
  path: string;
  file: string;
  /** The file exactly as read — what the stamp is applied to. */
  raw: string;
  sources: string[];
  digest: string;
  /** The pre-normalisation recipe's digest — read against an old stamp, never written (`SourcesDigest`). */
  rawDigest: string;
  /** Per-file shas, in digest order — what `sources_files` is stamped from. */
  index: SourceIndexEntry[];
  skipped: SkippedSource[];
}

/**
 * The two facts the vetting reads — not the whole VouchRequest, because the
 * reading pack (`../pack/pack.ts`) asks the same questions with no date or
 * identity to offer: a pack stamps nothing.
 */
export interface SpecVetting {
  service: PathableService;
  repoDir: string;
}

/**
 * The refusal half, spelled here rather than imported from `../contract.ts`:
 * this module is a LEAF two sibling consumers share — `run.ts` (the stamp) and
 * `pack/pack.ts` (the worklist) — which is why it lives in its own package,
 * and an import from the vouch package above it would close the exact
 * package-graph cycle the move exists to avoid. The codes are a subset of
 * VouchOutcome's refusal codes, so run.ts returns one of these unchanged.
 */
export interface SpecRefusal {
  ok: false;
  code: "sources-absent" | "sources-path-missing" | "repository-unavailable";
  message: string;
}

/**
 * "There is no living spec here", in one sentence.
 *
 * Three callers reach this state independently — the stamp (`../run.ts`), the
 * reading list (`../sample/plan.ts`), both now through `verifyAxes` below, and
 * the reading pack (`../pack/pack.ts`) — and two of them carried a comment
 * promising to keep the wording identical to the third, which is a promise
 * nothing could enforce. It lives in the leaf all three already import,
 * because the failure this repo has actually shipped is four copies of an
 * enumeration `catch` that looked identical for years while a fix landed in
 * one of them: a `--sample` run refusing a missing spec with older advice than
 * a bare run gives is the same defect, one flag wide.
 */
export function noLivingSpecMessage(specPath: string, service: string): string {
  return `No living spec at ${specPath}. Run \`loam adopt\` for '${service}' first.`;
}

/** Every spec-axis file of one service, verified: spec.md always, arch.spec.md when it exists. */
export interface VerifiedAxes {
  ok: true;
  spec: VerifiedSpec;
  arch: VerifiedSpec | null;
}

/** The walk's refusals: one file's vetting, or no spec.md to vet at all. */
export type AxesRefusal = SpecRefusal | { ok: false; code: "unknown-target"; message: string };

/**
 * The axis walk the stamp (`../run.ts`) and the reading list
 * (`../sample/plan.ts`) both make, spelled once: spec.md is required,
 * arch.spec.md rides when it exists, and one file that cannot be verified
 * refuses the walk before the next is read — so a stamp writes nothing and a
 * person is asked to read nothing.
 *
 * Walked by name rather than accumulated in a loop, because every caller
 * needs to know WHICH file it is holding — the required one or the optional
 * one — and a loop can only say that positionally. Sequential, not
 * Promise.all: each verification hashes a whole source tree through the
 * batched digest, and two of those in flight at once doubles the file
 * descriptors that batching exists to bound. Two files.
 */
export async function verifyAxes(req: SpecVetting & { docsDir: DocsDir }): Promise<VerifiedAxes | AxesRefusal> {
  const paths = await locateServicePaths(req.docsDir, req.service);
  if (!existsSync(paths.spec)) {
    return { ok: false, code: "unknown-target", message: noLivingSpecMessage(paths.spec, req.service) };
  }
  const [specAxis, archAxis] = SPEC_AXES;
  const spec = await verifySpec(req, paths[specAxis.key], specAxis.file);
  if (!spec.ok) return spec;
  if (!existsSync(paths[archAxis.key])) return { ok: true, spec, arch: null };
  const arch = await verifySpec(req, paths[archAxis.key], archAxis.file);
  return arch.ok ? { ok: true, spec, arch } : arch;
}

/**
 * The per-file half of the refusal discipline: everything vouch cannot verify
 * about ONE spec file, checked the same way for spec.md and arch.spec.md.
 */
export async function verifySpec(
  req: SpecVetting,
  path: string,
  file: string,
): Promise<VerifiedSpec | SpecRefusal> {
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

  const { digest, rawDigest, index, skipped } = await sourcesDigest(req.repoDir, sources);
  if (index.length === 0) {
    // A directory that exists but holds no files — or only ones the walk leaves
    // out: dot-entries, `node_modules`, anything the repository itself ignores.
    // The paths "resolve", but a digest over nothing never changes, so the stamp
    // would read as current forever. The sentence comes from provenance/stamp.ts so
    // that `loam validate` can grade the same state in the same words instead of
    // going green on a document this command refuses.
    return { ok: false, code: "sources-absent", message: emptySourcesMessage(label, sources) };
  }
  return { ok: true, path, file, raw, sources, digest, rawDigest, index, skipped };
}
