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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  const path = servicePaths(docsDir, service).spec;
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const fm = parseFrontmatter(raw);
  const findings = identityFindings(fm, {
    label: `${service}: spec.md`,
    idField: "service",
    idValue: service,
    statuses: [...SERVICE_STATUSES],
  });
  // With no frontmatter at all, "it names no sources" says nothing the missing
  // header did not already say.
  if (fm.present) {
    findings.push(...(await sourceFindings(fm, service, opts.repoDir)));
    findings.push(...contentFindings(fm, raw, service));
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
  repoDir: string | undefined,
): Promise<Finding[]> {
  const label = `${service}: spec.md`;
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
function contentFindings(fm: Frontmatter, raw: string, service: string): Finding[] {
  const label = `${service}: spec.md`;
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
 *   1. expand each entry to repo-relative file paths (`/` separators), sorted
 *      and de-duplicated;
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
 * The files a `sources` list names: a literal path is itself, a directory is
 * everything beneath it, and a glob is matched against the tree under its
 * deepest wildcard-free ancestor.
 *
 * Dot-entries are skipped while walking — `.git` is not what the doc was
 * written from — though a path naming one outright is still honoured. Only
 * `*`, `**` and `?` are patterns; a bracket class is matched literally.
 */
async function expandSources(repoDir: string, sources: string[]): Promise<SourceFile[]> {
  const found = new Map<string, string>();
  const relOf = (abs: string): string => relative(repoDir, abs).split(sep).join("/");

  for (const source of sources) {
    const cleaned = source.trim();
    if (cleaned.length === 0) continue;
    const wildcard = cleaned.search(GLOB_CHAR);

    if (wildcard === -1) {
      const root = isAbsolute(cleaned) ? cleaned : resolve(repoDir, cleaned);
      for (const abs of await filesUnder(root)) found.set(relOf(abs), abs);
      continue;
    }

    // Walk from the deepest directory the pattern is anchored to, then keep what
    // the pattern actually matches — an absolute pattern against absolute paths,
    // a repo-relative one against repo-relative paths.
    const prefix = globPrefix(cleaned, wildcard);
    const anchor = prefix.length === 0 ? repoDir : resolve(repoDir, prefix);
    const pattern = globToRegExp(cleaned);
    for (const abs of await filesUnder(anchor)) {
      if (pattern.test(isAbsolute(cleaned) ? abs : relOf(abs))) found.set(relOf(abs), abs);
    }
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

const GLOB_CHAR = /[*?[]/;

/** The wildcard-free directory prefix of a pattern: `src/main/**\/*.java` -> `src/main`. */
function globPrefix(pattern: string, wildcard: number): string {
  const head = pattern.slice(0, wildcard);
  return head.includes("/") ? head.slice(0, head.lastIndexOf("/")) : "";
}

/** `src/main/**\/*.java` -> `/^src\/main\/(?:[^/]+\/)*[^/]*\.java$/`. */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "?") {
      out += "[^/]";
    } else if (c !== "*") {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (pattern[i + 1] !== "*") {
      out += "[^/]*";
    } else if (pattern[i + 2] === "/") {
      // `**/` spans any number of directory levels, including none.
      out += "(?:[^/]+/)*";
      i += 2;
    } else {
      out += ".*";
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/** The `sources` entries that resolve to nothing in this repo. */
export function missingSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((s) => !sourceExists(repoDir, s));
}

/**
 * Does a `sources` entry point at something real?
 *
 * A literal path is checked exactly. A glob is checked down to its deepest
 * non-glob ancestor: `src/main/**\/*.java` passes when `src/main` exists. That
 * catches the failure that actually happens — code moved or deleted wholesale —
 * without shipping a glob engine. A glob whose leaf pattern matches nothing
 * still passes here; `loam vouch` is where that is caught, by refusing to stamp
 * a digest over an empty file set.
 */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  if (isAbsolute(cleaned)) return existsSync(cleaned);

  const glob = cleaned.search(GLOB_CHAR);
  if (glob === -1) return existsSync(resolve(repoDir, cleaned));

  const prefix = globPrefix(cleaned, glob);
  const anchor = prefix.length === 0 ? repoDir : resolve(repoDir, prefix);
  return existsSync(anchor) && existsSync(dirname(anchor));
}
