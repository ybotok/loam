---
name: split-module
description: Split a source file over 400 lines, or a package over 5 files, without losing history or comments. Use whenever test/code-limits.test.ts reports a new violation, or when relocating a module between packages — the order of operations is what keeps `git blame` and the package graph intact.
---

# Splitting a module or a package

`test/code-limits.test.ts` told you *that* something is over. It cannot tell you *where* to cut,
and a cut made at the line the number happens to land on is worse than the long file was. This
skill is the order of operations; `docs/CODE-STYLE.md` is the reasoning.

## Find the seam before you touch anything

Read the whole module first. You are looking for a boundary that is already there:

- **A distinct data shape** — the functions that build and read one record, versus the ones that
  build and read another.
- **A distinct phase** — parse, then compute, then render. Phases are the most common seam here
  and give the halves their names.
- **A distinct document kind** — this codebase's artifacts (spec, delta, openapi, landscape) are
  natural boundaries and already how `src/core/` divides.

If the only boundary you can find is "the first 400 lines", stop and say so. A file with one
subject and no internal phase boundary is a real finding worth reporting, and it is not fixed by
`foo-part2.ts`. Names that mean the split failed: `*-helpers.ts`, `*-utils.ts`, `*-common.ts`,
`*-misc.ts`, anything with a number in it.

Check what the seam costs before committing to it:

```bash
rg -n "from \"[^\"]*<module>\.js\"" src test | wc -l   # call sites that will be rewritten
```

## The order

1. **Move, in a commit that does nothing else.** `git mv` for a relocation; for a split, create
   the new file and move whole functions across without editing them. Rename detection survives a
   pure move and does not survive a move mixed with edits — and this repository's comments *are*
   its documentation, so a broken `git log --follow` loses more than the diff shows.

2. **Carry every comment with the line it explains.** A WHY comment is not decoration here; it
   records the defect a line prevents. If a comment cross-references the module it used to live
   beside, the reference is now false — correct it, never delete it. A false cross-reference is
   how the next reader stops looking.

3. **No barrel.** Do not add `index.ts`, do not re-export from the old path for compatibility.
   Every importer points at the module it actually needs. A re-export would hide the real edge
   from `import/no-cycle` and make the package graph unreadable (`docs/DESIGN.md` rule 11).

4. **Rewrite the imports with a script, not by hand,** and let the compiler be the proof:

   ```bash
   npm run typecheck
   ```

5. **Check the package graph, not just the file graph.** Moving a file between directories can
   create a cycle between *packages* while every file stays acyclic — `import/no-cycle` cannot see
   it:

   ```bash
   npm run arch:graph
   ```

   A cycle means either the two packages are one subject, or the module you moved is a
   leaf-shaped helper that belongs lower down. Move the helper; do not import the weight.

6. **Fix the prose cross-references, and keep the bulk rewrite away from the baseline.** Comments
   and docs naming the old path are now false. A scripted `old/path.ts` → `new/path.ts` sweep over
   `src/ test/ docs/ .claude/` is the right tool for those — but **exclude
   `test/code-limits-baseline.json`**. A sweep that reaches it rewrites the very paths the
   staleness check compares, so the move validates itself and the check silently passes. (This is
   not hypothetical; it happened on the second wave of this refactor.) The baseline is derived,
   never edited:

   ```bash
   LOAM_CODE_LIMITS_BASELINE=write npx vitest run test/code-limits.test.ts
   ```

   Then read the diff. Entries should have **disappeared**. If one appeared, you created a
   violation — go back to step 1. If a path merely changed, that is the move and is expected.

   **Splitting a widely-imported module raises some importers' numbers, and that is not a
   violation — but say which, and by how much.** An importer that needs symbols from two halves
   now needs two import statements, so it grows by a line. There is no way around it that is not
   worse: a barrel would hide the edge (rule 11), and squeezing a comment to pay for it is the
   cosmetics this whole rule exists to prevent. Splitting `repo.ts` cost six importers +1 or +2
   and saved about sixty lines elsewhere, because multi-line import blocks collapsed. Quote both
   halves of that trade in the commit; a baseline diff where numbers rise without a stated reason
   is indistinguishable from one where somebody let a file grow.

7. **Check the dynamic imports by hand.** `await import("…")` takes a string, so neither `tsc` nor
   an import rewriter that only reads `import … from` will see it. This has now bitten twice in
   the same test — `test/repo.test.ts` reaches for `landscapePath` that way — and both times the
   full suite caught in under a second what typecheck could not see at all. That is the argument
   for running the whole suite on a change that "only moves things".

   ```bash
   rg -n 'import\(' src test
   ```

## What must not change

A split is a refactor: **no behaviour change, no signature change, no "while I'm here" fix.** If
you find a defect mid-split, finish the split, then fix it in its own commit with its own test —
otherwise the test that pins the fix and the move that hides it land together and neither is
reviewable.

Do not weaken a test, and do not let coverage fall: a split that moves an uncovered branch into a
new file changes which thresholds it counts against.

## Verify

```bash
npm run typecheck && npm run lint && npm run arch:graph
```

```bash
npx vitest run test/code-limits.test.ts
```

Then the full gate (`gate` skill). Coverage is the one that catches a split gone wrong — the
suite passing while `functions` drops means you moved code nothing calls.
