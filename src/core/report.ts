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

export function findingJson(f: Finding): Record<string, unknown> {
  return {
    severity: f.severity,
    code: f.code,
    ...(f.subject === undefined ? {} : { subject: f.subject }),
    ...(f.gates === undefined ? {} : { gates: f.gates }),
    message: f.message,
    details: f.details ?? [],
  };
}

export function targetJson(t: TargetReport): Record<string, unknown> {
  return {
    kind: t.kind,
    id: t.id,
    valid: targetValid(t),
    findings: t.findings.map(findingJson),
  };
}
