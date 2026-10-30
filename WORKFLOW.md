# The loam workflow

How work actually moves through a loam repository: what a feature owes, how loam decides where that
work stands, what gates and what only advises, and how an agent drives the whole thing from
`--json`.

[SCHEMA.md](SCHEMA.md) is the companion to this file. It is the reference — every artifact's
grammar, every rule, every decision. This one is the protocol: the order things happen in, and why
that order.

## Contents

- [The two flows](#the-two-flows) · [Topology and the governed boundary](#topology-and-the-governed-boundary) ·
  [The artifact graph](#the-artifact-graph) · [Derived, never stored](#derived-never-stored)
- [Actions, not phases](#actions-not-phases) · [What actually gates](#what-actually-gates)
- [The six workflows](#the-six-workflows) · [Support reports](#support-reports) ·
  [The honestly-small change](#the-honestly-small-change) · [Driving it from an agent](#driving-it-from-an-agent) ·
  [Host by host](#host-by-host)
- [Presence is not trust](#presence-is-not-trust) ·
  [Why there is no task list](#why-there-is-no-task-list)
- [Picking the work back up](#picking-the-work-back-up)
- [Day zero: onboarding a fleet](#day-zero-onboarding-a-fleet) · [Command notes](#command-notes) ·
  [The MCP server](#the-mcp-server) · [Build on the envelope](#build-on-the-envelope)

## The two flows

```
BOOTSTRAP (once per governed boundary, reverse):
    code ──adopt──►  brief ──agent──►  C4 baseline + capability spec   [truth = code]

FORWARD (per feature, generative):
    intent → C4 delta → Gherkin (BDD) → tests → code      [truth = model]
                 ▲                                   │
                 └──── done-check: verify ◄──────────┘
```

They run in opposite directions and that is the point. Bootstrap reads an implementation boundary
that already exists and writes down what is true about it; the code is the authority and the
document is the claim. Forward starts from an intent nobody has built yet; the model is the
authority and the code is the claim. Every rule below is downstream of which direction you are
facing.

**There is no extractor, and there will not be one.** Nothing deterministic reads a legacy service
and says what its architecture *means*, and a model that was guessed is worse than none — everyone
downstream has to re-derive it to know whether to believe it. loam takes the half of the job that is
mechanical: it **states the work** and it **checks the result**. An agent does the reading.

## Topology and the governed boundary

The lifecycle is topology-neutral; the storage vocabulary is deliberately not. Paths, flags and
finding codes use the frozen word `service` for one governed implementation boundary. That boundary
may be a network service, one modular monolith, a CLI, a worker, or another application whose code,
requirements, contracts and evidence are reviewed together.

In a modular monolith, one bound C4 root resolves to one `services/<app>/` directory and its nested
modules remain elements inside that boundary. They can be changed by `delta.likec4` and named by
architecture requirements through `Covers:` without acquiring invented service identities of their
own. In a distributed system, several bound roots resolve to several service directories and the
same model gains cross-boundary OpenAPI, AsyncAPI and use-case joins. A hybrid landscape contains
both shapes; the binding and its nearest bound ancestor decide ownership, not element depth.

This distinction matters operationally. Fleet reports, maturity and deploy dependencies aggregate
at the bound service boundary. Nested modules participate in model coverage and the change
lifecycle, but loam does not claim a separate repository, contract, maturity state or deploy order
for each one. The self-model under `meta/docs/` exercises that exact shape: one `loam` boundary,
with the source subjects nested inside it and governed through architecture requirements.

## Day zero: onboarding a fleet

This is the scale-up path of the
[five-minute trial](README.md#try-loam-on-one-governed-system-in-five-minutes): the same wiring, done
deliberately across every repository. A fleet of ten services is **eleven repositories**: one docs
repo and ten service repos, each with its own committed `loam.json`. There is no batch command and
no fleet manifest, deliberately — the wiring is one file per repo, and it is reviewable. In order:

1. **Create the docs repo.** In an empty directory that will be the shared source of truth:

   ```bash
   loam init --docs . --create
   ```

   That scaffolds `services/`, `features/`, `architecture/landscape.likec4`, `AGENTS.md`, and the
   docs repo's own `loam.json` (`docsDir: "."`, plus the `agentTools` it wrote for) — so every later
   command run *inside* the docs repo finds the fleet. An empty directory holds no tool
   dot-directory to detect, so the Claude Code fallback always fires here too: seven slash commands
   and seven Agent Skills under `.claude/` — six lifecycle entries plus `loam-report` ([Working with AI
   agents](README.md#working-with-ai-agents)). Commit all of it.

2. **Template the fleet map** from a tiny file you write by hand, rather than drawing it:

   ```bash
   loam seed --from fleet.yaml
   ```

   `fleet.yaml` is service ids, optional `subsystems`, `externals`, and `a -> b` calls — nothing
   else; [`examples/fleet.yaml`](https://github.com/ybotok/loam/blob/main/examples/fleet.yaml) is a
   real one for the five-service example fleet. Seed templates `architecture/landscape.likec4` and one `services/<id>/` directory per
   entry, in one journaled transaction, and guesses nothing: a human stated every fact in the file,
   which is what keeps seed on the same side of the no-extractor line as `loam new`. Re-running is
   safe — once the landscape has been hand-edited, seed refuses (`seed-landscape-edited`) rather
   than overwrite it. That makes seed a day-zero step: list every service id you already know in
   `fleet.yaml` up front, because the first `metadata { op }` below has no spelling in
   `fleet.yaml`. From then on the map grows without seed — `loam adopt --service <id>` briefs the
   element and edges a new service adds, and a feature's C4 delta carries every other change.

   Drawing it by hand instead is entirely legal, and the landscape is a **required** artifact
   either way, not an optional one: `loam validate --all` reports `landscape.missing` as an error
   the moment `services/` holds a directory (an empty one counts, before a single document lands in
   it), because with no fleet map every cross-service check is blind rather than passing.

   A hand edit that adds a service or an edge is followed by **`loam subsystem sync`**.
   `architecture/services.likec4` — one overview view per service the map draws — is generated
   from the map, and `loam validate --all` reports it stale (`subsystem.views-stale`) until it
   agrees. `seed`, the subsystem verbs and `loam archive` regenerate it in their own commits;
   an editor cannot, and `loam init --create` has nothing to write yet: the map it scaffolds draws
   no service, and a map that draws none owes no file. The scaffolded map's comment and init's
   closing list both name the step.

   What seed deliberately does not write is the operation on each edge. That token —
   `metadata { op 'createOrder' }` — is what turns a drawn arrow into a checked join, and adding it
   is what makes the [spine-first first hour](README.md#start-from-the-fleet-spine) pay off before
   any of the steps below have run.

3. **Bind each service repo.** Once per service, in that service's own checkout, beside the docs
   repo:

   ```bash
   loam init --docs ../docs-repo --service payment-service --agent-profile service   # no --create: it JOINS
   loam doctor                                                                        # confirms the wiring
   ```

   `--agent-profile service` writes the five workflows that run beside the code. Without it the
   profile is `full`, which also writes `loam-feature` and `loam-ship` — the two workflows the docs
   repo keeps — into the service checkout. `--service` is the binding: without it `loam vouch` and `loam gherkin` refuse outright, and
   `loam verify --service --record` / `--results` refuse to attest, because none of them will write
   a service's documents from a repo that has not said which service it is. Reading —
   `loam verify --service` on its own — needs no binding, because it writes nothing. Commit the
   `loam.json`.

4. **Adopt each service.** In its repo: `loam adopt --service <id> --json` emits the brief — every
   file to write, the grammar of each, what the fleet map already says, and the block the map still
   owes this service. An agent reads the code and writes the baseline as `draft`. `warnings[]`
   catches the typo case, where an id one letter off would have produced a complete, validating
   baseline for a service that does not exist.

5. **Grade it, twice.** `loam validate --service <id> --json` in the service repo (its own axes plus
   `sources`, which only that repo can resolve), then `loam validate --all --json` in the docs repo
   — the fleet cross-check that catches a landscape edit which never landed.

6. **Promote it.** A human runs `loam vouch --service <id>` in the service repo: `draft → verified`,
   stamping the source and content digests that make later staleness detectable. `loam list --json`
   in the docs repo then grades the whole fleet on the presence ladder
   `empty → partial → documented → sourced → vouched`, and `loam list --needs-work` is the remaining
   worklist — including any vouched service whose spec moved after the vouch (`vouched (stale)`,
   missing a re-vouch), which `loam status` names as `next.revouch`.

Steps 3–6 repeat per service and are independent — no ordering, no lock, no shared state between two
services' runs — so ten services can be onboarded by ten people in parallel. The one file they all
touch is the landscape: step 2 draws it, step 4's brief tells each of them to *add* their own
element to it where the map does not yet know the service, and step 5's `--all` reads it.

## The artifact graph

A feature is a directory. What it owes is a fixed set of artifacts — no per-project schema, no
configurable graph, because a governed system needs one lifecycle and one meaning of green:

| Artifact | Per | Required | What it is |
|---|---|---|---|
| `intent.md` | feature | yes | The problem in business terms. The proposal: why this exists, before any structure |
| `delta.likec4` | feature | no | New elements and edges, each tagged with the feature id. The design. A requirements-only change deletes it |
| `specs/<svc>/spec.md` | service | yes | The behaviour delta — `ADDED` / `MODIFIED` / `REMOVED` requirements, each with Given/When/Then scenarios |
| `specs/<svc>/arch.spec.md` | service | no | The architectural obligations a business spec never mentions: outbox, retries, idempotency, alerts. Same grammar, plus `Covers:` lines tying each to the C4 elements it accounts for |
| `specs/<svc>/openapi.yaml` | service | conditional | The contract delta: only the operations the feature adds, changes or removes — an operation it leaves out stays as the living contract has it. Owed when the living docs hold no contract for the service and something the feature writes joins into one — an `Operations:` line, or a tagged edge calling an operation on it — the same evidence `service.no-openapi` reads once the service is living. A service nothing calls owes none, whether the feature introduces it or it is already adopted |
| `specs/<svc>/asyncapi.yaml` | service | no | The event-contract delta: an AsyncAPI 3.0 document holding only the slots the feature adds, changes or removes. `loam rebase` pins each one the living contract already has (`x-loam-based-on`), `x-loam-remove: true` retires one |
| `verification/<svc>.yaml` | feature | yes | The done-check record, one file per attesting service: every claim, its answer, its evidence, and who gave it. The all-at-once form writes the one file `verification.yaml` instead |

Two fleet/living axes sit beside this feature graph. `services/<svc>/asyncapi.yaml` joins
`publishes`/`consumes` edges to `Publishes:`/`Consumes:` requirements, and the event axis carries
the full feature lifecycle: the delta above is slot-pinned by `loam rebase`, graded by
`validate --feature` (baseline, removal-justification and conflict findings), merged by
`loam archive` inside the same transaction as every other write, undone by `loam unarchive`, and
asked about by `loam verify` (`event.declares`). `architecture/permissions.yaml` is the opt-in
authorization vocabulary: requirements name `<subject>/<permission>` pairs with `Requires:`; unknown
pairs are errors and unused declarations are warnings. [SCHEMA.md](SCHEMA.md#canonical-joins) is the
canonical join table.

Three of those "no"s are load-bearing. An artifact that is legitimately absent reads `done` —
nothing is owed — with `exists: false` beside it, so a reader can tell that from a file that is
present and fine. Marking everything required is how an axis that is optional everywhere gets
reported as missing everywhere and then ignored.

**Dependencies are enablers, not gates — with one real exception.** You can author these in any
order. The verification record is the exception, and it is a genuine impossibility rather than a
preference: its checklist is *derived* from the delta and the per-service specs, so with none of
them written there is no question set to answer. That artifact alone comes back `blocked`, naming
what it is waiting on.

### The states

Every artifact grades to one of five words:

| State | Means |
|---|---|
| `missing` | Required, and not there |
| `blocked` | Cannot be authored yet — its inputs do not exist |
| `draft` | It is there, and a check reported something that names it |
| `ready` | Everything is answered, but not yet confirmed the strong way |
| `done` | Nothing is owed here |

The grading asks **two questions in order**: is it there, and does anything reported name it. That
second question is what separates loam's graph from a file-existence check. A `spec.md` that exists
and contradicts the living spec is `draft`, not `done` — the file is present, and presence was never
the claim. A graph that reads existence alone would call that feature finished.

## Derived, never stored

Nothing above is written down anywhere. `loam status` recomputes the whole table on every run, from
the files, and writes nothing:

```bash
loam status --json
```

There is no state file, no database, no cache, and therefore nothing to go stale, nothing to
reconcile after someone edits a file by hand, and no second source of truth to disagree with the
first. Delete loam and every artifact remains as Markdown, LikeC4 DSL, Gherkin and YAML.

The cost is honest: `status` re-reads and re-parses. On a 120-service fleet with ten features in
flight that is about 1.3 seconds, most of it the per-feature C4 parse, and it is nearly flat in the
size of the fleet. That is the price of never being wrong about what is on disk.

The fleet scorecard follows the same rule at fleet scale. `loam validate --all --json` carries an
additive `scorecard` key of ceiling-vs-actual pairs — operations defined → governed, messages
defined → linked, the maturity rollup, verification verdicts, feature stages, per-axis adoption
counts (an axis no service participates in reads "not started", expected mid-adoption) — recomputed
from that run's own reads. loam keeps no history for it, so tracking the trend week over week is the
pipeline's job: capture the key from each fleet-gate run into a metrics store and diff there.

## Actions, not phases

There is no phase lock. Any action, any time — because real work does not proceed in one direction:
building reveals a design flaw, which rewrites a requirement, which regenerates a suite.
`loam status`'s `next[]` is ordered *advice*, not a sequence you are held to, and running a step out
of order is not an error state loam has to be talked out of.

What loam does instead is make the consequences of going backwards visible. Change a requirement
after generating its Gherkin and the suite's digest no longer matches, so `loam validate` reports
the suite stale — by digest, not by anybody's intentions. Edit a feature's documents while another
feature is in flight and `loam rebase` is what stops the two silently reverting each other. The
protocol is not "do these in order"; it is "when you go back, here is what tells you what moved".

## What actually gates

Two things, and it is worth being precise about which, because everything else is advice.

**1. The archive coherence gate.** `loam archive` is the one command that rewrites the source of
truth. It computes the whole three-axis merge first, checks it for cross-axis coherence, and refuses
if the plan is incoherent. `--approve` carries the judgement calls; it deliberately does **not**
carry the two mechanical losses — a living document still holding git conflict markers, and a living
requirement that has strayed outside its `## Requirements` section. Those are not opinions about
risk, they are data loss, and an override for them is a footgun with a label on it.

The archive also leaves the fleet gate where it found it. A feature that adds a service or an edge
changes the two generated views files (`architecture/services.likec4`, one overview per service the
map draws, and `architecture/subsystems.likec4`), and the archive regenerates both in the same
commit, from the map and tree its own plan leaves, with `loam subsystem sync`'s render — so a clean
archive no longer leaves `validate --all` red until a second command runs. The step used to be a ⚠
after the merge; a step that has to be remembered is one a walkthrough forgets, and the archive is
the writer that just changed the files' inputs.
[SCHEMA.md](SCHEMA.md#subsystems--a-navigable-tree-under-services) records the rule and why it is
not a second writer that can disagree with `sync`. A hand edit of the map is still followed by
`loam subsystem sync`: loam cannot see an edit it did not make.

**2. The human vouch.** `draft → verified` is a person's act. `loam vouch` stamps the source and
content digests that make later staleness detectable, and no command promotes a service on its own.
That is the whole trust chain's anchor.

Re-vouching starts with `loam vouch --pack`: a read-only run that diffs the document's body from its
last vouched ancestor in the docs repo's history, lists the source files that moved since the stamp,
and names the sections a previous vouch already covers — so the person re-reads what changed instead
of everything. An agent may prepare the pack; the vouch itself is unchanged, still a person's act,
and `--pack` can never stamp (`--pack --yes` is refused).

**`verify` does not gate `archive`,** deliberately. Coherence gates because loam *computed* it. A
verdict is somebody's word about code loam never read, and a gate in front of shipping only teaches
everyone that the cheapest way past it is to say yes.

**`loam gate` does not add a third.** It is a pure query for DEPLOY pipelines outside loam's own
lifecycle — Pact's can-i-deploy insight: the gate executes nothing and asks what evidence previous
runs already recorded (the join partners' documentation state, staleness, the verification verdicts
of the features touching the service, an interrupted docs commit). Its verdict is advice to a
pipeline loam does not own — advisory by default, `--strict` the per-invocation CI lever — and it
deliberately changes nothing about what gates the archive: verify still never gates the merge, and
archive still reads no verification record. Know what `--strict` buys before wiring it: its
freshness check reads `content.stale` over the gated service **and every documented join partner**,
so one partner whose spec moved under its vouch — every archive into a vouched spec does that —
turns this service's `gate --strict` red until that partner's owner re-vouches from their own repo.
That is the question asked honestly (a deploy joins documents nobody has re-read), but it is
another team's queue: a pipeline that must not wait on it runs `gate` without `--strict` and
branches on the `content.stale` findings in `checks[]` itself.

Which features it grades is the one thing a pipeline has to say. Without `--since`, the gate reads
**in-flight features only**: a feature leaves the check the moment it is archived, so a slice that
deploys after its feature shipped is gated without it — and under `--strict`, archiving would be
the cheapest way past an unverified-feature warning. `loam gate --since <ref>` closes that: pass
the docs-repo commit your last deploy recorded, and every feature archived after it (its
`features/archive/<FEAT>/` directory absent at the ref, or changed since — a feature unarchived,
edited and archived again ships again) that touches the service is graded too, under the same
`gate.feature-unverified`, its `features[]` row carrying `archived: true`. Its record is frozen, but
held to the checklist `loam archive` captured as the feature merged (`checklistAtArchive` on the
row): a record that had stopped answering the feature before it shipped reads `stale`, so archiving
is no longer a way past the warning. A feature archived by a loam that captured no checklist is read
as frozen history, and the row says so (`checklistAtArchive: null`). The ref is
read from the docs repo's own git exactly as `loam diff --base` reads its base, with the same
refusals when git cannot answer. loam stores nothing for it — the pipeline already knows which docs
commit it deployed from.

**`loam diff` does not add one either — it is the review lens.** On a docs-repo PR,
`loam diff --base origin/main` says what the branch *changes* in fleet-meaningful terms: services,
requirements (by identity and content digest, so a rebase pin is not a change), operations,
messages, and the cross-service joins between them — with the authored consumers of every removal,
deprecation and contract modification named, which is what a reviewer actually needs to know.
`validate --all` remains the fleet gate; diff exits 1 on a removal the fleet still consumes
(`diff.op-removed-consumed`, `diff.message-removed-consumed`) — and also whenever a document on
either side could not be read, because a suspended axis is reported, never graded as "nothing
changed" — so a PR job gets those
checks for free, but a green diff is not a valid fleet: run both. For the byte-level OpenAPI
breaking-change catalogue, use oasdiff on the two states of one contract; [the `loam diff` command
note](#command-notes) below has the exact invocation, and loam deliberately does not reimplement
those checks.

Severity and gating are also two different questions. A coherence finding marked `gates` stops the
archive even when it is only a warning; an error in `validate` fails the check without necessarily
blocking a merge. Read the code, not the colour.

## The six workflows

Each is a protocol that ships inside the binary. `loam instructions <name>` prints it, with `$1`,
`$2` filled in from the arguments you pass:

```bash
loam instructions loam-feature FEAT-101 "Refund on partial capture"
```

The reliable chat path is explicit: `/loam-feature FEAT-101 "Refund on partial capture"`, then
`/loam-implement FEAT-101 payment-service`, `/loam-check`, `/loam-verify FEAT-101` and
`/loam-ship FEAT-101`. That spelling is flat on most hosts; Gemini renders the same entry as
`/loam:feature`, Amazon Q as `@loam-feature`, and a skills-only host uses its explicit skill syntax.
A natural-language request may load the matching Agent Skill instead. This is dual delivery, not
two workflows: both point at the same `loam instructions` page and the agent owns the internal
status/edit/validate loop after either entry.

`loam init` writes a slash command and an Agent Skill per selected workflow, plus `loam-report` in
every profile, into whichever AI tools it finds in the repo (`--agent-profile full|service|docs`).
Those files are **pointers** at
`loam instructions`, not copies of it — they carry the
purpose and the spine, and defer the flags, the finding codes and the fix tables to the binary you
are actually about to run. Init records each pointer's digest and refreshes it only while the bytes
still match; editing one revokes that authority. A protocol copy would still be as old as the
repository, while the runtime page cannot go out of date the same way.

`AGENTS.md` — the one file `init` lays down that every host auto-loads, and so the first thing an
agent reads — now works the same way, which changes the reading order. It is orientation only (the
layout, the cycle, what gates and what only advises, held under a 12,000-byte ceiling a test enforces
where it used to be 109,399 bytes), and the four **reference pages** it used to carry inline come
out of the binary at the moment the question arises: `loam instructions loam-codes`, `loam-spine`,
`loam-authoring` and `loam-done-check`, each taking no arguments and printing whole, listed beside
the six workflows by a bare `loam instructions`. A fifth reference page, `loam-drawing`, was never
part of `AGENTS.md`: read it before drawing an edge or a view, for the relationship kinds, the
legend and the overview views a person can read. `init` writes no file for any of them, so nothing new landed in the repo.

| Workflow | When | What it drives |
|---|---|---|
| `loam-adopt` | Once per service, before any feature touches it | `loam adopt` briefs the baseline; an agent reads the code and writes it as `draft`; validate twice — the service, then the fleet — and hand to a human to vouch |
| `loam-feature` | Starting a change — after asking whether it needs a feature at all (step 0) | `loam explore` to decide what it touches, `loam new` to scaffold, author the delta and the specs, write what they leave open under `## Open questions` in `intent.md` (ungraded), `loam rebase` to pin, `loam validate`, `loam dependencies` |
| `loam-implement` | Building one service's slice, in that service's repo | `loam delta` is the task, `loam gherkin` emits the acceptance criteria, step definitions come before code |
| `loam-check` | Any time; always before shipping | `loam validate`, and fixing what it reports by code |
| `loam-verify` | When the code is built | `loam verify` derives the checklist; the test runner answers what it can; you answer the rest with evidence |
| `loam-ship` | When it is really finished | `loam validate --feature`, `loam archive --dry-run`, then the merge |

### Support reports

`loam-report` is generated beside the workflows but is deliberately not a seventh step. Invoke
`/loam-report` (or the host's skill syntax) when loam, its generated integration, or the agent
following it behaves unexpectedly. Its version-matched body comes from
`loam instructions loam-report`.

The agent preserves the original symptom before investigating, collects the binary version,
`doctor --json`, relevant `status --json` and the smallest safe reproduction, then writes
`loam-reports/NNN-YYYY-MM-DD-<slug>.md` — `NNN` the next ordinal, at least three digits and
zero-padded, which `loam doctor` reports, and a
`Status: open` header line the team later edits to `sent`, `fixed in <version>` or
`superseded by <NNN>`. `doctor` reads that line from the header field block above the first `##`
heading, so a report quoting the protocol's template counts as whatever its own header says. It
classifies the evidence as a loam defect, project-data
problem, agent-workflow problem, host/infrastructure problem or inconclusive. A report contains
stable envelope/finding codes and short relevant excerpts, not a full environment or document
dump. Secrets and home paths are redacted. A writer is never repeated just to reproduce a failure,
and the protocol does not repair, upload, submit or send the report. The Markdown file is the handoff
artifact; a person decides whether to commit or share it.

### Deciding what a feature touches

This is the one decision in the cycle that nothing downstream catches, so it gets its own command.
`loam new --touches a --touches b` takes the answer as an argument and scaffolds whatever it was
told; a list short by one service produces a feature that validates, archives and ships with a
consumer nobody updated.

```bash
loam explore payment-service --json --as FEAT-101
```

It writes nothing and reports: the ring one hop out in the fleet map, each service's documentation
rung, what each already exposes, who already calls whom, the active features covering the same
services, and the literal `loam new` line the seeds imply. `--op <operationId>` seeds from an
operation when you know the call but not who owns it.

What it does **not** do is fold the neighbours into that command line. loam knows those services are
connected; it does not know whether this change touches them, and a suggestion that quietly included
them would make the judgement on your behalf while looking derived. Weighing the ring is the work —
this command just makes sure you are weighing all of it.

### The honestly-small change

**The smallest change needs no feature at all.** A change that touches no requirement, no operation
and no fleet edge — a refactor, a dependency bump, a fix that brings the code back to behaviour the
living spec already documents — changes nothing in the docs repo, so there is nothing to scaffold,
pin or archive. It is a code PR in the service repo, and then, in that repo:

```bash
loam validate --service payment-service       # the only place sources.stale is visible
loam vouch --pack --service payment-service   # read-only: what the moved sources owe a re-read
```

`sources.stale` names the paths that moved since the spec was last vouched, the pack is the reading
list, and the vouch itself is a person's. That is lighter than a feature by construction rather than
by exemption: there is no delta for a gate to grade, and the one signal that did move — the vouch —
is still owed. The moment the change alters what a requirement promises, it is a feature, however
small, and the lane below is the floor. `loam-feature`'s step 0 asks the same question first.

Most changes are not cross-service features. A one-service, requirements-only change — a new
refusal, a tightened invariant, behaviour behind an endpoint that already exists — walks the same
graph with most of it not owed, and the tooling already says so. The whole loop:

```bash
loam new FEAT-214 --touches payment-service
```

Delete the scaffolded `delta.likec4` — `loam new` says so on the way out: a requirements-only
feature is complete without it. Then author the two files that *are* the change: `intent.md` (why),
and `specs/payment-service/spec.md` (the ADDED/MODIFIED requirements, each with its scenarios).

Everything else is not owed, and `loam status` says which per row rather than leaving you to infer
it: the `arch.spec.md` and `asyncapi.yaml` rows read `done` with `(not written — none owed)`, and so
does `openapi.yaml` while the living contract already defines what the requirements govern — write
an OpenAPI delta only when the change governs operations the living contract does not have. `next[]`
collapses to three steps: `next.generate-tests` (emit the acceptance scenarios into the service's
own repository), `next.verify` (answer the checklist, the suite answering the scenario claims),
`next.archive` (merge the requirement into the living spec). A MODIFIED requirement still takes its
`loam rebase` pin on the way — the one step size never waives, because the pin is what keeps two
small changes from silently reverting each other.

Small is a fact about the change, not a lighter process: the same gate grades it and the same merge
ships it. What makes it honestly small is that every skipped artifact is skipped because nothing
joins into it — status prints the proof beside each row — never because somebody decided the
documentation could wait.

## Driving it from an agent

Every command takes `--json`, and the contract is built so an agent never has to read prose:

- **Findings carry stable codes** — `c4.valid`, `spine.op-undefined`, `coherence.ok`. Branch on the
  code. Prose gets reworded; codes do not.
- **The protocol has a narrowed form, and one code is answerable as data** —
  `loam instructions loam-check` is almost all per-code fix tables, and `--no-fix-tables` prints the
  same page in a few kilobytes with each table's scope paragraph kept. Branch on the code, then
  `loam explain <code> --json` for the two or three a run reported, or `loam explain --codes --json`
  once for the whole vocabulary — every finding and refusal code `loam explain` answers. The four
  families no fix table grades (`doctor.*`, `next.*`, `diff.*`, `gate.*`) are among them, so a code
  read out of a `status`, `doctor`, `diff` or `gate` payload is answerable as data like any other;
  the codes that are not are the OpenSpec migration surface (`openspec.*`, `mapping.*`), which an
  agent meets once before the repository is governed at all, and a couple of `ok`-severity
  confirmations.
- **`validate --json` already carries the fix for every code it raised** — `fixes` is a map keyed by
  code, so joining `findings[].code` to `fixes[code]` answers "what now" out of the payload you are
  holding: no `loam explain` round trip per code, and no fix table loaded into context to read one.
  Only codes a run actually raised appear, and a run with nothing to fix carries `{}` rather than
  nothing, so no consumer has to test for the key before looking one up.
- **`next[]` is ordered and executable without parsing prose.** The legacy `command` hint remains,
  while `execution` says `kind`, `cwd`, whether it is `runnable`, the concrete `command` only when
  it is safe to run, and otherwise the `needs`/`after` facts required to finish the step.
- **Findings point back to files.** Every serialized finding has `locations[]`: exact primary
  line/pointer data where its producer knows it, otherwise the narrowest service, feature or
  landscape scope loam can prove.
- **Three questions are kept apart**, each on the command that can answer it: `ok` (the command ran)
  on every envelope, `valid` (the docs pass) on `validate`, and `verified` on `verify` — beside
  `verdict`, which carries the third state, `attested`.
- **`loam status` takes the union** of what `validate --feature` errors on and what `archive`
  refuses to merge. It may be redder than either and is never greener than both.
- **`loam context <service> --json` is the one-command briefing** an agent loads before working in
  that service's repository: the living requirements verbatim, both contracts, the fleet edges one
  hop out, the permission and capability joins, and every feature in flight over the service — one
  deterministic payload, so two runs over the same state are byte-diffable. `--feature <FEAT>`
  narrows the in-flight section to the feature being implemented. Its `landscape` object carries
  `broken` beside `parses` — the `architecture/` documents that failed, docs-relative POSIX, deduped
  and sorted, `[]` while `parses` is true — spelled exactly as `landscape.invalid` and the adopt
  brief spell them. `parses` answers for the `architecture/` PROJECT, so the document at fault is
  very often a sibling beside a landscape that reads perfectly, which is why the key exists.
  `loam explore --json` carries the same key with the same meaning.
- **`loam show <FEAT> --json` is the review hand-off.** Its `review` object joins the intent summary,
  exact C4 objects, API/event slices, dependencies, artifact states, verification, blockers,
  advisories, use cases and executable next actions without making the reviewer reopen each file.
- **`loam delta <FEAT> --service <svc> --diff` is the line-level review.** Each requirement,
  operation and message carries `change` — `new`, `quote` (the living text restated unchanged),
  `edit` or `remove` — and an edit or a removal carries `diff`, the lines as `{ op, line }` with `op`
  one of `=`, `+`, `-`. A requirement is compared as the merge writes it, its `Based-On:` and
  `Realizes:` pins aside, and paired with its living requirement the way the merge pairs them; an
  operation by its node (its `$ref`s as written, not what they reach); a message by its node at the
  same slot. Without `--diff` the brief is byte-identical to what it was.

The loop is the same every time: `loam status --json`, read `next[0].execution`, run its command only
when `runnable` is true, otherwise satisfy its named edit/external input, then repeat. When a command
refuses, it refuses with a code and a sentence naming the fix —
`loam doctor`'s findings carry the exact command in a `fix` field.

## Host by host

The pointer files are one body in each host's spelling. What differs between hosts, as each host's
own docs described it on 2026-10-27:

| | arguments in the generated file | run `loam` without asking | MCP config `init --mcp` writes |
|---|---|---|---|
| Claude Code | `$feature`, `$service`, `$title`, named in `arguments:` | each skill's `allowed-tools`, written for you | `.mcp.json` |
| GitHub Copilot | prompt files: `${input:feature:…}`; skills: `<FEAT-id>`, from the request | CLI: `copilot --allow-tool 'shell(loam:*)' --deny-tool 'shell(loam vouch)'`; VS Code: `"chat.tools.terminal.autoApprove": { "/^(npx )?loam (?!vouch\\b)/": true }` | `.mcp.json` (CLI and VS Code); the cloud agent's JSON is printed for the repository settings |
| Codex | skills: `<FEAT-id>`, from the request | nothing to set: an installed `loam` runs inside Codex's sandbox | `.codex/config.toml`, read once the project is trusted |
| OpenCode | commands: `$1`, which OpenCode fills; skills: `<FEAT-id>` | `"permission": { "bash": { "loam *": "allow", "loam vouch*": "ask" } }` in `opencode.json` — the last matching rule wins | `opencode.json`, under `mcp` |

Claude Code counts `$N` from zero, so a numbered `$1` took a command's second argument; named
arguments have no index to get wrong. Hosts that fill in nothing — Cline, Kilo Code, Roo Code, and
every host reading a skill outside Claude Code — leave the placeholder standing, and
`loam instructions` reads a standing placeholder, in any of these spellings, as "not given": the
protocol prints with the placeholder in place rather than refusing. `loam vouch` stays out of every
allowlist above, and it refuses without a terminal or `--yes` besides.

`init --mcp` creates a host's config only where there is none. Where one exists it is left byte for
byte, and the `loam` entry is printed for you to paste. OpenCode's config counts in either
spelling, `opencode.json` or its `.jsonc` form.

**Copilot.** Every Copilot surface reads skills — `.github/skills/`, `.claude/skills/` or
`.agents/skills/` — and only VS Code's local harness reads prompt files, so the skills are the
delivery that matters there and carry `argument-hint`. The `github-copilot` target also writes
`.github/instructions/loam.instructions.md` — loam's own file, applied to every path — which tells
the cloud agent loam is here before it chooses a skill: a service repository has no AGENTS.md of
loam's to do that. It is skipped in the docs repo itself (`docsDir` naming the repository `init`
runs in, whatever the profile) and under `--agent-profile docs`: that repository has AGENTS.md.
`loam init --copilot-setup` writes
`.github/workflows/copilot-setup-steps.yml` once — Node.js, loam at this version (or `npm ci` where
loam is a devDependency), a clone of the docs repo where `loam.json` points, and `loam doctor` — and
never rewrites it. Its own comments say what a first task should confirm.

**Codex** reads skills from `.agents/skills/`, the root it documents, and that is where the `codex`
target writes them. It used to write `.codex/skills/`, which Codex still loads, so each skill showed
twice. A re-run of `loam init` for codex removes the copies there that loam wrote and nobody
edited; an edited one is left in place, listed under `superseded` and named in the human output.

**One copy for a mixed team.** `--tools agents` writes `.agents/skills/` alone, and Copilot,
Codex and OpenCode all read it, as do Cursor, Gemini CLI, Zed and Roo Code. A host's own target adds
what only that host reads — Copilot's `argument-hint` and its instructions file, OpenCode's
commands — and costs a second copy of each skill in the hosts that read both roots. Copilot and
OpenCode also read `.claude/skills/`, so a team that adds `claude` sees the same.

## Presence is not trust

Documentation existing and documentation being *believed* are different facts, and loam refuses to
let one read as the other.

Services climb a ladder — `empty → partial → documented → sourced → vouched`. The rungs are derived
from artifact presence and provenance state only, never from what the artifacts say: a service with
one endpoint documented out of thirty climbs exactly as fast as a thorough one, which is why no rung
is called "adopted". `sources` names the code a document was written from. `vouch` stamps digests
over both. Later, `content.stale` says the document moved and `sources.stale` says the code did —
the second one only answerable inside that service's own repository.

The same distinction runs the done-check. `loam verify` derives the claims; a `scenario.tested`
claim is confirmed **mechanically in the record** when a digest-matched green Cucumber report
answers it, and an `api.exposes` claim when an API contract-test report names its operationId green
(`--contract-results`, recorded as `answered_by: external-runner` with the consumed report pinned
beside the cucumber one). That proves which passing report bytes loam accepted; it does not prove
the report was produced by executing the attested commit. An agent may confirm one too — a legacy
service with no runnable suite has to be able to record its answers — but the record then reads
**`verdict: "attested"`**, not `verified`, and says so on every surface. `verified: true` in the
envelope means every scenario claim came from a test run.

loam does not claim agent answers are impossible. It claims they are *distinguishable*.

## Why there is no task list

There is no `tasks.md`, and that is a decision rather than an omission.

A task list authored beside a spec is a second mutable state. It drifts — the spec changes, the
checklist does not, and now two documents describe the work and only one of them is checked. The
question a task list answers is a good one; the file is the wrong place to answer it.

loam derives the answer instead, at three altitudes:

- **What to do next**, from `loam status`: the artifact table plus an ordered `next[]`, recomputed
  every run, so it cannot disagree with the files.
- **Which promise to pick up, and what closes it**, from `loam tasks <FEAT>`: one unit per promise
  the feature makes, each carrying the step it is waiting on and the fact that retires it. `--next`
  narrows it to the single leaf packet an orchestrator hands one coding agent.
- **What to build**, from `loam delta <FEAT> --service <svc>`: the intent, every requirement body
  and every Given/When/Then line reproduced verbatim, the endpoints added or retired, and the edges
  around it. That output *is* the coding task, and it is regenerated from the spec each time rather
  than transcribed from it once. An intent can run to hundreds of kilobytes, so all three briefs take
  `--intent-ref`: the intent rides by reference — its path, the sha256 of its bytes, its size, its
  outline and the lines of the open questions naming the service — and the agent reads the file once.
  A service's requirements can run as long, so `loam delta` and `loam context` take `--outline`:
  each requirement as its id, its joins and its scenarios' names, with the path and lines it sits at,
  and the agent reads one requirement at a time — at those lines, or with `--requirement <id>`.

Then `loam gherkin` turns the scenarios into digest-stamped `.feature` files — a checklist that
executes. A valid Markdown table becomes the `Examples:` of a Scenario Outline, so a permission or
status-code matrix remains one requirement scenario rather than twenty copied ones. A box you tick
is a claim about work; a scenario that goes green is evidence of it.

The same reasoning is why `intent.md` is a real artifact and a `design.md` is not. The intent is
input — a human's statement of the problem, which nothing can derive. The design is the
`delta.likec4`, which is checkable: its elements and edges resolve against the fleet map, its
operations against the contracts. A prose design document beside those would be a third description
of the same change, and the only one nothing grades.

The third altitude is new; the decision above is not. `loam tasks` is the `loam verify` checklist
read forwards — the same claims under the same ids, one unit per promise, each with the fact that
closes it — recomputed on every run from the delta, the generated suite and the verification record.
It is still not a file: nothing to tick, nothing to commit, nothing that can disagree with the
documents it was derived from, and so the reason there is no `tasks.md` is unchanged. A unit leaves
the list only when a confirmed claim in a non-stale verification record retires it, and an
agent-attested scenario stays on it at `attested` rather than being ticked off — the work list must
not be able to say more than the record does.

## Picking the work back up

The three states worth naming, because each has one command:

**You joined halfway, or lost the session.** `loam status --json` — for the fleet, or `loam status
<FEAT> --json` for one feature. It is derived, so it is correct about a repository you have never
seen, and `next[]` tells you whether the work is even to continue this feature.

**Somebody else is mid-merge.** `archive` takes an advisory lock on the docs repo for the whole
plan-and-commit; a second writer refuses with `docs-busy` rather than interleaving. Re-run when it
finishes.

**A merge was killed mid-write.** An intent journal is fsynced before the first file swap, and the
next `archive` or `unarchive` recovers from it under the lock: an interrupted archive is undone, an
interrupted unarchive is *finished* — the merged text it was replacing is written down nowhere else.
Where a file has been edited since, it refuses with `commit-interrupted` rather than writing over
the evidence. `loam doctor` reports that state instead of calling the repo healthy.

And the fourth, which is not recovery but is the same instinct: **you do not know what a command
will do.** `archive`, `unarchive` and `rebase` all take `--dry-run`, and `explore`, `status`,
`list`, `show`, `adopt`, `delta`, `dependencies`, `doctor`, `validate` and `instructions` write
nothing at all, ever.

## Command notes

One note per command that has behaviour a table cannot hold — the refusals, the flag interactions,
and the reason each is shaped the way it is. [README's command table](README.md#commands) is the
index: every command and every flag, one row each.

**`loam init`** — `--docs` **joins** an existing docs repo; `--create` is required to make a new
one, so a mistyped path cannot scaffold a second source of truth. `--service <id>` is what a
**service** repo needs: it is the binding `vouch`, `gherkin` and
`verify --service --record`/`--results` require before they will write for that service.
`--tools <ids>|all` overrides the tool scan; `--no-commands` / `--no-skills` drop one delivery — and
the two are exclusive, refused together, since one names the files to write and the other suppresses
them. `docsDir` is stored exactly as you typed it and resolved against `loam.json`, so a relative
`../docs-repo` works on every clone — and `--docs` wins only when you actually pass it, so a re-run
in a wired repo keeps the pointer its committed `loam.json` already spells, `--create` included
(`docsDirSource: "flag" | "config" | "default"` in `--json` says which).

**`loam status`** — the question an agent has when it joins a repo halfway or loses its session.
Artifacts come back `missing`/`blocked`/`draft`/`ready`/`done`, and `next[]` is ordered, each entry
a stable code plus its explicit `execution` plan. When this repository's `loam.json` binds a boundary the
fleet already has, that boundary's own steps are partitioned to the front of the fleet worklist
before its ten-entry cap applies — a stable partition, not a sort, so every other boundary keeps the
order an unbound reader sees and the work you are standing in can no longer be the entry elided. It
takes the union of what `validate --feature` errors on and what `archive` refuses to merge, so it
may be redder than either and is never greener than both. There is no state file to go stale.

**`loam new`** — the scaffold passes `loam validate --feature` with **zero errors**, and its
unauthored state is named in warnings that *gate the archive*: `intent.empty` until you write the
Why, `scaffold.placeholder` while any template text survives (a feature that introduces a service
also starts on `c4.uncovered`, until its `arch.spec.md` delta carries a `Covers:` line for the
element the delta adds). An untouched scaffold can never fold into the living docs — `loam archive`
refuses it until a person authors the content, or deliberately overrides with `--approve`. For a
requirements-only feature you delete the scaffolded `delta.likec4` yourself — `new` says so on the
way out.

**`loam adopt`** — the brief names the target paths, the grammar of each, what the fleet map already
says — the whole `architecture/` project, not the landscape file alone — the checks that follow, and
the ones that do not exist. The default human view now opens with
an orientation block before any of that: how many of those targets are required and still
outstanding, named, and what each flag in the artifact table means — `MISSING` required and absent,
lowercase `missing` optional and absent, `present` a document to diff rather than replace, and two
rows for the one target that is the whole system's shared map: `UNDRAWN` while nothing in the map
resolves to this boundary, and `EDGELESS` while an element does and no edge touches it. The map owes
an element in the first state and edges in the second, and `landscape.instruction` says which.
`--targets` drops the half that is identical for every service — the code walk,
the frontmatter rules, the 53 named checks and the seventeen statements of what nothing checks — and
replaces it with a `full` field naming the one run that carries them, which is 54,833 bytes down to
20,062 on the example fleet (measured 2026-09-04).

**`loam diff`** — the base state is read out of the docs repo's own git history
(`rev-parse`/`ls-tree`/`show`, read-only, no checkout), so it refuses (`repository-unavailable`)
when the docs repo has no history to ask and (`unknown-target`) when `--base` resolves to no commit
there. What it reports is the *joined*, fleet-meaningful delta — a removed operation is graded
against the consumers the archive gate reads too ([SCHEMA.md](SCHEMA.md), "Who still consumes it"):
the edges of the `architecture/` project, other services' `Operations:` lines in either spec file
(not one naming its own service's operation of the same id) and the use-case hops attributed to it
(`diff.op-removed-consumed`, exit 1); a removed message against its `Consumes:` lines,
consumes-edges and hops — and an artifact
unreadable on either side suspends that subject's axis and exits 1, because "nobody could look" must
never read as "nothing changed". The exception is an `openapi.yaml` or `asyncapi.yaml` that cannot be
read but is byte-identical at the base (an AsyncAPI 2.x file nobody has converted yet): the branch did
not touch it, so it is skipped rather than failing every PR. A spec file stays suspended even then,
because another service's removal may be the one that could not be checked against it.
A landscape edge into the provider drawn with no `metadata { op }`
is the same doubt at warning strength: it is listed as a consumer nobody could check, never dropped.
An operation or message whose own node or `$ref` closure moved is `diff.op-modified` /
`diff.message-modified` — a warning that names the same consumers and does not say whether the
change breaks them. `validate --all` remains the fleet gate; diff is the review lens.
For the byte-level OpenAPI breaking-change catalogue, run oasdiff on the two states of one contract:
`git -C <docs> show <ref>:./services/<id>/openapi.yaml > base.yaml && oasdiff breaking base.yaml <docs>/services/<id>/openapi.yaml`
(the `./` resolves the path relative to the docs directory rather than the git root, so this holds
when the docs repo lives inside a larger repository) — loam deliberately does not reimplement those
checks.

**`loam validate`** — `--base <ref>` takes `--all` and nothing else (a positional target,
`--service` or `--feature` beside it is refused `invalid-option`, since two scopes is a
contradiction rather than a narrowing), and it narrows the run to the boundaries, features and
landscape the branch changed since a base git ref of the docs repo — which is the only setting
both passing on the first day of adoption and tightening after it, and which for that reason
grades nothing outside the branch: the consumer whose living requirement still names an operation
this branch removed is not in scope, so that finding is `loam diff`'s and never this run's, and a
scope holding no target says it graded nothing rather than reporting the word valid. The landscape
is graded by what in it the branch changed: a call edge the branch added or edited is checked
against its provider's contract even when the provider is out of scope, and the fleet-wide
vocabulary warnings (a permission, capability, obligation or glossary term nothing cites) and the
AGENTS.md stamp ride the run only when the file that carries them changed.

**`loam gherkin`** — a feature's changed requirements, or (without a feature) the full living suite.
Deterministic, digest-stamped, regeneration-owned; run in the service's own repo.

**`loam rebase`** — writes `Based-On:` on every MODIFIED/REMOVED requirement and `x-loam-based-on`
on every operation in the contract delta that the living docs already hold; what this feature is
*adding* has nothing to pin against, and the output says so per item. On the requirement axis that
stops a second feature rewriting the same requirement from landing on top of the first in silence;
on the contract axis it also tells an edit from a **quotation** — the merge upserts every operation
the delta spells, so without the pin an operation you only quoted reverts whatever landed on it.
The cheaper fix is not to quote: a feature's `openapi.yaml` or `asyncapi.yaml` holds only what it
adds, changes or removes, the merge leaves every operation it does not spell exactly as the living
contract has it, and a local `$ref` resolves into the living document — so an add-only contract
delta has nothing to pin and needs no rebase. Each quote costs a pin, and a pinned quote whose living
operation a parallel feature removes becomes `openapi.baseline-invalid`, an error that blocks the
archive until the quote is deleted, with `openapi.op-revived` beside it — while an unpinned one is
`openapi.op-revived` alone (`asyncapi.slot-revived` on the event axis), which gates the archive too,
because the merge would read the retired operation as an addition and put it back. Rebase pins neither as new: it prints
the same finding (`revived[]` in `--json`), and whether the quote goes or the feature re-adds the
operation on purpose is the author's call. It judges the delta as it will write it, pins included:
a quote repinned over whatever now lives at an address an archived feature moved the operation away
from becomes an edit the merge writes, and that revival is reported by the rebase (or `--dry-run`)
that makes it, not first by the next validate. Restamping is the last step of resolving a collision,
not the resolution — the output says which pins moved.

**`loam verify`** — `--results <report.json>` answers the scenario claims from a test run,
digest-matched, so only a green run confirms one, and the record writes down which file it read
(path, sha256, mtime). It reads two shapes: a cucumber JSON report (cucumber-js, cucumber-jvm,
behave, SpecFlow/Reqnroll, pytest-bdd `--cucumberjson` and godog's cucumber formatter all write
one), in which a matched scenario must also have run exactly the stamped scenario's number of
steps — a hand-tagged stub is not that scenario's run — or loam's runner-neutral
`{"loamScenarioReport": 1, "results": [{"digest": "…", "status": "passed"}]}`, which a JUnit,
pytest, Vitest or house runner's report is adapted into. Anything else, JUnit XML included, is
refused naming both (`answers-unreadable`). It answers *only* those claims, so on a feature with
open `service.exists` / `api.exposes` claims it is passed alongside `--record` or refused
(`answers-mismatch`). `--record <answers.json>` takes the agent's answers, refusing anything
unevidenced — a `file:line` that does not resolve to a real line in this repository, and under
`--service` one that does not resolve at the attested commit — and a scenario claim answered that
way makes the record `attested` rather than `verified`. A
cross-service feature is recorded **once per service repo** with `--service <id>`, each run writing
its own commit-bound attestation to a file of its own, `features/<FEAT>/verification/<id>.yaml` —
the directory is the record, so two teams' attestations on two docs-repo branches merge cleanly. The
`--service`-less `--record` form writes the whole record from one place, into the one file
`verification.yaml`, and is refused (`record-federated`) once anyone else has attested. A record
file that will not read (`record-unreadable`, git conflict markers included) is named with its safe
repair: a service's own file may be deleted and recorded again by that service; the one-file
`verification.yaml` may hold other services' attestations and is restored, never deleted.

**`loam unarchive`** — it refuses rather than guesses: `snapshot-stale` when a merged file moved
since (`--force` says that was meant), and `snapshot-corrupt` when a pre-image no longer hashes to
what the archive recorded for it, which `--force` deliberately does **not** override — the damage
there is to the undo itself.

**`loam audit-openspec` / `loam migrate-openspec`** — the audit reports capabilities, active and
archived changes, counts, RENAMED and unsupported shapes, and every capability→service decision
still needing a human. The migration validates your completed mapping against a re-read of the
source, and with `--apply --target <empty-dir>` materializes **staged migration docs** into a
separate directory. `--map` is required — there is no one-shot form.

### How `archive` protects the source of truth

`archive` is the command that merges a feature into the living source of truth and records the
reversible pre-images. Other commands also write canonical artifacts (`vouch`, `rebase`, `verify`,
`new`, and `init`), but archive has the strongest multi-file transaction contract: it takes an
advisory lock on the docs repo for the whole plan-and-commit (a second writer — another `archive`,
an `unarchive`, a `rebase` — refuses with `docs-busy` rather than interleaving), computes the whole
merge before touching disk, commits each file through a temp file swapped in atomically after
re-checking the bytes it read (a rename for an overwrite, a no-clobber `link(2)` for a create, so a
file that appeared after the plan was computed is never buried), and rolls back what it already
swapped if any part fails. It also records the bytes it overwrote inside the archived feature — with
a digest of each pre-image, so `unarchive` can tell an intact one from an edited one — which is what
makes `unarchive` an undo rather than a guess. A process **killed mid-commit** is covered too: an
intent journal (`.loam-commit`) is fsynced before the first swap, and the next `archive`/`unarchive`
recovers from it under the lock, rewriting each half-written file from the snapshot — an interrupted
archive is undone, an interrupted unarchive is *finished*, because the merged text it was replacing
is written down nowhere else — or refusing with `commit-interrupted` when a file has been edited
since. `loam doctor` reports that state rather than calling the repo healthy.

The gate itself comes in two kinds. Coherence (a revived retired operation among it), an unknown
service and the OpenAPI plan are judgement calls, and `--approve` carries them; two refusals are mechanical loss and `--approve` deliberately
does not — a living document still holding git conflict markers (`merge-failed`) and a living
requirement that has strayed outside `## Requirements` (`living-outside-requirements`). loam's docs
files must be **UTF-8** for the same reason: undecodable bytes refuse the merge (`merge-failed`,
naming the file) instead of being rewritten as U+FFFD, and a non-UTF-8 `openapi.yaml` grades
`openapi.invalid`. **`verify` does not gate `archive`** — coherence gates because loam *computed*
it; a verdict is somebody's word about code loam never read, and a gate in front of shipping only
teaches everyone that the cheapest way past it is to say yes.

API retirement is explicit and reviewable: a feature marks the exact path/method operation with
`x-loam-remove: true` — **inside the operation being retired, beside its `operationId`** — and
removes the governing requirement in the same delta. A marker written one level up, at path level
beside the methods, addresses no operation and retires nothing; archive refuses it
(`openapi.remove-marker-path-level`) rather than publishing a meaningless key into the fleet's
living contract. Validation refuses stale, mismatched, or unjustified markers; archive deletes the
method without persisting the marker or garbage-collecting components, and reports the removals in
both text and JSON. See [SCHEMA.md](SCHEMA.md) for the lifecycle contract. A delta that defines
another operationId where a living operation lives replaces it there, and when the merged contract
then defines it nowhere the gate grades it like a retirement: `openapi.remove-op-consumed` while an
edge of the `architecture/` project, another service's requirement, a use-case hop, or the
provider's own requirement as the merge would leave it still names the old id — so a rename redraws
the edge and restates its requirement in the same change, or defines the old operation at another
address if it is to stay. Every consumer is read after the feature's merge, so retiring one in the
same feature (MODIFY or REMOVE the requirement that names it) is a fix the gate sees.

A retirement also stays retired. The archive gate reads the removal markers every feature under
`features/archive/` left behind, and refuses a delta that spells an HTTP operation, a channel, an
event operation or a message one of them retired while the living contract no longer holds it —
or spells one at an address one of them retired it from or moved it away from while it lives on
elsewhere, which would put it back beside where it lives, judged on the contract the merge would
write (`openapi.op-revived`, `asyncapi.slot-revived` — warnings that gate). Without it, a parallel
feature that had merely quoted the operation archived second and put it back at exit 0.
`--approve` re-adds it on purpose, and the archive output names what came back and whose
retirement it reverses. A removal made by hand-editing a living contract, or an archive deleted
from disk, leaves no marker, and the gate cannot see it.

## The MCP server

For hosts that reach tools through MCP rather than a shell, `loam mcp` serves the sixteen read
commands — `validate`, `status`, `list`, `show`, `delta`, `tasks`, `explore`, `dependencies`,
`diff`, `doctor`, `context`, `adopt`, `gate`, `steps`, `explain`, `instructions` — as MCP tools
(`loam_validate` … `loam_instructions`) over stdio, newline-delimited JSON-RPC 2.0, protocol
revision 2025-06-18 (older revisions negotiated down; JSON-RPC batch arrays refused). Every tool is
advertised `readOnlyHint: true` and `openWorldHint: false`, which is what a host needs to run one
without stopping to ask its user: the first says the call cannot change the repository, the second
that it cannot reach anything outside the directory the server was launched in — and both are true
of the whole base table only because the writing commands are kept out of it. It also publishes
`loam://orientation` and every `loam://instructions/<name>` page as Markdown resources, so the host
can load version-matched guidance progressively; `loam://instructions/loam-check/compact` omits the
large fix table and pairs with `loam explain <code>`. The six workflows and `loam-report` are also
MCP prompts — `prompts/get` returns the page `loam instructions` prints, with `feature`, `service`
or `title` filling its placeholders — so a host with no shell can start one the way a slash command
does, and `initialize` returns instructions that say where to start (`loam_status`) and how to ask
who calls an operation (`loam_explore` with `op`). A typical host entry:

```json
{
  "mcpServers": {
    "loam": { "type": "stdio", "command": "loam", "args": ["mcp"] }
  }
}
```

`loam init --mcp` writes that file at the repository root for you, choosing `npx --no loam mcp` over
the bare binary shown above when `node_modules/.bin/loam` is there — the per-repo devDependency
install, whose binary is on no PATH a host inherits. With `codex` or `opencode` selected it writes
their config too, and with `github-copilot` it prints the JSON Copilot's cloud agent takes in the
repository settings ([Host by host](#host-by-host)). It is opt-in, and it never merges: a config
that already exists is reported skipped, byte for byte, with the `loam` key printed for you to
paste. `loam init --mcp-author` writes the same entry with `mcp --author`: that explicit mode
adds `new`, `rebase`, `gherkin`, and archive planning with `--dry-run` enforced by the server.

There is one machine contract, not two: every tool declares the common envelope `outputSchema` and
every result carries the command's `--json` envelope **verbatim** in text plus structured content.
Even malformed command stdout gets a structured `internal` envelope, so the schema has no missing
branch. The MCP error flag
following the envelope's `ok` — so `ok` and the stable `error.code` strings mean exactly what they
mean at the CLI, and everything above about branching on codes applies unchanged. (Not the exit
code, deliberately: `doctor`, `validate` and `gate` grade — they can exit 1 while answering
`ok: true` — and a graded verdict rendered as a failed call would be a verdict discarded.) The
server serves the repository it is launched in (each call resolves `loam.json` from that directory,
exactly as the CLI would) and never changes directory — a host that launches it in the wrong place
gets coherent `no-config` envelopes, not silence. Calls run strictly one at a time, so a fleet-wide
`loam_validate` blocks the queue for its duration; MCP requests carry ids and hosts tolerate the
latency. Even author mode excludes `vouch`, verification recording and a committing archive:
human trust and irreversible lifecycle transitions stay under the CLI permission flow.

## Build on the envelope

loam makes no network call, so it syncs with no tracker, dashboard or catalog — and does not need
to. Every command's `--json` is a stable contract, and the integrations are a few lines of shell
over it, owned by whoever runs them. Four recipes, each run against `examples/docs`.

**Feature work into a tracker.** `loam tasks <FEAT> --json`, run from the docs repo, lists every
open unit of a feature (from a service repository it lists that service's, when the feature touches it):
`id`, `subject` (the owning service), `claim`, `done` (its `check` is the fact that closes it) and
`dependsOn` (unit ids to finish first). The unit id is the idempotency key — prefixed with the
feature id, so one tracker holds every feature's units and each title says which — and a re-run
opens issues only for units it has not seen:

```bash
existing=$(gh issue list --state all --limit 1000 --json title --jq '.[].title')
loam tasks FEAT-101 --json \
  | jq -r '.feature as $f | .units[] | ["[\($f) \(.id)]", .subject, .claim, .done.check, (.dependsOn | map("[\($f) \(.)]") | join(" "))] | @tsv' \
  | while IFS=$'\t' read -r key svc claim check after; do
      grep -qF "$key" <<<"$existing" && continue
      gh issue create --title "$key $claim" --body "Service: $svc. Done when: $check. After: ${after:-nothing}"
    done
```

On the example's FEAT-101 that is nineteen issues the first time and none the second. A finished
unit leaves `units[]` once the evidence its `check` names is recorded, so the issues to close are a
set difference against the last export. **A unit's id is a hash of what it says**, which is what
makes it a key and also its one hazard: rewording a scenario — its name or any Given/When/Then line
— or renaming a requirement that carries no `Requirement-ID:` mints a new id. The next export opens
a fresh issue, and the old one is orphaned: it drops out of `units[]` exactly as a finished unit
does, so read the set difference before closing anything as done, and carry the orphan's history
over by hand. Renaming a requirement that does carry a `Requirement-ID:` keeps every id. The same
loop drives `jira` or any CLI that creates an issue from a title and a body.

**The fleet view of every service repo's CI.** Staleness is visible only from each service repo,
so each one's CI publishes the per-service summary (SCHEMA.md, "The per-service summary a CI
pipeline publishes") wherever your fleet view reads. Rolling those up is a join against the list of
services the docs repo knows, so a service that never reported reads as unknown and never as clean:

```bash
jq -s 'map({(.service): .}) | add // {}' summaries/*.json > reports.json
loam list --json | jq -r --slurpfile r reports.json '
  .services[] | .id as $id | $r[0][$id] as $s
  | [$id,
     if $s == null then "unknown: no report"
     elif now - ($s.generatedAt | fromdateiso8601) > 86400 then "unknown: last report \($s.generatedAt)"
     elif $s.valid | not then "invalid: \($s.errors) error(s)"
     elif $s.sources.stale + $s.contentStale > 0 then "owes a re-vouch: \($s.sources.stale) source-stale, \($s.contentStale) content-stale"
     else "clean" end]
  | @tsv'
```

The day-old cutoff is a policy and yours to set; what is not a policy is that `generatedAt` comes
from the CI's clock, never loam's, so an old one means that repo stopped reporting.

**Which services must be up for suite X.** A fleet usually keeps that answer by hand — a compose
file, a CI matrix, a paragraph in a runbook — and it drifts from the journeys it is for. Tag each
cross-service use case with the suites it runs in (`#suite-smoke` on its `dynamic view`, declared in
the landscape's `specification`; one journey may carry several) and `loam list suites <name>`
derives it: the union of the suite's participants, resolved to service ids through the same join the
step grades use. The participants no service stands for are listed beside them rather than dropped —
the person who drives the flow, an `#external` topic or partner — because a stand that comes up
short fails its journey against something nobody was told to start:

```bash
loam list suites smoke --json | jq -r '
  if .useCases.unreadable then error("architecture/ did not parse: \(.useCases.error)") else . end
  | .suites[0] | (.services[] | "up \(.)"), (.unresolved[] | "stand-in \(.element)\(if .external then " (#external)" else "" end)")'
```

On the example that is three services up — checkout-web, notification-service, order-service — and
two stand-ins: `customer`, and `kafka.orderEvents`, `#external` through its kind. Tagging a journey
also opts it in to grading, so a suite cannot list a hop the map does not declare
(`usecase.step-unbacked`); `ungrouped[]` names the use cases in no suite, and an unknown suite name
refuses `unknown-target` rather than answering an empty environment.

**LikeC4's own MCP server beside loam's.** The fleet map is plain LikeC4, so LikeC4's MCP server
runs on the same docs repo with no configuration — `npx likec4 mcp --stdio .` from the docs root
exposed eighteen tools on the example, measured at the 1.59.2 pin loam carries: element, view and
relationship reads, graph traversals, metadata and tag queries. Run the likec4 loam itself depends
on (`npm ls likec4` names it), so the server parses the grammar loam validates. The two answer
different questions: `loam mcp` the joins, gates and lifecycle state; `likec4 mcp` the model as a
graph. One host entry carries both:

```json
{
  "mcpServers": {
    "loam": { "command": "loam", "args": ["mcp"] },
    "likec4": { "command": "npx", "args": ["likec4", "mcp", "--stdio", "."] }
  }
}
```

Two differences to know. LikeC4's server reads the root project, which excludes `features/**`, so
it sees the living map and never an in-flight delta — ask `loam show <FEAT> --json` for those. And
seventeen of its tools advertise `readOnlyHint`; `apply-semantic-layout` does not, so a host will
ask before running it.
