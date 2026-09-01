# loam

**Architecture-first semantic integrity and change governance for evolving software systems.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
[![CI](https://github.com/ybotok/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/ybotok/loam/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ybotok/loam.svg)](https://www.npmjs.com/package/@ybotok/loam)

> **Pre-release: `0.2.0-alpha.1`**, the first release of the 0.2 line and the newest published
> version of [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam). It publishes under the
> `alpha` npm dist-tag, so `npm i @ybotok/loam` still installs `0.1.0-beta.3`; ask for
> `@ybotok/loam@alpha` to get this one. See [Status](#status).

`loam` keeps an authored C4 model, requirements, API and event contracts, permissions, domain
vocabulary and verification evidence in explicit agreement as a system changes. The same lifecycle
governs a modular monolith, a distributed service fleet, or a hybrid of both; the CLI and filesystem
call each governed implementation boundary a `service`, but it need not be a network service.

For an existing boundary, `loam` briefs an agent to document it **by reading its code**, then checks
the result without pretending to extract architectural meaning itself. Forward changes start from
an authored C4 delta: `loam` projects it onto each affected boundary, generates digest-stamped
Gherkin, and checks that behavior, architecture, contracts and evidence still join.

## Contents

- [Why](#why) · [System shapes](#one-lifecycle-several-system-shapes) · [Install](#install) ·
  [Quick start](#quick-start) · [Commands](#commands) · [Working with AI agents](#working-with-ai-agents)
- [Docs](#docs) · [Development](#development) · [Status](#status) · [Contributing](#contributing) ·
  [Security](#security) · [License](#license)
- Companion pages: [QUICKSTART.md](QUICKSTART.md) — install-to-first-change ·
  [WORKFLOW.md](WORKFLOW.md) — the protocol · [SCHEMA.md](SCHEMA.md) — the reference ·
  [ROADMAP.md](ROADMAP.md) · [COMPARISON.md](COMPARISON.md)

## Why

Software architecture does not live in one artifact. A business-simple feature can cross modules,
processes or services while C4 diagrams, requirements, API contracts, permissions and test evidence
drift independently. `loam` makes the authored C4 model the center and gives those artifacts
referential integrity: every join below is an exact token spelled in two places, never a heuristic
over prose.

| The join | Ties |
|---|---|
| `Operations:` ↔ OpenAPI `operationId` | a requirement to the endpoint it governs |
| `Publishes:` / `Consumes:` ↔ AsyncAPI message names | a requirement to the event spine |
| `Covers:` ↔ C4 elements, `#obl-` tags, `health.yaml` ids | an architectural obligation to what it accounts for |
| `Requires:` ↔ `architecture/permissions.yaml` | a requirement to the system-wide authorization vocabulary |
| `Realizes:` ↔ `capabilities/<cap>/spec.md` | a service requirement to the business promise it keeps |
| `#cap-` / `#req-` on a `dynamic view` ↔ a capability requirement | a cross-service use case to the promise it keeps |
| a Markdown link ↔ `glossary/<term>.md` | a document to the word it uses |

Architecture has its own requirement axis (`arch.spec.md`) because a business spec will not mention
the transactional outbox, retries or alerts.

### One lifecycle, several system shapes

Topology changes where loam's checks pay off; it does not change the lifecycle:

- **A modular monolith is one governed boundary.** Bind one root element to one
  `services/<app>/` directory and draw modules, components and their relationships beneath it.
  `Covers:` can name those nested elements and edges, and a feature's `delta.likec4` can change
  them through the same validate/archive transaction as any fleet change.
- **A distributed system is several governed boundaries.** Each service gets its own directory and
  binding; cross-boundary edges can join to provider OpenAPI operations or AsyncAPI messages, and a
  feature is projected onto every boundary it touches.
- **A hybrid uses both shapes at once.** A modular application can sit beside independently
  deployed services and external systems in the same landscape. The binding, not the C4 kind or
  nesting depth, decides which `services/<id>/` owns an element.

For example, the frozen `service` term can name an application while its internal modules remain
ordinary C4 elements:

```likec4
specification {
  element softwareSystem
  element component
}

model {
  commerce = softwareSystem 'commerce-app' {
    metadata {
      service 'commerce-app'
    }

    orders = component 'Orders module'
    billing = component 'Billing module'
    orders -> billing 'Reserves credit'
  }
}
```

An internal edge normally carries no `metadata { op }`: that key specifically joins a call to the
governed boundary's OpenAPI contract. An architecture requirement can instead say
`Covers: commerce.orders -> commerce.billing`. Fleet-level maturity, dependency and scorecard views
still aggregate at the bound `service`; nested elements get architecture coverage and feature
lifecycle, not a separate deployment status invented for each module.

**There is no extractor, and there will not be one.** Nothing deterministic reads a legacy service
and says what its architecture *means*, and a model that was guessed is worse than none — everyone
downstream has to re-derive it to know whether to believe it. So loam takes the half of the job that
is mechanical: it **states the work** and it **checks the result**. An agent does the reading, and
both halves are written down: the question in the brief or the checklist, the answer in `sources` or
`verification.yaml`.

### What green means here, and what it does not

Most of this category will tell you what it checks. loam ships the other list too, in the binary:
**[`src/core/brief/unchecked.ts`](https://github.com/ybotok/loam/blob/main/src/core/brief/unchecked.ts)
is fifteen statements of what no check will ever tell you**, printed into the adoption brief beside
the checks that do run. It says, in loam's own words, that nothing here knows whether the model is
the architecture the code actually has, whether a requirement is *true*, whether an `operationId` is
the one the code serves, or whether `sources` names the files anybody read. And it says the one that
matters most: **completeness is unchecked** — forty behaviours documented as one requirement passes
every check loam has, and so does a service with one endpoint documented out of thirty.

That list exists because a check that is silent for want of anything to ask must never read as a
check that passed. Green here means *the documents agree with each other* — never that they are
true, and never that they are complete.

The same refusal runs through the evidence model. `loam verify` records who answered every claim,
and keeps two answers permanently distinguishable:

- **`verified`** — a digest-tagged scenario answered by a green test run. The digest is taken over
  the scenario's *body*, so rewording a `Given` breaks the link on purpose. Tag-based coverage
  (`@REQ-1234` and its relatives) survives any rewrite and goes on asserting a claim nobody
  re-checked.
- **`attested`** — an agent's word, with `file:line` evidence at an attested commit. Recorded in
  full, labelled on every surface, and never promoted. A feature whose scenarios rest on attestation
  does not become verified because a gate would be greener if it did.

Neither gates the archive. The claim loam makes for its evidence is persistence and honest
provenance — not that every recorded judgement is true.

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

For the shortest install-to-first-feature path, including the exact chat commands and local problem
report flow, use [QUICKSTART.md](QUICKSTART.md). The routes below explain the alternative starting
positions in more depth.

`loam --help` ends by naming where to start and the way out, and this section is the same two
commands in the same order: **`loam init --create`** first — every other command needs the docs repo
it writes — and **`loam doctor`** whenever a later run does not do what you expected, which reports
the runtime, the resolved `docsDir`, the access, the binding, and any finding with its `fix:` line.
Each path below is that first command aimed at a different starting position; `loam diff` is the one
that needs neither.

### Start from the fleet spine

The path that pays off first, because it is the only one whose checks have two sides to compare.
It needs **no requirement Markdown, no `loam adopt`, and no `loam vouch`** — just the map and the
contracts you already have.

Write a `fleet.yaml` naming your services and who calls whom
([`examples/fleet.yaml`](https://github.com/ybotok/loam/blob/main/examples/fleet.yaml) is a real
one), then:

```bash
loam init --docs . --create        # in an empty directory: the docs repo
loam seed --from fleet.yaml        # the fleet map + one services/<id>/ per service
```

Now do the two things only you can do:

1. **Drop each service's existing `openapi.yaml`** into `services/<id>/`. Copy the one your build
   already produces — loam never generates it and never reads your code.
2. **Name the operation on each call edge** in `architecture/landscape.likec4`:
   `metadata { op 'createOrder' }`. This is the labour, and it is also the artifact nothing else
   produces — a drawn arrow becomes a checked join.

```bash
loam validate --all
```

That already convicts the fleet's real edges: a call naming an operation its provider does not
define is `spine.op-undefined`, an **error**, and one letter is enough — `authorisePayment` against
a contract spelling it `authorizePayment` fails here and nowhere else a team normally runs.

**Expect a red run, and read it correctly.** Five seeded services with no C4 centre report
`service.no-model` (error) five times, and `service.no-spec` (warn) five times. Those are not
misconfiguration: they are a truthful reading of a fleet where adoption has not started, and they
stay until you write those documents. The finding you came for is the spine one.
[`test/spine-first.test.ts`](https://github.com/ybotok/loam/blob/main/test/spine-first.test.ts)
pins this whole sequence against the shipped `examples/fleet.yaml`, so the recipe cannot drift from
the binary.

From here, [WORKFLOW.md's day zero](WORKFLOW.md#day-zero-onboarding-a-fleet) is the rest: bind each
service repo, adopt, grade, promote.

### Guard the fleet's edges on every PR

Two commands, each installable on its own with no part of the workflow above adopted. **`loam diff`
exits 1 when a pull request removes an operation or an event message the fleet still consumes**,
and names the consumers. That question — *who still calls this?* — is the one a fleet answers wrong,
and it is answerable only from a document that knows the whole fleet. **`loam validate --all --base
<ref>` grades only the boundaries the branch touched**, which is what lets a strict gate go in on
the first day of adoption and tighten as the system gets written down.

```yaml
# .github/workflows/fleet-edges.yml — in the docs repo
name: fleet edges
on: pull_request
jobs:
  edges:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # both read the base out of git history
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      # did you break a consumer?
      - run: npx -y @ybotok/loam diff --base origin/${{ github.base_ref }}
      # did you document what you touched?
      - run: npx -y @ybotok/loam validate --all --base origin/${{ github.base_ref }} --strict
```

Two gates, two different questions, and neither is the other's cheaper form. `diff` reports every
removal against the system's current consumers rather than against a rule list, which is why it
repays installation before anything else exists. `validate --base` grades the boundaries this
branch changed, at full strictness, and says out loud how much of the system that was — a run with
nothing in scope prints that it graded nothing rather than the word valid. Unscoped, neither
setting is usable on a partly-documented system: `loam validate --all` is green over boundaries
nobody has written yet, because warnings do not gate, and `--strict` over all of them is red from
the first minute of adoption until the last one is done.

**A `--base`-scoped validate cannot see a victim boundary the change did not touch.** Remove an
operation `payment-service` owns, and `checkout-web` — whose living requirement still names it —
is not in scope, so nothing in that gate reports the broken join. That is `loam diff --base`'s
question, it stays `loam diff --base`'s, and a green scoped validate is not a statement about the
consumers of what changed. [WORKFLOW.md](WORKFLOW.md#what-actually-gates) has what each does and
does not grade — including the oasdiff invocation for the byte-level OpenAPI breaking-change
catalogue, which loam deliberately does not reimplement.

### Try loam on one governed system in five minutes

The full model may be one application or a fleet; the trial is one repository. In the codebase you
know best (after [installing](#install)):

```bash
loam init --docs loam-docs --create --service commerce-app
```

One run does two things: it scaffolds a new docs repo at `loam-docs/` — `services/`, `features/`,
`architecture/landscape.likec4`, its own `AGENTS.md` and `loam.json` — and it binds this repository
to the id `commerce-app` in a committed `loam.json` beside your code (plus the slash commands and
Agent Skills for the AI tools it detects here — [Working with AI agents](#working-with-ai-agents)).
`init` ends by printing the first hour, which is this loop:

```bash
loam adopt --service commerce-app --json   # the brief: an agent reads the code, writes the baseline as draft
loam validate --service commerce-app       # grade the result in this repo
loam vouch --service commerce-app          # you, not the agent: draft -> verified
loam status                                   # what to do next, derived from the files
```

What the trial pays off on is the adopt → validate → vouch mechanics: the brief, the graded
baseline, the human promotion that makes later staleness detectable. In a modular monolith,
`arch.spec.md` and `Covers:` can already govern the nested model inside this one boundary. The
cross-boundary contract spine needs a second service — one boundary has no remote edge to join.
When a second service wants in, graduate to the full wiring:
[WORKFLOW.md's day zero](WORKFLOW.md#day-zero-onboarding-a-fleet) is the same steps, pluralized.

### Explore the example fleet

Installed from npm rather than cloned? The example fleet ships inside the package, and one command
copies it out — through the same journaled write path every other loam writer uses, byte for byte.
It binds no repository, records no `docsDir`, and writes nothing outside the directory you name:

```bash
loam init --example ./loam-demo
cd loam-demo && loam validate --all     # 0 errors, 10 deliberate warnings
```

That tree is the one the repo ships under
[`examples/docs/`](https://github.com/ybotok/loam/tree/main/examples/docs) — five services, two
features already shipped, two in flight, the event spine, the permission vocabulary, the business
tree, and two verification records that read `attested` and `verified` so the difference between
them can be seen standing.
[`examples/README.md`](https://github.com/ybotok/loam/blob/main/examples/README.md) is the guided
tour: what each service is there to show, and what every one of the ten deliberate warnings
demonstrates. From a clone, step into the fleet where it sits and run the real commands — it carries
its own committed `loam.json`, so there is nothing to write first and nothing to delete afterwards
(working from source instead of an installed binary, substitute `npx tsx ../../src/cli.ts` for
`loam`):

```bash
cd examples/docs                    # the tree governs itself: its loam.json says "docsDir": "."
loam list                           # the fleet and its maturity ladder
loam status                         # what to do next, derived from the files
loam validate --all                 # the CI gate: 0 errors, 10 deliberate warnings
loam archive FEAT-101 --dry-run     # the whole three-axis merge plan, writing nothing
loam archive FEAT-112 --dry-run     # an operation being retired, writing nothing
loam verify FEAT-088                # a shipped feature's done-check: attested
loam verify FEAT-120                # its pair, same check: verified
```

`test/examples.test.ts` pins the validate summary and every finding code, and both archive plans
file-for-file, so those outcomes cannot drift from the code; the `list` rendering is not pinned.

## Commands

Every command takes `--json`; findings carry stable codes (`c4.valid`, `spine.op-undefined`,
`coherence.ok` …) so an agent branches on the code, not on prose. Flags are listed in full below —
`loam <command> --help` is the same list from the binary you are running, and
[WORKFLOW.md's command notes](WORKFLOW.md#command-notes) is the per-command behavior that a table
cannot hold.

| Command | Flags | What it does |
|---|---|---|
| `loam init` | `--docs <dir>` `--service <id>` `--create` `--force` `--tools <ids>` `--agent-profile <full\|service\|docs>` `--example <dir>` `--no-commands` `--no-skills` `--mcp` `--mcp-author` | Bind this repository to the single shared docs repo: a committed local `loam.json`, plus command and Agent Skill pointers for detected AI tools. Profiles narrow the six lifecycle workflows to a repo's role; the support-only `loam-report` stays in every profile. Re-running init refreshes only unchanged loam-owned pointers; edited files are preserved. `--mcp` writes the read-only host entry, while `--mcp-author` opts into the bounded authoring tools. `--create` scaffolds the docs repo; `--example` copies the packaged example and stops |
| `loam seed` | `--from <file>` | Template the fleet map and one `services/<id>/` directory per service from a tiny human-authored `fleet.yaml`. Mechanical, never a guess: a human stated every fact. Refuses once the landscape has been hand-edited |
| `loam list [services\|features\|capabilities\|glossary]` | `--archived` `--needs-work` `--review-order` `--subsystem <name>` `--owners <path>` | What is in the docs repo, and what is missing from it. `capabilities` rolls up who realizes each promise; `glossary` rolls up each term with the documents that cite it |
| `loam status [<FEAT>]` | `--service <id>` | Where the work stands and what to do next, as a projection over the two gates. Each `next[]` row has an `execution` object that says whether it is runnable, where, and what input or edit is still needed. Derived every run; writes nothing |
| `loam doctor` | — | Read-only preflight for runtime, config, docs-repo access, fleet roots, counts, and the current service binding. Blockers exit 1; incomplete optional bindings stay warnings |
| `loam dependencies [<FEAT>]` | — | The active-feature dependency graph and same-identity conflicts, derived from requirement deltas and OpenAPI operationIds |
| `loam diff` | `--base <ref>` | Semantic diff of the living docs against a base git ref of the docs repo — the review lens for a docs-repo PR, with the current consumers of every removal named. Exit 1 on a removal the fleet still consumes |
| `loam explore [<service>...]` | `--op <operationId>` `--capability <id>` `--as <FEAT>` | Read the fleet around a change nobody has written down yet: the ring one hop out, each service's maturity and living operations, the features already in flight over the same ground, and the `loam new` line the seeds imply |
| `loam context <service>` | `--feature <FEAT>` | Assemble one service's docs slice — living requirements verbatim, both contracts, the fleet edges around it, permissions, capabilities, provenance, and every active feature's delta over it — as one deterministic briefing |
| `loam steps` | `--service <id>` `--duplicates` `--json` | Inventory the step phrases of one service's scenarios: how many distinct steps its suite is written in, how few definitions cover most of them, and which phrases differ only by an article or a trailing clause. Reads the living specs, writes nothing — the work-list a team writes its step definitions from, diffed against the optional `services/<svc>/steps.yaml` catalogue when one exists |
| `loam instructions [<workflow>] [args...]` | `--no-fix-tables` | Print one of the six workflow protocols, the separate `loam-report` support protocol, or one of the four reference pages `loam-codes`, `loam-spine`, `loam-authoring` and `loam-done-check`, version-matched to this binary. Workflow `$1`/`$2` placeholders are filled; support/reference pages take no arguments. Reads no config. `--no-fix-tables` collapses the per-code fix tables to a line each, keeping the paragraph that says which scope graded them: `loam-check`'s page goes 84,151 bytes to 3,541, while a support/reference page holds no such table and comes back byte-identical |
| `loam explain [<subject>]` | `--codes` | Explain a finding code, a refusal code, or a concept term. Most finding prose is parsed at runtime from the shipped fix tables, so it cannot drift from the binary; the `doctor.*`, `next.*`, `diff.*` and `gate.*` families, which no fix table grades, are answered from a registry written beside them. Every text-mode refusal prints `<code>  ·  loam explain <code>` on stderr and every non-`ok` finding line carries its code in parentheses, so the lookup is reachable without re-running under `--json`. Omit the subject to list the terms; `--codes` lists the whole vocabulary — 293 finding codes and 46 refusal codes, each row the same answer `explain <code> --json` gives for that one |
| `loam open` | `--root <dir>` `--out <file>` `--force` | Write a `.code-workspace` joining the docs repo and every service checkout whose committed `loam.json` binds to it. Never overwrites without `--force` |
| `loam mcp` | `--author` | Serve fourteen read tools, version-matched instruction resources and a declared envelope output schema over MCP. `--author` adds `new`, `rebase`, `gherkin` and an archive dry-run; it never exposes `vouch`, verification recording or a committing archive — [the MCP server](WORKFLOW.md#the-mcp-server) |
| `loam new <FEAT>` | `--title <text>` `--touches <id>` `--new-service <id>` `--capability <id>` | Scaffold a feature: intent, C4 delta, a requirement delta per service named by `--touches`/`--new-service`, and a capability delta per promise named by `--capability` (all repeatable) |
| `loam show <service\|FEAT>` | `--type <kind>` | Everything loam knows about one service or feature. A feature's JSON includes a semantic `review` pack: intent, exact architecture objects, API/event slices, dependencies, artifacts, verification, blockers and next actions. `--type` forces an ambiguous reading |
| `loam subsystem <verb> [names...]` | `--into <name>` `--under <name>` `--title <text>` `--description <text>` `--owner <name>` | Manage the grouping tree under `services/` — a navigable tree no identity depends on. `new`/`rm`, `move … --into`, `rename`, `list`, `history`, `sync` |
| `loam adopt` | `--service <id>` `--subsystem <name>` `--targets` | Brief an agent to write this service's baseline into the docs repo as `draft`: the target paths, the grammar of each, what the landscape already says, and the checks that follow. Writes nothing. `--targets` narrows it to what varies by service — the walk, the 37 checks and the fifteen statements of what nothing checks are the same bytes everywhere, so a `full` field names the one run that carries them: 42,873 bytes to 17,805 |
| `loam delta <FEAT>` | `--service <id>` | Project a feature onto one service: the intent, its requirement deltas with every body and Given/When/Then line verbatim, the endpoints it adds or retires, and the edges around it. Doubles as a coding-agent task |
| `loam gherkin [<FEAT>]` | `--service <id>` `--dry-run` | Emit spec scenarios as digest-stamped Gherkin `.feature` files into the service repo's `<gherkinDir>/loam/` |
| `loam rebase [<FEAT>]` | `--service <id>` `--dry-run` `--living` | Pin the feature to the living versions it was written against, on the requirement axis and the contract axis. `--living` takes no feature: it pins the living corpus's `Realizes:` entries to the capability requirements they name, which is what makes `capability.realizes-stale` able to fire later |
| `loam validate [<id>]` | `--service <id>` `--feature <id>` `--all` `--base <ref>` `--strict` `--errors-only` | Validate one service or feature, or the whole fleet in one run. JSON findings carry `locations[]`: an exact primary location when the check knows one, otherwise the narrowest proved scope. `--base` is the adoption ratchet, not a substitute for `loam diff`; `--strict` exits 1 on warnings; `--errors-only` drops the `ok` confirmations from the text view, keeping every warning |
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
Every envelope also says what answered it — `contractVersion` for the shape and `version` for the
binary — because the two move independently: a release bumps one and leaves the other alone, so a
new build never reads as a contract break, and a green run from a loam that is behind is
recognisable as one. Every success payload carries `command`, so a host holding a pile of envelopes
branches on one field instead of guessing from the presence of `valid` or `services`.

## Working with AI agents

`loam init --create` writes `AGENTS.md` into the docs repo — the process contract, travelling with
the thing it describes; a join finds it there and refuses a `--docs` target without one. Into the
repo it runs in, every `init` writes pointers for the six workflow bodies (`loam-adopt`,
`loam-feature`, `loam-implement`, `loam-check`, `loam-verify`, `loam-ship`) plus the separate
`loam-report` support protocol, **twice each for nineteen of the
twenty-one targets**: as a command file you type — `/loam-check` for most, `/loam:check` where the
tool namespaces by directory, `@loam-check` in Amazon Q's prompt library — and as an Agent Skill
at `<tool-dir>/skills/loam-<x>/SKILL.md`, which the model loads by itself when the task matches. Two
targets are skills only: Codex reads `.codex/skills/` and loads no custom command files, and
`agents` is not a tool at all but the vendor-neutral `.agents/skills/` root that Cursor, GitHub
Copilot, Codex, Gemini CLI, Zed and Roo Code each document reading — one copy those six share
instead of six copies of the same bytes. `--no-commands` and `--no-skills` each suppress one
delivery.

**The explicit command is the recommended, predictable entry point; natural language remains a
shortcut.** A normal chat lifecycle is `/loam-feature FEAT-101 "Split payments"` to propose,
`/loam-implement FEAT-101 payment-service` in each affected checkout, `/loam-check`,
`/loam-verify FEAT-101`, then `/loam-ship FEAT-101`. Most hosts use the flat slash spelling;
Gemini namespaces it as `/loam:feature`, Amazon Q exposes `@loam-feature`, and a skills-only host
uses its explicit skill syntax such as `$loam-feature`. Saying “implement FEAT-101” may load that
same skill automatically. Both routes reach the same binary-owned protocol; after entry, the agent
runs the status/edit/validate loop rather than asking the user to type every internal command.

When the binary or agent integration behaves unexpectedly, `/loam-report` (or `$loam-report` on a
skills-only host) collects a sanitized, reproducible local report under `loam-reports/`. It records
the version, doctor/status evidence, stable codes, write state and the smallest safe reproduction;
it does not repair the repo, retry a writer, include secrets, or upload anything. The support
protocol ships in every agent profile but remains outside the six-step lifecycle.

Which tools is detected from the repo: `init` scans each of the 21 targets it knows for its own
marker paths — usually just its dot-directory, but Copilot's are the files *inside* `.github/` and
the vendor-neutral one's is `.agents/skills/` rather than `.agents/`, because almost every repo has
a `.github/`, a `.agents/` is claimed by other conventions too, and almost none of either means the
tool. It writes for the ones it finds, and falls back to Claude Code when it finds none.
`--tools <ids>|all` overrides the scan; an unknown id is refused, not skipped. `--agent-profile`
selects `full`, `service` or `docs`, so a service checkout need not install feature-authoring and
shipping entry points. `loam.json` records the tools, profile and sha256 of every pointer loam owns;
that is how `doctor` distinguishes missing managed files from workflows nobody selected.

**A generated file is a pointer, not a protocol.** It carries what does not move between releases —
what the workflow is for, and the verbs in order — and defers this release's flags, finding codes
and fix tables to `loam instructions <workflow>`, which ships inside the binary you are about to
run. That split exists because the two go stale in opposite directions and only one of them is
fixable: embedded protocol text eventually describes a different loam with total confidence, while
the command cannot. Pointing at the binary is also what makes the protocol
affordable to load: `loam instructions loam-check --no-fix-tables` prints the same page with its
per-code fix tables collapsed to a line each — 84,151 bytes down to 3,541 — and
`loam explain <code> --json` answers, in 473 bytes, whichever two or three of those rows a run
actually reported. A copy frozen into the generated file would have charged the full 84 KB every
session, and gone stale doing it. `AGENTS.md` itself was the one generated file that argument did
not reach — it was the process contract *and* the reference manual, and every session paid for all
of it — so four **reference pages** now come out of the binary instead, printed by
`loam instructions`: `loam-codes` (which codes each invocation can raise), `loam-spine` (every join
between the artifacts, and the `Based-On:` pins), `loam-authoring` (`arch.spec.md`, the generated
Gherkin suite, frontmatter) and `loam-done-check` (how `loam verify` derives its claims, and
verified versus attested). What stayed is what a reader needs to form a question at all: the layout,
the cycle, which element is which service, the validator's rules and the archive gate. The current
orientation is **8,762 bytes**, below both the 32,768-byte Codex chain limit and the smaller 12,000
workspace-rule ceiling. Detailed pages are fetched only when the task reaches them. `loam init`
writes **no file** for a reference page: a page printed on demand describes the loam you are
running, not the one that scaffolded the repository.

The code inventory is that same split applied twice, and the largest page is what it left behind.
`loam instructions loam-codes` lists which codes each invocation can raise — 331 of the 335 the
scaffolded docs name between them, the one fact no other surface carries — and no longer says what
any of them means, because `loam explain <code>` answers that from the binary actually running and a
paragraph written once at `init` cannot. Dropping the duplicated gloss came first and took the file
from 120,896 bytes to 109,399; moving the inventory off it took the remaining 79,679. The OpenSpec
migration codes keep their notes inline on the page, because they are 49 of the 51 codes
`loam explain` does not answer yet, and a pointer to an explanation that does not exist is worse
than the prose it replaced.

**Refresh is ownership-aware.** Re-running `loam init` may replace a pointer only when its bytes
still match the digest recorded when loam last wrote it. The first human edit breaks that equality
and permanently wins; loam preserves the file and `doctor` reports its stale stamp for review.
Missing pointers are created. This gives unchanged repositories current entry points without an
`openspec update`-style overwrite of team customizations.

For hosts that reach tools through MCP rather than a shell, see [the MCP server](WORKFLOW.md#the-mcp-server).
Read tools declare `readOnlyHint`; every tool declares the shared envelope output schema; the compact
orientation and all workflow/support/reference pages are MCP resources, including a compact loam-check
resource without the 223-row fix table. `loam init --mcp` writes the
read-only host entry. `--mcp-author` is a separate explicit choice that adds bounded writers while
still excluding vouch, evidence recording and a committing archive. An existing `.mcp.json` is
always preserved byte for byte, with the entry printed for manual merge.

## Docs

- [QUICKSTART.md](QUICKSTART.md) — the shortest complete path from install to adoption, the first
  agent-driven feature, and a local problem report when something behaves unexpectedly.
- [WORKFLOW.md](WORKFLOW.md) — the working protocol: day zero, the artifact graph and its derived
  states, what gates and what only advises, the six workflows, the per-command notes, and how an
  agent drives the cycle from `--json`.
- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the decisions behind
  them: the coherence rules, how `archive` writes and `unarchive` undoes, operating at fleet scale.
- [COMPARISON.md](COMPARISON.md) — where loam fits beside architecture-as-code tools, software and
  event catalogs, contract verification and diff engines, requirements traceability, and code-level
  architecture checks. Each is treated as a neighbouring specialist, not an opponent loam needs to
  replace.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam: what
  maps, what is lost, what must be added.
- [ROADMAP.md](ROADMAP.md) — the evidence-backed improvement plan, priorities, non-goals and exit
  criteria.
- [CHANGELOG.md](CHANGELOG.md) — released beta.1–alpha.1 plus the changes on `main` under
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
# optional, against the exact upstream checkout named in MIGRATING-from-OpenSpec.md (the
# flag matters: --baseline defaults to canary, and the sweep refuses a checkout
# at any other HEAD):
npm run test:openspec-corpus -- --baseline release /path/to/OpenSpec
```

`npm run setup` is `bash scripts/setup.sh`, so on Windows use `npm ci && npm run build`.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rest — the local loop, what a reviewable change looks
like, and the release posture.

## Status

Every command in the table is implemented, including `verify --results` and its contract-test
sibling `verify --contract-results`, the full AsyncAPI feature lifecycle, OpenAPI path-item and
component baselines, the `architecture/permissions.yaml` authorization vocabulary, the declared- and
authored-capability axes with the `Realizes:` join, use cases graded as `dynamic view`s, the
`glossary/<term>.md` domain vocabulary checked through the links that cite it, and the
`architecture/obligations.yaml` architectural obligations checked through `#obl-` tags and
`Covers:`. Known limits, each with its owner in [ROADMAP.md](ROADMAP.md): the complete gate still
needs repeatable CI and installed-package evidence observed from an actual push. Speculative
`render`, health composition and UI generation come later. Behind that status stand **156 test files** (counted 2026-09-01): the count is graded
against a live readdir by `test/docs-facts.test.ts`, so this sentence fails the suite the moment it
trails the tree.

The package is published as [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam), currently
`0.2.0-alpha.1`: the unscoped `loam` name is taken by an unrelated GDAL wrapper, so the package ships
under the maintainer's own npm user scope. Releases are tag-driven and maintainer-only
([CONTRIBUTING.md](CONTRIBUTING.md)); the version this line names is pinned to `package.json` by a
drift test, so it cannot silently trail a release.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the complete local
gate and what a reviewable change looks like here.

## Security

Do not put vulnerability details in a public issue. Report privately through
[GitHub Private Vulnerability Reporting](https://github.com/ybotok/loam/security/advisories/new),
which is enabled for this repository; [SECURITY.md](SECURITY.md) says what to include and what to
leave out.

## License

[MIT](LICENSE)
