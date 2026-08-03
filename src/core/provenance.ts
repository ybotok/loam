/**
 * Provenance checks: is this artifact anchored to anything, and has anyone
 * vouched for it?
 *
 * SCHEMA.md has declared `status` / `owner` / `sources` / `last_verified` since
 * the beginning and nothing read them. They matter more now that the prose is
 * written by an agent: coherence proves the corpus agrees with itself, and only
 * `sources` says it has anything to do with the code.
 *
 * Absence and contradiction are graded differently on purpose. A missing field
 * is incompleteness — a warning, something to work through. A field that says
 * the wrong thing (a spec claiming to be another service, a status nobody
 * defined) is a bug, and gates.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  listField,
  parseFrontmatter,
  rawBody,
  readFrontmatter,
  stringField,
  FEATURE_STATUSES,
  SERVICE_STATUSES,
  type Frontmatter,
} from "./frontmatter.js";
import type { Finding } from "./report.js";
import { featurePaths, servicePaths } from "./repo.js";

/** Fields every artifact is expected to carry, beyond its identity and status. */
const EXPECTED = ["owner"] as const;

export interface ProvenanceOptions {
  /**
   * The repo `sources` resolve against — the service repo loam is running in.
   * Undefined when the docs being validated describe some other repository, in
   * which case the paths are not ours to resolve and are left alone.
   */
  repoDir?: string;
}

export async function serviceProvenance(
  docsDir: string,
  service: string,
  opts: ProvenanceOptions = {},
): Promise<Finding[]> {
  const paths = servicePaths(docsDir, service);
  const findings: Finding[] = [];
  // Both requirement-carrying specs get the same pass: arch.spec.md follows
  // spec.md's frontmatter conventions exactly, so the checks are one loop —
  // only the label tells a reader which file moved.
  for (const { path, file } of [
    { path: paths.spec, file: "spec.md" },
    { path: paths.archSpec, file: "arch.spec.md" },
  ]) {
    if (!existsSync(path)) continue;
    const raw = await readFile(path, "utf8");
    const fm = parseFrontmatter(raw);
    const label = `${service}: ${file}`;
    findings.push(
      ...identityFindings(fm, {
        label,
        idField: "service",
        idValue: service,
        statuses: [...SERVICE_STATUSES],
      }),
    );
    // With no frontmatter at all, "it names no sources" says nothing the missing
    // header did not already say.
    if (fm.present) {
      findings.push(...(await sourceFindings(fm, service, label, opts.repoDir)));
      findings.push(...contentFindings(fm, raw, service, label));
    }
  }
  return findings;
}

export async function featureProvenance(
  featureDir: string,
  featureId: string,
): Promise<Finding[]> {
  const path = featurePaths(featureDir).intent;
  if (!existsSync(path)) return [];
  const fm = await readFrontmatter(path);
  return identityFindings(fm, {
    label: "intent.md",
    idField: "feature",
    idValue: featureId,
    statuses: [...FEATURE_STATUSES],
  });
}

interface IdentitySpec {
  label: string;
  idField: "service" | "feature";
  idValue: string;
  statuses: string[];
}

function identityFindings(fm: Frontmatter, spec: IdentitySpec): Finding[] {
  const findings: Finding[] = [];
  if (!fm.present) {
    return [
      {
        severity: "warn",
        code: "frontmatter.missing",
        subject: spec.idValue,
        message: `${spec.label} has no frontmatter — no owner, no status, no link to the code it describes`,
      },
    ];
  }

  const id = stringField(fm, spec.idField);
  if (id !== undefined && id !== spec.idValue) {
    findings.push({
      severity: "error",
      code: "frontmatter.field-mismatch",
      subject: spec.idValue,
      message: `${spec.label} declares ${spec.idField}: ${id}, but it lives under ${spec.idValue}`,
    });
  }

  const status = stringField(fm, "status");
  if (status !== undefined && !spec.statuses.includes(status)) {
    findings.push({
      severity: "error",
      code: "frontmatter.status-unknown",
      subject: spec.idValue,
      message: `${spec.label} has status '${status}' — expected one of ${spec.statuses.join(", ")}`,
    });
  }

  const missing = [
    ...(id === undefined ? [spec.idField] : []),
    ...(status === undefined ? ["status"] : []),
    ...EXPECTED.filter((f) => stringField(fm, f) === undefined),
  ];
  if (missing.length > 0) {
    findings.push({
      severity: "warn",
      code: "frontmatter.field-missing",
      subject: spec.idValue,
      message: `${spec.label} is missing ${missing.length} frontmatter field(s)`,
      details: missing,
      text: { detailPrefix: "- " },
    });
  }
  return findings;
}

