# Module design

What the structure of `src/` actually is, the rules that keep it that way, and the
restructurings that were considered and declined — with the reason, so the question closes.

Every number below was measured against the tree. Where a claim is checkable, the command that
checks it is given.

## Is it two folders of scripts?

No — but the tree does not show you why, and that gap is the real finding.

- `src/cli.ts` is 148 lines of registration and nothing else. It makes 19 `register*` calls, which
  produce **20** commands — `migrate-openspec.ts` declares two (`audit-openspec` and
  `migrate-openspec`), which is why `test/agents.test.ts` compares against
  `buildProgram().commands.length` rather than counting registrations.
- `src/commands/` (21 files: 19 command modules + `format.ts` + `docs-repo-gate.ts`) owns the
  printing and the exit codes.
- `src/core/` (38 modules) imports `commander` zero times, never imports `commands/`, and holds
  four `console` calls in total — three in `core/envelope/json.ts`, which *is* the envelope emitter, and
  one stray in `core/envelope/config.ts:224`.
- Those 38 modules form a value-import DAG **seven levels deep with zero cycles**.

So the layering is true. For a long time nothing in the repository expressed it: `docs/CODE-STYLE.md`
stated it in prose, and no tool reads prose. The cost of "true but unexpressed" is not that a reader
is confused — it is that the next violation lands silently, exactly as `config.ts:224` did, and
the eight import cycles the CHANGELOG records removing can come back the same way.

This section used to end "folders would not close that gap; a lint flag and two greps would." The
flag and the greps are still the sharper tools — but they check that the layering *holds*, and say
nothing about what the layering *is*. Rule 21's packages answer that second question, and
`scripts/package-graph.mjs` is what keeps the answer honest, because a directory tree is a claim
the compiler does not check.

## The layers

> **In flight.** The counts below describe the flat layout as measured before rule 21 landed.
> The layers themselves are not changing — rule 21 makes them visible in `ls` instead of only in
> this table. Where a count here disagrees with the tree, the tree is right and this table is the
> next thing to fix; `scripts/package-graph.mjs` prints the current one.

| Layer | Modules | Job |
|---|---|---|
| Entry | `src/cli.ts` | Register commands; decide the process exit |
| Command | `src/commands/` — 19 modules, 20 commands | Parse flags, refuse, print, set `process.exitCode` |
| Shared command policy | `commands/format.ts`, `commands/docs-repo-gate.ts` | Wording and gating shared by 5 and 6 commands |
| Core | `src/core/` — 37 modules | Compute and return. Never print, never exit |

Inside `core/`, the DAG levels are a real division of labour:

| Level | Modules | For |
|---|---|---|
| L0 | `ids` `path-safety` `records` `document-bytes` `version` `report` `issue` `agents-stamp` `steps` `concurrency` `health` `likec4` | Zero core dependencies — grammar, bytes, vocabulary. Not "cheap": `likec4.ts` is L0 and is the most expensive module in the repo |
| L1 | `config` `spec` `frontmatter` `agent` `arch` | Parse one document kind into a record |
| L2 | `repo` (fan-in 28) `json` (27) | The read model over the docs tree; the output envelope |
| L3 | `openapi` `staging` `provenance` `docs` `brief` `delta` `openspec-inventory` `maturity` | Read and write one artifact family |
| L4 | `fleet-context` `verify` `openapi-merge` | Whole-fleet caching and evidence |
| L5 | `coherence` `gherkin` `dependencies` `doctor` `explore` | Cross-artifact rules producing `Issue[]` / `Finding[]` |
| L6 | `results` `status` | Aggregate answers for a feature or a fleet |

## The target package layout

Rule 21's five-file limit needs a destination for every module, and the destination has to be
decided before the moving starts — a package invented one file at a time ends up as `shared/`.
These are the subjects. Each becomes a directory; each nests further the moment its own files pass
five, which most of them will once the 300-line limit splits the large modules.

