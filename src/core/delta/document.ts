/**
 * What a requirements document says about ITSELF — graded before anything is
 * compared against another document.
 *
 * Both the delta and the living spec come through here, because the failures are
 * the same class: a heading that nearly matches the delta grammar, an identity
 * declared twice or shared by two requirements, a `Based-On:` nobody can
 * evaluate. Settling them first is what lets `./select.ts` assume the two
 * documents are at least internally answerable — a pin the document pass already
 * refused must not also be reported stale, which would send its author to
 * `loam rebase` for a problem rebase does not fix.
 */
import { relative } from "node:path";
import { type Issue } from "../vocabulary/issue.js";
import { sectionHeadings } from "../document/parse.js";
import {
  basedOnDeclarations,
  KIND_RE,
  REQUIREMENT_DIGEST_LENGTH,
  REQUIREMENT_DIGEST_RE,
  requirementIdProblems,
  type Requirement,
} from "../document/spec.js";
import { type DeltaScope, type LivingIndex } from "./scope.js";

/**
 * `## <word> Requirement(s)` — the shape an author reaches for. Anything matching
 * this but not the real grammar is a near miss: `## ADDED Requirement` (singular),
 * `## NEW Requirements`, `## ADDED Requirements:`. A bare `## Requirements` is not
 * a near miss — quoting the living state inside a delta is legal.
 */
const NEAR_SECTION_RE = /^##\s+[A-Za-z]+\s+Requirements?\s*:?\s*$/i;

/**
 * OpenSpec's fourth delta operation. NEAR_SECTION_RE already catches it, but the
 * generic advice would mislead: a RENAMED body is FROM/TO backtick bullets, not
 * `### Requirement:` headings, so it parses to zero requirements and even the
 * whole-file check below has nothing to count — the heading is the only place to
 * stop it. Rename semantics stay unimplemented (the corpus never uses them); the
 * error says what to write instead.
 */
const RENAMED_SECTION_RE = /^##\s+RENAMED\s+Requirements?\s*:?\s*$/i;

// The one non-delta heading whose requirements are SUPPOSED not to merge — a
// delta quoting the living state for context — is `## Requirements`, matched by
// the shared isRequirementsHeading (spec.ts): the same definition that fixes
// archive's rewrite boundary, so "legal to quote" and "where the merge writes"
// cannot drift apart. Every other heading — `## Behavior`, `## Error Handling`,
// `## Notes` — leaves its requirements as BASE, which the merge skips, so the
// author wrote a change that will never land.

