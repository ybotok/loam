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
typecheck, the architecture gate, behavior tests, coverage, and installed-package smoke. Landed —
entirely in test/, scripts/ and CI, zero `src/` lines, so the coverage thresholds stood unmoved:
stability is now a repeatable measurement rather than an impression, and every red run says what
kind of red it is. An isolated rerun remains diagnostic evidence, not a green gate.

Required change, and where each landed:

1. ~~Reproduce and classify runner-policy failures separately from product races, without weakening
   the test pool or turning failures into retries~~ — done:
   [scripts/gate-stress.mjs](https://github.com/ybotok/loam/blob/main/scripts/gate-stress.mjs) runs
   N sequential full-suite runs at the CONFIGURED parallelism and
   [scripts/gate-stress-classify.mjs](https://github.com/ybotok/loam/blob/main/scripts/gate-stress-classify.mjs)
   grades each run as product, runner-policy, coverage-threshold or infrastructure — three runs are
   three verdicts, never three attempts. A globalSetup host probe
   ([test/helpers/host-probe.ts](https://github.com/ybotok/loam/blob/main/test/helpers/host-probe.ts))
   makes a host that forbids a required primitive (O_EXCL, link(2), rename-over, symlink, spawn)
   fail once with a classified `[loam-host]` cause instead of scattering EPERM failures that read
   as flakes.
2. ~~Audit module-level mutable state, shared temporary paths, `process.chdir`, and child-process
   cleanup in the harness~~ — done: spawned children now live in one vocabulary
   ([test/helpers/cli-process.ts](https://github.com/ybotok/loam/blob/main/test/helpers/cli-process.ts))
   — a 60-second deadline, SIGKILL, and a live-child registry whose `assertNoLiveChildren` is the
   executable form of "no leaked processes" — and in-process `runLoam` calls are serialised behind
   one queue, because cwd, console and exit code are process-global. A refusal was tried first and
   reverted on evidence: vitest cannot cancel a timed-out test's async work, so the queue keeps the
   corruption impossible while a timeout stays one timeout.
3. ~~Add targeted stress coverage for concurrent verification, archive locking, Gherkin generation,
   and CLI entry execution, asserting on resulting bytes and trees rather than exit status~~ —
   done: [test/stress-verify.test.ts](https://github.com/ybotok/loam/blob/main/test/stress-verify.test.ts)
   (four simultaneous federated records: every winner's attestation whole, stragglers refuse
   `docs-busy` and nothing else),
   [test/stress-archive.test.ts](https://github.com/ybotok/loam/blob/main/test/stress-archive.test.ts)
   (four simultaneous archives of one feature: exactly one winner, the surviving tree byte-equal to
   a solo run's),
   [test/stress-gherkin.test.ts](https://github.com/ybotok/loam/blob/main/test/stress-gherkin.test.ts)
   (serial idempotence and four-way byte-convergence), and
   [test/stress-cli-entry.test.ts](https://github.com/ybotok/loam/blob/main/test/stress-cli-entry.test.ts)
   (eight concurrent read-only runs: parseable envelopes, duplicate invocations byte-identical, the
   tree untouched).
4. ~~Keep the Node runtime floor and the coverage job distinct where CI needs them~~ — done: the
   dispatch/schedule-only `stability` job in ci.yml runs three sequential full-suite runs at the
   Node floor and three under coverage on the current Node line, never retried, and
   [AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) documents the runner and its
   failure classes.

What completing this item surfaced, fixed in the same change: one real product defect — two
concurrent lock acquires in one process and one millisecond shared a temp name, the first's cleanup
deleted it under the second, and the second's link(2) surfaced ENOENT as `internal`; caught by the
20-iteration archive overlap stress, fixed with a per-call sequence in the temp name.

Exit criteria, as landed:

- ~~The current full behavior count, including every CLI-entry case, passes in one uninterrupted
  run with configured parallelism and no isolated rerun~~ — every gate-stress run is exactly that
  shape, and each evidence run below passed the complete suite that way.
- ~~The same immutable commit completes three consecutive clean executions at the Node floor and
  three consecutive clean coverage executions on the current Node line, with no retry or
  quarantine~~ — proven locally on the landing tree: three consecutive clean plain runs and three
  consecutive clean coverage runs of the complete suite; observing the same in CI is the leftover
  below.
- ~~Targeted multi-process stress tests can be repeated without leaked processes, sockets, locks,
  temporary files, or working-directory state~~ — `assertNoLiveChildren` and the harness teardown
  enforce it on every suite, and the stress assertions cover the resulting tree delta, not only
  exit codes.
- ~~A constrained host that forbids a required primitive fails once with a classified
  infrastructure reason~~ — the host probe fails the run once with its named cause; it no longer
  resembles a nondeterministic product failure.

Honest leftover: the CI half of the evidence is observation, not code. The stability job has to be
seen green in CI, which needs a push — the same maintainer-observed remainder the OpenSpec
rebaseline recorded — and the ci.yml comment records the chosen reading of "three consecutive CI
executions" (three sequential runs inside one job execution per matrix leg), so the maintainer can
dispatch three times for the stricter reading.

### P0 — crash-consistent multi-file writers

Archive and unarchive had long committed through a lock, a compare-and-swap, a snapshot and a
fsynced journal; every other writer wrote plainly, and a process killed between two renames left a
half-old, half-new tree nothing could see. Landed: every multi-file writer now commits through a
smaller journaled transaction
([src/core/staging/txn/](https://github.com/ybotok/loam/tree/main/src/core/staging/txn)) whose
staged after-bytes are durable beside their targets before the journal is written, so recovery
rolls FORWARD — file by file, each verified against the digest recorded before the crash — instead
of needing a snapshot that exists nowhere. The shared vocabulary (the journal's name, the
interrupted-commit refusal, the recovery report, the durable-write and temp-sweep disciplines)
lives in
[src/core/staging/interrupted.ts](https://github.com/ybotok/loam/blob/main/src/core/staging/interrupted.ts).

Required change, and where each landed:

1. ~~Inventory every command that can mutate more than one authoritative or generated file;
   classify exception rollback, concurrent-writer safety, and abrupt-process recovery separately~~
   — done: the inventory and each writer's guarantee are recorded in [CHANGELOG.md](CHANGELOG.md).
   `rebase` journals its pin writes; `vouch` takes the docs lock for its commit window — the lock
   this roadmap called missing — and rolls a predecessor's journal forward BEFORE verification
   reads a byte; `verify --record` recovers under its held lock.
2. ~~Build and validate the complete write/delete plan in memory before touching disk~~ — done:
   `new` ([src/commands/new/new.ts](https://github.com/ybotok/loam/blob/main/src/commands/new/new.ts))
   builds its whole scaffold in memory and commits it as exclusive creates under the lock, asking
   "does this feature exist" exactly once — under the lock, after recovery — because an unlocked
   fast path used to refuse already-exists over its own wreckage.
3. ~~Stage every output beside its destination, lock the smallest correct write scope, compare
   pre-images, and commit with a durable intent journal plus guarded rollback/recovery~~ — done:
   `gherkin` ([src/commands/gherkin/commit.ts](https://github.com/ybotok/loam/blob/main/src/commands/gherkin/commit.ts))
   commits into the service repo's own gherkin root through the same lock and journal, comparing
   every write and delete against the exact bytes reconcile graded, and recovers before the feature
   argument resolves, so the stored re-run works even after its feature archives.
4. ~~Preserve existing no-clobber behavior: authored files and generated files changed since
   planning must be refused, not buried~~ — done: pre-images are compared at commit, and a file
   that appeared after planning is a refusal.
5. ~~Keep planning separate from rendering; reuse archive recovery only where its assumptions hold,
   otherwise extract a smaller journaled transaction~~ — done: txn/ is exactly that smaller
   transaction, and archive keeps its own snapshot-backed path.

What the closing reviews surfaced, fixed in the same change: a journal entry escaping its root
could turn roll-forward into an arbitrary write anywhere on the machine (both journal readers now
fail closed on containment); the journal was cleared on `rollback-incomplete`, hiding the one tree
that most needs describing (now retained, archive's own trade); a file whose before and after
digests match was read as proof a rename landed (only a file that can tell the two states apart
counts); the raced remap in three callers swallowed `rollback-incomplete` and its file list; and
doctor's temp-litter warning advised deleting the very bytes roll-forward recovers from.

Exit criteria, as landed:

- ~~Injected exceptions and abrupt process termination at every staged write, swap, and deletion
  boundary leave either the complete pre-state or the complete post-state after the documented
  recovery step~~ —
  [test/staging-txn.test.ts](https://github.com/ybotok/loam/blob/main/test/staging-txn.test.ts)
  pins the journal round-trip and recovery at every boundary, and
  [test/gherkin-crash.test.ts](https://github.com/ybotok/loam/blob/main/test/gherkin-crash.test.ts)
  plus [test/vouch-crash.test.ts](https://github.com/ybotok/loam/blob/main/test/vouch-crash.test.ts)
  drive each writer's crash-and-rerun cycle through the real CLI — each test proven to discriminate
  by reverting the behaviour it pins.
- ~~Concurrent runs for the same target serialize or refuse with a stable result~~ — the docs lock
  and `docs-busy` cover the docs repository; gherkin's service-repo commits take the same lock
  beside their own root.
- ~~Existing user-authored files, symlinks, and files appearing after planning are never
  overwritten~~ — pinned in the crash suites and the write-path integrity tests.
- ~~`doctor` reports an interrupted commit until recovery succeeds; no command silently treats a
  half-commit as healthy~~ — `validate` leads every mode with the error finding
  `docs.commit-interrupted` — including, in a service repo, over the gherkin root, where a
  half-committed suite used to grade as merely stale warnings — and `doctor` scans the same roots
  with the same codes, reported as the additive `serviceWritePath`.
- ~~Success output, JSON shape, generated bytes, and command-line compatibility remain unchanged
  unless an additive contract change is explicitly documented~~ — the new finding, doctor's
  write-path rows, and the refusal texts are the CHANGELOG'd additions; generated bytes did not
  move.

The subsystems item later extended the same machinery rather than growing a second one: a
subsystem move commits its N directory renames plus the generated views file through this same
journaled transaction
([src/commands/subsystem/txn/txn.ts](https://github.com/ybotok/loam/blob/main/src/commands/subsystem/txn/txn.ts)),
and archive snapshots were re-keyed by `(service, artifact)` so restores survive later moves
(snapshot version 3; version 2 restores forever). No open remainder is recorded against this item.

### P1 — make architecture invariants executable

[docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) and
[docs/CODE-STYLE.md](https://github.com/ybotok/loam/blob/main/docs/CODE-STYLE.md) used to describe a
stronger system than the gate proved. Landed, in three commits — the standing violations removed
first, then a move-only split of the id grammar into its own package, then the gate itself — so the
gate landed green on the real tree rather than grandfathering itself in.

Required change, and where each landed:

1. ~~Add one architecture gate that enforces file-level `import/no-cycle`, runs the package-graph
   check, rejects `commands` imports from `core`, rejects hidden barrel exports, and checks the
   documented `console`/`process` boundary~~ — done: `npm run arch:check`
   ([scripts/arch-check.mjs](https://github.com/ybotok/loam/blob/main/scripts/arch-check.mjs)) runs
   every stated invariant — file-level import cycles, the package graph, the core→commands ban
   (named and type-only imports), the barrel ban, the `console`/`process` boundary with the JSON
   envelope adapter as the named exception, the child-process timeout/output policy, and
   brand-cast containment. CI, AGENTS.md and CONTRIBUTING.md all point at it.
2. ~~Replace the `console.error` side effect in
   [src/core/envelope/config.ts](https://github.com/ybotok/loam/blob/main/src/core/envelope/config.ts)
   with a typed expected outcome~~ — done: the load returns loaded / absent / invalid-with-problem,
   command modules alone decide the rendering, and under `--json` the config-invalid envelope
   carries the actual parse problem with stderr empty. The one hidden barrel went in the same
   change.
3. ~~Require a timeout for every child process and a bounded output policy wherever output is
   buffered, and statically prevent the regression~~ — done: the three streamed git reads in
   [src/core/provenance/git.ts](https://github.com/ybotok/loam/blob/main/src/core/provenance/git.ts)
   share one collector capped at a deliberate 64 MiB, the git calls in
   [src/commands/verify/results.ts](https://github.com/ybotok/loam/blob/main/src/commands/verify/results.ts)
   carry a deadline and cap (landed with the verification-record item above), the gate checks the
   policy, and the bounds gained their missing tests: a git that never answers meets the deadline
   that names itself, and one that answers past the cap is refused rather than presented truncated.
4. ~~Finish the branded-type rule from construction through the path builders~~ — done:
   FeatureId/RawFeatureId join the service brands, DocsDir and FeatureDir carry the two directory
   provenances through every builder in
   [src/core/repo/paths.ts](https://github.com/ybotok/loam/blob/main/src/core/repo/paths.ts), the
   loaded config is typed apart from the stored spelling, and the smart constructors in
   [src/core/kernel/ids/](https://github.com/ybotok/loam/tree/main/src/core/kernel/ids) remain the
   only bridge, with directory entries keeping their explicit raw form. The migration is
   type-only: an A/B diff of the compiled output shows comments, import paths and identity
   wrappers, and 45 CLI invocations produced byte-identical envelopes, exit codes and files.
5. ~~Generalize context/no-context parity tests so memoization in
   [src/core/fleet-context.ts](https://github.com/ybotok/loam/blob/main/src/core/fleet-context.ts)
   cannot become a second implementation of a core rule~~ — done:
   [test/fleet-context-parity.test.ts](https://github.com/ybotok/loam/blob/main/test/fleet-context-parity.test.ts)
   runs every context reader against its direct core counterpart over one rich fixture, with a
   per-reader richness floor, a prototype completeness check, and a negative control.

What building the gate surfaced, fixed in the same change: two real bugs in the gate itself —
oxlint walking a symlinked root silently scans zero files and exits 0 (the gate realpaths first,
and a fixture reaches it through a link), and a chained-regex comment stripper opened a phantom
block comment on any `/*` inside a line comment, blanking 96 lines of new.ts from four of the
seven checks (replaced with a single-state scanner, with a fixture whose violation hides exactly
there). The hand-maintained brand list is pinned against the kernel's actual unique-symbol
declarations, so the next brand cannot be forgotten silently.

Exit criteria, as landed:

- ~~A single documented command runs every architecture check used by CI, and each check has a
  negative self-test~~ — `npm run arch:check`; twelve self-tests in
  [test/arch-gate.test.ts](https://github.com/ybotok/loam/blob/main/test/arch-gate.test.ts) prove a
  representative violation fails each check.
- ~~`core` contains no output or process-control side effects outside the explicitly named envelope
  adapter, and no `core -> commands` import can pass the gate~~ — the standing `console.error`
  violation is gone, and the boundary checks enforce both directions.
- ~~Every child-process call has a tested deadline, cleanup path, and deterministic error mapping;
  buffered calls declare an intentional maximum~~ — as above, with the policy statically checked.
- ~~Raw identifiers and paths cannot reach validated path builders at compile time, and casts to a
  branded type outside its constructor module fail a static check~~ — the brand migration plus the
  gate's cast-containment check.
- ~~The module graph, the package graph, and the 300-line / four-parameter / five-file limits
  retain an empty baseline~~ — all inside the one gate; new.ts crossing 300 lines under the wiring
  split its commit window into
  [src/commands/new/commit.ts](https://github.com/ybotok/loam/blob/main/src/commands/new/commit.ts),
  the same seam vouch and gherkin sit on.
- ~~Architecture prose states only invariants the gate proves or labels a rule explicitly as
  review-only~~ — DESIGN.md and CODE-STYLE.md were rewritten to exactly that standard, and the
  three open-decision rows this item closed read Done with the option chosen.

No open remainder is recorded against this item.

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
  + [docs/BENCHMARKS.md](https://github.com/ybotok/loam/blob/main/docs/BENCHMARKS.md): fixture
  shape, edge count, cold/warm policy,
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

Landed: `services/` may now be an unbounded tree of subsystem directories, each marked by a
`subsystem.yaml`, and the whole design still turns on the one decision that makes re-cutting
cheap — **a service id is the leaf directory name; placement is never part of any identity.**
`loam.json`'s `service`, `metadata { service }`, spec frontmatter, `features/<FEAT>/specs/<svc>/`
and every digest are byte-identical before and after a move; `SERVICE_ID` keeps forbidding `/`;
the tree carries no policy and nothing branches on it. The read model is the three-way
classifying walk in
[src/core/repo/tree/](https://github.com/ybotok/loam/blob/main/src/core/repo/tree/walk.ts) (one
readdir per directory walked, symlink cycles guarded), every path resolves through the
enumeration (`servicePathsAt`; the root join survives only as the reviewed `unfiledServicePaths`
creation spelling), and the surface is `loam subsystem new|move|rename|rm|list|history|sync`
plus `adopt --subsystem`. SCHEMA.md's "Subsystems" section is the design of record; the example
fleet files two services into `services/platform/` with the committed generated views file.

The ordering the roadmap demanded held: snapshots re-keyed by `(service, artifact)` landed
FIRST (`SNAPSHOT_VERSION` 3, version 2 read forever), so every archive taken since survives any
later move.

Exit criteria, as landed:

- ~~After any sequence of moves, renames and subtree moves, every join key is byte-identical, and
  no `verified` service is demoted by a move~~ — a move is directory renames plus one generated
  file; nothing else changes by a byte (test/subsystem-move.test.ts pins the whole-tree hash
  map, and the wave-2 sweep pins byte-identical command output over filed and flat fleets).
- ~~The deleted-marker merge race is a fixture~~ — `subsystem.unmarked` names every stranded
  service, the walk still descends, and the fleet is never reported smaller
  (test/subsystems-tree.test.ts).
- ~~A duplicated name anywhere in the tree, at any depth, is an error naming both locations~~ —
  `subsystem.name-collision`, one flat namespace over service ids and subsystem names together;
  `subsystem new`/`rename` refuse the collision up front as `already-exists`.
- ~~`archive`, then a move, then `unarchive` restores the pre-image byte-for-byte with no
  `--force` and no `snapshot-stale`; version-2 snapshots still restore under their own rules~~ —
  the v3 snapshot's `(service, artifact)` key resolves through the current enumeration at
  restore time AND in archive's clobber guard; the round trip runs through the real commands in
  test/subsystem-move.test.ts, and the committed FEAT-088 v2 snapshot in examples/docs keeps
  restoring by literal path (which is why the example files only services that snapshot never
  touched).
- ~~Two concurrent moves into different subsystems produce a generated file git merges without
  intervention; two moves of the same service conflict visibly~~ — both pinned with real `git
  merge` runs: disjoint groups merge clean and the merged file is byte-exact for the merged tree
  (the fleet gate stays green with no re-sync), the same service conflicts in the index and in
  the file's own lines.
- ~~The generated file is byte-reproducible from the tree on any machine, and `validate` detects
  staleness by comparing generated bytes~~ — no timestamps, no absolute paths, no readdir-order
  dependence (one tree rendered from two filesystem orders is pinned identical);
  `subsystem.views-stale` is exactly one error on exactly one file, repaired by `loam subsystem
  sync`, and nothing in loam ever parses the file (the scheduled spike confirmed a views-only
  document does not parse standalone, so the byte-compare fallback is the design).
- ~~`subsystem history` answers across at least two chained moves, and answers nothing without a
  finding when git declines~~ — the question follows a representative FILE (`git log --follow`
  is defined for one file and prints nothing for a directory — the plan critique's correction,
  kept), two chained hops answer oldest-first, and a fleet without git gets an empty answer at
  exit 0.
- ~~Unfiled services produce no findings at any count, and `validate --all` runtime is unchanged
  beyond one readdir per directory walked~~ — unfiled is a count in `loam list`
  (`unfiledServices`, beside additive `services[].subsystem` and `subsystems[]`), never a
  finding; the tree memo in `FleetContext` keeps the walk at one enumeration per invocation.

Honest leftovers: the move refuses on ANY `git status --porcelain` entry under a moved
directory, untracked files included — stricter than "uncommitted changes to tracked files"; the
refusal's prose says "uncommitted or untracked" and its remedy names `git stash -u`, because a
plain `git stash` leaves untracked files behind and would loop the user back into the same
refusal; and a `subsystem rm` killed in the instant between its marker
unlink and its rmdir can leave an empty marker-less directory that lists as an unfiled service —
visible, harmless, and removed by hand.

### Name the capabilities the fleet promises, and join requirements to them

Landed: business behaviour now has the fleet-level place where its parts add up, in the deliberate
half that costs little — a declared vocabulary, a join line on requirements, two-way grading, and
one readable rollup. "Which parts of registration does nothing in 120 services claim to implement"
is one command instead of a grep across 120 directories. No prose moved and no authoring surface
was added: that remains the evidence-gated Later item below, and this rollup is the evidence that
decides it.

Required change, and where each landed:

1. ~~Add `architecture/capabilities.yaml` in the shape
   [src/core/permissions/permissions.ts](https://github.com/ybotok/loam/blob/main/src/core/permissions/permissions.ts)
   already proves~~ — done:
   [src/core/capabilities/capabilities.ts](https://github.com/ybotok/loam/blob/main/src/core/capabilities/capabilities.ts)
   walks the same defensive ladder — the FILE is the opt-in (the pinned divergence from
   `Requires:`, where the line opts in), nested ids such as `payments/refunds` keep their slashes,
   and an unreadable vocabulary is `capability.invalid`, the run's one finding about it,
   suppressing the family behind it rather than answering from a file nobody can read.
2. ~~Add a `Capability:` line to the requirement grammar in both spec files, a list, many-to-many
   in both directions~~ — done: parsed beside `Requires:` with the same comma grammar in
   [src/core/document/parse.ts](https://github.com/ybotok/loam/blob/main/src/core/document/parse.ts),
   with one spelling (`CAPABILITY_LINE_RE` in
   [src/core/document/spec.ts](https://github.com/ybotok/loam/blob/main/src/core/document/spec.ts))
   and additively: the line rides in the requirement digest exactly as the other axis lines do, so
   no living document's digest moved because loam learned to read it.
3. ~~Grade both directions, as the authorization axis already does~~ — done
   ([src/core/capabilities/findings.ts](https://github.com/ybotok/loam/blob/main/src/core/capabilities/findings.ts)):
   `capability.unknown` errors with close-name suggestions, on the living spec documents at the
   service target and, through coherence, on a feature's deltas — where it refuses `loam archive`
   (`--approve`-overridable), the only new gate this axis added; `capability.unrealized` warns
   once per declared-but-unnamed capability, never once per service.
4. ~~Report the total through `list`, `explore` and the JSON envelope~~ — done: `loam list
   capabilities` is a new explicit-only section (the no-argument default and every existing
   section's payload stayed byte-identical) and `loam explore --capability` seeds the realizing
   services, every miss landing in the additive `unresolvedCapabilities` field, refused never —
   both over the one deterministic rollup
   ([src/core/capabilities/rollup.ts](https://github.com/ybotok/loam/blob/main/src/core/capabilities/rollup.ts)).
5. ~~Preserve capability identity through `migrate-openspec`~~ — done: every routed requirement —
   living, delta, and rename-materialized alike — gains a `Capability:` line, and the staged
   target declares the union of living and active-horizon ids, so migration stops being the step
   where the analyst's structure is lost. The requirement→service mapping stays a human decision.
6. ~~Nothing new gates `archive` in this item beyond the unknown-name error~~ — held.

[COMPARISON.md](COMPARISON.md) and [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) stopped
filing the axis as a migration caveat, and [SCHEMA.md](SCHEMA.md) records what was rejected — an
unchecked free-text label, and an authored prose layer, the second of which stays the Later item.

Exit criteria, as landed:

- ~~A vocabulary that does not parse produces exactly one error for the whole run, and the family
  is suspended~~ — with the qualification the closing review forced into the prose: once per
  `validate --all` run, with single-target runs silent about the file. Pinned end to end in
  [test/capabilities.test.ts](https://github.com/ybotok/loam/blob/main/test/capabilities.test.ts).
- ~~An undeclared capability name is an error naming close candidates; a declared capability
  nothing realizes is one warning per capability, not one per service~~ — pinned, including the
  arch-delta-only branch proven by reversion; the example fleet demonstrates both sides — three
  realized capabilities across four requirements, plus payments/settlement declared and realized
  by nothing, the eighth pinned demonstration warning.
- ~~A fleet with no `architecture/capabilities.yaml` produces no capability findings at all~~ —
  pinned as silence, hoisted into a guard so a silent axis does not even read the arch delta that
  exists only to feed it.
- ~~The rollup is deterministic with `--json` ordering stable enough to diff~~ — byte-identical
  rollups pinned.
- ~~A migrated OpenSpec workspace retains every capability id, and no requirement loses the
  association its source file expressed~~ — pinned in the migrate-openspec suite: the declared
  union plus the `Capability:` line on every routed requirement.
- ~~`validate --all` pays one additional YAML parse per invocation and no additional per-service
  cost~~ — the context memo counts the parse, the rollup's injected reader adds no per-service
  parses, and the review made an empty vocabulary answer before the walk, so a vocabulary-less
  fleet stops paying spec parses to build zero rows.

Honest leftovers: the authored half stays deliberately unbuilt — `verify` still never reads
`intent.md`, so a feature's `## Business acceptance` still joins to nothing until the Later
authored-axis item is promoted on this rollup's evidence — and the vocabulary `migrate-openspec`
declares carries empty bodies by design: no description is invented, because the authored Purpose
prose stays verbatim under `legacy/` and no prose moves.

### Protect documentation, package contents, and links

Landed: public prose is now graded by the same kind of machinery that grades a fleet's documents.
One reviewed package-file list lives in
[scripts/package-docs.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-docs.mjs) beside
the Markdown-link helpers (inline-link extraction outside code, GitHub heading slugs with an
ambiguity refusal instead of modelling `-1` suffixes, and the anchor/relative/canonical/external
classification). package.json's `files[]`, the release preflight and the installed-package smoke all
consume that one list, and
[test/docs-facts.test.ts](https://github.com/ybotok/loam/blob/main/test/docs-facts.test.ts) plus
[test/package-docs.test.ts](https://github.com/ybotok/loam/blob/main/test/package-docs.test.ts) run
the fact and link guards inside `npm test`, so drift fails the gate developers actually run before
push. The first run of the audit convicted two shipped links (a pointer at the pre-split
`src/core/kernel/ids.ts`, and a relative `docs/BENCHMARKS.md` link that dangled for every installed
user) and a run of stale claims — README still calling the AsyncAPI lifecycle living-only, the
OpenAPI baselines unpinned and the fleet gate slow after all three landed, plus DESIGN's command and
hub counts — which is the item's own thesis demonstrated: unguarded derived facts rot.

Exit criteria, as landed:

- ~~README, schema, workflow, design, migration, comparison, and this roadmap agree on released
  status, implemented gates, branded types, command/package counts, known gaps, and the
  `architecture/permissions.yaml` vocabulary~~ — the stale claims above were corrected honestly
  rather than shielded, the fleet-scale numbers now carry their measurement date, and SCHEMA's
  authorization example round-trips
  [src/core/permissions/permissions.ts](https://github.com/ybotok/loam/blob/main/src/core/permissions/permissions.ts)'s
  real reader in a fixture, so the documented `owned_by`/`enforced_by`/`description` spellings are
  executable, not illustrative.
- ~~Derived facts are generated or pinned by focused tests; measured facts carry an assessment
  context rather than masquerading as timeless constants~~ — counted facts must equal a live
  derivation (modules/packages by the package-graph rules, test files by readdir, commands by the
  built program, command modules by cli.ts's import specifiers) or sit under this document's dated
  `_Assessed_` Current assessment, which stays byte-identical as the audit snapshot it is; the
  README command table is set-equal to the registered commands with a row-count backstop; and every
  dotted backticked token in the nine shipped pages must be a code loam emits, a verify claim kind,
  or a reasoned allowlist entry — "implemented gates" prose is now executable.
- ~~The installed-package smoke checks every Markdown file intended for npm, and a link check proves
  that each relative link resolves inside the tarball or is intentionally a canonical repository
  link~~ — [scripts/package-smoke.mjs](https://github.com/ybotok/loam/blob/main/scripts/package-smoke.mjs)
  reads all nine shipped pages from the installed package root, requires the tarball's Markdown set
  to equal the reviewed set (an unreviewed page and a dropped one both fail), and proves every
  relative link resolves inside the tarball, every used anchor slug-matches exactly one heading in
  the shipped target, and every canonical repository link names a path that exists in the source
  tree; other absolute URLs are never fetched, so the smoke gains no network beyond its existing
  npm install. Verified green against the real tarball.
- ~~package.json, the release preflight, and the public documentation share one reviewed list of
  package-facing documents; no published page links to an omitted local file~~ — `files[]`
  set-inequality with the reviewed list is now a release blocker in
  [scripts/release-check.mjs](https://github.com/ybotok/loam/blob/main/scripts/release-check.mjs)
  and an `npm test` failure, and every reviewed page must be relatively linked from README, so
  adding a shipped document is deliberately a three-place edit whose blocker text names all three
  places.
- ~~Known-gap prose has a test or an owner and is removed in the same change that closes the gap~~ —
  the registry in test/docs-facts.test.ts pairs each shipped gap sentence with the roadmap sentence
  that owns closing it, and both are asserted to exist: shipping an item deletes its owner prose,
  which fails the gate until the gap sentence and the registry entry leave in the same change. That
  coupling is deliberate friction for whoever closes the next item, and the registry's comment says
  so in place.

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