| Package | Holds | Depends on |
|---|---|---|
| `core/kernel/` | `ids` `path-safety` `records` `document-bytes` `concurrency` | nothing |
| `core/vocabulary/` | `issue` `report` `health` `steps` `maturity` | nothing |
| `core/envelope/` | `json` `config` | kernel |
| `core/c4/` | `likec4` `arch` `source-mask` `source-scan` | — |
| `core/c4/splice/` | `contract` `landscape-merge` `authored-source` `placement` | c4 |
| `core/document/` | `frontmatter` `spec` | kernel, vocabulary |
| `core/agent/` | `agent` `agents-stamp` `version` | kernel |
| `core/repo/` | `entries` `paths` `state` `repo` `service-target` | document, kernel |
| `core/api/` | `openapi` `asyncapi` `openapi-merge` | repo, kernel |
| `core/fleet/` | `fleet-context` `verify` | api, repo, c4, document, kernel |
| `core/feature/` | `delta` `staging` `provenance` `docs` `brief` | repo, document, envelope, agent, c4, kernel |
| `core/openspec/` | `openspec-inventory` | repo, document, kernel |
| `core/checks/` | `coherence` `dependencies` `gherkin` `explore` `doctor` | everything above |
| `core/answer/` | `status` `results` | checks, and everything above |

The order of the rows is the dependency order, and every edge points up it. That is not a
coincidence — the subjects were derived from the seven DAG levels this document already measured,
which is why a grouping exists at all: a tree whose packages do not follow its levels has no
acyclic grouping to find.

**The obligation caught a real cycle in the first draft of this table.** `fleet-context` looked
like it belonged with `repo` — it is the read model's cache, and `repo` is the read model. But
`openapi` and `asyncapi` both import `repo`, and `fleet-context` imports both, so `repo/` and
`api/` would have pointed at each other while every *file* stayed perfectly acyclic and
`import/no-cycle` stayed silent. `fleet-context` is L4 and `repo` is L2; grouping them was grouping
two levels because they share a noun. It has its own package with `verify`, the other L4 module,
and the graph is acyclic again. This is exactly the failure the old rule 21 predicted, and the
reason `npm run arch:graph` runs before a move rather than after.

Two rules bind while this is in flight:

1. **Never move a module without running `npm run arch:graph` on the result.** The check is a
   second, and the failure it catches is invisible to every other tool in the repo.
2. **A package under the limit is not finished.** `kernel/` holds exactly five files, so the next
   primitive forces the question "which two subjects are in here?" — which is the limit working,
   not the limit obstructing.

## Bounded contexts: there is one

Every attempt to find a second fails on measurement, not on taste.

`Requirement` (`core/document/spec.ts`) is imported unchanged by more than a dozen modules and translated
by none — there is no adapter anywhere. Both spec axes (`core/repo/paths.ts` `SPEC_AXES`) use one
grammar; `core/c4/arch.ts` adds a field parser, not a second requirement model. `FleetContext`
caches services, features, texts, requirements, OpenAPI documents and LikeC4 models in one object.
Under a sympathetic subject partition of `core/`, roughly 70% of internal edges cross a boundary,
and the resulting *group* graph has cycles where the file graph has none.

A shared kernel that is the entire model means one context with several layers. Say that, and
stop looking.

**One foreign model exists, and it is already quarantined.** `core/openspec-inventory.ts` models
another tool's vocabulary. Exactly one file in `src/` imports it — `commands/migrate-openspec.ts`
— and no `OpenSpec*` type appears anywhere else. That is an anti-corruption layer, correctly
placed. Do not disturb it, and do not give it its own requirement parser: it shares
`parseRequirements` with `spec.ts` because the *grammar* genuinely is shared; only the workspace
layout differs, and that part is already isolated.

## Rules

### Boundaries and dependency direction

1. **`core/` does not print.** Sole exception: `core/envelope/json.ts`, whose job is the envelope.
   Checkable: `npx oxlint -D no-console src/core` must report `json.ts` only. Today it also
   reports `config.ts:224`, which fires even under `--json` — so an unreadable `loam.json` is
   reported twice, once outside the envelope.
2. **`core/` does not read `process.argv`, call `process.exit`, or set `process.exitCode`.**
   Only `core/envelope/json.ts` touches `exitCode`.
3. **`core/` never imports `commands/`.** Zero such imports today. Checkable with one grep.
4. **No value-import cycles anywhere in `src/`.** `import type` is exempt — `verbatimModuleSyntax`
   erases it, so a type-only edge is not a runtime edge. Checkable:
   `npx oxlint -D import/no-cycle …` (verified: exits 0 today, and correctly ignores the type-only
   `repo` ↔ `fleet-context` edge).
5. **Commands do not import commands**, except `format.ts` and `docs-repo-gate.ts`. One legacy
   exception: `unarchive.ts` imports `sayRecovery` from `archive.ts`. A second exception means a
   new shared module, not a second exception.
