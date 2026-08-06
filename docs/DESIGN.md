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
- `src/core/` (37 modules) imports `commander` zero times, never imports `commands/`, and holds
  four `console` calls in total — three in `core/json.ts`, which *is* the envelope emitter, and
  one stray in `core/config.ts:224`.
- Those 37 modules form a value-import DAG **seven levels deep with zero cycles**.

So the layering is true. Nothing in the repository expresses or enforces it. `docs/CODE-STYLE.md`
states it in prose; no tool reads prose. The cost of "true but unexpressed" is not that a reader
is confused — it is that the next violation lands silently, exactly as `config.ts:224` did, and
the eight import cycles the CHANGELOG records removing can come back the same way.

Folders would not close that gap. A lint flag and two greps would.

## The layers

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
| L2 | `repo` (fan-in 29) `json` (22) | The read model over the docs tree; the output envelope |
| L3 | `openapi` `staging` `provenance` `docs` `brief` `delta` `openspec-inventory` `maturity` | Read and write one artifact family |
| L4 | `fleet-context` `verify` `openapi-merge` | Whole-fleet caching and evidence |
| L5 | `coherence` `gherkin` `dependencies` `doctor` `explore` | Cross-artifact rules producing `Issue[]` / `Finding[]` |
| L6 | `results` `status` | Aggregate answers for a feature or a fleet |

## Bounded contexts: there is one

Every attempt to find a second fails on measurement, not on taste.

`Requirement` (`core/spec.ts`) is imported unchanged by more than a dozen modules and translated
by none — there is no adapter anywhere. Both spec axes (`core/repo.ts` `SPEC_AXES`) use one
grammar; `core/arch.ts` adds a field parser, not a second requirement model. `FleetContext`
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

1. **`core/` does not print.** Sole exception: `core/json.ts`, whose job is the envelope.
   Checkable: `npx oxlint -D no-console src/core` must report `json.ts` only. Today it also
   reports `config.ts:224`, which fires even under `--json` — so an unreadable `loam.json` is
   reported twice, once outside the envelope.
2. **`core/` does not read `process.argv`, call `process.exit`, or set `process.exitCode`.**
   Only `core/json.ts` touches `exitCode`.
3. **`core/` never imports `commands/`.** Zero such imports today. Checkable with one grep.
4. **No value-import cycles anywhere in `src/`.** `import type` is exempt — `verbatimModuleSyntax`
   erases it, so a type-only edge is not a runtime edge. Checkable:
   `npx oxlint -D import/no-cycle …` (verified: exits 0 today, and correctly ignores the type-only
   `repo` ↔ `fleet-context` edge).
5. **Commands do not import commands**, except `format.ts` and `docs-repo-gate.ts`. One legacy
   exception: `unarchive.ts` imports `sayRecovery` from `archive.ts`. A second exception means a
   new shared module, not a second exception.
6. **A raw string that reaches a path join passes `assertServiceId` at the command boundary.**
   `new`, `rebase`, `init`, `delta`, `adopt` and `doctor` all guard. `validate` does not — its
   `--service` argument reaches `servicePaths()` unvalidated.
7. **A shared grammar lives in exactly one module.** `core/ids.ts` now owns both — the service
   id and the feature id. The feature-id regex used to be spelled twice (`commands/new.ts`,
   `core/openspec-inventory.ts`) and was recorded here as a hazard; the third caller is what
   made it one. `loam explore --as <FEAT>` interpolates its argument into a `loam new` line loam
   *prints for an agent to run*, so a private copy meant `explore` handed back a command `new`
   refuses — and `test/agent-commands-runnable.test.ts` cannot see that class, because it scans
   literal source strings and this line is built from argv. `core/ids.ts` already documented
   what a second, stricter copy of the *service* grammar cost: the migration rejected ids the
   authoring path accepted.

### Abstractions

