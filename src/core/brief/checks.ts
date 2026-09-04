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
  {
    code: "c4.invalid",
    severity: "error",
    via: VIA_SERVICE,
    what: "model.likec4 does not parse as LikeC4 — for a model that extends the fleet map, parsed together with `architecture/landscape.likec4`, and every error is this model's, including one the parser blames on the map (the map parses clean on its own)",
  },
  // The two shapes' own grades. A model that extends the map cannot diverge from
  // it — there is one declaration — and a model that stands alone cannot own an
  // element outside itself, because nothing else is in its project. So exactly
  // one of these two can ever fire for a given model, and which one is decided
  // by the file's own grammar (SCHEMA.md, "Two shapes of a service model").
  {
    code: "c4.declaration-diverged",
    severity: "warn",
    via: VIA_SERVICE,
    // "the fleet map (architecture/)", never one file: the map is a project, an
    // element may be declared in any document of it, and the finding's own
    // message and `loam explain` both refuse to name a file for that reason.
    // Naming `architecture/landscape.likec4` here sent a reader of a fleet whose
    // map is spread over several documents to a file that may not declare the
    // element at all (verification 2026-09-04).
    what: "a model that declares its own `specification` (the standalone shape) declares an element the fleet map (`architecture/`) also declares, and the two copies disagree about `kind`, `title`, the tag SET or the `metadata { service }` binding — two documents are two authorities on one element. `description` is deliberately not compared. Copy the map's declaration verbatim, or migrate the model to extend the map",
  },
  {
    code: "c4.element-unowned",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a model that extends the fleet map declares an element OUTSIDE the element that resolves to this service — a system this service reaches belongs in `architecture/landscape.likec4`, declared once, and another service's internals belong in that service's model",
  },
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
  //
  // The service's OWN use cases: a `dynamic view` in any `.likec4` beside
  // model.likec4 (or inside it) that opts in with `#req-`. The same codes the
  // fleet target grades over architecture/usecases/, reused on the service
  // target because the flow's hops name this service's containers, which only
  // its own project can resolve. `usecase.step-unlinked` was at first left
  // out, on the reasoning that a hop between two containers of one service
  // owes no operationId — true, and exactly the scope of the guard that keeps
  // it quiet there (a service owes none to itself); but a service's model
  // routinely declares a stand-in for a sibling service it calls, and a hop
  // from a service-local flow into that stand-in with no `metadata { op }`
  // warns exactly as it does on the fleet map. The row is listed so the
  // agent's own baseline run never reports a code the brief left unexplained.
  {
    code: "usecase.step-unbacked",
    severity: "error",
    via: VIA_SERVICE,
    what: "a hop of a `#req-`-tagged dynamic view in this service's project that no relationship in model.likec4 backs — LikeC4 reports nothing for it, so only this does",
  },
  {
    code: "usecase.step-contested",
    severity: "warn",
    via: VIA_SERVICE,
    what: "two or more relationships back one hop of a service-local flow and name different operations — loam names the candidates rather than picking one",
  },
  {
    code: "usecase.step-unlinked",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a hop of a service-local flow into ANOTHER service's element — a stand-in this model.likec4 declares for a sibling, bound or titled as that service — backed by an edge carrying no `metadata { op }` and no `publishes`/`consumes`; never on a hop whose caller and provider resolve to the same service, because a service owes no operationId to itself",
  },
  {
    code: "usecase.requirement-unresolved",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `#req-` tag on a service-local flow naming no `Requirement-ID` of this service's spec.md or arch.spec.md — the id is scoped by the directory, never by a capability",
  },
  {
    code: "usecase.capability-unresolved",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `#cap-` tag on a flow inside this service's own project — a capability is claimed on the fleet map, never inside one service; drop the tag and keep the `#req-` one",
  },
  {
    code: "usecase.flow-invalid",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `.likec4` beside model.likec4 that does not parse as part of the service's LikeC4 project — no flow in it was graded; model.likec4 itself is still graded alone",
  },
  {
    code: "landscape.service-unmodelled",
    severity: "error",
    via: VIA_ALL,
    what: "nothing in architecture/landscape.likec4 resolves to services/<id>/ — the fleet map is incomplete until an element exists or an existing one is bound with `metadata { service '<id>' }`. On the FLEET target for any service; on the SERVICE target too when that service's model.likec4 EXTENDS the map, where an unbound directory leaves the model with nothing to be inside and nothing in it can be graded",
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
    // The fleet map is the whole `architecture/` PROJECT, so this code fires for
    // a palette or a use case beside the landscape just as readily as for the
    // landscape itself — and the message names the document that broke. Saying
    // "landscape.likec4" here sent an author to a file with no errors in it.
    what: "the `architecture/` project does not parse — the landscape, or any `.likec4` beside it; the message names the document that broke. Fix it before anything else: the whole cross-service layer is unchecked until the map reads",
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
  // Evidence-gated: the model's own cross-boundary calls are the proof that
  // the map owes an edge, so a service whose model declares none stays silent
  // — that state is the adopt brief's to name (`landscape.touched`), never a
  // fleet finding that cannot tell a hermit from a batch job. And BINARY: one
  // edge closes it, because loam cannot tell a call the map forgot from one the
  // fleet deliberately does not draw at its own altitude, and a set difference
  // reported as an omission is an invented edge with a code beside it.
  { code: "landscape.service-isolated", severity: "warn", via: VIA_ALL, what: "an element resolves to services/<id>/ and no edge anywhere in architecture/ touches it, while model.likec4 declares a call across its boundary — the service is drawn and invisible to every cross-service check; silent when the model declares no such call, and silent once ONE edge is drawn: the check is touched/untouched, not a set difference over the attested calls" },
  // The four renderer-wiring grades, all repaired by one `loam subsystem sync`.
  // None of them fires on a baseline written from this brief: the model it asks
  // for extends the map, so it belongs to the root project and is owed no file
  // and no exclusion. They are listed because an agent adopting into an OLDER
  // repository — one whose root `likec4.config.json` still excludes
  // `services/**`, or that carries a hand-written project file — meets them on
  // the first `--all` run and must not read one as work on the model.
  {
    code: "service.likec4-config-missing",
    severity: "warn",
    via: VIA_ALL,
    what: "a model that stands alone (declares its own `specification`) renders only as a project of its own, and services/<id>/likec4.config.json is not there — `loam subsystem sync` writes it; without it the model is a box on the fleet map with nothing renderable inside it. Never raised for a model that extends the map",
  },
  {
    code: "service.likec4-config-stray",
    severity: "warn",
    via: VIA_ALL,
    what: "the reverse: model.likec4 extends the fleet map and a likec4.config.json sits beside it — the renderer registers that file as a project of its own, holding nothing, or holding the model alone where it cannot parse. Delete it; loam never writes one beside an extending model",
  },
  {
    code: "service.model-excluded",
    severity: "warn",
    via: VIA_ALL,
    what: "model.likec4 extends the fleet map and the root likec4.config.json's `exclude` hides it, so the renderer never loads it. Two entry shapes reach it: one covering the DIRECTORY, which `loam subsystem sync` rewrites (that command maintains the `services/` entries), and one shaped like a FILE (`services/**/model.likec4`), which sync cannot repair — the message says which one you have, and the file shape has to be removed or narrowed by hand",
  },
  {
    code: "service.model-unexcluded",
    severity: "warn",
    via: VIA_ALL,
    what: "the mirror, and the damaging one: a model that stands alone whose directory the root `exclude` does NOT cover — the renderer merges it into the map, reports every kind and element it declares as a duplicate, and blanks the whole root project, not just this service. Same repair",
  },
  // The same list, one level up: the entry covers the MAP. It is not a
  // per-service wiring grade and no `sync` repairs it — sync recomputes the
  // `services/` entries only — so it is listed separately from the four above.
  {
    code: "landscape.excluded",
    severity: "warn",
    via: VIA_ALL,
    what: "the root likec4.config.json's `exclude` covers architecture/landscape.likec4 itself — the renderer loads no fleet map at all, and every extending model in the root project resolves against nothing, while loam keeps grading the map it reads from disk. `c4.fleet-project-invalid` is not graded while the entry stands, because that check reads the renderer's project and would report this one line once per model. The finding quotes the entry verbatim; remove or narrow it by hand, because `loam subsystem sync` maintains only the `services/` entries in that list",
  },
  {
    code: "c4.fleet-project-invalid",
    severity: "warn",
    via: VIA_ALL,
    what: "every document reads clean where loam grades it, and the ONE project the renderer builds out of them — the map, every extending model, and every `.likec4` beside one — does not parse. A tag or an element declared in two of those documents is declared twice there; declare it once, in the map or in the single service that owns it. Not graded at all while `landscape.excluded` holds: with the map out of that project every `extend` is unresolvable, so the entry is the finding",
  },
];
