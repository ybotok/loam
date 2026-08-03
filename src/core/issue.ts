/**
 * A coherence breach: something that makes a feature unsafe to merge into the
 * living docs. Shared by every check the archive gate runs.
 */

export interface Issue {
  severity: "error" | "warn";
  /** Stable machine identifier for the breach — see the labels below. */
  code: IssueCode;
  /** What the breach is about when that is narrower than the feature — usually a service. */
  subject?: string;
  message: string;
}

export type IssueCode =
  /* --- cross-axis: C4 <-> requirements <-> OpenAPI --- */
  /** the architecture axis could not be read at all */
  | "delta.invalid"
  /** E1 — a requirement governs an operation its service's OpenAPI does not define */
  | "spec-api.op-undefined"
  /** E2 — a C4 edge calls an operation the target's OpenAPI does not define */
  | "c4-api.op-undefined"
  /** W1 — an operation is called but no requirement governs it */
  | "c4.op-ungoverned"
  /** W2 — the feature adds an operation no architecture edge consumes */
  | "api.op-unconsumed"
  /** W3 — a new service arrives with no requirement delta */
  | "service.no-requirement-delta"
  /** W4 — a "Calls" edge carries no operation link */
  | "c4.op-link-missing"
  /* --- delta shape: does the diff apply to the living spec it claims to change? --- */
  /** a heading that nearly matches the delta grammar — its requirements merge as nothing */
  | "delta.unknown-section"
  /** a requirement stranded under a prose heading — archive will not merge it */
  | "delta.requirement-not-merged"
  /** MODIFIED a requirement the living spec does not have */
  | "delta.modified-unknown"
  /** REMOVED a requirement the living spec does not have */
  | "delta.removed-unknown"
  /** ADDED a requirement the living spec already has — the merge would replace it */
  | "delta.added-duplicate"
  /** MODIFIED something another feature in flight introduces — an ordering dependency */
  | "delta.modified-pending"
  /** REMOVED something another feature in flight introduces */
  | "delta.removed-pending"
  /** two features in flight add the same requirement to the same service */
  | "delta.added-conflict";
