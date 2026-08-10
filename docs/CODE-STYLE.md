# TypeScript in this repository

House rules, with the reason each one exists. Where a rule was learned from a defect this
codebase actually shipped, the defect is named — a rule whose cost you cannot picture is a rule
somebody will trade away.

The compiler already enforces the boring half. `strict` and `noUncheckedIndexedAccess` are on,
`verbatimModuleSyntax` makes type-only imports explicit, and `oxlint` runs with
`correctness`, plus the import, promise and node plugins, at `--deny-warnings`. Nothing below
repeats what those catch. What follows is what they cannot see.

## Limits

Four numbers. They are not guidance and they are not a review opinion —
`test/code-limits.test.ts` counts them on every run of the gate.

| Limit | Applies to | Enforced by |
|---|---|---|
| A source file is at most **300 lines** | `src/` | `test/code-limits.test.ts` |
| A function or method takes at most **4 parameters** | `src/` and `test/` | `test/code-limits.test.ts` |
| A constructor takes at most **4 parameters** | `src/` and `test/` | `test/code-limits.test.ts` |
| A package directory holds at most **5 files** | `src/` | `test/code-limits.test.ts` |

A directory over five files splits into sub-packages along a subject seam. Sub-directories are
packages in their own right and do not count toward their parent's five.

**These limits replaced an earlier rule that said the opposite**, and the replacement is a
deliberate trade, so the cost that rule was protecting is worth stating rather than forgetting.
Until this was written, the house rule was "long files are allowed; incoherent ones are not —
split along a seam that already exists, never to hit a line count." Its reason was sound: a split
made to satisfy an arithmetic threshold picks the seam the number happens to land on, not the one
the subject has, and a bad seam costs more than a long file. `git blame` also stops at a move, and
in this codebase the comments are the documentation.

What the limits buy in exchange: a hard ceiling turns "is this module still one subject?" from a
judgement made at review time — which is to say, sometimes — into a question the tree asks on
every commit. `src/core/agent.ts` reached 2,387 lines and `src/commands/validate.ts` 2,001 without
anybody deciding they should; nothing asked. A ceiling asks.

Both halves of that trade are real, which is why the limits come with an obligation, not just a
number:

**Split on a seam, and let the limit tell you *when*, never *where*.** A distinct data shape, a
distinct phase, a distinct document kind. If the only seam you can find is line 300, the module is
telling you it has one subject that grew too big for one file — find the phase boundary inside it
and name the halves after the phases. Never `foo-part2.ts`, never `foo-helpers.ts`, never
`utils.ts`: a file whose name cannot say what is inside it is the failure this rule was traded
against, arriving anyway.

**Carry the comments with the code they explain.** A WHY comment moves with its line. This is
where the cost of the trade is actually paid, and it is paid by hand — the comment recording which
defect a line prevents is worth more than the line.

**A move is a move.** Use `git mv` and keep the split in a commit that does nothing else, so
rename detection survives and `git log --follow` still reaches the history.

## Value objects

**An identifier or a path that has been validated carries a type that says so.** A validated
`ServiceId` and an arbitrary `string` are not the same thing, and for years the only difference
between them here was which line you happened to read. Branded types make it the compiler's
problem:

```ts
declare const brand: unique symbol;
export type ServiceId = string & { readonly [brand]: "ServiceId" };

export function parseServiceId(raw: string): ServiceId | IdProblem { … }
```

The rules that make a brand worth its annotations:

**One constructor, and it validates.** A brand is only a claim about what has been checked, so a
value carrying it must be reachable exactly one way — through the smart constructor that did the
checking. A second construction path, or a cast anywhere outside the constructor module, makes the
type a comment that the compiler happens to typeset.

**A cast in the constructor is the design; a cast anywhere else is a lie.** The single
`as ServiceId` lives on the line immediately after the check that earns it.

**Unvalidated input keeps its own type.** `core/repo/repo.ts`'s `listServices` deliberately returns ids
that *failed* validation, reporting the failure as a field, because `loam list` must show you the
badly-named directory that exists on disk. That case is not an exception to the brand, it is a
second type: the raw form is `RawServiceId`, the validated form is `ServiceId`, and the function
that turns one into the other is the only bridge. A brand that needs a knowingly false cast at one
call site is not protecting anything at the other two hundred.

