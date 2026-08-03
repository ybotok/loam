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
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { elementService, loadFile, serviceOf, type Elem } from "./likec4.js";
import { landscapePath, servicePaths } from "./repo.js";

/* ------------------------------------------------------------------ */
/* The artifacts                                                       */
/* ------------------------------------------------------------------ */

export interface BriefTarget {
  /** File name as it appears under `services/<svc>/`. */
  artifact: string;
  /** Repo-relative path to write. */
  path: string;
  exists: boolean;
  /** `create` a missing artifact; `diff` an existing one — never overwrite it. */
  action: "create" | "diff";
  /**
   * False for artifacts a baseline can legitimately ship without. True means
   * required for a COMPLETE baseline — validate grades a missing spec.md or
   * openapi.yaml as a warn (`service.no-spec` / `service.no-openapi`), not an
   * error: partial adoption is a supported state, and the warns are the
   * progress meter.
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
type PathKey = "model" | "spec" | "openapi" | "adrsDir" | "runbook" | "health";

/** The artifacts, in the order a baseline is best written in. */
const ARTIFACTS: Array<Omit<BriefTarget, "path" | "exists" | "action"> & { key: PathKey }> = [
  {
    artifact: "model.likec4",
    key: "model",
    required: true,
    purpose: "the service's C4 — what it is, what is inside it, what it talks to",
    shape: [
      "A `specification { ... }` block declaring every element kind you use (`element softwareSystem`, `element container`). LikeC4 rejects an undeclared kind.",
      "A `model { ... }` block with ONE top-level element for the service; containers and components nest inside it.",
      "A `views { ... }` block with at least one view. Scope a container view with `view of <element>`.",
      "The service element binds to this directory: `metadata { service '<id>' }`. Without a binding the element's TITLE has to equal the directory name — and then renaming the box silently unlinks every check that joined the two.",
      "A call to another service is an edge that names the operation it uses: `a -> b 'Calls createSplit' { metadata { op 'createSplit' } }`. The `op` must be an operationId the TARGET's openapi.yaml defines.",
      "It has to parse: `loam validate` runs LikeC4 in-process and reports `c4.invalid` with line numbers.",
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
      "`### Requirement: <name>` — ONE observable behaviour, written with SHALL, testable without reading the code. The name is its identity: `loam archive` matches later changes to it by name, so a rename reads as a different requirement.",
      "At least one `#### Scenario: <name>` per requirement, with Given/When/Then bullets. This is gated (`requirements.missing-scenarios`) — scenarios are the acceptance criteria and the source for tests.",
      "`Operations: <operationId>[, <operationId>]` in the requirement body names the API operations it governs. Every one must exist in this service's openapi.yaml.",
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
    artifact: "openapi.yaml",
    key: "openapi",
    required: true,
    purpose: "the API contract — the operations this service exposes",
    shape: [
      "OpenAPI 3.x with a `paths` map.",
      "EVERY operation carries an `operationId`. That token is the spine: the C4 edge's `metadata { op }`, the requirement's `Operations:` line and this `operationId` are one name spelled three times, and they must be identical.",
      "loam reads operationIds and nothing else in this file. The schemas are for humans, codegen and review — they are not checked, so getting them wrong is invisible here and expensive later.",
      "Document the endpoints that exist. An operation the fleet already calls (see `landscape.expects`) must be in here, or the contract breaks the moment this lands.",
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

export const FRONTMATTER_BRIEF: FrontmatterBrief = {
  fields: {
    service: "the directory this file lives under, exactly. A mismatch is an error (`frontmatter.field-mismatch`).",
    status:
      "`draft`, always. `verified` is a human's word, stamped by `loam vouch --service <id>` run inside the service's own repo — never written by hand.",
    owner: "the team or person who answers for this service.",
    sources:
      "the paths in THIS SERVICE'S repository you actually read to write the document — files, directories or globs. Not the paths a reader would expect to have been read.",
  },
  never: ["last_verified", "sources_digest"],
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
export const VIA_SERVICE = "loam validate --service <id>";
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
    what: "a requirement in spec.md has no `#### Scenario:`",
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
    code: "service.no-openapi",
    severity: "warn",
    via: VIA_SERVICE,
    what: "openapi.yaml does not exist yet — quiet only when the landscape proves no other service calls an operation on this one",
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
    what: "a listed source does not exist (checked when loam runs inside the service's repo)",
  },
  {
    code: "sources.unvouched",
    severity: "warn",
    via: VIA_SERVICE,
    what: "`sources` with no digest — nobody has vouched for the document yet. Expected on a fresh baseline; only a human closes it",
  },
  {
    code: "landscape.service-unmodelled",
    severity: "error",
    via: VIA_ALL,
    what: "nothing in architecture/landscape.likec4 resolves to services/<id>/ — the fleet map is incomplete until an element exists or an existing one is bound with `metadata { service '<id>' }`",
  },
];

/** What no check will ever tell you. Read it as the list of ways to be wrong quietly. */
export const UNCHECKED: string[] = [
  "Whether the model is the architecture the code actually has. loam parses model.likec4; it never reads a line of the service.",
  "Whether a requirement is TRUE of the service. `loam validate` checks that a requirement has a scenario, never that either one describes real behaviour.",
  "Whether the scenarios are acceptance criteria somebody could test, or the requirement restated in Given/When/Then.",
  "Whether an operationId is the one the code serves, and whether the request and response schemas resemble what the endpoint really accepts and returns. Only the operationId is read.",
  "Whether the runbook's steps work, or the health.yaml SLOs are numbers anyone agreed to.",
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

export const NEVER_OVERWRITE =
  "Do not overwrite an artifact that already exists. Read it, diff your findings against it, and report what disagrees — a document somebody wrote is evidence, and replacing it destroys the only copy of what they knew.";

/** Assemble the brief for one service. Reads the docs repo; writes nothing. */
export async function serviceBrief(docsDir: string, service: string): Promise<Brief> {
  const paths = servicePaths(docsDir, service);
  const rel = (abs: string): string => relative(docsDir, abs).split(/[\\/]/).join("/");

  const targets: BriefTarget[] = [];
  for (const { key, ...artifact } of ARTIFACTS) {
    // `adrs/` is a directory, and an empty one is not an existing artifact —
    // reporting it as present would tell the agent to diff against nothing.
    const dir = key === "adrsDir";
    const exists = dir ? await hasMarkdown(paths[key]) : existsSync(paths[key]);
    targets.push({
      ...artifact,
      path: dir ? `${rel(paths[key])}/` : rel(paths[key]),
      exists,
      action: exists ? "diff" : "create",
    });
  }

  return {
    service,
    docsDir,
    path: rel(paths.dir),
    targets,
    landscape: await landscapeContext(docsDir, service),
    frontmatter: FRONTMATTER_BRIEF,
    checks: VALIDATE_CHECKS,
    unchecked: UNCHECKED,
    rule: NEVER_OVERWRITE,
  };
}

async function hasMarkdown(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.some((e) => e.isFile() && e.name.endsWith(".md"));
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
  };
  if (!empty.present) return { ...empty, modelled: false };

  const land = await loadFile(path);
  if (land.errors.length > 0) return empty;

  const mine = (e: Elem): boolean => elementService(e) === service;
  const elements: LandscapeElement[] = land.elements.filter(mine).map((e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    tags: e.tags,
    bound: e.service !== undefined,
  }));

  const svcOf = (id: string): string => serviceOf(land.elements, id);
  const inbound: LandscapeEdge[] = [];
  const outbound: LandscapeEdge[] = [];
  for (const r of land.relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === service) inbound.push({ from: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === service) outbound.push({ to: svcOf(r.target), ...edge });
  }

  return {
    present: true,
    parses: true,
    modelled: elements.length > 0,
    elements,
    inbound,
    outbound,
    expects: [...new Set(inbound.map((e) => e.op).filter((op): op is string => op !== null))],
  };
}