6. **A raw string that reaches a path join passes `assertServiceId` at the command boundary.**
   `new`, `rebase`, `init`, `delta`, `adopt` and `explore` guard — `assertServiceId` for a single
   id, `parseServiceIds` where the flag takes a list. `doctor` reads its id from `loam.json`,
   which `loadConfig` has already parsed into a `ServiceId`. `validate` — the boundary that
   historically forgot — now resolves both of its entry points, `--service` and the positional
   target, through `core/repo/service-target.ts`: the enumeration of `services/` answers first,
   the grammar second, and a name that is neither refuses before any path is built
   (`test/validate-contract.test.ts`).
7. **A shared grammar lives in exactly one module.** `core/kernel/ids.ts` now owns both — the service
   id and the feature id. The feature-id regex used to be spelled twice (`commands/new.ts`,
   `core/openspec-inventory.ts`) and was recorded here as a hazard; the third caller is what
   made it one. `loam explore --as <FEAT>` interpolates its argument into a `loam new` line loam
   *prints for an agent to run*, so a private copy meant `explore` handed back a command `new`
   refuses — and `test/agent-commands-runnable.test.ts` cannot see that class, because it scans
   literal source strings and this line is built from argv. `core/kernel/ids.ts` already documented
   what a second, stricter copy of the *service* grammar cost: the migration rejected ids the
   authoring path accepted.

### Abstractions

8. **Code moves to `core/` when it gets a second caller, or when half of one algorithm is
   already there.** Both clauses are live. The first: the adoption-maturity ladder sat inside
   `commands/list.ts` while `list` was the only caller and moved to `core/vocabulary/maturity.ts` the day
   `explore` needed the same rung — a dial with two readings is not a dial, and `core/kernel/ids.ts`
   already records what the second copy of a shared rule cost last time. The second:
   `core/c4/source-scan.ts` and `core/c4/source-mask.ts` are a source scanner whose only consumer
   in `src/` is the landscape splicer — which lived in `commands/archive.ts` until 2026-08-16 and
   is now `core/c4/splice/` (the verdict table's "worth considering" row, done; the unit tests it
   pays for are still owed). The scanner was extracted so it could be unit-tested, and its two
   modules date from when the 300-line limit reached `likec4.ts` — the seam was already drawn in
   that file as a banner comment, and the parsed view now sits at 284 lines with nothing
   text-level in it.
9. **No interface with one implementation.** `rg 'interface \w*(Manager|Handler|Provider|Factory|Repository)' src/`
   returns zero. Keep it zero.
10. **No `class` unless it is an `Error` subclass or holds per-invocation cache state.** There are
    13 exported classes: 12 typed errors and `FleetContext`.
11. **No barrel or index re-export files.** None exist. They would make rule 4 unenforceable by
    hiding the real edge behind a re-export — and under rule 21 they would also defeat the
    package graph, since every import would point at a directory instead of at the module it
    actually needs. A package is a place files live, never a thing you import.
12. **A `FleetContext` method may memoise; it may never compute.** `fleet-context.ts` carries a
    tombstone comment for the time `serviceOperationIds` broke this: the class's copy interleaved
    removals with upserts, so `archive` (no context) and `validate`/`status` (context) disagreed
    about whether an operation existed — and that disagreement gated an archive.
13. **Extract a shared helper at the third copy, not the second.** `format.ts` exists because five
    renderers had drifted into five copies of one ternary; `docs-repo-gate.ts` because four errno
    readings had drifted and a fix landed in one of them.
14. **No filesystem port, no injected FS, no fake FS.** Tests use real temp dirs. Most of the
    suite's runtime is Langium parsing, not filesystem calls, so a fake FS buys almost nothing —
    and it would destroy what `test/write-path-integrity.test.ts` and
    `test/archive-integrity.test.ts` exist to assert: rename atomicity, errno shapes with no
    `path`, byte-identical trees.

### Types and values

15. **At most four parameters — function, method or constructor.** Not "four of the same type",
    and not a review preference: `test/code-limits.test.ts` counts them across `src/` and `test/`.
    A fifth parameter means the callee is taking a record it has not named yet; name it. The
    codebase already does this where arity hurt (`vouch(req: VouchRequest)`,
    `validateService(check: ServiceCheck)`).

    The count is the ceiling, not the target. Two same-typed parameters in a row is already a
    swap waiting to happen — see rules 16 and 17 for the two forms it has actually taken here.
