# Module design

What the structure of `src/` actually is, the rules that keep it that way, and the restructurings
that were considered and declined — with the reason, so the question closes.

Every number below was measured against the tree. Where a claim is checkable, the command that
checks it is given.

## Is it two folders of scripts?

No — but the tree does not show you why, and that gap is the real finding.

- `src/cli.ts` is registration and nothing else. It makes 27 `register*` calls, which produce **28**
  commands — `migrate-openspec/migrate-openspec.ts` declares two (`audit-openspec` and
  `migrate-openspec`), which is why `test/agents.test.ts` compares against
  `buildProgram().commands.length` rather than counting registrations. (Both numbers are pinned live
  by `test/docs-facts.test.ts`, so this sentence moves when the CLI does.)
- `src/commands/` owns the printing and the exit codes. Twenty-two of the twenty-seven command
  modules are packages; five sit loose as files (`dependencies`, `doctor`, `explore`,
  `instructions`, `open`), and `commands/policy/` holds the two things in that directory which are
  not commands.
- `src/core/` imports `commander` zero times, never imports `commands/`, and holds three `console`
  calls in total — all in `core/envelope/json.ts`, which *is* the envelope emitter.
- `src/`'s value-import graph has **zero cycles** at both the file level and the package level (`npm
  run arch:check` proves it, with the rest of this page's boundary rules). The module and package
  counts move too often to be worth a literal here: `npm run arch:graph` prints the current ones.

So the layering is true, and since `scripts/arch-check.mjs` it is EXPRESSED: one command runs the
file-cycle check, the package graph, the core→commands ban, the barrel ban, the console/process
boundary, the child-process bounds and the brand-cast scan, each with a negative self-test in
`test/arch-gate.test.ts`. The cost of "true but unexpressed" was never confusion — it was that the
next violation landed silently, exactly as `config.ts`'s stray console once did, and the eight
import cycles the CHANGELOG records removing could have come back the same way.

This section used to end "folders would not close that gap; a lint flag and two greps would." The
flag and the greps are still the sharper tools — but they check that the layering *holds*, and say
nothing about what the layering *is*. Rule 21's packages answer that second question, and
`scripts/package-graph.mjs` is what keeps the answer honest, because a directory tree is a claim the
compiler does not check.

## The layers

| Layer | Modules | Job |
|---|---|---|
| Entry | `src/cli.ts` | Register commands; decide the process exit |
| Command | `src/commands/` — 27 command modules, 28 commands | Parse flags, refuse, print, set `process.exitCode` |
| Shared command policy | `commands/policy/` — `format.ts`, `gate.ts` | Wording and gating shared by 10 and 14 commands |
| Core | `src/core/` | Compute and return. Never print, never exit |

Inside `core/`, the DAG levels are a real division of labour:

| Level | Modules | For |
|---|---|---|
| L0 | `ids/` `path-safety` `records` `document-bytes` `version` `report` `issue` `agents-stamp` `steps` `concurrency` `health` `likec4` | Zero core dependencies — grammar, bytes, vocabulary. Not "cheap": `likec4.ts` is L0 and is the most expensive module in the repo |
| L1 | `config` `spec` `frontmatter` `agent` `arch` | Parse one document kind into a record |
| L2 | `repo` (fan-in 28) `json` (27) | The read model over the docs tree; the output envelope |
| L3 | `openapi/` `asyncapi/` `permissions/` `staging/` `provenance/` `docs` `brief/` `delta/` `openspec/` `maturity` | Read and write one artifact family |
| L4 | `fleet-context` `verify/` `openapi/merge/` | Whole-fleet caching and evidence |
| L5 | `coherence/` `gherkin/` `dependencies/` `doctor/` `explore/` `diff/` | Cross-artifact rules producing `Issue[]` / `Finding[]` |
| L6 | `results` `status/` | Aggregate answers for a feature or a fleet |

## The package layout

Rule 21's five-file limit needed a destination for every module, and the file-length limit decided
how far each one nests — 300 lines while this tree was taking shape, 400 since 2026-08-27
(docs/CODE-STYLE.md records what the measurement was and why the number moved). Both are now clear —
`test/code-limits-baseline.json` is empty — so this table describes the tree rather than a plan for
it.

| Package | Holds | Depends on |
|---|---|---|
| `core/kernel/` | `ids/` (service feature dirs) `path-safety` `records` `document-bytes` `concurrency` | nothing |
| `core/vocabulary/` | `issue` `report` `health` `steps` `maturity` | nothing |
| `core/envelope/` | `json` `config` `version` | kernel |
| `core/mcp/` | the MCP facade's pure half: stdio `framing`, JSON-RPC routing (`protocol`), the read-only `tools` table and its `argv` boundary | envelope, kernel |
| `core/c4/` | `likec4` `arch` `source-mask` `source-scan` | — |
| `core/c4/splice/` | `contract` `landscape-merge` `authored-source` `placement` | c4 |
| `core/c4/seed/` | `loam seed`'s file grammar and templater: `fleet-file` (`items` reads one node) `template` `stamp` | c4, kernel |
| `core/document/` | `frontmatter` `spec` `parse` `apply` `scenarios` | kernel, vocabulary |
| `core/agent/` | the generated AGENTS.md, the slash commands, the tool registry | kernel |
| `core/repo/` | `entries` `paths` `state` `repo` `service-target` | document, kernel |
| `core/workspace/` | `loam open`'s editor workspace: sibling-repo `discover`y through committed bindings, deterministic `.code-workspace` `render`ing | envelope, repo, kernel |
| `core/openapi/` `core/asyncapi/` | the two contract axes; `openapi/merge/` is the delta path | repo, kernel |
| `core/permissions/` | the fleet authorization vocabulary joined by `Requires:` | kernel |
| `core/capabilities/` | the declared-capability vocabulary and the fleet rollup joined by `Capability:` | repo, document, kernel |
| `core/projection/` | one feature projected onto one service — the API, event and C4 slices `loam delta` and `loam context` share | openapi, asyncapi, c4, repo |
| `core/staging/` | the write path; `staging/recovery/` is the crash half | envelope, kernel |
| `core/verify/` | the done-check: questions, answers, the record | openapi, repo, c4, document |
| `core/delta/` `core/coherence/` | does the diff apply, and do the three axes agree | verify, repo, document |
| `core/openspec/` | the OpenSpec model (`model/`), the scan, and the decisions over it | repo, document, kernel |
| `core/gherkin/` `core/dependencies/` `core/explore/` `core/doctor/` | cross-artifact rules | everything above |
| `core/diff/` | the base-ref read of the docs repo (git show/ls-tree) and the semantic branch diff `loam diff` reports | provenance, fleet-context, openapi, asyncapi, c4, repo, document, envelope, vocabulary, kernel |
| `core/pack/` | the context pack — one service's whole docs slice as one deterministic briefing | everything above |
| `core/status/` | aggregate answers for a feature (`feature/`) or a fleet (`fleet/`) | everything above |
| `core/gate/` | the deploy-time query — `loam gate`'s partner scan and its four checks over recorded evidence | everything above |

Four modules stay loose in `core/`: `conflict-markers.ts`, `docs.ts`, `fleet-context.ts` and
`results.ts`. That is not an oversight — a package of one is a directory pretending to be a subject,
and the five-file limit counts files, not folders.

The order of the rows is the dependency order, and every edge points up it. That is not a
coincidence — the subjects were derived from the seven DAG levels this document already measured,
which is why a grouping exists at all: a tree whose packages do not follow its levels has no acyclic
grouping to find.

**The obligation caught a real cycle in the first draft of this table.** `fleet-context` looked like
it belonged with `repo` — it is the read model's cache, and `repo` is the read model. But `openapi`
and `asyncapi` both import `repo`, and `fleet-context` imports both, so `repo/` and `api/` would
have pointed at each other while every *file* stayed perfectly acyclic and `import/no-cycle` stayed
silent. `fleet-context` is L4 and `repo` is L2; grouping them was grouping two levels because they
share a noun. It has its own package with `verify`, the other L4 module, and the graph is acyclic
again. This is exactly the failure the old rule 21 predicted, and the reason `npm run arch:graph`
runs before a move rather than after.

**And it caught three more while the tree was being built.** `core/verify/` reached the contract
reader while `core/gherkin.ts` reached verify, so verify pointed back at the package pointing at it
— fixed by giving `openapi` its own package. `core/openspec/scan/` reached the model types at the
package root while `inventory.ts` reached the scan — fixed by sinking the model into
`openspec/model/`. `core/staging/recovery/` would have done the same had its modules been left at
the top. None of the three is visible to `import/no-cycle`, because every FILE stayed acyclic.

Two rules bind:

1. **Never move a module without running `npm run arch:graph` on the result.** The check is a
   second, and the failure it catches is invisible to every other tool in the repo.
2. **A package under the limit is not finished.** `kernel/` holds exactly five files, so the next
   primitive forces the question "which two subjects are in here?" — which is the limit working, not
   the limit obstructing.

## Bounded contexts: there is one

Every attempt to find a second fails on measurement, not on taste.

`Requirement` (`core/document/spec.ts`) is imported unchanged by more than a dozen modules and
translated by none — there is no adapter anywhere. Both spec axes (`core/repo/paths.ts` `SPEC_AXES`)
use one grammar; `core/c4/arch.ts` adds a field parser, not a second requirement model.
`FleetContext` caches services, features, texts, requirements, OpenAPI documents and LikeC4 models
in one object. Under a sympathetic subject partition of `core/`, roughly 70% of internal edges cross
a boundary, and the resulting *group* graph has cycles where the file graph has none.

A shared kernel that is the entire model means one context with several layers. Say that, and stop
looking.

**One foreign model exists, and it is already quarantined.** `core/openspec/` models another tool's
vocabulary. Exactly one *package* in `src/` imports it — `commands/migrate-openspec/`, whose twelve
modules are the only place outside it where an `OpenSpec*` type is named. That is an anti-corruption
layer, correctly placed; the quarantine is the directory, not the file count, and splitting the
command did not widen it. Do not disturb it, and do not give it its own requirement parser: it
shares `parseRequirements` with `document/parse.ts` because the *grammar* genuinely is shared; only
the workspace layout differs, and that part is already isolated.

## Rules

### Boundaries and dependency direction

1. **`core/` does not print.** Sole exception: `core/envelope/json.ts`, whose job is the envelope.
   Enforced by `arch:check`'s core-boundary scan (negative self-test included); the one historical
   exception, `loadConfig`'s stray `console.error`, became a typed `ConfigLoad` outcome the command
   layer renders.
2. **`core/` does not read `process.argv`, call `process.exit`, or set `process.exitCode`.** Only
   `core/envelope/json.ts` touches `exitCode`.
3. **`core/` never imports `commands/`.** Zero such imports, type-only included — `arch:check`'s
   layering scan bans named and type-only forms alike, because a type edge is still a reader-visible
   dependency pointing the wrong way. (A bare side-effect or dynamic `import()` is outside the regex
   — honest-but-approximate, like the rest of the textual checks.)
4. **No value-import cycles anywhere in `src/`.** `import type` is exempt — `verbatimModuleSyntax`
   erases it, so a type-only edge is not a runtime edge. Enforced: `arch:check` runs
   `oxlint -D import/no-cycle` over `src/` (it correctly ignores the type-only `repo` ↔
   `fleet-context` edge) and the package graph beside it.
5. **Commands do not import commands**, except `format.ts` and `docs-repo-gate.ts`. One legacy
   exception: `unarchive.ts` imports `sayRecovery` from `archive.ts`. A second exception means a new
   shared module, not a second exception. One structural exception, which is not the shared-code
   shape this rule exists to stop: `commands/mcp/dispatch.ts` imports the `register*` functions of
   the ten read commands it re-enters — the same functions `src/cli.ts` imports, for the same
   purpose (building a program), not a helper reached around the layer. The acyclic alternative does
   not exist: importing `cli.ts` from a command module would be a file cycle, and a second copy of
   the registrations would agree with itself and with nothing else — the exact drift
   `buildProgram()`'s doc comment records.
6. **A raw string that reaches a path join passes `assertServiceId` at the command boundary.**
   `new`, `rebase`, `init`, `delta`, `adopt` and `explore` guard — `assertServiceId` for a single
   id, `parseServiceIds` where the flag takes a list. `doctor` reads its id from `loam.json`, which
   `loadConfig` has already parsed into a `ServiceId`. `validate` — the boundary that historically
   forgot — now resolves both of its entry points, `--service` and the positional target, through
   `core/repo/service-target.ts`: the enumeration of `services/` answers first, the grammar second,
   and a name that is neither refuses before any path is built (`test/validate-contract.test.ts`).
7. **A shared grammar lives in exactly one module.** The `core/kernel/ids/` package now owns both —
   the service id (`service.ts`) and the feature id (`feature.ts`), with the directory brands beside
   them (`dirs.ts`). The feature-id regex used to be spelled twice (`commands/new.ts`,
   `core/openspec/`) and was recorded here as a hazard; the third caller is what made it one.
   `loam explore --as <FEAT>` interpolates its argument into a `loam new` line loam *prints for an
   agent to run*, so a private copy meant `explore` handed back a command `new` refuses — and
   `test/agent-commands-runnable.test.ts` cannot see that class, because it scans literal source
   strings and this line is built from argv. The service grammar already documented what a second,
   stricter copy of it cost: the migration rejected ids the authoring path accepted.

### Abstractions

8. **Code moves to `core/` when it gets a second caller, or when half of one algorithm is already
   there.** Both clauses are live. The first: the adoption-maturity ladder sat inside
   `commands/list.ts` while `list` was the only caller and moved to `core/vocabulary/maturity.ts`
   the day `explore` needed the same rung — a dial with two readings is not a dial, and the id
   grammar already records what the second copy of a shared rule cost last time. The second:
   `core/c4/source-scan.ts` and `core/c4/source-mask.ts` are a source scanner whose only consumer in
   `src/` is the landscape splicer — which lived in `commands/archive.ts` until 2026-08-16 and is
   now `core/c4/splice/` (the verdict table's "worth considering" row, done; the unit tests it pays
   for are still owed). The scanner was extracted so it could be unit-tested, and its two modules
   date from when the 300-line limit reached `likec4.ts` — the seam was already drawn in that file
   as a banner comment, and the parsed view now sits at 284 lines with nothing text-level in it. The
   first clause fired again on 2026-08-26: the delta projection helpers
   (`apiChanges`/`eventChanges`/`archSlice`) moved from `commands/delta/slices.ts` to
   `core/projection/` the day `loam context` became their second caller — rule 5 bans the
   command→command import that would otherwise have been the shortcut.
9. **No interface with one implementation.**
   `rg 'interface \w*(Manager|Handler|Provider|Factory|Repository)' src/` returns zero. Keep it
   zero.
10. **No `class` unless it is an `Error` subclass or holds per-invocation cache state.** There are
    18 exported classes: 17 typed errors and `FleetContext`.
11. **No barrel or index re-export files.** None exist. They would make rule 4 unenforceable by
    hiding the real edge behind a re-export — and under rule 21 they would also defeat the package
    graph, since every import would point at a directory instead of at the module it actually needs.
    A package is a place files live, never a thing you import.
12. **A `FleetContext` method may memoise; it may never compute.** `fleet-context.ts` carries a
    tombstone comment for the time `serviceOperationIds` broke this: the class's copy interleaved
    removals with upserts, so `archive` (no context) and `validate`/`status` (context) disagreed
    about whether an operation existed — and that disagreement gated an archive.
13. **Extract a shared helper at the third copy, not the second.** `format.ts` exists because five
    renderers had drifted into five copies of one ternary; `docs-repo-gate.ts` because four errno
    readings had drifted and a fix landed in one of them.
14. **No filesystem port, no injected FS, no fake FS.** Tests use real temp dirs. Most of the
    suite's runtime is Langium parsing, not filesystem calls, so a fake FS buys almost nothing — and
    it would destroy what `test/write-path-integrity.test.ts` and `test/archive-integrity.test.ts`
    exist to assert: rename atomicity, errno shapes with no `path`, byte-identical trees.

### Types and values

15. **At most four parameters — function, method or constructor.** Not "four of the same type", and
    not a review preference: `test/code-limits.test.ts` counts them across `src/` and `test/`. A
    fifth parameter means the callee is taking a record it has not named yet; name it. The codebase
    already does this where arity hurt (`vouch(req: VouchRequest)`,
    `validateService(check: ServiceCheck)`).

    The count is the ceiling, not the target. Two same-typed parameters in a row is already a swap
    waiting to happen — see rules 16 and 17 for the two forms it has actually taken here.
16. **Two exported functions in one module that take the same parameter types must take them in the
    same order.** Today `pinOpenapiOperations(featureText, livingText, service)` and
    `mergeOpenapiPaths(livingText, featureText, service)` are reversed. Both documents parse, so a
    swap compiles and runs — and `mergeOpenapiPaths` swapped returns the delta as the merged text,
    which `archive` then writes over the service's living `openapi.yaml`.
17. **A function needing `featureDir` and `featureId` takes the `FeatureEntry`.**
    `core/repo/entries.ts` already defines it, and derives the id from the dir — so passing both
    passes a fact and its own derivation, representably inconsistent. Note what this is *not*: when
    rule 15 sends you looking for a record, take the entry that already exists rather than inventing
    an options object that holds the same two fields loosely.
18. **A validated identifier or path carries a branded type; a raw one carries the raw type.**
    Landed, not aspirational: `ServiceId` and its raw/declared variants, `FeatureId`/`RawFeatureId`
    (`FeatureEntry.id` carries the raw form — the enumeration still lists illegal names),
    `DocsDir`/`FeatureDir` through every builder in `core/repo/paths.ts`, and a thin `PortablePath`
    consumed inside `path-safety.ts`. The smart constructors in `core/kernel/ids/` and
    `path-safety.ts` are the only bridges, and `arch:check` fails a cast to any brand outside them.
    Still deliberately unbranded: the stored loam.json spelling (`StoredConfig.docsDir` — the
    relative form is not the resolved root), the staging-manifest paths (owned by the writer
    formats), and every `docsDir` parameter that never reaches a paths.ts builder.

    Cost, so nobody re-opens this without knowing it: roughly 230 annotation sites, paid once.

19. **Expected outcomes are return values; exceptions are for the unexpected.** The house style, now
    without its one exception: `loadConfig` returns a typed `ConfigLoad` union and prints nothing.
20. **Every `child_process` call in `src/` carries a timeout, and every buffering call an explicit
    `maxBuffer`.** Enforced by `arch:check`'s child-process scan. `core/provenance/git.ts` caps its
    streamed reads at a named output ceiling too — past it the child is killed and the doctrine
    answers "git will not say", never a truncated denominator. Scope is `src/` — the product;
    `scripts/` is dev tooling, held by review (the corpus gate's git call is bounded all the same).

### What not to do

21. **`src/` is a tree of packages, each at most five files.** A directory over five files splits
    along a subject seam; sub-directories are packages in their own right and do not count toward
    their parent's five. `test/code-limits.test.ts` counts this.

    This rule used to say "do not subdivide `src/core/`", and everything it warned about is still
    true — it is now a cost accepted with eyes open, and a set of obligations rather than a veto:

    - **Prove the group graph is acyclic before adopting a grouping.** Directories are not checked
      by the compiler: `../c4/likec4.js` is exactly as legal as `./likec4.js`, so `import/no-cycle`
      sees the *file* graph and will never tell you the *package* graph has a cycle. A grouping that
      puts two mutually-referencing subjects in different packages is a design claim the tree cannot
      hold. Check it with `scripts/package-graph.mjs`, which reports the package-level cycles, and
      make the check part of the move.
    - **`git mv`, in a commit that does nothing else.** The old rule's sharpest objection was
      `git blame` breaking on 35 files whose value is in their comments. Rename detection survives a
      pure move and does not survive a move mixed with edits. Split *or* move in one commit, never
      both.
    - **The import rewrite is mechanical and total** — ~90 core→core, ~127 commands→core and ~117
      test→src statements. Rewrite them with a script and let `npm run typecheck` be the proof, not
      a reading.

    What the tree buys for that: `ls src/core` used to answer "38 modules" and nothing else. The
    seven-level DAG in the table above was true, measured, and invisible.
22. **Do not move to workspaces or `packages/`.** "Package" in rule 21 means a directory, and
    nothing else — no `package.json`, no workspace, no separate publish. That layout tracks how many
    artifacts you publish; you publish one `bin`, and `scripts/release-check.mjs` hard-asserts it.
    It is also the one option here that is not cheaply reversible.
23. **Do not vertical-slice by command.** `core/envelope/json.ts` is imported by 58 of the 137
    modules in `commands/` — the entry module of every command among them; `core/envelope/config.ts`
    and `core/repo/repo.ts` by 23 and 26 of them. Slices would duplicate the hubs or produce a
    `shared/` folder — which is what `src/core/` already is.
24. **Do not add a dependency to express structure.** No `madge`, no `dependency-cruiser`, no
    boundaries plugin. `oxlint` already ships the one rule that matters.
25. **Do not move code because it would be cleaner.** Move it when there is a second caller (rule
    8), or when the untestable half of an algorithm is stranded in a command.


### What loam reads from LikeC4

26. **loam reads what a view DECLARES; it never computes what a view SHOWS.** The line is LikeC4's
    own stage boundary. The **parsed** stage — `(await parsedModel()).$data.views` — is a record of
    what an author wrote, and loam may read exactly this and nothing more: for an entry whose
    `_type` is `"dynamic"`, its `id`, `tags`, `title`, `description`, and its `steps[]` restricted
    to `source`, `target`, `title`, `notes`, `isBackward` and `astPath`. The **computed** and
    **layouted** stages resolve a view's predicates against the model, derive the
    ancestor-to-ancestor edges a diagram needs, and place boxes. loam calls neither, ever. Note the
    `await`: `$data` is `undefined` on the unresolved promise, and every draft of this rule got that
    wrong before it was measured.

    `isBackward` is in that list on purpose and is not noise. Measured: `a <- b 'reply'` records
    `{source:"b", target:"a", isBackward:true}`, while `b -> a 'reply'` records the same pair
    unflagged. A reply arrow is the commonest step in any sequence diagram, so a reader that drops
    the flag mis-orients every return hop — and a check built on it would convict them all.

    Three consequences, each of which is the reason for the line rather than a detail of it:
    - *Rendering instructions are not facts about the system.* A static view's `rules[]`,
      `include`/`exclude` predicates, `autoLayout` and `style` say how a picture should look. A
      check that reads them makes a verdict depend on a diagram's cosmetics, and puts loam one step
      from evaluating a predicate — which is computing.
    - *`$data.views` is not what the author wrote.* LikeC4 synthesises an `index` view into it
      whether or not the document declares one — measured, present for a document with **no**
      `views` block at all. Reporting it would be reporting a fiction. Two filters drop it, and
      which one to use depends on the consumer, so the rule states both: a reader that wants dynamic
      views filters on `_type === "dynamic"`; a census that must also enumerate authored **element**
      views filters on `sourcePath !== undefined`, because the synthesized entry is
      `_type: "element"` *and* `sourcePath: undefined`. A reader who learns only one of these writes
      the other check wrong.
    - *Presence is never owed.* A model with no views is missing nothing loam wants, and no check
      may grade its absence. `loam init` scaffolds no `views` block; `core/brief/unchecked.ts` says
      so in the brief, and that entry may narrow but may never invert.

    **Views were already load-bearing.** A step naming a typo'd element fails LikeC4's reference
    checker (measured: 2 diagnostics on a one-step view, and that view's `steps[]` comes back
    EMPTY), `getErrors()` returns them, and loam's own rule — errors mean no model — already turns
    that landscape into `landscape.invalid` and takes the fleet gate down. That was true before loam
    read a single view. What rule 26 adds is not the ability of a views block to fail a repo; it is
    the ability of one that PARSES to be graded.

    **Enforced**, not merely written — both in `scripts/arch-check.mjs` over `codeOnly(source)`,
    each with a negative self-test in `test/arch-gate.test.ts`, exactly as the brand-cast scan
    works:
    - `computedModel` and `layoutedModel` may not appear in `src/` at all. Zero occurrences when the
      rule landed, **no whitelist needed** — the one mention, `core/c4/likec4.ts:270`, is inside a
      comment, which `codeOnly` already blanks.
    - `$data` may appear only under `src/core/c4/parsed/`. Zero occurrences when the rule landed.

    **The upstream risk, and what carries it.** `$data` is a public, typed, readonly property
    (`@likec4/core`'s `LikeC4Model.d.mts:1018`), so this is not reaching into a private — it is the
    same public-but-thinly-documented tier as `fromWorkspace`'s multi-project behaviour, which the
    batched-loader row below already accepted on the same terms. The pin (`likec4: 1.59.2`) is the
    first defence; `test/likec4-view-shape.test.ts` — one document, one dynamic view of two steps,
    asserting the exact shape including the `index` entry it must ignore — is the second, and is
    written BEFORE the read, not after. The blast radius is one module, because of the containment
    scan above. And the degradation rule is decided here rather than discovered later: if the shape
    ever moves such that the adapter cannot read it, it returns "no views read" and every dependent
    check reports **could-not-look**, never **nothing-wrong** — loam's standing rule for a suspended
    axis.

    The ergonomic accessor is a dead end, recorded so the next reader does not spend the afternoon:
    `parsedModel().views()` returns **0** items, because `LikeC4ViewModel` is typed over computed
    and layouted views. The raw `$data` record is the access path.

## Open decisions

Ranked by value over cost. The "not worth it" rows are the useful ones — they close the question.

| Change | Buys | Costs | Verdict |
|---|---|---|---|
| Add `-D import/no-cycle` to the `lint` script | Freezes the zero-cycle property, currently only discipline | One flag; verified exit 0 today | **Done** — in `arch:check`, not `lint`: the exit criterion asked for one command that runs every architecture check, and double-running oxlint bought nothing |
| `assertServiceId` in `validate`'s service branches | Closes the only path from an unvalidated argv string to a filesystem path | ~10 lines, one file. Deliberate behaviour change: an existing badly-named service directory would now be refused | **Done** — but not as this row planned. `core/repo/service-target.ts` resolves against the enumeration of `services/` first and asks the grammar only for a name no directory matches, so the behaviour change this row predicted deliberately never happened: the badly-named directory keeps grading, because refusing on the grammar would make the one service `validate --all` complains about the one service `validate --service` cannot look at. The third test in `test/validate-contract.test.ts` fails if that order is ever reversed |
| `timeout` + `maxBuffer` on `commands/verify/results.ts`'s `execFile` | Closes a hang — a blocking credential helper makes `verify --record` wait forever with no output | One line; `git()` already folds spawn failures to `-1`, so no new branch | **Done** — 10 s deadline that names itself, 64 MiB cap; `arch:check` statically prevents the regression |
| Extract `issueFinding(i: Issue): Finding` into `core/vocabulary/issue.ts` | Removes the third copy of the `gatesArchive` defaulting rule, which `archive.ts` documents in prose while re-implementing twice | ~12 lines, 3 call sites. Two are identical; `validate`'s adds a `text` hint on top. Emitted shape unchanged | **Do it** |
| Options objects for `pinOpenapiOperations` / `mergeOpenapiPaths` | Removes the one swap in the repo that silently corrupts a living document instead of crashing | 2 signatures, 2 production sites, ~30 test sites. Do **not** fix by reordering positionals — that edit is itself compile-clean and wrong | **Do it** |
| `(docsDir, feature: FeatureEntry)` for the four triple-takers | Makes an inconsistent `(dir, id)` pair unrepresentable | 9 src sites (all already hold an entry) + 11 test sites needing a shared fixture helper — budget the helper | **Do it** |
| Options objects for `writeSnapshot` / `readManifest` | Kills the only four-way positional swaps, on the undo path. Both also invert the `(docsDir, featureDir)` order every other function uses, and for a feature created without `--title` the swap is invisible in every fixture | 2 signatures, ~8 call sites | **Do it** |
| Move `archive.ts`'s landscape splicer into `core/` | Un-strands it: the region has zero `console`/`fail`/`emitJson`/`exit` calls and its only escape is a thrown error — `LandscapeSpliceError` since 2026-08-16, exactly so the splicer names no CLI code | ~695 lines relocated, ~12 imports. Payoff only arrives if you then write the unit tests | **Done** 2026-08-16 — `core/c4/splice/` (`contract` `landscape-merge` `authored-source` `placement`); the unit tests it pays for are still owed |
| Audit the six `serviceResolver` calls that omit `known` | Without it the resolver's last rung can resolve a container id to a service that never existed, so group-by-service joins find nothing | 6 sites to decide, plus a comment at each deliberate omission. Not confirmed against a fixture — audit before fixing | **Done** 2026-08-16 — confirmed against fixtures, the worst case being the removal gate answering "nobody calls it" for a container-drawn consumer. Every repository-aware site now passes the enumerated fleet (coherence, lookups, dependencies, arch coverage, the Covers matcher via `CoverageScope.known`, the verify checklist, `delta`'s projection); the two splice placement sites stay without it, each with its deliberate-omission comment — placement is cosmetic anchoring inside one document, safety-netted by the re-parse |
| Fix `core/envelope/config.ts`'s stray `console.error` | Restores rule 1 to exceptionless | Three options: delete the print (check `test/wiring.test.ts`); return the reason instead of `null` (16 callers, real payoff); or record the exception in a lint override (two visible exceptions instead of one invisible) | **Done** — option two: `ConfigLoad` returns the reason, the command layer renders it, and the `--json` envelope finally carries the parse detail |
| Split `commands/validate/`'s rule functions into core | Nothing yet | ~1300 lines relocated — now isolated in `validate/checks/` and `validate/service/` rather than interleaved with two callers, so the cost is a move rather than an extraction. `core/status/` already needs these answers and does *not* re-derive them — it calls into core. Everything with two callers is already there | **Not worth it** until `loam status --service` exists |
| Batch `validate --all`'s C4 parsing through one temp workspace | The fleet gate at fleet size: 13.7s → 0.73s median on the committed 120-service benchmark (docs/BENCHMARKS.md), peak RSS halved | `validate` becomes a command that writes — a mkdtemp `loam-c4-*` workspace in OS tmp, one single-file project per document. A kill mid-run can strand one there (never in the docs repo); accepted rather than teaching doctor about foreign tmpdirs. And the loader leans on likec4@1.59.2 multi-project behaviour that is public but undocumented for this use — the exact pin plus test/likec4-batch-parity.test.ts are the tripwire | **Done** 2026-08-19 — `core/c4/workspace.ts` `loadBatch` + `FleetContext.prefetchLikeC4`, `--all` only at first; since 2026-08-26 `loam context` prefetches its feature deltas through the same loader. Project names carry a crypto-random per-invocation token so an author-written `import` cannot resolve against a sibling project `fromSource` would refuse; a batch-infrastructure failure degrades silently to per-path loads (findings can never depend on tmpdir writability); `parsedModel` still, never `computedModel` — the computed-views boundary holds, and **rule 26 is what now states where it is**. A shared long-lived Langium instance was considered and declined: 1.59.2 exposes no public document-update API, so reuse would mean private internals or workspace watching, both worse than a 0.7s rebuild |
| Read a `dynamic view`'s declared steps out of `(await parsedModel()).$data.views` | The first two hops of loam's spine — capability id → view tag → steps → (source,target) → relationship → `metadata { op }` → operationId — become mechanical. loam already checks every hop after those two; making these two checkable makes the spine walkable from the business end. And it retires `SCHEMA.md`'s planned `flows/` tree rather than building it | The written doctrine said "never parses views" and must narrow to "never COMPUTES views" — 15 live statements across `src/`, `SCHEMA.md`, `ROADMAP.md`, `docs/DESIGN.md` and one test banner, three more inspected and deliberately left alone. `$data` is public and typed but thinly documented for this use, so it needs a shape tripwire and one-module containment. Zero runtime cost: the record is materialized by the `parsedModel()` call both loaders already make. Real hazards: LikeC4 synthesises an `index` view into the record, a step can carry no `metadata` and no tags (only the view can), a reply step is BOTH reversed and flagged (`a <- b` parses as `{source: b, target: a, isBackward: true}` — measured, and the row's first draft had this wrong), and a step names element FqnRefs rather than a relationship — so a pair joined by relationships that DISAGREE about the operation is ambiguous and must be refused-and-named, never guessed. Two relationships agreeing on one operation are not ambiguous and are attributed: that is what makes the container-level fallback safe, since `a.api -> b` and `a.worker -> b` under one `op` are one call drawn twice | **Done** — **rule 26**. The boundary is not moved, it is stated: `test/likec4-model-parity.test.ts` was always pinning the COMPUTE (that `computedModel()` invents no ancestor edges `parsedModel()` lacks), never the parse, so the written rule and the enforced rule now agree for the first time. Enforcement moved from prose into `arch:check`: `computedModel`/`layoutedModel` banned in `src/` outright (zero occurrences, no whitelist — the one mention is a comment, which `codeOnly` blanks), `$data` confined to `core/c4/parsed/`. Not filed in this table's usual place, because this is a boundary rule and not a restructuring of `src/`; numbered 26 rather than renumbered into the Boundaries block because rule numbers are cited across 14 files, `docs/DESIGN.md` itself among them, and renumbering breaks every citation for no gain |
| Weight `vouch --sample`'s pick by fan-in (`core/dependencies/fanin.ts`) | Would put the sections of the most-depended-on services in front of a reader first — the proposal's own suggestion | Fan-in counts dependants per SERVICE; nothing joins a consumer to a doc SECTION, and the join that would (section → `Operations:`/`Publishes:` → landscape edge → caller) exists only for `### Requirement:` blocks that carry those lines. Every narrative section — `## Overview`, `## Interfaces`, the prose most likely to be quietly false — would weight to zero and stop being sampled. It also needs the fleet map and every sibling's contract inside a vouch that runs in one service's repo, and an unparseable landscape would flatten the weights back to uniform without saying so | **Not worth it** — and one cost is disqualifying rather than merely large: those inputs are documents an agent can edit, and neither is covered by the digests in the seed, so weighting would hand back exactly the steering that content-derived seeding takes away. `pickSample` takes a plain section list, so weights stay an additive parameter for a version that can answer this |
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

