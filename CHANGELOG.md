# Changelog

All notable project changes are recorded here. The format follows Keep a Changelog, and release versions follow Semantic Versioning.

## [Unreleased]

This entry covers the pre-publication hardening pass. Most of it is not new capability — it is the difference between a command that reports a problem and one that was quietly blind to it, and in four places it is the difference between an undo that works and one that certifies text nobody wrote. Grouped by what a user would notice.

### Fixed — data loss and silent failure

- **A file whose bytes are not UTF-8 is no longer rewritten.** The whole write path moves bytes rather than strings; text is produced only where a parser needs it. Undecodable content refuses the merge (`merge-failed`, naming the file) instead of replacing every such byte with U+FFFD — in the living document *and* in the snapshot meant to undo it, which left nothing to restore from. A non-UTF-8 `openapi.yaml` now grades `openapi.invalid` instead of being handed to the YAML parser with the damage already done.
- **`unarchive` no longer restores an edited snapshot and certifies it.** The snapshot manifest is version 2: every entry records `before`, a sha256 of the pre-image it will restore, alongside the existing `after`. `unarchive` hashes each pre-image before staging anything and refuses on a mismatch (`snapshot-corrupt`) — and `--force` deliberately does not override it, because `--force` discards later changes to the living docs while the damage here is to the undo itself. A version-1 snapshot is refused as `snapshot-missing`.
- **A commit killed halfway can now be repaired.** `archive` and `unarchive` fsync an intent journal (`.loam-commit`) before the first swap and recover from it on the next run, under the lock: an archive is undone, an unarchive is finished (the merged text it was replacing is recorded nowhere else). Where the files no longer permit a safe repair the answer is `commit-interrupted`, a refusal. Previously a SIGKILL between two renames left a half-merged repo that `doctor` called healthy, `validate` blamed on the author's delta, and nothing could roll back.
- **A removal marker can no longer be published into a living contract.** `x-loam-remove` written at path level, beside the methods, names no operation and retires nothing; `archive` gates it (`openapi.remove-marker-path-level`) and the marker is stripped from every merge branch, so it never reaches the fleet's living OpenAPI under any flag.
- **Symlinked service and feature directories are enumerated.** A `services/<svc>` or `features/<FEAT>` reached through a symlink used to vanish from every listing, which also produced a false `landscape.binding-unknown` for the service that was right there. Dangling links are skipped exactly as an absent directory is.

### Fixed — checks that were blind

- **Nested landscape elements are graded.** The landscape cross-check kept only top-level elements, so ordinary grouped C4 — services under an `enterprise`, `group` or `boundary` — reported *every* service as unmodelled. The tree is walked instead: an element is at service level when no ancestor already stands for a service, an element that contains a service is a grouping, and `landscape.binding-unknown` is now graded at any depth.
- **A missing `openapi.yaml` no longer silences the API axis.** It is an **error** when a living non-`REMOVED` `Operations:` line or an op-linked landscape edge already points into the absent file, with the stranded operationIds in `details`; a warning when nothing does and the landscape cannot prove nobody calls the service; silent when it can. Correspondingly, one absent contract is one finding rather than one `spine.op-undefined` per inbound consumer — a file that is not there proves nothing about an edge.
- **A feature delta addressed to a nonexistent service is refused** (`delta.service-unknown`, naming close ids). A typo in `--touches` used to validate green and materialise a phantom service directory on archive.
- **`openapi.duplicate-operationid` fires in service scope**, not only through an unrelated feature's delta — so `validate --all` sees it on a fleet with no feature in flight.
- **`c4.uncovered` no longer fires on a re-declared edge.** A delta that restates a living edge to hang a requirement on it was told to write a decorative architecture requirement.
- **`loam doctor` reports what it could not see before**: a held or stale `.loam-lock`, an interrupted commit, orphaned staging temp files, and generated command/skill files that have fallen behind (below).

### Changed — verification says which answers came from a test run

`--record` may still confirm a `scenario.tested` claim on an agent's word; a service with no runnable suite yet has to be able to record its answers. What changed is that the record now says so, everywhere:

