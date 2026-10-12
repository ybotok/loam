---
name: add-error-code
description: Add a new stable error code or issue/finding code to loam correctly. Use whenever a command needs to refuse for a reason no existing code covers, or a check needs to emit a new finding. Codes are a machine contract, so adding one has a fixed checklist that a drift test enforces.
---

# Adding a stable code

A code is what a machine branches on. Prose around it may be reworded at will; the code string may
never change once released. Adding one is cheap, changing one is a breaking change — so pick the
name once, carefully.

> `src/core/` is a tree of subject packages under a five-file limit, so the module paths below are
> written as module *names*. Locate one with `rg --files -g '<name>.ts' src` rather than assuming a
> directory. What a code lives in never changes; where that module sits can.

## Before adding

**Prefer an existing code.** Read the `ErrorCode` union in `json.ts` and the `IssueCode`
family in `issue.ts` in full. A new code is justified only when a caller would need to
*act differently* than for every existing one. "The message is different" is not a reason — the
message is already free-form.

Ask: could a caller distinguish this case by the payload instead? If yes, do that.

## The checklist

1. **Add the member to the union**, in the group it belongs to, with a `/** … */` doc comment
   saying what the case is and — where it is not obvious — whether re-running could ever succeed.
   Follow the neighbouring entries' voice.

2. **Emit it** from the command or check. Refusals go through `fail(json, code, message)`
   (`src/core/envelope/json.ts`); findings carry `code` on the `Finding`/`Issue`.

3. **Document it in the agent surface.** `test/codes-drift.test.ts` requires every stable code to
   appear, backticked, in `AGENTS_MD` (the `ORIENTATION` literal in `src/core/agent/agents-md.ts`)
   or in a page `loam instructions` prints (`PROTOCOLS`: the workflow protocols and reference pages
   under `src/core/agent/workflows/`, the `loam-codes` page among them, assembled from the sections
   under `src/core/agent/agents-md/`). This is not optional and it is not cosmetic: an undocumented
   code is a branch nobody was told about. Add it to the list or table where its siblings live —
   usually the `loam-codes` command map, and the `/loam-check` table in
   `src/core/agent/workflows/check.ts` when `loam explain` should answer it.

   Note the drift test's known blind spot — codes passed as a *positional argument* to a helper
   (the `issue(target, scope, code, path, message)` form in `src/core/openspec-inventory.ts`) are
   collected by a separate pattern. If you add a code that way, confirm the test actually sees it.

4. **Write the message.** Say what happened, what it means for the user's files, and what to do
   next. Name the file or the id involved. Do not tell the user to run a command that does not
   grade this case — check that the suggested command actually reports it.

5. **Test it.** A test that triggers the refusal and asserts `error.code` from `--json`, the exit
   code, and — for anything on a write path — that nothing was written.

6. **CHANGELOG.** A new refusal is user-visible: a case that used to succeed, or used to report
   `internal`, now reports this. Say that in the terms a user notices.

## Retiring a code

