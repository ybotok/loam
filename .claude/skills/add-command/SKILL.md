---
name: add-command
description: Add a new CLI command to loam, or add a flag to an existing one, without breaking the machine contract. Use whenever registering a new `loam <verb>`, since several invariants are enforced by tests that fail late and read as unrelated.
---

# Adding a command

A command is public surface the moment it ships. Several of the steps below are enforced by tests
whose failure message points somewhere other than the omission, so work the list rather than
discovering it.

## Shape

One module per command in `src/commands/`, exporting `registerX(program: Command): void`.
`src/commands/dependencies.ts` (92 lines) is the smallest complete example — read it first.

```ts
export function registerThing(program: Command): void {
  program
    .command("thing")
    .argument("[featureId]", "…")
    .description("…")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (arg: string | undefined, opts: ThingOptions) => { … });
}
```

Then register it in `src/cli.ts` beside the others.

## The invariants

1. **`--json` is mandatory.** `test/agents.test.ts` counts every `.command(` across
   `src/commands/` and asserts each declaring module also declares `.option("--json"`, then
   asserts the count equals `buildProgram().commands.length`. A registration reached through a
   helper instead of a literal `.command(` call will fail that equality — keep the call literal.

2. **The command layer is I/O only.** Parse args, call `core/`, print, set the exit code. Rules
   belong in `src/core/`. `core/` must not print and must not be imported *from* by nothing —
   check the direction.

3. **The preamble is a decision, not boilerplate.** Most commands open with:

   ```ts
   const json = opts.json === true;
   const config = await loadConfig();
   if (!config) { reportNoConfig(json); return; }
   const { docsDir } = config;
   if (!docsRepoReady(json, docsDir, "services")) return;   // or "docs"
   ```

   Decide deliberately whether your command needs the docs-repo gate, and which `need` —
   `"services"` when it counts or enumerates services, `"docs"` when a feature is readable without
   them. Omitting it is how `loam new` came to scaffold into a directory that was not a docs repo
   and exit 0. If your command genuinely should not gate, say why in a comment.

4. **Refusals use an existing stable code** where one fits. If none does, follow the
   `add-error-code` skill — do not invent a code inline.

5. **Reuse the shared refusal messages** rather than hand-writing the sentence:
   `missingFeatureMessage`, `NO_SERVICE_MESSAGE`, `reportRepositoryUnavailable`. A hand-written
   copy drifts from the others and loses the branches they have grown.

## Then

- **Tests** in the harness idiom (`makeProject`, `runLoam`) — the happy path, each refusal with
  its code, and `--json` shape.
- **The agent surface.** If the command is something an agent should run as part of the cycle,
  it belongs in `AGENTS_MD` / the command bodies in `src/core/agent.ts`.
  `test/agent-commands-runnable.test.ts` parses every `loam …` string loam prints against the real
  CLI, so a command spelled wrong in the docs fails there, not where you wrote it.
- **CHANGELOG** — a new command is user-visible.

## Verify

```bash
npx vitest run test/agents.test.ts test/agent-contract.test.ts test/agent-commands-runnable.test.ts test/codes-drift.test.ts test/cli.test.ts
```

Then the full gate.
