# The loam workflow

How work actually moves through a loam repository: what a feature owes, how loam decides where
that work stands, what gates and what only advises, and how an agent drives the whole thing from
`--json`.

[SCHEMA.md](SCHEMA.md) is the companion to this file. It is the reference — every artifact's
grammar, every rule, every decision. This one is the protocol: the order things happen in, and
why that order.

## Contents

- [The two flows](#the-two-flows) · [The artifact graph](#the-artifact-graph) · [Derived, never stored](#derived-never-stored)
- [Actions, not phases](#actions-not-phases) · [What actually gates](#what-actually-gates)
- [The six workflows](#the-six-workflows) · [Driving it from an agent](#driving-it-from-an-agent)
- [Presence is not trust](#presence-is-not-trust) · [Why there is no task list](#why-there-is-no-task-list)
- [Picking the work back up](#picking-the-work-back-up)

## The two flows

```
BOOTSTRAP (once per service, reverse):
    code ──adopt──►  brief ──agent──►  C4 baseline + capability spec   [truth = code]

FORWARD (per feature, generative):
    intent → C4 delta → Gherkin (BDD) → tests → code      [truth = model]
                 ▲                                   │
                 └──── done-check: verify ◄──────────┘
```

They run in opposite directions and that is the point. Bootstrap reads a service that already
exists and writes down what is true about it; the code is the authority and the document is the
claim. Forward starts from an intent nobody has built yet; the model is the authority and the code
is the claim. Every rule below is downstream of which direction you are facing.

**There is no extractor, and there will not be one.** Nothing deterministic reads a legacy service
and says what its architecture *means*, and a model that was guessed is worse than none —
everyone downstream has to re-derive it to know whether to believe it. loam takes the half of the
job that is mechanical: it **states the work** and it **checks the result**. An agent does the
reading.

## The artifact graph

A feature is a directory. What it owes is a fixed set of artifacts — no per-project schema, no
configurable graph, because a fleet needs one lifecycle and one meaning of green:

| Artifact | Per | Required | What it is |
|---|---|---|---|
| `intent.md` | feature | yes | The problem in business terms. The proposal: why this exists, before any structure |
| `delta.likec4` | feature | no | New elements and edges, each tagged with the feature id. The design. A requirements-only change deletes it |
| `specs/<svc>/spec.md` | service | yes | The behaviour delta — `ADDED` / `MODIFIED` / `REMOVED` requirements, each with Given/When/Then scenarios |
| `specs/<svc>/arch.spec.md` | service | no | The architectural obligations a business spec never mentions: outbox, retries, idempotency, alerts. Same grammar, plus `Covers:` lines tying each to the C4 elements it accounts for |
| `specs/<svc>/openapi.yaml` | service | conditional | The contract delta. Required where the fleet map shows somebody calls this service |
| `verification.yaml` | feature | yes | The done-check record: every claim, its answer, its evidence, and who gave it |

Two fleet/living axes sit beside this feature graph. `services/<svc>/asyncapi.yaml` joins
`publishes`/`consumes` edges to `Publishes:`/`Consumes:` requirements, but has no feature delta or
merge yet. `architecture/permissions.yaml` is the opt-in authorization vocabulary: requirements
name `<subject>/<permission>` pairs with `Requires:`; unknown pairs are errors and unused
declarations are warnings. [SCHEMA.md](SCHEMA.md#canonical-joins) is the canonical join table.

Two of those "no"s are load-bearing. An artifact that is legitimately absent reads `done` — nothing
is owed — with `exists: false` beside it, so a reader can tell that from a file that is present and
fine. Marking everything required is how an axis that is optional everywhere gets reported as
missing everywhere and then ignored.

**Dependencies are enablers, not gates — with one real exception.** You can author these in any
order. `verification.yaml` is the exception, and it is a genuine impossibility rather than a
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
and contradicts the living spec is `draft`, not `done` — the file is present, and presence was
never the claim. A graph that reads existence alone would call that feature finished.

## Derived, never stored

Nothing above is written down anywhere. `loam status` recomputes the whole table on every run,
from the files, and writes nothing:

```bash
loam status --json
```

There is no state file, no database, no cache, and therefore nothing to go stale, nothing to
reconcile after someone edits a file by hand, and no second source of truth to disagree with the
first. Delete loam and every artifact remains as Markdown, LikeC4 DSL, Gherkin and YAML.

The cost is honest: `status` re-reads and re-parses. On a 120-service fleet with ten features in
flight that is about 1.3 seconds, most of it the per-feature C4 parse, and it is nearly flat in the
size of the fleet. That is the price of never being wrong about what is on disk.

## Actions, not phases

There is no phase lock. Any action, any time — because real work does not proceed in one
direction: building reveals a design flaw, which rewrites a requirement, which regenerates a
suite. `loam status`'s `next[]` is ordered *advice*, not a sequence you are held to, and running a
step out of order is not an error state loam has to be talked out of.

What loam does instead is make the consequences of going backwards visible. Change a requirement
after generating its Gherkin and the suite's digest no longer matches, so `loam validate` reports
the suite stale — by digest, not by anybody's intentions. Edit a feature's documents while another
feature is in flight and `loam rebase` is what stops the two silently reverting each other. The
protocol is not "do these in order"; it is "when you go back, here is what tells you what moved".

## What actually gates

Two things, and it is worth being precise about which, because everything else is advice.

**1. The archive coherence gate.** `loam archive` is the one command that rewrites the source of
truth. It computes the whole three-axis merge first, checks it for cross-axis coherence, and
refuses if the plan is incoherent. `--approve` carries the judgement calls; it deliberately does
**not** carry the two mechanical losses — a living document still holding git conflict markers, and
a living requirement that has strayed outside its `## Requirements` section. Those are not
opinions about risk, they are data loss, and an override for them is a footgun with a label on it.

**2. The human vouch.** `draft → verified` is a person's act. `loam vouch` stamps the source and
content digests that make later staleness detectable, and no command promotes a service on its
own. That is the whole trust chain's anchor.

**`verify` does not gate `archive`,** deliberately. Coherence gates because loam *computed* it. A
verdict is somebody's word about code loam never read, and a gate in front of shipping only
teaches everyone that the cheapest way past it is to say yes.

Severity and gating are also two different questions. A coherence finding marked `gates` stops the
archive even when it is only a warning; an error in `validate` fails the check without necessarily
blocking a merge. Read the code, not the colour.

## The six workflows

Each is a protocol that ships inside the binary. `loam instructions <name>` prints it, with `$1`,
`$2` filled in from the arguments you pass:

```bash
loam instructions loam-feature FEAT-101 "Refund on partial capture"
```

`loam init` writes a slash command and an Agent Skill per workflow into whichever AI tools it finds
in the repo. Those files are **pointers** at `loam instructions`, not copies of it — they carry the
purpose and the spine, and defer the flags, the finding codes and the fix tables to the binary you
are actually about to run. A generated file is written once and never regenerated, so a copy of the
protocol in it would be as old as the repository; the pointer cannot go out of date the same way.

| Workflow | When | What it drives |
|---|---|---|
| `loam-adopt` | Once per service, before any feature touches it | `loam adopt` briefs the baseline; an agent reads the code and writes it as `draft`; validate twice — the service, then the fleet — and hand to a human to vouch |
| `loam-feature` | Starting a change | `loam explore` to decide what it touches, `loam new` to scaffold, author the delta and the specs, `loam rebase` to pin, `loam validate`, `loam dependencies` |
| `loam-implement` | Building one service's slice, in that service's repo | `loam delta` is the task, `loam gherkin` emits the acceptance criteria, step definitions come before code |
| `loam-check` | Any time; always before shipping | `loam validate`, and fixing what it reports by code |
| `loam-verify` | When the code is built | `loam verify` derives the checklist; the test runner answers what it can; you answer the rest with evidence |
| `loam-ship` | When it is really finished | `loam validate --feature`, `loam archive --dry-run`, then the merge |

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

What it does **not** do is fold the neighbours into that command line. loam knows those services
are connected; it does not know whether this change touches them, and a suggestion that quietly
included them would make the judgement on your behalf while looking derived. Weighing the ring is
the work — this command just makes sure you are weighing all of it.

## Driving it from an agent

Every command takes `--json`, and the contract is built so an agent never has to read prose:

- **Findings carry stable codes** — `c4.valid`, `spine.op-undefined`, `coherence.ok`. Branch on the
  code. Prose gets reworded; codes do not.
- **`next[]` is ordered, and each entry carries the literal command** to run, beside a stable code
  and a one-sentence statement that is actionable without reading any other field.
- **Three questions are kept apart**, each on the command that can answer it: `ok` (the command
  ran) on every envelope, `valid` (the docs pass) on `validate`, and `verified` on `verify` —
  beside `verdict`, which carries the third state, `attested`.
- **`loam status` takes the union** of what `validate --feature` errors on and what `archive`
  refuses to merge. It may be redder than either and is never greener than both.

The loop is the same every time: `loam status --json`, read `next[0]`, run the command it names,
repeat. When a command refuses, it refuses with a code and a sentence naming the fix — `loam
doctor`'s findings carry the exact command in a `fix` field.

## Presence is not trust

Documentation existing and documentation being *believed* are different facts, and loam refuses to
let one read as the other.

Services climb a ladder — `empty → partial → documented → sourced → vouched`. The rungs are derived
from artifact presence and provenance state only, never from what the artifacts say: a service with
one endpoint documented out of thirty climbs exactly as fast as a thorough one, which is why no
rung is called "adopted". `sources` names the code a document was written from. `vouch` stamps
digests over both. Later, `content.stale` says the document moved and `sources.stale` says the code
did — the second one only answerable inside that service's own repository.

The same distinction runs the done-check. `loam verify` derives the claims; a `scenario.tested`
claim is confirmed **mechanically in the record** when a digest-matched green Cucumber report
answers it. That proves which passing report bytes loam accepted; it does not prove the report was
produced by executing the attested commit. An agent
may confirm one too — a legacy service with no runnable suite has to be able to record its answers
— but the record then reads **`verdict: "attested"`**, not `verified`, and says so on every
surface. `verified: true` in the envelope means every scenario claim came from a test run.

loam does not claim agent answers are impossible. It claims they are *distinguishable*.

## Why there is no task list

There is no `tasks.md`, and that is a decision rather than an omission.

A task list authored beside a spec is a second mutable state. It drifts — the spec changes, the
checklist does not, and now two documents describe the work and only one of them is checked. The
question a task list answers is a good one; the file is the wrong place to answer it.

loam derives the answer instead, at two altitudes:

- **What to do next**, from `loam status`: the artifact table plus an ordered `next[]`, recomputed
  every run, so it cannot disagree with the files.
- **What to build**, from `loam delta <FEAT> --service <svc>`: the intent, every requirement body
  and every Given/When/Then line reproduced verbatim, the endpoints added or retired, and the edges
  around it. That output *is* the coding task, and it is regenerated from the spec each time rather
  than transcribed from it once.

Then `loam gherkin` turns the scenarios into digest-stamped `.feature` files — a checklist that
executes. A valid Markdown table becomes the `Examples:` of a Scenario Outline, so a permission or
status-code matrix remains one requirement scenario rather than twenty copied ones. A box you tick
is a claim about work; a scenario that goes green is evidence of it.

The same reasoning is why `intent.md` is a real artifact and a `design.md` is not. The intent is
input — a human's statement of the problem, which nothing can derive. The design is the
`delta.likec4`, which is checkable: its elements and edges resolve against the fleet map, its
operations against the contracts. A prose design document beside those would be a third description
of the same change, and the only one nothing grades.

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
interrupted unarchive is *finished* — the merged text it was replacing is written down nowhere
else. Where a file has been edited since, it refuses with `commit-interrupted` rather than writing
over the evidence. `loam doctor` reports that state instead of calling the repo healthy.

And the fourth, which is not recovery but is the same instinct: **you do not know what a command
will do.** `archive`, `unarchive` and `rebase` all take `--dry-run`, and
`explore`, `status`, `list`, `show`, `adopt`, `delta`, `dependencies`, `doctor`, `validate` and
`instructions` write nothing at all, ever.
