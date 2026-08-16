/**
 * What a requirement document owes, checked the same way wherever it lives.
 *
 * The same `### Requirement:` grammar is authored in four places — a service's
 * spec.md and arch.spec.md, and a feature's per-service deltas of both — and
 * every breach below carries from a delta into the living document through the
 * archive merge. So the checks are one set called from both target kinds
 * (`service/` and `feature/`): grading a delta more leniently than the file it
 * is about to become is how a defect acquires a signature saying it was
 * reviewed.
 *
 * None of these read the filesystem and none of them print — they take parsed
 * requirements and answer in findings.
 */
import { type Finding } from "../../../core/vocabulary/report.js";
import { requirementsMissingScenarios } from "../../../core/document/scenarios.js";
import { requirementIdProblems, type Requirement } from "../../../core/document/spec.js";
import {
  coversCandidates,
  entryResolves,
  parseCoversEntry,
  type CoverageScope,
  type CoversEntry,
} from "../../../core/c4/arch.js";

/** The parsed Covers entries of every requirement that will live (REMOVED covers nothing). */
export function coversEntries(reqs: Requirement[]): CoversEntry[] {
  return reqs.filter((r) => r.kind !== "REMOVED").flatMap((r) => r.covers.map(parseCoversEntry));
}

/**
 * `spec.duplicate-requirement` — two `### Requirement:` blocks with one name in
 * one LIVING document. Nothing else catches it, and the merge algebra
 * (applyRequirementDelta) matches by name and edits only the FIRST match: a
 * later archive rewrites one copy and the other survives as a stale snapshot
 * of whatever the requirement used to say. Per file on purpose — spec.md and
 * arch.spec.md are separate requirement namespaces (their merges never cross
 * files), so one name appearing in both is legal and unflagged.
 */
export function duplicateRequirementFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  const counts = new Map<string, number>();
  for (const r of reqs) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n > 1)
    .map(([name, n]) => ({
      severity: "error" as const,
      code: "spec.duplicate-requirement",
      subject,
      message: `${where}: requirement '${name}' is defined ${n} times — a merge edits only the first, every other copy lives on stale; keep exactly one`,
    }));
}

/** Stable IDs are optional, but once authored they must select exactly one requirement. */
export function requirementIdFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  return requirementIdProblems(reqs).map((problem) => {
    if (problem.kind === "invalid") {
      return {
        severity: "error" as const,
        code: "spec.requirement-id-invalid",
        subject,
        message: `${where}: requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}' — use 1-128 characters matching [A-Za-z][A-Za-z0-9._-]*`,
      };
    }
    if (problem.kind === "repeated") {
      return {
        severity: "error" as const,
        code: "spec.requirement-id-repeated",
        subject,
        message: `${where}: requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times — identity must be declared exactly once`,
      };
    }
    return {
      severity: "error" as const,
      code: "spec.requirement-id-duplicate",
      subject,
      message: `${where}: Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")} — one ID may identify only one requirement`,
    };
  });
}

/**
 * The two list lines of the requirement grammar, exactly as core/document/spec.ts spells
 * them (mirrored here, not exported from there, because the parser's grammar is
 * its own; a drift shows up as this check counting differently than the parser
 * assigns). A SECOND matching line in one requirement body REPLACES the first —
 * assignment, not append, the documented keep-last quirk — so the author's
 * "long list in two lines" pattern silently loses its first line.
 */
const OPERATIONS_LINE_RE = /^\s*Operations?:\s*(.+?)\s*$/i;
const COVERS_LINE_RE = /^\s*Covers?:\s*(.+?)\s*$/i;

/**
 * `spec.repeated-operations` / `spec.repeated-covers` — warn on the silent
 * loss, keep the keep-last semantics (changing them would re-read every spec
 * in the fleet). Scenario bodies never count: the parser only assigns from the
 * requirement's own body lines, and `Requirement.text` is exactly those.
 * REMOVED requirements are exempt the way coversEntries exempts them — content
 * on its way out obliges nothing.
 */
export function repeatedListLineFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  const out: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const { re, label, code } of [
      { re: OPERATIONS_LINE_RE, label: "Operations:", code: "spec.repeated-operations" },
      { re: COVERS_LINE_RE, label: "Covers:", code: "spec.repeated-covers" },
    ]) {
      const n = r.text.filter((line) => re.test(line)).length;
      if (n < 2) continue;
      out.push({
        severity: "warn",
        code,
        subject,
        message: `${where}: requirement '${r.name}' has ${n} '${label}' lines — the last REPLACES the others (assignment, not append), the earlier list is silently lost; merge them into one comma-separated line`,
      });
    }
  }
  return out;
}

/**
 * `covers.unknown` — the typo guard on the Covers: line. Warn, not error: the
 * axis is advisory end to end, and a wrong id already costs its author the
 * coverage they wrote the line for. The hint offers only real ids (closeIds's
 * rule), and says where resolution looked when there is nothing close.
 * `healthUnreadable` mutes the alert:/sli: forms only: against a health.yaml
 * nobody could read, "did you mean" is a false diagnosis of a typo —
 * health.invalid (emitted by the service target) is the honest one.
 */
/** Which document is being graded, and under whose name the finding is filed. */
export interface CoverageTarget {
  where: string;
  subject: string;
}

export function coversUnknownFindings(
  reqs: Requirement[],
  target: CoverageTarget,
  scope: CoverageScope,
  healthUnreadable = false,
): Finding[] {
  const { where, subject } = target;
  const out: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const raw of r.covers) {
      const entry = parseCoversEntry(raw);
      if (healthUnreadable && (entry.form === "alert" || entry.form === "sli")) continue;
      if (entryResolves(entry, scope)) continue;
      const close = coversCandidates(entry, scope);
      out.push({
        severity: "warn",
        code: "covers.unknown",
        subject,
        message:
          `${where}: requirement '${r.name}' — Covers: '${raw}' resolves to nothing` +
          (close.length > 0
            ? `. Did you mean: ${close.join(", ")}?`
            : " in the model, the landscape or health.yaml"),
      });
    }
  }
  return out;
}

export function coverageFinding(label: string, reqs: Requirement[]): Finding {
  const missing = requirementsMissingScenarios(reqs);
  if (missing.length === 0) {
    return {
      severity: "ok",
      code: "requirements.covered",
      message: `${label} covered (${reqs.length} requirement${reqs.length === 1 ? "" : "s"}, all with scenarios)`,
    };
  }
  return {
    severity: "error",
    code: "requirements.missing-scenarios",
    message: `${label}: ${missing.length} requirement(s) without a scenario`,
    details: missing.map((r) => r.name),
    text: { detailPrefix: "- " },
  };
}