16. **Two exported functions in one module that take the same parameter types must take them in
    the same order.** Today `pinOpenapiOperations(featureText, livingText, service)` and
    `mergeOpenapiPaths(livingText, featureText, service)` are reversed. Both documents parse, so a
    swap compiles and runs — and `mergeOpenapiPaths` swapped returns the delta as the merged text,
    which `archive` then writes over the service's living `openapi.yaml`.
17. **A function needing `featureDir` and `featureId` takes the `FeatureEntry`.** `core/repo/entries.ts`
    already defines it, and derives the id from the dir — so passing both passes a fact and its
    own derivation, representably inconsistent. Note what this is *not*: when rule 15 sends you
    looking for a record, take the entry that already exists rather than inventing an options
    object that holds the same two fields loosely.
18. **A validated identifier or path carries a branded type; a raw one carries the raw type.**
    `ServiceId`, `FeatureId`, `DocsDir` and the path types are `string & { readonly [brand]: … }`,
    constructible only through the smart constructor that validates. `docs/CODE-STYLE.md` holds
    the shape and the four rules that make a brand worth its annotations.

    This rule used to say the opposite, and the objection it rested on is real and is what the
    two-type split answers: `core/repo/repo.ts`'s `listServices` deliberately returns ids that *failed*
    `serviceIdProblem`, reporting the failure as a field, because `loam list` must show you the
    badly-named directory that exists on disk. Under a single brand meaning "this passed
    validation", that one line would need a knowingly false cast — and a brand with one false cast
    is not enforcing anything at the other call sites. So the raw form is its own type
    (`RawServiceId`), `listServices` returns *that*, and the validating parse is the only bridge
    between them. The badly-named directory is now unable to reach a path join by accident, which
    is the whole point; rule 6 stops being a convention somebody has to remember at six command
    boundaries.

    Cost, so nobody re-opens this without knowing it: roughly 230 annotation sites, paid once.
19. **Expected outcomes are return values; exceptions are for the unexpected.** Already the house
    style. `loadConfig` returning `null` while printing the reason is the one place it half-holds.
20. **Every `child_process` call carries a timeout.** `core/provenance/git.ts` uses `spawn` with a
    10-second cap and a comment saying why. `commands/verify.ts`'s `git()` uses `execFile` with
    neither `timeout` nor `maxBuffer`, on the `loam verify --record` path.

### What not to do

21. **`src/` is a tree of packages, each at most five files.** A directory over five files splits
    along a subject seam; sub-directories are packages in their own right and do not count toward
    their parent's five. `test/code-limits.test.ts` counts this.

    This rule used to say "do not subdivide `src/core/`", and everything it warned about is still
    true — it is now a cost accepted with eyes open, and a set of obligations rather than a veto:

    - **Prove the group graph is acyclic before adopting a grouping.** Directories are not checked
      by the compiler: `../c4/likec4.js` is exactly as legal as `./likec4.js`, so
      `import/no-cycle` sees the *file* graph and will never tell you the *package* graph has a
      cycle. A grouping that puts two mutually-referencing subjects in different packages is a
      design claim the tree cannot hold. Check it with `scripts/package-graph.mjs`, which reports
      the package-level cycles, and make the check part of the move.
    - **`git mv`, in a commit that does nothing else.** The old rule's sharpest objection was
      `git blame` breaking on 35 files whose value is in their comments. Rename detection survives
      a pure move and does not survive a move mixed with edits. Split *or* move in one commit,
      never both.
    - **The import rewrite is mechanical and total** — ~90 core→core, ~127 commands→core and ~117
      test→src statements. Rewrite them with a script and let `npm run typecheck` be the proof,
      not a reading.

    What the tree buys for that: `ls src/core` used to answer "38 modules" and nothing else. The
    seven-level DAG in the table above was true, measured, and invisible.
22. **Do not move to workspaces or `packages/`.** "Package" in rule 21 means a directory, and
    nothing else — no `package.json`, no workspace, no separate publish. That layout tracks how
    many artifacts you publish; you publish one `bin`, and `scripts/release-check.mjs` hard-asserts
    it. It is also the one option here that is not cheaply reversible.
23. **Do not vertical-slice by command.** `core/envelope/json.ts` is imported by 20 of the 21
    modules in `commands/` — every one but `format.ts`; `core/envelope/config.ts` and
    `core/repo/repo.ts` by 17 and 14 of them. Slices would duplicate the hubs or
    produce a `shared/` folder — which is what `src/core/` already is.
