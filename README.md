# loam

**Architecture-first spec framework for microservice fleets.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
[![CI](https://github.com/ybotok/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/ybotok/loam/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ybotok/loam.svg)](https://www.npmjs.com/package/@ybotok/loam)

> **Pre-release: `0.1.0-beta.3`**, the latest published npm version of [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam). `main` is ahead under `[Unreleased]`; do not treat a tarball built from it as beta.3. See [Status](#status).

`loam` briefs an agent to document an existing service **by reading its code**, then checks the resulting C4, requirements and contracts without pretending to extract their meaning itself. Forward changes start from an authored C4 delta: `loam` projects it onto each affected service, generates digest-stamped Gherkin, and checks that behavior, architecture, APIs, events and authorization vocabulary still join.

## Contents

- [Why](#why) · [Install](#install) · [Quick start](#quick-start) · [loam vs OpenSpec](#loam-vs-openspec)
- [Day zero: onboarding a fleet](#day-zero-onboarding-a-fleet) · [Two flows](#two-flows) · [Principles](#principles)
- [Commands](#commands) · [Command notes](#command-notes) · [Working with AI agents](#working-with-ai-agents) · [Fleet scale](#fleet-scale)
- [Docs](#docs) · [Development](#development) · [Status](#status) · [Roadmap](ROADMAP.md) · [Contributing](#contributing) · [Security](#security) · [License](#license)

## Why

Spec-driven development tools often stop at behavior, while a business-simple feature can span many services and fail at their edges. C4 diagrams, Gherkin, API contracts and permissions then become disconnected documents that drift quietly. `loam` makes C4 the center and checks explicit joins: feature tags, service bindings, `Operations:` ↔ OpenAPI `operationId`, `Publishes:`/`Consumes:` ↔ AsyncAPI messages, `Covers:` ↔ C4/health, and `Requires:` ↔ the fleet authorization vocabulary. Architecture has its own requirement axis (`arch.spec.md`) because a business spec will not mention the transactional outbox, retries or alerts.

## Install

**Node ≥ 22.22.3** (the `engines` floor in `package.json`) is the only prerequisite for everything loam derives from the docs repo. C4 modeling uses **[LikeC4](https://likec4.dev)** (pinned exact), an ordinary npm runtime dependency loaded in-process (TypeScript-native): no JVM, no external CLI. The one outside binary loam ever calls is **`git`**, and only inside a service repo — `verify --service` binds each attestation to that repo's HEAD and refuses (`repository-unavailable`) without one, while `vouch`'s source digest asks `git check-ignore` and treats an absent git as "nothing is ignored" rather than failing.

```bash
npm install -g @ybotok/loam
loam --version
```

`loam doctor` is the wiring check, not the install check: run where no `loam.json` is in scope, it reports `doctor.config-missing` and exits 1 by design. Save it for after `loam init`.

A per-repo dev dependency works the same way: `npm i -D @ybotok/loam`, then `npx loam …`.

To work on loam itself — or to run an unreleased commit — install from a clone:

```bash
git clone https://github.com/ybotok/loam.git && cd loam
./scripts/setup.sh --link     # checks node >= 22.22.3, npm ci, build, smoke-test, npm link
```

Drop `--link` to build without a global `loam`; on Windows run `npm ci && npm run build` by hand.

## Quick start

The repo ships a runnable example fleet under [`examples/docs/`](https://github.com/ybotok/loam/tree/main/examples/docs) — five services, one feature already shipped, two in flight, the event spine, the permission vocabulary and a verification record. [`examples/README.md`](https://github.com/ybotok/loam/blob/main/examples/README.md) is the guided tour: what each service is there to show, and what every one of the seven deliberate warnings demonstrates. From a clone, point a throwaway `loam.json` at it and run the real commands (the file is untracked; delete it when done):

```bash
echo '{ "docsDir": "examples/docs" }' > loam.json   # relative, resolved against this file
npm run dev -- list                          # the fleet and its maturity ladder
npm run dev -- status                        # what to do next, derived from the files
npm run dev -- validate --all                # the CI gate: 0 errors, 7 deliberate warnings
npm run dev -- archive FEAT-101 --dry-run    # the whole three-axis merge plan, writing nothing
npm run dev -- archive FEAT-112 --dry-run    # an operation being retired, writing nothing
npm run dev -- verify FEAT-088               # a shipped feature's done-check, frozen history
```

`test/examples.test.ts` pins the validate summary and every finding code, and both archive plans file-for-file, so those outcomes cannot drift from the code; the `list` rendering is not pinned.

To wire loam into your own repositories, start at [Day zero](#day-zero-onboarding-a-fleet).

## loam vs OpenSpec

The product reference and the compatibility pin are now the same release: [OpenSpec v1.9.0](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.9.0), published 2026-08-13, which was also the tip of `main` when this was pinned. Parser and migration compatibility are measured against its reproducible corpus — 211 Markdown files, 746 requirements and 2317 scenarios, swept file by file — with the v1.7.0 release and a post-v1.7 canary kept as regression pins. What that certifies is the Markdown boundary and the staged migration; loam does not reimplement OpenSpec's validation, archive recovery, capability retirement, Stores or agent delivery, and `audit-openspec` inventories those shapes rather than converting them.

| | OpenSpec v1.9 | loam |
|---|---|---|
| System model | capability specs; beta Stores provide Git-owned planning roots and read-only references, but no service discovery or task routing | C4 topology + checked joins across behavior, architecture, OpenAPI, AsyncAPI and permissions |
| Executability | `/opsx:verify` asks an agent to inspect completeness, correctness and coherence; useful, advisory and not persisted as an archive gate | digest-stamped Gherkin; a digest-matched passing report confirms the record mechanically, while execution provenance remains outside loam's proof. Agent answers are **attested, not verified** |
| Drift control | structural CLI validation plus agent-led verification on demand; no persisted digests to compare against later | persisted source/content digests + human vouch. `content.stale` is checkable fleet-wide; `sources.stale` only inside each service's own repo. Both are warnings — `--strict` is the CI escalation |
| Change merge | robust spec-delta archive with destination reservation, scenario-loss guards and restoration on failure | transactional multi-axis merge, digest-checked byte undo, journal recovery and `unarchive` |
| Agent surface | very broad vendor-specific and shared `.agents` integrations; generated assets can be refreshed with `openspec update`; JSON is useful but has several envelope and naming conventions | 20 adapters; one stable v1.0 JSON envelope and stable codes on every command; generated files are never overwritten, so drift requires review |
| Entry curve | minutes | you learn LikeC4 + frontmatter + the operationId spine first |

Honest boundary: for a single repo without cross-service contracts, OpenSpec is simpler *and sufficient*. The full comparison — including what loam deliberately refuses to borrow — is in [COMPARISON.md](COMPARISON.md); migration is covered by [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md).

## Day zero: onboarding a fleet

A fleet of ten services is **eleven repositories**: one docs repo and ten service repos, each with its own committed `loam.json`. There is no batch command and no fleet manifest, deliberately — the wiring is one file per repo, and it is reviewable. In order:

1. **Create the docs repo.** In an empty directory that will be the shared source of truth:

   ```bash
   loam init --docs . --create
   ```

   That scaffolds `services/`, `features/`, `architecture/landscape.likec4`, `AGENTS.md`, and the docs repo's own `loam.json` (`docsDir: "."`, plus the `agentTools` it wrote for) — so every later command run *inside* the docs repo finds the fleet. An empty directory holds no tool dot-directory to detect, so the Claude Code fallback always fires here too: six slash commands and six Agent Skills under `.claude/` ([Working with AI agents](#working-with-ai-agents)). Commit all of it.

2. **Draw what you already know** in `architecture/landscape.likec4`. It can start almost empty; it is a **required** artifact, not an optional one — `loam validate --all` reports `landscape.missing` as an error the moment `services/` holds a directory (an empty one counts, before a single document lands in it), because with no fleet map every cross-service check is blind rather than passing.

3. **Bind each service repo.** Once per service, in that service's own checkout, beside the docs repo:

   ```bash
   loam init --docs ../docs-repo --service payment-service   # no --create: it JOINS
   loam doctor                                               # confirms the wiring
   ```

   `--service` is the binding: without it `loam vouch` and `loam gherkin` refuse outright, and `loam verify --service --record` / `--results` refuse to attest, because none of them will write a service's documents from a repo that has not said which service it is. Reading — `loam verify --service` on its own — needs no binding, because it writes nothing. Commit the `loam.json`.

4. **Adopt each service.** In its repo: `loam adopt --service <id> --json` emits the brief — every file to write, the grammar of each, what the fleet map already says, and the block the map still owes this service. An agent reads the code and writes the baseline as `draft`. `warnings[]` catches the typo case, where an id one letter off would have produced a complete, validating baseline for a service that does not exist.

5. **Grade it, twice.** `loam validate --service <id> --json` in the service repo (its own axes plus `sources`, which only that repo can resolve), then `loam validate --all --json` in the docs repo — the fleet cross-check that catches a landscape edit which never landed.

6. **Promote it.** A human runs `loam vouch --service <id>` in the service repo: `draft → verified`, stamping the source and content digests that make later staleness detectable. `loam list --json` in the docs repo then grades the whole fleet on the presence ladder `empty → partial → documented → sourced → vouched`, and `loam list --needs-work` is the remaining worklist.

Steps 3–6 repeat per service and are independent — no ordering, no lock, no shared state between two services' runs — so ten services can be onboarded by ten people in parallel. The one file they all touch is the landscape: step 2 draws it, step 4's brief tells each of them to *add* their own element to it where the map does not yet know the service, and step 5's `--all` reads it.

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

The same split runs the done-check. `verify` cannot compare a generated model to the delta (two generated models of the same code disagree every run, so the diff would flap and get switched off), but it *can* derive the question set deterministically: every service the delta introduces, every operation the feature adds, every operation-linked call it draws, every scenario it wrote. The agent answers with a `file:line` — required to be non-empty in the docs-repo all-at-once form, and under `--service` resolved inside the service repo and pinned to its commit — and every answer is recorded next to the feature, marked with who gave it (`answered_by: runner` or `answered_by: agent`).

**The scenario claims are where that mark carries weight.** The generated suite's digest tags ride into the cucumber JSON report, so `verify --results` answers a `scenario.tested` claim mechanically: only a green, digest-matched run confirms one, and names never match anything. But a legacy service with no runnable suite yet must still be able to record its answers, so `--record` may confirm a scenario claim too — on somebody's word. loam does not pretend those are the same thing. A record holding any of them never reads back as `verified`: complete, it reads **`verdict: "attested"`**; short of complete — an unanswered claim anywhere, or the feature moved under the answers — `unverified`. `verify` prints `verify.scenario-attested` naming each claim, `loam status` re-reports it and offers `next.verify-attested`, and the record travels into `features/archive/` saying so. `verified: true` in the JSON envelope means every scenario claim came from a test run. None of it gates anything: the notice is a warning, and `archive` does not read the record at all.

## Principles

- **Files are the source of truth**; the CLI is a derived convenience. Delete `loam` and every artifact remains as Markdown / LikeC4 DSL / Gherkin / YAML. No binary, no database, no state file.
- **Thin, not a platform.** One shared docs repo + a CLI. No server, no DB, no Backstage.
- **Mechanical vs semantic.** Deterministic checks validate *shape* (valid DSL, resolvable IDs, coverage); an LLM writes *narrative* (the docs, the Gherkin behavior).
- **loam never guesses about code.** It reads the docs repo; inside a service repo it only ever hashes or locates what a document already named — the files a `sources` list covers, the `file:line` an answer cites, the cucumber report `--results` was handed. It never parses code or derives meaning from it. Where a judgement about a codebase is needed — what this service is, whether that scenario has a test — loam states the **question**, precisely and repeatably, and an agent answers it. Both halves are written down: the question in the brief or the checklist, the answer in `sources` or `verification.yaml`.

## Commands

| Command | What it does |
|---|---|
| `loam init --docs <dir> [--service <id>]` | Bind this repository to the single shared docs repo: write a committed local `loam.json` and, for every AI tool it detects here (Claude Code when it finds none), a command file and an Agent Skill per workflow. `--create` scaffolds the docs repo itself instead — `services/`, `features/`, `architecture/landscape.likec4` and its `AGENTS.md`. |
| `loam list [services\|features]` | What is in the docs repo, and what is missing from it. |
| `loam status [<FEAT>]` | Where the work stands and what to do next, as a projection over the two gates. Derived every run; writes nothing. |
| `loam doctor` | Read-only preflight for runtime, config, docs-repo access, fleet roots, counts, and the current service binding. Blockers exit 1; incomplete optional bindings stay warnings. |
| `loam dependencies [<FEAT>]` | Derive the active-feature dependency graph and same-identity conflicts from requirement deltas and OpenAPI operationIds. Optional focus includes transitive prerequisites. |
| `loam explore [<service>...]` | Read the fleet around a change nobody has written down yet: the ring one hop out, each service's maturity and living operations, the features already in flight over the same ground, and the `loam new` line the seeds imply. `--op <id>` seeds from an operation. Writes nothing. |
| `loam instructions [<workflow>] [args...]` | Print one of the six workflow protocols, `$1`/`$2` filled in — version-matched to this binary, which is what the generated command and skill files point at. Reads no config. |
| `loam new <FEAT> [--title <t>] [--touches <id>] [--new-service <id>]` | Scaffold a feature: intent, C4 delta, and a requirement delta for every service named by `--touches` / `--new-service` (both repeatable). The title is optional and becomes the directory slug. |
| `loam show <service\|FEAT>` | Everything loam knows about one service or feature. |
| `loam adopt --service <id>` | Brief an agent to write this service's baseline into the docs repo as `draft`. Writes nothing. |
| `loam delta <FEAT> [--service <id>]` | Project a feature onto one service: the intent, its requirement deltas with every requirement body and every Given/When/Then line reproduced verbatim, the endpoints it adds or retires, and the edges around it. The output doubles as a coding-agent task. |
| `loam gherkin [<FEAT>] [--service <id>]` | Emit spec scenarios as digest-stamped Gherkin `.feature` files into the service repo's `<gherkinDir>/loam/`. |
| `loam rebase <FEAT> [--service <id>]` | Pin the feature to the living versions it was written against, on the requirement axis and the contract axis. `--dry-run` shows what would be pinned. |
| `loam validate [<id>] [--service <id>\|--feature <id>] [--all]` | Validate one service or feature, or the whole fleet in one run (the docs repo's CI gate). The positional id resolves a feature first; `--service` / `--feature` force the reading. `--strict` exits 1 on warnings too. |
| `loam verify <FEAT> [--service <id>]` | The done-check: derive a checklist of the feature's own promises, and record the answers with their evidence. |
| `loam vouch --service <id>` | The human promotion `draft` → `verified`: stamp a living spec against the code it was written from. Run in the service's own repo. |
| `loam archive <FEAT>` | Merge a shipped feature into the living specs, API and landscape; gated on gating coherence issues, on what only the computed merge can see, and on living documents the merge cannot rewrite safely. `--approve` overrides the judgement calls, never the mechanical losses. `--dry-run` prints the plan and writes nothing. |
| `loam unarchive <FEAT>` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature. |
| `loam audit-openspec <root>` | Read-only inventory of an OpenSpec checkout/workspace/Store checkout. Writes nothing; `--write-mapping <path>` emits the decision skeleton you fill in. |
| `loam migrate-openspec <root> --map <path>` | Validate a completed mapping against a re-read of the source, and materialize staged migration docs. Dry-run is the default. |

Every command takes `--json`: findings carry stable codes (`c4.valid`, `spine.op-undefined`, `coherence.ok` …) so an agent branches on the code, not on prose. The envelope keeps three different questions apart, each on the command that can answer it — `ok` (the command ran) on every envelope, `valid` (the docs pass) on `validate`, and `verified` (every claim is confirmed **and** every scenario claim came from a test run) on `verify`, beside `verdict`, which carries the third state, `attested`, for a record whose scenarios rest on an agent's word.

### Command notes

**`loam init`** — `--docs` **joins** an existing docs repo; `--create` is required to make a new one, so a mistyped path cannot scaffold a second source of truth. `--service <id>` is what a **service** repo needs: it is the binding `vouch`, `gherkin` and `verify --service --record`/`--results` require before they will write for that service. `--tools <ids>|all` overrides the tool scan; `--no-commands` / `--no-skills` drop one delivery — and the two are exclusive, refused together, since one names the files to write and the other suppresses them. `docsDir` is stored exactly as you typed it and resolved against `loam.json`, so a relative `../docs-repo` works on every clone — and `--docs` wins only when you actually pass it, so a re-run in a wired repo keeps the pointer its committed `loam.json` already spells, `--create` included (`docsDirSource: "flag" | "config" | "default"` in `--json` says which).

**`loam status`** — the question an agent has when it joins a repo halfway or loses its session. Artifacts come back `missing`/`blocked`/`draft`/`ready`/`done`, and `next[]` is ordered, each entry a stable code plus the literal command. It takes the union of what `validate --feature` errors on and what `archive` refuses to merge, so it may be redder than either and is never greener than both. There is no state file to go stale.

**`loam new`** — the scaffold passes `loam validate --feature` with **zero errors**, and its unauthored state is named in warnings that *gate the archive*: `intent.empty` until you write the Why, `scaffold.placeholder` while any template text survives (a feature that introduces a service also starts on `c4.uncovered`, until its `arch.spec.md` delta carries a `Covers:` line for the element the delta adds). An untouched scaffold can never fold into the living docs — `loam archive` refuses it until a person authors the content, or deliberately overrides with `--approve`. For a requirements-only feature you delete the scaffolded `delta.likec4` yourself — `new` says so on the way out.

**`loam adopt`** — the brief names the target paths, the grammar of each, what the landscape already says, the checks that follow, and the ones that do not exist.

**`loam gherkin`** — a feature's changed requirements, or (without a feature) the full living suite. Deterministic, digest-stamped, regeneration-owned; run in the service's own repo.

**`loam rebase`** — writes `Based-On:` on every MODIFIED/REMOVED requirement and `x-loam-based-on` on every operation in the contract delta that the living docs already hold; what this feature is *adding* has nothing to pin against, and the output says so per item. On the requirement axis that stops a second feature rewriting the same requirement from landing on top of the first in silence; on the contract axis it also marks the rest of the delta as **quotation** — an `openapi.yaml` is a complete document, so without the pin the merge upserts operations you only restated and reverts whatever landed on them. Restamping is the last step of resolving a collision, not the resolution — the output says which pins moved.

**`loam verify`** — `--results <report.json>` answers the scenario claims from a cucumber JSON run, digest-matched, so only a green run confirms one, and the record writes down which file it read (path, sha256, mtime). It answers *only* those claims, so on a feature with open `service.exists` / `api.exposes` claims it is passed alongside `--record` or refused (`answers-mismatch`). `--record <answers.json>` takes the agent's answers, refusing anything unevidenced — under `--service`, refusing a `file:line` that does not resolve in that repo at the attested commit — and a scenario claim answered that way makes the record `attested` rather than `verified`. A cross-service feature is recorded **once per service repo** with `--service <id>`, each run adding its own commit-bound attestation to one shared record; the `--service`-less `--record` form writes the whole record from one place and is refused (`record-federated`) once anyone else has attested.

**`loam unarchive`** — it refuses rather than guesses: `snapshot-stale` when a merged file moved since (`--force` says that was meant), and `snapshot-corrupt` when a pre-image no longer hashes to what the archive recorded for it, which `--force` deliberately does **not** override — the damage there is to the undo itself.

**`loam audit-openspec` / `loam migrate-openspec`** — the audit reports capabilities, active and archived changes, counts, RENAMED and unsupported shapes, and every capability→service decision still needing a human. The migration validates your completed mapping against a re-read of the source, and with `--apply --target <empty-dir>` materializes **staged migration docs** into a separate directory. `--map` is required — there is no one-shot form.

### How `archive` protects the source of truth

`archive` is the command that merges a feature into the living source of truth and records the reversible pre-images. Other commands also write canonical artifacts (`vouch`, `rebase`, `verify`, `new`, and `init`), but archive has the strongest multi-file transaction contract: it takes an advisory lock on the docs repo for the whole plan-and-commit (a second writer — another `archive`, an `unarchive`, a `rebase` — refuses with `docs-busy` rather than interleaving), computes the whole merge before touching disk, commits each file through a temp file swapped in atomically after re-checking the bytes it read (a rename for an overwrite, a no-clobber `link(2)` for a create, so a file that appeared after the plan was computed is never buried), and rolls back what it already swapped if any part fails. It also records the bytes it overwrote inside the archived feature — with a digest of each pre-image, so `unarchive` can tell an intact one from an edited one — which is what makes `unarchive` an undo rather than a guess. A process **killed mid-commit** is covered too: an intent journal (`.loam-commit`) is fsynced before the first swap, and the next `archive`/`unarchive` recovers from it under the lock, rewriting each half-written file from the snapshot — an interrupted archive is undone, an interrupted unarchive is *finished*, because the merged text it was replacing is written down nowhere else — or refusing with `commit-interrupted` when a file has been edited since. `loam doctor` reports that state rather than calling the repo healthy.

The gate itself comes in two kinds. Coherence, an unknown service and the OpenAPI plan are judgement calls, and `--approve` carries them; two refusals are mechanical loss and `--approve` deliberately does not — a living document still holding git conflict markers (`merge-failed`) and a living requirement that has strayed outside `## Requirements` (`living-outside-requirements`). loam's docs files must be **UTF-8** for the same reason: undecodable bytes refuse the merge (`merge-failed`, naming the file) instead of being rewritten as U+FFFD, and a non-UTF-8 `openapi.yaml` grades `openapi.invalid`. **`verify` does not gate `archive`** — coherence gates because loam *computed* it; a verdict is somebody's word about code loam never read, and a gate in front of shipping only teaches everyone that the cheapest way past it is to say yes.

API retirement is explicit and reviewable: a feature marks the exact path/method operation with `x-loam-remove: true` — **inside the operation being retired, beside its `operationId`** — and removes the governing requirement in the same delta. A marker written one level up, at path level beside the methods, addresses no operation and retires nothing; archive refuses it (`openapi.remove-marker-path-level`) rather than publishing a meaningless key into the fleet's living contract. Validation refuses stale, mismatched, or unjustified markers; archive deletes the method without persisting the marker or garbage-collecting components, and reports the removals in both text and JSON. See [SCHEMA.md](SCHEMA.md) for the lifecycle contract.

## Working with AI agents

`loam init --create` writes `AGENTS.md` into the docs repo — the process contract, travelling with the thing it describes; a join finds it there and refuses a `--docs` target without one. Into the repo it runs in, every `init` writes the six workflow bodies (`loam-adopt`, `loam-feature`, `loam-implement`, `loam-check`, `loam-verify`, `loam-ship`), **twice each for nineteen of the twenty tools**: as a command file in the tool's own command, prompt or workflow directory, which you type — `/loam-check` for most, `/loam:check` where the tool namespaces by directory, `@loam-check` in Amazon Q's prompt library — and as an Agent Skill at `<tool-dir>/skills/loam-<x>/SKILL.md`, which the model loads by itself when the task matches the skill's description. Codex is the twentieth: it reads `.codex/skills/` and loads no custom command files, so it gets skills only rather than files nothing will ever open. One shared body, a thin per-tool wrapper; `--no-commands` and `--no-skills` each suppress one delivery.

Which tools is detected from the repo: `init` scans each of the 20 tools it knows for its own marker paths — usually just its dot-directory, but Copilot's are the files *inside* `.github/`, because almost every repo has a `.github/` and almost none of them means Copilot. The twenty are Claude Code, Cursor, GitHub Copilot, Gemini CLI, opencode, Cline, Amazon Q, Antigravity, Auggie, Codex, Continue, Crush, Devin, Factory, Junie, Kilo Code, Kiro, Qwen, Roo Code and Trae. It writes for the ones it finds, and falls back to Claude Code when it finds none. `--tools <ids>|all` overrides the scan; an unknown id is refused, not skipped. What it wrote for is recorded in `loam.json` as `agentTools`, which is how `loam doctor` reports a command or skill file that a newer loam would lay down (`doctor.agent-files-missing`) without mistaking a tool nobody selected for one that fell behind — and a repo that asked for one delivery only (`--no-skills`, `--no-commands`) is not reported as missing the other.

**A generated file is a pointer, not a protocol.** It carries what does not move between releases — what the workflow is for, and the verbs in order — and defers this release's flags, finding codes and fix tables to `loam instructions <workflow>`, which ships inside the binary you are about to run. That split exists because the two go stale in opposite directions and only one of them is fixable: a file written once and never regenerated will eventually describe a different loam with total confidence, while the command cannot. `loam instructions` reads no `loam.json` and no docs repo, deliberately — `loam-adopt`'s own first step is to run `loam init` when there is no config, so it cannot be the step that requires one.

**Nothing is ever overwritten and nothing is ever refreshed**, and that is the whole difference from `openspec update`: your edits to a generated file outrank the template, so drift is reported and never repaired. To make that reportable at all, every generated command and skill body opens with `<!-- generated by loam vX.Y.Z -->`; `loam doctor` reads **only that line** and raises `doctor.agent-files-stale` for a file carrying no stamp or an older one. It never compares bodies — "your file differs from the template" is one step from offering to rewrite it. The fix is a human's: read the file, then bump the stamp, or delete it and re-run `loam init`. The AGENTS.md version stamp (`agents.stale`) works the same way. A repo scaffolded by an older loam keeps the files it was given, protocol text and all — nothing rewrites them, and the stamp is how you know. Running a tool loam has no adapter for? Point it at `AGENTS.md` — the commands are thin wrappers over the CLI, so any runner that can read a file and exec `loam` has everything.

## Fleet scale

One docs repo, a hundred services, many teams: the docs repo bootstraps itself with `loam init --docs . --create`, ownership is CODEOWNERS, `vouch` and `archive` land through reviewed PRs, provenance runs in each service repo's own CI, and `loam list --json` grades every service on a presence-honest maturity ladder (`empty → partial → documented → sourced → vouched`). The full operating model — including `loam.json` per repo, the federated verification record, the per-service CI summary contract and the one-landscape decision — is in [SCHEMA.md](SCHEMA.md).

The shape that has been measured, on a generated 120-service fleet with 400 and 800 op-linked landscape edges and 10 active features (built CLI, 8-core laptop, idle, wall clock including Node startup — of which ~0.16 s is Node itself): `loam list` **~0.45 s**, `loam validate --service <id>` — the command each service repo's CI runs — **~0.6 s**, and `loam status` **~1.3 s** — it grades every active feature's `delta.likec4`, so it costs about 0.11 s per feature *in flight* and is nearly flat in the size of the fleet (the same 120 services with one active feature answer in ~0.34 s). The fleet gate is the outlier: `loam validate --all` over the same 120 services takes **~13–14 s**, because it parses a fresh LikeC4 workspace per service rather than sharing one. That cost is fixed and linear in the number of services, and it is CPU inside the model construction, not I/O — bounded concurrency measurably does not help. It is the docs repo's own CI job and it is not on anybody's inner loop; on a machine whose cores are already busy, expect meaningfully more. `test/scale.test.ts` gates a smaller fleet — 30 services, 10 features, 24 op-linked edges — under a 110 s wall-clock ceiling. That ceiling was calibrated against the then-64-file parallel suite; the assessed tree now has 73 test files. It remains a blowup alarm for an order-of-magnitude regression, not evidence that a two-fold slowdown is acceptable.

## Docs

- [WORKFLOW.md](WORKFLOW.md) — the working protocol: the artifact graph and its derived states, what gates and what only advises, the six workflows, and how an agent drives the whole cycle from `--json`.
- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the decisions behind them: the coherence rules, how `archive` writes and `unarchive` undoes, operating at fleet scale.
- [COMPARISON.md](COMPARISON.md) — current product comparison with OpenSpec v1.9, kept separate from the pinned v1.7 compatibility corpus.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam: what maps, what is lost, what must be added.
- [ROADMAP.md](ROADMAP.md) — the evidence-backed improvement plan, priorities, non-goals and exit criteria.
- [CHANGELOG.md](CHANGELOG.md) — released beta.1–beta.3 plus the changes on `main` under `[Unreleased]`.

## Development

```bash
npm run setup              # or: npm ci && npm run build
npm run dev -- --help      # run the CLI from source
npm run lint
npm run typecheck
npm run arch:check          # package-level dependency graph stays acyclic
npm test                   # vitest
npm run test:coverage      # full src/**/*.ts coverage with enforced thresholds
npm run test:package       # clean, pack, install the tarball, run its loam binary
npm run pilot:check        # the pilot harness against its own example manifest
# optional, against the exact upstream checkout named in "loam vs OpenSpec" (the
# flag matters: --baseline defaults to canary, and the sweep refuses a checkout
# at any other HEAD):
npm run test:openspec-corpus -- --baseline release /path/to/OpenSpec
```

`npm run setup` is `bash scripts/setup.sh`, so on Windows use `npm ci && npm run build`. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest — the local loop, what a reviewable change looks like, and the release posture; the pilot harness itself is documented under [`docs/pilot/`](https://github.com/ybotok/loam/tree/main/docs/pilot).

## Status

Every command in the table is implemented, including `verify --results`, AsyncAPI 3 message joins, the `architecture/permissions.yaml` authorization vocabulary, `Requires:` checks, response-governance warnings and Markdown-table → Scenario Outline generation. AsyncAPI is still living-only: feature-local delta, pin, merge and verification claims do not exist yet. Other known limits include unpinned OpenAPI path/components edits, a slow all-fleet validation path, and an uncompleted two-fleet production pilot. [ROADMAP.md](ROADMAP.md) gives the prioritized fixes and exit criteria; speculative `render`, health composition and UI generation come later.

The package is published as [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam), currently `0.1.0-beta.3`: the unscoped `loam` name is taken by an unrelated GDAL wrapper, so the package ships under the maintainer's own npm user scope. Releases are tag-driven and maintainer-only ([CONTRIBUTING.md](CONTRIBUTING.md)); the version this line names is pinned to `package.json` by a drift test, so it cannot silently trail a release.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the complete local gate and what a reviewable change looks like here.

## Security

Do not put vulnerability details in a public issue. GitHub Private Vulnerability Reporting is intended but is not currently confirmed as enabled; [SECURITY.md](SECURITY.md) documents the temporary detail-free contact request and the release blocker for a durable private route.

## License

[MIT](LICENSE)
