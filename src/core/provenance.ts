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
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  listField,
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
  const fm = await readFrontmatter(path);
  const findings = identityFindings(fm, {
    label: `${service}: spec.md`,
    idField: "service",
    idValue: service,
    statuses: [...SERVICE_STATUSES],
  });
  // With no frontmatter at all, "it names no sources" says nothing the missing
  // header did not already say.
  if (fm.present) findings.push(...sourceFindings(fm, `${service}: spec.md`, opts.repoDir));
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

function sourceFindings(fm: Frontmatter, label: string, repoDir: string | undefined): Finding[] {
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

  const missing = sources.filter((s) => !sourceExists(repoDir, s));
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
  return [
    {
      severity: "ok",
      code: "sources.resolved",
      message: `${label}: ${sources.length} source(s) resolve`,
    },
  ];
}

/**
 * Does a `sources` entry point at something real?
 *
 * A literal path is checked exactly. A glob is checked down to its deepest
 * non-glob ancestor: `src/main/**\/*.java` passes when `src/main` exists. That
 * catches the failure that actually happens — code moved or deleted wholesale —
 * without shipping a glob engine. A glob whose leaf pattern matches nothing is
 * not caught; that needs the staleness work.
 */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  if (isAbsolute(cleaned)) return existsSync(cleaned);

  const glob = cleaned.search(/[*?[]/);
  if (glob === -1) return existsSync(resolve(repoDir, cleaned));

  let prefix = cleaned.slice(0, glob);
  // Back up to the last complete path segment before the wildcard.
  prefix = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
  const anchor = prefix.length === 0 ? repoDir : resolve(repoDir, prefix);
  return existsSync(anchor) && existsSync(dirname(anchor));
}
