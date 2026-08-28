# loam

**Architecture-first spec framework for microservice fleets.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
[![CI](https://github.com/ybotok/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/ybotok/loam/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ybotok/loam.svg)](https://www.npmjs.com/package/@ybotok/loam)

> **Pre-release: `0.1.0-beta.3`**, the latest published npm version of
> [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam). `main` is ahead under
> `[Unreleased]`; do not treat a tarball built from it as beta.3. See [Status](#status).

`loam` briefs an agent to document an existing service **by reading its code**, then checks the
resulting C4, requirements and contracts without pretending to extract their meaning itself. Forward
changes start from an authored C4 delta: `loam` projects it onto each affected service, generates
digest-stamped Gherkin, and checks that behavior, architecture, APIs, events, vocabulary and
authorization still join.

## Contents

- [Why](#why) · [Install](#install) · [Quick start](#quick-start) · [Commands](#commands) ·
  [Working with AI agents](#working-with-ai-agents)
- [Docs](#docs) · [Development](#development) · [Status](#status) · [Contributing](#contributing) ·
  [Security](#security) · [License](#license)
- Companion pages: [WORKFLOW.md](WORKFLOW.md) — the protocol · [SCHEMA.md](SCHEMA.md) — the
  reference · [ROADMAP.md](ROADMAP.md) · [COMPARISON.md](COMPARISON.md)

## Why

Spec-driven development tools often stop at behavior, while a business-simple feature can span many
services and fail at their edges. C4 diagrams, Gherkin, API contracts and permissions then become
disconnected documents that drift quietly. `loam` makes C4 the center and checks explicit joins —
every one of them an exact token spelled in two places, never a heuristic over prose:

| The join | Ties |
|---|---|
| `Operations:` ↔ OpenAPI `operationId` | a requirement to the endpoint it governs |
| `Publishes:` / `Consumes:` ↔ AsyncAPI message names | a requirement to the event spine |
| `Covers:` ↔ C4 elements, `#obl-` tags, `health.yaml` ids | an architectural obligation to what it accounts for |
| `Requires:` ↔ `architecture/permissions.yaml` | a requirement to the fleet authorization vocabulary |
| `Realizes:` ↔ `capabilities/<cap>/spec.md` | a service requirement to the business promise it keeps |
| `#cap-` / `#req-` on a `dynamic view` ↔ a capability requirement | a cross-service use case to the promise it keeps |
| a Markdown link ↔ `glossary/<term>.md` | a document to the word it uses |

Architecture has its own requirement axis (`arch.spec.md`) because a business spec will not mention
the transactional outbox, retries or alerts.

**There is no extractor, and there will not be one.** Nothing deterministic reads a legacy service
and says what its architecture *means*, and a model that was guessed is worse than none — everyone
downstream has to re-derive it to know whether to believe it. So loam takes the half of the job that
is mechanical: it **states the work** and it **checks the result**. An agent does the reading, and
both halves are written down: the question in the brief or the checklist, the answer in `sources` or
`verification.yaml`.

Files stay the source of truth. Delete `loam` and every artifact remains as Markdown, LikeC4 DSL,
Gherkin and YAML — no server, no database, no state file, three runtime dependencies. The two flows
this implies, what gates and what only advises, are in [WORKFLOW.md](WORKFLOW.md).

## Install

**Node ≥ 22.22.3** (the `engines` floor in `package.json`) is the only prerequisite for everything
loam derives from the docs repo. C4 modeling uses **[LikeC4](https://likec4.dev)** (pinned exact),
an ordinary npm runtime dependency loaded in-process (TypeScript-native): no JVM, no external CLI.
The one outside binary loam ever calls is **`git`** — read-only questions in whichever repository
the command is about (`verify --service`, `vouch`'s source digest, `subsystem move`/`history`, and
`diff --base`), plus the one blessed `git add` that stages a subsystem move's renames. Never the
network.

```bash
npm install -g @ybotok/loam
loam --version
```

`loam doctor` is the wiring check, not the install check: run where no `loam.json` is in scope, it
reports `doctor.config-missing` and exits 1 by design. Save it for after `loam init`.

A per-repo dev dependency works the same way: `npm i -D @ybotok/loam`, then `npx loam …`.

To work on loam itself — or to run an unreleased commit — install from a clone:

```bash
git clone https://github.com/ybotok/loam.git && cd loam
./scripts/setup.sh --link     # checks node >= 22.22.3, npm ci, build, smoke-test, npm link
```

Drop `--link` to build without a global `loam`; on Windows run `npm ci && npm run build` by hand.

## Quick start

### Try loam on one service in five minutes

The full model is a fleet; the trial is one repository. In the service repo you know best (after
[installing](#install)):

```bash
loam init --docs loam-docs --create --service payment-service
```

One run does two things: it scaffolds a new docs repo at `loam-docs/` — `services/`, `features/`,
`architecture/landscape.likec4`, its own `AGENTS.md` and `loam.json` — and it binds this repository
to the id `payment-service` in a committed `loam.json` beside your code (plus the slash commands and
Agent Skills for the AI tools it detects here — [Working with AI agents](#working-with-ai-agents)).
`init` ends by printing the first hour, which is this loop:

```bash
loam adopt --service payment-service --json   # the brief: an agent reads the code, writes the baseline as draft
loam validate --service payment-service       # grade the result in this repo
loam vouch --service payment-service          # you, not the agent: draft -> verified
loam status                                   # what to do next, derived from the files
```

What the trial pays off on is the adopt → validate → vouch mechanics: the brief, the graded
baseline, the human promotion that makes later staleness detectable. The cross-service checks that
are loam's actual case need a second service — one repo has no edges to join. When a second service
wants in, graduate to the full wiring:
[WORKFLOW.md's day zero](WORKFLOW.md#day-zero-onboarding-a-fleet) is the same steps, pluralized.

### Explore the example fleet

The repo ships a runnable example fleet under
[`examples/docs/`](https://github.com/ybotok/loam/tree/main/examples/docs) — five services, one
feature already shipped, two in flight, the event spine, the permission vocabulary, the business
tree and a verification record.
[`examples/README.md`](https://github.com/ybotok/loam/blob/main/examples/README.md) is the guided
tour: what each service is there to show, and what every one of the ten deliberate warnings
demonstrates. From a clone, point a throwaway `loam.json` at it and run the real commands (the file
is untracked; delete it when done):

```bash
echo '{ "docsDir": "examples/docs" }' > loam.json   # relative, resolved against this file
npm run dev -- list                          # the fleet and its maturity ladder
npm run dev -- status                        # what to do next, derived from the files
npm run dev -- validate --all                # the CI gate: 0 errors, 10 deliberate warnings
npm run dev -- archive FEAT-101 --dry-run    # the whole three-axis merge plan, writing nothing
npm run dev -- archive FEAT-112 --dry-run    # an operation being retired, writing nothing
npm run dev -- verify FEAT-088               # a shipped feature's done-check, frozen history
```

`test/examples.test.ts` pins the validate summary and every finding code, and both archive plans
file-for-file, so those outcomes cannot drift from the code; the `list` rendering is not pinned. One
caveat on Windows: a clone with `core.autocrlf=true` rewrites the *generated*
`architecture/subsystems.likec4`, which loam then reports as an error against the tree it no longer
byte-matches. Clone that checkout with `core.autocrlf=false` to see the documented result.

## Commands

Every command takes `--json`; findings carry stable codes (`c4.valid`, `spine.op-undefined`,
`coherence.ok` …) so an agent branches on the code, not on prose. Flags are listed in full below —
`loam <command> --help` is the same list from the binary you are running, and
[WORKFLOW.md's command notes](WORKFLOW.md#command-notes) is the per-command behavior that a table
cannot hold.

| Command | Flags | What it does |
|---|---|---|
| `loam init` | `--docs <dir>` `--service <id>` `--create` `--force` `--tools <ids>` `--no-commands` `--no-skills` | Bind this repository to the single shared docs repo: a committed local `loam.json`, plus a command file and an Agent Skill per workflow for every AI tool detected here. `--create` scaffolds the docs repo itself instead |
| `loam seed` | `--from <file>` | Template the fleet map and one `services/<id>/` directory per service from a tiny human-authored `fleet.yaml`. Mechanical, never a guess: a human stated every fact. Refuses once the landscape has been hand-edited |
| `loam list [services\|features\|capabilities\|glossary]` | `--archived` `--needs-work` `--review-order` `--subsystem <name>` `--owners <path>` | What is in the docs repo, and what is missing from it. `capabilities` rolls up who realizes each promise; `glossary` rolls up each term with the documents that cite it |
| `loam status [<FEAT>]` | `--service <id>` | Where the work stands and what to do next, as a projection over the two gates. Derived every run; writes nothing |
| `loam doctor` | — | Read-only preflight for runtime, config, docs-repo access, fleet roots, counts, and the current service binding. Blockers exit 1; incomplete optional bindings stay warnings |
| `loam dependencies [<FEAT>]` | — | The active-feature dependency graph and same-identity conflicts, derived from requirement deltas and OpenAPI operationIds |
| `loam diff` | `--base <ref>` | Semantic diff of the living docs against a base git ref of the docs repo — the review lens for a docs-repo PR, with the current consumers of every removal named. Exit 1 on a removal the fleet still consumes |
| `loam explore [<service>...]` | `--op <operationId>` `--capability <id>` `--as <FEAT>` | Read the fleet around a change nobody has written down yet: the ring one hop out, each service's maturity and living operations, the features already in flight over the same ground, and the `loam new` line the seeds imply |
| `loam context <service>` | `--feature <FEAT>` | Assemble one service's docs slice — living requirements verbatim, both contracts, the fleet edges around it, permissions, capabilities, provenance, and every active feature's delta over it — as one deterministic briefing |
| `loam instructions [<workflow>] [args...]` | — | Print one of the six workflow protocols, `$1`/`$2` filled in — version-matched to this binary, which is what the generated command and skill files point at. Reads no config |
| `loam explain [<subject>]` | — | Explain a finding code, a refusal code, or a concept term. The finding prose is parsed at runtime from the shipped fix tables, so it cannot drift from the binary. Omit the subject to list the terms |
| `loam open` | `--root <dir>` `--out <file>` `--force` | Write a `.code-workspace` joining the docs repo and every service checkout whose committed `loam.json` binds to it. Never overwrites without `--force` |
| `loam mcp` | — | Serve the twelve read commands as MCP tools over stdio (JSON-RPC 2.0). The writing commands are deliberately not exposed — [the MCP server](WORKFLOW.md#the-mcp-server) |
| `loam new <FEAT>` | `--title <text>` `--touches <id>` `--new-service <id>` `--capability <id>` | Scaffold a feature: intent, C4 delta, a requirement delta per service named by `--touches`/`--new-service`, and a capability delta per promise named by `--capability` (all repeatable) |
| `loam show <service\|FEAT>` | `--type <kind>` | Everything loam knows about one service or feature. `--type` forces the reading when a name could be either |
| `loam subsystem <verb> [names...]` | `--into <name>` `--under <name>` `--title <text>` `--description <text>` `--owner <name>` | Manage the grouping tree under `services/` — a navigable tree no identity depends on. `new`/`rm`, `move … --into`, `rename`, `list`, `history`, `sync` |
| `loam adopt` | `--service <id>` `--subsystem <name>` | Brief an agent to write this service's baseline into the docs repo as `draft`: the target paths, the grammar of each, what the landscape already says, and the checks that follow. Writes nothing |
| `loam delta <FEAT>` | `--service <id>` | Project a feature onto one service: the intent, its requirement deltas with every body and Given/When/Then line verbatim, the endpoints it adds or retires, and the edges around it. Doubles as a coding-agent task |
| `loam gherkin [<FEAT>]` | `--service <id>` `--dry-run` | Emit spec scenarios as digest-stamped Gherkin `.feature` files into the service repo's `<gherkinDir>/loam/` |
| `loam rebase <FEAT>` | `--service <id>` `--dry-run` | Pin the feature to the living versions it was written against, on the requirement axis and the contract axis |
| `loam validate [<id>]` | `--service <id>` `--feature <id>` `--all` `--strict` `--errors-only` | Validate one service or feature, or the whole fleet in one run (the docs repo's CI gate). `--strict` exits 1 on warnings too; `--errors-only` prints just the errors |
| `loam verify <FEAT>` | `--record <file>` `--results <file>` `--contract-results <file>` `--diff-answers <files...>` `--service <id>` | The done-check: derive a checklist of the feature's own promises, and record the answers with their evidence. `--results`/`--contract-results` answer claims from a test report; `--diff-answers` cross-examines two blind answer sets |
| `loam vouch` | `--service <id>` `--yes` `--pack` `--sample <n>` | The human promotion `draft` → `verified`: stamp a living spec against the code it was written from. `--pack` prints the re-vouch reading pack; `--sample <n>` records a partial read as one. Run in the service's own repo |
| `loam gate` | `--service <id>` `--strict` | Can this service deploy? A pure query over recorded evidence for deploy pipelines outside loam's lifecycle. Executes nothing, writes nothing; errors exit 1, warnings stay advisory |
| `loam archive <FEAT>` | `--approve` `--dry-run` | Merge a shipped feature into the living specs, API, events, business tree and landscape; gated on what only the computed merge can see. `--approve` overrides the judgement calls, never the mechanical losses |
| `loam unarchive <FEAT>` | `--force` | Take that back: restore the living docs from the snapshot archive left behind, and re-open the feature |
| `loam audit-openspec <root>` | `--write-mapping <path>` | Read-only inventory of an OpenSpec checkout/workspace/Store checkout. `--write-mapping` emits the decision skeleton you fill in |
| `loam migrate-openspec <root>` | `--map <path>` `--mapping <path>` `--apply` `--target <directory>` | Validate a completed mapping against a re-read of the source, and materialize staged migration docs. Dry-run is the default |

The envelope keeps three different questions apart, each on the command that can answer it — `ok`
(the command ran) on every envelope, `valid` (the docs pass) on `validate`, and `verified` (every
claim is confirmed **and** every scenario claim came from a test run) on `verify`, beside `verdict`,
which carries the third state, `attested`, for a record whose scenarios rest on an agent's word.

## Working with AI agents

`loam init --create` writes `AGENTS.md` into the docs repo — the process contract, travelling with
the thing it describes; a join finds it there and refuses a `--docs` target without one. Into the
repo it runs in, every `init` writes the six workflow bodies (`loam-adopt`, `loam-feature`,
`loam-implement`, `loam-check`, `loam-verify`, `loam-ship`), **twice each for nineteen of the twenty
tools**: as a command file you type — `/loam-check` for most, `/loam:check` where the tool
namespaces by directory, `@loam-check` in Amazon Q's prompt library — and as an Agent Skill at
`<tool-dir>/skills/loam-<x>/SKILL.md`, which the model loads by itself when the task matches. Codex
is the twentieth: it reads `.codex/skills/` and loads no custom command files, so it gets skills
only. `--no-commands` and `--no-skills` each suppress one delivery.

Which tools is detected from the repo: `init` scans each of the 20 tools it knows for its own marker
paths — usually just its dot-directory, but Copilot's are the files *inside* `.github/`, because
almost every repo has a `.github/` and almost none of them means Copilot. It writes for the ones it
finds, and falls back to Claude Code when it finds none. `--tools <ids>|all` overrides the scan; an
unknown id is refused, not skipped. What it wrote for is recorded in `loam.json` as `agentTools`,
which is how `loam doctor` reports a file a newer loam would lay down without mistaking a tool
nobody selected for one that fell behind.

**A generated file is a pointer, not a protocol.** It carries what does not move between releases —
what the workflow is for, and the verbs in order — and defers this release's flags, finding codes
and fix tables to `loam instructions <workflow>`, which ships inside the binary you are about to
run. That split exists because the two go stale in opposite directions and only one of them is
fixable: a file written once and never regenerated will eventually describe a different loam with
total confidence, while the command cannot.

**Nothing is ever overwritten and nothing is ever refreshed**, and that is the whole difference from
`openspec update`: your edits to a generated file outrank the template, so drift is reported and
never repaired. Every generated body opens with `<!-- generated by loam vX.Y.Z -->`; `loam doctor`
reads **only that line** and raises `doctor.agent-files-stale` for a file carrying no stamp or an
older one. It never compares bodies — "your file differs from the template" is one step from
offering to rewrite it. The fix is a human's: read the file, then bump the stamp, or delete it and
re-run `loam init`. Running a tool loam has no adapter for? Point it at `AGENTS.md` — the commands
are thin wrappers over the CLI. For hosts that reach tools through MCP rather than a shell, see
[the MCP server](WORKFLOW.md#the-mcp-server).

## Docs

- [WORKFLOW.md](WORKFLOW.md) — the working protocol: day zero, the artifact graph and its derived
  states, what gates and what only advises, the six workflows, the per-command notes, and how an
  agent drives the cycle from `--json`.
- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the decisions behind
  them: the coherence rules, how `archive` writes and `unarchive` undoes, operating at fleet scale.
- [COMPARISON.md](COMPARISON.md) — current product comparison with OpenSpec v1.10.0, kept separate
  from the pinned v1.9 compatibility corpus. For a single repo without cross-service contracts,
  OpenSpec is simpler *and sufficient*; that page says so, and says where loam starts paying.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam: what
  maps, what is lost, what must be added.
- [ROADMAP.md](ROADMAP.md) — the evidence-backed improvement plan, priorities, non-goals and exit
  criteria.
- [CHANGELOG.md](CHANGELOG.md) — released beta.1–beta.3 plus the changes on `main` under
  `[Unreleased]`.
- [docs/BENCHMARKS.md](https://github.com/ybotok/loam/blob/main/docs/BENCHMARKS.md) — what a
  fleet-sized run costs, with the method, the machine and the committed runs behind every number.

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
# optional, against the exact upstream checkout named in COMPARISON.md (the
# flag matters: --baseline defaults to canary, and the sweep refuses a checkout
# at any other HEAD):
npm run test:openspec-corpus -- --baseline release /path/to/OpenSpec
```

`npm run setup` is `bash scripts/setup.sh`, so on Windows use `npm ci && npm run build`.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rest — the local loop, what a reviewable change looks
like, and the release posture; the pilot harness itself is documented under
[`docs/pilot/`](https://github.com/ybotok/loam/tree/main/docs/pilot).

## Status

Every command in the table is implemented, including `verify --results` and its contract-test
sibling `verify --contract-results`, the full AsyncAPI feature lifecycle, OpenAPI path-item and
component baselines, the `architecture/permissions.yaml` authorization vocabulary, the declared- and
authored-capability axes with the `Realizes:` join, use cases graded as `dynamic view`s, the
`glossary/<term>.md` domain vocabulary checked through the links that cite it, and the
`architecture/obligations.yaml` architectural obligations checked through `#obl-` tags and
`Covers:`. Known limits, each with its owner in [ROADMAP.md](ROADMAP.md): a components-only OpenAPI
delta — and its slot-less AsyncAPI sibling — passes the gate but merges nothing, and the two-fleet
production pilot has not been completed. Speculative `render`, health composition and UI generation
come later. Behind that status stand **140 test files** (counted 2026-08-28): the count is graded
against a live readdir by `test/docs-facts.test.ts`, so this sentence fails the suite the moment it
trails the tree.

The package is published as [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam), currently
`0.1.0-beta.3`: the unscoped `loam` name is taken by an unrelated GDAL wrapper, so the package ships
under the maintainer's own npm user scope. Releases are tag-driven and maintainer-only
([CONTRIBUTING.md](CONTRIBUTING.md)); the version this line names is pinned to `package.json` by a
drift test, so it cannot silently trail a release.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the complete local
gate and what a reviewable change looks like here.

## Security

Do not put vulnerability details in a public issue. GitHub Private Vulnerability Reporting is
intended but is not currently confirmed as enabled; [SECURITY.md](SECURITY.md) documents the
temporary detail-free contact request and the release blocker for a durable private route.

## License

[MIT](LICENSE)