**Two or more values that are only ever passed together are one value.** Name the record and take
it: `vouch(req: VouchRequest)`, `validateService(check: ServiceCheck)`. A function needing
`featureDir` and `featureId` takes the `FeatureEntry` that already holds both — passing a fact and
its own derivation makes an inconsistent pair representable.

**A value object is `readonly` and is compared by value.** No methods that mutate, no identity
comparison. `readonly` in the type; construct a new one rather than editing one in place.

## Type safety

**`unknown` at the boundary, narrowed once by a validator that actually checks.** Data from
disk, YAML, JSON or a dependency arrives as `unknown`. A cast at a parse boundary is not a
shortcut, it is the point at which the compiler stops helping and nobody notices. `loam`'s
snapshot manifest was read through such a cast: well-formed JSON that was not an object answered
`undefined` to every field and slipped through as "a different loam", and a bare `null` threw a
`TypeError` out of the refusal itself — in a code path guarding the only surviving copy of what
the living docs said. `core/kernel/records.ts` holds the shared `isRecord`; use it, then check each
field you are about to read.

**A type predicate carries its proof.** `function isFoo(v: unknown): v is Foo` must check every
field it claims. One that checks one field and asserts five is a cast with extra steps.

**Fail closed at a validator.** When a check cannot reach a verdict, the answer is the refusal,
not the permissive branch. Silence must never be the way through.

**No non-null `!`.** Under `noUncheckedIndexedAccess`, `arr[i]!` and `map.get(k)!` are the common
forms, and each is a crash the compiler offered to prevent. Some are locally provable — a regex
capture group that cannot be absent when the match succeeded, an index inside its own bounds
check. Those may stay, and the surrounding code should make the proof visible. What may not stay
is an assertion resting on an invariant declared nowhere: `verified[i]!` joining two arrays by
position because one function happens to push in the order another iterates. Join on a key
instead, and let a missing entry fail closed.

**Model variants, not optional-field soup.** If two or three optional fields are only ever set
together, they are a variant. Tag them:

```ts
type ActionRow =
  | (Emission & { action: "written" | "replaced" })
  | (Emission & { action: "kept"; kept: StampedFeature })
  | (Emission & { action: "conflict"; kept: StampedFeature; owners: string[] });
```

Six non-null assertions in `commands/gherkin.ts` deleted themselves when that type replaced one
row shape with four optional fields. Impossible states stopped being constructible.

**Exhaustiveness is checked, not assumed.** A `switch` over a closed union ends by assigning to
`never`, so adding a variant is a compile error rather than a silent fallthrough — but only where
the fallthrough is genuinely unreachable. `status.ts`'s `verifyStep` ends in a `return []` that is
a real, correct answer for a confirmed record; a `never` there would throw on every finished
feature. Check that the branch is dead before you make it fatal.

**`as const` for literal tables, a derived union for the type.** `readonly` in parameter positions
where nothing mutates. Prefer the smallest structural parameter type a function actually needs —
it documents the dependency and makes the function testable without a fixture.

## Errors

**Errors carry codes, not prose.** Callers branch on a typed subclass; the command layer maps it
to a documented CLI code. Matching on `err.message` breaks the moment somebody rewords the
message, and the message is also the user-visible string somebody will want to reword.

**An empty `catch {}` needs a comment naming which absence it means.** "Unreadable is not stale."
"Not present reads as absent." If you cannot write that sentence, you are swallowing something.

**Expected outcomes are return values.** Validation results, "not found", "refused" — these are
data (`Result`-shaped unions), not exceptions. Exceptions are for the genuinely exceptional.

**One place decides the exit code.** Domain code in `core/` returns; `commands/` maps to
`process.exitCode`. `core/` does not print, does not read `process.argv`, and does not call
`process.exit`.

**Read inside the `try` that handles the read.** `loadConfig` performed its `readFile` one line
above its own `try`, so a `loam.json` that was a directory escaped as `internal` from every
command in the CLI rather than as the designed `config-invalid`.

## Async

