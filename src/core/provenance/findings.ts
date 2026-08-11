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
import { readFile } from "node:fs/promises";
import {
  parseFrontmatter,
  readFrontmatter,
  stringField,
  FEATURE_STATUSES,
  SERVICE_STATUSES,
  type Frontmatter,
} from "../document/frontmatter.js";
import type { Finding } from "../vocabulary/report.js";
import { featurePaths, servicePaths, SPEC_AXES } from "../repo/paths.js";
import { sourceFindings } from "./sources.js";
import { contentDigest } from "./stamp.js";

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
  // only the label tells a reader which file moved. The pair comes from
  // SPEC_AXES rather than being respelled, so a third axis is graded here the
  // day it is declared instead of the day somebody notices.
  for (const { path, file } of SPEC_AXES.map((axis) => ({ path: paths[axis.key], file: axis.file }))) {
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
    // header did not already say — and a malformed one proves nothing either:
    // `sources.absent` against a header nobody can read is the same false
    // advice as the field cascade, so frontmatter.malformed stands alone.
    if (fm.present && !fm.malformed) {
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

  // One honest error instead of the cascade: with an unreadable header the
  // field checks below would grade owner/status/service "missing" and send the
  // author adding fields to a block YAML refuses to parse. Nothing can be
  // concluded from a header nobody can read — including that it lacks fields.
  if (fm.malformed) {
    return [
      {
        severity: "error",
        code: "frontmatter.malformed",
        subject: spec.idValue,
        message: `${spec.label} has frontmatter that does not parse as YAML — owner, status and sources are unreadable until the header is fixed`,
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