- a three-valued **`verdict`** — `verified`, `attested`, `unverified` — recomputed from `claims[]` on every read and never taken from the record's own `summary:` block. `verified` in `--json` is exactly `verdict === "verified"`, so a record with zero claims no longer reads as verified by arithmetic;
- `verify.scenario-attested` (warning, gating nothing) naming each claim, on the read view, the recording view and the frozen post-archive view alike; `loam status` re-reports it and offers `next.verify-attested`, and such a feature reaches `stage: ready`, never `done`;
- a `summary:` block contradicting its own `claims[]` makes the whole record `record-unreadable` (`verify.record-miscounted`) — neither half can be believed, so neither is reported as fact;
- `--results` writes down **which report it read** (path, sha256, mtime, tagged-scenario count), must resolve inside the attesting repository in federated mode, and refuses a committed report that differs from the attested commit. That says which file was consumed; it does not say the file came from executing that commit, and no digest can;
- two services wording a scenario identically share one digest, so a single report cannot say whose suite ran it: those claims are left unconfirmed under `verify.digest-contested` rather than confirming both.

### Changed — `loam status` is a projection over the gates

`status` used to say "ship it" on trees `archive` refused. It now takes `stage` and `next[]` from the union of what `validate --feature` errors on and what `archive` refuses to merge, so it may be more pessimistic than either and is never greener than both — an invariant with a test behind it. Also: `checks.coherent` runs the same functions `validate` does (coherence, provenance, missing scenarios); `owesContract` keys on the contract *file* rather than the service directory; `next[]` names `loam delta`, `loam gherkin` and `loam rebase`; the fleet form is capped at ten steps plus a `next.elided` notice and always ends on `next.fleet-gate`; and a filesystem failure that carries no path (a directory where a file belongs) is reported rather than crashing the command.

### Changed — generated agent files carry a version stamp

Every generated command and skill body now opens with `<!-- generated by loam vX.Y.Z -->`, and `loam doctor` raises `doctor.agent-files-stale` for a file with no stamp or an older one. loam still never rewrites a generated file — the fix is a human's — but drift is now detectable, which it previously was not: a command file mangled to one line left `doctor: healthy: true`. Doctor also stops reporting a repo initialized `--no-skills` as missing its skills.

`loam rebase` and `loam status` were added to the shipped workflow bodies, which is where the mechanism that prevents two in-flight features from overwriting each other actually gets run. `doctor`'s fix line now spells `loam adopt --service <id>`; the positional form it used to print is refused by the CLI, and a new test parses every command loam prints against the real CLI so that class of defect cannot return silently.

### Changed — `loam init` keeps the pointer it was given

`--docs` wins only when it is actually passed. A re-run in a wired repository keeps the `docsDir` its committed `loam.json` already names, `--create` included, and spreads the rest of the config forward; `--json` reports `docsDirSource` as `flag`, `config` or `default`. Following `doctor`'s advice to re-run `init` used to repoint the repo at an empty decoy over which `validate --all` went green.

### Fixed — the OpenSpec on-ramp