async function sourceFindings(
  fm: Frontmatter,
  service: string,
  label: string,
  repoDir: string | undefined,
): Promise<Finding[]> {
  const sources = listField(fm, "sources");
  if (sources.length === 0) {
    return [
      {
        severity: "warn",
        code: "sources.absent",
        message: `${label} names no sources — nothing ties it to the code, so nothing can tell you when it goes out of date`,
      },
    ];
  }
  // Someone else's repository: the paths describe a tree loam is not standing in.
  if (repoDir === undefined) return [];

  // Before existence: a pattern entry would "not exist" as a literal path, and
  // grading it missing would send the author fixing the wrong thing.
  const patterns = patternSources(sources);
  if (patterns.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${patterns.length} source(s) are glob patterns — ${patterns.join(", ")}. Patterns are no longer supported: name files or directories (a directory already covers everything beneath it).`,
        details: patterns,
        text: { detailPrefix: "- " },
      },
    ];
  }

  const missing = missingSources(repoDir, sources);
  if (missing.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${missing.length} source(s) do not exist — ${missing.join(", ")}`,
        details: missing,
        text: { detailPrefix: "- " },
      },
    ];
  }
  const resolved: Finding = {
    severity: "ok",
    code: "sources.resolved",
    message: `${label}: ${sources.length} source(s) resolve`,
  };

  // The paths are there; the question staleness answers is whether what is AT
  // them is still what somebody read.
  const stamped = stringField(fm, "sources_digest");
  if (stamped === undefined) {
    return [
      resolved,
      {
        severity: "warn",
        code: "sources.unvouched",
        message: `${label}: no sources_digest — nobody has vouched for this against the code, so nothing can tell you when it goes stale. Run \`loam vouch --service ${service}\`.`,
      },
    ];
  }

  const since = stringField(fm, "last_verified") ?? "it was stamped";
  const { digest, files } = await sourcesDigest(repoDir, sources);
  if (digest === stamped) {
    return [
      resolved,
      {
        severity: "ok",
        code: "sources.current",
        message: `${label}: sources unchanged since ${since} (${files.length} file(s), digest ${digest})`,
      },
    ];
  }
  return [
    resolved,
    {
      // A warning, not an error: the doc may still be right, and only a person
      // can say. What loam knows is that nobody has looked since the code moved.
      severity: "warn",
      code: "sources.stale",
      message: `${label}: sources changed since ${since} — re-read them and \`loam vouch --service ${service}\``,
      details: sources,
      text: { detailPrefix: "- " },
    },
  ];
}

/**
 * The doc-side half of the freshness check. `sources_digest` says whether the
 * CODE moved since a person looked, and only that service's repo can recompute
 * it; `content_digest` says whether the DOCUMENT did, and needs nothing but
 * the document — so this runs wherever the spec is readable, `--service` and
 * `--all` alike. Without it, editing a spec after it was vouched left
 * `status: verified` standing over words nobody read — forged freshness, in
 * the exact agent-written-prose threat model this layer exists for.
 */