8. **Code moves to `core/` when it gets a second caller, or when half of one algorithm is
   already there.** Both clauses are live. The first: the adoption-maturity ladder sat inside
   `commands/list.ts` while `list` was the only caller and moved to `core/maturity.ts` the day
   `explore` needed the same rung — a dial with two readings is not a dial, and `core/ids.ts`
   already records what the second copy of a shared rule cost last time. The second:
   `core/likec4.ts` exports a source scanner whose only consumer in `src/` is
   `commands/archive.ts`. The scanner was extracted so it could be unit-tested; the splicer that
   uses it was not, and therefore cannot be.
9. **No interface with one implementation.** `rg 'interface \w*(Manager|Handler|Provider|Factory|Repository)' src/`
   returns zero. Keep it zero.
10. **No `class` unless it is an `Error` subclass or holds per-invocation cache state.** There are
    13 exported classes: 12 typed errors and `FleetContext`.
11. **No barrel or index re-export files.** None exist. They would make rule 4 unenforceable by
    hiding the real edge behind a re-export.
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

15. **Four or more same-typed parameters → options object.** The codebase already does this where
    arity hurt (`vouch(req: VouchRequest)`, `validateService(check: ServiceCheck)`). Seventeen
    functions currently have a run of three; they are grandfathered. This rule binds new code and
    the two four-string runs named in the table below.
16. **Two exported functions in one module that take the same parameter types must take them in
    the same order.** Today `pinOpenapiOperations(featureText, livingText, service)` and
    `mergeOpenapiPaths(livingText, featureText, service)` are reversed. Both documents parse, so a
    swap compiles and runs — and `mergeOpenapiPaths` swapped returns the delta as the merged text,
    which `archive` then writes over the service's living `openapi.yaml`.
17. **A function needing `featureDir` and `featureId` takes the `FeatureEntry`.** `core/repo.ts`
    already defines it, and derives the id from the dir — so passing both passes a fact and its
    own derivation, representably inconsistent. This is the exception to rule 15: take the entry,
    not an options object.
18. **No branded or nominal string types for `service`, `featureId`, `docsDir` or paths.**
    `core/repo.ts`'s `listServices` deliberately returns ids that *failed* `serviceIdProblem`,
    reporting the failure as a field, because `loam list` must show you the badly-named directory
    that exists. A brand meaning "this passed validation" would need a knowingly false cast at
    exactly that point. Rules 15–17 buy the same protection for a fraction of the edits.
19. **Expected outcomes are return values; exceptions are for the unexpected.** Already the house
    style. `loadConfig` returning `null` while printing the reason is the one place it half-holds.
20. **Every `child_process` call carries a timeout.** `core/provenance.ts` uses `spawn` with a
    10-second cap and a comment saying why. `commands/verify.ts`'s `git()` uses `execFile` with
    neither `timeout` nor `maxBuffer`, on the `loam verify --record` path.

### What not to do

21. **Do not subdivide `src/core/` into subject folders.** ~90 core→core, 127 commands→core and
    ~100 test→src import statements would be rewritten, `git blame` breaks on 35 files whose value
    is in their comments, and it replaces a zero-cycle file graph with a group graph that has
    cycles. Directories are not checked by the compiler: `../c4/likec4.js` is exactly as legal as
    `./likec4.js`. Before adopting any grouping, show that the group graph is acyclic —
    `import/no-cycle` will not see it for you.
22. **Do not move to workspaces or `packages/`.** That layout tracks how many artifacts you
    publish; you publish one `bin`, and `scripts/release-check.mjs` hard-asserts it. It is also
    the one option here that is not cheaply reversible.
