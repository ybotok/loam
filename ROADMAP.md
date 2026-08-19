# Roadmap

_Assessed 2026-08-18._

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
inside a service. The CLI is small enough to audit and the archive path is substantially more careful
than a typical document tool.

The assessed tree contains **214 TypeScript modules in 58 source packages**, with an acyclic package
graph checked by
[scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs). The CLI
exposes **20 commands** from [src/cli.ts](https://github.com/ybotok/loam/blob/main/src/cli.ts). Lint and
typecheck were green, and the behavior suite now accounts for **1,965 tests** (including the three
documentation-contract guards added by this audit).

That test number has an environment qualification. An unrestricted local `npm test` run passed all
73 files and **1,965/1,965 tests** in 177.65 seconds, and the coverage gate passed the same 1,965 tests
in 320.26 seconds with **92.32% statements, 84.41% branches, 95.96% functions, and 94.34% lines**. The
same tree inside a restricted filesystem sandbox passed 1,959 tests and failed only the six cases in
[test/cli-entry.test.ts](https://github.com/ybotok/loam/blob/main/test/cli-entry.test.ts), because `tsx`
was denied permission to create its local IPC socket (`listen EPERM`). That is a classified runner
restriction, not a reproduced CLI behavior failure. The package smoke validated its prepack and
tarball-content assertions, then timed out while an isolated install waited on the registry; it did not
reach the installed-binary assertions. Repeated clean CI executions and one complete package-smoke run
are therefore still release evidence to collect, but the behavior and coverage gates themselves are
green on a runner that permits their required primitives.

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
  protect what agents branch on and what loam tells them to run.
- **A real transactional archive path.** Planning, locking, byte-level compare-and-swap, atomic swaps,
  rollback, snapshots, and interrupted-commit recovery are already separated across
  [src/commands/archive/run.ts](https://github.com/ybotok/loam/blob/main/src/commands/archive/run.ts) and
  [src/core/staging/](https://github.com/ybotok/loam/tree/main/src/core/staging). This is the
  implementation model for the remaining unsafe writers, not a subsystem to replace.
- **Path and provenance discipline.** Lexical and real-path containment are centralized in
  [src/core/kernel/path-safety.ts](https://github.com/ybotok/loam/blob/main/src/core/kernel/path-safety.ts).
  Verification distinguishes an agent attestation from digest-matched test evidence through
  [src/core/verify/](https://github.com/ybotok/loam/tree/main/src/core/verify) and the verification record
  defined in [SCHEMA.md](SCHEMA.md).
- **High mechanical pressure against structural drift.** Coverage thresholds are explicit in
  [vitest.config.ts](https://github.com/ybotok/loam/blob/main/vitest.config.ts), source limits are enforced
  by [test/code-limits.test.ts](https://github.com/ybotok/loam/blob/main/test/code-limits.test.ts), and
  package-level cycles have a dedicated graph check. The next step is to make all stated architecture
  rules equally executable.

## Now

The current priority is integrity. No larger feature surface should outrun the commands that update the
source of truth or the gate that is meant to protect it.

### P0 — atomic, locked, compare-and-swap verification records

The federated verification record used to be assembled from a previously read value in
[src/commands/verify/record.ts](https://github.com/ybotok/loam/blob/main/src/commands/verify/record.ts) and
written with a plain file write, so two service runs could read the same pre-image and let the last
writer discard the other service's attestation, and an interruption could leave the only record
truncated. That was weaker than the additive, non-destructive record contract.

Required change, and where each landed:

1. ~~Acquire a docs-repository lock before the authoritative read~~ — done:
   [src/commands/verify/verify.ts](https://github.com/ybotok/loam/blob/main/src/commands/verify/verify.ts)
   takes the waiting form of the docs lock
   ([src/core/staging/lock.ts](https://github.com/ybotok/loam/blob/main/src/core/staging/lock.ts)) before
   the feature is even resolved.
2. ~~Re-read under that lock, merge, retain unrelated attestations~~ — done: the locked read returns the
   parse and its exact bytes as one value, and the merge in
   [src/core/verify/build.ts](https://github.com/ybotok/loam/blob/main/src/core/verify/build.ts) consumes
   the parse while the commit compares the bytes.
3. ~~Stage, compare the pre-image immediately before commit, replace atomically~~ — done:
   [src/core/verify/store/commit.ts](https://github.com/ybotok/loam/blob/main/src/core/verify/store/commit.ts).
4. ~~Reuse the proven staging primitives~~ — done: the same `stageWrites`/`swapStaged`/`rollbackStaged`
   vouch commits through, with the exclusive-create decision made from the held pre-image rather than
   from the filesystem.
5. ~~Map contention, stale pre-images, and recovery failures to stable outcomes~~ — done: `docs-busy`
   (bounded wait, nothing read or written), `record-raced` (bytes changed under the merge; re-run),
   `merge-failed` / `rollback-incomplete` with exactly the meanings archive gives them, and
   `record-unreadable` for a record — or a dangling symlink where one should be — that cannot be read.

What completing this item surfaced, fixed in the same change: the git calls the record path makes
([src/commands/verify/results.ts](https://github.com/ybotok/loam/blob/main/src/commands/verify/results.ts))
now carry a deadline and an output cap, because they run while the docs lock is held — a git blocked on
a credential helper used to wedge every writer in the fleet behind a live pid nothing could break; and
`doctor` grades a `.loam-lock` that cannot name its holder (an empty file from a crash between create
and flush) as damage with a named fix, not as a live writer to wait out.

Exit criteria:

- Two real processes can record different services for one feature concurrently and both attestations
  are present afterward.
- A same-service race has a deterministic winner or refusal, never an unreported lost update.
- Fault injection before staging, before the atomic swap, and after the swap leaves either the complete
  old record or the complete new record, never partial YAML.
- A third-party edit between read and commit is detected by byte pre-image comparison and preserved.
- Recovery, lock contention, symlink containment, and federated merge behavior have process-level tests,
  and the complete gate remains green.

### P0 — full-gate concurrency stability

The supported gate is the composition in
[AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) and
[.github/workflows/ci.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/ci.yml): lint,
typecheck, the package-level graph check, behavior tests, coverage, and installed-package smoke.
File-level cycle and boundary enforcement is a P1 addition below, not a current gate claim. Forked CLI
tests, current-working-directory isolation, and concurrent file writers must be stable at the
configured Vitest parallelism; an isolated rerun is diagnostic evidence, not a green gate.

Required change:

- Reproduce and classify runner-policy failures separately from product races, without weakening the
  test pool or turning failures into retries.
- Audit module-level mutable state, shared temporary paths, `process.chdir`, and child-process cleanup in
  the harness beginning with
  [test/helpers/harness.ts](https://github.com/ybotok/loam/blob/main/test/helpers/harness.ts) and
  [vitest.config.ts](https://github.com/ybotok/loam/blob/main/vitest.config.ts).
- Add targeted stress coverage for concurrent verification, archive locking, Gherkin generation, and
  CLI entry execution. Assertions must cover resulting bytes and trees, not only exit status.
- Keep the Node runtime floor and the coverage job distinct where CI needs them, while ensuring both
  exercise the same public command contracts.

Exit criteria:

- The current full behavior count, including every CLI-entry case, passes in one uninterrupted run with
  configured parallelism and no isolated rerun.
- The same immutable commit completes three consecutive clean CI executions at the Node floor and three
  consecutive clean coverage executions on the current Node line, with no retry or quarantine.
- Targeted multi-process stress tests can be repeated locally and in CI without leaked processes,
  sockets, locks, temporary files, or working-directory state.
- A constrained host that forbids a required primitive fails once with a classified infrastructure
  reason; it does not resemble a nondeterministic product failure.

### P0 — crash-consistent multi-file writers

`new` currently creates its scaffold sequentially in
[src/commands/new/new.ts](https://github.com/ybotok/loam/blob/main/src/commands/new/new.ts). Gherkin
computes conflicts before writing, but its write/delete loop in
[src/commands/gherkin/gherkin.ts](https://github.com/ybotok/loam/blob/main/src/commands/gherkin/gherkin.ts)
can still leave a half-old, half-new generated suite after an I/O failure. `vouch` and `rebase` already
use `stageWrites → swapStaged → rollbackStaged`, but that is exception rollback, not crash
consistency: [src/core/staging/commit.ts](https://github.com/ybotok/loam/blob/main/src/core/staging/commit.ts)
swaps one file at a time, and a process killed between swaps never enters the catch block. `rebase`
takes the docs lock; [src/commands/vouch/run.ts](https://github.com/ybotok/loam/blob/main/src/commands/vouch/run.ts)
does not. The scope is therefore every multi-file writer, not only the two commands that still write
sequentially.

Required change:

- Inventory every command that can mutate more than one authoritative or generated file, beginning
  with `new`, `gherkin`, `vouch`, and `rebase`; classify exception rollback, concurrent-writer safety,
  and abrupt-process recovery separately.
- Build and validate the complete write/delete plan in memory before touching disk.
- Stage every output beside its destination, lock the smallest correct write scope, compare pre-images,
  and commit with a durable intent journal plus guarded rollback/recovery.
- Preserve existing no-clobber behavior: authored files and generated files changed since planning must
  be refused, not buried.
- Keep output deterministic and keep planning separate from rendering so failure tests can address each
  commit boundary. Reuse archive recovery only where its assumptions hold; otherwise extract a smaller
  journaled transaction rather than pretending a sequence of atomic renames is atomic as a group.

Exit criteria:

- Injected exceptions and abrupt process termination at every staged write, swap, and deletion boundary
  leave a tree byte-identical to either the complete pre-state or the complete post-state after the
  documented recovery step.
- Concurrent runs for the same target serialize or refuse with a stable result; runs for independent
  targets do not block one another unnecessarily.
- Existing user-authored files, symlinks, and files appearing after planning are never overwritten.
- `doctor` reports an interrupted commit until recovery succeeds or names the files requiring human
  repair; no command silently treats a half-commit as healthy.
- Success output, JSON shape, generated bytes, and command-line compatibility remain unchanged unless an
  additive contract change is explicitly documented.

### P1 — make architecture invariants executable

[docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) and
[docs/CODE-STYLE.md](https://github.com/ybotok/loam/blob/main/docs/CODE-STYLE.md) describe a stronger
system than the current gate proves. P1 closes that gap rather than adding another layer.

Required change:

- Add one architecture gate that enforces file-level `import/no-cycle`, runs
  [scripts/package-graph.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-graph.mjs), rejects
  `commands` imports from `core`, rejects hidden barrel exports, and checks the documented
  `console`/`process` boundary. The deliberate JSON output module remains the named exception.
- Replace the `console.error` side effect in
  [src/core/envelope/config.ts](https://github.com/ybotok/loam/blob/main/src/core/envelope/config.ts) with
  a typed expected outcome. Command modules alone decide how that outcome is rendered.
- Require a timeout for every child process and a bounded output policy wherever output is buffered.
  Bring the unbounded Git call in
  [src/commands/verify/results.ts](https://github.com/ybotok/loam/blob/main/src/commands/verify/results.ts)
  up to the standard already demonstrated by
  [src/core/provenance/git.ts](https://github.com/ybotok/loam/blob/main/src/core/provenance/git.ts), and
  statically prevent the regression.
- Finish the branded-type rule. Validated feature IDs, docs directories, feature directories, and
  portable paths must be distinct from raw input from construction through the path builders in
  [src/core/repo/paths.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/paths.ts). The smart
  constructors in [src/core/kernel/ids.ts](https://github.com/ybotok/loam/blob/main/src/core/kernel/ids.ts)
  are the only bridge; directory entries such as
  [src/core/repo/entries.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/entries.ts) retain an
  explicit raw form when invalid names must still be reported.
- Generalize context/no-context parity tests so memoization in
  [src/core/fleet-context.ts](https://github.com/ybotok/loam/blob/main/src/core/fleet-context.ts) cannot
  become a second implementation of a core rule.

Exit criteria:

- A single documented command runs every architecture check used by CI, and each check has a negative
  self-test proving that a representative violation fails it.
- `core` contains no output or process-control side effects outside the explicitly named envelope
  adapter, and no `core -> commands` import can pass the gate.
- Every child-process call has a tested deadline, cleanup path, and deterministic error mapping; buffered
  calls also declare an intentional maximum output size.
- Raw identifiers and paths cannot reach validated path builders at compile time, and casts to a branded
  type outside its constructor module fail a static check.
- The module graph remains acyclic, the package graph remains acyclic, and the 300-line / four-parameter /
  five-file limits retain an empty baseline.
- Architecture prose states only invariants the gate proves or labels a rule explicitly as review-only.

### P1 — baseline semantics for OpenAPI path items and components

Operation-level `x-loam-based-on` pins prevented a quoted operation from silently overwriting a newer
living operation, and the protection stopped at that identity boundary. It no longer does: the same
discipline now covers path-item non-method keys and recursively referenced components, through a
canonical pre-image digest per surface recorded in the feature-only root key `x-loam-baselines`.

Required change, and where each landed:

1. ~~Choose and document the identity~~ — done: `(path, key)` / `(kind, name)` plus the canonical-form
   digest (`valueDigest`), recorded in `x-loam-baselines`, documented in [SCHEMA.md](SCHEMA.md);
   recursion is deliberately not part of identity — closure only ever decides copying.
2. ~~`rebase` records the baseline~~ — done:
   [src/core/openapi/baseline/plan.ts](https://github.com/ybotok/loam/blob/main/src/core/openapi/baseline/plan.ts),
   wholesale rebuild, sorted and byte-idempotent, genuinely new values explicitly unpinned.
3. ~~`validate` and archive distinguish absent/unchanged/stale/unresolvable before merge~~ — done:
   [src/core/openapi/baseline/gate.ts](https://github.com/ybotok/loam/blob/main/src/core/openapi/baseline/gate.ts)
   through the existing three `openapi.baseline-*` codes; stale is a refusal, not warn+overwrite.
4. ~~Closure behavior~~ — done: verdict-driven component copying with a written-content fixpoint for
   new components; cycles terminate, unrelated namespaces stay uncopied, the unresolved-`$ref`
   refusal is unchanged.

Recorded while landing it: a components-only feature contract (no `paths` mapping) passes the gate
but merges nothing — the merge answers no-op before the closure runs. Pre-existing, now written down
here rather than silently true. The AsyncAPI lifecycle item touched the same entry point and landed
WITHOUT closing it — and mirrored the shape rather than fixing it: a slot-less asyncapi delta merges
nothing too (that item's own leftovers record it). Still open on both axes.

Exit criteria:

- The two documented overwrite cases become stale-baseline refusals (or a separately versioned,
  explicitly approved overwrite contract) and have rebase/validate/archive end-to-end tests.
- Concurrent features that change the same path-item field or component cannot land in either order
  without a visible conflict; independent fields and components still merge deterministically.
- Rebase is idempotent, reports each moved baseline, and never changes authored API content beyond the
  baseline metadata it owns.
- Archive and unarchive retain byte-safe transaction and snapshot behavior for the expanded merge
  surface, and existing operation-pin fixtures remain compatible.

## Next

These items follow the integrity and enforcement work. They validate the product boundary, update the
external compatibility baseline, and complete the most consequential missing lifecycle.

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

### Rebaseline the OpenSpec corpus at v1.9 without rewriting history

OpenSpec v1.7 remains the historical compatibility claim. Its exact commit, corpus totals, fixtures, and
documented conclusions must not be relabeled as current or overwritten. Add v1.9 as a separate,
exact-commit baseline in
[scripts/check-openspec-corpus.ts](https://github.com/ybotok/loam/blob/main/scripts/check-openspec-corpus.ts)
and the scheduled matrix in
[.github/workflows/ci.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/ci.yml).

Exit criteria:

- The historical v1.7 corpus still runs by name with its existing commit and totals.
- A separately named v1.9 baseline pins the release commit, records living/active/archive totals, and
  proves parse/serialize/parse stability for every supported requirement and scenario.
- Representative v1.9 fixtures are vendored only where they add coverage, with provenance and checksums
  in [test/fixtures/openspec/README.md](https://github.com/ybotok/loam/blob/main/test/fixtures/openspec/README.md).
- [test/openspec-compat.test.ts](https://github.com/ybotok/loam/blob/main/test/openspec-compat.test.ts)
  pins every newly observed supported and unsupported construct, including loud refusal where silent
  loss would otherwise occur.
- [COMPARISON.md](COMPARISON.md) distinguishes historical v1.7 findings, current v1.9 findings, and any
  separately pinned canary. Migration claims in [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md)
  are re-verified rather than refreshed from release notes alone.

### Make `validate --all` fit the fleet gate

The measured baseline was 13–14 seconds for 120 services — one fresh LikeC4/Langium workspace per
service model. Landed: the run's C4 documents (service models, feature deltas, the landscape) are
parsed in ONE temporary LikeC4 workspace ([src/core/c4/workspace.ts](https://github.com/ybotok/loam/blob/main/src/core/c4/workspace.ts)),
seeded into `FleetContext`'s existing per-invocation memo via `prefetchLikeC4`, with a silent
per-document fallback where a temp workspace cannot be created — findings can never change because a
sandbox denied tmpdir writes, and a parity suite pins batch-vs-single equivalence document by
document.

Exit criteria, as landed:

- ~~A checked-in, documented benchmark~~ — [scripts/bench-validate.ts](https://github.com/ybotok/loam/blob/main/scripts/bench-validate.ts)
  + [docs/BENCHMARKS.md](docs/BENCHMARKS.md): fixture shape, edge count, cold/warm policy,
  repetitions, medians, sampled peak RSS; [test/scale.test.ts](https://github.com/ybotok/loam/blob/main/test/scale.test.ts)
  stays a blow-up alarm.
- ~~Twice as fast~~ — measured **18.8x** on the committed 120-service fixture (13 748 ms → 731 ms
  median), with `list` and single-service validation within 0.2%, and peak RSS halved.
- ~~Same findings before/after~~ — the scale suite's construction-derived pins run through the
  batch path end to end, and the fallback pin proves a failed batch leaves output byte-identical.
- ~~Cache lifetime one invocation~~ — the memo lives on the `FleetContext` instance; a second
  context re-reads the disk.

Still owed from elsewhere: both pilot fleets meeting their predeclared `maxValidateMs` is the
two-fleet pilot item's evidence, not this repository's.

### Complete the AsyncAPI feature lifecycle

Landed: the event axis has the feature lifecycle the OpenAPI axis has, mirrored axis-for-axis. A
feature-local `features/<FEAT>/specs/<svc>/asyncapi.yaml` — a complete AsyncAPI 3.0 document,
[SCHEMA.md](SCHEMA.md)'s format section is the design of record — carries slot identity over
`channels.<key>` / `operations.<key>` / `components.messages.<key>` (inline channel messages are
channel-slot interior by decision), with `x-loam-based-on` pins written by `loam rebase` and
`x-loam-remove: true` markers. One digest spelling for both axes:
[src/core/asyncapi/digest.ts](https://github.com/ybotok/loam/blob/main/src/core/asyncapi/digest.ts)
imports the canonical-JSON rule from the OpenAPI axis (verified acyclic), so the pin grammars
cannot drift apart.

Exit criteria, as landed:

- ~~A feature can add, modify, and retire a message/channel identity in a documented feature-local
  format~~ — the SCHEMA.md format spec, which explicitly supersedes the earlier recorded decision
  against an event removal family (the consumer-lag rationale survives as an operational warning,
  not a veto).
- ~~`new`, `delta`, `rebase`, `validate`, `verify`, `archive`, and `unarchive` agree on the same
  AsyncAPI identity and baseline semantics~~ — one slot walker and one digest rule end to end;
  `delta` projects the `events` slice (unreadable ⇒ exit 1, the openapi parity), `status` carries
  the `asyncapi` artifact row and names `loam rebase` on `asyncapi.baseline-missing`, and `new`
  deliberately scaffolds nothing — the spec template and `/loam-feature` teach the format instead,
  because the axis's absence-grading rests on the contract being genuinely optional.
- ~~Producer/consumer references, conflicting active features, stale baselines, unjustified
  removals, and orphaned references have stable findings and end-to-end tests~~ — the
  `asyncapi.*` baseline/removal/conflict codes plus `c4-event.*`/`spec-event.*`, each in the
  /loam-check fix table; test/asyncapi-baseline, -removal, -merge, -lifecycle and
  test/coherence-events drive the real CLI.
- ~~Archive and undo use the same transactional guarantees as the other source-of-truth axes~~ —
  the merge writes ordinary planned writes, so snapshot, journal, rollback and byte-identical
  `unarchive` apply unchanged; a fault-injected commit failure rolling the asyncapi swap back with
  the rest of the plan is pinned in test/asyncapi-lifecycle.test.ts.
- ~~The scope remains explicit~~ — SCHEMA.md states payload-schema correctness is delegated to an
  optional external CI validator (e.g. `@asyncapi/parser`) with no runtime dependency; slot
  digests hash payload bytes as content identity, never a join.

Honest leftovers: a slot-less feature asyncapi.yaml merges nothing — content outside the three
slot sections (`info`, `servers`, `components.schemas`) never merges, the sibling of the
components-only openapi gap recorded above, with the one guard that a merged slot referencing a
feature-only schema gates `asyncapi.ref-unresolved` at plan time instead of landing a dangling
pointer. The example fleet demonstrates the merge half (FEAT-101's payment-service delta, pinned
by a real `loam rebase` run); the create-a-living-contract branch is exercised by tests, not by
examples/docs. And `spine.message-external`'s consumer-owned-copy convention predates this item
and is unchanged by it.

### Subsystems: a navigable tree under `services/` that no identity depends on

`services/` is one flat level today —
[src/core/repo/repo.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/repo.ts) reads its
subdirectories and that list *is* the fleet. At 120 services the list stops being readable, and teams
already group their directories by whatever agreement they reach: a domain here, an owning team there,
a technology elsewhere. The tree is a filing convention enforced by review, not a taxonomy, and it will
be re-cut. The whole design turns on one decision that makes re-cutting cheap:

> **A service id is the leaf directory name. Placement is never part of any identity.**

`loam.json`'s `service`, `metadata { service }`, spec frontmatter, and `features/<FEAT>/specs/<svc>/`
never change when a service moves. `SERVICE_ID` in
[src/core/kernel/ids.ts](https://github.com/ybotok/loam/blob/main/src/core/kernel/ids.ts) keeps
forbidding `/`, so `--service` can never take a path. The subsystem tree exists in exactly one place,
`services/`; mirroring it into feature directories would rewrite archived history on every re-cut.

Scope boundary, stated so it does not creep: the tree carries **no policy**. No per-group gate, no
allowed-dependency rules between groups, no ownership derived from position. It exists so a human can
find a service and so views can be scoped, and nothing branches on it.

Required change, in this order:

1. **Re-key archive snapshots by service id first, before any subsystem can exist.**
   `SnapshotEntry.path` in
   [src/core/staging/snapshot.ts](https://github.com/ybotok/loam/blob/main/src/core/staging/snapshot.ts)
   is docs-repo-relative, so a service that moves after a feature was archived makes `unarchive` restore
   into a path that is gone. Record `(service, artifact)` for anything under `services/` and resolve it
   through the enumeration at restore time; keep literal paths for the landscape and `features/`, which
   do not move. Bump `SNAPSHOT_VERSION` to 3 and keep reading version 2. Ordering is the requirement:
   version-2 snapshots already sit in archived features, and re-cutting is expected to be routine rather
   than exceptional.
2. **Classify a directory three ways, and make the third branch a refusal.** A directory holding
   `subsystem.yaml` is a subsystem and is walked; one holding any service artifact is a service and is
   not; one holding neither while containing subdirectories is an **error** naming the services stranded
   beneath it. Two-way classification loses a service silently on an ordinary clean merge — one branch
   deletes an emptied subsystem while another moves a service into it, and the group directory is then
   read as a service whose real services vanish from the fleet with no finding. No directory under
   `services/` may ever be reinterpreted as a different kind without saying so.
3. **One flat namespace.** Service ids and subsystem names share it, must be unique across the entire
   tree at any depth, and must not collide with each other. Subsystem names take the service-id grammar
   and a distinct branded type; depth is unbounded and is the author's problem, not the tool's.
4. **Record placement exactly once — in the directory itself.** No `subsystem` frontmatter field and no
   membership list anywhere. `subsystem.yaml` declares that a directory is a group and carries its
   title, optional description and optional owner; it never enumerates members, which is what the
   directory already is. A marker beside service artifacts is an error.
5. **Resolve service paths from the enumeration instead of a join.** The 41 `servicePaths(docsDir, id)`
   call sites assume `services/<id>/`;
   [src/core/repo/entries.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/entries.ts) already
   carries the resolved `dir` per service, so the work is threading that map rather than discovering it.
   The `PathableService` guarantee in
   [src/core/repo/paths.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/paths.ts) strengthens:
   a path that came from a readdir is narrower than one built from a validated string.
6. **Mirror the tree in a generated views file, never in the authored landscape.**
   `architecture/subsystems.likec4` holds views only — no model, no tags, no `specification` entries —
   with one view per subsystem enumerating its members. Authored bytes stay authored, which is what
   archive's verbatim splice promises. Output is deterministic and line-oriented: subsystems sorted by
   path, members sorted by id, **one `include` per line**, so concurrent moves into different groups
   touch different lines and git merges them, exactly as the service-grouped splice already achieves for
   the landscape. Staleness against the tree is a single error on a single file, repaired by one command.
   This is a scoping convenience, not the landscape decomposition under "Later"; it does not change what
   any check reads.
7. **Commands.** `subsystem new`, `move` (accepting several services and whole subtrees), `rename`, `rm`,
   `list`, `history`, and `sync`; plus `adopt --subsystem`, so an adoption does not always land unfiled
   and need a second command. `history` stays inside the doctrine in
   [src/core/provenance/git.ts](https://github.com/ybotok/loam/blob/main/src/core/provenance/git.ts):
   loam asks git and never tells it, every refusal reads as "git will not say", and `move` stages
   renames without committing.
8. **A move is one transaction over N renames plus one generated file**, which is the first real
   consumer of the journaled transaction required by P0 — a sequence of directory renames is not atomic
   as a group. It refuses when a file being moved has uncommitted changes, and only then: the generated
   views file must be written in the same commit, or the tree is left failing between two commits.
9. **Grade absence honestly.** A service directly under `services/` is unfiled, which is a permanent and
   normal state in a partially organized fleet: silence, not a warning, with a count in `list`. An empty
   subsystem is legal, since `subsystem new` must be usable before anything moves in.

Exit criteria:

- After any sequence of moves, renames and subtree moves, every join key is byte-identical: `loam.json`,
  `metadata { service }`, spec frontmatter, `features/<FEAT>/specs/<svc>/` names, `sources_digest` and
  `content_digest`. No `verified` service is demoted by a move.
- The deleted-marker merge race is a fixture: the resulting tree refuses with a finding naming every
  stranded service, and never reports a smaller fleet.
- A duplicated service id or subsystem name anywhere in the tree, at any depth, is an error naming both
  locations; a name that is both a subsystem and a service id is refused the same way.
- `archive`, then a move, then `unarchive` restores the pre-image byte-for-byte with no `--force` and no
  `snapshot-stale`. Version-2 snapshots still restore under their own rules.
- Two concurrent moves into different subsystems produce a generated file git merges without
  intervention; two moves of the same service conflict visibly rather than resolving silently.
- The generated file is byte-reproducible from the tree on any machine — no timestamps, no absolute
  paths, no readdir-order dependence — and `validate` detects staleness by comparing generated bytes.
- `subsystem history` answers across at least two chained moves, and answers nothing without a finding
  when git declines.
- Unfiled services produce no findings at any count, and `validate --all` runtime is unchanged beyond
  one readdir per directory walked.

### Name the capabilities the fleet promises, and join requirements to them

Every axis loam checks has a fleet-level place where its parts add up, except the one analysts work in.
Architecture has `architecture/landscape.likec4`, and a feature's C4 additions splice into it on archive.
Authorization has `architecture/permissions.yaml`, graded against every `Requires:` line in the fleet.
Business behaviour has 120 `services/<svc>/spec.md` files and nothing above them.

The feature-level side is thinner than it looks. `verify` never reads `intent.md` — the claims in
[src/core/verify/checklist.ts](https://github.com/ybotok/loam/blob/main/src/core/verify/checklist.ts)
are derived from the delta, the contracts, and the scenarios. `archive` merges nothing out of it either.
So a feature's `## Business acceptance` is the only authored content in loam that no check joins to
anything and no merge accumulates: it is held to being non-empty (`intent.empty`) and to not being
scaffold text (`scaffold.placeholder`), and then it is filed into `features/archive/`. An analyst can
write five acceptance criteria, three can be implemented, and every gate stays green.

This is a known concession, recorded in the wrong place. [COMPARISON.md](COMPARISON.md) states that
OpenSpec's source of truth is capability-oriented while loam joins requirements to services, and
[MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) leaves capability→service mapping to a human
and copies capability prose into `legacy/` because it has no loam equivalent. Both describe the missing
axis as a migration caveat. Neither treats it as a gap in the product.

The documents in question already exist in most fleets, outside the docs repository: one long-lived
page per user-facing capability — registration, sign-in, user profile, finding and adding friends,
finding and adding products — each revised by changes that fan out first into API changes and then into
per-service requirement changes. loam models the bottom of that cascade and nothing above it, which is
why an analyst either edits `services/<svc>/spec.md` or works somewhere loam cannot see.

This item takes the half that costs little: declare the names those documents already have, join the
requirements the fleet already carries to them, and make the total readable — so "which parts of
registration does nothing in 120 services claim to implement" is answerable before deciding whether the
documents themselves should move here. No prose moves and no authoring surface is added; that is the
Later item below, and this rollup is the evidence that decides it.

Required change:

- Add `architecture/capabilities.yaml` in the shape
  [src/core/permissions/permissions.ts](https://github.com/ybotok/loam/blob/main/src/core/permissions/permissions.ts)
  already proves: a declared vocabulary of ids with a description and an owner, nested ids such as
  `payments/refunds` kept nested, and the same defensive read. An unparseable vocabulary is exactly one
  error and suppresses the rest of the family, because a hundred findings about one broken file is a
  cascade rather than a diagnosis. An absent file is silence, so no existing fleet gains a finding until
  it writes one.
- Add a `Capability:` line to the requirement grammar in both spec files, parsed by
  [src/core/document/parse.ts](https://github.com/ybotok/loam/blob/main/src/core/document/parse.ts)
  beside `Operations:`, `Requires:`, `Publishes:` and `Consumes:`. It is a **list**, and the relation is
  many-to-many in both directions: one requirement commonly closes part of two capabilities, and a
  capability is realized by many requirements across several services. A single-valued field would force
  authors to pick a lie.
- Grade both directions, as the authorization axis already does. A line naming an undeclared capability
  is an error with close-name suggestions; a declared capability that no living non-`REMOVED` requirement
  names is a warning — it is either a promise nobody implemented or a word nobody adopted, and both are
  drift invisible from inside the file.
- Report the total. `list`, `explore` and the JSON envelope answer "what does the fleet promise about
  refunds" with the realizing requirements, their services, and the draft/verified split — one command
  instead of a grep across 120 directories.
- Preserve capability identity through `migrate-openspec`. Today the capability is dissolved into service
  requirements and its id is kept only in the verbatim `legacy/` copy. The mapping of requirements to
  services stays a human decision, but every OpenSpec capability id should survive as a declared name and
  a `Capability:` line, so migration stops being the step where the analyst's structure is lost.
- Nothing new gates `archive` in this item beyond the unknown-name error.

Exit criteria:

- A vocabulary that does not parse produces exactly one error for the whole run, never one per requirement,
  and the rest of the capability family is suspended rather than answered from a file nobody can read.
- An undeclared capability name is an error naming close candidates; a declared capability nothing realizes
  is one warning per capability, not one per service.
- A fleet with no `architecture/capabilities.yaml` produces no capability findings at all.
- The rollup is deterministic: same tree, same bytes, and the `--json` ordering is stable enough for
  consumers to diff.
- A migrated OpenSpec workspace retains every capability id as a declared name, and no requirement loses
  the capability association its source file expressed.
- `validate --all` pays one additional YAML parse per invocation and no additional per-service cost, and
  the assessed runtime target for a 120-service fleet is unaffected.

### Protect documentation, package contents, and links

Public prose currently carries several facts that code can derive but the existing
[test/docs-drift.test.ts](https://github.com/ybotok/loam/blob/main/test/docs-drift.test.ts) does not
protect. Package composition and link integrity should be checked from the tarball users install, not
inferred from the working tree.

Exit criteria:

- README, schema, workflow, design, migration, comparison, and this roadmap agree on released status,
  implemented gates, branded types, command/package counts, known gaps, and the
  `architecture/permissions.yaml` vocabulary in
  [src/core/permissions/permissions.ts](https://github.com/ybotok/loam/blob/main/src/core/permissions/permissions.ts).
- Derived facts are generated or pinned by focused tests; measured facts carry an assessment context
  rather than masquerading as timeless constants.
- The installed-package smoke in
  [scripts/package-smoke.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-smoke.mjs) checks
  every Markdown file intended for npm, and a link check proves that each relative link resolves inside
  the tarball or is intentionally a canonical repository link.
- [package.json](package.json),
  [scripts/release-check.mjs](https://github.com/ybotok/loam/blob/main/scripts/release-check.mjs), and the
  public documentation share one reviewed list of package-facing documents. No published page links to
  an omitted local file.
- Known-gap prose has a test or an owner and is removed in the same change that closes the gap.

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
