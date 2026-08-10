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
   appear in `AGENTS_MD` and/or the slash-command bodies in `src/core/agent.ts`. This is not
   optional and it is not cosmetic: an undocumented code is a branch nobody was told about. Add it
   to the table where its siblings live.

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

## Verify

```bash
npx vitest run test/codes-drift.test.ts test/agent-contract.test.ts test/agent-commands-runnable.test.ts
```

Then run the full gate.
