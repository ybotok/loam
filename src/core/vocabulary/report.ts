/**
 * The validation report — what `loam validate` produces before anything is
 * printed.
 *
 * Checks build findings; renderers turn them into a human view or into the JSON
 * contract. Keeping the two apart is what makes `--all` and `--json` possible
 * without a second implementation of every check, and it is why a finding
 * carries a stable `code`: prose is for people, codes are for callers.
 */

export type Severity = "ok" | "warn" | "error";

/**
 * The glyph each severity is printed with. Five sites had written it out
 * themselves — four as a two-armed ternary that spelled `error` and let
 * everything else fall to ⚠ — and a reader who learns the marks from one
 * command's output has to be able to read them in the next. It lives beside
 * `Severity` because it is a fact about the union, not about any one renderer;
 * `TextHint.marker` above already describes it as "the ✓/⚠/✗ marker".
 */
export const SEVERITY_MARK: Record<Severity, string> = { ok: "✓", warn: "⚠", error: "✗" };

/** How the text renderer should lay a finding out. The JSON contract ignores this. */
export interface TextHint {
  /** Leading spaces. Default 0. */
  indent?: number;
  /** Print the ✓/⚠/✗ marker. Default true. */
  marker?: boolean;
  /** Block header printed once, before the first finding that carries it. */
  header?: string;
  /** Prefix for each detail line (e.g. "- " for a list of names). */
  detailPrefix?: string;
}

export interface FindingLocation {
  /** Portable path relative to the docs repo whenever the finding is about one. */
  path: string;
  /** `primary` is exact; `scope` is the smallest directory the check can prove. */
  role: "primary" | "related" | "scope";
  line?: number;
  column?: number;
  /** A stable structural address when a line is not available. */
  pointer?: string;
}

export interface Finding {
  severity: Severity;
  /** Stable machine identifier — prose may change, this may not. */
  code: string;
  message: string;
  /**
   * What the finding is about, when that is narrower than the target: the
   * service a feature's per-service check ran on, say. Without it a caller
   * would have to read the service name back out of the message.
   */
  subject?: string;
  details?: string[];
  locations?: FindingLocation[];
  /**
   * Coherence findings only: whether `loam archive` refuses on this issue
   * without `--approve` (issue.ts explains why severity alone cannot say).
   * Absent on findings that never face the archive gate.
   */
  gates?: boolean;
  text?: TextHint;
}

export interface TargetReport {
  /**
   * What was validated. `landscape` is the fleet itself — the checks that need
   * every service and every element in view at once, so they belong to no single
   * service and only run under `--all`.
   */
  kind: "service" | "feature" | "landscape";
  id: string;
  /** The exact repo-relative scope this target was read from. */
  path?: string;
  findings: Finding[];
}

/** A target is valid when nothing in it is an error. Warnings never gate. */
export function targetValid(target: TargetReport): boolean {
  return !target.findings.some((f) => f.severity === "error");
}

export function reportValid(targets: TargetReport[]): boolean {
  return targets.every(targetValid);
}

export function countSeverity(targets: TargetReport[], severity: Severity): number {
  return targets.reduce((n, t) => n + t.findings.filter((f) => f.severity === severity).length, 0);
}

/**
 * DISTINCT subjects carrying a finding with `code`, across the whole report.
 *
 * By SUBJECT, not by finding, and that is the rule every rollup derived from
 * findings must share: one service can raise the same code from two documents
 * — each document has its own list and its own answer — but it is one service,
 * and a count of findings sends the reader looking for services that do not
 * exist. A finding that names no subject is about its target, so the target id
 * is the fallback key.
 */
export function subjectsWith(targets: TargetReport[], code: string): number {
  return new Set(
    targets.flatMap((t) =>
      t.findings.filter((f) => f.code === code).map((f) => f.subject ?? t.id),
    ),
  ).size;
}

export function findingJson(f: Finding, fallback?: FindingLocation): Record<string, unknown> {
  return {
    severity: f.severity,
    code: f.code,
    ...(f.subject === undefined ? {} : { subject: f.subject }),
    ...(f.gates === undefined ? {} : { gates: f.gates }),
    message: f.message,
    details: f.details ?? [],
    locations: f.locations ?? (fallback === undefined ? [] : [fallback]),
  };
}

function targetScope(t: TargetReport): FindingLocation {
  const path =
    t.path ??
    (t.kind === "service"
      ? `services/${t.id}`
      : t.kind === "feature"
        ? "features"
        : "architecture/landscape.likec4");
  return {
    path,
    role: t.kind === "landscape" ? "primary" : "scope",
    ...(t.kind === "feature" && t.path === undefined ? { pointer: t.id } : {}),
  };
}

export function targetJson(t: TargetReport): Record<string, unknown> {
  return {
    kind: t.kind,
    id: t.id,
    ...(t.path === undefined ? {} : { path: t.path }),
    valid: targetValid(t),
    findings: t.findings.map((finding) => findingJson(finding, targetScope(t))),
  };
}
