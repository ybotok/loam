---
service: loam
status: draft
owner: spentsov
---

# loam — architecture spec

`docs/DESIGN.md`'s numbered rules, as requirements whose `Covers:` lines land on the
real objects of `architecture/landscape.likec4` (70 boxes of `src/`, 407 import edges)
and `model.likec4` (the runtime crossings). DESIGN.md remains the normative text: it
carries the measurement and the defect history behind each rule, and this file carries
only what a machine can hold the rule to.

## What is NOT covered here, and why that is the finding

**Twelve of DESIGN's twenty-six numbered rules have nothing in any model to point at,
and no requirement below pretends otherwise.** `Covers:` can only name an object that
EXISTS — an element, an edge, or a `health.yaml` signal — and these twelve are
PROHIBITIONS whose whole content is that the object has zero instances:

| Rule | Why it cannot be covered |
|---|---|
| 3 — `core/` never imports `commands/` | The object would be a core→commands edge. There are none, which is the rule holding |
| 4 — no value-import cycles | The object would be a cycle. There are none at file or package granularity |
| 9 — no interface with one implementation | Zero such interfaces; `rg` is the check, and an absence is not an element |
| 11 — no barrel or `index.ts` re-export | Zero such files |
| 14 — no filesystem port, no injected or fake FS | Zero such abstractions |
| 15 — at most four parameters | A parameter is not a model object |
| 16 — same parameter order for same types | A signature property, invisible to a package graph |
| 17 — take the `FeatureEntry`, not `(dir, id)` | A signature property, as above |
| 22 — do not move to workspaces or `packages/` | Zero workspaces |
| 23 — do not vertical-slice by command | Zero slices |
| 24 — do not add a dependency to express structure | Zero such dependencies |
| 25 — do not move code because it would be cleaner | A process rule about how a change is decided, not a fact about the tree |

Inventing an element so one of them could fire is exactly what ROADMAP.md's second
exit criterion for this axis forbids, so they stay uncovered and stay listed. All
twelve are enforced — 3, 4, 11 and 14 by `npm run arch:check`, 15 by
`test/code-limits.test.ts`, 16 and 17 by tsc once applied, and 9, 22, 23, 24 and 25 by
review against DESIGN.md, which that page's own "What enforces what" section says.

**Silent families, so a green run here is never read as a fleet's worth of coverage.**
This service declares no `openapi.yaml`, no `asyncapi.yaml`, no `permissions.yaml`, no
`capabilities.yaml`, no `health.yaml`, no `sources:` and no `dynamic view` — because
loam has no HTTP surface, no message, no authorization vocabulary, no alerting, no
resolvable source tree from this directory, and no service-to-service call sequence.
The `api.*`, `event.*`, `spine.*`, `permissions.*`, `capability.*`, `health.*`,
`usecase.*`, `obligation.*`, `sources.*` and `link.*` families are therefore quiet
here, and quiet because nothing asked them, not because they passed.

**And one more, which is the axis's own blind spot rather than a missing artifact.**
`c4.uncovered` — the mechanical "every element and edge wants a covering requirement"
— is graded only on what a FEATURE DELTA introduces (`validate/arch-coverage.ts`).
There is no living-scope pass, so every container and every edge below that no
requirement names raises nothing at all, and they are the large majority of both.
`covers.unknown` is the only part of this axis that bites from a standing repository:
it proves every `Covers:` line here resolves, and says nothing whatever about what is
left over.

## Requirements

### Requirement: The entry module registers and decides the exit, and nothing else

Requirement-ID: ARCH-LOAM-LAYERS
`src/cli.ts` SHALL contain command registration and process-exit handling only, and every
command module SHALL own the printing and the exit code for its own verb, so that the
three layers of `docs/DESIGN.md`'s layers table are a fact about the tree rather than a
description of it.

Covers: loam.cli, loam.cli -> loam.commands.validate, loam.cli -> loam.commands.mcp

#### Scenario: A command is added
- **Given** a new `register*` function in a new module under `src/commands/`
- **When** it is wired into `buildProgram()`
- **Then** `src/cli.ts` gains one import and one call, and no branch on what the command does

#### Scenario: A command has no help heading
- **Given** a registered command that no `--help` group names
- **When** `src/cli.ts` builds the program
- **Then** it fails closed rather than printing the command under no heading

### Requirement: Only the envelope prints

Requirement-ID: ARCH-LOAM-NO-PRINT
No module under `src/core/` SHALL call `console.*`, with the single exception of
`core/envelope/json.ts`, which is the output layer — because a core module that prints
cannot be reused by a second command or tested without capturing stdout.

Covers: loam.core.envelope, loam.envelope -> console