24. **Do not add a dependency to express structure.** No `madge`, no `dependency-cruiser`, no
    boundaries plugin. `oxlint` already ships the one rule that matters.
25. **Do not move code because it would be cleaner.** Move it when there is a second caller
    (rule 8), or when the untestable half of an algorithm is stranded in a command.

## Open decisions

Ranked by value over cost. The "not worth it" rows are the useful ones — they close the question.

| Change | Buys | Costs | Verdict |
|---|---|---|---|
| Add `-D import/no-cycle` to the `lint` script | Freezes the zero-cycle property, currently only discipline | One flag; verified exit 0 today | **Do it** — best ratio here |
| `assertServiceId` in `validate`'s service branches | Closes the only path from an unvalidated argv string to a filesystem path | ~10 lines, one file. Deliberate behaviour change: an existing badly-named service directory would now be refused | **Done** — but not as this row planned. `core/repo/service-target.ts` resolves against the enumeration of `services/` first and asks the grammar only for a name no directory matches, so the behaviour change this row predicted deliberately never happened: the badly-named directory keeps grading, because refusing on the grammar would make the one service `validate --all` complains about the one service `validate --service` cannot look at. The third test in `test/validate-contract.test.ts` fails if that order is ever reversed |
| `timeout` + `maxBuffer` on `commands/verify.ts`'s `execFile` | Closes a hang — a blocking credential helper makes `verify --record` wait forever with no output | One line; `git()` already folds spawn failures to `-1`, so no new branch | **Do it** |
| Extract `issueFinding(i: Issue): Finding` into `core/vocabulary/issue.ts` | Removes the third copy of the `gatesArchive` defaulting rule, which `archive.ts` documents in prose while re-implementing twice | ~12 lines, 3 call sites. Two are identical; `validate`'s adds a `text` hint on top. Emitted shape unchanged | **Do it** |
| Options objects for `pinOpenapiOperations` / `mergeOpenapiPaths` | Removes the one swap in the repo that silently corrupts a living document instead of crashing | 2 signatures, 2 production sites, ~30 test sites. Do **not** fix by reordering positionals — that edit is itself compile-clean and wrong | **Do it** |
| `(docsDir, feature: FeatureEntry)` for the four triple-takers | Makes an inconsistent `(dir, id)` pair unrepresentable | 9 src sites (all already hold an entry) + 11 test sites needing a shared fixture helper — budget the helper | **Do it** |
| Options objects for `writeSnapshot` / `readManifest` | Kills the only four-way positional swaps, on the undo path. Both also invert the `(docsDir, featureDir)` order every other function uses, and for a feature created without `--title` the swap is invisible in every fixture | 2 signatures, ~8 call sites | **Do it** |
| Move `archive.ts`'s landscape splicer into `core/` | Un-strands it: the region has zero `console`/`fail`/`emitJson`/`exit` calls and its only escape is a thrown error — `LandscapeSpliceError` since 2026-08-16, exactly so the splicer names no CLI code | ~695 lines relocated, ~12 imports. Payoff only arrives if you then write the unit tests | **Done** 2026-08-16 — `core/c4/splice/` (`contract` `landscape-merge` `authored-source` `placement`); the unit tests it pays for are still owed |
| Audit the six `serviceResolver` calls that omit `known` | Without it the resolver's last rung can resolve a container id to a service that never existed, so group-by-service joins find nothing | 6 sites to decide, plus a comment at each deliberate omission. Not confirmed against a fixture — audit before fixing | **Worth considering** |
| Fix `core/envelope/config.ts:224` | Restores rule 1 to exceptionless | Three options: delete the `console.error` (1–3 lines, check `test/wiring.test.ts`); return the reason instead of `null` (16 callers, real payoff); or record the exception in an `.oxlintrc.json` override (4 lines, two visible exceptions instead of one invisible) | **Your call** — all three are defensible; leaving it undecided is not |
| Split `commands/validate/`'s rule functions into core | Nothing yet | ~1300 lines relocated — now isolated in `validate/checks/` and `validate/service/` rather than interleaved with two callers, so the cost is a move rather than an extraction. `core/status/` already needs these answers and does *not* re-derive them — it calls into core. Everything with two callers is already there | **Not worth it** until `loam status --service` exists |
| A shared `withDocsRepo(…)` command frame | Removes a repeated 9–11 line prelude | ~0.5% of the command layer, and everything the frame must parameterise is the part that differs: four distinct consequence sentences, a conditional gate level, and `validate`'s per-target catch. Tests assert stdout, so the change would be invisible to the suite | **Not worth it.** The defect class that actually bit — four drifting errno readings — is already fixed by `docs-repo-gate.ts` |