Retiring a code is not the checklist above run backwards, and it is not free.
`landscape.datastore-private` was the
**first code this repository has ever retired** (2026-09-07, because where a store is drawn is the
team's choice and the check graded the drawing rather than the architecture). What that cost is
written down here so the next retirement is a checklist rather than archaeology.

**First, check you are allowed to.** A member of the `ErrorCode` union in `json.ts` or of the
`IssueCode` family in `issue.ts` is FROZEN — AGENTS.md says so — and removing one is a breaking
change, not a cleanup. A plain validate `Finding`/`Issue` code string that is in neither union is
retirable; `landscape.datastore-private` was one. Read both files and confirm which you have. Do not
infer it from the shape of the name: `landscape.*` holds both kinds.

Then, in this order.

1. **Delete the emitter, and prune what only it kept alive.** Retiring one arm of a check leaves
   dead weight behind: this one took a finding builder, a placement helper, an exported type and two
   fields of the check's input record with it. `lint` and `typecheck` convict the unused locals; an
   exported type and an unread interface field they do not, so grep each name and delete by hand.
2. **Remove its row from `src/core/agent/workflows/check.ts`.** That table is not prose *about*
   `loam explain` — it **is** `loam explain`'s source, parsed out of the shipped constant at runtime
   by `src/core/explain/fix-tables.ts`. Leave the row and the binary explains, in the present tense,
   a code nothing can emit. Nothing catches this for you: `test/codes-drift.test.ts` grades
   emitted → documented and never the reverse. Removing a row also lowers the parsed row count, so
   check `test/explain.test.ts`'s count floor still clears.
3. **Remove it from the generated agent surface.** The sections in `src/core/agent/agents-md/`
   enumerate the codes each command emits — `command-map.ts` carries the `loam validate` lists —
   and they are the `loam-codes` page `loam instructions` prints, not part of AGENTS.md. If
   `AGENTS_MD`'s `ORIENTATION` literal (`src/core/agent/agents-md.ts`) names the code too, remove it
   there and run `npm run meta:agents`: `meta/docs/AGENTS.md` is checked in, and `agents.stale`
   grades the version STAMP, so a same-version edit leaves that file wrong while every check
   reports the repo healthy.
4. **Correct the comments that named it — never delete them.** "This used to fire and no longer
   does, and here is why" is the sentence a future reader needs most; a deleted comment is how the
   next person re-derives the whole argument. The retirement left a corrected sentence in each of
   `fleet/map/consumers.ts`, `fleet/census.ts` and `checks/health-deps.ts`.
5. **Add ONE `ALLOWED_PROSE_TOKENS` entry in `test/docs-facts.test.ts`.** This is the step that is
   invisible until it fails, and it is what made this retirement expensive. That test asserts every
   dotted backticked token in a packaged page is a code loam **emits** — and CHANGELOG.md names a
   retired code once per release that shipped or reworded it (about eight times for this one),
   SCHEMA and ROADMAP more. Use the existing entry's reason verbatim, with your code's date and
   one-line reason — `retired code, named in release history — CHANGELOG and ROADMAP describe the
   releases that emitted it (retired <date>: <reason>)`. The entry stays honest by construction: the
   same test still proves the token occurs in a packaged page, and the sibling check still proves
   the code is not emitted.
6. **Walk every packaged page** — `PACKAGED_MARKDOWN` in `scripts/package-docs.mjs`: README.md, the
   `files[]` Markdown (CHANGELOG, SCHEMA, ROADMAP, QUICKSTART, WORKFLOW, …) and `examples/**`. A
   page speaking in the PRESENT tense ("this warning fires when…") is now false and must be
   rewritten to the new stance — SCHEMA's "Private stores" became "where a store is drawn is the team's choice",
   and ROADMAP's line gained "retired on 2026-09-07, because…". The allowlist entry licenses
   HISTORY, never a live claim.
7. **Rewrite the tests in both directions.** Every case asserting the code fired, and — the one that
   is easy to miss — every case that bought SILENCE from it. `test/landscape.test.ts` had been
   tagging a fleet-owned Redis `#external` purely to stop the retired check firing; with the check
   gone that tag is a lie about the fleet, and it had to go with it. Add a case pinning the
   criterion the retirement asserts (here: ZERO findings for exactly the shape that used to be
   graded), and a case that fails if the code is ever emitted again — `collectEmittedCodes()` reads
   the source the way codes-drift does.
8. **CHANGELOG, under `### Removed`.** Name the code, what fired it, why it is gone, and what a user
   notices: `loam explain <code>` no longer answers and the row is gone from the agent-facing check
   table. State outright whether the code was in a frozen union, because a reader needs to know
   whether a contract broke.

**What you must NOT do: rewrite release history.** The entry that announced the code, and every
later entry that changed its message, describe what those versions actually emitted. They are true
and they stay. A changelog edited to pretend a shipped version never had a code is worse than one
that names a dead code — permitting exactly that is why the allowlist entry exists.

## Verify

```bash
npx vitest run test/codes-drift.test.ts test/agent-contract.test.ts test/agent-commands-runnable.test.ts
```

Retiring one adds `test/docs-facts.test.ts` and `test/explain.test.ts` to that line.

Then run the full gate.