#### Scenario: A stray print is added to core
- **Given** a `console.error` added to a module under `src/core/`
- **When** `npm run arch:check` runs its core-boundary scan
- **Then** it fails naming the file, and `test/arch-gate.test.ts`'s negative self-test
  proves the scan can still see one

#### Scenario: The historical exception is gone
- **Given** `loadConfig`, which once printed its own failure
- **When** a config file does not parse today
- **Then** it returns a typed `ConfigLoad` outcome and the command layer renders it

### Requirement: Only the envelope owns the process

Requirement-ID: ARCH-LOAM-NO-PROCESS
No module under `src/core/` SHALL read `process.argv`, call `process.exit`, or set
`process.exitCode`; `core/envelope/json.ts` is the only module that touches `exitCode`,
and `src/cli.ts` is the only place that decides the process exit.

Covers: loam.cli, loam.core.envelope

#### Scenario: A core module tries to end the run
- **Given** a `process.exit(1)` added under `src/core/`
- **When** `npm run arch:check` runs
- **Then** it fails on the layering scan before any test does

#### Scenario: A command refuses
- **Given** a command that must refuse
- **When** it refuses
- **Then** core returns the refusal as a value and the command layer sets the exit code

### Requirement: A command imports a command only through a named exception

Requirement-ID: ARCH-LOAM-CMD-CMD
A module under `src/commands/` SHALL NOT import another command module except through
the recorded exceptions — the shared policy package, `unarchive`'s reuse of
`sayRecovery`, and the `register*` functions `mcp` and `validate` re-enter — and a
second exception SHALL be a new shared module rather than a second exception.

Covers: loam.commands.policy, loam.commands.unarchive -> loam.commands.archive, loam.commands.mcp -> loam.commands.list, loam.commands.validate -> loam.commands.list

#### Scenario: Two commands need the same helper
- **Given** a helper written in one command and wanted by a second
- **When** the second command needs it
- **Then** it moves to `core/` or to `commands/policy/`, and the command→command import
  is not added

#### Scenario: The structural exception stays structural
- **Given** `commands/mcp/dispatch.ts`, which imports the `register*` functions of the
  read commands it re-enters
- **When** a reader asks whether that is the shape this rule bans
- **Then** it is the same function `src/cli.ts` imports for the same purpose — building a
  program — and the acyclic alternative does not exist

### Requirement: A raw string that reaches a path join is validated at the command boundary

Requirement-ID: ARCH-LOAM-ID-BOUNDARY
Every command that turns an argument into a filesystem path SHALL pass it through the
service-id grammar or through `core/repo/service-target.ts` first, so that no
unvalidated argv string reaches a path builder.

Covers: loam.core.kernel, loam.commands.new -> loam.core.kernel, loam.commands.adopt -> loam.core.kernel, loam.commands.validate -> loam.core.repo

#### Scenario: A traversal is offered to validate
- **Given** `loam validate --service ../../etc`
- **When** the command resolves its target
- **Then** it exits `invalid-option` through `--service` and the positional form alike, and
  a tree hash before and after proves the refusal wrote nothing

#### Scenario: A badly-named directory still grades
- **Given** a `services/` directory whose name the grammar would refuse
- **When** `loam validate --service <that name>` runs
- **Then** the enumeration answers first, so the one service `--all` complains about is not
  the one service `--service` cannot look at

### Requirement: A shared grammar is spelled in exactly one module

Requirement-ID: ARCH-LOAM-ONE-GRAMMAR
The service-id and feature-id grammars SHALL each exist in exactly one module under
`core/kernel/ids/`, and any command needing one SHALL import it rather than restating the
regex.

Covers: loam.core.kernel, loam.commands.explore -> loam.core.kernel

#### Scenario: A second copy is written
- **Given** a feature-id regex spelled a second time anywhere in `src/`
- **When** the gate runs
- **Then** the rule-7 test fails, because the regex source must appear once

#### Scenario: A printed command must parse
- **Given** `loam explore --as <FEAT>`, which interpolates its argument into a `loam new`
  line it prints for an agent to run
- **When** the id grammar is shared rather than copied
- **Then** the printed line is one `loam new` accepts, which a private copy once made false

### Requirement: Code moves to core at the second caller

Requirement-ID: ARCH-LOAM-SECOND-CALLER
A helper living in a command module SHALL move to `src/core/` when a second command needs
it, or when the untestable half of an algorithm is stranded in a command — never as a
command→command import.

Covers: loam.core.projection, loam.commands.delta -> loam.core.projection, loam.core.pack -> loam.core.projection

#### Scenario: A second caller arrives
- **Given** the delta projection helpers, written inside `loam delta`
- **When** `loam context` becomes their second caller
- **Then** they move to `core/projection/` rather than being reached around the layer

#### Scenario: A dial with two readings is not a dial
- **Given** the adoption-maturity ladder, written inside `loam list`
- **When** `loam explore` needs the same rung
- **Then** it moves to `core/vocabulary/`, because two copies of one ladder answer
  differently the day one of them is edited

