/**
 * The artifacts of the adoption brief: what each file under `services/<svc>/`
 * is for, the grammar it has to be written in, and a minimal valid example
 * where showing one is shorter than describing it. Every `shape` rule here is
 * one a later check depends on, and test/agent-contract.test.ts pins the
 * mapping. This module is the list alone — `serviceBrief` (brief.ts) resolves
 * it against a docs repo, and the fleet map's own target, whose block names
 * the service, is assembled per service in map/owed.ts.
 */

/* ------------------------------------------------------------------ */
/* The artifacts                                                       */
/* ------------------------------------------------------------------ */

export interface BriefTarget {
  /** File name as it appears under `services/<svc>/`. */
  artifact: string;
  /** Repo-relative path to write. */
  path: string;
  exists: boolean;
  /**
   * `create` a missing artifact; `diff` an existing one — never overwrite it.
   *
   * `edit` is the third case and belongs to exactly one target: the fleet map.
   * `architecture/landscape.likec4` is a SHARED document that already holds
   * every other service, so "diff it and report what disagrees" is the wrong
   * instruction — the file is not this service's baseline, it is the fleet's,
   * and what this service owes it is an addition inside the existing
   * `model { … }` block. Spelling that as `diff` taught agents to leave the
   * fleet map alone; spelling it as `create` would have taught them to
   * overwrite ten other services.
   */
  action: "create" | "diff" | "edit";
  /**
   * False for artifacts a baseline can legitimately ship without. True means
   * required for a COMPLETE baseline — validate grades a missing spec.md or
   * openapi.yaml as a warn (`service.no-spec` / `service.no-openapi`), not an
   * error: partial adoption is a supported state, and the warns are the
   * progress meter.
   *
   * Constant per artifact except one: `openapi.yaml` is required only where the
   * fleet map shows an API is expected (see `apiExpected` in brief.ts), because
   * the brief is read as an instruction and "MISSING openapi.yaml" told an agent
   * to write a contract for a service that serves no requests.
   */
  required: boolean;
  /** What the artifact is for, in one line. */
  purpose: string;
  /** The grammar. Every rule here is one a later check depends on. */
  shape: string[];
  /** A minimal valid instance, where showing one is shorter than describing it. */
  example?: string;
}

/** Where an artifact lives — `repo/paths.ts` spells the filenames, this only points at them. */
type PathKey = "model" | "spec" | "archSpec" | "openapi" | "asyncapi" | "adrsDir" | "runbook" | "health";

