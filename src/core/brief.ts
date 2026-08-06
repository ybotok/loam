/**
 * The adoption brief: what an agent needs in order to write one service's
 * baseline documentation, and what will be checked when it does.
 *
 * `adopt` was specified for years as "read the code, emit the C4". It is not
 * being built, because it cannot be: nothing deterministic reads a legacy
 * service and says what its architecture MEANS, and a guessed model is worse
 * than no model — everyone downstream has to re-derive it to know whether to
 * believe it.
 *
 * So loam takes the half of the job that IS deterministic. It states the work
 * precisely (which files, in which grammar, bound to which existing elements),
 * it says exactly which checks the result will face, and then it says which
 * checks do not exist — because everything in that last list is honesty no
 * validator will ever supply, and an agent that does not know where the checking
 * stops will assume it never does.
 *
 * Nothing here reads code. `sources` in the frontmatter is the only line that
 * ties the result to a repository, which is why the brief argues for it instead
 * of merely listing it.
 */
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { elementService, loadFile, serviceResolver, type Elem } from "./likec4.js";
import { landscapePath, listServices, servicePaths } from "./repo.js";

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
   * fleet map shows an API is expected (see `apiExpected`), because the brief is
   * read as an instruction and "MISSING openapi.yaml" told an agent to write a
   * contract for a service that serves no requests.
   */
  required: boolean;
  /** What the artifact is for, in one line. */
  purpose: string;
  /** The grammar. Every rule here is one a later check depends on. */
  shape: string[];
  /** A minimal valid instance, where showing one is shorter than describing it. */
  example?: string;
}

/** Where an artifact lives — `repo.ts` spells the filenames, this only points at them. */
type PathKey = "model" | "spec" | "archSpec" | "openapi" | "adrsDir" | "runbook" | "health";

/**
 * The LikeC4 identifier the fleet map's element for a service conventionally
 * carries: the directory name, camel-cased. It is a suggestion and nothing
 * more — `metadata { service '<id>' }` is what actually joins the element to
 * the directory — but a brief that hands over a concrete block gets followed,
 * and one that describes a block in prose gets improvised on.
 */
function elementIdFor(service: string): string {
  const parts = service.split(/[^A-Za-z0-9]+/).filter((p) => p !== "");
  if (parts.length === 0) return "service";
  const head = parts[0]!.toLowerCase();
  const tail = parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase());
  const id = head + tail.join("");
  // LikeC4 identifiers cannot open with a digit; a service id can.
  return /^[0-9]/.test(id) ? `svc${id[0]!.toUpperCase()}${id.slice(1)}` : id;
}

/**
 * The block this service still owes `architecture/landscape.likec4`.
 *
 * `expects` is what the fleet ALREADY calls on the service — those edges exist
 * in the map today, so the example draws the outbound side as a comment rather
 * than telling an agent to duplicate an edge that is already there.
 */
function landscapeBlock(service: string, expects: string[], present: boolean): string {
  const id = elementIdFor(service);
  const calls =
    expects.length > 0
      ? expects.map((op) => `//   <caller> -> ${id} 'Calls ${op}' { metadata { op '${op}' } }`)
      : [`//   <caller> -> ${id} 'Calls <operationId>' { metadata { op '<operationId>' } }`];
  const model = [
    "model {",
    ...(present ? ["  // ... the fleet's other services stay exactly as they are ...", ""] : []),
    `  ${id} = softwareSystem '${service}' {`,
    "    description '<one line: what this service is responsible for>'",
    `    metadata { service '${service}' }`,
    "  }",
    "",
    "  // every call in or out of it, one edge each:",
    ...calls.map((line) => `  ${line}`),
    "}",
  ];
  // When the file does not exist the example is the WHOLE file, so it carries
  // the `specification` block a bare `model` would be rejected without: the
  // brief must never hand over a document `loam validate` refuses. When the file
  // does exist the example is a fragment to splice, and repeating a
  // `specification` block there would invite a second one.
  return present
    ? model.join("\n")
    : ["specification {", "  element softwareSystem", "}", "", ...model].join("\n");
}

