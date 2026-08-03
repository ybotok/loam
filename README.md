# loam

Architecture-first spec framework for microservice fleets.

`loam` gets a service's documentation and C4 architecture written **from its code**, then lets you drive cross-service features top-down: you author a **C4 delta**, and `loam` projects it onto each affected service as concrete work + generated Gherkin (BDD) that drives TDD.

> Working name: the tool was sketched in design notes as `featspec`; it lives here as `loam`. Easy to rename.

## Why

OpenSpec-style specs are business-analyst-level and single-service; there is no architecture layer, and a business-simple feature can span many services (e.g. 7 new + 4 changed). C4, Gherkin, and specs end up as disconnected documents. `loam` ties them with one feature-ID spine and makes C4 the center.

## Two flows

```
BOOTSTRAP (once per service, reverse):
    code ──adopt──►  brief ──agent──►  C4 baseline + capability spec   [truth = code]

FORWARD (per feature, generative):
    intent → C4 delta → Gherkin (BDD) → tests → code      [truth = model]
                 ▲                                   │
                 └──── done-check: verify ◄──────────┘
                        (a checklist of the feature's own promises,
                         answered against the code, with evidence)
```

**There is no extractor, and there will not be one.** Nothing deterministic reads a legacy service and says what its architecture *means*, and a model that was guessed is worse than none — everyone downstream has to re-derive it to know whether to believe it. So loam takes the half of the job that is mechanical: it **states the work** and it **checks the result**. An agent does the reading.

The same split runs the done-check. `verify` cannot compare a generated model to the delta (two generated models of the same code disagree every run, so the diff would flap and get switched off), but it *can* derive the question set deterministically: every operation the feature adds, every call it draws, every scenario it wrote. The agent answers each with a `file:line`, and the answers are recorded next to the feature.

## Principles

- **Files are the source of truth**; the CLI is a derived convenience. Delete `loam` and every artifact remains as Markdown / LikeC4 DSL / Gherkin. `index.json` is a regenerable cache.
- **Thin, not a platform.** One shared docs repo + a CLI. No server, no DB, no Backstage.
- **Mechanical vs semantic.** Deterministic checks validate *shape* (valid DSL, resolvable IDs, coverage); an LLM writes *narrative* (the docs, the Gherkin behavior).
- **loam never guesses about code.** It reads the docs repo and nothing else. Where a judgement about a codebase is needed — what this service is, whether that scenario has a test — loam states the **question**, precisely and repeatably, and an agent answers it. Both halves are written down: the question in the brief or the checklist, the answer in `sources` or `verification.yaml`.

## MVP commands (pull-based)

| Command | What it does |
|---|---|
| `loam init --docs <dir>` | Point at (and scaffold) the single shared docs repo; write local `loam.json`, `AGENTS.md` and the `/loam-*` slash commands. |
| `loam list [services\|features]` | What is in the docs repo, and what is missing from it. |
| `loam new <FEAT> --title <t>` | Scaffold a feature: intent, C4 delta, a requirement delta per service. Validates clean out of the box. |
| `loam show <service\|FEAT>` | Everything loam knows about one service or feature. |
| `loam adopt --service <id>` | Brief an agent to write this service's baseline into the docs repo as `draft`: the target paths, the grammar of each, what the landscape already says, the checks that follow — and the ones that do not exist. Writes nothing. |
| `loam delta <FEAT> [--service <id>]` | Project a feature's C4 delta onto a service: what to build here + generated Gherkin. Output doubles as a coding-agent task. |
| `loam validate [<id>] [--all]` | Validate one service or feature — positional id, feature reading first; `--service`/`--feature` force it — or the whole fleet in one run (CI gate). `--strict` exits 1 on warnings too: exit code only, the report and `valid` are unchanged. |
| `loam verify <FEAT>` | The done-check: derive a checklist of the feature's own promises, one stable id each. `--record <answers.json>` takes the answers back and writes `verification.yaml`. |
| `loam vouch --service <id>` | The human promotion `draft` → `verified`: stamp a living spec against the code it was written from. Run in the service's own repo. |
| `loam archive <FEAT>` | Merge a shipped feature into the living specs, API and landscape; gated on gating coherence issues. `--dry-run` prints the plan and writes nothing. |
| `loam unarchive <FEAT>` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature. |

