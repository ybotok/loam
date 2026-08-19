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

The current priority is the pilot. Every integrity, enforcement and lifecycle item that preceded it
has landed (see [Recently landed](#recently-landed)); what the product still lacks is evidence from
fleets that are not its own.

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

Health composition, built-in rendering, UI generation, landscape decomposition, and an authored
business axis remain candidate investments, not promises. Promote one only when pilot evidence names
the operator, repeated task, failure mode, frequency, current workaround, and measurable acceptance
criterion.

- **Health composition:** proceed only if both service-level `health.yaml` and fleet relationships are
  repeatedly being joined by hand and that work causes missed or contradictory checks. The result must
  compose declared signals; it must not infer operational truth from code or monitoring systems.
- **Rendering:** LikeC4 remains the renderer. A loam rendering command needs evidence that invocation,
  scoping, or artifact reproducibility is the recurring problem, and it must stay outside validation so
  view computation cannot slow or change the gate.
- **UI generation:** begin with a disposable projection over the stable JSON contract only after CLI
  consumers demonstrate a repeated navigation problem. It must not introduce a second mutable state,
  hidden workflow state, or a required service.
- **Landscape scaling:** retain one landscape while conflicts are exceptional. If same-service conflicts
  become routine — the current trigger in [SCHEMA.md](SCHEMA.md) is weekly rather than monthly — evaluate
  service-owned model files plus a thin global cross-service map. Migration must preserve archive/undo,
  deterministic resolution, and readable plain files.
- **Authored business axis:** proceed only if the rollup above maps the fleet's existing business
  documents onto real requirements and analysts still cannot write without editing `services/`. The
  recorded trigger is authorship: analyst edits appearing in `services/*/spec.md` history, or
  capability-level requirements accumulating as `intent.md` prose that no requirement realizes. The
  shape follows the cascade those documents already describe — a capability is revised, the revision
  changes the API, and the API change becomes per-service requirement changes — so promotion is a
  question of need rather than of design:
  - `capabilities/<cap>/spec.md` as a fourth top-level tree beside the three in
    [src/core/docs.ts](https://github.com/ybotok/loam/blob/main/src/core/docs.ts), carrying narrative
    **and** requirements in one document. The narrative slot is not decoration: OpenSpec's `## Purpose`
    prose has no loam equivalent today and is dropped into `legacy/` on migration, and an axis without
    room for it would repeat that loss on loam's own documents.
  - A stable capability id on the discipline `Requirement-ID` already establishes. These documents
    outlive every service named in them, so a rename stays one identity rather than becoming a removal
    and an addition.
  - Exactly one new authored join: `Realizes:` on a service requirement, written by whoever implements
    it rather than by the analyst. The API hop needs no line of its own — a capability requirement
    reaches its operations by composing `Realizes:` with the `Operations:` lines that already exist — so
    the whole cascade is expressible without a third place to keep in sync.
  - A feature-local `features/<FEAT>/capabilities/<cap>/` delta carrying the existing requirement
    grammar, delta algebra, `Based-On:` pins and `Requirement-ID` identity, merged by the same
    transactional archive, with `capability.uncovered` gating archive exactly as `c4.uncovered` does for
    a capability requirement the feature's own service deltas leave unrealized.
  - `loam new <FEAT> --capability <cap>` as an entry point, inverting today's `--touches <services>`: the
    analyst opens the document that changes, and the service work is derived from it rather than named
    before the business change is written.
  - Tens of documents, not hundreds. This corpus is sized like the landscape, not like the service tree,
    which is what keeps a second requirement corpus reviewable at all.
  - Two rules keep it from becoming a second copy of the same prose: a capability requirement must be
    observable outside the fleet and name no service — one that could be pasted into a service spec
    unchanged belongs there instead — and neither corpus is derived from the other. `gherkin` and
    `verify` must keep computing from service requirements, so a service repository can still validate
    itself with nothing but its own files.

Exit criteria for promoting a Later item:

- Evidence comes from at least two independent operators or fleets, except landscape scaling and the
  authored business axis, whose recorded triggers are sufficient.
- An ADR compares the existing workflow, external tooling, and the smallest loam-owned change.
- A prototype is measured against a predeclared acceptance criterion and preserves every non-goal below.
- The feature returns to this roadmap under a numbered priority before production implementation begins.

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