/** The fleet map's own brief — assembled per service, because the block it owes names the service. */
function landscapeArtifact(
  service: string,
  expects: string[],
  present: boolean,
): Omit<BriefTarget, "path" | "exists" | "action"> {
  return {
    artifact: "landscape.likec4",
    required: true,
    purpose:
      "the fleet map — until an element here resolves to this directory, the service is documented and invisible to every cross-service check",
    shape: [
      "This file is the WHOLE FLEET's, not this service's. Add to it; never rewrite it. Everything already in `model { ... }` belongs to the other services, and replacing the file destroys their map along with their edges.",
      `Add one top-level element for the service, bound to its directory: \`metadata { service '${service}' }\`. Until an element resolves to \`services/${service}/\`, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error).`,
      "Bind rather than rename: a binding whose id names no directory is `landscape.binding-unknown` (error), and two elements binding the SAME directory is `landscape.binding-duplicate` (warn) — every element→service join then picks one of them arbitrarily.",
      "Draw every cross-service call as an edge carrying the operation it uses: `a -> b 'Calls createSplit' { metadata { op 'createSplit' } }`. The `op` must be an operationId the TARGET's openapi.yaml defines, or `spine.op-undefined` (error) — a broken contract between services.",
      "If the file does not exist yet, create it with a `specification { ... }` block declaring the kinds you use, then the `model { ... }` block. A landscape that does not parse is `landscape.invalid` (error) and blinds every cross-service check at once.",
    ],
    example: landscapeBlock(service, expects, present),
  };
}

