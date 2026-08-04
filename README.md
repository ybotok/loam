# loam

**Architecture-first spec framework for microservice fleets.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
![tests](https://img.shields.io/badge/tests-1399%20passing-brightgreen.svg)
<!-- once published: [![CI](https://github.com/OWNER/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/loam/actions/workflows/ci.yml) -->

`loam` gets a service's documentation and C4 architecture written **from its code**, then lets you drive cross-service features top-down: you author a **C4 delta**, `loam` projects it onto each affected service as concrete work, and `loam gherkin` turns the spec's scenarios into real, digest-stamped Gherkin `.feature` files — the acceptance skeleton that drives TDD, kept honest by `loam validate` reporting when the spec moves under it.

## Why

Spec-driven development tools treat specs as business-analyst-level documents in a single repo: there is no architecture layer, and a business-simple feature can span many services (e.g. 7 new + 4 changed). C4 diagrams, Gherkin and specs end up as disconnected documents that drift apart quietly. `loam` ties them with one feature-ID spine and makes C4 the center. And because a business spec will never mention the transactional outbox, architecture gets its own requirement axis — `arch.spec.md`, whose `Covers:` lines tie outbox/retry/alert obligations to the C4 elements and health signals they exercise, with coverage derived mechanically rather than trusted.

## loam vs OpenSpec

loam reads the core of [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s requirement format: requirement/scenario headings and the `ADDED | MODIFIED | REMOVED` delta sections. Routine CI exercises seven representative upstream fixtures; an opt-in sweep reproduces the broader compatibility result against all 157 Markdown files in the living and archived spec trees at the pinned OpenSpec v1.7.0 commit. The boundary is explicit: OpenSpec `Purpose`, wrapper, and `RENAMED` semantics are not round-trippable.

| | OpenSpec | loam |
|---|---|---|
| System model | capability specs; beta Stores can share planning across repos, but do not model service topology | C4 landscape + one ID spine across spec / arch / API |
| Executability | `/opsx:verify` asks an agent to inspect implementation and tests; advisory | digest-stamped Gherkin; a scenario is "tested" only on a green run |
| Drift control | structural CLI validation plus agent-led verification on demand | persisted source/content digests + human vouch; `sources.stale` / `content.stale` fleet-wide |
| Change merge | validates prepared requirement updates, supports `RENAMED`, then writes specs sequentially | transactional 3-axis merge behind a coherence gate, byte-level undo |
| Entry curve | minutes | you learn LikeC4 + frontmatter + the operationId spine first |

Honest boundary: for a single repo without cross-service contracts, OpenSpec is simpler *and sufficient*. The full comparison — including what loam deliberately refuses to borrow — is in [COMPARISON.md](COMPARISON.md); migration is covered by [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md).

## Quick start

```bash
git clone <this repo> && cd loam
./scripts/setup.sh          # checks node >= 22.22.3, npm ci, build, smoke-test
```

(`./scripts/setup.sh --link` also `npm link`s a global `loam`; on Windows run `npm ci && npm run build` by hand.)

The repo ships a small example fleet under [`examples/docs/`](examples/docs) — two services, one feature in flight. Point a throwaway `loam.json` at it and run the real commands (the file is untracked; delete it when done):

```bash
echo '{ "docsDir": "examples/docs" }' > loam.json   # relative, resolved against this file
npm run dev -- list                          # what the fleet looks like
npm run dev -- validate --all                # the CI gate: 0 errors, 3 deliberate warnings
npm run dev -- archive FEAT-101 --dry-run    # the whole three-axis merge plan, writing nothing
```

`test/examples.test.ts` pins these exact outcomes, so the example cannot drift from the code.

## Day zero: onboarding a fleet

A fleet of ten services is **eleven repositories**: one docs repo and ten service repos, each with its own committed `loam.json`. There is no batch command and no fleet manifest, deliberately — the wiring is one file per repo, and it is reviewable. In order:

1. **Create the docs repo.** In an empty directory that will be the shared source of truth:

   ```bash
   loam init --docs . --create
   ```

   That scaffolds `services/`, `features/`, `architecture/landscape.likec4`, `AGENTS.md`, and the docs repo's own `loam.json` (`{"docsDir": "."}`) — so every later command run *inside* the docs repo finds the fleet. Commit it.

2. **Draw what you already know** in `architecture/landscape.likec4`. It can start almost empty; it is a **required** artifact, not an optional one — `loam validate --all` reports `landscape.missing` as an error the moment `services/` holds anything, because with no fleet map every cross-service check is blind rather than passing.

3. **Bind each service repo.** Once per service, in that service's own checkout, beside the docs repo:

   ```bash
   loam init --docs ../docs-repo --service payment-service   # no --create: it JOINS
   loam doctor                                               # confirms the wiring
   ```

   `--service` is the binding: without it `loam vouch`, `loam gherkin` and `loam verify --service` refuse, because none of them will write a service's documents from a repo that has not said which service it is. Commit the `loam.json`.

4. **Adopt each service.** In its repo: `loam adopt --service <id> --json` emits the brief — every file to write, the grammar of each, what the fleet map already says, and the block the map still owes this service. An agent reads the code and writes the baseline as `draft`. `warnings[]` catches the typo case, where an id one letter off would have produced a complete, validating baseline for a service that does not exist.

5. **Grade it, twice.** `loam validate --service <id> --json` in the service repo (its own axes plus `sources`, which only that repo can resolve), then `loam validate --all --json` in the docs repo — the fleet cross-check that catches a landscape edit which never landed.

6. **Promote it.** A human runs `loam vouch --service <id>` in the service repo: `draft → verified`, stamping the source and content digests that make later staleness detectable. `loam list --json` in the docs repo then grades the whole fleet on the presence ladder `empty → partial → documented → sourced → vouched`, and `loam list --needs-work` is the remaining worklist.

Steps 3–6 repeat per service and are independent, so ten services can be onboarded by ten people in parallel; only step 2's landscape and step 5's `--all` are shared.

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

The same split runs the done-check. `verify` cannot compare a generated model to the delta (two generated models of the same code disagree every run, so the diff would flap and get switched off), but it *can* derive the question set deterministically: every operation the feature adds, every call it draws, every scenario it wrote. The scenario claims do not even take an agent's word — the generated suite's digest tags ride into the cucumber JSON report, and `verify --results` confirms a scenario only from a green run. The agent answers the rest with a `file:line`, and every answer is recorded next to the feature, marked with who gave it.

## Principles

- **Files are the source of truth**; the CLI is a derived convenience. Delete `loam` and every artifact remains as Markdown / LikeC4 DSL / Gherkin.
- **Thin, not a platform.** One shared docs repo + a CLI. No server, no DB, no Backstage.
- **Mechanical vs semantic.** Deterministic checks validate *shape* (valid DSL, resolvable IDs, coverage); an LLM writes *narrative* (the docs, the Gherkin behavior).
- **loam never guesses about code.** It reads the docs repo and nothing else. Where a judgement about a codebase is needed — what this service is, whether that scenario has a test — loam states the **question**, precisely and repeatably, and an agent answers it. Both halves are written down: the question in the brief or the checklist, the answer in `sources` or `verification.yaml`.

## Commands

| Command | What it does |
|---|---|
| `loam init --docs <dir> [--service <id>]` | Bind this repository to the single shared docs repo: write a committed local `loam.json`, plus `AGENTS.md` and slash-command wrappers for your AI tools (`--tools claude,cursor,…\|all`). `--docs` **joins** an existing docs repo; `--create` is required to make a new one, so a mistyped path cannot scaffold a second source of truth. `--service <id>` is what a **service** repo needs: it is the binding `vouch`, `gherkin` and `verify --service` require before they will speak for that service. `docsDir` is stored exactly as you typed it and resolved against `loam.json`, so a relative `../docs-repo` works on every clone. |
| `loam list [services\|features]` | What is in the docs repo, and what is missing from it. |
| `loam doctor` | Read-only preflight for runtime, config, docs-repo access, fleet roots, counts, and the current service binding. Blockers exit 1; incomplete optional bindings stay warnings. |
| `loam dependencies [<FEAT>]` | Derive the active-feature dependency graph and same-identity conflicts from requirement deltas and OpenAPI operationIds. Optional focus includes transitive prerequisites. |
| `loam new <FEAT> --title <t>` | Scaffold a feature: intent, C4 delta, a requirement delta per service. The scaffold passes `loam validate --feature` with **zero errors**; the one warning left standing is the `owner` you have to fill in yourself, and a requirements-only feature deletes the scaffolded `delta.likec4`. |
| `loam show <service\|FEAT>` | Everything loam knows about one service or feature. |
| `loam adopt --service <id>` | Brief an agent to write this service's baseline into the docs repo as `draft`: the target paths, the grammar of each, what the landscape already says, the checks that follow — and the ones that do not exist. Writes nothing. |
| `loam delta <FEAT> [--service <id>]` | Project a feature onto one service: the intent, its requirement deltas with every requirement body and every Given/When/Then line reproduced verbatim, the endpoints it adds or retires, and the edges around it. Output doubles as a coding-agent task. |
| `loam gherkin [<FEAT>] [--service <id>]` | Emit spec scenarios as Gherkin `.feature` files into the service repo's `<gherkinDir>/loam/` — a feature's changed requirements, or (without a feature) the full living suite. Deterministic, digest-stamped, regeneration-owned; run in the service's own repo. |
| `loam rebase <FEAT> [--service <id>]` | Pin the feature to the living versions it was written against: `Based-On:` on every MODIFIED/REMOVED requirement, `x-loam-based-on` on every operation in the contract delta. On the requirement axis that stops a second feature rewriting the same requirement from landing on top of the first in silence; on the contract axis it also marks the rest of the delta as **quotation** — an openapi.yaml is a complete document, so without the pin the merge upserts operations you only restated and reverts whatever landed on them. `--dry-run` shows what would be pinned. Restamping is the last step of resolving a collision, not the resolution — the output says which pins moved. |
| `loam validate [<id>] [--all]` | Validate one service or feature, or the whole fleet in one run (CI gate). `--strict` exits 1 on warnings too. |
| `loam verify <FEAT> [--service <id>]` | The done-check: derive a checklist of the feature's own promises. `--results <report.json>` answers the scenario claims from a cucumber JSON run — digest-matched, so only a green run confirms one; `--record <answers.json>` takes the agent's answers for the rest, refusing anything unevidenced. A cross-service feature is recorded **once per service repo** with `--service <id>`, each run adding its own commit-bound attestation to one shared record; the `--service`-less `--record` form writes the whole record from one place and is refused (`record-federated`) once anyone else has attested. |
| `loam vouch --service <id>` | The human promotion `draft` → `verified`: stamp a living spec against the code it was written from. Run in the service's own repo. |
| `loam archive <FEAT>` | Merge a shipped feature into the living specs, API and landscape; gated on gating coherence issues. `--dry-run` prints the plan and writes nothing. |
| `loam unarchive <FEAT>` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature. |
| `loam migrate-openspec <root>` | Strict dry-run inventory of an OpenSpec checkout/workspace: capabilities, active/archive changes, counts, RENAMED/unsupported shapes, and capability→service decisions still needing a human. |

Every command takes `--json`: findings carry stable codes (`c4.valid`, `spine.op-undefined`, `coherence.ok` …) so an agent branches on the code, not on prose. The envelope keeps three different questions apart — `ok` (the command ran), `valid` (the docs pass), `verified` (somebody says the code was built, and showed evidence).

`archive` is the one command that rewrites the source of truth, so it takes an advisory lock on the docs repo for the whole plan-and-commit (a second one refuses with `docs-busy` rather than interleaving), computes the whole merge before touching disk, commits each file through a temp-file rename after re-checking the bytes it read, and rolls back what it already swapped if any part fails. It also records the bytes it overwrote inside the archived feature, which is what makes `unarchive` an undo rather than a guess. **`verify` does not gate `archive`** — coherence gates because loam *computed* it; a verdict is somebody's word about code loam never read, and a gate in front of shipping only teaches everyone that the cheapest way past it is to say yes.

API retirement is explicit and reviewable: a feature marks the exact path/method operation with `x-loam-remove: true` and removes the governing requirement in the same delta. Validation refuses stale, mismatched, or unjustified markers; archive deletes the method without persisting the marker or garbage-collecting components, and reports the removals in both text and JSON. See [SCHEMA.md](SCHEMA.md) for the lifecycle contract.

## Working with AI agents

`loam init` writes `AGENTS.md` into the docs repo — the process contract, travelling with the thing it describes — and slash-command wrappers (`/loam-adopt`, `/loam-feature`, `/loam-implement`, `/loam-check`, `/loam-verify`, `/loam-ship`) for the tools you pick with `--tools`: **Claude Code, Cursor, GitHub Copilot, Gemini CLI, opencode, Cline** — one shared command body, a thin per-tool wrapper, never overwriting existing files. Running anything else? Point it at `AGENTS.md` — the slash commands are thin wrappers over the CLI, so any runner that can read a file and exec `loam` has everything.

## Fleet scale

One docs repo, a hundred services, many teams: the docs repo bootstraps itself with `loam init --docs . --create`, ownership is CODEOWNERS, `vouch` and `archive` land through reviewed PRs, provenance runs in each service repo's own CI, and `loam list --json` grades every service on a presence-honest maturity ladder (`empty → partial → documented → sourced → vouched`). The full operating model — including `loam.json` per repo, the federated verification record, the per-service CI summary contract and the one-landscape decision — is in [SCHEMA.md](SCHEMA.md).

## Docs

- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the decisions behind them: the coherence rules, how `archive` writes and `unarchive` undoes, operating at fleet scale.
- [COMPARISON.md](COMPARISON.md) — loam vs OpenSpec, honestly: six axes, when OpenSpec is enough, what loam refuses to borrow.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam: what maps, what is lost, what must be added.

## Prerequisites

- **Node ≥ 22.22.3** (the `engines` floor in `package.json`; `scripts/setup.sh` checks it). That's it — loam is self-contained. C4 modeling uses **[LikeC4](https://likec4.dev)** (pinned exact), a bundled npm dependency (TypeScript-native, in-process): no JVM, no external CLI.

## Dev

```bash
npm run setup              # or: npm ci && npm run build
npm run dev -- --help      # run the CLI from source
npm run lint
npm run typecheck
npm test                   # vitest, ~1100 tests
npm run test:coverage      # full src/**/*.ts coverage with enforced thresholds
npm run test:package       # clean, pack, install the tarball, run its loam binary
# optional, against the exact upstream checkout documented below:
npm run test:openspec-corpus -- /path/to/OpenSpec
```

## Status

Every command in the table is implemented, `verify --results` included — the generated suite's cucumber report feeds the done-check, closing the TDD loop mechanically. Remaining: `render` (diagrams — delegated to LikeC4's own tooling), `health` compose, UI-prototype generation.

The release-candidate manifest is `@spentsov/loam@0.1.0-beta.1`: the unscoped `loam` name is already an unrelated GDAL wrapper, while `spentsov` is the author identity in this repository's git history. The registry currently has no package at that scoped name, but absence does **not** prove scope ownership; publishing still requires an npm account that controls `@spentsov`. Until that is confirmed, use the repository setup above rather than treating the package as published.

## License

[MIT](LICENSE)
