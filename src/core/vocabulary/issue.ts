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

/**
 * Whether `--approve` can move this issue when it gates. A third axis beside
 * severity and gating: severity answers "is the DOCUMENT valid", gating
 * answers "is the MERGE safe", and this one answers whose call the refusal is
 * — a human's or the grammar's. Almost every gating issue is a judgment about
 * the feature, which is exactly the judgment `--approve` exists to override;
 * `c4.service-binding-invalid` is not: the binding IS the path the merge
 * would write, so no approval changes what would happen, and the fix is the
 * name, never the flag. `archive` refuses these under the same `not-coherent`
 * envelope and spells this verdict per issue as the additive `overridable`
 * key, so a `--json` consumer branches on data rather than on a code list.
 */
export function approveOverrides(i: Issue): boolean {
  return i.code !== "c4.service-binding-invalid";
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
  /** E2's lifecycle shadow — a NEW tagged edge consumes an operation the living provider contract marks `deprecated: true`; advisory, never a gate */
  | "c4-api.op-deprecated"
  /** a NEW tagged edge consumes an operation this same feature removes */
  | "c4-api.op-removing"
  /** an operation-removal marker addresses no living path+method */
  | "openapi.remove-target-missing"
  /** an operation-removal marker's id differs from the living operation at that path+method */
  | "openapi.remove-target-mismatch"
  /** a REMOVED requirement governs an operation but the feature has no matching removal marker */
  | "openapi.remove-marker-missing"
  /** an operation-removal marker is not justified by a REMOVED requirement */
  | "openapi.remove-marker-unjustified"
  /** W1 — an operation is called but no requirement governs it */
  | "c4.op-ungoverned"
  /** W2 — the feature adds an operation no architecture edge consumes */
  | "api.op-unconsumed"
  /** W3 — a new service arrives with no requirement delta */
  | "service.no-requirement-delta"
  /** W4 — a "Calls" edge carries no operation link */
  | "c4.op-link-missing"
  /** an explicit `metadata { service }` binding — a tagged element's, or one riding anywhere inside its authored block — breaks the service-id grammar; the merge would splice the name into the living landscape verbatim, and probe services/<id>/ with it; never overridable, the path is a mechanical fact */
  | "c4.service-binding-invalid"
  /* --- delta shape: does the diff apply to the living spec it claims to change? --- */
  /** a heading that nearly matches the delta grammar — its requirements merge as nothing */
  | "delta.unknown-section"
  /** a delta file with requirements but no delta section anywhere — the whole file would merge as nothing */
  | "delta.no-delta-sections"
  /** a requirement stranded under a prose heading — archive will not merge it */
  | "delta.requirement-not-merged"
  /** a Requirement-ID in a delta violates the stable-id grammar */
  | "delta.requirement-id-invalid"
  /** one delta requirement declares Requirement-ID more than once */
  | "delta.requirement-id-repeated"
  /** one Requirement-ID identifies multiple requirements in a delta */
  | "delta.requirement-id-duplicate"
  /** the living spec has malformed/ambiguous IDs and cannot be selected safely */
  | "delta.living-requirement-id-invalid"
  /** a delta's stable ID and heading select different living requirements */
  | "delta.requirement-identity-collision"
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
  /** the delta redefines a PATH-level key (parameters, servers, summary) the living OpenAPI already has — the overwrite applies to every operation on that path */
  | "openapi.path-item-modified"
  /** an `x-loam-remove: true` marker with no operationId — loam cannot tell which operation it retires, and the marker itself would reach the living contract */
  | "openapi.remove-marker-anonymous"
  /** an `x-loam-remove: true` written at PATH level, beside the methods — it addresses no operation, so it retires nothing and is not a contract key either */
  | "openapi.remove-marker-path-level"
  /** the living OpenAPI defines one operationId in two (path, method) slots — every join on the id picks one arbitrarily */
  | "openapi.duplicate-operationid"
  /** the FEATURE's own openapi.yaml exists but does not parse — the same name validate gives a living contract in that state: every contract-axis check for the service is suspended, and the archive plan refuses the merge mechanically */
  | "openapi.invalid"
  /** an `x-loam-based-on` that is not a digest or sits on an operation the living contract does not have; a malformed `x-loam-baselines` record, an entry of it pinning a surface the delta does not restate, or one whose living counterpart is gone */
  | "openapi.baseline-invalid"
  /** a feature operation, restated path-level key or component with no baseline pin — the merge cannot tell whether the delta EDITS it or merely quotes it */
  | "openapi.baseline-missing"
  /** the living operation, path-level key or component changed since this delta pinned it — merging would discard whoever landed in between */
  | "openapi.baseline-stale"
  /** the feature retires an operation the LIVING fleet still consumes — a landscape edge's `metadata { op }`, or another service's living requirement */
  | "openapi.remove-op-consumed"
  /** two requirements in the LIVING document share one heading — MODIFIED rewrites the first, REMOVED deletes both, so no delta applies predictably */
  | "delta.living-duplicate-requirement"
  /** another feature in flight MODIFIES/REMOVES the same living requirement — whichever archives second replaces the other's text wholesale */
  | "delta.modified-conflict"
  /** a `Based-On:` line whose value is not a digest, or declared twice — the pin cannot be compared, so it protects nothing */
  | "delta.baseline-invalid"
  /** a MODIFIED/REMOVED requirement with no `Based-On:` — nothing can tell whether the living text moved under it */
  | "delta.baseline-missing"
  /** the living requirement changed since this delta was written — merging it would silently discard whoever landed in between */
  | "delta.baseline-stale"
  /** the archive creates `services/<id>/` but nothing writes its `model.likec4` — the fleet gate will report the service incomplete */
  | "service.no-model"
  /* --- authoring: did a person actually write this? --- */
  /** a document `loam new` scaffolded still carries its exact placeholder text — the merge would publish a requirement, scenario or description nobody authored */
  | "scaffold.placeholder"
  /** intent.md is missing, or says nothing outside the scaffold's own comments — nothing states why the feature exists */
  | "intent.empty"
  /* --- docs-repo contract: --all only, never a merge question --- */
  /** AGENTS.md carries no version stamp, or one older than the running binary — the agent contract may have drifted */
  | "agents.stale";