/** The artifacts, in the order a baseline is best written in. */
export const ARTIFACTS: Array<Omit<BriefTarget, "path" | "exists" | "action"> & { key: PathKey }> = [
  {
    artifact: "model.likec4",
    key: "model",
    required: true,
    purpose: "the service's C4 — what it is, what is inside it, what it talks to",
    // Every rule below is one a later check depends on, and the mapping is
    // pinned in test/agent-contract.test.ts. Rules nobody checks — the `views`
    // block, "exactly one top-level element" — used to sit here reading exactly
    // like the enforced ones, which is how a brief teaches an agent that
    // `loam validate` passing means more than it does. They now live in
    // UNCHECKED, where their status is the point.
    shape: [
      "No `specification` block of its own: the kinds and tags come from `architecture/landscape.likec4` (a kind this model needs that the map does not declare — `element database`, `element queue` — is added there, once). A model that declares its own element kinds is the standalone shape: it still parses, alone, and loam then reports where its copies of the map's elements diverge (`c4.declaration-diverged`). New models never use it.",
      "A `model { ... }` block whose body is `extend <id> { ... }` — the fully-qualified id of the element the fleet map already binds to this directory (the landscape section of this brief names it; write the element into the map first when none resolves) — with containers and components nested inside. The binding and the description live on the map's element; this file may add `#tags` and metadata to it and never a description. The whole file has to parse: `loam validate` runs LikeC4 in-process over the map plus this file and reports `c4.invalid` with line numbers.",
      "A store or component this service OWNS goes INSIDE the `extend <fqn> { }` block, where its id becomes `<fqn>.<name>`: that is the only place an extending model may declare an element, and one declared anywhere else is `c4.element-unowned` (warn) — the fleet project then carries this service's private copy of somebody else's box. A call to another system is an edge from the container that makes it to the other party's element as the map spells it — `marketplace.paymentService.api -> stripe 'Authorizes cards'` — never a copy of that element: the map declares a system this service merely REACHES once, and another service's internals belong in that service's own model. The map still carries the service-level edge the fleet checks read (`metadata { op '<operationId>' }` graded by `spine.op-undefined`); draw it there too.",
      "The map's element is the binding: `metadata { service '<id>' }` on the element you extend (the landscape target below). Without it the element's title has to equal the directory name — and then renaming the box silently unlinks every check that joined the two. Until something in the map resolves to `services/<id>/`, `loam validate --all` reports `landscape.service-unmodelled` and there is no element for this file to extend.",
    ],
    // `<fqn>` and `<svc>` are PLACEHOLDERS this module leaves literal:
    // `serviceBrief` (brief.ts) substitutes the landscape element's real id and
    // the service being adopted, and for `<fqn>` the "the element's id in
    // architecture/landscape.likec4" wording where the map holds none. ARTIFACTS
    // stays a static constant — a target list that varied per repository would
    // be a second thing to keep true. The header carried the literal
    // `payment-service` for every service, beside an `extend` line that WAS
    // substituted, so the half of the example that was personalised taught an
    // agent the other half had been too.
    example: `// <svc>'s own C4 — what is INSIDE the element the fleet map binds to
// this directory. The map declares the kinds and the element; this
// file extends it and re-declares nothing.
model {
  extend <fqn> {
    api = container 'HTTP API'
    ledger = database 'Ledger store'
    api -> ledger 'Writes every authorization'
  }
  // 'stripe' stands for the OTHER party, spelled as the fleet map already
  // declares it — loam has no id to substitute here, and inventing one is
  // the edge that makes the model unresolvable. The containers above are
  // this example's own: name yours after what they are.
  <fqn>.api -> stripe 'Authorizes cards'
}

// Views are LikeC4's, not loam's (docs/DESIGN.md rule 26). Render with
// 'npx likec4 start' from the docs repo root: this file is part of the root
// project, beside the map — nothing else to write.
views {
  view of <fqn> {
    include *
  }
}
`,
  },
  {
    artifact: "spec.md",
    key: "spec",
    required: true,
    purpose: "the living requirements — what this service is required to do, as it stands today",
    shape: [
      "Frontmatter (below), then a `## Requirements` heading.",
      "`### Requirement: <name>` — ONE observable behaviour, written with SHALL, testable without reading the code. Add `Requirement-ID: <id>` in its body for stable identity across heading renames; legacy requirements without one continue to match by exact name.",
      "At least one `#### Scenario: <name>` per requirement, with Given/When/Then bullets. This is gated (`requirements.missing-scenarios`) — scenarios are the acceptance criteria and the source for tests.",
      "A markdown TABLE in a scenario body becomes the `Examples` of a `Scenario Outline`: the header names the placeholders the steps use (`<permission>`), one row per case. This is how a matrix is written — a permission matrix, a validation matrix, a status-code table is ONE scenario with twenty rows, never twenty scenarios. `loam gherkin` emits the outline, cucumber reports one result per row carrying that scenario's digest tag, and `loam verify --results` confirms the claim only when EVERY row passed. Every row must have the header's column count and a header needs at least one row: a table loam cannot read stays in the description, the scenario then runs once instead of once per case, and the emission says so out loud.",
      "A step takes an ARGUMENT by carrying it INDENTED under the bullet, and this is what lets one scenario assert a whole data pass rather than a sentence. An indented table becomes that step's Gherkin DATA TABLE — `- **Then** the outbox holds:` followed by the rows it must hold; a fenced block becomes its DOCSTRING, indentation intact — `- **When** the caller posts:` followed by the JSON body. Indentation is the entire disambiguation: indented under a step means this step's rows, at the margin means the scenario's cases, and both ride into the scenario digest. Write the ASSERTIONS OUT, one bullet each, including the negative ones (`no row is created in ...`, `... is not invoked`) and each meter separately: a scenario that summarises them reads complete, emits valid Gherkin, grades green, and tests a fraction of what it claims.",
      "`Requires: <subject>/<permission>[, ...]` in the requirement body names the authorization it is gated on, resolved against the FLEET vocabulary in `architecture/permissions.yaml`. An entry that is not declared there is `permissions.unknown` (error) — the same grade as `Operations:`, because an invented permission reads exactly like a real one everywhere downstream. Add the permission to that file when this service enforces one nobody has written down yet; the subject is the entity it is checked ON (`user`, `profile`, `service`), which is not always the caller.",
      "`Capability: <id>[, ...]` in the requirement body names the fleet capabilities this requirement realizes part of, declared in `architecture/capabilities.yaml`. A LIST, because the relation is many-to-many: one requirement commonly closes part of two capabilities. The FILE is this axis's opt-in — a fleet without it gets no capability findings — and once it exists an undeclared name is `capability.unknown` (error). Write the line only where the requirement genuinely carries part of the named capability.",
      "Write the requirement body in EARS form — `WHEN <trigger> THE SYSTEM SHALL <response>`, `IF <precondition> THEN THE SYSTEM SHALL <response>`, `WHERE <feature is included> THE SYSTEM SHALL <response>`, or a bare `THE SYSTEM SHALL <response>` when it is unconditional. **Nothing checks this** — it is a writing convention, and it is here because the grammar forces the trigger and the response to be named separately, while free prose lets a requirement read as complete while stating no condition at all. That is the exact shape a guard collapses into when it is summarised rather than enumerated.",
      "`Operations: <operationId>[, <operationId>]` in the requirement body names the API operations it governs. Every one must exist in this service's openapi.yaml — a name that does not is `spec-api.op-undefined` (error), reported against the LIVING spec, not only inside a feature delta.",
      "Document what the service DOES today, not what it should do. This is the baseline; changes to it belong in a feature delta.",
    ],
    example: `---
service: payment-service
status: draft
owner: payments-team
sources:
  - src/main/java/com/shop/payment/
---

# payment-service

## Requirements

### Requirement: Authorize a payment
WHEN authorization is requested for a captured-eligible order THE SYSTEM SHALL
authorize it against the issuer before any capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card and an amount within its limit
- **When** authorization is requested
- **Then** the payment is authorized and an authorization id is returned

### Requirement: Refunding is permission-gated
IF the caller lacks the refund permission THEN THE SYSTEM SHALL refuse the
request and leave the payment untouched.

Operations: refundPayment

#### Scenario: Refund by permission
- **Given** a captured payment
- **When** a caller holding <permission> requests a refund
- **Then** the response is <status> and the payment is <state>

| permission      | status | state    |
|-----------------|--------|----------|
| payments:refund | 200    | refunded |
| payments:read   | 403    | captured |
| (none)          | 401    | captured |
`,
  },
  {
    artifact: "arch.spec.md",
    key: "archSpec",
    required: false,
    purpose:
      "the living architecture requirements — the obligations the business spec never carries: outbox, retries, idempotency, metrics, alerts",
    shape: [
      "Same grammar and frontmatter as spec.md: `## Requirements`, `### Requirement:` + `#### Scenario:` with Given/When/Then. The same checks read it.",
      "A `Covers:` line per requirement names what its scenarios exercise: a C4 element id (`paymentService.db`), an edge (`paymentService -> kafka`), or a health signal from health.yaml (`alert:<id>` / `sli:<id>`). Every entry must resolve, or `covers.unknown` (warn) flags the typo.",
      "A requirement whose `Covers:` names containers may have its hop sequence drawn as a `dynamic view` in a `.likec4` beside model.likec4 (`usecases/<name>.likec4` by convention; the renderer's per-service project reads every `.likec4` under the directory, and loam reads the same set), tagged `#req-<Requirement-ID>` — with the tag declared in `architecture/landscape.likec4`'s `specification` where the model extends the map, or in model.likec4's own block where it declares one; declaring it in BOTH is a duplicate, and the code lands where the second declaration's FILE is, not at fleet altitude: `c4.invalid` (an ERROR, and the model's grading is suspended behind it) when the tags-only block is in model.likec4, `usecase.flow-invalid` when it is in a sibling. `c4.fleet-project-invalid` is the fleet-scope class one step out — TWO SERVICES each declaring the same tag locally, which no per-service project sees. Graded by `loam validate --service <id>` (`usecase.step-unbacked` when a hop names a call the model does not declare, `usecase.requirement-unresolved` when the tag names no `Requirement-ID` here or in spec.md). Optional; nothing grades its absence. Never `architecture/usecases/`, which cannot resolve a container.",
      "Optional, but expected for a service with real architecture: every alert/SLI health.yaml declares wants a covering requirement here (`health.uncovered`, warn) — a signal nothing tests is dashboard decoration.",
      "Write the obligations no business requirement states — the transactional outbox, what a caller's retry may assume, what pages whom. An arch scenario becomes an integration/ops test, not an acceptance test.",
    ],
    example: `---
service: payment-service
status: draft
owner: payments-team
sources:
  - src/main/java/com/shop/payment/
---

# payment-service — architecture

## Requirements

### Requirement: Events leave through the transactional outbox
The service SHALL write a domain event and its state change in one transaction,
published by an outbox relay — never a dual write.

Covers: paymentService.db, paymentService -> kafka

#### Scenario: Broker down at commit time
- **Given** an event in the outbox
- **When** the broker is unavailable
- **Then** the state stays committed and the event is published once it returns
`,
  },
  {
    artifact: "openapi.yaml",
    key: "openapi",
    // Overridden per service in `serviceBrief` (brief.ts): an API is required
    // only where the fleet expects one. See `apiExpected` there.
    required: true,
    purpose: "the API contract — the operations this service exposes",
    shape: [
      "OpenAPI 3.x with a `paths` map.",
      "EVERY operation carries an `operationId`. That token is the spine: the C4 edge's `metadata { op }`, the requirement's `Operations:` line and this `operationId` are one name spelled three times, and they must be identical.",
      "loam reads operationIds, and probes the rest by PRESENCE only: an operation whose responses declare no schema warns (`openapi.response-undescribed`), an internal `$ref` to nothing warns (`openapi.ref-unresolved`). What a declared schema SAYS is still never checked — the schemas are for humans, codegen and review, so getting them wrong is invisible here and expensive later.",
      "Document the endpoints that exist. An operation the fleet already calls (see `landscape.expects`) must be in here, or the contract breaks the moment this lands.",
      // The instruction the brief was missing, and the one that matters most:
      // it used to mark this artifact required unconditionally, in capitals,
      // which for a UI, a worker or a cron told the agent to invent an API into
      // the source of truth. `required` is derived now; this says so in prose
      // as well, because an agent reading the shape rules must not re-derive
      // "MISSING" as "write something".
      "If this service exposes no HTTP API, there is no file to write. Do not invent one — an empty or imagined contract is a claim the whole fleet then joins against. `required` above is derived from the fleet map: it is false exactly when the landscape parses and no edge calls an operation on this service, which is the same evidence that keeps `service.no-openapi` quiet.",
    ],
  },
  {
    artifact: "asyncapi.yaml",
    key: "asyncapi",
    // Never required. Unlike the HTTP contract, whose necessity the fleet map
    // can PROVE (an op-linked edge points here), most services in a legacy fleet
    // touch no topic at all — and a required artifact nobody owes is how a
    // whole adoption wave learns to ignore the brief.
    required: false,
    purpose: "the async contract — the messages this service puts on and takes off the bus",
    shape: [
      "AsyncAPI **3.0** with `channels`, `operations` and `components.messages`. Only 3.0 is read: its operations are named top-level objects carrying `action: send|receive`, which is what makes a message's direction legible. A 2.x document declares no `operations` and reads as a contract with no messages.",
      "EVERY message carries a `name` (or is declared under the key you intend to reference). That token is the spine: the C4 edge's `metadata { publishes }` / `metadata { consumes }`, the requirement's `Publishes:` / `Consumes:` line and this name are one name spelled three times.",
      "Namespace the name by the domain that owns it — `payment.PaymentAuthorized`. One message has exactly one producer; two services declaring they send one name is `asyncapi.message-contested`, and then which contract a consumer reads is a coin flip.",
      "loam reads message names and the `action` of the operation carrying them. **It never joins on anything inside `payload`** — the one look inside is a presence probe: a payload declaring no shape at all warns (`asyncapi.payload-undescribed`), and a payload with a non-JSON `schemaFormat` is skipped outright. Write the payload as JSON Schema today; if the fleet later adopts Avro, that is a `schemaFormat` line here and nothing in loam changes.",
      "Keep payloads in `components.schemas` in THIS file rather than `$ref`-ing an external `.avsc`. External references are out of scope for the merge, exactly as on the OpenAPI axis, so a schema in another file will not travel with the message that needs it.",
      "If this service publishes and consumes nothing, there is no file to write. Do not invent one.",
    ],
  },
  {
    artifact: "adrs/",
    key: "adrsDir",
    required: false,
    purpose: "the decisions behind the shape of the service",
    shape: [
      "One file per decision: `adrs/NNNN-<slug>.md`, MADR-style (context · decision · consequences).",
      "Only decisions whose consequences are still visible in the code. A reconstructed rationale for something nobody decided is fiction, and it is the kind that survives review because it sounds reasonable.",
      "If a decision is evident but its reasoning is not, write the decision and say the reasoning is unknown. That is a fact; a plausible motive is not.",
    ],
  },
  {
    artifact: "runbook.md",
    key: "runbook",
    required: false,
    purpose: "how it is run — deploys, dependencies, what to do when it pages",
    shape: [
      "Frontmatter, then how it is deployed and configured, what it depends on, and what to do about the failures that actually happen.",
      "Written from what is in the repo (pipelines, manifests, alert definitions). Whoever carries the pager verifies it; leave `status: draft` until they have.",
      "A 'configured but not a dependency, and why' list: every capability the configuration wires up that the deploy manifest switches off. Without it, the next reader re-derives the dependency from the config and re-adds what the manifest already removed.",
    ],
  },
  {
    artifact: "health.yaml",
    key: "health",
    required: false,
    purpose: "SLIs, SLOs, checks and the dependencies that are critical",
    shape: [
      "SLIs and SLOs as they have been AGREED, plus health checks and critical dependencies.",
      "If no SLO has ever been agreed, say so and leave it out. An invented 99.9% becomes a number other teams plan against.",
    ],
  },
];