Every command takes `--json`: findings carry stable codes (`c4.valid`, `spine.op-undefined`, `coherence.ok` …) so an agent branches on the code, not on prose. The envelope keeps three different questions apart — `ok` (the command ran), `valid` (the docs pass), `verified` (somebody says the code was built, and showed evidence). `archive --json` carries the whole merge plan, the warnings it is not blocking on, and — on refusal — a stable `error.code`; with `--dry-run` it is the same payload without the writes.

`init` also writes `AGENTS.md` into the docs repo — the process contract, travelling with the thing it describes — and `/loam-adopt`, `/loam-feature`, `/loam-implement`, `/loam-check`, `/loam-verify`, `/loam-ship` into `.claude/commands/`. Neither is ever overwritten; `--no-commands` skips the latter. Running an agent that is not Claude? Point it at `AGENTS.md` in the docs repo — the slash commands are thin wrappers over the CLI, so any runner that can read a file and exec `loam` has everything.

**`verify` does not gate `archive`.** Coherence gates because loam *computed* it from the documents in front of it; a verdict is somebody's word about code loam never read. Putting that in front of shipping would only teach everyone that the cheapest way past a gate is to say yes. `verification.yaml` is written for the reviewer who comes later — it travels into `features/archive/` with the feature, and an `unconfirmed` claim with a note is worth more there than a yes nobody can back up.

The archive gate blocks on **gating issues**. Severity and gating answer two different questions: severity says whether the *document* is valid (`loam validate` fails on errors), gating says whether the *merge* is safe — and they diverge exactly once today: `delta.requirement-not-merged` is a warning (the shape is legal OpenSpec, validate stays green) that gates (the merge would silently drop the requirement). Every `--json` coherence finding carries the resolved `gates` flag. Advisory warnings are printed with the plan and never block, and `--approve` overrides the gating issues alone, naming each one it overrode. Two refusals sit past the gate, at plan time, because only the computed merge can see them: a living requirement outside `## Requirements` (the merge would duplicate it, so not even `--approve` clears that) and an unparseable `delta.likec4` (archiving anyway would silently drop the architecture axis).

`archive` is the one command that rewrites the source of truth, so it computes the whole merge before touching disk, commits each file through a temp-file rename, and rolls back what it already swapped if any part fails. It also records the bytes it overwrote inside the archived feature, which is what makes `unarchive` an undo rather than a guess — the previous text of a `MODIFIED` requirement exists nowhere else.

Status: every command in the table is implemented. Remaining: `render` (diagrams — delegated to LikeC4's own tooling), `health` compose, UI-prototype generation.

## Try it

The repo ships a small example fleet under [`examples/docs/`](examples/docs) — two services, one feature in flight. Point a throwaway `loam.json` at it and run the real commands (the file is untracked; delete it when done):

```bash
npm install
echo '{ "docsDir": "examples/docs" }' > loam.json
npm run dev -- list                          # what the fleet looks like
npm run dev -- validate --all                # the CI gate: 0 errors, 3 deliberate warnings
npm run dev -- archive FEAT-101 --dry-run    # the whole three-axis merge plan, writing nothing
```

`test/examples.test.ts` pins these exact outcomes, so the example cannot drift from the code.

## Docs

- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the decisions behind them: the coherence rules, how `archive` writes and `unarchive` undoes, operating at fleet scale.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam: what maps, what is lost, what must be added.

## Prerequisites

- **Node ≥ 20**. That's it — loam is self-contained. C4 modeling uses **[LikeC4](https://likec4.dev)**, a bundled npm dependency (TypeScript-native, in-process): no JVM, no external CLI.

## Dev

```bash
npm install
npm run dev -- --help      # run the CLI from source
npm run build              # compile to dist/
npm test                   # vitest
```
