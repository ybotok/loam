# Roadmap

_Assessed 2026-08-19._

This is loam's canonical improvement sequence. It records priorities and exit criteria, not delivery
dates. An item is complete only when its exit criteria are supported by repeatable evidence; moving
an item between sections is a product decision, not a wording change.

The compatibility boundary remains the one in
[AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md): command names and flags, exit
codes, the JSON envelope, and stable finding codes are public contracts. An improvement that changes
one of them needs an explicit compatibility decision and a user-visible CHANGELOG entry.

## Current assessment

loam is a credible beta with a differentiated core: architecture, requirements, contracts, generated
acceptance tests, and implementation evidence remain ordinary files in repositories rather than state
inside a service. The CLI is small enough to audit, and every writer — not only archive — now commits
through a locked, journaled transaction that a crash cannot leave half-applied.

The assessed tree (`5cd3942`) contains **261 TypeScript modules in 72 source packages**, with an
acyclic package graph checked by
[scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs). The CLI
exposes **21 commands** from [src/cli.ts](https://github.com/ybotok/loam/blob/main/src/cli.ts). On that
tree lint, typecheck and `npm run arch:check` were green, `npm test` passed **2,331/2,331 tests** across
102 test files, and the coverage gate passed with **91.84% statements, 84.17% branches, 96.13%
functions, and 94.01% lines** against its thresholds of 91 / 82 / 95 / 93.

One qualification remains, and it is observation rather than code: nothing has been pushed since the
CI `stability` job and the tarball-reading package smoke landed, so repeatable CI executions — the
stability job seen green, and the installed-package smoke run from a pushed commit — are
still release evidence to collect, even though the gate-stress proof passed locally on its landing
tree and the smoke passes locally against the real tarball. The runner class recorded on 2026-08-18 is
still the reading to apply to a red of that shape: a restricted filesystem sandbox that denies `tsx`
its local IPC socket fails only the
[test/cli-entry.test.ts](https://github.com/ybotok/loam/blob/main/test/cli-entry.test.ts) cases with
`listen EPERM` — a runner restriction, not a CLI behavior failure — and a sandbox that denies tmpdir
writes is the class under which `validate --all`'s batched parse degrades to per-document speed
without changing a finding.

The strongest foundations to preserve are:

- **Durable, inspectable source of truth.** The product still has no server, database, or runtime
  network dependency. Its document contract is described in [SCHEMA.md](SCHEMA.md), and only three
  packages are runtime dependencies in [package.json](package.json).
- **Explicit machine contracts.** The versioned JSON envelope and stable error codes live in
  [src/core/envelope/json.ts](https://github.com/ybotok/loam/blob/main/src/core/envelope/json.ts); issue
  severity, archive gating, and override semantics remain separate in
  [src/core/vocabulary/issue.ts](https://github.com/ybotok/loam/blob/main/src/core/vocabulary/issue.ts).
  [test/codes-drift.test.ts](https://github.com/ybotok/loam/blob/main/test/codes-drift.test.ts) and
  [test/agent-commands-runnable.test.ts](https://github.com/ybotok/loam/blob/main/test/agent-commands-runnable.test.ts)
  protect what agents branch on and what loam tells them to run, and
  [test/docs-facts.test.ts](https://github.com/ybotok/loam/blob/main/test/docs-facts.test.ts) plus
  [test/package-docs.test.ts](https://github.com/ybotok/loam/blob/main/test/package-docs.test.ts) hold
  the shipped prose to the same standard: counted facts derive or carry a date, named codes are codes
  loam emits, links resolve from the tarball, and every documented gap has its owner in this file.
- **One transactional write path.** Archive and unarchive keep their snapshot-backed path across
  [src/commands/archive/run.ts](https://github.com/ybotok/loam/blob/main/src/commands/archive/run.ts) and
  [src/core/staging/](https://github.com/ybotok/loam/tree/main/src/core/staging); every other multi-file
  writer — `new`, `gherkin`, `rebase`, `vouch`, `subsystem move` and `sync` — commits through the
  smaller journaled transaction in
  [src/core/staging/txn/](https://github.com/ybotok/loam/tree/main/src/core/staging/txn), whose staged
  bytes are durable beside their targets so recovery rolls forward, and the verification record commits
  under the same docs lock with a byte-level compare-and-swap. `validate` and `doctor` report an
  interrupted commit until recovery succeeds. This is the model for any future writer, not a
  subsystem to replace.
- **Path, identity and provenance discipline.** Lexical and real-path containment are centralized in
  [src/core/kernel/path-safety.ts](https://github.com/ybotok/loam/blob/main/src/core/kernel/path-safety.ts);
  validated ids and directories carry branded types constructible only in
  [src/core/kernel/ids/](https://github.com/ybotok/loam/tree/main/src/core/kernel/ids) and consumed
  through [src/core/repo/paths.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/paths.ts),
  with the casts contained by the architecture gate. Verification distinguishes an agent attestation
  from digest-matched test evidence through
  [src/core/verify/](https://github.com/ybotok/loam/tree/main/src/core/verify) and the verification
  record defined in [SCHEMA.md](SCHEMA.md).
- **Executable architecture.** `npm run arch:check`
  ([scripts/arch-check.mjs](https://github.com/ybotok/loam/blob/main/scripts/arch-check.mjs)) proves
  every invariant [docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) and
  [docs/CODE-STYLE.md](https://github.com/ybotok/loam/blob/main/docs/CODE-STYLE.md) state — import
  cycles, the package graph, the core→commands ban, the barrel ban, the console/process boundary,
  child-process bounds, brand-cast containment — each with a negative self-test in
  [test/arch-gate.test.ts](https://github.com/ybotok/loam/blob/main/test/arch-gate.test.ts); the
  300-line / four-parameter / five-file limits hold with an empty baseline in
  [test/code-limits.test.ts](https://github.com/ybotok/loam/blob/main/test/code-limits.test.ts);
  coverage thresholds are explicit in
  [vitest.config.ts](https://github.com/ybotok/loam/blob/main/vitest.config.ts); and
  [scripts/gate-stress.mjs](https://github.com/ybotok/loam/blob/main/scripts/gate-stress.mjs) makes
  gate stability a classified measurement rather than an impression.

## Now

The first priority is the pilot. Every integrity, enforcement and lifecycle item that preceded it
has landed (see [Recently landed](#recently-landed)); what the product still lacks is evidence from
fleets that are not its own. The second is the authored business axis, promoted out of `## Later`
when its recorded trigger fired and now part-landed.

### Complete the two-fleet pilot

Use the existing digest-bound harness in
[scripts/pilot-harness.mjs](https://github.com/ybotok/loam/blob/main/scripts/pilot-harness.mjs), the two
required profiles in [docs/pilot/README.md](https://github.com/ybotok/loam/blob/main/docs/pilot/README.md),
and the human review contract in
[docs/pilot/SCORECARD.md](https://github.com/ybotok/loam/blob/main/docs/pilot/SCORECARD.md). A toy fleet,
a repository maintained solely for loam, or two views of the same docs tree does not count.

Exit criteria:

- One owner-approved brownfield fleet and one independent active cross-service fleet satisfy the frozen
  selection criteria in
  [docs/pilot/manifest.schema.json](https://github.com/ybotok/loam/blob/main/docs/pilot/manifest.schema.json).
- Baseline and exit runs use the same fleet identities and one immutable, manifest-verified package
  candidate; raw proprietary documents do not enter this repository.
- Both fleets pass every automated exit gate and every human gate in
  [docs/pilot/README.md](https://github.com/ybotok/loam/blob/main/docs/pilot/README.md), including
  repeatable read output, an unchanged docs tree, healthy `doctor`, valid `validate --all`, and
  classified findings.
- Neither fleet encounters a P0/P1 integrity, security, or data-loss defect, and false positives are no
  more than 10% of classified findings.
- The reviewed scorecards link the machine evidence and give every failure or waiver an owner and an
  explicit release disposition. Blank or `not-assessed` fields cannot be called completion.

### The authored business axis — promoted from Later, its first phase landed

Promoted because its recorded trigger fired (see the item's history in `## Later` below, and
`git show 53c762a:ROADMAP.md` for the full gated text). It does not outrank the pilot: it is the
second item here because a fleet's analysts cannot wait on evidence from other people's fleets to
have anywhere to write, and because the use-case axis it depends on is complete.

**Landed, phase 1 — the tree.** `capabilities/<cap>/spec.md` as a fourth top-level tree, read by
the same requirement parser as every other `spec.md`, with nesting spelled by the tree and the
directory as the list. The capability vocabulary is now the UNION of
`architecture/capabilities.yaml` and that tree, and either one opts the fleet in. Three codes grade
the documents on their own terms: `capability.doc-missing` (warn),
`capability.requirement-unidentified` (error) and `capability.requirement-service-scoped` (error).

**Landed, phase 2 — the join.** `Realizes: <capability-id>#<Requirement-ID>` on a service
requirement, written by whoever implements it rather than by the analyst, and graded in both
directions: `capability.realizes-unknown` (error, and an archive gate in a feature delta) and
`capability.requirement-unrealized` (warn, one per capability requirement nothing realizes). A
third code closes the hole the first phase left open — `capability.requirement-inert-join` (error)
refuses the axis's own two joins written INSIDE a capability document, where nothing reads them.
The API hop needs no line of its own: a capability requirement reaches its operations by composing
`Realizes:` with the `Operations:` lines that already exist. `SCHEMA.md`'s capability section
carries the shape and the rules; `examples/docs/capabilities/` carries the worked pair, with three
service requirements realizing one promise and a fourth deliberately left unrealized.

**Landed, phase 3 — the flow.** A `dynamic view` tagged `#cap-<slug>` may carry `#req-<slug>` as
well, naming one of that capability's requirements, and `usecase.requirement-unresolved` (error)
grades the claim in six named arms. This is the join the axis was built for: a cross-service
criterion ("I enter a login and a password and I am in") belongs to no single service's spec,
because each promises only its own part, and only a flow can carry it. The measurement it was
gated on came back decisive — a LikeC4 tag name accepts exactly `[A-Za-z0-9_-]` and TRUNCATES at
anything else — so the slug rule became a whitelist and now serves both tags.

**Landed, phase 4 — the feature-local delta.** `features/<FEAT>/capabilities/<cap>/spec.md` carries
a delta in the existing requirement grammar, delta algebra and `Based-On:` pins; `loam archive`
merges it transactionally and creates the living document — and the `capabilities/` tree — when the
feature is the first to name that capability; `loam unarchive` takes it back; `loam rebase` pins it.
The three capability-document rules are graded on the delta as well, where they gate archive,
because otherwise the delta path is a hole straight through the rule that keeps the corpus from
becoming a second way to write service requirements.

**Two corrections to this item's own text, found by tracing the code rather than reading it.** The
first: `capability.uncovered` cannot gate archive "exactly as `c4.uncovered` does", because
**`c4.uncovered` never gates archive** — it is a validate-only `Finding` from `deltaArchCoverage`,
and the gate reads only `featureCoherence`'s `Issue[]`. The model to copy is `scaffold.placeholder`:
a warning that GATES, `--approve`-overridable, because the document is legal (writing a promise
ahead of the fleet is the intended use) while the MERGE is what is unsafe. The second: the item was
silent about the overlay, without which its own headline flow — add a capability requirement in a
feature and `Realizes:` it from that same feature's service delta — was refused by the existing
`capability.realizes-unknown` error.

**Landed, phase 5 — the archive gate, in both directions.** `capability.uncovered` (a warning that
GATES, `--approve`-overridable) refuses a feature that adds a business promise no `Realizes:` line
in its own service deltas keeps; the severity is the judgement, because the document is legal while
the merge is what is unsafe. `capability.remove-requirement-realized` (error) is the same join taken
in the removal direction, and it closed a hole that archived at exit 0 and left the next
`validate --all` red against a service document nobody had touched. A sibling code rather than one
code with two severities: the fixes differ, and a machine cannot branch on a severity that depends
on the case. `loam status --json` gained the `capabilities` artifact rows the business corpus was
missing from that table.

Remaining, in dependency order, each of which returns here as it lands:

1. **`loam new <FEAT> --capability <cap>`**, inverting today's `--touches <services>`: the analyst
   opens the document that changes, and the service work is derived from it.
2. **Informational surfaces** — `loam show`, `loam delta` and the context pack say nothing about a
   capability delta, so a feature carrying only one shows as carrying nothing. Probed for crashes:
   clean. The context pack stays deliberately excluded: it is one service's slice, and a capability
   delta names no service.
3. **A feature-local half-created capability directory is silent.** `docMissingFindings` runs over
   the LIVING tree only, so a `features/<FEAT>/capabilities/<id>/` holding no `spec.md` and nothing
   beneath earns nothing — the same `mkdir` mistake the living tree does warn about.

Deferred with a named trigger: a softened sibling of (1) for the case where one feature adds the
promise and another in flight carries the `Realizes:` line — the shape `delta.modified-pending` and
`spec-api.op-pending` already have. `--approve` covers it today, and a code shipped speculatively is
a branch nobody needed. Trigger: the pilot, or the first fleet that reports the ordering.

Exit criteria for calling the axis complete (the first is now MET — `loam list capabilities`
carries `keptBy` beside `realizedBy` on every promise, and `capability.unrealized` counts both
corpora, so the listing and the gate give one answer):

- A capability requirement is realizable by service requirements AND by a use case, and
  `loam list capabilities` reports both without either corpus being derived from the other.
- `gherkin` and `verify` still compute from service requirements alone, so a service repository
  validates itself with nothing but its own files.
- A fleet holding neither `architecture/capabilities.yaml` nor `capabilities/` still produces no
  capability finding of any kind.

Two rules must not be softened, because they are the answer to the old rejection ("a second copy
of text that already exists in the living specs"): a capability requirement must be observable
outside the fleet and name no service — one that could be pasted into a service spec unchanged
belongs there instead — and neither corpus is derived from the other. Only the first half of the
first rule is mechanically checked, and `SCHEMA.md` says so: matching service names in prose is a
heuristic, and loam refuses that class of check.

## Recently landed

Closed since the 2026-08-18 assessment, each with the commit or commit range that landed it on `main`.
[CHANGELOG.md](CHANGELOG.md) is the user-facing record; the full item texts — required changes, exit
criteria, and what each review surfaced — are in this file's history (`git show 5cd3942:ROADMAP.md`).

- Atomic, locked, compare-and-swap verification records — `60f4df6`.
- Full-gate concurrency stability: the classified stress runner and host probe — `d9b396a`.
- Crash-consistent multi-file writers: the journaled roll-forward transaction — `88e9026`.
- Executable architecture invariants: `npm run arch:check` and the brand migration — `0106b49`…`9c0f01e`.
- Baseline semantics for OpenAPI path items and components — `0824b02`…`246a800`.
- OpenSpec corpus rebaselined at v1.9 beside the historical v1.7 — `9a0c6d7`, `724ab15`.
- `validate --all` fit for the fleet gate: one LikeC4 workspace, 18.8x — `f66ff56`…`56b031d`.
- The AsyncAPI feature lifecycle, mirrored axis-for-axis — `c5e205c`…`8837e9b`.
- Subsystems: a navigable tree under `services/` that no identity depends on — `600a696`…`8aee101`.
- The capability vocabulary, the requirement join and the `list capabilities` rollup — `2bd9400`…`e26ff9f`.
- Documentation, package-content and link protection — `6ea2a68`…`08330ea`; paper trails `5cd3942`.

Honest leftovers. Two live outside this repository: the CI `stability` job has still to be observed
green, which needs a push and then a `workflow_dispatch`; and both pilot fleets meeting their
predeclared `maxValidateMs` is the pilot's evidence, not this tree's. One is recorded inside it rather
than silently true: a components-only OpenAPI feature contract (no `paths` mapping) passes the
baseline gate but merges nothing, because the merge answers no-op before the closure runs, and
a slot-less feature asyncapi.yaml merges nothing either — content outside the three slot sections
never merges, with the one guard that a merged slot referencing a feature-only schema gates
`asyncapi.ref-unresolved` at plan time instead of landing a dangling pointer. Still open on both axes.

## Later — promote only from evidence

Health composition, built-in rendering, UI generation and landscape decomposition remain candidate
investments, not promises. Promote one only when pilot evidence names the operator, repeated task,
failure mode, frequency, current workaround, and measurable acceptance criterion. The authored
business axis stays listed below because its trigger and its reasoning are the record of how a Later
item gets promoted — it has already moved to `## Now`.

- **Health composition:** proceed only if both service-level `health.yaml` and fleet relationships are
  repeatedly being joined by hand and that work causes missed or contradictory checks. The result must
  compose declared signals; it must not infer operational truth from code or monitoring systems.
- **Rendering:** LikeC4 remains the renderer. A loam rendering command needs evidence that invocation,
  scoping, or artifact reproducibility is the recurring problem, and it must stay outside validation so
  view computation cannot slow or change the gate. This item is about **drawing**, and LikeC4 keeps that
  job. Reading a `dynamic view`'s declared steps is not rendering and is not this item — see
  docs/DESIGN.md rule 26.
- **UI generation:** begin with a disposable projection over the stable JSON contract only after CLI
  consumers demonstrate a repeated navigation problem. It must not introduce a second mutable state,
  hidden workflow state, or a required service.
- **Domain glossary — queued, and sequenced after the business axis.** Requirements and specs work
  over a domain, and nothing in loam holds its vocabulary: there is no glossary concept anywhere,
  not even a rejected one. The shape is `glossary/<term>.md`, one file per term — NOT a
  `glossary.yaml`, because a single vocabulary file at fleet scale is unworkable and a second list
  is the drift `loam init`'s removed service manifest was removed for: the directory IS the list.
  The general rule it settles: **an entry with prose gets a file; an entry without prose stays a
  line in YAML** — which is why `permissions.yaml` stays as it is.

  It is checkable because **a link is a join**. A spec links to a term's file; loam resolves the
  target (an error when it does not exist, as `capability.unknown` is) and reports a term nothing
  links to (a warning, as `capability.unrealized` is). That is exact where matching words in prose
  would be a heuristic. It is sequenced after the business axis because `capabilities/<cap>/spec.md`
  is where domain words appear thickest, and a glossary with nothing linking to it proves nothing.

- **Architectural obligations — queued, with a prerequisite.** An architect has one working channel
  to a team today and it is checked: an edge carrying `metadata { op }` obliges the provider to
  define that operationId or `spine.op-undefined` fails the gate. There is no equivalent for the
  obligations that vary per service — an outbox here, a circuit breaker there, neither everywhere.
  The shape reuses what exists: a fleet **ADR** says what was decided, a **tag** on a landscape
  element or edge says where it applies, and the team's **`Covers:`** says it is met, with a
  declared vocabulary in the shape `permissions.yaml` and `capabilities.yaml` already have.

  **The prerequisite is that `Covers:` must resolve against the LIVING landscape.** `c4.uncovered`
  grades a tagged element or edge in a feature's `delta.likec4` only, so loam can already say "this
  architecture object owes a requirement" — just never about the map a fleet actually runs on.
  Moving that is the half of the work that is not new code.

- **Landscape scaling:** retain one landscape while conflicts are exceptional. If same-service conflicts
  become routine — the current trigger in [SCHEMA.md](SCHEMA.md) is weekly rather than monthly — evaluate
  service-owned model files plus a thin global cross-service map. Migration must preserve archive/undo,
  deterministic resolution, and readable plain files.
- **Authored business axis — PROMOTED 2026-08-27 and part-landed; see [The authored business axis](#the-authored-business-axis--promoted-from-later-its-first-phase-landed) under `## Now`.**
  The gate asked for evidence of authorship: analyst edits appearing in `services/*/spec.md`
  history, or capability-level requirements accumulating as `intent.md` prose that no requirement
  realizes. The maintainer supplied it as a statement about how his fleet works rather than as git
  history — business does not think in services, and an analyst does not write them — and the shape
  of the hole was verified rather than argued: **every requirement loam knew belonged to exactly one
  service directory**, so an analyst’s whole surface was a declared name in `capabilities.yaml` plus
  an `intent.md` that is archived with its feature. No living business-level document existed at any
  altitude. The full gated text, including the four sub-items and the cascade it follows, is in this
  file’s history (`git show 53c762a:ROADMAP.md`).

Exit criteria for promoting a Later item:

- Evidence comes from at least two independent operators or fleets, except landscape scaling and the
  authored business axis, whose recorded triggers are sufficient.
- An ADR compares the existing workflow, external tooling, and the smallest loam-owned change.
- A prototype is measured against a predeclared acceptance criterion and preserves every non-goal below.
- The feature returns to this roadmap under a numbered priority before production implementation begins.

## Self-hosting: loam on loam

Placed in a section of its own, and the placement is the argument. This is not the "Now" item — the
pilot is, and nothing here may be mistaken for it. It is not a "Later" candidate either: promotion
from that section requires evidence from at least two independent operators or fleets (bar the two
whose recorded triggers were judged sufficient when they were written), and loam's own repository is
one operator by construction, so a Later entry could only ever be a permanent exception to the rule
it sits under. Nor is its value speculative — the trigger below is a defect this repository has
already produced by hand. As with every other section here, the position implies no schedule.

### Model loam's own architecture in loam

loam's architecture is already specified in prose and already executable:
[docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) states it as numbered
rules, and `npm run arch:check`
([scripts/arch-check.mjs](https://github.com/ybotok/loam/blob/main/scripts/arch-check.mjs)) over
[scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs) is
their proof. That is exactly the shape of an `arch.spec.md` whose requirements carry `Covers:` lines
onto a LikeC4 model of loam's own package graph — the one axis where loam's subject matter and loam's
own tree are the same object.

The recorded trigger is two defects that reviewers caught **by hand** during the session that
produced the current `[Unreleased]` [CHANGELOG.md](CHANGELOG.md), both of which a
`c4.uncovered`-style check convicts mechanically: a package of one file — a `core/review/`, against
DESIGN's own "a package of one is a directory pretending to be a subject" — and a package-layout
table that had stopped describing the tree. The second is still open as this is written. Checked
2026-08-27: DESIGN carries 27 numbered rules across its two lists, and its package-layout table has
no row for `core/brief/` or `core/provenance/`, which predate this session, or for `core/explain/` or
`core/owners/`, which it added. A model whose elements are the real packages cannot leave four of
them unnamed and stay valid.

What does not fit is larger, and pretending otherwise would be the failure this document is written
against. loam is one CLI, not a fleet: there is no service topology, no OpenAPI, no AsyncAPI and no
authorization vocabulary, so the `operationId` spine, the message spine and `Requires:` have nothing
to join. Roughly half of `validate`'s checks would be permanently silent, and a check that is silent
because nothing asked it must never be read as a check that passed. The evidence axis is worse:
loam's own tests are vitest, not cucumber, so every scenario claim would be `attested` and never
`verified` — the distinction loam exists to make would be the one property self-hosting does not
exercise. Building a vitest-to-cucumber-JSON bridge to improve that number is precisely the invented
need the non-goals below forbid — "an agent-confirmed scenario does not become verified merely to
make a gate green" — and if such a bridge ever lands it must be because someone's fleet needed it.

One layout constraint is settled rather than open. `loam.json` is in
[.gitignore](https://github.com/ybotok/loam/blob/main/.gitignore), and README's Quick start tells the
reader to write a throwaway one at the repo root pointing at
[`examples/docs/`](https://github.com/ybotok/loam/tree/main/examples/docs); a committed root config
would break the documented first experience for every reader who follows it. The self-docs therefore
live under a subdirectory carrying its own config — `meta/loam.json` over `meta/docs/` — which works
because config discovery walks upward from the cwd.

**Self-hosting cannot count toward the pilot.** [Its exit criterion](#complete-the-two-fleet-pilot)
already excludes this repository by name: "A toy fleet, a repository maintained solely for loam, or
two views of the same docs tree does not count." That is not an obstacle to route around; it is the
reason this item is written separately. The pilot buys proof from fleets that are not loam's own.
This buys daily pressure on loam's own seams — a different kind of evidence, and no substitute for
the first.

The recommended first step is the architecture axis only:

- `meta/docs/` holding one landscape whose elements are loam's own source packages and whose edges
  are the real import edges
  [scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs)
  already computes.
- One service, `loam`, whose `arch.spec.md` carries DESIGN's numbered rules as requirements with
  `Covers:` lines onto that model.
- `loam validate --all` running in CI beside `npm run arch:check`, in
  [.github/workflows/ci.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/ci.yml).

Exit criteria:

- The self-model convicts at least one real drift `arch:check` cannot see — a package with no
  element, an element with no package, or a rule no requirement covers — and that drift is fixed in
  the change that records it.
- No artifact exists only to make a check fire: no invented `openapi.yaml`, no `asyncapi.yaml`, no
  authorization vocabulary, no service that does not exist. The families with nothing to join stay
  silent, and this file names which ones they are, so a green run here is never read as a fleet's
  worth of coverage.
- The added CI cost is measured on the same runner as the rest of the gate and written down, so the
  next reader knows what self-hosting charges per push.
- No root `loam.json` is committed, and the Quick start's throwaway-config block still runs verbatim
  from a fresh clone.
- Every scenario claim this model produces stays `attested` while loam's suite is vitest, and nothing
  is built to convert one into `verified`.

Not decided, deliberately: whether loam's own features go through the forward flow — `loam new`,
`loam delta` and `loam verify` per feature. That is a far larger process commitment than one modeled
axis, because it changes how every change to this repository is written rather than how one property
of it is checked. Promote it only from experience with the step above.

## Non-goals

- No hosted control plane, server, database, background synchronizer, or network-owned source of truth.
- No code extractor or generated architecture presented as truth. Agents may read and propose; loam owns
  deterministic questions, formats, and checks.
- No full OpenSpec clone, bidirectional OpenSpec writer, or claim of compatibility beyond the exact
  pinned corpus and explicitly supported Markdown grammar.
- No replacement for LikeC4's renderer, the forge's ownership/review controls, or a service's contract
  and test tooling.
- No weakening of attested-versus-tested evidence: an agent-confirmed scenario does not become verified
  merely to make a gate green.
- No runtime dependency added to avoid implementing a small invariant with Node and the existing stack.
- No workspace split, barrel exports, command-oriented vertical slices, or architectural rewrite for
  aesthetics. The single binary and acyclic source-package tree remain deliberate.
- No silent break to commands, flags, exit codes, JSON envelope fields, stable codes, or the plain-file
  formats users already commit.
- No schedule inferred from section order. Priority says what must become true first; evidence decides
  when it is true.
