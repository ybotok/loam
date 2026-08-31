---
name: gate
description: Run loam's full verification gate — lint, typecheck, the architecture and self-model checks, the whole test suite, and the enforced coverage thresholds — and report the result honestly. Use before committing, before opening a PR, and after any wave of edits. Also use when asked whether the tree is green.
---

# The gate

Nothing in this repository is done until this is green. Run the steps in order and stop fixing
once something is red — a later step's output is meaningless while an earlier one fails.

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run arch:check
```

```bash
npm run meta:check
```

```bash
npm test
```

```bash
npm run test:coverage
```

The full suite is over 150 files and takes about two minutes. Do not substitute a subset for the
final run; per-file runs (`npx vitest run test/archive.test.ts`) are for iterating only.

`arch:check` is the architecture gate — cycles, the package graph, the core→commands ban, the
barrel ban, the console/process boundary, child-process bounds and brand-cast containment.
`meta:check` is NOT part of it and answers a different question: `arch:check` proves the layering
holds, `meta:check` proves `meta/docs/`'s written model still describes `src/`. A package added and
drawn nowhere breaks no rule; a cycle breaks every rule while the map stays current. When it is red
it prints the exact line to add — use the `self-model` skill, which also says which prose in
`docs/DESIGN.md` carries the same fact and is not derived from anything.

If the change touched `src/core/agent/agents-md/` or `src/core/agent/workflows/`, also run:

```bash
npm run meta:agents
```

The generated `meta/docs/AGENTS.md` goes stale on a same-version edit and NOTHING else notices:
`agents.stale` grades the version stamp, not the content.

If the diff moved a file between directories, also run:

```bash
npm run arch:graph
```

It reports cycles in the **package** graph alone, which is what `arch:check` already covers — it is
here as the fast standalone check for a move-a-module workflow, not as extra coverage.

## When `code-limits` is what is red

`test/code-limits.test.ts` counts three limits — 400 lines, 4 parameters, 5 files per package —
against `test/code-limits-baseline.json`. (The fourth house limit, branded ids, is held by tsc and
never appears here.) It fails three ways, and the fix differs:

- **"New violations"** — split it. Use the `split-module` skill; the limit says *when*, never
  *where*. Do **not** add the entry to the baseline: that is the one move this whole mechanism
  exists to make visible.
- **"Already over the limit and grew"** — an oversized file got bigger. Shrink it back or split
  it. Raising its baseline number is the same evasion as the previous case.
- **"Stale baseline entries"** — something was fixed or moved, and the baseline still lists it.
  This is the good failure. Re-derive rather than hand-edit, then read the diff to confirm entries
  only disappeared:

  ```bash
  LOAM_CODE_LIMITS_BASELINE=write npx vitest run test/code-limits.test.ts
  ```

The baseline may only shrink. If you cannot fix a violation in this change, say so and stop —
report the red.

## Enforced thresholds

`statements 91 · branches 82 · functions 95 · lines 93`, configured in `vitest.config.ts`.

If a threshold now fails, report which and by how much. **Do not lower a threshold** to land a
change, and do not add a test whose only purpose is to move a number — say the number moved and
let the maintainer decide.

## Fixing what is red

- A compile error or test failure from an unfinished edit: finish the edit.
- A test asserting the old behaviour where the change was *deliberate and documented*: update the
  test, and quote the CHANGELOG line or the instruction that authorises the behaviour change. If
  nothing authorises it, the **source** is wrong — fix the source, never the test.
- A failure you did not expect: that is a regression. Fix the source and say so loudly.

Never delete, skip or `.only` a test to reach green. Never weaken an assertion. A truthful red is
worth more than a green you engineered — report it and stop.

## Report

State the exact final result of every step: typecheck errors, lint problems, the `arch:check` and
`meta:check` verdicts, test files and tests passed/failed, and the four coverage percentages against
their thresholds. Then list every fix you made and why. If anything is still broken, say precisely
what and what you tried.
