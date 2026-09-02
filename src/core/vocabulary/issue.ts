/**
 * A coherence breach: something that makes a feature unsafe to merge into the
 * living docs. Shared by every check the archive gate runs.
 */

import type { Finding, FindingLocation } from "./report.js";

export interface Issue {
  severity: "error" | "warn";
  /** Stable machine identifier for the breach — see the labels below. */
  code: IssueCode;
  /** What the breach is about when that is narrower than the feature — usually a service. */
  subject?: string;
  message: string;
  locations?: FindingLocation[];
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

/** One issue in the shared validation/status finding shape. */
export function issueFinding(i: Issue): Finding {
  return {
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    ...(i.locations === undefined ? {} : { locations: i.locations }),
    message: i.message,
  };
}

/**
 * Whether `--approve` can move this issue when it gates. A third axis beside
 * severity and gating: severity answers "is the DOCUMENT valid", gating
 * answers "is the MERGE safe", and this one answers whose call the refusal is
 * — a human's or the grammar's. Almost every gating issue is a judgment about
 * the feature, which is exactly the judgment `--approve` exists to override.
 *
 * The exceptions are the ones where approval could not change what happens.
 * `c4.service-binding-invalid`: the binding IS the path the merge would write,
 * so the fix is the name, never the flag. `glossary.term-exists`: the merge is
 * a whole-file copy over an authored definition, so approving it is approving a
 * deletion nobody described — and the alternative the message names (edit the
 * living definition in the same change) costs one `git mv` and loses nothing.
 * `usecase.flow-exists` is the same act one axis over: the merge would copy a
 * feature's flow over a living one, and an ordered hop sequence is recorded
 * nowhere else either. `usecase.flow-invalid` is the other kind of exception —
 * not a deletion but a BLINDNESS: loam could not read the feature's flows
 * against the map its own merge would leave, so it graded nothing, and
 * `--approve` overrides loam's judgment about coherence and never its ability
 * to read an axis. That is the same line `delta.likec4`'s unparseable case is
 * refused on, one merge over.
 *
 * `archive` refuses these under the same `not-coherent` envelope and spells
 * this verdict per issue as the additive `overridable` key, so a `--json`
 * consumer branches on data rather than on a code list.
 */
const NEVER_OVERRIDABLE: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "c4.service-binding-invalid",
  "glossary.term-exists",
  "usecase.flow-exists",
  "deployment.doc-exists",
  "usecase.flow-invalid",
]);

export function approveOverrides(i: Issue): boolean {
  return !NEVER_OVERRIDABLE.has(i.code);
}

/**
 * The three grades a CAPABILITY DOCUMENT earns on its own terms, named as a
 * union of their own because both corpora emit them and the two must stay one
 * list: `validate --all` grades the living `capabilities/<id>/spec.md` and
 * files them as Findings, while the archive gate grades a feature's
 * `features/<FEAT>/capabilities/<id>/spec.md` and files the SAME three as
 * archive-gating Issues.
 *
 * Grading the delta is not belt-and-braces. Without it, a capability
 * requirement with no `Requirement-ID:` — or one carrying `Operations:`, the
 * service-altitude line the whole corpus exists to keep out — merges into the
 * living tree and only THEN earns its error, against a document whoever reads
 * the finding did not write. The feature-local delta must not become a second
 * way to write service requirements, and this is the rule that stops it.
 *
 * No code is added to the product here: all three already shipped, are already
 * emitted from `core/capabilities/findings.ts` with literal `code:` values, and
 * are already documented in the `/loam-check` table. What the union member adds
 * is the compiler's permission to file the same finding at the archive gate.
 */