- **A Store checkout is audited by its planning shape, not by its marker.** A `.openspec-store/store.yaml` beside real `specs/` used to make audit look for `<checkout>/openspec`, find nothing, and report `ready: true, capabilities: 0` — then apply a target holding no requirements at all. The shape picks the root; the marker picks only the kind; a checkout with planning content in neither place is refused by name.
- **A workspace nobody could read is never `ready`** (`openspec.workspace-empty`).
- New blockers for shapes that silently migrated nothing: `openspec.change-quoted-requirements` (requirements under `## Requirements` inside an active delta — the shape OpenSpec's own living template mandates, which stages nothing in a change), `openspec.nonstandard-living-spec` (markdown under `specs/` named neither `spec.md` nor `design.md`), `openspec.hidden-change-directory` (a dot-prefixed directory under `changes/`, which enumeration skips).
- **The source digest no longer covers archived changes.** Frozen history never gates, so it must not be able to invalidate a completed mapping either; a living or active edit still does.
- **The staged target is a real docs repo** — its own `loam.json`, `AGENTS.md` and an empty `architecture/landscape.likec4` — so `FOLLOW-UP.md`'s instructions run where they are written, and `FOLLOW-UP.md` now ends with the cutover procedure: `services/` and `features/` move, everything else is review residue.
- **A target inside a live loam fleet is refused**, instead of producing phantom features in every `loam list`.
- The living capability tree is copied verbatim under `legacy/openspec/specs/`, so `## Purpose` prose, section prose and capability `design.md` are preserved rather than dropped; an ISO-8601 `created` timestamp is a valid date; fenced FROM/TO examples inside a `## RENAMED Requirements` block are no longer parsed as renames; and a rename's TO name no longer demands a service allocation the router never asks for.

### Performance

`loam list` and `loam validate --service` are now flat in landscape edge count: loam reads LikeC4's parsed model and never computes a view, which it had no use for. On a generated 120-service fleet the same commands previously did not finish above roughly 200 edges. Measured at 120 services and 400/800 edges on an 8-core laptop: `list --json` 1.1–1.5 s, `validate --service <id> --json` 1.4–1.6 s. `loam init` no longer scaffolds a `views { view index { include * } }` block it never reads.

`loam validate --all` remains ~30 s on that fleet — it parses a fresh LikeC4 workspace per service — and no speedup is claimed for it. Its target loop is now a bounded pool rather than a serial `await`, which is byte-for-byte output-identical and deterministic in ordering, but measured as a wash on the hardware available; the lever that moved this command was the parsed model, not the loop shape.

### Fixed — release engineering

- The CI `package` job could never pass: `release-check.mjs` refused `--fixture-ready` whenever `GITHUB_ACTIONS` was set. The guard now keys on a tag ref, which is what it was actually protecting against. Any claim that CI had validated release readiness was false before this.
- `npm run test:package` failed against the current tarball — the smoke test called `loam init --docs docs` without `--create`.
- Five release scripts spawned `npm.cmd`/`loam.cmd` without a shell, which Node ≥ 20.12 rejects on Windows; they now resolve npm's CLI and run it through `process.execPath`. Windows itself is unexercised here — there is no Windows host — so this is verified structurally and by the first real CI run.
- `pack-release` and `verify-release-artifact` compared an unpeeled `GITHUB_SHA` against `HEAD`, so an annotated or signed tag — the `npm version` and `git tag -a/-s` default — could never pass. Both peel now; `git tag -s v<version>` works.
- Release artifact retention raised 1 → 14 days, so a candidate awaiting human approval outlives a weekend; CI narrowed to pushes on `main` with a concurrency group, so tags no longer run both workflows in parallel.

### Documentation

README, COMPARISON, SCHEMA and MIGRATING were re-checked claim by claim against the code and against upstream OpenSpec live on 2026-08-05. Corrected: the documented migration entry point (`migrate-openspec <root>` returns `invalid-option`; `audit-openspec` is the real first step and appeared nowhere in the README), the corpus and test counts, the `--baseline` flag the reproduction recipe needs, the Executability and agent-surface comparison rows, and the claim that OpenSpec has no multi-repo story — Stores shipped in v1.5.0, and the honest argument is their documented "No sync, ever — by design" plus the absence of any lockfile or commit pin. Removed: the argument that upstream's generated instructions are broken, which upstream fixed inside 48 hours and which loam had in its own surface.

### Added

- A tag-driven npm release gate using GitHub OIDC trusted publishing and provenance.
- A reproducible two-fleet pilot harness and scorecard contract.

### Changed

- The supported runtime now matches the direct LikeC4 dependency: Node.js 22.22.3 or newer.

## Release candidate awaiting a date

`0.1.0-beta.1` is the current package version, but this file does not claim that it has been published. Before creating `v0.1.0-beta.1`, move the relevant notes into a dated `## [0.1.0-beta.1] - YYYY-MM-DD` section. The release preflight enforces that step.