**No `await` in a loop over independent work** — `Promise.all`, capped when the work touches the
filesystem or spawns processes. `core/kernel/concurrency.ts` holds the pool and the measurement that
justifies its size; use it rather than an uncapped fan-out, because each in-flight feature can
hold a whole Langium workspace.

**Sequential when ordering is load-bearing — and say why.** A shared accumulator, a hash fed in
sequence, a per-branch cycle guard. Without the comment, the next reader optimises it into a race.

**No floating promises. `async` without `await` is a smell.**

## Modules

**No import cycles.** ESM tolerates them until the day a module-scope `const` is read before its
initialiser runs. They are also a design statement — that two modules are really one. The eight
runtime cycles this repo carried all traced to the same cause: a leaf-shaped helper living inside
a heavy module. `decodeDocument` sat in `fleet-context.ts`, which loads the whole fleet, so every
module that only wanted to turn bytes into a string imported the fleet loader. Moving it to
`core/kernel/document-bytes.ts` — a leaf whose only import is `node:buffer` — removed six of them.

When you reach for a helper and find it in a module far heavier than the helper, that is the
signal. Move the helper out; do not import the weight.

**Export only what is used.** An exported symbol is API surface: it invites callers and blocks
refactors. A symbol used only inside its file loses its `export`.

**Module-level mutable state is a hazard**, because tests `chdir` per invocation and a value
cached at import time leaks across them. `arch.ts`'s resolver cache is the shape that is allowed:
a `WeakMap` keyed on the per-invocation array, whose value is a pure function of that key and
holds nothing derived from the working directory. Its comment says exactly that, and a cache whose
comment cannot say it does not belong.

**A module is one subject, and at most 300 lines of it.** The subject rule is the one that
matters; the line count is what makes somebody check. A module that is genuinely one subject and
has outgrown 300 lines has a phase boundary inside it — find that, split there, and name each
half after its phase. See **Limits** above for the seam obligation that comes with the number.

**A package is one subject too, and at most five files of it.** The same reasoning one level up:
`src/core/` held 38 modules in a flat list, so "which of these belong together?" had no answer the
tree could give. Six files in a directory is the signal to name the two subjects that are actually
in there.

## Duplication

**Three strikes.** Two similar blocks are a coincidence. Extract on the third; earlier extraction
usually invents the wrong seam.

**Duplicated literals are worse than duplicated code.** The same string in four files will drift.
It did: the enumeration `catch` block existed in four copies, an errno fix landed in one of them,
and `list`, `show` and `validate` went on reporting `internal` where `status` correctly reported
`repository-unavailable` — for years of reading, the four looked identical.

**Near-duplicates deserve a diff, not a merge.** Before unifying two similar functions, list every
difference. If unifying needs a boolean parameter that switches behavior, keep them separate. The
two `.loam-before/manifest.json` readers in this repo look like one function and are not: one
throws, one returns `null`, and each failure mode feeds a different tested refusal.

**Do not abstract across a layer boundary** just because the code looks alike.

## Comments

**Names say what; comments say why.** This codebase's comments are load-bearing documentation:
they record the failure a line prevents. That is why they are long, and why deleting one during a
refactor loses information the code cannot carry.

A comment that describes behavior must be corrected when the behavior moves, not deleted. A
cross-reference to another module is a claim, and a false claim in a comment is worse than none —
it is how the next reader stops looking.

## Not a finding

Renaming for taste. Converting working `interface`s to `type`s. Introducing a framework, a DI
container, or a dependency. Abstraction with one call site, added "for future extensibility".
Anything a linter already owns — including the four limits, which `test/code-limits.test.ts` owns:
report a *bad seam*, never the number.

## Before you send

```sh
npm run lint && npm run typecheck && npm test
```

`test/code-limits.test.ts` runs inside `npm test` and holds the four limits. A file it names is
either split or — for pre-existing code you are not touching — already listed in
`test/code-limits-baseline.json`. **That baseline may only shrink.** Removing the last entry for a
file is part of the change that fixes it; adding an entry is not a way to land a new violation,
and the test fails on a stale entry precisely so the list cannot quietly become permanent.

Coverage thresholds are enforced (`npm run test:coverage`): statements 91, branches 82,
functions 95, lines 93. Do not lower one to land a change, and do not write a test purely to move
a number.
