/**
 * The artifacts of the adoption brief: what each file under `services/<svc>/`
 * is for, the grammar it has to be written in, and a minimal valid example
 * where showing one is shorter than describing it. Every `shape` rule here is
 * one a later check depends on, and test/agent-contract.test.ts pins the
 * mapping. This module is the list alone — `serviceBrief` (brief.ts) resolves
 * it against a docs repo, and the fleet map's own target, whose block names
 * the service, is assembled per service in landscape.ts.
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
      "A `specification { ... }` block declaring every element kind you use (`element softwareSystem`, `element container`). LikeC4 rejects an undeclared kind, and `loam validate --service <id>` reports it as `c4.invalid` with line numbers.",
      "A `model { ... }` block holding the service's element, with containers and components nested inside it. The whole file has to parse — `loam validate` runs LikeC4 in-process and reports `c4.invalid` with line numbers.",
      "The service element binds to this directory: `metadata { service '<id>' }`. Without a binding the element's TITLE has to equal the directory name — and then renaming the box silently unlinks every check that joined the two. The same binding is what makes the FLEET map resolve an element to `services/<id>/`; until one does, `loam validate --all` reports `landscape.service-unmodelled`.",
      "A call to another service is an edge that names the operation it uses: `a -> b 'Calls createSplit' { metadata { op 'createSplit' } }`. Cross-service edges belong in `architecture/landscape.likec4` (a target of its own, below) — this file cannot even resolve the other service's element — and there the `op` must be an operationId the TARGET's openapi.yaml defines, or `spine.op-undefined` fires.",
    ],
    example: `specification {
  element softwareSystem
  element container
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
    metadata { service 'payment-service' }

    api = container 'HTTP API'
    ledger = container 'Ledger store'
  }
}

// Views are LikeC4's, not loam's: loam parses this file and computes no view,
// so nothing below is read by any check. Keep it for the renderer, which does
// draw it — 'npx likec4 start services/<id>' from the docs repo, pointed at THIS
// directory. Not the repo root: every service model declares its own
// 'specification' block, so the root is scoped to architecture/ (likec4.config.json)
// and one model at a time is how these files are meant to be read.
// Scoped to one service 'include *' is cheap; the same line in
// architecture/landscape.likec4 walks every call in the fleet and takes minutes.
views {
  view of paymentService {
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
The service SHALL authorize a payment against the issuer before it is captured.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card and an amount within its limit
- **When** authorization is requested
- **Then** the payment is authorized and an authorization id is returned
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
      "loam reads operationIds and nothing else in this file. The schemas are for humans, codegen and review — they are not checked, so getting them wrong is invisible here and expensive later.",
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
      "loam reads message names and the `action` of the operation carrying them. **It never looks inside `payload`.** Write the payload as JSON Schema today; if the fleet later adopts Avro, that is a `schemaFormat` line here and nothing in loam changes.",
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
