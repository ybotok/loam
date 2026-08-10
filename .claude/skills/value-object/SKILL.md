---
name: value-object
description: Introduce or extend a branded value object in loam — a validated id, path or composite record that the compiler can tell apart from a raw string. Use when adding a new identifier kind, when migrating a `string` parameter to its branded type, or when a function has grown past four parameters.
---

# Value objects

`docs/DESIGN.md` rule 18: a validated identifier or path carries a type that says so; an
unvalidated one carries its own raw type. The point is not tidiness — it is that `loam list` must
be able to show you a badly-named service directory, and nothing else in the codebase should be
able to hand that same string to a path join.

## The shape

```ts
declare const brand: unique symbol;

/** A service id that has passed `serviceIdProblem`. Construct only via `parseServiceId`. */
export type ServiceId = string & { readonly [brand]: "ServiceId" };

/** A directory name read off disk. Says nothing about whether it is a legal id. */
export type RawServiceId = string & { readonly [brand]: "RawServiceId" };

export function parseServiceId(raw: string): ServiceId | IdProblem {
  const problem = serviceIdProblem(raw);
  if (problem) return problem;
  // The one cast. It is on the line after the check that earns it, and it is
  // the only place in the repository that may write `as ServiceId`.
  return raw as ServiceId;
}
```

## The four rules

1. **One constructor, and it validates.** The brand is a claim about what has been checked. A
   second construction path makes the type a comment the compiler happens to typeset.

2. **A cast in the constructor is the design; a cast anywhere else is a lie.** Before adding
   `as SomeBrand` outside the constructor module, ask what you actually have — usually the answer
   is that you have the raw type and need the parse.

3. **Unvalidated input keeps its own type.** If a reader must return values that failed
   validation (the `listServices` case), it returns the raw type and reports the failure as a
   field. Do not widen the brand to cover both; that is the version of this rule that protects
   nothing.

4. **Values only ever passed together are one value.** Name the record and take it —
   `vouch(req: VouchRequest)`, `validateService(check: ServiceCheck)`. A function needing
   `featureDir` and `featureId` takes the `FeatureEntry` that already holds both (rule 17):
   passing a fact and its own derivation makes an inconsistent pair representable.

A value object is `readonly` and compared by value. No mutating methods, no identity comparison,
and **no `class`** — `docs/DESIGN.md` rule 10 allows a class only for an `Error` subclass or
per-invocation cache state, and a branded type needs neither. A wrapper object would also change
every JSON payload and every path join, which is a contract change (`AGENTS.md`, "What is frozen").

## Migrating an existing `string`

Work outward from the constructor, not inward from the leaves — the compiler drives it:

1. Add the brand and the smart constructor beside the existing validator.
2. Change the **producer** first: the function that already validates now returns the branded
   type. Everything downstream that stores or passes it starts failing to compile.
3. Follow the errors. Each one is either "annotate this as `ServiceId`" or "this value never was
   validated" — the second is a real finding, so read it rather than casting past it.
4. Change the **consumers** last: the functions that join paths take `ServiceId`, and rule 6's
   `assertServiceId` calls at the command boundary become the parse that produces one.
5. When a signature crosses four parameters during this, stop and make the record (rule 4 above).
   `test/code-limits.test.ts` will insist anyway.

Do not introduce a brand and leave half the call sites on `string`. A partially-applied brand is
the worst of both: the annotations are paid for and the guarantee is not there.

## What this must not change

The wire format. A branded string **is** a string at runtime — `JSON.stringify` and every path
join behave identically, and that is the whole reason this is a brand and not a wrapper. If a
`--json` payload key or an `error.code` changes, you did something else; see the frozen contract
in `AGENTS.md` and the `add-error-code` skill.

## Verify

```bash
npm run typecheck
```

That is the real test — a brand that compiles everywhere it should and nowhere it should not is
doing its job. Then:

```bash
npx vitest run test/code-limits.test.ts
```

and the full gate. If a `--json` shape moved, run
`npx vitest run test/agent-contract.test.ts test/codes-drift.test.ts` and treat it as a contract
change, not a refactor.
