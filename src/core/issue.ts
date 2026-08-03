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
  /**
   * Does this issue stop `loam archive`? Severity and gating answer two
   * different questions: severity says whether the DOCUMENT is valid (`loam
   * validate` fails on errors), gating says whether the MERGE is safe. They
   * usually agree — errors gate, warnings do not — so the field is stated only
   * where they diverge: a legal document whose merge would drop authored
   * content is a warning that gates.
   */
  gates?: boolean;
}

/** Whether `loam archive` refuses on this issue without `--approve`. */
export function gatesArchive(i: Issue): boolean {
  return i.gates ?? i.severity === "error";
}

export type IssueCode =
  /* --- cross-axis: C4 <-> requirements <-> OpenAPI --- */
  /** the architecture axis could not be read at all */
  | "delta.invalid"
  /** the delta declares elements or edges but none carry the feature tag — loam cannot see any of it */
  | "delta.nothing-tagged"
  /** E1 — a requirement governs an operation its service's OpenAPI does not define */
  | "spec-api.op-undefined"
  /** E1, softened — the operation is defined by another feature still in flight; archive that one first */
  | "spec-api.op-pending"
  /** E2 — a C4 edge calls an operation the target's OpenAPI does not define */
  | "c4-api.op-undefined"
  /** E2, softened — the operation is defined by another feature still in flight; archive that one first */
  | "c4-api.op-pending"
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
  /** a delta file with requirements but no delta section anywhere — the whole file would merge as nothing */
  | "delta.no-delta-sections"
  /** a requirement stranded under a prose heading — archive will not merge it */
  | "delta.requirement-not-merged"
  /** MODIFIED a requirement the living spec does not have */
  | "delta.modified-unknown"
  /** REMOVED a requirement the living spec does not have */
  | "delta.removed-unknown"
  /** ADDED a requirement the living spec already has — the merge would replace it */
  | "delta.added-duplicate"
  /** ADDED a name that differs only in case from a living requirement — the merge matches exactly, so both would coexist */
  | "delta.added-near-duplicate"
  /** MODIFIED something another feature in flight introduces — an ordering dependency */
  | "delta.modified-pending"
  /** REMOVED something another feature in flight introduces */
  | "delta.removed-pending"
  /** two features in flight add the same requirement to the same service */
  | "delta.added-conflict"
  /* --- archive plan: breaches only the merge computation itself can see --- */
  /** a LIVING requirement outside `## Requirements` — the merge rewrites only that section, so it would land twice */
  | "living.requirement-outside-requirements"
  /** the delta redefines an operation the living OpenAPI already has — the merge overwrites it wholesale */
  | "openapi.op-modified"
  /** a component the merged operations carry already exists in the living OpenAPI with different content — the merge overwrites it wholesale */
  | "openapi.component-modified"
  /** a $ref reachable from the merged operations resolves in neither the feature's OpenAPI nor the living one — merging would write a dangling reference */
  | "openapi.ref-unresolved"
  /* --- docs-repo contract: --all only, never a merge question --- */
  /** AGENTS.md carries no version stamp, or one older than the running binary — the agent contract may have drifted */
  | "agents.stale";