**`scripts/arch-check.mjs` — one command, every architecture check, each with a negative self-test
in `test/arch-gate.test.ts`:** rules 1–2 (the core boundary scan), rule 3 (layering, every import
form), rule 4 (file cycles via `oxlint -D import/no-cycle` plus the package graph), the barrel ban,
rule 20 (child-process bounds), and the brand-cast containment rule 18 rests on. CI runs it in place
of the bare graph check; `npm run arch:graph` remains callable alone for move-a-module workflows.
The textual checks are regex over source — honest-but-approximate, which is exactly what the
negative self-tests exist to keep honest.

**Review-only, and saying so:** rules 5, 8, 9, 13, and the "what not to do" rows 22–25 are judgment
calls no scanner expresses; they are enforced by review against this page.

**A test can hold what lint cannot.** `test/codes-drift.test.ts` is the precedent: it
static-analyses `src/` from inside vitest with a recursive `readdir`, so it is layout-agnostic.

- Rules 15 and 21 — `test/code-limits.test.ts`, live. It walks `src/` and `test/`, counts lines per
  file, parameters per function and files per directory, and compares against
  `test/code-limits-baseline.json`. The baseline lists what was already over a limit when the limits
  landed and may only shrink: an entry the file no longer needs fails the test, so the list cannot
  silently become the permanent state. Being layout-agnostic matters more here than anywhere else —
  this test has to keep working while rule 21 moves every file it reads.