/** The artifacts, in the order a baseline is best written in. */
const ARTIFACTS: Array<Omit<BriefTarget, "path" | "exists" | "action"> & { key: PathKey }> = [
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
// so nothing below is read by any check. Keep it for 'npx likec4 start', which
// does render it. Scoped to one service 'include *' is cheap; the same line in
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
    // Overridden per service in `serviceBrief`: an API is required only where
    // the fleet expects one. See `apiExpected`.
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

/* ------------------------------------------------------------------ */
/* The frontmatter                                                     */
/* ------------------------------------------------------------------ */

export interface FrontmatterBrief {
  /** Field -> what to write in it. */
  fields: Record<string, string>;
  /** Fields to leave alone entirely. */
  never: string[];
  /** Why `sources` carries the weight. */
  why: string;
}

const FRONTMATTER_BRIEF: FrontmatterBrief = {
  fields: {
    service: "the directory this file lives under, exactly. A mismatch is an error (`frontmatter.field-mismatch`).",
    status:
      "`draft`, always. `verified` is a human's word, stamped by `loam vouch --service <id>` run inside the service's own repo — never written by hand.",
    owner: "the team or person who answers for this service.",
    sources:
      "the paths in THIS SERVICE'S repository you actually read to write the document — files and directories only, a directory covering everything beneath it; glob patterns are refused. Not the paths a reader would expect to have been read.",
  },
  never: ["last_verified", "sources_digest", "content_digest", "sources_files"],
  why:
    "`sources` is the only mechanical tie between this document and the code. Everything else loam checks is internal consistency, and a corpus can agree with itself perfectly while describing nothing that exists. `loam validate`, run inside the service's repo, checks every listed path is still there; `loam vouch` hashes their content so a later `validate` can say the code has moved since anyone read it. Both are worth exactly as much as the list is honest.",
};

/* ------------------------------------------------------------------ */
/* The checks — and the ones that do not exist                         */
/* ------------------------------------------------------------------ */

/**
 * The two invocations a baseline meets. `<id>` is a placeholder for the service
 * id — the JSON contract keeps it symbolic, the text renderer substitutes it.
 */
const VIA_SERVICE = "loam validate --service <id>";
export const VIA_ALL = "loam validate --all";

export interface BriefCheck {
  code: string;
  severity: "error" | "warn";
  /**
   * The invocation that surfaces this check. Most run under `--service`, but
   * the fleet cross-check does not — attributing it there taught agents to
   * expect a finding that run never reports.
   */
  via: typeof VIA_SERVICE | typeof VIA_ALL;
  what: string;
}

/** What `loam validate` will run against the result — each check names the invocation that surfaces it. */
export const VALIDATE_CHECKS: BriefCheck[] = [
  { code: "service.no-model", severity: "error", via: VIA_SERVICE, what: "there is no model.likec4 — every other check stops here" },
  { code: "c4.invalid", severity: "error", via: VIA_SERVICE, what: "model.likec4 does not parse as LikeC4" },
  {
    code: "requirements.missing-scenarios",
    severity: "error",
    via: VIA_SERVICE,
    what: "a requirement in spec.md or arch.spec.md has no `#### Scenario:`",
  },
  {
    code: "spec.duplicate-requirement",
    severity: "error",
    via: VIA_SERVICE,
    what: "one `### Requirement:` name defined twice in one living spec.md or arch.spec.md — a later merge edits only the first, the rest live on as stale copies",
  },
  {
    code: "spec.requirement-id-invalid",
    severity: "error",
    via: VIA_SERVICE,
    what: "an optional `Requirement-ID:` violates `[A-Za-z][A-Za-z0-9._-]{0,127}` — stable identities must be portable and unambiguous",
  },
  {
    code: "spec.requirement-id-repeated",
    severity: "error",
    via: VIA_SERVICE,
    what: "one requirement declares `Requirement-ID:` more than once — keep exactly one identity line",
  },
  {
    code: "spec.requirement-id-duplicate",
    severity: "error",
    via: VIA_SERVICE,
    what: "one stable Requirement-ID identifies multiple requirements in one spec.md or arch.spec.md",
  },
  // The keep-last pair: a second `Operations:` / `Covers:` line in one
  // requirement body REPLACES the first — assignment, not append — so the
  // author's two-line list silently loses its first line. The semantics stay;
  // the loss no longer happens in silence.
  {
    code: "spec.repeated-operations",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a second `Operations:` line in one requirement body — the last replaces the earlier ones, whose list is silently dropped; merge into one comma-separated line",
  },
  {
    code: "spec.repeated-covers",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a second `Covers:` line in one requirement body — same keep-last rule, same silent loss; merge into one comma-separated line",
  },
  // The graded absences: the brief marks spec.md and openapi.yaml required, and
  // validate agrees they belong — as warns, because partial adoption is a
  // supported state and these are its honest progress meter, not a gate.
  {
    code: "service.no-spec",
    severity: "warn",
    via: VIA_SERVICE,
    what: "spec.md does not exist yet — legal mid-adoption, but requirement coverage and API governance are unchecked until it does",
  },
  {
    // `warn` is the floor, not the whole story, and the difference matters to a
    // baseline: the absence is graded an ERROR once something already written
    // down joins into the file — a living requirement's `Operations:` line, or
    // an op-linked landscape edge (`landscape.expects`, above). For a service
    // the fleet already calls, `required: true` on this target and this row are
    // the same fact stated twice.
    code: "service.no-openapi",
    severity: "warn",
    via: VIA_SERVICE,
    what: "openapi.yaml does not exist yet — quiet only when the landscape proves no other service calls an operation on this one, and an ERROR rather than a warning once a living `Operations:` line or a landscape edge already names an operation it would have defined",
  },
  {
    code: "openapi.invalid",
    severity: "error",
    via: VIA_SERVICE,
    what: "openapi.yaml exists but does not parse — an unreadable contract proves nothing, so the `api.*` checks and the spine's op resolution are suspended until it reads",
  },
  {
    code: "api.ungoverned",
    severity: "warn",
    via: VIA_SERVICE,
    what: "an operationId in openapi.yaml that no requirement's `Operations:` line names",
  },
  {
    code: "api.ops-unlinked",
    severity: "warn",
    via: VIA_SERVICE,
    what: "openapi.yaml defines operations and spec.md has requirements, but no `Operations:` line joins them — every cross-axis check is vacuously green",
  },
  // The `Operations:` spine, checked against the LIVING contract. It used to
  // fire only inside a feature delta, so a baseline could ship a requirement
  // governing an operation nobody defines and stay green until the first
  // feature touched it.
  {
    code: "spec-api.op-undefined",
    severity: "error",
    via: VIA_SERVICE,
    what: "a living requirement's `Operations:` line names an operationId this service's openapi.yaml does not define — the two axes disagree about what the service exposes",
  },
  {
    code: "spec.no-requirements",
    severity: "warn",
    via: VIA_SERVICE,
    what: "spec.md exists but holds no `### Requirement:` block at all — every requirement-driven check below it is vacuous rather than passing",
  },
  // The deprecation pair fires on a fresh baseline too — a legacy service is
  // exactly where ops marked `deprecated: true` coexist with their
  // replacements, and documenting that lifecycle honestly is part of the
  // adoption. Mark the flag where the code retires an op; loam reads it, and
  // has no removal semantics beyond it.
  {
    code: "api.requirement-deprecated",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a requirement whose `Operations:` list resolves only to operations openapi.yaml marks `deprecated: true` — the behaviour it governs is being retired",
  },
  {
    code: "spine.op-undefined",
    severity: "error",
    via: VIA_SERVICE,
    what: "a landscape edge into this service calls an operation its openapi.yaml does not define — a broken contract between services",
  },
  {
    code: "spine.op-link-missing",
    severity: "warn",
    via: VIA_SERVICE,
    what: 'a landscape "Calls" edge into this service with no `metadata { op }`',
  },
  {
    code: "spine.op-deprecated",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a landscape edge into this service calls an operation openapi.yaml marks `deprecated: true` — the consumer should be migrating off it",
  },
  {
    code: "covers.unknown",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a `Covers:` entry in arch.spec.md that resolves to no element, edge, alert or SLI — a typo silently costs the coverage it was written for",
  },
  {
    code: "health.invalid",
    severity: "warn",
    via: VIA_SERVICE,
    what: "health.yaml exists but does not parse — its alert/SLI ids are unreadable, so `Covers: alert:/sli:` entries and health coverage go unchecked until it reads (a missing health.yaml stays silent)",
  },
  {
    code: "health.uncovered",
    severity: "warn",
    via: VIA_SERVICE,
    what: "an alert or SLI declared in health.yaml that no arch.spec.md requirement covers — expected until the arch spec is written; each one is a signal nothing tests",
  },
  {
    code: "frontmatter.malformed",
    severity: "error",
    via: VIA_SERVICE,
    what: "the frontmatter block does not parse as YAML — owner, status and sources are unreadable, and the field checks are suspended until the header is fixed",
  },
  {
    code: "frontmatter.field-mismatch",
    severity: "error",
    via: VIA_SERVICE,
    what: "spec.md declares a different `service:` than the directory it lives under",
  },
  {
    code: "frontmatter.status-unknown",
    severity: "error",
    via: VIA_SERVICE,
    what: "a status outside `draft` / `verified` — a typo here reads as unverified forever",
  },
  { code: "frontmatter.field-missing", severity: "warn", via: VIA_SERVICE, what: "no `owner`, `status` or `service`" },
  { code: "sources.absent", severity: "warn", via: VIA_SERVICE, what: "spec.md names no `sources`" },
  {
    code: "sources.path-missing",
    severity: "error",
    via: VIA_SERVICE,
    what: "a listed source does not exist, or is a glob pattern — no longer supported (checked when loam runs inside the service's repo)",
  },
  {
    code: "sources.unvouched",
    severity: "warn",
    via: VIA_SERVICE,
    what: "`sources` with no digest — nobody has vouched for the document yet. Expected on a fresh baseline; only a human closes it",
  },
  // sources.stale, sources.current and content.stale are deliberately absent:
  // all three compare against digests `loam vouch` stamps, and a fresh baseline
  // has no stamp to compare — the table lists what a baseline can actually meet.
  // The gherkin.* staleness chain is absent the same way: it fires only once
  // `loam gherkin` has generated a suite under <gherkinDir>/loam/ in the
  // service's own repo, and a fresh baseline has not generated one.
  {
    code: "landscape.service-unmodelled",
    severity: "error",
    via: VIA_ALL,
    what: "nothing in architecture/landscape.likec4 resolves to services/<id>/ — the fleet map is incomplete until an element exists or an existing one is bound with `metadata { service '<id>' }`",
  },
  {
    code: "landscape.missing",
    severity: "error",
    via: VIA_ALL,
    what: "architecture/landscape.likec4 does not exist at all — an error as soon as services/ holds one service (a warning only in an empty docs repo): with no fleet map, every cross-service check is blind rather than passing",
  },
  {
    code: "landscape.invalid",
    severity: "error",
    via: VIA_ALL,
    what: "architecture/landscape.likec4 exists but does not parse — fix it before anything else; the whole cross-service layer is unchecked until it reads",
  },
  {
    code: "landscape.binding-unknown",
    severity: "error",
    via: VIA_ALL,
    what: "an element's `metadata { service }` names a directory that does not exist — a binding is a claim about this repo, and this one is false",
  },
  {
    code: "landscape.binding-duplicate",
    severity: "warn",
    via: VIA_ALL,
    what: "two landscape elements resolve to the same services/<id>/ — every element→service join picks one of them arbitrarily, so the other's edges are filed under a service that does not own them",
  },
];

/**
 * What no check will ever tell you. Read it as the list of ways to be wrong
 * quietly.
 *
 * The first two entries are here because they used to be `shape` rules on
 * model.likec4, phrased exactly like the enforced ones. A brief that states an
 * unenforced rule beside four enforced ones is not merely useless — it is the
 * way an agent learns that a green `loam validate` means more than it does.
 * Anything nothing checks belongs on this list, where its status IS the point.
 */
export const UNCHECKED: string[] = [
  // Not merely unchecked — unread. This entry used to end "write one", on the
  // theory that a view is what makes a model legible. It is, to LikeC4's
  // renderer; loam computes none. Saying otherwise taught agents that a views
  // block was owed to loam, and an `include *` over the FLEET map is the one
  // shape that costs minutes rather than milliseconds.
  "Whether model.likec4 declares a `views { ... }` block, or any view at all — and nothing in loam ever will. loam reads elements and relationships out of the PARSED model and renders nothing, so it computes no view and a model without one is missing nothing loam wants. Views belong to LikeC4's own renderer: write them if you want diagrams, and read them with `npx likec4 start`. Scope them when you do — computing a view is superlinear in the number of edges, and an `include *` over `architecture/landscape.likec4` is the expensive one, because that file holds every call in the fleet.",
  "Whether the model has exactly ONE top-level element for the service, with its containers nested inside. Five top-level boxes for one service parse, validate and bind exactly as well as one — and then the fleet map, which joins elements to directories, has five candidates for the same service and no way to say which is wrong.",
  "Whether the model is the architecture the code actually has. loam parses model.likec4; it never reads a line of the service.",
  "Whether a requirement is TRUE of the service. `loam validate` checks that a requirement has a scenario, never that either one describes real behaviour.",
  "Whether the scenarios are acceptance criteria somebody could test, or the requirement restated in Given/When/Then.",
  "Whether an operationId is the one the code serves, and whether the request and response schemas resemble what the endpoint really accepts and returns. Only the operationId is read.",
  "Whether the runbook's steps work, or the health.yaml SLOs are numbers anyone agreed to.",
  "Whether an arch scenario really exercises what its `Covers:` line names. The entries are resolved against the model and health.yaml — never against code, tests, dashboards or alert rules.",
  "Whether an ADR records a decision that was made, or one reconstructed afterwards to justify the code.",
  "COMPLETENESS. Forty behaviours documented as one requirement passes every check loam has. So does a service with one endpoint documented out of thirty.",
  "Whether `sources` names the files you read. loam checks those paths exist — not that they are the ones the document came from.",
];

/* ------------------------------------------------------------------ */
/* What the fleet already says about this service                      */
/* ------------------------------------------------------------------ */

export interface LandscapeElement {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  /** True when the element binds explicitly with `metadata { service }`. */
  bound: boolean;
}

export interface LandscapeEdge {
  from?: string;
  to?: string;
  op: string | null;
  title: string | null;
}

export interface LandscapeContext {
  present: boolean;
  /** False when the landscape exists but does not parse. */
  parses: boolean;
  /** Whether any element resolves to this service — null when nothing could be read. */
  modelled: boolean | null;
  elements: LandscapeElement[];
  inbound: LandscapeEdge[];
  outbound: LandscapeEdge[];
  /** Operations other services already call on this one: the contract owes them. */
  expects: string[];
  /**
   * The write this service still owes the fleet map, in prose — null once an
   * element resolves to it.
   *
   * It duplicates the `landscape.likec4` target's shape rules on purpose: an
   * agent driving off `--json` reads `landscape` to learn what the fleet
   * already says, and every `targets[]` consumer walks the artifact list. Only
   * one of those two readers used to exist, so `adopt` briefed eight files and
   * never once said the ninth thing — that a documented service nobody drew is
   * invisible to the whole cross-service layer.
   */
  instruction: string | null;
}

export interface Brief {
  service: string;
  /** Absolute docs repo root — the anchor the repo-relative paths hang off. */
  docsDir: string;
  /** Repo-relative path of services/<id>/. */
  path: string;
  targets: BriefTarget[];
  landscape: LandscapeContext;
  frontmatter: FrontmatterBrief;
  checks: BriefCheck[];
  unchecked: string[];
  /** The one instruction that outranks the rest. */
  rule: string;
}

const NEVER_OVERWRITE =
  "Do not overwrite an artifact that already exists. Read it, diff your findings against it, and report what disagrees — a document somebody wrote is evidence, and replacing it destroys the only copy of what they knew.";

/** Assemble the brief for one service. Reads the docs repo; writes nothing. */
export async function serviceBrief(docsDir: string, service: string): Promise<Brief> {
  const paths = servicePaths(docsDir, service);
  const rel = (abs: string): string => relative(docsDir, abs).split(/[\\/]/).join("/");

  // Read before the artifact loop, not after it: what the fleet already says
  // about this service decides whether it owes an API contract at all.
  const landscape = await landscapeContext(docsDir, service);
  const owesApi = apiExpected(landscape);

  const targets: BriefTarget[] = [];
  for (const { key, ...artifact } of ARTIFACTS) {
    // `adrs/` is a directory, and an empty one is not an existing artifact —
    // reporting it as present would tell the agent to diff against nothing.
    const dir = key === "adrsDir";
    const exists = dir ? await hasMarkdown(paths[key]) : existsSync(paths[key]);
    targets.push({
      ...artifact,
      ...(key === "openapi" ? { required: owesApi } : {}),
      path: dir ? `${rel(paths[key])}/` : rel(paths[key]),
      exists,
      action: exists ? "diff" : "create",
    });
  }

  // The eighth target is the fleet map, and it is conditional: a service the
  // landscape ALREADY resolves an element to owes it nothing, and briefing an
  // edit there would invite an agent to draw a second box for a service that
  // has one. Everything else about the target is unconditional — the file is
  // shared, so `action` is `edit` whenever it exists and `create` only for the
  // very first service of a brand-new docs repo.
  if (landscape.modelled !== true) {
    targets.push({
      ...landscapeArtifact(service, landscape.expects, landscape.present),
      path: rel(landscapePath(docsDir)),
      exists: landscape.present,
      action: landscape.present ? "edit" : "create",
    });
  }

  return {
    service,
    docsDir,
    path: rel(paths.dir),
    targets,
    landscape,
    frontmatter: FRONTMATTER_BRIEF,
    checks: VALIDATE_CHECKS,
    unchecked: UNCHECKED,
    rule: NEVER_OVERWRITE,
  };
}

async function hasMarkdown(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir, { withFileTypes: true });
  // `statSync` for the symlink case: a Dirent never follows one, so `isFile()`
  // is false for a symlinked ADR and the directory reads as empty (repo.ts's
  // `entryIs` is the same rule for `services/` and `features/`).
  return entries.some((e) => {
    if (!e.name.endsWith(".md")) return false;
    if (e.isFile()) return true;
    if (!e.isSymbolicLink()) return false;
    try {
      return statSync(join(dir, e.name)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Does the fleet expect an API of this service?
 *
 * The brief marked `openapi.yaml` required unconditionally, and printed the
 * absence as `MISSING` in capitals — while `loam validate` and `loam list`
 * derive the opposite from the same landscape (`service.no-openapi` stays quiet
 * when nothing calls the service, and `list`'s maturity ladder stops demanding
 * a contract). For a UI, a worker or a cron the brief was therefore telling an
 * agent to INVENT an API contract into the source of truth — the one class of
 * guess this whole module exists to refuse, and the one the brief itself names
 * 219 lines further down.
 *
 * Positive evidence only, exactly as `list` reads it: a landscape that is
 * absent or does not parse proves nothing about who calls this service, so the
 * contract is still owed. `expects` is the ops on inbound edges, which is
 * `list`'s `called` set seen from one service.
 */
function apiExpected(landscape: LandscapeContext): boolean {
  return !landscape.parses || landscape.expects.length > 0;
}

/**
 * The service ids the resolver may fall back on when an element carries no
 * `metadata { service }` binding — the same positive evidence `validate` and
 * `list` hand it. A docs repo that cannot be enumerated (no `services/` yet:
 * `adopt` runs there) leaves the resolver with bindings alone, which is what it
 * had before.
 */
async function knownServices(docsDir: string): Promise<ReadonlySet<string>> {
  try {
    return new Set((await listServices(docsDir)).map((s) => s.id));
  } catch {
    return new Set();
  }
}

/**
 * What the living landscape already says about this service.
 *
 * This is the half of the brief that stops an agent inventing a parallel model:
 * the fleet has already drawn some of these boxes and edges, and the baseline has
 * to attach to them. A landscape that does not parse yields `modelled: null` —
 * "nothing models it" would be a claim about a document nobody could read.
 */
async function landscapeContext(docsDir: string, service: string): Promise<LandscapeContext> {
  const path = landscapePath(docsDir);
  const empty: LandscapeContext = {
    present: existsSync(path),
    parses: false,
    modelled: null,
    elements: [],
    inbound: [],
    outbound: [],
    expects: [],
    instruction: null,
  };
  if (!empty.present)
    return { ...empty, modelled: false, instruction: instructionFor(service, "absent", []) };

  const land = await loadFile(path);
  if (land.errors.length > 0)
    return { ...empty, instruction: instructionFor(service, "unparseable", []) };

  const mine = (e: Elem): boolean => elementService(e) === service;
  const elements: LandscapeElement[] = land.elements.filter(mine).map((e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    tags: e.tags,
    bound: e.service !== undefined,
  }));

  // One resolver for the whole scan, built with the real service ids: an edge
  // drawn into a modelled container (`paymentService.api`) is an edge into the
  // service, and `expects` — which now decides whether this service owes an
  // OpenAPI contract at all — has to see it. Building it once also stops the
  // per-edge rebuild the old `serviceOf(land.elements, id)` call did.
  const svcOf = serviceResolver(land.elements, await knownServices(docsDir));
  const inbound: LandscapeEdge[] = [];
  const outbound: LandscapeEdge[] = [];
  for (const r of land.relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === service) inbound.push({ from: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === service) outbound.push({ to: svcOf(r.target), ...edge });
  }

  const expects = [...new Set(inbound.map((e) => e.op).filter((op): op is string => op !== null))];
  return {
    present: true,
    parses: true,
    modelled: elements.length > 0,
    elements,
    inbound,
    outbound,
    expects,
    instruction:
      elements.length > 0 ? null : instructionFor(service, "unmodelled", expects),
  };
}

/**
 * The fleet-map instruction, in the three states a landscape can be in.
 *
 * It says the file, the block, and the consequence, in that order. The
 * consequence is the part agents acted on: "add an element" reads as tidiness,
 * "until you do, `loam validate --all` fails and no cross-service check can see
 * this service" reads as work.
 */
function instructionFor(
  service: string,
  state: "absent" | "unparseable" | "unmodelled",
  expects: string[],
): string {
  const id = elementIdFor(service);
  const bind = `an element bound with \`metadata { service '${service}' }\``;
  const consequence =
    `Until one resolves, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error) for ` +
    `services/${service}/: the service is documented and invisible — no edge into it can be checked ` +
    `against its openapi.yaml, and no feature can draw a call to it.`;
  // `expects` is reachable only through elements that already resolve to this
  // service, so it is empty in every state that produces an instruction. It is
  // threaded through anyway rather than dropped: the caller computes it once,
  // and the day an unmodelled service can inherit an edge (a container-level
  // binding, say) the sentence is already here instead of being noticed missing.
  const owed =
    expects.length > 0
      ? ` The fleet already calls ${expects.map((o) => `'${o}'`).join(", ")} on this service, so those edges exist; your element is what they will resolve to.`
      : "";

  if (state === "absent") {
    return (
      `architecture/landscape.likec4 does not exist yet. Create it with a \`specification { ... }\` block ` +
      `declaring the kinds you use and a \`model { ... }\` block containing ${bind} ` +
      `(conventionally \`${id} = softwareSystem '${service}'\`), plus one edge per cross-service call, each ` +
      `carrying \`metadata { op '<operationId>' }\`. ${consequence}${owed}`
    );
  }
  if (state === "unparseable") {
    return (
      `architecture/landscape.likec4 exists but does not parse (\`landscape.invalid\`), so nothing can be said ` +
      `about what it already models. Fix the parse errors first — they blind every cross-service check at once — ` +
      `then make sure it holds ${bind}. ${consequence}`
    );
  }
  return (
    `Nothing in architecture/landscape.likec4 resolves to services/${service}/. ADD to that file — do not rewrite ` +
    `it, every other service's map is in there — ${bind}, conventionally ` +
    `\`${id} = softwareSystem '${service}'\`, inside the existing \`model { ... }\` block, and draw each ` +
    `cross-service call as an edge carrying \`metadata { op '<operationId>' }\`. ${consequence}${owed}`
  );
}