export type CapabilityDocCode =
  /** a requirement in a capability document with no `Requirement-ID:` — identity by heading, which every join to it breaks on */
  | "capability.requirement-unidentified"
  /** a capability requirement carrying `Operations:`/`Covers:`/`Publishes:`/`Consumes:` — a service requirement filed at the wrong altitude */
  | "capability.requirement-service-scoped"
  /** a capability requirement carrying `Capability:` or `Realizes:` — the axis's own joins, which point into the tree and so do nothing written inside it */
  | "capability.requirement-inert-join";

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
  /* --- the event axis: C4 <-> requirements <-> AsyncAPI, joined on the message name --- */
  /** the FEATURE's own asyncapi.yaml exists but does not parse — the same name validate gives a living contract in that state: every event-axis check for the service is suspended */
  | "asyncapi.invalid"
  /** an `x-loam-based-on` that is not a digest or one on a slot the living contract does not have; a malformed `x-loam-baselines` record, an entry of it naming a component surface the delta does not declare, or one whose living counterpart is gone */
  | "asyncapi.baseline-invalid"
  /** a feature slot or component surface with no baseline pin — the merge cannot tell whether the delta EDITS it or merely quotes it; warn that gates, counted per service */
  | "asyncapi.baseline-missing"
  /** the living slot or component surface changed since this delta pinned it — merging would discard whoever landed in between */
  | "asyncapi.baseline-stale"
  /** a slot-removal marker addresses a (section, key) the living contract does not have */
  | "asyncapi.remove-target-missing"
  /** a message-removal marker's name differs from the living declaration at that key */
  | "asyncapi.remove-target-mismatch"
  /** a REMOVED requirement's Publishes:/Consumes: line names a message the living contract still declares, with no matching removal marker in the feature */
  | "asyncapi.remove-marker-missing"
  /** a message-removal marker no REMOVED requirement's Publishes:/Consumes: line justifies — message slots only; channel and operation slots need exactness alone */
  | "asyncapi.remove-marker-unjustified"
  /** the feature retires a message the LIVING fleet still consumes — a landscape consumes-edge, or another service's living requirement */
  | "asyncapi.remove-message-consumed"
  /** another feature in flight adds or edits the same (service, message) — whichever archives second replaces the other's declaration wholesale */
  | "asyncapi.message-conflict"
  /** internal `$ref`(s) resolving to nothing — validate's warn on a living contract; a gating plan issue at archive when the MERGED document would carry the dangling reference */
  | "asyncapi.ref-unresolved"
  /** a tagged edge publishes/consumes a message its bound service's contract — as the feature's merge would leave it, feature ∪ living where no delta exists — declares no matching send/receive operation for */
  | "c4-event.message-undefined"
  /** softened — the message is introduced by another feature still in flight; archive that one first */
  | "c4-event.message-pending"
  /** a delta requirement's Publishes:/Consumes: line names a message the service's contract — as the feature's merge would leave it, so a retired declaration stops answering — does not declare in that direction; validate's living-side code, graded in feature scope too */
  | "spec-event.message-undefined"
  /** softened — the named message is introduced by another feature still in flight */
  | "spec-event.message-pending"
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
  /** a component the merge carries — reached by a merged operation, or declared by a delta whose whole change is components — already exists in the living OpenAPI with different content, and the merge overwrites it wholesale */
  | "openapi.component-modified"
  /** a $ref reachable from the merged operations or a merged component resolves in neither the feature's OpenAPI nor the living one — merging would write a dangling reference */
  | "openapi.ref-unresolved"
  /** the delta redefines a PATH-level key (parameters, servers, summary) the living OpenAPI already has — the overwrite applies to every operation on that path */
  | "openapi.path-item-modified"
  /** the delta redefines a `components.messages` slot the living AsyncAPI already has — the merge overwrites the living message wholesale */
  | "asyncapi.message-modified"
  /** the delta redefines a `channels` slot the living AsyncAPI already has — the merge overwrites it wholesale, inline channel messages included */
  | "asyncapi.channel-modified"
  /** the delta redefines an `operations` slot the living AsyncAPI already has — the merge overwrites it wholesale */
  | "asyncapi.operation-modified"
  /** the delta declares a component SURFACE outside `components.messages` — a schema, a security scheme — that the living AsyncAPI already has with different content, and the merge copies the feature's version over it wholesale */
  | "asyncapi.component-modified"
  /** an `x-loam-remove: true` marker with no operationId — loam cannot tell which operation it retires, and the marker itself would reach the living contract */
  | "openapi.remove-marker-anonymous"
  /** an `x-loam-remove: true` written at PATH level, beside the methods — it addresses no operation, so it retires nothing and is not a contract key either */
  | "openapi.remove-marker-path-level"
  /** an `x-loam-remove: true` nested on an INLINE channel message — inline messages are channel interior, never slots, so it retires nothing; when the channel is otherwise unchanged the marker surfaces nowhere else at all */
  | "asyncapi.remove-marker-inline"
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
  /* --- capability axis: the Capability: join against architecture/capabilities.yaml --- */
  /** a delta requirement's `Capability:` entry that the fleet vocabulary does not declare — the merge would land a join that resolves to nothing, so it blocks archive like other errors, and `--approve` overrides it */
  | "capability.unknown"
  /** a delta requirement's `Realizes:` entry that names no capability requirement — same argument as `capability.unknown` one join over: the merge would land a pointer at a promise that does not exist, looking exactly like a working one */
  | "capability.realizes-unknown"
  /** a capability requirement this feature ADDS that no `Realizes:` line in the same feature's service deltas names — the merge would land a business promise nothing in this change keeps. A warning that GATES, `--approve` overrides: the document is legal (writing ahead of the fleet is the intended use, which is why `capability.requirement-unrealized` warns and never gates), the MERGE is what is unsafe. Joined by `Realizes:`, NOT by `Covers:` — the name is the roadmap's, the join is the other one */
  | "capability.uncovered"
  /** the same join in the removal direction — this feature RETIRES a capability requirement that something the merge leaves behind still realizes, so the archive would leave `capability.realizes-unknown` standing against a document nobody in the feature touched. An error, exactly as `openapi.remove-op-consumed` is for the identical shape one axis over */
  | "capability.remove-requirement-realized"
  | CapabilityDocCode
  /* --- the domain glossary: a term a feature introduces --- */
  /** a `features/<FEAT>/glossary/<term>.md` whose term the living glossary already defines — the merge is a whole-file copy, so it would replace an authored definition wholesale. An error with no legal reading, which is why `--approve` changes nothing about it: a feature-local glossary document INTRODUCES a term, and rewriting one belongs in a pull request where git produces the conflict */
  | "glossary.term-exists"
  /* --- the use-case axis: a flow a feature introduces --- */
  /** a `features/<FEAT>/usecases/*.likec4` that could not be read against the map this feature's own merge would leave behind — a parse error, an unresolved element, or a landscape merge that itself refuses. The flows were not graded, and archiving would copy them into `architecture/` for the next reader's `loam validate --all` to fail on. Mechanical rather than a judgement, which is why `--approve` does not move it */
  | "usecase.flow-invalid"
  /** a `features/<FEAT>/usecases/<name>.likec4` whose flow the living `architecture/` already holds — the merge is a whole-file copy, so it would replace an authored hop sequence wholesale. An error with no legal reading, which is why `--approve` changes nothing about it: a feature-local flow INTRODUCES a use case, and rewriting one belongs in a pull request where git produces the conflict */
  | "usecase.flow-exists"
  /* --- the deployment axis: the topology a feature introduces --- */
  /** a `features/<FEAT>/deployment/<name>.likec4` whose file the living `architecture/` already holds — the merge is a whole-file copy, so it would replace an authored topology wholesale. An error with no legal reading, which is why `--approve` changes nothing about it: a feature-local deployment document INTRODUCES topology, and rewriting one belongs in a pull request where git produces the conflict. The same act, and the same severity, as `usecase.flow-exists` one axis over */
  | "deployment.doc-exists"
  /* --- authoring: did a person actually write this? --- */
  /** a document `loam new` scaffolded still carries its exact placeholder text — the merge would publish a requirement, scenario or description nobody authored */
  | "scaffold.placeholder"
  /** intent.md is missing, or says nothing outside the scaffold's own comments — nothing states why the feature exists */
  | "intent.empty"
  /* --- docs-repo contract: --all only, never a merge question --- */
  /** AGENTS.md carries no version stamp, or one older than the running binary — the agent contract may have drifted */
  | "agents.stale";