### Requirement: A class is an Error subclass or a per-invocation cache

Requirement-ID: ARCH-LOAM-NO-CLASSES
`src/` SHALL declare no exported class other than a typed error and `FleetContext`, which
holds per-invocation cache state — so nothing in the codebase is a service object with a
lifetime nobody declared.

Covers: loam.core.fleet_context

#### Scenario: A manager is proposed
- **Given** a proposed `SomethingManager` holding methods and no state
- **When** it is reviewed against this rule
- **Then** it is a module of functions instead

#### Scenario: The one cache dies with its invocation
- **Given** a `FleetContext` built for one command run
- **When** the run ends
- **Then** nothing it cached survives into the next, because tests `chdir` per invocation
  and a value cached at import time leaks across them

### Requirement: A FleetContext method may memoise; it may never compute

Requirement-ID: ARCH-LOAM-CACHE-ONLY
A `FleetContext` reader SHALL return exactly what its direct core counterpart returns, and
SHALL NOT reimplement the computation — so that a command holding a context and one
without can never disagree about the same fleet.

Covers: loam.core.fleet_context, loam.core.fleet_context -> loam.core.openapi

#### Scenario: A reader is added
- **Given** a new reader on `FleetContext`
- **When** the gate runs
- **Then** `test/fleet-context-parity.test.ts` compares it against its core counterpart over
  a rich fixture, with a richness floor and a negative control proving the comparator bites

#### Scenario: The tombstone case
- **Given** `serviceOperationIds`, whose context copy once interleaved removals with upserts
- **When** `archive` (no context) and `validate` (context) asked whether an operation existed
- **Then** they disagreed, and that disagreement gated an archive — which is why the rule is
  a rule and not a preference

### Requirement: A shared helper is extracted at the third copy

Requirement-ID: ARCH-LOAM-THIRD-COPY
A block repeated twice SHALL stay repeated; the third occurrence SHALL become a shared
module — because an earlier extraction invents the wrong seam, and a later one lets a fix
land in one copy of four.

Covers: loam.commands.policy, loam.commands.status -> loam.commands.policy, loam.commands.gate -> loam.commands.policy

#### Scenario: Five renderers, one ternary
- **Given** five renderers that had drifted into five copies of one formatting ternary
- **When** the third copy appeared
- **Then** `commands/policy/format.ts` was written, and the five now read one definition

#### Scenario: A fix lands in one copy of four
- **Given** four copies of an errno reading, one of which is corrected
- **When** the other three are not
- **Then** `list`, `show` and `validate` report `internal` where `status` correctly reports
  `repository-unavailable`, which is the defect `docs-repo-gate.ts` exists to end

### Requirement: A validated identifier carries a brand, constructible one way

Requirement-ID: ARCH-LOAM-BRANDS
A validated identifier or path SHALL carry a branded type, an unvalidated one SHALL keep its
own raw type, and the cast that creates a brand SHALL exist only inside the smart constructor
that did the checking.

Covers: loam.core.kernel, loam.core.repo -> loam.core.kernel

#### Scenario: A cast is written outside a constructor module
- **Given** an `as ServiceId` anywhere but the constructor modules
- **When** `npm run arch:check` runs its brand-cast scan
- **Then** it fails, because a brand reachable a second way is a type the compiler happens to
  typeset

#### Scenario: The enumeration returns names that failed validation
- **Given** a `services/` directory whose name is not a legal id
- **When** `loam list` enumerates it
- **Then** it comes back as the raw form and is shown, because the raw and validated types are
  two types rather than one type with a knowingly false cast

### Requirement: An expected outcome is a return value

Requirement-ID: ARCH-LOAM-RESULTS
A validation result, a "not found" and a refusal SHALL be returned as data; an exception SHALL
be reserved for the genuinely unexpected, and the read that can fail SHALL happen inside the
`try` that handles it.

Covers: loam.core.envelope, loam.commands.policy -> loam.core.envelope

#### Scenario: The config file is a directory
- **Given** a `loam.json` that is a directory rather than a file
- **When** any command loads it
- **Then** it refuses as the designed `config-invalid`, not as `internal` — which is what a read
  performed one line above its own `try` produced

#### Scenario: A parse detail reaches the envelope
- **Given** a `loam.json` that does not parse
- **When** the command is run with `--json`
- **Then** the envelope carries the reason, because `loadConfig` returns it rather than printing it

### Requirement: Every child process is bounded

Requirement-ID: ARCH-LOAM-CHILD-BOUNDS
Every `child_process` call in `src/` SHALL carry a timeout, and every buffering call an explicit
`maxBuffer`; a streamed read SHALL carry a named output ceiling past which the child is killed and
the answer is "git will not say", never a truncated denominator.