function contentFindings(fm: Frontmatter, raw: string, service: string, label: string): Finding[] {
  if (stringField(fm, "status") !== "verified") return [];
  const stamped = stringField(fm, "content_digest");
  // A verified doc with no stamp predates the field. Quiet on purpose: the fix
  // is re-vouching, and grading years of pre-feature vouches as suspect would
  // drown the fleet in warnings nobody chose.
  if (stamped === undefined) return [];
  if (contentDigest(raw) === stamped) return [];
  const since = stringField(fm, "last_verified") ?? "it was vouched";
  return [
    {
      // A warning, not an error — the sources.stale doctrine: the doc changed
      // since it was vouched, and only a person can say whether verified still
      // holds of the new words.
      severity: "warn",
      code: "content.stale",
      message: `${label} changed since ${since} — the doc moved under its vouch, and only a person can say whether 'verified' still holds. Re-read it and \`loam vouch --service ${service}\`.`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The content digest                                                  */
/* ------------------------------------------------------------------ */

/** How much of the sha256 is written into the document. */
const DIGEST_LENGTH = 16;

export interface SourcesDigest {
  /** The stamp that goes in `sources_digest`. */
  digest: string;
  /** Repo-relative paths, sorted — exactly what went into it. */
  files: string[];
}

/**
 * Digest the CONTENT of the files `sources` names. The recipe is spelled out
 * because the value is written into documents, and anything reading them has to
 * be able to reproduce it:
 *
 *   1. expand each entry to repo-relative file paths (`/` separators) — a file
 *      is itself, a directory everything beneath it — sorted and de-duplicated;
 *   2. per file, `sha256(bytes)`;
 *   3. feed `<path>\0<hex>\n` for each file, in that order, into an outer
 *      sha256;
 *   4. keep the first 16 hex characters.
 *
 * Content, not mtime: git does not preserve modification times, so after a
 * fresh clone every file looks changed and the check would be false positives
 * end to end. Bytes survive the clone. Hashing the path alongside the content
 * means a rename registers, which is what a reader of the doc would want.
 *
 * 64 bits is a change detector, not a seal — it answers "did this move?", and
 * an adversary who wants a collision can have one.
 */
export async function sourcesDigest(repoDir: string, sources: string[]): Promise<SourcesDigest> {
  const files = await expandSources(repoDir, sources);
  const outer = createHash("sha256");
  for (const file of files) {
    const content = createHash("sha256").update(await readFile(file.abs)).digest("hex");
    outer.update(`${file.rel}\0${content}\n`);
  }
  return { digest: outer.digest("hex").slice(0, DIGEST_LENGTH), files: files.map((f) => f.rel) };
}

/**
 * The stamp `loam vouch` writes into `content_digest`: sha256 of the
 * document's own BODY — every byte after the frontmatter block (below the
 * closing `---` line and its newline; `rawBody` is the one definition of that
 * cut) — first 16 hex characters, the sources recipe's length.
 *
 * Byte-exact, no normalization. Body-only is load-bearing: vouch itself
 * rewrites the frontmatter as it stamps, and a later frontmatter-only edit
 * (another vouch, a corrected owner) must not read as the document moving.
 */
export function contentDigest(source: string): string {
  return createHash("sha256").update(rawBody(source), "utf8").digest("hex").slice(0, DIGEST_LENGTH);
}

interface SourceFile {
  /** Repo-relative, `/`-separated — the spelling that goes into the hash. */
  rel: string;
  abs: string;
}

/**
 * The files a `sources` list names: a file is itself, a directory is everything
 * beneath it. Nothing else — glob patterns used to be matched here, by a
 * hand-rolled dialect that silently differed from the gitignore/minimatch
 * conventions authors assume, so a pattern quietly digested a DIFFERENT file
 * set than its author intended. Pattern-looking entries are now refused loudly
 * upstream (see patternSources); this function only ever sees literal paths.
 *
 * Dot-entries are skipped while walking — `.git` is not what the doc was
 * written from — though a path naming one outright is still honoured. Both
 * rules are part of the digest recipe's contract: for literal paths the
 * expansion is byte-identical to what it was when globs existed.
 */
async function expandSources(repoDir: string, sources: string[]): Promise<SourceFile[]> {
  const found = new Map<string, string>();
  const relOf = (abs: string): string => relative(repoDir, abs).split(sep).join("/");

  for (const source of sources) {
    const cleaned = source.trim();
    if (cleaned.length === 0) continue;
    const root = isAbsolute(cleaned) ? cleaned : resolve(repoDir, cleaned);
    for (const abs of await filesUnder(root)) found.set(relOf(abs), abs);
  }

  // Plain codepoint order, not locale order: the digest has to be the same
  // everywhere it is computed.
  return [...found.entries()]
    .map(([rel, abs]) => ({ rel, abs }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Every file at or beneath `path`; nothing, if it does not exist. */
async function filesUnder(path: string): Promise<string[]> {
  const info = await stat(path).catch(() => null);
  if (info === null) return [];
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];

  const out: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(child)));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

/** The characters that made an entry a pattern under the glob dialect loam no longer ships. */
const PATTERN_CHARS = /[*?[]/;

/**
 * The `sources` entries that look like glob patterns — anything containing
 * `*`, `?` or `[`. Patterns are refused loudly everywhere sources are consumed
 * (`loam vouch` refuses the run, `loam validate` grades an error), never
 * resolved: the glob dialect loam used to ship silently differed from the
 * gitignore/minimatch conventions authors assume — bracket classes literal,
 * its own `**` handling — so a pattern quietly digested a different file set
 * than intended, corrupting the staleness signal in both directions. A
 * directory already means "everything beneath it", so the fix is to name one.
 *
 * The cost accepted with the rule: a real file with `[` in its name (a Next.js
 * route, say) cannot be listed on its own — its parent directory covers it.
 */
export function patternSources(sources: string[]): string[] {
  return sources.filter((s) => PATTERN_CHARS.test(s.trim()));
}

/** The `sources` entries that resolve to nothing in this repo. */
export function missingSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((s) => !sourceExists(repoDir, s));
}

/** Does a `sources` entry point at something real? Literal paths only, checked exactly. */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  return existsSync(isAbsolute(cleaned) ? cleaned : resolve(repoDir, cleaned));
}