23. **Do not vertical-slice by command.** `core/json.ts` is imported by every command module but
    one; `core/config.ts` and `core/repo.ts` by 16 each. Slices would duplicate the hubs or
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
| `assertServiceId` in `validate`'s service branches | Closes the only path from an unvalidated argv string to a filesystem path | ~10 lines, one file. Deliberate behaviour change: an existing badly-named service directory would now be refused | **Do it** |
| `timeout` + `maxBuffer` on `commands/verify.ts`'s `execFile` | Closes a hang — a blocking credential helper makes `verify --record` wait forever with no output | One line; `git()` already folds spawn failures to `-1`, so no new branch | **Do it** |
| Extract `issueFinding(i: Issue): Finding` into `core/issue.ts` | Removes the third copy of the `gatesArchive` defaulting rule, which `archive.ts` documents in prose while re-implementing twice | ~12 lines, 3 call sites. Two are identical; `validate`'s adds a `text` hint on top. Emitted shape unchanged | **Do it** |
| Options objects for `pinOpenapiOperations` / `mergeOpenapiPaths` | Removes the one swap in the repo that silently corrupts a living document instead of crashing | 2 signatures, 2 production sites, ~30 test sites. Do **not** fix by reordering positionals — that edit is itself compile-clean and wrong | **Do it** |
| `(docsDir, feature: FeatureEntry)` for the four triple-takers | Makes an inconsistent `(dir, id)` pair unrepresentable | 9 src sites (all already hold an entry) + 11 test sites needing a shared fixture helper — budget the helper | **Do it** |
| Options objects for `writeSnapshot` / `readManifest` | Kills the only four-way positional swaps, on the undo path. Both also invert the `(docsDir, featureDir)` order every other function uses, and for a feature created without `--title` the swap is invisible in every fixture | 2 signatures, ~8 call sites | **Do it** |
| Move `archive.ts`'s landscape splicer into `core/` | Un-strands it: the region has zero `console`/`fail`/`emitJson`/`exit` calls and its only escape is a thrown `ArchiveFailure`. Today every placement invariant costs a temp repo and a CLI run | ~695 lines relocated, ~12 imports. Payoff only arrives if you then write the unit tests | **Worth considering** — do it when you want those tests |
| Audit the six `serviceResolver` calls that omit `known` | Without it the resolver's last rung can resolve a container id to a service that never existed, so group-by-service joins find nothing | 6 sites to decide, plus a comment at each deliberate omission. Not confirmed against a fixture — audit before fixing | **Worth considering** |
| Fix `core/config.ts:224` | Restores rule 1 to exceptionless | Three options: delete the `console.error` (1–3 lines, check `test/wiring.test.ts`); return the reason instead of `null` (16 callers, real payoff); or record the exception in an `.oxlintrc.json` override (4 lines, two visible exceptions instead of one invisible) | **Your call** — all three are defensible; leaving it undecided is not |
| Split `commands/validate.ts`'s rule functions into core | Nothing yet | ~1300 lines relocated. `core/status.ts` already needs these answers and does *not* re-derive them — it calls into core. Everything with two callers is already there | **Not worth it** until `loam status --service` exists |
| Subdivide `src/core/` into folders | Seeing the layer in `ls` | See rule 21 | **Not worth it** |
| Brand `ServiceId` / `FeatureId` / `DocsDir` | Compile-time swap protection | ~230 annotation sites, and at least one required cast would be knowingly false (rule 18). No swap bug has ever shipped here — `git log -S` across the whole history finds none | **Not worth it.** Rules 15–17 buy the same protection for ~60 edits |
| A shared `withDocsRepo(…)` command frame | Removes a repeated 9–11 line prelude | ~0.5% of the command layer, and everything the frame must parameterise is the part that differs: four distinct consequence sentences, a conditional gate level, and `validate`'s per-target catch. Tests assert stdout, so the change would be invisible to the suite | **Not worth it.** The defect class that actually bit — four drifting errno readings — is already fixed by `docs-repo-gate.ts` |

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

- Rule 6 — assert `loam validate --service ../../etc` exits `invalid-option`.
- Rule 7 — assert the feature-id regex source appears once across `src/`.
- Rule 12 — generalise the `for (const withContext of [false, true])` loop in
  `test/openapi.test.ts` into a parity suite over the ten context-accepting readers. This is the
  only rule whose violation is already documented to have shipped and whose enforcement is
  currently a comment.
- Rule 20 — grep for `execFile(` / `spawn(` without a `timeout`.

**tsc holds rules 15–17 for free** once applied: an options object or a `FeatureEntry` parameter
makes every stale call site a compile error. That is why they are worth more than a brand — the
same compile-time enforcement, without asserting an invariant the code deliberately violates.

**Review convention only, and that is fine:** rules 8, 9, 13, and 21–25. They are decisions, not
properties. Writing them down is what makes the next "should we restructure?" a five-minute
conversation instead of a five-day one.
