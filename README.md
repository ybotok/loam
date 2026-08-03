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
| `loam init --docs <dir>` | Point at (and scaffold) the single shared docs repo; write local `loam.json`, `AGENTS.md` and the `/loam-*` slash commands. |
| `loam list [services\|features]` | What is in the docs repo, and what is missing from it. |
| `loam new <FEAT> --title <t>` | Scaffold a feature: intent, C4 delta, a requirement delta per service. Validates clean out of the box. |
| `loam show <service\|FEAT>` | Everything loam knows about one service or feature. |
| `loam adopt --service <id>` | Reverse-engineer this repo's C4 + spec into the docs repo as `draft` for review. |
| `loam delta <FEAT> [--service <id>]` | Project a feature's C4 delta onto a service: what to build here + generated Gherkin. Output doubles as a coding-agent task. |
| `loam validate [--all]` | Validate one service/feature, or the whole fleet in one run (CI gate). |
| `loam archive <FEAT>` | Merge a shipped feature into the living specs, API and landscape; gated on coherence. `--dry-run` prints the plan and writes nothing. |
| `loam unarchive <FEAT>` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature. |

Every command except `archive` takes `--json`: findings carry stable codes (`c4.valid`, `spine.op-undefined`, `coherence.ok` …) so an agent branches on the code, not on prose. The envelope separates `ok` (the command ran) from `valid` (the docs pass). `archive` still speaks only prose — use `--dry-run` to see its plan.

`init` also writes `AGENTS.md` into the docs repo — the process contract, travelling with the thing it describes — and `/loam-feature`, `/loam-implement`, `/loam-check`, `/loam-ship` into `.claude/commands/`. Neither is ever overwritten; `--no-commands` skips the latter.

`archive` is the one command that rewrites the source of truth, so it computes the whole merge before touching disk, commits each file through a temp-file rename, and rolls back what it already swapped if any part fails. It also records the bytes it overwrote inside the archived feature, which is what makes `unarchive` an undo rather than a guess — the previous text of a `MODIFIED` requirement exists nowhere else.

Status: `init`, `list`, `show`, `new`, `delta`, `validate`, `archive` and `unarchive` are implemented. **`adopt` is the remaining stub** — and the one everything else is waiting on.

## Prerequisites

- **Node ≥ 20**. That's it — loam is self-contained. C4 modeling uses **[LikeC4](https://likec4.dev)**, a bundled npm dependency (TypeScript-native, in-process): no JVM, no external CLI.

## Dev

```bash
npm install
npm run dev -- --help      # run the CLI from source
npm run build              # compile to dist/
npm test                   # vitest
```
