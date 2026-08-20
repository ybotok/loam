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
  closeIds,
  coversCandidates,
  entryResolves,
  parseCoversEntry,
  type CoverageScope,
  type CoversEntry,
} from "../../../core/c4/arch.js";
import { type Vocabulary } from "../../../core/permissions/permissions.js";
import { type Operation } from "../../../core/openapi/doc.js";

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
            : " in the model, the landscape, the fleet's journeys or health.yaml"),
      });
    }
  }
  return out;
}

/**
 * `permissions.unknown` — the typo guard on the `Requires:` line, and an ERROR
 * where its `Covers:` sibling is a warning.
 *
 * The two differ because what they promise differs. `Covers:` is advisory end
 * to end: a wrong id costs its author the coverage they wrote the line for and
 * nothing else. `Requires:` names authorization the service actually enforces,
 * and the failure it guards is the one an unaided reader cannot see — an
 * invented permission reads exactly like a real one, in the requirement, in the
 * generated scenario, and in the test somebody then writes against it. Its
 * grade is `Operations:`', not `Covers:`'.
 *
 * Silent on ONE case only: an unreadable vocabulary, where
 * `permissions.invalid` is the honest finding and grading every entry against a
 * file nobody could parse is the false cascade `healthUnreadable` exists to
 * stop one axis over. A MISSING vocabulary is not that case — the `Requires:`
 * line is itself the opt-in, and a line that resolves against nothing while
 * reading like a join is the failure this whole axis exists to prevent.
 */
export function requiresUnknownFindings(
  reqs: Requirement[],
  target: CoverageTarget,
  vocabulary: Vocabulary,
): Finding[] {
  const { where, subject } = target;
  if (vocabulary.invalid !== undefined) return [];
  const known = [...vocabulary.byId.keys()];
  const out: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const raw of r.requires) {
      if (vocabulary.byId.has(raw)) continue;
      const close = closeIds(raw, known);
      out.push({
        severity: "error",
        code: "permissions.unknown",
        subject,
        message:
          `${where}: requirement '${r.name}' — Requires: '${raw}' is not declared in architecture/permissions.yaml` +
          (!vocabulary.present
            ? ", which does not exist. The `Requires:` line is the opt-in: create the fleet vocabulary with this permission under its subject kind, or drop the line"
            : close.length > 0
              ? `. Did you mean: ${close.join(", ")}?`
              : ". Entries are '<subject>/<permission>'; declare it there, or fix the spelling"),
      });
    }
  }
  return out;
}

/**
 * `api.response-ungoverned` — a declared 4xx/5xx response no scenario reaches.
 *
 * The gap this closes is the one a whole adoption can fall into: `api.ungoverned`
 * grades OPERATIONS against requirements, so an endpoint with one happy-path
 * requirement and twelve declared failure codes is fully governed by every
 * check loam had. The refusals are where a service's decision layer surfaces —
 * a permission denied, a field combination rejected, a state that forbids the
 * transition — and the contract is the only artifact in the corpus that already
 * enumerates them.
 *
 * A scenario "reaches" a code when the code appears as a standalone number
 * anywhere in its body, `Examples` rows included — which is why this arrived
 * with outline support and not before: a status column is exactly where a
 * matrix puts its codes, and before it those rows were prose in a description.
 * The match is textual and therefore generous by design. It answers "did
 * anybody write this case down", not "is this scenario correct", and the
 * failure it is built to catch is the code nobody mentioned at all. Warn, like
 * its sibling: a service may legitimately declare a code its scenarios describe
 * in words, and an error would teach authors to paste numbers into prose.
 *
 * Operations no requirement governs are skipped: `api.ungoverned` already
 * names those, and reporting each of their codes as well is one defect
 * counted twice.
 */
export function responseGovernanceFindings(
  service: string,
  ops: Operation[],
  livingReqs: Requirement[],
): Finding[] {
  const ungoverned: string[] = [];
  for (const op of ops) {
    if (op.failureCodes.length === 0) continue;
    const governing = livingReqs.filter((r) => r.kind !== "REMOVED" && r.operations.includes(op.id));
    if (governing.length === 0) continue;
    const body = governing.flatMap((r) => r.scenarios.flatMap((s) => s.lines)).join("\n");
    const missing = op.failureCodes.filter((code) => !new RegExp(`(?<!\\d)${code}(?!\\d)`).test(body));
    if (missing.length > 0) ungoverned.push(`${op.id}: ${missing.join(", ")}`);
  }
  if (ungoverned.length === 0) return [];
  return [
    {
      severity: "warn",
      code: "api.response-ungoverned",
      subject: service,
      message: `${service}: ${ungoverned.length} operation(s) declare a failure response no scenario reaches — write the refusal as a scenario, or as a row in one`,
      details: ungoverned,
    },
  ];
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
