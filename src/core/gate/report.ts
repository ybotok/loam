/**
 * The gate report — what `loam gate` computes before anything is printed.
 *
 * Shapes, verdict arithmetic and the per-subject containment classifier: no
 * filesystem, no process access, no printing. The four checks build findings
 * (`./checks.ts`, `./verification.ts`), the command layer renders them, and
 * this module is what the two agree through — the same split
 * `core/vocabulary/report.ts` gives `loam validate`, whose `Finding` shape
 * the checks reuse so one breach arrives in one shape whichever command
 * reports it.
 */
import type { Finding } from "../vocabulary/report.js";
import type { Maturity } from "../vocabulary/maturity.js";
import type { VerificationState } from "../status/report.js";

/** The four checks, in report order. A closed set — the payload's `checks[].check` values. */
export const GATE_CHECKS = ["partners", "freshness", "verification", "interrupted"] as const;
export type GateCheckName = (typeof GATE_CHECKS)[number];

export interface GateCheck {
  check: GateCheckName;
  findings: Finding[];
}

/**
 * How the landscape read came out. `absent` and `invalid` are kept apart from
 * `read` because the partner set derived under either is NOT "no partners" —
 * it is "could not look", and `gate.partners-unknown` exists to keep a
 * pipeline from reading the empty list as a clean one.
 */
export type LandscapeRead = "read" | "absent" | "invalid";

/**
 * What the partner is to the gated service: a `consumer` calls into it, a
 * `provider` is called by it, `both` when the landscape draws edges in both
 * directions.
 */
export type PartnerRole = "consumer" | "provider" | "both";

export interface GatePartner {
  /** The partner's resolved service name — a directory id when one exists, the drawn name otherwise. */
  service: string;
  /**
   * The partner's rung on the adoption ladder, or null when no `services/`
   * directory answers to the name at all — the state `gate.partner-undocumented`
   * names. Null is deliberately not a fifth rung: `empty` means "exists,
   * nothing in it", and a partner nobody adopted is a different fact.
   */
  maturity: Maturity | null;
  role: PartnerRole;
  /** The joins, sorted: `operation <op>`, `message <name>`, or the untyped edge's title. */
  via: string[];
  /** The element is tagged `#external` — somebody else's system, undocumented on purpose. */
  external: boolean;
}

/**
 * One active feature touching the gated service, with the verification
 * record's own projection beside it. Every field but `id` is
 * `verificationState`'s (`core/status/verification.ts`) — never a second
 * derivation of "verified".
 */
export interface GateFeature extends VerificationState {
  id: string;
}

export interface GateReport {
  service: string;
  landscape: LandscapeRead;
  partners: GatePartner[];
  features: GateFeature[];
  checks: GateCheck[];
}

export type GateVerdict = "pass" | "fail";

/**
 * Fail iff any check carries an error-severity finding. `--strict` never moves
 * this — like validate's `valid`, the verdict means the same thing in text and
 * JSON whatever the exit code does, so two pipelines reading one repo can
 * grade the same report differently and both be telling the truth
 * (commands/validate/validate.ts documents the stance; gate copies it).
 */
export function gateVerdict(checks: readonly GateCheck[]): GateVerdict {
  return checks.some((c) => c.findings.some((f) => f.severity === "error")) ? "fail" : "pass";
}

export function gateSummary(checks: readonly GateCheck[]): { errors: number; warnings: number } {
  const of = (severity: "error" | "warn"): number =>
    checks.reduce((n, c) => n + c.findings.filter((f) => f.severity === severity).length, 0);
  return { errors: of("error"), warnings: of("warn") };
}

/**
 * Per-subject containment: one unreadable sibling degrades ONE subject's
 * answer, with its path recorded, instead of killing the report the other
 * subjects still have. The code is validate's own containment code
 * (`guarded`, commands/validate/report.ts), reused so one breach is spelled
 * one way — and it is an ERROR: an unanswerable check fails closed, because
 * "nobody could look" must be distinguishable from "nothing is wrong" in the
 * exit code as well as the payload. Anything carrying no errno and no path is
 * a real bug, and still escapes untouched (reportRepositoryUnavailable's
 * recognizer).
 */
export function unreadableSubject(kind: "service" | "feature", id: string, err: unknown): Finding {
  const e = err as NodeJS.ErrnoException;
  if (e.path === undefined && typeof e.errno !== "number") throw err;
  const reason = err instanceof Error ? err.message : String(err);
  const consequence =
    kind === "service" ? "its freshness is unknown" : "its verification state is unknown";
  return {
    severity: "error",
    code: kind === "service" ? "service.unreadable" : "feature.unreadable",
    subject: id,
    message:
      `${id}: ${e.path ?? "one of its documents"} could not be read, so ${consequence} — nobody could look, which is not the same as nothing being wrong. ${reason}` +
      // The same sentence reportRepositoryUnavailable carries, for the same
      // reason: Node reports EISDIR from read() with no path at all, so the
      // commonest malformed-docs shape arrives here nameless.
      (e.path === undefined
        ? " The failure named no path — that is how Node reports a directory sitting where a file belongs."
        : ""),
  };
}