### Reopened and decided the other way

Two rows above used to read **Not worth it**. They were reversed on 2026-08-10 by a standards
decision — the four limits in `docs/CODE-STYLE.md` — not by new measurement. The measurement was
right; it is the trade that changed. Both are recorded here rather than deleted, because the cost
each one names is the cost now being paid, and the next reader deserves to know it was foreseen.

| Change | Was | Now |
|---|---|---|
| Subdivide `src/core/` into folders | *Not worth it* — buys "seeing the layer in `ls`" for ~300 rewritten imports, `git blame` broken on 35 comment-heavy files, and a group graph that may have cycles where the file graph has none | **Rule 21.** The rewrite is scripted and `typecheck` proves it; `git mv` in a move-only commit answers `git blame`; the group graph is proved acyclic by `scripts/package-graph.mjs` before the move, which is the obligation the old row was right to demand |
| Brand `ServiceId` / `FeatureId` / `DocsDir` | *Not worth it* — ~230 annotation sites, one required cast would be knowingly false, and `git log -S` across the whole history finds no swap bug that ever shipped | **Rule 18.** The false cast is answered by making the raw form its own type instead of casting it. "No swap bug has shipped" remains true and remains the honest argument against; the counter-argument was that rule 6 rested on six command boundaries each remembering to call `assertServiceId`, and `validate` had already forgotten — the gap `core/repo/service-target.ts` has since closed |

## What enforces what

**oxlint, today, with no new dependency:**

- Rule 4 — `-D import/no-cycle` appended to the `lint` script. Verified: passes, and leaves
  type-only edges alone.
- Rules 1–2 — need an `.oxlintrc.json` (there is none; the lint script is entirely flag-driven).
  An `overrides` entry for `src/core/**` with `no-console`, excluding `json.ts`. That config would
  fail on `config.ts:224` today, which is the point.

**oxlint cannot express a path-boundary rule.** It ships no `import/no-restricted-paths` and no
boundaries plugin; the only boundary-shaped rule bans all `../` imports, which would ban all 127
legitimate `commands → core` edges. So rules 3 and 5 are one-line greps in CI or three lines in a
test.

**A test can hold what lint cannot.** `test/codes-drift.test.ts` is the precedent: it
static-analyses `src/` from inside vitest with a recursive `readdir`, so it is layout-agnostic.

- Rules 15 and 21 — `test/code-limits.test.ts`, live. It walks `src/` and `test/`, counts lines
  per file, parameters per function and files per directory, and compares against
  `test/code-limits-baseline.json`. The baseline lists what was already over a limit when the
  limits landed and may only shrink: an entry the file no longer needs fails the test, so the
  list cannot silently become the permanent state. Being layout-agnostic matters more here than
  anywhere else — this test has to keep working while rule 21 moves every file it reads.
- Rule 6 — `test/validate-contract.test.ts`, live. `loam validate --service ../../etc` exits
  `invalid-option` through `--service` and the positional target alike, and a `treeHashes`
  before/after asserts the refusal wrote nothing.
- Rule 7 — assert the feature-id regex source appears once across `src/`.
- Rule 12 — generalise the `for (const withContext of [false, true])` loop in
  `test/openapi.test.ts` into a parity suite over the ten context-accepting readers. This is the
  only rule whose violation is already documented to have shipped and whose enforcement is
  currently a comment.
- Rule 20 — grep for `execFile(` / `spawn(` without a `timeout`.

**tsc holds rules 16–18 for free** once applied: an options object, a `FeatureEntry` parameter or
a branded id makes every stale call site a compile error. Rule 18's brands are the strongest form
of this — a `string` no longer fits where a `ServiceId` is wanted — and the reason the count of
annotation sites is a one-time cost rather than an ongoing one.

**A script holds the one thing neither can see.** `scripts/package-graph.mjs` builds the
package-level import graph and reports its cycles. `import/no-cycle` reads the file graph and is
blind to a cycle that exists only between directories, so rule 21's acyclicity obligation is this
script or it is nothing.

**Review convention only, and that is fine:** rules 8, 9, 13, and 22–25. They are decisions, not
properties. Writing them down is what makes the next "should we restructure?" a five-minute
conversation instead of a five-day one.
