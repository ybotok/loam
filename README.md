# loam

**Architecture-first spec framework for microservice fleets.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
![tests](https://img.shields.io/badge/tests-1704%20passing-brightgreen.svg)
<!-- once published: [![CI](https://github.com/OWNER/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/loam/actions/workflows/ci.yml) -->

`loam` gets a service's documentation and C4 architecture written **from its code**, then lets you drive cross-service features top-down: you author a **C4 delta**, `loam` projects it onto each affected service as concrete work, and `loam gherkin` turns the spec's scenarios into real, digest-stamped Gherkin `.feature` files — the acceptance skeleton that drives TDD, kept honest by `loam validate` reporting when the spec moves under it.

## Why

Spec-driven development tools treat specs as business-analyst-level documents in a single repo: there is no architecture layer, and a business-simple feature can span many services (e.g. 7 new + 4 changed). C4 diagrams, Gherkin and specs end up as disconnected documents that drift apart quietly. `loam` ties them with one feature-ID spine and makes C4 the center. And because a business spec will never mention the transactional outbox, architecture gets its own requirement axis — `arch.spec.md`, whose `Covers:` lines tie outbox/retry/alert obligations to the C4 elements and health signals they exercise, with coverage derived mechanically rather than trusted.

## loam vs OpenSpec

loam reads the core of [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s requirement format: requirement/scenario headings and the `ADDED | MODIFIED | REMOVED` delta sections. Routine CI exercises seven representative upstream fixtures; an opt-in sweep reproduces the broader compatibility result against the full living, active and archived spec trees at the pinned OpenSpec v1.7.0 commit — **207 Markdown files, 739 requirements, 2273 scenarios** (the post-release main canary the same sweep pins is 209 / 742 / 2284). The boundary is explicit: OpenSpec `Purpose`, wrapper, and `RENAMED` semantics are not round-trippable.

| | OpenSpec | loam |
|---|---|---|
| System model | capability specs; beta Stores share planning across repos (Git-owned planning roots, read-only references), but model no service topology | C4 landscape + one ID spine across spec / arch / API |
| Executability | `/opsx:verify` asks an agent to inspect implementation and tests; advisory | digest-stamped Gherkin; a green cucumber run confirms a scenario mechanically, and a scenario confirmed on an agent's word instead is recorded as **attested, not verified** (`verify.scenario-attested`) |
| Drift control | structural CLI validation plus agent-led verification on demand; no persisted digests to compare against later | persisted source/content digests + human vouch. `content.stale` is checkable fleet-wide; `sources.stale` only inside each service's own repo. Both are warnings — `--strict` is the CI escalation |
| Change merge | validates prepared requirement updates, supports `RENAMED`, then writes specs sequentially | transactional 3-axis merge behind a coherence gate, digest-checked byte-level undo, and a commit journal that repairs an interrupted merge |
| Agent surface | skills + commands for 34 tools (v1.7.0); `openspec update` regenerates them in place, skipping ones already current | skills + commands for 20 tools; `--json` on every command; generated files carry a version stamp and are **never** regenerated — drift is reported (`doctor.agent-files-stale`) and repaired by hand |
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

The same split runs the done-check. `verify` cannot compare a generated model to the delta (two generated models of the same code disagree every run, so the diff would flap and get switched off), but it *can* derive the question set deterministically: every operation the feature adds, every call it draws, every scenario it wrote. The agent answers with a `file:line`, and every answer is recorded next to the feature, marked with who gave it (`answered_by: runner` or `answered_by: agent`).

**The scenario claims are where that mark carries weight.** The generated suite's digest tags ride into the cucumber JSON report, so `verify --results` answers a `scenario.tested` claim mechanically: only a green, digest-matched run confirms one, and names never match anything. But a legacy service with no runnable suite yet must still be able to record its answers, so `--record` may confirm a scenario claim too — on somebody's word. loam does not pretend those are the same thing. A record holding any of them reads back as **`verdict: "attested"`**, never `verified`; `verify` prints `verify.scenario-attested` naming each claim, `loam status` re-reports it and offers `next.verify-attested`, and the record travels into `features/archive/` saying so. `verified: true` in the JSON envelope means every scenario claim came from a test run.

## Principles

- **Files are the source of truth**; the CLI is a derived convenience. Delete `loam` and every artifact remains as Markdown / LikeC4 DSL / Gherkin.
- **Thin, not a platform.** One shared docs repo + a CLI. No server, no DB, no Backstage.
- **Mechanical vs semantic.** Deterministic checks validate *shape* (valid DSL, resolvable IDs, coverage); an LLM writes *narrative* (the docs, the Gherkin behavior).
- **loam never guesses about code.** It reads the docs repo and nothing else. Where a judgement about a codebase is needed — what this service is, whether that scenario has a test — loam states the **question**, precisely and repeatably, and an agent answers it. Both halves are written down: the question in the brief or the checklist, the answer in `sources` or `verification.yaml`.

## Commands

| Command | What it does |
|---|---|
| `loam init --docs <dir> [--service <id>]` | Bind this repository to the single shared docs repo: write a committed local `loam.json`, plus `AGENTS.md` and, for every AI tool it detects in this repo, both a slash command and an Agent Skill per workflow (`--tools <ids>\|all` overrides the scan; `--no-commands` / `--no-skills` drop one delivery). `--docs` **joins** an existing docs repo; `--create` is required to make a new one, so a mistyped path cannot scaffold a second source of truth. `--service <id>` is what a **service** repo needs: it is the binding `vouch`, `gherkin` and `verify --service` require before they will speak for that service. `docsDir` is stored exactly as you typed it and resolved against `loam.json`, so a relative `../docs-repo` works on every clone — and `--docs` wins only when you actually pass it, so a re-run in a wired repo keeps the pointer its committed `loam.json` already spells, `--create` included (`docsDirSource: "flag" \| "config" \| "default"` in `--json` says which). |
| `loam list [services\|features]` | What is in the docs repo, and what is missing from it. |
| `loam status [<FEAT>]` | Where the work stands and what to do next — the question an agent has when it joins a repo halfway or loses its session. Artifacts come back `missing`/`blocked`/`draft`/`ready`/`done`, and `next[]` is ordered, each entry a stable code plus the literal command. It is a **projection over the two gates**, taking the union of what `validate --feature` errors on and what `archive` refuses to merge, so it may be redder than either and is never greener than both. Derived every run from the files; there is no state file to go stale. Writes nothing. |
| `loam doctor` | Read-only preflight for runtime, config, docs-repo access, fleet roots, counts, and the current service binding. Blockers exit 1; incomplete optional bindings stay warnings. |
| `loam dependencies [<FEAT>]` | Derive the active-feature dependency graph and same-identity conflicts from requirement deltas and OpenAPI operationIds. Optional focus includes transitive prerequisites. |
| `loam new <FEAT> --title <t>` | Scaffold a feature: intent, C4 delta, a requirement delta per service. The scaffold passes `loam validate --feature` with **zero errors**; the one warning left standing is the `owner` you have to fill in yourself, and a requirements-only feature deletes the scaffolded `delta.likec4`. |
| `loam show <service\|FEAT>` | Everything loam knows about one service or feature. |
| `loam adopt --service <id>` | Brief an agent to write this service's baseline into the docs repo as `draft`: the target paths, the grammar of each, what the landscape already says, the checks that follow — and the ones that do not exist. Writes nothing. |
| `loam delta <FEAT> [--service <id>]` | Project a feature onto one service: the intent, its requirement deltas with every requirement body and every Given/When/Then line reproduced verbatim, the endpoints it adds or retires, and the edges around it. Output doubles as a coding-agent task. |
| `loam gherkin [<FEAT>] [--service <id>]` | Emit spec scenarios as Gherkin `.feature` files into the service repo's `<gherkinDir>/loam/` — a feature's changed requirements, or (without a feature) the full living suite. Deterministic, digest-stamped, regeneration-owned; run in the service's own repo. |
| `loam rebase <FEAT> [--service <id>]` | Pin the feature to the living versions it was written against: `Based-On:` on every MODIFIED/REMOVED requirement, `x-loam-based-on` on every operation in the contract delta. On the requirement axis that stops a second feature rewriting the same requirement from landing on top of the first in silence; on the contract axis it also marks the rest of the delta as **quotation** — an openapi.yaml is a complete document, so without the pin the merge upserts operations you only restated and reverts whatever landed on them. `--dry-run` shows what would be pinned. Restamping is the last step of resolving a collision, not the resolution — the output says which pins moved. |
| `loam validate [<id>] [--all]` | Validate one service or feature, or the whole fleet in one run (CI gate). `--strict` exits 1 on warnings too. |
| `loam verify <FEAT> [--service <id>]` | The done-check: derive a checklist of the feature's own promises. `--results <report.json>` answers the scenario claims from a cucumber JSON run — digest-matched, so only a green run confirms one, and the record writes down which file it read (path, sha256, mtime); `--record <answers.json>` takes the agent's answers, refusing anything unevidenced, and a scenario claim answered that way makes the record `attested` rather than `verified`. A cross-service feature is recorded **once per service repo** with `--service <id>`, each run adding its own commit-bound attestation to one shared record; the `--service`-less `--record` form writes the whole record from one place and is refused (`record-federated`) once anyone else has attested. |
| `loam vouch --service <id>` | The human promotion `draft` → `verified`: stamp a living spec against the code it was written from. Run in the service's own repo. |
| `loam archive <FEAT>` | Merge a shipped feature into the living specs, API and landscape; gated on gating coherence issues. `--dry-run` prints the plan and writes nothing. |
| `loam unarchive <FEAT>` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature. It refuses rather than guesses — `snapshot-stale` when a merged file moved since (`--force` says that was meant), and `snapshot-corrupt` when a pre-image no longer hashes to what the archive recorded for it, which `--force` deliberately does **not** override: the damage there is to the undo itself. |
| `loam audit-openspec <root>` | Read-only inventory of an OpenSpec checkout/workspace/Store checkout: capabilities, active and archived changes, counts, RENAMED and unsupported shapes, and every capability→service decision still needing a human. Writes nothing; `--write-mapping <path>` emits the decision skeleton you fill in. |
| `loam migrate-openspec <root> --map <path>` | Validate a completed mapping against a re-read of the source, and with `--apply --target <empty-dir>` materialize **staged migration docs** into a separate directory. `--map` is required — there is no one-shot form. Dry-run is the default. |

Every command takes `--json`: findings carry stable codes (`c4.valid`, `spine.op-undefined`, `coherence.ok` …) so an agent branches on the code, not on prose. The envelope keeps three different questions apart — `ok` (the command ran), `valid` (the docs pass), `verified` (every claim is confirmed **and** every scenario claim came from a test run; `verdict` carries the third state, `attested`, for a record whose scenarios rest on an agent's word).

`archive` is the one command that rewrites the source of truth, so it takes an advisory lock on the docs repo for the whole plan-and-commit (a second one refuses with `docs-busy` rather than interleaving), computes the whole merge before touching disk, commits each file through a temp-file rename after re-checking the bytes it read, and rolls back what it already swapped if any part fails. It also records the bytes it overwrote inside the archived feature — with a digest of each pre-image, so `unarchive` can tell an intact one from an edited one — which is what makes `unarchive` an undo rather than a guess. A process **killed mid-commit** is covered too: an intent journal (`.loam-commit`) is fsynced before the first swap, and the next `archive`/`unarchive` recovers from it under the lock, putting half-written files back from the snapshot, or refusing with `commit-interrupted` when a file has been edited since. `loam doctor` reports that state rather than calling the repo healthy. loam's docs files must be **UTF-8**: undecodable bytes refuse the merge (`merge-failed`, naming the file) instead of being rewritten as U+FFFD, and a non-UTF-8 `openapi.yaml` grades `openapi.invalid`. **`verify` does not gate `archive`** — coherence gates because loam *computed* it; a verdict is somebody's word about code loam never read, and a gate in front of shipping only teaches everyone that the cheapest way past it is to say yes.

API retirement is explicit and reviewable: a feature marks the exact path/method operation with `x-loam-remove: true` — **inside the operation being retired, beside its `operationId`** — and removes the governing requirement in the same delta. A marker written one level up, at path level beside the methods, addresses no operation and retires nothing; archive refuses it (`openapi.remove-marker-path-level`) rather than publishing a meaningless key into the fleet's living contract. Validation refuses stale, mismatched, or unjustified markers; archive deletes the method without persisting the marker or garbage-collecting components, and reports the removals in both text and JSON. See [SCHEMA.md](SCHEMA.md) for the lifecycle contract.

## Working with AI agents

`loam init` writes `AGENTS.md` into the docs repo — the process contract, travelling with the thing it describes — and the six workflow bodies (`loam-adopt`, `loam-feature`, `loam-implement`, `loam-check`, `loam-verify`, `loam-ship`) into the repo it runs in, **twice each**: as a slash command in the tool's own command directory, which you type, and as an Agent Skill at `<tool-dir>/skills/loam-<x>/SKILL.md`, which the model loads by itself when the task matches the skill's description. One shared body, a thin per-tool wrapper; `--no-commands` and `--no-skills` each suppress one delivery.

Which tools is detected from the repo: `init` scans for the dot-directories of the 20 tools it knows — Claude Code, Cursor, GitHub Copilot, Gemini CLI, opencode, Cline, Amazon Q, Antigravity, Auggie, Codex, Continue, Crush, Devin, Factory, Junie, Kilo Code, Kiro, Qwen, Roo Code, Trae — writes for the ones it finds, and falls back to Claude Code when it finds none. `--tools <ids>|all` overrides the scan; an unknown id is refused, not skipped. What it wrote for is recorded in `loam.json` as `agentTools`, which is how `loam doctor` reports a command or skill file that a newer loam would lay down (`doctor.agent-files-missing`) without mistaking a tool nobody selected for one that fell behind — and a repo that asked for one delivery only (`--no-skills`, `--no-commands`) is not reported as missing the other.

**Nothing is ever overwritten and nothing is ever refreshed**, and that is the whole difference from `openspec update`: your edits to a generated file outrank the template, so drift is reported and never repaired. To make that reportable at all, every generated command and skill body opens with `<!-- generated by loam vX.Y.Z -->`; `loam doctor` reads **only that line** and raises `doctor.agent-files-stale` for a file carrying no stamp or an older one. It never compares bodies — "your file differs from the template" is one step from offering to rewrite it. The fix is a human's: read the file, then bump the stamp, or delete it and re-run `loam init`. The AGENTS.md version stamp (`agents.stale`) works the same way. Running a tool loam has no adapter for? Point it at `AGENTS.md` — the commands are thin wrappers over the CLI, so any runner that can read a file and exec `loam` has everything.

## Fleet scale

One docs repo, a hundred services, many teams: the docs repo bootstraps itself with `loam init --docs . --create`, ownership is CODEOWNERS, `vouch` and `archive` land through reviewed PRs, provenance runs in each service repo's own CI, and `loam list --json` grades every service on a presence-honest maturity ladder (`empty → partial → documented → sourced → vouched`). The full operating model — including `loam.json` per repo, the federated verification record, the per-service CI summary contract and the one-landscape decision — is in [SCHEMA.md](SCHEMA.md).

The shape that has been measured, on a generated 120-service fleet with 400 and 800 op-linked landscape edges (compiled binary, 8-core laptop, wall clock including Node startup): `loam list --json` **1.1–1.5 s**, and `loam validate --service <id> --json` — the command each service repo's CI runs — **1.4–1.6 s** at either edge count. The fleet gate is the outlier: `loam validate --all --json` over the same 120 services takes **~30 s**, because it parses a fresh LikeC4 workspace per service rather than sharing one. That is a known cost, not a mystery; it is the docs repo's own CI job and it is not on anybody's inner loop.

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
npm test                   # vitest, 1704 tests across 64 files
npm run test:coverage      # full src/**/*.ts coverage with enforced thresholds
npm run test:package       # clean, pack, install the tarball, run its loam binary
# optional, against the exact upstream checkout named above (the flag matters:
# --baseline defaults to canary, and the sweep refuses a checkout at any other HEAD):
npm run test:openspec-corpus -- --baseline release /path/to/OpenSpec
```

## Status

Every command in the table is implemented, `verify --results` included — the generated suite's cucumber report feeds the done-check, closing the TDD loop mechanically. Remaining: `render` (diagrams — delegated to LikeC4's own tooling), `health` compose, UI-prototype generation.

The release-candidate manifest is `@spentsov/loam@0.1.0-beta.1`: the unscoped `loam` name is already an unrelated GDAL wrapper, while `spentsov` is the author identity in this repository's git history. The registry currently has no package at that scoped name, but absence does **not** prove scope ownership; publishing still requires an npm account that controls `@spentsov`. Until that is confirmed, use the repository setup above rather than treating the package as published.

## License

[MIT](LICENSE)