Covers: loam.core.provenance, loam.invocation -> git

#### Scenario: A credential helper blocks
- **Given** a `git` invocation that waits forever on a blocking credential helper
- **When** `loam verify --record` runs
- **Then** the deadline fires and the command reports rather than hanging with no output

#### Scenario: A repository is larger than the ceiling
- **Given** a git read whose output exceeds the named ceiling
- **When** the ceiling is reached
- **Then** the child is killed and loam answers "git will not say", rather than reporting a
  denominator computed from half the output

### Requirement: src/ is a tree of packages, each at most five files, and the package graph is acyclic

Requirement-ID: ARCH-LOAM-PACKAGES
Every directory under `src/` SHALL hold at most five files, splitting along a subject seam rather
than at a line count, and the package-level import graph SHALL be acyclic — a property
`import/no-cycle` cannot see, because it reads the file graph and two packages can point at each
other through a pair of files that are themselves perfectly acyclic.

Covers: loam.core, loam.commands

#### Scenario: A sixth file arrives in a package
- **Given** a package that already holds five files
- **When** a sixth is added
- **Then** `test/code-limits.test.ts` fails, and the question "which two subjects are in here?" is
  asked by the tree instead of at review time

#### Scenario: A module is moved between packages
- **Given** a module moved from one package to another
- **When** `npm run arch:graph` runs on the result
- **Then** a package-level cycle the file graph cannot show is reported before the move is committed

#### Scenario: The grouping that would have had a cycle
- **Given** `fleet-context`, which looked like it belonged with `repo` because it is the read
  model's cache
- **When** the package graph was computed over that grouping
- **Then** `repo/` and `api/` pointed at each other while every file stayed acyclic, which is the
  failure this obligation exists to catch

### Requirement: loam reads what a view declares and never computes what it shows

Requirement-ID: ARCH-LOAM-PARSED-ONLY
loam SHALL read a LikeC4 view only at the parsed stage, restricted to what an author wrote, and
SHALL NOT call the computed or layouted stages — because those resolve predicates against the
model and derive the edges a diagram needs, which is computing rather than reading.

Covers: loam.core.c4, loam.parser, loam.parser -> docsRepo

#### Scenario: A computed accessor is added
- **Given** `computedModel` or `layoutedModel` written anywhere in `src/`
- **When** `npm run arch:check` runs
- **Then** it fails outright — there is no whitelist, because there were zero occurrences when
  the rule landed

#### Scenario: The raw record escapes its module
- **Given** a `$data` access written outside `src/core/c4/parsed/`
- **When** the containment scan runs
- **Then** it fails, so the blast radius of an upstream shape change stays one module

#### Scenario: The shape moves upstream
- **Given** a future LikeC4 whose parsed view record the adapter cannot read
- **When** loam loads a document
- **Then** it returns "no views read" and every dependent check reports could-not-look, never
  nothing-wrong

### Requirement: A feature is graded against the corpus its own merge would leave behind

Requirement-ID: ARCH-LOAM-FEATURE-CORPUS
A check that runs inside a feature window SHALL resolve a join against feature ∪ living, never
against the living corpus alone — because the two halves of one change arrive together, and a
check that can only see the living half refuses the change for being incomplete at a moment when
it is not yet complete by construction. Where the overlaid corpus is a PARSED artifact rather
than a record, the overlay SHALL be computed with the same function the merge commits with, so a
document can never be graded against a state the merge does not write.

Covers: loam.core.capabilities, loam.core.usecases, loam.core.delta

#### Scenario: The analyst and the architect write one change
- **Given** a feature whose capability delta ADDS a cross-service promise and whose own
  `usecases/` flow claims it with `#req-`
- **When** the archive gate grades it
- **Then** the tag resolves and `capability.uncovered` is silent — where the living-only reading
  refused a promise the same archive was about to land

#### Scenario: A flow draws a hop into a service the feature adds
- **Given** a `dynamic view` under `features/<FEAT>/usecases/` naming an element declared only in
  that feature's `delta.likec4`
- **When** the flow is parsed
- **Then** it resolves, because the landscape it is parsed against is the merge preview
  `planLandscapeMerge` produces and not the file on disk

#### Scenario: A flow names something the merge does not land
- **Given** the same flow naming an element neither the living landscape nor the delta declares
- **When** the overlay is loaded
- **Then** `usecase.flow-invalid` refuses the archive before anything is written, and `--approve`
  does not reach it — the flag overrides loam's judgement, never its ability to read an axis

#### Scenario: The overlay and the merge disagree
- **Given** an overlay that approximated the merge instead of calling it
- **When** the splice places an element differently, or refuses where the overlay allowed
- **Then** a document would be graded against a map the archive never writes, which is the failure
  this obligation exists to prevent