- Rule 6 — `test/validate-contract.test.ts`, live. `loam validate --service ../../etc` exits
  `invalid-option` through `--service` and the positional target alike, and a `treeHashes`
  before/after asserts the refusal wrote nothing.
- Rule 7 — assert the feature-id regex source appears once across `src/`.
- Rule 12 — `test/fleet-context-parity.test.ts`: every `FleetContext` reader against its direct core
  counterpart over one rich fixture, with a per-reader richness floor, a completeness check over the
  prototype, and a negative control proving the comparator bites.

**tsc holds rules 16–18 for free** once applied: an options object, a `FeatureEntry` parameter or a
branded id makes every stale call site a compile error. Rule 18's brands are the strongest form of
this — a `string` no longer fits where a `ServiceId` is wanted — and the reason the count of
annotation sites is a one-time cost rather than an ongoing one.

**A script holds the one thing neither can see.** `scripts/package-graph.mjs` builds the
package-level import graph and reports its cycles. `import/no-cycle` reads the file graph and is
blind to a cycle that exists only between directories, so rule 21's acyclicity obligation is this
script or it is nothing.

**Review convention only, and that is fine:** rules 8, 9, 13, and 22–25. They are decisions, not
properties. Writing them down is what makes the next "should we restructure?" a five-minute
conversation instead of a five-day one.
