# Roadmap

_Assessed 2026-09-03._

This is loam's canonical improvement sequence. It records priorities and exit criteria, not delivery
dates. An item is complete only when its exit criteria are supported by repeatable evidence; moving
an item between sections is a product decision, not a wording change.

The compatibility boundary remains the one in
[AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md): command names and flags, exit
codes, the JSON envelope, and stable finding codes are public contracts. An improvement that changes
one of them needs an explicit compatibility decision and a user-visible CHANGELOG entry.

## Current assessment

loam is a credible beta with a differentiated core: architecture, requirements, contracts, generated
acceptance tests, and implementation evidence remain ordinary files in repositories rather than
state inside a service. The CLI is small enough to audit, and every writer — not only archive — now
commits through a locked, journaled transaction that a crash cannot leave half-applied.

The tree contains **427 TypeScript modules in 130 source packages**, with an acyclic package graph
checked by
[scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs). The
CLI exposes **29 commands** from [src/cli.ts](https://github.com/ybotok/loam/blob/main/src/cli.ts),
and the suite stands at **157 test files**. Those four counts are deliberately stated OUTSIDE the
dated snapshot below: each derives from the tree in one readdir, so
[test/docs-facts.test.ts](https://github.com/ybotok/loam/blob/main/test/docs-facts.test.ts) grades
them live and this paragraph cannot quietly trail the code the way its predecessor did.

_Measured 2026-09-03 at `0.2.0-alpha.3`, and dated because neither number has a cheap derivation:_
lint, typecheck, `npm run arch:check` and `npm run meta:check` green; `npm test` passing
**3,408/3,408 tests**, with two `skipIf(asRoot)` cases the root gate container cannot run; the
coverage gate passing with **92.26% statements, 84.05% branches, 96.62% functions, and 94.20%
lines** against its thresholds of 91 / 82 / 95 / 93; and `npm run release:check` plus
`npm run test:package` green against the real tarball.

One qualification remains, and it is observation rather than code: nothing has been pushed since the
CI `stability` job and the tarball-reading package smoke landed, so repeatable CI executions — the
stability job seen green, and the installed-package smoke run from a pushed commit — are still
release evidence to collect, even though the gate-stress proof passed locally on its landing tree
and the smoke passes locally against the real tarball. The runner class recorded on 2026-08-18 is
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
  [src/core/envelope/json.ts](https://github.com/ybotok/loam/blob/main/src/core/envelope/json.ts);
  issue severity, archive gating, and override semantics remain separate in
  [src/core/vocabulary/issue.ts](https://github.com/ybotok/loam/blob/main/src/core/vocabulary/issue.ts).
  [test/codes-drift.test.ts](https://github.com/ybotok/loam/blob/main/test/codes-drift.test.ts) and
  [test/agent-commands-runnable.test.ts](https://github.com/ybotok/loam/blob/main/test/agent-commands-runnable.test.ts)
  protect what agents branch on and what loam tells them to run, and
  [test/docs-facts.test.ts](https://github.com/ybotok/loam/blob/main/test/docs-facts.test.ts) plus
  [test/package-docs.test.ts](https://github.com/ybotok/loam/blob/main/test/package-docs.test.ts)
  hold the shipped prose to the same standard: counted facts derive or carry a date, named codes are
  codes loam emits, links resolve from the tarball, and every documented gap has its owner in this
  file.
- **One transactional write path.** Archive and unarchive keep their snapshot-backed path across
  [src/commands/archive/run.ts](https://github.com/ybotok/loam/blob/main/src/commands/archive/run.ts)
  and [src/core/staging/](https://github.com/ybotok/loam/tree/main/src/core/staging); every other
  multi-file writer — `new`, `gherkin`, `rebase`, `vouch`, `subsystem move` and `sync` — commits
  through the smaller journaled transaction in
  [src/core/staging/txn/](https://github.com/ybotok/loam/tree/main/src/core/staging/txn), whose
  staged bytes are durable beside their targets so recovery rolls forward, and the verification
  record commits under the same docs lock with a byte-level compare-and-swap. `validate` and
  `doctor` report an interrupted commit until recovery succeeds. This is the model for any future
  writer, not a subsystem to replace.
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
  400-line / four-parameter / five-file limits hold with an empty baseline in
  [test/code-limits.test.ts](https://github.com/ybotok/loam/blob/main/test/code-limits.test.ts);
  coverage thresholds are explicit in
  [vitest.config.ts](https://github.com/ybotok/loam/blob/main/vitest.config.ts); and
  [scripts/gate-stress.mjs](https://github.com/ybotok/loam/blob/main/scripts/gate-stress.mjs) makes
  gate stability a classified measurement rather than an impression.

## Now

Nothing is queued behind code. Every integrity, enforcement and lifecycle item that preceded this
has landed (see [Recently landed](#recently-landed)) — the authored business axis, the use-case
axis, and as of 2026-09-02 the deployment axis, which is the first item this file ever wrote
directly into this section rather than promoting from [Later](#later--promote-only-from-evidence).

### Release evidence, unchanged

What is left is the one thing this file cannot close by writing code, and it stays
where it is rather than being promoted for the shape of it: the CI `stability` job and the
installed-package smoke have still to be OBSERVED green from a pushed commit. That is release
evidence to collect, not an improvement to make.

An item returns to this section from [Later](#later--promote-only-from-evidence) when fleet evidence
names its operator, repeated task, failure mode, frequency, current workaround and measurable
acceptance criterion — never because this section is empty. An empty `## Now` is a true statement
about the backlog, and filling it from the candidate list to avoid the appearance of one would be
exactly the invented need the non-goals forbid.

## Recently landed

Closed since the 2026-08-18 assessment, each with the commit or commit range that landed it on
`main`. [CHANGELOG.md](CHANGELOG.md) is the user-facing record; the full item texts — required
changes, exit criteria, and what each review surfaced — are in this file's history (`git show
5cd3942:ROADMAP.md`). The three use-case entries below carry no range yet: they are green in the
working tree and not committed, and the range goes in with the commit rather than being guessed at
here.

#### The generated subsystem views — a label, a boundary, and one reader of the map

**Landed 2026-09-03.** Three problem reports from a 56-service fleet, one axis. The generated
`architecture/subsystems.likec4` exists only to be rendered and was the least readable object in a
docs repo: no `title`, so the renderer showed the hex-escaped view id, and leaf includes only, so a
fleet drawn as grouped C4 rendered flat. Each view now carries the marker's title (the directory
name when it has none) and description, and draws a boundary the LANDSCAPE decides: the model's own
containing element when one holds exactly the members, a `group` mirroring the directory subtree
when the map nests nothing, and one `// model: no boundary — …` comment when the two disagree.
That comment is the whole answer to the drift the third report asked about — disclosure in a
generated artifact, never a finding, because grading placement against the map is the policy the
tree is defined not to carry. The graded alternative is written down under
[Later](#later--promote-only-from-evidence) with the evidence bar it has to clear.

The hunt found what neither report did: `validate --all` graded that file against the whole
`architecture/` project while every writer rendered it from `landscape.likec4` alone, so a
use-case document binding one element could produce a `subsystem.views-stale` that
`loam subsystem sync` reported as `current` — reproduced on `examples/docs`, and fixed by pointing
both sides at the same read.

#### The deployment axis — topology joined to requirements

**Promoted 2026-09-02, and authored as a feature in loam's own docs repo** rather than as an item
text here: `meta/docs/features/archive/FEAT-1-the-deployment-axis/`, whose `intent.md` carries the
four measurements and whose `specs/loam/arch.spec.md` carries the five rules the change establishes,
each with scenarios. This entry is the decision and the gate; that feature is the specification, and
the two must not be allowed to become two accounts of the same change.

**Landed 2026-09-02, complete.** Every step is in, and step 4 was corrected rather than built
(below) — the item specified two finding codes that the implementation showed it should not mint.
FEAT-1 archived once every edge it claimed existed —
and it archived having been CORRECTED against the tree twice, which is the argument for the route
rather than a footnote to it: the delta predicted a `core/kernel/` dependency that turned out to be
type-only (a brand costs an annotation, not an import) and missed `core/coherence/` entirely.
`npm run meta:check` was red for the whole of the build and went green with the archive, which is
the axis working rather than a gap in it.

The whole change is reviewable as five commits on `feat/deployment-axis`, and the one thing to read
first is what the implementation taught the plan: two of the codes this item specified were not
minted, and the reasons are in step 4.

**What is wrong today.** A LikeC4 `deployment { }` block is legal in a docs repo and completely
unread. The parser resolves every `instanceOf` in it — a container renamed out from under a
deployment node fails the gate as `landscape.invalid` — and after that nothing: no requirement can
name a node, no report counts one, and the context pack an agent implements from does not mention
topology at all. Two of the four measurements taken on a copy of `examples/docs` are the reason this
is an item rather than a wish. A `#obl-` tag on a `deploymentNode` is invisible to
`validate/fleet/obligations.ts`, which walks the logical model only — the same undeclared tag raises
`obligation.unknown` on a container and nothing on a datacenter, which is fail-open and a defect on
its own terms. And `parsedModel().deployment` already returns nodes with their tags, instances
carrying the id of the logical element each one instances, and relationships carrying metadata, so
the read costs no second parse, no new file format and no change to the frozen CLI surface.

**Required changes**, in the order the dependency graph forces:

1. Walk the deployment model in every `#obl-` grade. Fail-open becomes fail-closed; no new code.
2. A fourth `Covers:` entry form, `node:<id>`, with the same prefix accepted on either side of the
   edge form. No new code.
3. The parse adapter in `src/core/c4/parsed/`, and the deployment records added to
   `test/likec4-model-parity.test.ts` — a two-stage substitution nothing measures is an assumption.
   `src/core/c4/` holds exactly five files, so this is a sub-package and not a sixth module.
4. **No new finding code, and this is a correction the implementation earned.** The item planned
   two. The first, for a tagged node or edge no living arch requirement covers, turned out to be
   `obligation.uncovered` asked of a second model: once step 1 walks the topology, the existing code
   answers it, and a caller acts identically either way — write a `Covers:` line. A second code for
   one question is exactly what the add-a-code checklist refuses. The second, for a container no
   deployment instances, is declined outright: it asserts that everything modelled ought to be
   deployed somewhere, which is a COMPLETENESS claim, and completeness is the one thing
   `src/core/brief/unchecked.ts` says loam never checks. It is the same category error as the
   at-least-two-datacenters rule below, one axis over.
5. `features/<FEAT>/deployment/<name>.likec4`, create-only and copied whole — `core/usecases/delta/`
   one axis over. It works because `extend` was measured to resolve across documents of one project,
   so no text splice is needed; `delta-blocks.ts` goes on refusing a `deployment { }` block inside
   `delta.likec4` and its message names the new slot. The collision is on the FILE, never on what is
   inside it: two features may both extend one living region from documents of their own and both
   archive, which is the shape the fleet-wide change actually takes.

   **Graded against the merge preview**, which shipped one commit behind the slot and is the
   second code, `deployment.doc-invalid` (error, never overridable). This axis needs the post-merge
   corpus more literally than the use-case one: a feature that stands a NEW service up in a cluster
   declares it in `delta.likec4` and instances it in the topology, so the element the document names
   exists only after the merge. The staging that makes that readable moved OUT of
   `core/usecases/delta/overlay.ts` into `core/c4/project/staged.ts` rather than being copied — the
   two axes would have disagreed first about the merge preview, which is the one thing both
   refusals rest on. The extraction dropped `core/usecases/` → `core/kernel/`, which is a one-line
   edge and was edited into the model directly.
6. The surfaces: the topology in the context pack (`context --json`'s `living.deployment`), the code
   table `test/codes-drift.test.ts` requires, and one more statement in
   `src/core/brief/unchecked.ts`. `loam explain` needed nothing — it parses the /loam-check fix
   tables at runtime, so the rows added there ARE the entries. The scorecard row the item listed was
   dropped: the fleet scorecard aggregates at the bound `service`, and a topology row there would
   count deployment nodes against a denominator no service owns.

**Exit criteria.** Every step above green under the full gate; `covers.unknown` demonstrated firing
on a covered node that a topology change renamed, which is the acceptance criterion the trigger
names; the parity suite extended and shown to fail against an un-extended adapter; and
`test/self-model.test.ts` re-pinned once FEAT-1 archives.

**Out of scope, and each refusal is load-bearing.** No reading of Terraform, Helm or cluster state —
that is the extractor the non-goals forbid. No check that a service is deployed in at least two
datacenters: it would need `criticality` promoted from prose to a read field, and it would turn
`architecture/obligations.yaml` into the policy engine that file says in its own words it is not. A
multi-datacenter rule is an authored requirement whose `Covers:` line names the nodes; loam grades
the join and never the architecture. And no `environment` concept above LikeC4, because
`deploymentNode` is that mechanism and the fleet names its own kinds.

**The evidence, and its one gap stated plainly.** Operator: a team standing up a standby cluster in
a second datacenter. Repeated task: keeping RTO/RPO requirements attached to a topology that keeps
changing. Failure mode: a requirement about replication staying green after the node it described
was renamed or removed. Frequency: every topology change, which is the cadence a migration runs at.
Current workaround: a `Covers:` line that resolves to nothing, or no written requirement at all.
Acceptance criterion: a topology change that orphans a covered requirement is convicted without a
human noticing it first. **That is one operator, not two.** The maintainer judged the trigger
sufficient on the same basis recorded for landscape scaling and the authored business axis, and the
[Later](#later--promote-only-from-evidence) exit criteria are amended below to say so rather than
leaving the two paragraphs to contradict each other. Steps 1 and 2 do not rest on that judgement at
all: the first is a fail-open defect and the second is a grammar entry, and neither is a new axis.


- **A feature can bring a use case.** `features/<FEAT>/usecases/<name>.likec4` — a views-only
  document `loam archive` copies into `architecture/usecases/` and `loam unarchive` takes back,
  create-only, refused by `usecase.flow-exists` when the living tree already holds that file. All
  four exit criteria: a `#req-` tag in it resolves against the feature's own capability delta as
  well as the living tree (the both-corpora rule `Realizes:` follows); `capability.uncovered` counts
  a resolved feature-local flow as cover, and its message now names the slot instead of telling an
  author to `--approve` first and tag the flow afterwards; the merge and its undo go through the
  transaction every other axis already uses; and a flow is graded against the map its own merge
  would leave behind, so a hop may name a service the feature's `delta.likec4` adds while a hop
  naming an element the merge does NOT land is `usecase.flow-invalid` — refused at plan time, with
  `--approve` deliberately unable to move it. The design decision worth recording is the one the
  item flagged as open: the overlay is the ARCHIVE'S OWN MERGE PREVIEW, computed with
  `planLandscapeMerge` rather than approximated, so a flow can never be graded against a map the
  merge does not write. `delta.likec4` still refuses a `dynamic view` and the reason is mechanical
  rather than policy — it re-declares the landscape's identifiers and carries its own
  `specification` block, so it cannot be staged beside the map in one LikeC4 project — but its
  message now names the slot that exists.
- **One predicate answers "is this a use case".** `isUseCase` moved out of
  `core/usecases/fleet.ts`'s private scope, widened to either reserved prefix, and is now the only
  spelling: `validate`'s `gradedViews`, the fleet-flow read behind `capability.requirement-unrealized`,
  and every reader behind `loam diff`, `delta`, `status`, the packs and `list capabilities` take it.
  The byte gate that lets a fleet with no use cases skip the LikeC4 load was widened with it, and
  that half mattered more than the predicate: a fleet whose only flow was `#req-`-tagged declared
  `tag req-…` and no `cap-` anywhere, so the scan answered "no use cases" and nothing loaded the
  project at all. Six tests pin it, each proven to fail against the narrowed predicate.

  Two of the exit criterion's named readers do NOT show a `#req-`-only view, and the wording was
  wrong rather than the code: `loam explore --capability` seeds through `flowsClaiming`, which
  matches the whole `cap-<slug>` tag, and `list capabilities`' `keptBy` needs exactly one RESOLVED
  `#cap-` scope before a `#req-` tag means anything. A view with no capability tag claims no
  capability — correctly, and in both places. What the widening buys them is that such a view is
  now SEEN: it opts the fleet in, so the flows are read and `useCases.unreadable` answers honestly
  instead of the scan reporting a fleet with no use cases.
- **A step-definition catalogue.** Decided in writing first, as the item required, and the decision
  is AUTHORED rather than emitted: `services/<svc>/steps.yaml`, a `steps:` list of step texts,
  recording which phrases a team has agreed its suite defines. Four things decided it — loam does not
  read code and must not present a derived thing as truth, so what can honestly be written down is a
  decision and not an observation; `loam steps` needs no service repo to stand in and a catalogue
  beside the code would make it need one; the rule the glossary and capability trees settled puts an
  entry without prose in YAML; and nothing generated may land inside `<gherkinDir>/loam/`, which
  `loam gherkin` owns and overwrites wholesale. `loam steps` now reports written phrases against
  catalogued ones both ways round, so a phrase nobody has defined is distinguishable from one nobody
  has written, and an ABSENT catalogue is distinguishable from an UNREADABLE one — reporting either
  as "nothing catalogued" would print a whole suite as work owed. **The axis carries no stable code
  and `loam validate` never reads it**: a phrase written before its glue is the normal order of work,
  the near-duplicate groups stay a report, and no phrase-similarity finding ships. Entries are step
  TEXTS rather than keys, because the key is loam's own normalisation and asking an author to type
  it would make an internal spelling a hand-written contract.

- The authored business axis, end to end: the `capabilities/<cap>/spec.md` tree, `Realizes:` with
  its living pin, the `#req-` flow join, the feature-local delta, the archive gate in both
  directions and `loam new --capability` — `1c5541a`…`0850538`. Every remainder the item listed is
  closed: the flag is registered, `show` and `delta` project a capability delta, and a half-created
  `features/<FEAT>/capabilities/<id>/` is graded. Full item text: `git show ab4c856:ROADMAP.md`.
- The living `Realizes:` pin and `capability.realizes-stale`, with `loam rebase --living` — the
  product's first standing suspect link over the LIVING corpus, and the answer to the one failure
  class that decayed silently after a successful archive. Every other capability check is an
  existence constraint and goes quiet when a target merely changes.
- The spine-first first hour: `examples/fleet.yaml`, day zero starting at `loam seed`, and a
  README entry point that reaches a cross-service conviction with no requirement Markdown at all.
- `contracts.openapi` in `loam.json`: the build's own contract read as a check
  (`openapi.generated-stale`, `contracts.source-missing`, `contracts.source-invalid`). Closes the
  most load-bearing untested premise in SCHEMA — that the committed contract is the one the
  service serves — without becoming a writer or an extractor.
- `spec.unknown-directive`: the near-miss grammar guard. An unrecognised body-line key is prose,
  so the join it resembles does not exist and every check over it stays green for want of anything
  to fail.
- `checklist` and `docsCommit` on each attestation, plus `verify.checklist-forked` — a federated
  record can now say WHICH service's answers went stale rather than flagging all or none.
- Atomic, locked, compare-and-swap verification records — `60f4df6`.
- Full-gate concurrency stability: the classified stress runner and host probe — `d9b396a`.
- Crash-consistent multi-file writers: the journaled roll-forward transaction — `88e9026`.
- Executable architecture invariants: `npm run arch:check` and the brand migration —
  `0106b49`…`9c0f01e`.
- Baseline semantics for OpenAPI path items and components — `0824b02`…`246a800`.
- OpenSpec corpus rebaselined at v1.9 beside the historical v1.7 — `9a0c6d7`, `724ab15`.
- `validate --all` fit for the fleet gate: one LikeC4 workspace, 18.8x — `f66ff56`…`56b031d`.
- The AsyncAPI feature lifecycle, mirrored axis-for-axis — `c5e205c`…`8837e9b`.
- Subsystems: a navigable tree under `services/` that no identity depends on — `600a696`…`8aee101`.
- The capability vocabulary, the requirement join and the `list capabilities` rollup —
  `2bd9400`…`e26ff9f`.
- Documentation, package-content and link protection — `6ea2a68`…`08330ea`; paper trails `5cd3942`.
- The domain glossary, and the link check that makes it exact — `bc1b936`…`44a5386`.
- Architectural obligations: the ADR, the `#obl-` tag and the living `Covers:` index — `0b5fc24`.

Honest leftovers. One remains, and it lives outside this repository: the CI `stability` job has
still to be observed green, which needs a push and then a `workflow_dispatch`.

The two merge holes recorded here are closed, and they were not the same defect. On the OpenAPI axis
the capability existed and was merely unreachable: the merge tested `paths` for absence and answered
no-op before it had parsed the living document, while the component closure is the last thing it
runs. It now consults the surface enumeration instead, and a genuinely new component is promoted
BEFORE the ref fixpoint is seeded rather than after, so its own `$ref`s ride the same sweep.

On the event axis the capability did not exist. AsyncAPI had no surface enumeration outside the
three slots, no root baseline record, and no pin that could reach a `components.schemas` value — the
event pin is written INTO a slot value, which works because every slot value is a mapping and a JSON
Schema is not. So closing it was new machinery rather than the same control-flow fix: a
`core/asyncapi/baseline/` package, a root `x-loam-baselines` record that `loam rebase` writes and
`stripAsyncapiMarkers` removes on every branch, surface grading folded into the SAME per-service
unpinned counter rather than a second warning, and one new archive-plan code,
`asyncapi.component-modified`. The asymmetry is worth recording: two sentences in one bullet
described one control-flow bug and one absent subsystem, and only tracing the code told them apart.

## Later — promote only from evidence

Health composition, built-in rendering, UI generation and landscape decomposition remain candidate
investments, not promises. Promote one only when fleet evidence names the operator, repeated task,
failure mode, frequency, current workaround, and measurable acceptance criterion. The authored
business axis stays listed below because its trigger and its reasoning are the record of how a Later
item gets promoted — it went from here to `## Now` and from there to
[Recently landed](#recently-landed), and the trail is the point.

- **Health composition:** proceed only if both service-level `health.yaml` and fleet relationships
  are repeatedly being joined by hand and that work causes missed or contradictory checks. The
  result must compose declared signals; it must not infer operational truth from code or monitoring
  systems.
- **Rendering:** LikeC4 remains the renderer. A loam rendering command needs evidence that
  invocation, scoping, or artifact reproducibility is the recurring problem, and it must stay
  outside validation so view computation cannot slow or change the gate. This item is about
  **drawing**, and LikeC4 keeps that job. Reading a `dynamic view`'s declared steps is not rendering
  and is not this item — see docs/DESIGN.md rule 26.
- **UI generation:** begin with a disposable projection over the stable JSON contract only after CLI
  consumers demonstrate a repeated navigation problem. It must not introduce a second mutable state,
  hidden workflow state, or a required service.
- **A graded subsystem/model correspondence:** a fleet that draws its landscape as grouped C4 states
  its grouping twice — once as directories under `services/`, once as the nesting of the elements —
  and `loam subsystem move` changes the first while the second stays put. Since 2026-09-02 the
  generated views file DISCLOSES that (the `// model: no boundary — …` line; see
  [SCHEMA.md](SCHEMA.md)), and nothing grades it, because grading placement against the map is the
  policy the tree is defined not to carry. The shape a graded version would take is known and
  measured: an author's opt-in `metadata { subsystem '<name>' }` on the grouping element, read
  through the existing metadata reader, the NAME rather than the path (names are unique in one flat
  namespace and survive a move, which a path binding would not), with the check structurally silent
  for every fleet that never writes one. Promote only on evidence from a second fleet, after living
  with the disclosure — the first report classified itself `inconclusive`, and one fleet is not
  enough to qualify an invariant that says placement is never part of any identity.
- **Landscape scaling:** retain one landscape while conflicts are exceptional. If same-service
  conflicts become routine — the current trigger in [SCHEMA.md](SCHEMA.md) is weekly rather than
  monthly — evaluate service-owned model files plus a thin global cross-service map. Migration must
  preserve archive/undo, deterministic resolution, and readable plain files.
- **Authored business axis — PROMOTED 2026-08-27, and landed in full; see
  [Recently landed](#recently-landed).** The gate asked for evidence of authorship: analyst edits
  appearing in `services/*/spec.md` history, or capability-level requirements accumulating as prose
  that no requirement realizes. The maintainer supplied it as a statement about how his fleet works
  rather than as git history — business does not think in services, and an analyst does not write
  them — and the shape of the hole was verified rather than argued: **every requirement loam knew
  belonged to exactly one service directory**, so an analyst’s whole surface was a declared name in
  `capabilities.yaml` plus an `intent.md` that is archived with its feature. No living
  business-level document existed at any altitude. The full gated text, including the four sub-items
  and the cascade it follows, is in this file’s history (`git show 53c762a:ROADMAP.md`).

Exit criteria for promoting a Later item:

- Evidence comes from at least two independent operators or fleets, except landscape scaling, the
  authored business axis and — added 2026-09-02 — the deployment axis in [Now](#now), whose recorded
  triggers are sufficient. Three exceptions is where this criterion starts describing the rule
  rather than the exception: the next single-operator promotion has to say why the criterion should
  survive, or retire it.
- An ADR compares the existing workflow, external tooling, and the smallest loam-owned change.
- A prototype is measured against a predeclared acceptance criterion and preserves every non-goal
  below.
- The feature returns to this roadmap under a numbered priority before production implementation
  begins.

## Self-hosting: loam on loam

Placed in a section of its own, and the placement is the argument. This is not a `## Now` item, and
nothing here may be mistaken for one. It is not a "Later" candidate either: promotion
from that section requires evidence from at least two independent operators or fleets (bar the three
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
onto a LikeC4 model of loam's own package graph — the one axis where loam's subject matter and
loam's own tree are the same object.

The recorded trigger is two defects that reviewers caught **by hand** during the session that
produced the current `[Unreleased]` [CHANGELOG.md](CHANGELOG.md), both of which a
`c4.uncovered`-style check convicts mechanically: a package of one file — a `core/review/`, against
DESIGN's own "a package of one is a directory pretending to be a subject" — and a package-layout
table that had stopped describing the tree.

Both are closed, and the second was worse than the hand check found. Checked 2026-08-27 the table
was missing four rows; measured 2026-08-29 against the derived graph it was missing **nine**
(`brief`, `explain`, `glossary`, `links`, `obligations`, `owners`, `provenance`, `scaffold`,
`usecases`) and carried a false `Depends on` cell in **eleven more** — `core/c4/` claimed to depend
on nothing while importing `repo` and `kernel`. That is the difference the item was written to buy:
a hand check finds what a reader happens to look at, and a derived one finds the column nobody
re-read. DESIGN carries 26 numbered rules under `## Rules`, plus two more in the package-layout
section.

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
[.gitignore](https://github.com/ybotok/loam/blob/main/.gitignore) at the root and no root config is
committed: one there governs every directory beneath it, this whole clone included. The self-docs
therefore live under a subdirectory carrying its own config — `meta/loam.json` over `meta/docs/` —
which works because config discovery walks upward from the cwd, and it is the shape
[`examples/docs/`](https://github.com/ybotok/loam/tree/main/examples/docs) now carries too.

**Self-hosting is not external evidence.** A repository maintained solely for loam is one operator
by construction, so nothing here substitutes for proof from fleets that are not loam's own. That is
not an obstacle to route around; it is the reason this item is written separately. This buys daily
pressure on loam's own seams — a different kind of evidence.

The recommended first step is the architecture axis only:

- `meta/docs/` holding one landscape whose elements are loam's own source packages and whose edges
  are the real import edges
  [scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs)
  already computes.
- One service, `loam`, whose `arch.spec.md` carries DESIGN's numbered rules as requirements with
  `Covers:` lines onto that model.
- `loam validate --all` running in CI beside `npm run arch:check`, in
  [.github/workflows/ci.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/ci.yml).

**Landed.** `meta/docs/` holds a landscape whose 70 containers are the top-level subjects of `src/`
and whose 403 relationships are the real value imports, and `services/loam/arch.spec.md` carries
fourteen of DESIGN's numbered rules as requirements with `Covers:` lines onto real model objects.
`npm run meta:check` runs in CI beside `npm run arch:check`. Each exit criterion, discharged:

- **It convicted drift `arch:check` cannot see, and the drift is fixed here.** Nine missing
  package-layout rows and eleven false `Depends on` cells; a DAG-levels table that placed `verify/`
  below `gherkin/`, which it imports; a "7-level DAG" that is ten levels per package and eleven per
  file; DESIGN's register-call sentence reading 27/28 against a tree of 28/29 — **whose pin in
  `test/docs-facts.test.ts` had never once matched**, because it required a literal space where the
  page wraps. That loop now runs over the flattened text and asserts the sentence is present before
  grading it. And two mutual dependencies between top-level subjects that `arch:graph` cannot see at
  all, because it keys on the full relative directory so `core/c4/project` and `core/c4` are
  different nodes: `core/c4` ↔ `core/repo` and `core/repo` ↔ `core/provenance`. Both are hub moves
  under the `git mv`-in-its-own-commit obligation, so they are **qualified rather than broken** —
  DESIGN now names which granularity is checked and by what, and `scripts/self-model.mjs` holds them
  in an `ACCEPTED_CYCLES` baseline that may only shrink. Breaking them is the follow-up.
- **Nothing exists only to make a check fire, and here are the families that stay silent.**
  `meta/docs` declares no `openapi.yaml`, `asyncapi.yaml`, `permissions.yaml`, `capabilities.yaml`,
  `health.yaml`, no `sources:`, no `dynamic view` and no feature in flight — so `api.*`, `event.*`,
  `spine.*`, `permissions.*`, `capability.*`, `health.*`, `usecase.*`, `obligation.*`, `link.*`,
  `glossary.*`, `delta.*`, `openapi.*`, `asyncapi.*`, `archedge.*` and every `verify`/`vouch` claim
  family are silent because nothing asked them. A green run here is two `ok` findings and two
  `warn`s. It is not a fleet's worth of coverage and must not be read as one; the same list opens
  `services/loam/arch.spec.md`, so a reader of the tree hits it before the requirements.
- **The CI cost is measured**: `npm run meta:check` is 149/149/159 ms over three runs on the Linux
  gate host — about a fifth of the 671/707 ms `npm run arch:check` it sits beside — plus 1.11 s of
  test time for `test/self-model.test.ts`, which runs in parallel inside the suite.
- **No root `loam.json` is committed.** `.gitignore`'s pattern was unanchored and so ignored a file
  of that name at ANY depth, `meta/loam.json` included; it is now `/loam.json`, a developer's own
  local pointer at the root is still ignored, and a committed one in a subdirectory is not.
- **Every scenario claim stays `attested`** — vacuously, and that is worth saying rather than
  ticking. The model produces **zero** claims: claims come from features, and there is no feature.
  Nothing was built to convert one, and nothing could have been.

What the axis found about the PRODUCT, which is what it was built to buy:

- **A docs repo cannot describe a source tree above its own `loam.json`.** `repoDir` is the cwd only
  when the config's own `service` field matches, and `meta/loam.json` sits below the tree it
  describes, so the only spelling that reaches `src/` is `../src/` — which `sources.path-outside`
  correctly refuses. There is no spelling that works. Provenance is dark, `loam vouch` has nothing
  to stamp, and maturity is capped below `sourced`. That is why the pinned warning count is two.
- **`c4.uncovered` has no living scope.** It grades only what a FEATURE DELTA introduces, so with no
  feature open, 70 containers and 403 edges raise nothing. `covers.unknown` proves the `Covers:`
  lines resolve and says nothing about what is left over. `obligation.uncovered` is the shape that
  would answer this over a living map; this tree declares no obligations yet.
- **The fleet scorecard counts service-LEVEL elements**, so a 70-box model reports
  `c4: {elements: 1, covered: 0}` — correct by its own definition and badly misleading here.
- **`services/core/` + `services/commands/` is unspellable, not merely unwise**: the one flat
  namespace for subsystem names and service ids collides on eleven leaf names. Nesting inside one
  bound system is what keeps `landscape.service-undocumented` correctly quiet, but it means the
  service census answers "1" and every `landscape.*` shape advisory walks a set of one.
- **`agents.stale` will fire on loam's own docs repo at the next version bump**, because
  `meta/docs/AGENTS.md` carries a generated-by stamp. That is the axis working — daily pressure on a
  seam — and it is now a release-checklist item: re-stamp the file and update the pin.
  `examples/docs` has no `AGENTS.md`, so nothing had ever surfaced this.
- **And `agents.stale` is graded on the STAMP, not the content**, which the same file then
  demonstrated: `meta/docs/AGENTS.md` was already behind `src/` — by the AsyncAPI and OpenAPI merge
  sections, before this change added two more — and every command reported the repo healthy, because
  the version in the stamp still matched. A docs repo whose `AGENTS.md` was generated by THIS version
  and has since been left behind by a same-version change is silently wrong, and there is no check
  that can see it. The file is regenerated here; what would close it properly is a content digest
  beside the stamp, which is a real design question (an AGENTS.md a fleet has edited by hand is a
  supported state, and a digest would convict it) and is not attempted.
- **`loam init` writes agent tooling into the cwd**, so a self-model directory inside a repository
  that already has `.claude/` gets a duplicate set. `--no-commands --no-skills` is the escape hatch
  and it works, but "the docs tree" and "this repository's agent tooling" are one command today.

### The forward flow on loam's own repository — TRIED, then ADOPTED

Whether loam's own changes go through `loam new`, `loam delta`, `loam archive` and `loam verify` per
feature was the one question this section left open, because it is a far larger process commitment
than one modeled axis: it changes how every change to this repository is WRITTEN rather than how one
property of it is checked. It was first run as an experiment, on a throwaway copy of `meta/`, against
the use-case work in this same change — and then taken as a decision.

**What was adopted, and it is deliberately not "everything through the flow".** The maintenance
obligations are unconditional and are now in the gate: `npm run meta:check` after any change that
moves an import between two top-level subjects, and `npm run meta:agents` after any edit to the
sections that generate a docs repo's `AGENTS.md`. The forward flow itself is for a change somebody
should be able to read back as a DECISION — a new subject, a seam moved, a rule added to DESIGN —
and a one-line edge stays a direct edit. `AGENTS.md`'s "The self-model" section states the rule and
the `self-model` skill carries the commands, the frictions and the silent-check list.

**Mechanically it works, end to end and with no special-casing.** `loam new FEAT-1 --touches loam`
scaffolded the feature; the C4 delta re-declared the four containers its new edges join and tagged
the edges `#FEAT-1`; the architectural requirement went into `specs/loam/arch.spec.md` as an
`## ADDED Requirements` delta; `loam validate --feature` passed; `loam archive` merged four
relationships into the landscape and the requirement into the living `arch.spec.md`. The archived
result was compared against the same two edits made BY HAND, and the edge sets are identical.
`npm run meta:check` reports the written model describes the tree either way.

**Four things the trial found, and each is the axis earning its keep rather than an obstacle:**

- **`loam delta` printed `Covers:` twice.** A directive line is a body line — `core/document/parse.ts`
  keeps it in `text` so a requirement round-trips and its digest stays stable — and the briefing
  printed the body verbatim AND the parsed field underneath. So `Operations:` and `Covers:` showed
  twice while the five directives with no such re-print showed once. Fixed and pinned in this
  change. Nothing had caught it because the human view is asserted almost nowhere and the
  duplication is invisible on a requirement carrying neither line.
- **The scaffold's delta template assumes a fleet of top-level systems.** It offers
  `x = softwareSystem 'x'` and an edge between two of them; the self-model is 70 nested `container`s
  inside one bound system, so every line of the template has to be deleted and the nesting
  re-declared by hand. Not wrong — the template is written for loam's distributed-system entry
  path — but the first feature in a nested single-boundary model costs a read of
  `landscape.likec4` to find out.
- **`loam new` scaffolds the BUSINESS axis and the self-model has only the architectural one.**
  `specs/loam/spec.md` arrives and has to be deleted, and `specs/loam/arch.spec.md` written by hand;
  there is no `--arch` to say which axis a feature is about.
- **The arch-edge coverage line reads `loam → loam` once per edge**, because every edge is between
  two containers inside one bound system. Correct by its own definition, and useless here — the same
  shape as the fleet scorecard reporting `c4: {elements: 1}` over a 70-box model, already recorded
  above.

**What it still cannot buy is the evidence axis, and that is unchanged.** loam's tests are vitest,
not cucumber, so `loam verify` would record every scenario claim as `attested` and never `verified`
— the distinction loam exists to make is the one property self-hosting does not exercise. Building a
vitest-to-cucumber-JSON bridge to improve that number remains the invented need the non-goals forbid.

The cost was always process rather than capability, and the trial confirmed it: nothing prevents the
flow, and the frictions are four rough edges in a scaffold written for a fleet of top-level systems.
The decision taken is to pay that cost for changes worth reading back as decisions, and to make the
two maintenance obligations unconditional — which is the half that had already been failing silently,
twice, before anybody chose anything.

**One thing this does NOT change.** A repository maintained solely for loam is one operator by
construction, so nothing adopted here counts as external evidence for a `## Later` item. That was the
reason this section sits apart from the promotion rules, and adopting a process inside it does not
move that line.

## Non-goals

- No hosted control plane, server, database, background synchronizer, or network-owned source of
  truth.
- No code extractor or generated architecture presented as truth. Agents may read and propose; loam
  owns deterministic questions, formats, and checks.
- No full OpenSpec clone, bidirectional OpenSpec writer, or claim of compatibility beyond the exact
  pinned corpus and explicitly supported Markdown grammar.
- No replacement for LikeC4's renderer, the forge's ownership/review controls, or a service's
  contract and test tooling.
- No weakening of attested-versus-tested evidence: an agent-confirmed scenario does not become
  verified merely to make a gate green.
- No runtime dependency added to avoid implementing a small invariant with Node and the existing
  stack.
- No workspace split, barrel exports, command-oriented vertical slices, or architectural rewrite for
  aesthetics. The single binary and acyclic source-package tree remain deliberate.
- No silent break to commands, flags, exit codes, JSON envelope fields, stable codes, or the
  plain-file formats users already commit.
- No schedule inferred from section order. Priority says what must become true first; evidence
  decides when it is true.
