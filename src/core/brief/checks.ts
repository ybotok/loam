/**
 * The checks half of the adoption brief: every check `loam validate` will run
 * against a baseline, each naming the invocation that surfaces it. Its
 * counterpart — the UNCHECKED list, the checks that do not exist — lives in
 * unchecked.ts: honesty no validator will ever supply, and an agent that does
 * not know where the checking stops will assume it never does.
 */

/* ------------------------------------------------------------------ */
/* The checks                                                          */
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
    // an op-linked landscape edge (`landscape.expects`, landscape.ts). For a
    // service the fleet already calls, `required: true` on this target and this
    // row are the same fact stated twice.
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
    code: "health.dependency-unmodelled",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a health.yaml `dependencies:` id that nothing in this service's OWN model.likec4 answers to (element id, `metadata { service }` binding, or title) — the model carries everything the service touches, private stores included as nested containers, and the on-call file must name the same world",
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
  {
    code: "sources.unwalked",
    severity: "warn",
    via: VIA_SERVICE,
    what: "`sources` leaves whole top-level paths of the service repo untouched — the finding names them (checked when loam runs inside the service's repo, against the files git tracks). It grades the WALK, not the writing: the only completeness signal loam can compute, because it is the only one that compares the document against the repository rather than against itself",
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
