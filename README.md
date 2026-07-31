# loam

Architecture-first spec framework for microservice fleets.

`loam` reverse-engineers a service's documentation and C4 architecture **from its code**, then lets you drive cross-service features top-down: you author a **C4 delta**, and `loam` projects it onto each affected service as concrete work + generated Gherkin (BDD) that drives TDD.

> Working name: the tool was sketched in design notes as `featspec`; it lives here as `loam`. Easy to rename.

## Why

OpenSpec-style specs are business-analyst-level and single-service; there is no architecture layer, and a business-simple feature can span many services (e.g. 7 new + 4 changed). C4, Gherkin, and specs end up as disconnected documents. `loam` ties them with one feature-ID spine and makes C4 the center.

## Two flows

```
BOOTSTRAP (once per service, reverse):
    code ──adopt──►  C4 baseline + capability spec       [truth = code]

FORWARD (per feature, generative):
    intent → C4 delta → Gherkin (BDD) → tests → code      [truth = model]
                 ▲                                   │
                 └──── done-check: extract ◄─────────┘
                        (C4 from the new code == delta?)
```

The reverse extractor is reused twice: to create the baseline, and at done-time to assert the built code matches the delta — which kills "model fiction".

## Principles

- **Files are the source of truth**; the CLI is a derived convenience. Delete `loam` and every artifact remains as Markdown / LikeC4 DSL / Gherkin. `index.json` is a regenerable cache.
- **Thin, not a platform.** One shared docs repo + a CLI. No server, no DB, no Backstage.
- **Mechanical vs semantic.** Deterministic checks validate *shape* (valid DSL, resolvable IDs, coverage); an LLM writes *narrative* (the docs, the Gherkin behavior).

## MVP commands (pull-based)

| Command | What it does |
|---|---|
| `loam init --docs <dir>` | Point at (and scaffold) the single shared docs repo; write local `loam.json`. |
| `loam adopt --service <id>` | Reverse-engineer this repo's C4 + spec into the docs repo as `draft` for review. |
| `loam delta <FEAT> [--service <id>]` | Project a feature's C4 delta onto a service: what to build here + generated Gherkin. Output doubles as a coding-agent task. |
| `loam validate` | Validate a service's C4 model via LikeC4 (in-process parse + validation). Slice/coverage checks next. |

Status: **early scaffold.** `init` is real; `adopt` / `delta` / `validate` are stubs with documented contracts.

## Prerequisites

- **Node ≥ 20**. That's it — loam is self-contained. C4 modeling uses **[LikeC4](https://likec4.dev)**, a bundled npm dependency (TypeScript-native, in-process): no JVM, no external CLI.

## Dev

```bash
npm install
npm run dev -- --help      # run the CLI from source
npm run build              # compile to dist/
npm test                   # vitest
```