/** Everything wrong with the DELTA document on its own terms. */
export function deltaDocumentIssues(scope: DeltaScope, raw: string, reqs: Requirement[]): Issue[] {
  const { docsDir, service, specPath, where } = scope;
  const issues: Issue[] = [];
  for (const heading of sectionHeadings(raw)) {
    if (KIND_RE.test(heading.text) || !NEAR_SECTION_RE.test(heading.text)) continue;
    issues.push({
      severity: "error",
      code: "delta.unknown-section",
      subject: service,
      message: RENAMED_SECTION_RE.test(heading.text)
        ? `${where}: '${heading.text}' (line ${heading.line}) is OpenSpec rename syntax, which loam does not merge — carry one stable Requirement-ID through a MODIFIED requirement, or express a legacy rename as a REMOVED requirement plus an ADDED one; otherwise the rename happens to nothing`
        : `${where}: '${heading.text}' (line ${heading.line}) is not a delta section — use '## ADDED Requirements', '## MODIFIED Requirements' or '## REMOVED Requirements', or everything under it merges as nothing`,
    });
  }

  for (const problem of requirementIdProblems(reqs)) {
    if (problem.kind === "invalid") {
      issues.push({
        severity: "error",
        code: "delta.requirement-id-invalid",
        subject: service,
        message: `${where}: requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}' — use 1-128 characters matching [A-Za-z][A-Za-z0-9._-]*`,
      });
    } else if (problem.kind === "repeated") {
      issues.push({
        severity: "error",
        code: "delta.requirement-id-repeated",
        subject: service,
        message: `${where}: requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times — identity must be declared exactly once`,
      });
    } else {
      issues.push({
        severity: "error",
        code: "delta.requirement-id-duplicate",
        subject: service,
        message: `${where}: Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")} — one ID may identify only one requirement`,
      });
    }
  }

  // The `Based-On:` pin as a DOCUMENT question, settled before anything is
  // compared against the living spec: a value that is not a digest, or two
  // of them on one requirement, is a pin nobody can evaluate — and a pin
  // that silently protects nothing is worse than no pin at all, because its
  // author believes they are covered. ADDED is refused for the same reason
  // rather than ignored: a requirement with no living version cannot have
  // been written against one, so the line is a misunderstanding today and a
  // digest-shaped lie on the day someone turns it into a MODIFIED.
  for (const r of reqs) {
    const declared = basedOnDeclarations(r);
    if (declared.length > 1) {
      issues.push({
        severity: "error",
        code: "delta.baseline-invalid",
        subject: service,
        message: `${where}: requirement '${r.name}' declares Based-On ${declared.length} times — a delta is written against exactly one living version`,
      });
      continue;
    }
    const pin = declared[0];
    if (pin === undefined) continue;
    if (!REQUIREMENT_DIGEST_RE.test(pin)) {
      issues.push({
        severity: "error",
        code: "delta.baseline-invalid",
        subject: service,
        message: `${where}: requirement '${r.name}' has invalid Based-On '${pin}' — expected ${REQUIREMENT_DIGEST_LENGTH} lowercase hex characters, as \`loam rebase\` writes them`,
      });
    } else if (r.kind === "ADDED") {
      issues.push({
        severity: "error",
        code: "delta.baseline-invalid",
        subject: service,
        message: `${where}: ADDED requirement '${r.name}' carries Based-On '${pin}', but an added requirement has no living version to be based on — drop the line, or make it MODIFIED`,
      });
    }
  }

  // The whole-file version of the near-miss check, and the one that cannot be
  // dodged: NEAR_SECTION_RE only recognizes single-word misses (`## NEW
  // Requirements`), so `## NEWLY ADDED Requirements` — or requirements under a
  // prose heading, or under no heading at all — still parses everything as BASE
  // and archive merges nothing, silently. Same failure class as the BOM incident
  // (see spec.ts). A file that MIXES delta sections with quoted BASE requirements
  // is legal authoring; a file with requirements and no delta kind anywhere is a
  // delta that would do nothing, which cannot be what its author meant.
  if (reqs.length > 0 && reqs.every((r) => r.kind === "BASE")) {
    const rel = relative(docsDir, specPath).split(/[\\/]/).join("/");
    issues.push({
      severity: "error",
      code: "delta.no-delta-sections",
      subject: service,
      message: `${service}: ${rel} contains ${reqs.length} requirement(s) but no '## ADDED|MODIFIED|REMOVED Requirements' section — this delta would merge nothing`,
    });
  }
  return issues;
}

/** Everything wrong with the LIVING document that stops a delta selecting in it. */
export function livingDocumentIssues(scope: DeltaScope, living: LivingIndex): Issue[] {
  const { service, where, livingDoc } = scope;
  const issues: Issue[] = [];
  for (const problem of requirementIdProblems(living.all)) {
    issues.push({
      severity: "error",
      code: "delta.living-requirement-id-invalid",
      subject: service,
      message:
        problem.kind === "invalid"
          ? `${where}: the ${livingDoc} requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}', so this delta cannot select it safely`
          : problem.kind === "repeated"
            ? `${where}: the ${livingDoc} requirement '${problem.requirement}' declares Requirement-ID more than once, so this delta cannot select it safely`
            : `${where}: the ${livingDoc} shares Requirement-ID '${problem.id}' across ${problem.requirements.map((name) => `'${name}'`).join(", ")}, so this delta cannot select one safely`,
    });
  }

  // Two living requirements under one heading make the delta algebra
  // disagree with itself on the SAME input: MODIFIED replaces the first
  // match (findIndex) while REMOVED deletes every match (filter). So one
  // delta edits one of the twins and leaves the other, and the next one
  // deletes both — and neither outcome is what an author reading the
  // living document could have predicted. Gating rather than advisory,
  // because there is no reading of the delta that makes the merge correct;
  // the fix is in the living document, and it is one rename.
  for (const [name, twins] of living.byName) {
    if (twins.length < 2) continue;
    issues.push({
      severity: "error",
      code: "delta.living-duplicate-requirement",
      subject: service,
      message: `${where}: the ${livingDoc} declares ${twins.length} requirements named '${name}' — MODIFIED would rewrite only the first and REMOVED would delete both, so no delta applies to it predictably. Give them distinct names (or distinct Requirement-IDs and headings) first.`,
    });
  }
  return issues;
}
