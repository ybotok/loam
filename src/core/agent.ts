/**
 * The agent contract: what `loam init` lays down so a coding agent can run the
 * cycle without being told it each time.
 *
 * AGENTS.md goes into the docs repo — it travels with the thing it describes.
 * The slash commands go into the repo `init` runs in, because that is where the
 * agent is invoked — Claude Code by default, other tools via `init --tools`
 * (the AGENT_TOOLS registry below: one shared body, a per-tool path and
 * wrapper). Neither is ever overwritten: they are starting points, and a
 * team's edits to them outrank ours.
 *
 * The stamp on the first line is the one concession to that never-refresh
 * contract: it records which loam wrote the file, so `loam validate --all` can
 * say when the tables below describe a binary that no longer exists
 * (`agents.stale` — detection only, never a rewrite; agents-stamp.ts).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentsStampLine } from "./agents-stamp.js";
import { LOAM_VERSION } from "./version.js";

export const AGENTS_MD = `${agentsStampLine(LOAM_VERSION)}
# Working in this docs repo

This is a **loam** docs repo: the shared source of truth for a fleet of services —
their architecture, their contracts, and what they are required to do. Everything
here is plain files. \`loam\` reads and writes them; delete \`loam\` and the docs remain.

## Layout

\`\`\`
architecture/landscape.likec4     the living C4 model of the whole fleet
services/<svc>/
  model.likec4                    this service's C4
  spec.md                         its living requirements (current state)
  arch.spec.md                    its living ARCHITECTURE requirements (outbox, retries, alerts)
  openapi.yaml                    its API contract
  adrs/  runbook.md  health.yaml  why it is like this, how to run it
features/<FEAT>/                  a change in flight
  intent.md                       why, in business terms
  delta.likec4                    the architecture change, tagged #<FEAT>
  specs/<svc>/spec.md             the requirement change for one service
  specs/<svc>/arch.spec.md        the architectural requirement change, same delta grammar
  specs/<svc>/openapi.yaml        the endpoints this feature adds
  verification.yaml               what was checked once the code was built
features/archive/<FEAT>/          shipped changes — the evolution history
\`\`\`

## \`loam.json\` — the wiring, in every repo

A fleet is **N + 1 repositories**: this docs repo, and one per service. Every one
of them carries its own \`loam.json\`, and every one of them commits it — that
file is how any agent, human or CI runner standing in a directory finds the rest
of the fleet. There is no environment variable and no global config; if a
command cannot see a \`loam.json\` at or above the working directory, it refuses
with \`no-config\` rather than guessing.

\`\`\`json
{ "docsDir": "../docs-repo", "service": "payment-service", "gherkinDir": "features" }
\`\`\`

- \`docsDir\` — where the docs repo is, **stored exactly as it was passed** and
  resolved against the directory holding the \`loam.json\`. So \`../docs-repo\`
  keeps working on every machine that checks the repos out side by side, which
  is the point of committing the file. An absolute path is a warning
  (\`doctor.docs-absolute\`): it resolves only on the machine that ran \`loam init\`.
  The docs repo's own \`loam.json\` says \`"docsDir": "."\`.
- \`service\` — the canonical id of the service THIS repo contains, i.e. the
  \`services/<id>/\` directory it is allowed to speak for. \`loam vouch\`,
  \`loam gherkin\` and \`loam verify --service\` all bind to it; without it they
  refuse (\`repository-unavailable\`) rather than write another service's
  documents from a repo that is not that service's.
- \`gherkinDir\` — optional, default \`features\`: the directory \`loam gherkin\`
  writes its own \`loam/\` subtree into.

**Step 0 of everything below, once per repo:**

\`\`\`sh
loam init --docs ../docs-repo --service payment-service   # in EACH service repo
loam doctor                                               # before you trust any of it
\`\`\`

\`loam init --docs <dir>\` **joins** an existing docs repo; creating a new one
takes \`--create\`, so a mistyped path cannot quietly scaffold a second source of
truth beside the real one. \`loam doctor\` is the read-only preflight: it reads
loam.json defensively, resolves \`docsDir\`, probes access, checks \`services/\` and
the fleet map, and reports the service binding — run it first when anything
behaves as though the fleet were empty.

**Living vs delta.** \`services/<svc>/spec.md\` is the complete current state.
\`features/<FEAT>/specs/<svc>/spec.md\` is a diff against it, reviewed as a diff, with
requirements grouped under \`## ADDED\`, \`## MODIFIED\` or \`## REMOVED Requirements\`.
\`loam archive\` folds the delta into the living state.

## The architecture spec axis

The business spec will never mention the transactional outbox — that is
architecture. Retries, idempotency, metrics, alerts: real obligations no business
scenario states, and exactly where generated code cuts corners unless the
obligations are derived mechanically. They live in \`arch.spec.md\` — living and
delta, same grammar, same delta algebra, merged by \`loam archive\` through the
same code path (the two files are separate requirement namespaces).

Where a business requirement carries \`Operations:\`, an arch requirement carries
\`Covers:\` — the model objects its scenarios exercise, comma-separated:

\`\`\`
Covers: paymentService.db, paymentService -> kafka, alert:payment_5xx, sli:availability
\`\`\`

a C4 element (id, or the service a bound element stands for), an edge
(\`source -> target\`), or a health signal the service's health.yaml declares.
Every entry must resolve — \`covers.unknown\` (warn) is the typo guard, because a
mistyped entry silently costs the coverage it was written for.

Coverage is then derived, never trusted, as two warnings: a feature's NEW tagged
elements and edges want a covering requirement in its arch.spec.md deltas
(\`c4.uncovered\`), and every alert/SLI health.yaml declares wants one in the
living arch spec (\`health.uncovered\`). None of this gates \`loam archive\`;
\`--strict\` is the CI escalation. An absent arch.spec.md is not a finding —
partial adoption is supported — but write one for any service with real
architecture, or its obligations ship unchecked.

**Test levels, mapped once.** A business scenario is an acceptance test. An arch
scenario is an integration/ops test — the outbox relay under a dead broker, the
retry that stays idempotent, the alert rule that actually fires. \`api.exposes\`
is a contract test. Unit tests sit below spec granularity and are your TDD
concern, not the specs'.

## The generated Gherkin suite

Scenarios are the acceptance criteria, and \`loam gherkin\` makes them
executable: real \`.feature\` files, written into the SERVICE'S repo — the one
loam command that writes there, because tests live with the code they gate.
Output lands in \`<gherkinDir>/loam/\` (\`gherkinDir\` is an optional loam.json
fact, default \`features\`), and that \`loam/\` subdirectory is loam's own
derived space: regeneration rewrites its scope and deletes its orphans, so
never hand-edit inside it — step definitions and hand-written features belong
outside it, and loam never touches a byte outside \`loam/\`.

- \`loam gherkin FEAT-101\` — the feature's ADDED/MODIFIED requirements for this
  service, both spec axes. Files carry \`@FEAT-101\`; arch-axis files add
  \`@architecture\` and are named \`arch--<slug>.feature\` — their scenarios are
  integration/ops tests, not acceptance tests.
- \`loam gherkin --service <id>\` (no feature) — the full living suite from
  spec.md + arch.spec.md: the regression skeleton a legacy service gets at
  adoption.

One file per requirement (\`Feature:\` is the requirement name). Bullet lines
opening with Given/When/Then/And/But — the \`- **WHEN** ...\` convention
included — become steps; every other body line is kept as scenario
description. Each scenario is tagged \`@loam-digest-<16hex>\`: the same body
hash \`loam verify\` folds into its claim ids, riding into cucumber's JSON
report as a tag, so the suite, the claim and the report cannot quietly
disagree about what a scenario says. \`loam validate
--service <id>\`, run in the service repo, grades the suite by those digests
(\`gherkin.missing\` / \`gherkin.stale\` / \`gherkin.orphaned\`, all warn) — the
fix is always regeneration, never editing a generated file.

The flow, closed end to end: \`loam gherkin FEAT-101\` → write step definitions
(outside \`loam/\`) → run the suite with a JSON report
(\`cucumber-js --format json:report.json\`) → implement until green →
\`loam verify FEAT-101 --service <id> --results report.json [--record rest.json]\`,
run in that same service repo. The digest
tags ride through the runner into the report, so the \`scenario.tested\` claims
are answered by the green run itself — mechanically, never by anybody's word.
See "The done-check" for what \`--record\` still covers.

## Frontmatter — who vouched for this, and from what

Every markdown artifact opens with a YAML block:

\`\`\`yaml
---
service: payment-service     # or  feature: FEAT-101
status: verified             # services: draft -> verified
                             # features: proposed -> in_progress -> built -> done
owner: payments-team
last_verified: 2026-07-31    # written by \`loam vouch\` — do not hand-edit
sources:                     # files/directories in the SERVICE'S repo this was written from — no globs
  - src/main/java/com/shop/payment/
sources_digest: 6f1c0a…      # written by \`loam vouch\` — do not hand-edit
content_digest: 9b2f41…      # written by \`loam vouch\` — do not hand-edit
sources_files: |             # written by \`loam vouch\` — do not hand-edit
  9b2f41…  src/main/java/com/shop/payment/Api.java
---
\`\`\`

\`sources\` matters more than it looks. Everything else loam checks is internal
consistency — and a corpus can agree with itself perfectly while describing nothing
that exists. \`sources\` is the one thing tying a document to code: \`loam validate\`,
run inside that service's repository, checks every listed path is still there.
Entries are literal files and directories only — a directory covers everything
beneath it. Glob patterns are refused loudly (\`loam vouch\` will not stamp them,
\`loam validate\` errors on them): a pattern dialect nobody can be sure of digests
a different file set than intended, corrupting the staleness signal silently.

\`sources_digest\` is what makes that tie say something over time: a hash of the
CONTENT of those files, taken when a human last vouched for the document. Every
later \`loam validate\` re-computes it, so it can tell a document nobody has checked
(\`sources.unvouched\`) from one that still matches the code (\`sources.current\`) from
one the code has moved out from under (\`sources.stale\`).

\`content_digest\` is the same promise about the document itself: a hash of the
body below the frontmatter, stamped by the same vouch. It closes the other half of
the forgery — editing a spec after it was vouched used to leave \`status: verified\`
standing over words nobody read. \`loam validate\` recomputes it wherever it can
read the doc (no service repo needed, so it fires from the docs repo too) and
reports \`content.stale\` (warn): only a person can say whether verified still
holds of the new words.

Write \`sources\` for anything you author from reading code, and leave \`status: draft\`
until a human has read it. Promoting draft to verified is their call, not yours, and
it has its own command — \`loam vouch --service <id>\`, run inside that service's repo,
which stamps the status, the date, both digests and the per-file index
(\`sources_files\`, which is what lets a later \`sources.stale\` name the paths that
moved) together — into the living spec.md
and, when the service has one, arch.spec.md, in one all-or-nothing run: a file whose
sources cannot be verified refuses the whole vouch. Never write those five fields by
hand: a status with no digest behind it is a claim with nothing behind it. If the
document changed under vouch between the read and the write, it refuses with
\`vouch-raced\` and stamps nothing — re-read and re-run.

## The ID spine

Three artifacts describe the same call in three languages. They are joined by the
**operationId**, and that join is what \`loam validate\` checks:

- architecture — a C4 edge names the operation it calls:
  \`checkoutWeb -> paymentService 'Calls authorizePayment' { metadata { op 'authorizePayment' } }\`
- behaviour — a requirement declares the operations it governs:
  \`Operations: authorizePayment\`
- contract — the provider's \`openapi.yaml\` defines it:
  \`operationId: authorizePayment\`

Spell it identically in all three places. A mismatch is an error, not a warning:
an edge calling an operation nobody defines is a broken contract between services.

Features are joined the same way: a delta's new elements and edges carry the
feature id as a LikeC4 tag (\`#FEAT-101\`), and that tag is exactly what
\`loam archive\` folds into the living landscape. Untagged elements in a delta are
context for the diagram, not changes.

## The requirement baseline — \`Based-On:\`

A MODIFIED requirement carries its FULL new text, not a diff, so archive does not
merge your wording into the living one — it REPLACES it. When two features rewrite
the same requirement, the loser loses everything they wrote, scenarios and all.

\`loam validate\` names the other feature while both are in flight
(\`delta.modified-conflict\`), but that warning cannot see the case that actually
happens: the first feature archives, stops being an active feature, the second
revalidates GREEN, and its archive lands text written against a document that no
longer exists — \`+0 ~1 -0\`, exit 0, nobody told.

So a MODIFIED or REMOVED requirement pins the living version it was written
against, directly under its identity:

\`\`\`markdown
### Requirement: Cancel an order
Requirement-ID: REQ-042
Based-On: 3bcc7a40f2b23ff3
\`\`\`

You do not compute that value — \`loam rebase FEAT-101\` writes it, for every
MODIFIED/REMOVED requirement in the feature, from the living text as it stands
right now. Run it when you finish authoring a delta, and again after you resolve
a collision. Archive refuses on a stale pin (\`delta.baseline-stale\`) and says
both digests.

**Restamping is not resolving.** A pin claims "I read this version". If
\`loam rebase\` reports a requirement as moved, re-read the living requirement and
fold in what you still mean BEFORE you ship — otherwise you have re-pinned to a
document you never read, and archive will merge your text over theirs with
loam's blessing. There is no automatic three-way merge and there will not be one:
requirement prose does not merge, people do.

A delta adopted from OpenSpec has no such line and gets a warning
(\`delta.baseline-missing\`), never a refusal — an entire migrated corpus that
cannot archive is not a safety property.

## Which element IS which service

An element says which service it is with \`metadata { service 'payment-service' }\`.
Without one, its **title** is used instead — which is what most of this repo relies
on, and also the trap: rename a box in a diagram and every check joining it to
\`services/<svc>/\` silently stops matching. Bind an element whenever its title is
not exactly the directory name, and prefer binding over renaming a directory.

\`services/\` is the list of services — there is no manifest, and none should be
added. \`loam validate --all\` compares that list to the landscape both ways: a
directory nothing draws is an error, and an element with no directory is a warning.
Systems that are not ours — kafka, a payment gateway — carry \`#external\`, which
says so once and stops the warning for good.

## The cycle

0. **Wire the repo** — \`loam init --docs <path-to-docs-repo> --service <id>\` in
   each service repo, then \`loam doctor\`. Once per repository, before anything
   else; see "\`loam.json\` — the wiring" above. Every step below runs in a repo
   that has been through this one.
1. **Adopt** — a service with no documentation at all starts at
   \`loam adopt --service <id> --json\`, which briefs you on the baseline to write.
   See "Adopting a service" below. Once per service, not once per feature.
2. **Understand** — \`loam list --json\`, \`loam show <service> --json\`.
   Never propose a change to a service you have not read.
3. **Scaffold** — \`loam new FEAT-101 --title "..." --touches <existing> --new-service <new>\`.
   The scaffold leaves a \`delta.likec4\` whose context elements are commented out —
   a requirements-only feature should DELETE that file rather than ship an empty
   one — and gives every \`--new-service\` a \`specs/<svc>/arch.spec.md\` alongside.
4. **Author** the four files the scaffold left as TODO: intent, delta.likec4,
   a spec.md per service, an openapi.yaml per new service. If any requirement is
   MODIFIED or REMOVED, finish with \`loam rebase FEAT-101\`: it pins each one to
   the living text you wrote it against. See "The requirement baseline".
5. **Check** — \`loam validate FEAT-101 --json\`. Fix every error before writing code.
   \`loam dependencies --json\` says whether another feature in flight has to
   archive first.
6. **Build** — \`loam delta FEAT-101 --service <svc> --json\` is the task for one service:
   intent, its requirement delta with scenarios verbatim, and the edges around it.
   In the service's own repo, \`loam gherkin FEAT-101\` then emits those scenarios as
   \`.feature\` files under \`<gherkinDir>/loam/\` — write step definitions against them
   **first**, outside \`loam/\`, and implement until they pass.
   If \`architecture.errors\` is non-empty the payload keeps \`ok: true\` (the command
   ran) but the exit code is 1: the C4 slice is empty because delta.likec4 did not
   parse, not because the feature changes no architecture — do not build on it.
7. **Verify** — \`loam verify FEAT-101 --json\` turns the feature's own promises into a
   checklist. The scenario claims are answered by the cucumber report
   (\`--results report.json\`); answer the rest with evidence and record them
   (\`--record answers.json --service <id>\`), **from each affected service's own
   repo**. See "The done-check".
8. **Ship** — \`loam archive FEAT-101\` once the code is merged. \`--dry-run\` shows
   every file the merge would write, and writes none of them.

## Adopting a service

\`loam adopt --service <id>\` does not read code and never will. Nothing
deterministic can look at a legacy service and say what its architecture MEANS,
and a guessed model is worse than none: everybody downstream has to re-derive it
to know whether to believe it. So loam takes the half of the job that is
mechanical — stating the work, and checking the result — and you do the reading.

The brief names every file to write, the grammar each must be in, what the
landscape already says about the service (bind to those elements, do not draw a
parallel fleet), the frontmatter, and the checks that follow. It also lists what
**no** check will ever catch. Read that list: everything on it is a way to be
wrong quietly, and \`loam validate\` passing means nothing about any of it.

One of the targets is not under \`services/<id>/\`: \`architecture/landscape.likec4\`,
the fleet map, carried with \`action: "edit"\` and a \`landscape.instruction\`
spelling out the block this service owes it. That target appears only while
nothing in the map resolves to the service. **Add to that file; never rewrite
it** — every other service's elements and edges are in there. A service that is
fully documented and undrawn is \`landscape.service-unmodelled\` (error) and is
invisible to every cross-service check: no edge into it can be graded against
its openapi.yaml, and no feature can draw a call to it.

An adoption ends with two runs, not one: \`loam validate --service <id> --json\`
for the baseline, then \`loam validate --all --json\` in the docs repo — the
fleet cross-check the first invocation does not perform is exactly where a
landscape edit that did not land shows up.

Two rules the brief repeats and this file will too. An artifact that already
exists is reported as \`action: "diff"\` — read it and report what disagrees;
never replace it, because a document somebody wrote is evidence. And everything
you write is \`status: draft\`: promotion is \`loam vouch\`, run by a person in
the service's own repository.

## The done-check

\`loam verify <FEAT>\` derives a checklist from the feature's own artifacts —
one claim per new service, per operation the delta adds, per tagged edge that
names an operation, and per scenario of every changed requirement, arch.spec.md
deltas included (those claims name their file, and the test they ask for is an
integration/ops test, not an acceptance test). Each claim has a stable id, so
two runs are diffable and an answer cannot drift onto a different question.

Two answer channels, and they never overlap. The \`scenario.tested\` claims are
the TEST RUNNER's to answer: run the generated suite with a cucumber JSON
report (\`cucumber-js --format json:report.json\`) and pass it back —
\`loam verify <FEAT> --results report.json\`. A claim is confirmed only when a
report scenario carrying its \`@loam-digest-<16hex>\` tag ran at least one step
and every step passed — every occurrence, when the report holds a re-run, and
every before/after hook with it. A failed, undefined, pending or skipped step,
a failed hook, or no matching scenario at all, is \`unconfirmed\` with the
reason. The digest is the only identity: a reworded spec scenario matches
nothing until the suite is regenerated and re-run. When a report exists,
ALWAYS pass \`--results\` — under it the runner owns every scenario claim, and
an answers-file entry for one is refused. \`--record\` without \`--results\` is
the fallback for a service with no runnable suite yet: there your word answers
the scenario claims too, and the record says so (\`answered_by: agent\`) — an
assertion a reviewer can weigh, never proof a test ran.

Everything else you answer from the code, and \`--record answers.json\` takes
those back, writing \`features/<FEAT>/verification.yaml\` — it travels into the
archive with the feature and reads without loam. With \`--results\`, the answers
file must answer exactly the non-scenario claims: an entry for a scenario
claim is refused (\`answers-mismatch\` — the runner owns it), and \`--results\`
alone is refused while non-scenario claims are outstanding. Every recorded
verdict says who answered it (\`answered_by: runner | agent\`), so a reviewer
can tell a green run from somebody's word.

**A cross-service feature is verified once per service, and the form matters.**
The claims of one feature belong to several services, and each service's code
lives in its own repository — so the recording form is federated:

\`\`\`sh
# in EACH affected service's own repo, not in the docs repo:
loam verify FEAT-101 --service payment-service --results report.json --record answers.json
\`\`\`

\`--service <id>\` narrows the checklist to that service's claims and binds the
answers to this repository's commit, producing one **attestation** per service
inside a single \`schema: 2\` \`verification.yaml\`. Re-running it in the next
repo adds that repo's attestation and leaves the others standing. Omitting
\`--service\` in a repo whose \`loam.json\` declares one substitutes it, so the
short form is safe there; a \`--service\` naming a service this repo does not
declare is refused (\`service-mismatch\`), and \`--service\` from a repo that
declares none is refused (\`repository-unavailable\`) — an attestation has to be
bound to the code it is about.

⚠ **The legacy all-at-once form \`loam verify <FEAT> --record answers.json\` with
no \`--service\` writes the whole record from one place.** Over a record that
already carries other services' attestations it is refused outright
(\`record-federated\`, naming the attestors) rather than merged or migrated — the
alternative was one repo silently erasing nine others' evidence. Use it only for
a single-service feature that has never been recorded federated. A
\`verification.yaml\` that exists but cannot be read is \`record-unreadable\`: it is
never overwritten and never reported as "no record".

Reading is not writing: \`loam verify <FEAT> --service <id>\` **without**
\`--record\` is a pure lens on the checklist and works from anywhere, docs repo
included. Every run lists all subjects in \`services\`, and a recorded run reports
in \`discarded\` every previous answer the new record does not carry.

It refuses an answer set that does not answer the current checklist: an id that
is not on it (\`answers-mismatch\`), a claim with no answer (same), or a
\`confirmed\` with no evidence (\`answers-unevidenced\`). Evidence is \`file:line\`.
A claim you cannot show is \`unconfirmed\` with a note saying why — that is a
successful record, and it is more useful to the next reader than a yes.

**Nothing gates on it.** \`loam archive\` will ship an unverified feature. That
is deliberate: coherence is something loam computed from the documents, and a
verdict is your word about code loam never read. A gate in front of shipping
would only teach everyone that the cheapest way past it is to say yes. The
record is for the reviewer who comes later, so leave it true.

## What you author, what loam derives

Authored by hand: \`intent.md\`, \`delta.likec4\`, \`specs/<svc>/spec.md\`,
\`specs/<svc>/arch.spec.md\`, \`specs/<svc>/openapi.yaml\`, ADRs, runbooks, health.

Written by loam: the merge into \`services/<svc>/spec.md\`, \`services/<svc>/arch.spec.md\`,
\`services/<svc>/openapi.yaml\` and \`architecture/landscape.likec4\` at archive time.

**Do not hand-edit the living landscape to add a feature's changes.** Put them in a
delta and archive it — otherwise the change has no intent, no requirement and no
history behind it.

## Rules the validator enforces

- every requirement has at least one \`#### Scenario:\` — scenarios are the acceptance
  criteria and the source for tests;
- every operationId a requirement governs exists in that service's OpenAPI;
- every C4 edge's \`op\` resolves to an operation the target actually exposes;
- every operation is governed by some requirement (warning);
- a "Calls" edge with no \`metadata { op }\` is unlinked (warning);
- **the map is complete**: every \`services/<svc>/\` has an element in the landscape,
  and every element that looks like a service has a directory (warning) or is
  tagged \`#external\`;
- **the diff applies**: a \`MODIFIED\` or \`REMOVED\` requirement exists in the living
  spec, an \`ADDED\` one does not, and a section heading matches the grammar exactly;
- a \`Requirement-ID: <id>\` is optional, but when present it is valid and unique;
  archive selects by it, so carry the same ID through \`MODIFIED\` to rename a heading;
- **every requirement in a delta is under a delta section**: one under a prose heading
  (\`## Behavior\`) is documentation as far as the merge is concerned and is dropped
  (warning). \`## Requirements\` is exempt — quoting the living state is legal.

That last pair of rules exists because each of its failures used to be silent.
\`MODIFIED\` of a requirement that does not exist merged as a creation; \`ADDED\` of one
that does exist REPLACED it, scenarios and all; a near-miss heading like
\`## ADDED Requirement\` (singular) parses as plain prose, so archive merged nothing and
said nothing; and a requirement under \`## Behavior\` vanished the same way.

Write the delta section heading on its own line exactly as \`## ADDED Requirements\`.
The heading is the only thing that gives a requirement its kind: without a matching
one, archive merges the requirement as nothing.

Severity and gating are two different questions. An ERROR means the document is
invalid — \`loam validate\` fails. A finding with \`gates: true\` means \`loam archive\`
will refuse — the merge is unsafe. They usually agree (errors gate, warnings do
not), and where they diverge the \`--json\` output says so: \`delta.requirement-not-merged\`
is a warning (the shape is legal OpenSpec) that gates (the merge would drop the
requirement). Leave a warning standing only deliberately.

## Reading loam's output

Every command takes \`--json\`, and the envelope holds even when the INVOCATION
is wrong: with \`--json\` anywhere in the arguments, an unknown flag, unknown
command or missing argument still yields \`{ ok: false, error: { code:
"invalid-option" } }\` on stdout with exit 1 (commander's own diagnostic goes
to stderr; \`--help\` and \`--version\` output pass through untouched). Without
\`--json\` the same refusal is plain text on stderr with nothing on stdout.

Branch on \`findings[].code\`, never on the prose — the wording changes, the codes do
not. The code-by-code fix table lives in the \`/loam-check\` command \`loam init\` lays
down — for Claude Code by default; \`loam init --tools <ids|all>\` emits the same
commands, same bodies, into other agent tools' own command directories. The map of
which invocation surfaces what:

- \`loam validate --service <id>\` grades one service's own axes: \`service.unknown\`,
  \`service.no-model\`, \`service.no-spec\`, \`service.no-openapi\`, \`c4.invalid\`,
  \`requirements.missing-scenarios\`, \`spec.duplicate-requirement\`,
  \`spec.no-requirements\`, \`spec.repeated-operations\`, \`spec.repeated-covers\`,
  \`openapi.invalid\`, \`openapi.duplicate-operationid\` (one operationId in two
  (path, method) slots — every join on the id then picks one of them arbitrarily),
  \`api.ungoverned\`, \`api.ops-unlinked\`,
  \`api.requirement-deprecated\`, \`spec-api.op-undefined\` (the living spec's own
  \`Operations:\` lines, not only a delta's), \`spine.landscape-invalid\`, \`spine.op-undefined\`,
  \`spine.op-link-missing\`, \`spine.op-deprecated\`, and
  the architecture spec axis: \`covers.unknown\`, \`health.invalid\`, \`health.uncovered\`. Run inside
  the service's own repo, once a generated suite exists under
  \`<gherkinDir>/loam/\`, it also grades that suite against the living specs:
  \`gherkin.missing\`, \`gherkin.stale\`, \`gherkin.orphaned\` (all warn — the fix is
  always regeneration, never editing a generated file). A service that never ran
  \`loam gherkin\` stays quiet, and a file tagged with a feature still in flight
  answers to that feature, not to the living spec it has not merged into yet.
- \`loam validate --feature <id>\` grades a change's three axes against each other and
  against the fleet in flight: \`delta.invalid\`, \`delta.nothing-tagged\`,
  \`spec-api.op-undefined\`, \`spec-api.op-pending\`, \`c4-api.op-undefined\`,
  \`c4-api.op-pending\`, \`c4-api.op-deprecated\`, \`c4.op-ungoverned\`, \`c4.op-link-missing\`,
  \`api.op-unconsumed\`, \`service.no-requirement-delta\`, \`archedge.uncovered\`,
  \`spec.repeated-operations\` / \`spec.repeated-covers\` (on the feature's own
  spec deltas — same silent-line-loss check as service scope),
  the architecture spec axis (\`c4.uncovered\`, plus \`covers.unknown\` on the
  feature's arch.spec.md deltas), and
  the delta-shape group: \`delta.unknown-section\`, \`delta.no-delta-sections\`,
  \`delta.requirement-not-merged\`, \`delta.modified-unknown\`, \`delta.removed-unknown\`,
  \`delta.added-duplicate\`, \`delta.added-near-duplicate\`, \`delta.modified-pending\`,
  \`delta.removed-pending\`, \`delta.added-conflict\`, \`delta.modified-conflict\`,
  \`delta.living-duplicate-requirement\`, and the API-removal group:
  \`openapi.remove-marker-anonymous\`, \`openapi.remove-op-consumed\`.
  Where a finding names another feature in flight (\`delta.*-pending\`,
  \`delta.added-conflict\`, \`delta.modified-conflict\`, \`spec-api.op-pending\`,
  \`c4-api.op-pending\`) the ORDER is the answer, and \`loam dependencies --json\`
  is what computes it: \`order\` is a dependency-first sequence, \`conflicts\`
  the pairs no ordering fixes, \`cycles\` the ones that need a human.
- \`loam validate --all\` runs both of those for everything and adds the fleet
  cross-check: \`landscape.missing\`, \`landscape.invalid\`, \`landscape.service-unmodelled\`,
  \`landscape.service-undocumented\`, \`landscape.binding-unknown\`,
  \`landscape.binding-duplicate\`, plus a per-service
  \`sources.unverifiable-from-here\` (severity \`ok\`, one per service whose
  \`sources\` only its own repo can check — it is a confirmation, not work, and
  the fleet rollup line is derived from those findings), and one check on this very file — \`agents.stale\`
  (warn) — when the version stamp on line 1 (\`<!-- generated by loam vX.Y.Z -->\`)
  is missing or older than the running binary: the tables here may describe a
  loam that no longer exists, so review this file against the current \`--help\`
  and update the stamp line. A hand-curated file silences it the same way, by
  keeping the stamp current. The file is never refreshed automatically — your
  edits outrank the template, so detection is all loam does.
- \`loam doctor\` is read-only local/fleet preflight — the first thing to run in a
  repo that behaves as though the fleet were empty, and every finding carries a
  \`fix\`. Its blockers are
  \`doctor.config-missing\`, \`doctor.config-invalid\`, \`doctor.docs-missing\`,
  \`doctor.services-missing\`, and the three that say the fleet map cannot be read
  at all — \`doctor.landscape-merge-conflict\` (it still holds \`<<<<<<<\` markers,
  so it is two halves of two different maps), \`doctor.landscape-invalid\` (it does
  not parse) and \`doctor.landscape-unreadable\` (it is there but could not be
  read). Accessibility, portability and incomplete binding stay warnings:
  \`doctor.docs-unreadable\`, \`doctor.docs-readonly\`, \`doctor.docs-absolute\`
  (\`docsDir\` stored as an absolute path in a committed loam.json — it resolves
  only on the machine that ran \`loam init\`), \`doctor.inventory-unreadable\`,
  \`doctor.landscape-missing\`, \`doctor.service-unbound\`, and \`doctor.service-unknown\`.
- \`loam dependencies [<FEAT>]\` derives the ordering of the features in flight
  from the artifacts themselves — requirement identities and OpenAPI
  operationIds, never from validator prose. It is the answer to every
  "another feature in flight does this first" finding, and to
  \`delta.added-conflict\` / \`delta.modified-conflict\`, which no ordering fixes.
- \`loam audit-openspec <root>\` is the read-only OpenSpec inventory; an explicit
  \`--write-mapping\` writes a non-overwriting, digest-bound decision skeleton
  outside the source tree. \`loam migrate-openspec <root> --map <file>\` validates
  that mapping and stays dry-run unless both \`--apply\` and an empty \`--target\`
  are supplied. Living/active shape diagnostics are \`openspec.specs-missing\`,
  \`openspec.config-invalid\`, \`openspec.external-store-pointer\`,
  \`openspec.living-empty\`, \`openspec.living-requirements-outside-section\`,
  \`openspec.living-delta-section\`, \`openspec.change-metadata-invalid\`,
  \`openspec.change-schema-unresolved\`, \`openspec.skip-specs-with-specs\`,
  \`openspec.change-no-specs\`, \`openspec.change-empty\`,
  \`openspec.change-without-delta-sections\`,
  \`openspec.change-requirements-outside-delta-sections\`,
  \`openspec.nonstandard-change-spec\`, \`openspec.renamed-malformed\`,
  \`openspec.symlink-unsupported\`, and \`openspec.non-utf8-artifact\`;
  the same shapes in frozen history are non-blocking archive diagnostics.
  Mapping refuses stale or incomplete decisions under \`mapping.source-missing\`,
  \`mapping.source-root-mismatch\`, \`mapping.source-digest-mismatch\`,
  \`mapping.unknown-capability\`, \`mapping.unknown-requirement\`,
  \`mapping.requirement-allocation-missing\`,
  \`mapping.requirement-service-unknown\`, \`mapping.service-allocation-empty\`,
  \`mapping.unknown-change\`, \`mapping.change-title-missing\`,
  \`mapping.feature-id-invalid\`, \`mapping.feature-id-duplicate\`,
  \`mapping.unknown-rename\`, \`mapping.invalid-requirement-id\`,
  \`mapping.rename-source-missing\`, \`mapping.rename-source-ambiguous\`,
  \`mapping.rename-source-id-invalid\`, \`mapping.rename-target-conflict\`,
  \`mapping.rename-existing-id-conflict\`, \`mapping.rename-id-conflict\`,
  \`mapping.rename-double-source\`, \`mapping.rename-double-target\`,
  \`mapping.rename-chain\`,
  \`mapping.unknown-artifact\`, and \`mapping.invalid-artifact-disposition\`.
- Repository containment failures are explicit: \`sources.path-outside\` rejects a
  provenance source outside the service repo and \`gherkin.path-outside\` rejects a
  generated-suite target outside it. Federated verify recording refuses under
  \`service-mismatch\`, \`unknown-service\`, or \`repository-unavailable\` when the
  selected service, fleet identity, and repository commit cannot be bound safely,
  and under \`record-federated\` when the legacy all-at-once form would erase other
  repositories' attestations.
- A file loam cannot read is reported, never skipped: \`service.unreadable\` and
  \`feature.unreadable\` (both errors) name the path and say that nothing about
  that target was checked while the rest of the fleet still was. The whole docs
  repo being unreachable is a refusal instead: \`docs-missing\` (\`docsDir\` points
  at nothing) or \`services-missing\` (it is a directory with no \`services/\` —
  usually the service repo after a typo in \`docsDir\`).
- Both modes read frontmatter (\`frontmatter.missing\`, \`frontmatter.malformed\`,
  \`frontmatter.field-mismatch\`,
  \`frontmatter.status-unknown\`, \`frontmatter.field-missing\`); a service's spec.md —
  and its arch.spec.md, same conventions — additionally carries the sources chain
  (\`sources.absent\`, \`sources.path-missing\`, \`sources.empty\`,
  \`sources.skipped\`, \`sources.unvouched\`, \`sources.stale\`) and the doc-side freshness check
  (\`content.stale\`) — the one provenance warning that needs no service repo, so
  it is reported from the docs repo too, \`--service\` and \`--all\` alike.
- \`loam archive\` alone reports the breaches only the merge computation can see:
  \`living.requirement-outside-requirements\` (error), \`openapi.op-modified\` (warn),
  \`openapi.path-item-modified\` (warn), \`openapi.component-modified\` (warn),
  \`openapi.ref-unresolved\` (error) and \`service.no-model\` (warn — the archive
  creates \`services/<id>/\` and nothing writes its model.likec4).

\`loam validate <target>\` is the positional spelling of the first two: a feature id
or a service id, tried in that order, so the feature wins when one name could be
both and \`--service\`/\`--feature\` force the reading. When the name really is both,
the run says so — \`target.ambiguous\` (warn) names the reading it took and the
flag that forces the other, and \`--json\` carries \`resolvedKind\` — because a
silent precedence rule is a report about a target nobody asked for. The
positional together with \`--all\`, \`--service\` or \`--feature\` is refused
(\`invalid-option\`).

Two rendering levers change nothing else: \`loam validate --errors-only\` drops
the confirmations from the TEXT view (the \`--json\` payload is byte-identical),
and \`loam list --needs-work\` narrows the service list to the ones with
something missing — the adoption worklist.

\`--strict\` (every targeting mode, \`--all\` included) exits 1 when any error
or warning exists — \`ok\`-severity findings are confirmations and never trip
it. It changes the exit code and nothing else:
\`valid\` still means "no errors", and the \`--json\` payload stays byte-for-byte
what it was. The stricter grade is a per-invocation lever, visible in the CI
pipeline that passes the flag — deliberately not a per-repo profile.

\`loam delta <FEAT> --json\` exits 1 when \`architecture.errors\` is non-empty, with
\`ok: true\` and the full payload intact: the empty C4 slice means the delta did
not parse, not that the feature changes no architecture. Branch on the exit code
before consuming the slice as a task brief.

Findings with severity \`ok\` are confirmations, not work: \`c4.valid\`, \`delta.valid\`,
\`requirements.covered\`, \`api.covered\`, \`spine.resolved\`, \`coherence.ok\`,
\`landscape.matched\`, \`archedge.covered\`, \`sources.resolved\`, \`sources.current\`,
\`gherkin.current\`.

A finding's \`subject\` names the service it is about. The envelope separates \`ok\` (the
command ran) from \`valid\` (the docs pass). A refusal is \`ok: false\` with a stable
\`error.code\`: \`no-config\` / \`config-invalid\` (no loam.json / a corrupt one),
\`docs-missing\` / \`services-missing\` (a \`docsDir\` that points at nothing, or at a
directory that is not a docs repo — the fleet is unreadable, not empty),
\`unknown-target\` (no such service or feature), \`invalid-option\` (flags that contradict
each other, or a value that cannot be right — a \`loam list\` section that is not
services or features, or a service id that is not a legal
\`services/<id>/\` directory name, included), \`already-exists\` (\`loam new\` refusing
to scaffold over an existing feature), \`sources-absent\` / \`sources-path-missing\` /
\`vouch-raced\` (\`loam vouch\` refusing to stamp — the last one when the document
changed between the read and the write, so nothing was written),
\`not-coherent\` / \`living-outside-requirements\` /
\`archive-exists\` / \`merge-failed\` / \`rollback-incomplete\` / \`docs-busy\`
(\`loam archive\` — see the
archive gate below; \`docs-busy\` means another archive or unarchive holds the docs
repo's lock, nothing was read or written, and re-running once it finishes works),
\`feature-active\` / \`snapshot-missing\` / \`snapshot-stale\` /
\`restore-failed\` / \`rollback-incomplete\` / \`docs-busy\` (\`loam unarchive\` — the
\`restore-failed\` / \`rollback-incomplete\` pair splits
exactly as archive's does; see "Taking an archive back"), \`gherkin-conflict\`
(\`loam gherkin <FEAT>\` would overwrite a \`.feature\` file owned by another
feature still in flight — the whole emission refuses and names the owner),
\`answers-unreadable\` / \`answers-mismatch\` /
\`answers-unevidenced\` / \`record-federated\` / \`record-unreadable\`
(\`loam verify --record\` / \`--results\` — an unreadable or
unrecognizable cucumber report refuses under \`answers-unreadable\` too;
\`record-federated\` and \`record-unreadable\` are the two records loam will not
overwrite), and
\`internal\` — an unexpected throw, the one code with no stable meaning.

\`--all\` reports a target per service, a target per feature in flight, and one target
of kind \`landscape\` for the fleet-level checks that belong to no single service.

Three different words for three different questions, and no command conflates them:
\`ok\` — the command ran; \`valid\` — the documents pass (\`validate\`); \`verified\` —
somebody says the code was built and showed evidence (\`verify\`). A feature can be
valid and unverified, or verified and incoherent. Read the one you meant.

## The archive gate

The three axes agreeing is called **coherence**, and \`loam validate --feature\` reports
it as such. \`loam archive\` runs the same coherence check first and refuses a feature
with GATING issues — every error, plus the rare warning marked \`gates: true\` because
the merge would silently drop authored content even though the document is legal.
Advisory warnings never block: archive prints them and proceeds. Each one still names
something real — usually something the merge will drop or overwrite — so read them
before the merge runs, not after.

\`--approve\` overrides the gating issues — only those, and archive prints exactly which
ones it overrode. It is a human decision, not an agent's: if archive refuses, fix the
breach or hand it back.

Breaches only the merge computation itself can see are reported at plan time,
after the gate. \`living.requirement-outside-requirements\` (error): the LIVING spec
holds a requirement outside \`## Requirements\`, and the merge rewrites only that
section, so the requirement would land in the file twice — \`--approve\` does not
override it, because the duplication is mechanical, not a judgment call; re-home the
requirement first. \`openapi.op-modified\` (warn): the feature redefines an operation
the living OpenAPI already has, and the merge overwrites the living definition
wholesale.

The OpenAPI merge also carries the merged operations' \`$ref\` closure: every
\`#/components/<kind>/<name>\` they reference — recursively, a component's own refs
included — is copied from the feature document into the living one, so an operation
never lands pointing at a schema that stayed behind. \`openapi.component-modified\`
(warn): a carried component overwrites a living one that differs, wholesale, same
discipline as an operation. \`openapi.ref-unresolved\` (error, \`--approve\`
overrides): a ref reachable from the merged operations resolves in neither
document, so merging would write a dangling reference. External refs — URLs, file
paths, anything not starting \`#/\` — are out of scope: left untouched, never gated.

## Taking an archive back

\`loam unarchive <FEAT>\` restores the living docs and re-opens the feature. It works
by putting bytes back, not by inverting the merge — archive copies every file it is
about to overwrite into \`features/archive/<FEAT>/.loam-before/\` first, because the
previous text of a \`MODIFIED\` requirement is written down nowhere else. Do not edit
or delete that directory, and never reconstruct an old living spec by hand from an
archived delta: what the requirement said BEFORE is not in there, and a plausible
reconstruction is a lie the next reader has no way to catch.

It refuses rather than guesses, under codes you can branch on: \`feature-active\` (a
feature of that id is in flight again), \`snapshot-missing\` (archived before loam
recorded this — the docs have to come back from version control), \`snapshot-stale\`
(a merged file changed after the archive, so restoring would revert someone else's
work). \`--force\` overrides the last one, and like \`--approve\` it is a human's call.

A restore that fails outright splits the same way archive's does: \`restore-failed\`
means nothing was restored or everything was rolled back — the living docs are
unchanged, fix the reported cause and re-run; \`rollback-incomplete\` means the
restore failed AND some files could not be put back — stop and hand it to a human,
the message lists the files to check.

## Dropping a feature

A feature that was never archived is one directory and nothing else: no living doc
references it until \`loam archive\` merges it. To abandon it, delete the directory —
\`git rm -r features/<FEAT-dir>\` — and version control keeps the record of the
attempt. An ARCHIVED feature is the opposite, its content folded into the living
docs: run \`loam unarchive <FEAT>\` first, then delete. There is no \`loam abandon\`,
deliberately — a removal that computes nothing is what version control is for.
`;

/**
 * One slash command, format-free. `body` is the whole protocol — the per-tool
 * emitters in AGENT_TOOLS add only a path and a wrapper (frontmatter fields, a
 * TOML shell), never their own prose: one source of truth, thin spellings.
 * Bodies keep Claude's positional `$1`/`$2` placeholder convention across
 * every tool — dialects differ (Gemini's {{args}}, Copilot's ${input}) and rewriting the
 * text per tool would be a second copy of the protocol in all but name; an
 * agent reading the file still sees which argument goes where.
 */
export interface CommandContent {
  /** Stable command name (`loam-check`) — also the flat file name everywhere. */
  name: string;
  description: string;
  /** What the user passes, in Claude's `argument-hint` spelling. */
  argumentHint: string;
  /** The protocol itself: markdown, ends with a newline. */
  body: string;
}

const COMMANDS: CommandContent[] = [
  {
    name: "loam-adopt",
    description:
      "Adopt a service — write its baseline docs from its code, as draft, then validate",
    argumentHint: "<service-id>",
    body: `Write one service's baseline documentation into the loam docs repo (its path is
\`docsDir\` in ./loam.json). You read the code; loam states the work and checks the
result. It never reads the service — so anything you cannot show, do not write.

0. If there is no ./loam.json here, wire the repo first:
   \`loam init --docs <path-to-docs-repo> --service $1\` (add \`--create\` ONLY if the
   docs repo does not exist yet), then \`loam doctor\` — it resolves \`docsDir\`,
   checks the docs repo is one, and reports the service binding. Do not go on with
   \`docs-missing\`, \`services-missing\` or any \`doctor.*\` blocker standing.
1. \`loam adopt --service $1 --json\`. That output IS the brief:
   - \`warnings[]\` — read these FIRST. A near-miss against an existing service id
     usually means \`$1\` is a typo, and a brief followed to the letter then produces
     a complete, validating baseline for a service that does not exist.
   - \`targets[]\` — every file to write. \`action: "diff"\` means the file ALREADY EXISTS:
     read it, diff your findings against it, report what disagrees. Do not replace it.
     \`action: "edit"\` appears on exactly one target — \`architecture/landscape.likec4\`,
     the WHOLE FLEET's map: add this service's element and edges to it, never rewrite it.
   - \`targets[].shape\` — the grammar of each artifact, and \`example\` where one is
     shorter than a description. Every rule there is one a later check depends on;
     rules nothing checks are in \`unchecked[]\` instead, and are still worth following.
   - \`landscape\` — the elements and edges the fleet already has for this service.
     Bind to them; do not draw a second version of the same box. \`landscape.expects\`
     lists operations other services already call — your openapi.yaml owes them.
     \`landscape.instruction\` is the write the fleet map still owes this service; it
     is \`null\` once an element resolves to it, and only then.
   - \`frontmatter\` — what to put in the header of every markdown artifact.
   - \`checks[]\` — what \`loam validate\` will run. \`unchecked[]\` — what it will not.
2. Read \`AGENTS.md\` at the docs repo root, then read the code: entry points, HTTP
   routes and handlers, published events, config, deploy manifests, tests.
   **Keep a list of every path you actually open.** That list becomes \`sources\` —
   written as files and directories, never glob patterns — and it is the only line
   tying the document to the repository.
3. Write the artifacts under \`services/$1/\`, in the order the brief lists them, and
   make the landscape edit the brief asks for.
   Everything \`status: draft\`. Never write \`last_verified\`, \`sources_digest\`,
   \`content_digest\` or \`sources_files\`.
4. \`loam validate --service $1 --json\`. Fix every error. \`sources.unvouched\` is
   expected on a fresh baseline — it closes when a person vouches, not when you do.
5. \`loam validate --all --json\` in the docs repo. This is the run that grades the
   fleet map: \`landscape.service-unmodelled\` means the element never landed,
   \`landscape.binding-unknown\` / \`landscape.binding-duplicate\` mean it landed wrong,
   and \`landscape.missing\` means there is no map at all. A baseline that passes step 4
   and fails this one is documented and invisible.
6. Hand back, and say three things: what you could not determine from the code, what
   the existing artifacts disagreed with, and which parts you are least sure of.
   Then a human runs \`loam vouch --service $1\` in the service's own repo.

Where the code does not say, write that it does not say. A confident sentence about
behaviour nobody can find is the one failure mode none of loam's checks can catch.
`,
  },
  {
    name: "loam-feature",
    description:
      "Start a new loam feature — scaffold it, then author the C4 delta and requirement deltas",
    argumentHint: `<FEAT-id> "<title>"`,
    body: `Start a new feature in the loam docs repo (its path is \`docsDir\` in ./loam.json).

1. Read \`AGENTS.md\` at the root of the docs repo first — it defines the ID spine
   everything here depends on.
2. Understand the current state before proposing a change:
   - \`loam list --json\` — what services exist, and what documentation they are missing
   - \`loam show <service> --json\` — what a service owns, exposes, and who already calls it
3. Scaffold it: \`loam new $1 --title "$2"\`, adding \`--touches <id>\` for every service the
   feature touches and \`--new-service <id>\` for every one it introduces. Every id goes
   through the \`services/<id>/\` grammar, so a typo is refused (\`invalid-option\`)
   rather than scaffolded; a \`--touches\` that matches nothing existing comes back as
   a \`note\` with the close ids, not as a failure.
4. Author what the templates left as TODO:
   - \`intent.md\` — the problem in business terms
   - \`delta.likec4\` — new elements and edges, each tagged \`#$1\`; every call edge carries
     \`metadata { op '<operationId>' }\`. For a requirements-only feature DELETE this
     file: an empty delta is legal, but a scaffold left half-filled is not
   - \`specs/<svc>/spec.md\` — one behaviour per requirement, SHALL, at least one
     Given/When/Then scenario; uncomment \`Operations:\` once the operation exists
   - \`specs/<svc>/arch.spec.md\` — the architectural obligations (outbox, retries,
     idempotency, alerts), same grammar; a \`Covers:\` line per requirement naming the
     tagged elements/edges it accounts for, or \`c4.uncovered\` says nothing does
   - \`specs/<svc>/openapi.yaml\` — define every operationId the edges reference
5. \`loam validate --feature $1 --json\`. Do not stop while \`valid\` is false.
6. \`loam dependencies $1 --json\` before anyone starts building: it says which
   features in flight have to archive first (\`order\`) and which collisions no
   ordering fixes (\`conflicts\`, \`cycles\`).

The operation's three spellings — the edge's \`op\`, the requirement's \`Operations:\`
line, and the OpenAPI \`operationId\` — must match exactly.
`,
  },
  {
    name: "loam-implement",
    description:
      "Implement a loam feature's slice for one service — generated gherkin first, tests from it, then code",
    argumentHint: "<FEAT-id> [service]",
    body: `Implement one service's part of a feature. Every step runs in the SERVICE'S own
repository, which needs its own committed ./loam.json — if there is none,
\`loam init --docs <path-to-docs-repo> --service $2\` then \`loam doctor\` first.

1. \`loam delta $1 --service $2 --json\` (drop \`--service\` to use the service configured
   in ./loam.json). That output IS the task:
   - \`intent\` — why this exists
   - \`requirements[]\` — what to build, with \`scenarios[].lines\` verbatim
   - \`archRequirements[]\` — the architectural obligations (outbox, retries, alerts),
     same shape; their scenarios become integration/ops tests, and \`covers\` names
     the model objects each exercises
   - \`architecture\` — whether this service is new, and the calls in and out of it
   - \`api\` — the endpoints this feature adds or retires for this service: path,
     method, operationId and summary, with removals spelled \`REMOVE <METHOD> <path>\`
   - \`services\` — every service this feature projects onto, so a run without
     \`--service\` tells you which ones to ask for rather than guessing
   Exit 1 with \`ok: true\` means \`architecture.errors\` is non-empty: delta.likec4 did
   not parse, and the empty C4 slice is a parse failure, not "no architecture change".
   Stop and fix the delta (\`loam validate $1 --json\`) before building anything.
2. In the service's repo, \`loam gherkin $1 --json\` — one \`.feature\` file per changed
   requirement lands under \`<gherkinDir>/loam/\` (default \`features/loam/\`), scenarios
   digest-stamped, arch requirements tagged \`@architecture\`. Those files ARE the
   acceptance criteria. Never edit them: regeneration rewrites the directory, and
   \`loam validate\` reports the suite stale by digest, not by your intentions.
3. Write step definitions for the generated scenarios FIRST — outside \`loam/\`.
   Do not paraphrase a scenario into something easier to pass; it is the acceptance
   criterion someone else reviews against.
4. Implement until the suite passes — run it with a JSON report
   (\`cucumber-js --format json:report.json\`):
   \`loam verify $1 --service $2 --results report.json\` consumes that report as the
   done-check's answer sheet. Record from THIS repo, with \`--service\` — the
   \`--service\`-less \`--record\` form writes the whole record from one place and is
   refused (\`record-federated\`) once another service has attested.
5. Honour the contract: every operation in \`architecture.inbound\` must exist under
   exactly that operationId, and every one in \`architecture.outbound\` must be called.
6. \`loam validate --feature $1 --json\` before handing back.

If the requirement is ambiguous, say so and stop — do not invent behaviour and
leave the spec disagreeing with the code.
`,
  },
  {
    name: "loam-check",
    description: "Validate the loam docs repo and fix what it reports",
    argumentHint: "[--all | <FEAT-id> | <service>]",
    body: `Run loam's checks and fix what they find.

- whole fleet: \`loam validate --all --json\` (run in the docs repo)
- one target: \`loam validate <FEAT-id | service-id> --json\` — the feature reading is
  tried first; \`--feature <id>\` / \`--service <id>\` force one when a name could be both,
  and \`target.ambiguous\` (warn) says when a name really was both and which reading was taken
- \`--strict\` (any mode) exits 1 on any warning too. Exit code only: \`valid\` and the
  payload do not change, so the stricter grade lives in the CI invocation, not the repo
- \`--errors-only\` drops the \`ok\` confirmations from the text view; the \`--json\`
  payload is byte-identical either way
- refusals before any grading: \`docs-missing\` / \`services-missing\` (\`docsDir\` in
  ./loam.json points at nothing, or at a directory with no \`services/\`) — run
  \`loam doctor\` and fix the wiring, do not read an empty report as a clean fleet

Branch on \`findings[].code\`, not the prose. Errors fail validate; a coherence finding
with \`gates: true\` will stop \`loam archive\` even when it is a warning. Fix every
error and every gating finding. Leave an advisory warning only if you can say why,
and say it.

\`--service <id>\` — one service's own axes (\`--all\` runs these for every service):

| code | what it means | what to do |
|---|---|---|
| \`service.unknown\` | no \`services/<id>/\` at all — the id is a typo until proven otherwise | use one of the ids the message offers, or \`loam list services\`; never \`loam adopt\` a misspelling |
| \`service.no-model\` | the directory is real but there is no model.likec4 | run \`loam adopt\` for it — without the C4 center nothing else has anywhere to hang |
| \`c4.invalid\` | model.likec4 does not parse | fix this first — an unreadable axis makes every other check meaningless |
| \`requirements.missing-scenarios\` | a requirement with no scenario | add the acceptance criteria; do not delete the requirement |
| \`spec.duplicate-requirement\` | one \`### Requirement:\` name defined twice in one living spec.md or arch.spec.md — a merge edits only the first, the rest live on as stale copies | keep exactly one block per name (merge the bodies); the two files are separate namespaces, so a name in both is fine |
| \`spec.requirement-id-invalid\` | a \`Requirement-ID\` violates \`[A-Za-z][A-Za-z0-9._-]{0,127}\` | replace it with a portable stable ID; do not remove an established ID merely to silence the check |
| \`spec.requirement-id-repeated\` | one requirement declares \`Requirement-ID\` more than once | keep exactly one identity line |
| \`spec.requirement-id-duplicate\` | one ID identifies multiple requirements in the same file | give each requirement its own stable ID |
| \`spec.repeated-operations\` (warn) | a second \`Operations:\` line in one requirement body — the last line REPLACES the earlier ones, whose list is silently lost (living specs and feature deltas alike) | merge them into one comma-separated \`Operations:\` line |
| \`spec.repeated-covers\` (warn) | same for \`Covers:\` — the last line wins, the earlier list is silently lost | merge them into one comma-separated \`Covers:\` line |
| \`spec.no-requirements\` (warn) | a LIVING spec.md with no \`### Requirement:\` block at all — every requirement-driven check below it is vacuous, not passing | write the requirements, or say in the file why the service has none yet |
| \`service.unreadable\` | an artifact of this service could not be read (permissions, a dangling symlink) — nothing about the service was checked, and the rest of the fleet still was | fix the file the finding names; a service silently skipped would have read as a clean one |
| \`service.no-spec\` (warn) | no living spec.md — a part-adopted service, legal but unchecked | write it; until it exists, requirement coverage and API governance are vacuous |
| \`service.no-openapi\` (warn) | no openapi.yaml, and the landscape cannot prove nobody calls this service | write the contract, or model the service so the fleet map shows no one expects an API |
| \`openapi.invalid\` | openapi.yaml exists but does not parse — an unreadable contract proves nothing, so no \`api.*\` or spine finding is graded against it (before this code, the empty parse graded every inbound edge \`spine.op-undefined\`) | fix the YAML first — the API axis is unchecked until it reads |
| \`openapi.remove-marker-living\` | a living openapi.yaml contains feature-only \`x-loam-remove: true\` | remove the marker from living; retire the operation through a feature delta with a matching REMOVED requirement |
| \`openapi.duplicate-operationid\` (warn) | one operationId occupies two (path, method) slots in a living contract — every join on the id (a requirement's \`Operations:\` line, an edge's \`metadata { op }\`, a removal marker) then picks one of them arbitrarily | give each slot its own id; the identity of an operation is its path and method, and the id is how the other axes name it |
| \`spec-api.op-undefined\` | a LIVING requirement's \`Operations:\` line names an operationId this service's openapi.yaml does not define (the same code fires inside a feature delta) | define the endpoint, or correct the \`Operations:\` line — the two axes disagree about what the service exposes |
| \`api.ungoverned\` (warn) | operation(s) no requirement's \`Operations:\` line names | write the requirement, or link an existing one |
| \`api.ops-unlinked\` (warn) | operations AND requirements exist but zero \`Operations:\` lines join them — the API axis is vacuously green | link each requirement to the operations it governs |
| \`api.requirement-deprecated\` (warn) | a requirement's \`Operations:\` list resolves only to operations the OpenAPI marks \`deprecated: true\` — the behaviour it governs is on its way out | migrate the requirement to the replacement operation, or retire it with the ops it governs |
| \`spine.landscape-invalid\` | the living landscape does not parse, so the C4↔API spine cannot be checked | fix architecture/landscape.likec4 first |
| \`spine.op-undefined\` | a landscape edge calls an operation this service's OpenAPI does not define | a broken contract between services — fix the edge or add the endpoint |
| \`spine.op-link-missing\` (warn) | a landscape "Calls" edge into this service with no \`metadata { op }\` | link it to the operationId |
| \`spine.op-deprecated\` (warn) | a landscape edge calls an operation this service's OpenAPI marks \`deprecated: true\` — the consumer is standing on a contract being retired | migrate the consumer to the replacement operation; deprecation is the first step of retiring an op, and the op stays defined until a human removes it |
| \`covers.unknown\` (warn) | a \`Covers:\` entry in arch.spec.md resolves to no element, edge, alert or SLI — living and feature deltas alike | fix the id (the message offers close ones); a mistyped entry silently costs the coverage it was written for |
| \`health.invalid\` (warn) | health.yaml exists but does not parse — alert/SLI ids are unreadable, so \`Covers: alert:/sli:\` entries and health coverage are unchecked (a missing health.yaml is legal and silent; an unreadable one used to masquerade as \`covers.unknown\` typos) | fix the YAML — the health axis resumes once it reads |
| \`health.uncovered\` (warn) | health.yaml declares an alert or SLI no arch.spec.md requirement covers | write the arch requirement with \`Covers: alert:<id>\` / \`Covers: sli:<id>\` — a signal nothing tests is dashboard decoration |
| \`gherkin.missing\` (warn) | a living scenario no generated .feature scenario carries a digest for — the suite has no test for these words. Fires only in the service's repo, once \`<gherkinDir>/loam/\` exists | \`loam gherkin --service <id>\` regenerates the suite |
| \`gherkin.stale\` (warn) | a generated scenario's digest matches no living scenario while its requirement still exists — the spec moved under the file (a reworded scenario reports stale + missing together) | regenerate; never edit a generated file to catch it up |
| \`gherkin.orphaned\` (warn) | a generated file whose requirement no longer exists in the living spec (a file for a feature still in flight is exempt — it answers to its feature until it archives) | regenerate; the orphaned file is deleted and reported |

\`--feature <FEAT-id>\` — a change's three axes against each other. The SAME checks
gate \`loam archive\` (errors block it; warnings never do), so a clean run here is
what lets a feature ship:

| code | what it means | what to do |
|---|---|---|
| \`delta.invalid\` | delta.likec4 does not parse | fix this first — an unreadable axis makes every other check meaningless |
| \`delta.nothing-tagged\` | the delta declares elements/relationships but none carry \`#<FEAT>\` | tag what IS the change — untagged parts are context, and archive merges only tags |
| \`spec-api.op-undefined\` | a requirement governs an operation its provider's OpenAPI does not define | define the endpoint, or correct the \`Operations:\` line |
| \`spec-api.op-pending\` (warn) | the governed operation is defined by another feature in flight | archive that feature first |
| \`c4-api.op-undefined\` | an edge calls an operation the target does not expose | a broken contract between services — fix the caller or add the endpoint |
| \`c4-api.op-pending\` (warn) | the called operation is defined by another feature in flight | archive that feature first |
| \`c4-api.op-deprecated\` (warn) | a NEW tagged edge consumes an operation the living provider's OpenAPI marks \`deprecated: true\` — building new consumption on a dying op (quiet when this feature's own openapi delta drops the flag: that IS the un-deprecation) | point the edge at the replacement operation, or say why the deprecated one is right; never gates archive |
| \`c4-api.op-removing\` | a NEW tagged edge consumes an operation this feature removes | remove or redirect the new edge; one feature cannot retire and add consumption of the same operation |
| \`openapi.remove-target-missing\` | an \`x-loam-remove: true\` marker's exact path+method does not exist in living OpenAPI | update the stale marker to the current slot, or drop it if the operation is already gone |
| \`openapi.remove-target-mismatch\` | the marker's operationId differs from the living operation at that path+method | name the living operation exactly; loam never deletes the different operation occupying the slot |
| \`openapi.remove-marker-missing\` | a REMOVED requirement governs an operation but the feature has no removal marker | add the exact path/method operation with its operationId and \`x-loam-remove: true\` to the feature openapi.yaml |
| \`openapi.remove-marker-unjustified\` | a removal marker is not named by any REMOVED requirement's \`Operations:\` line | remove the marker or retire the governing requirement in the same feature |
| \`openapi.remove-marker-anonymous\` | an \`x-loam-remove: true\` marker with no \`operationId\` — loam cannot tell which operation it retires, and the marker itself would be written into the living contract | name the operation the marker retires, exactly as the living contract spells it |
| \`openapi.remove-op-consumed\` | the feature retires an operation the LIVING fleet still consumes — a landscape edge's \`metadata { op }\`, or another service's living requirement naming it | fix the consumer in the same feature (redirect the edge, retire its requirement), or archive with \`--approve\` if the consumer is already gone in code |
| \`c4.op-ungoverned\` (warn) | an operation is called but no requirement governs it | write the requirement |
| \`c4.op-link-missing\` (warn) | a "Calls" edge in the delta with no \`metadata { op }\` | link it to the operationId |
| \`api.op-unconsumed\` (warn) | an added operation no edge consumes | model the caller, or say why it is provider-only |
| \`service.no-requirement-delta\` (warn) | a new service with no spec delta | write \`specs/<svc>/spec.md\` |
| \`archedge.uncovered\` (warn) | no scenario names a tagged edge (a heuristic) | write the scenario, or say why the edge needs none |
| \`c4.uncovered\` (warn) | a NEW tagged element or edge in delta.likec4 that no arch requirement covers via \`Covers:\` — the mechanical check, not the heuristic above | add the requirement to \`specs/<svc>/arch.spec.md\` (outbox? retries? alerts?), or the architectural obligations ship unchecked |
| \`delta.unknown-section\` | a heading that nearly matches the delta grammar | fix it — everything under it merges as NOTHING today, silently |
| \`delta.no-delta-sections\` | requirements, but no \`## ADDED/MODIFIED/REMOVED Requirements\` section anywhere — the whole delta would merge nothing | put every changed requirement under its delta section |
| \`delta.requirement-not-merged\` (warn, gates archive) | a requirement under a prose heading (\`## Behavior\`) instead of a delta section | move it under \`## ADDED\`/\`## MODIFIED\`/\`## REMOVED Requirements\` — as written, archive drops it. If it really is documentation, quote it under \`## Requirements\`, which is exempt |
| \`delta.requirement-id-invalid\` / \`delta.requirement-id-repeated\` / \`delta.requirement-id-duplicate\` | a stable ID is malformed or ambiguous inside the delta | repair it before archive; identity is never inferred from an invalid declaration |
| \`delta.living-requirement-id-invalid\` | the living file's IDs are malformed or ambiguous | repair the living spec first; the delta cannot select it safely |
| \`delta.requirement-identity-collision\` | the delta's ID and heading point at different living requirements | fix the ID or heading; archive will not guess which identity should win |
| \`delta.modified-unknown\` | MODIFIED a requirement the living spec does not have | use ADDED, or fix the name (a spelling slip reads as a different requirement) |
| \`delta.removed-unknown\` | REMOVED one that does not exist | drop the section, or fix the name |
| \`delta.added-duplicate\` | ADDED a name the living spec already has | use MODIFIED — as written, the merge REPLACES the living requirement |
| \`delta.added-near-duplicate\` (warn) | ADDED a name that differs only in case from a living requirement — the merge matches exactly, so both would coexist | match the living spelling and use MODIFIED, or pick a distinct name |
| \`delta.living-duplicate-requirement\` | two requirements in the LIVING document share one heading — MODIFIED rewrites only the first and REMOVED deletes both, so no delta applies to it predictably | fix the living spec first (merge the bodies, or give each a distinct heading and a \`Requirement-ID\`); the delta cannot select safely until you do |
| \`delta.modified-pending\` (warn) | the requirement is introduced by another feature in flight | archive that feature first — \`loam dependencies --json\` computes the whole ordering (\`order\`), so you do not have to work it out per finding |
| \`delta.removed-pending\` (warn) | REMOVED something another feature in flight introduces | archive that feature first; \`loam dependencies --json\` says in which order |
| \`delta.added-conflict\` (warn) | two features in flight add the same requirement | whichever archives first lands it; the other's ADDED then collides with the living spec (\`delta.added-duplicate\`, error) and its archive is refused — coordinate now, or rework the later one as MODIFIED after the first ships. No ordering fixes it, which is why \`loam dependencies\` reports it under \`conflicts\` rather than in \`order\` |
| \`delta.modified-conflict\` (warn) | another feature in flight MODIFIES or REMOVES the same living requirement | both deltas apply cleanly, so whichever archives second replaces the other's text wholesale — \`loam dependencies\` lists it under \`conflicts\`; merge the two intentions before either ships |
| \`delta.baseline-stale\` | the living requirement changed after this delta was written against it | someone landed a change in between and this MODIFIED would replace it outright. Re-read the living requirement, fold in what you still mean, then \`loam rebase <FEAT>\`. Re-pinning without re-reading is how you overwrite them on purpose |
| \`delta.baseline-missing\` (warn) | a MODIFIED/REMOVED requirement with no \`Based-On:\` | run \`loam rebase <FEAT>\` — until then nothing can say whether the living text moved under this delta. Expected on deltas adopted from OpenSpec, which never carried the line |
| \`delta.baseline-invalid\` | a \`Based-On:\` that is not a digest, declared twice, or sitting on an ADDED requirement | \`loam rebase\` writes the value; an ADDED requirement has no living version to be based on, so drop the line or make it MODIFIED |

\`--all\` — everything above for every target, plus the fleet cross-check:

| code | what it means | what to do |
|---|---|---|
| \`landscape.missing\` | \`architecture/landscape.likec4\` does not exist — an ERROR as soon as \`services/\` holds one service, a warning only in an empty docs repo | create it: a \`specification { ... }\` block declaring the kinds, then a \`model { ... }\` block with one bound element per service (\`metadata { service '<id>' }\`) and one edge per cross-service call carrying \`metadata { op '<operationId>' }\`. With no fleet map every cross-service check is blind, not passing |
| \`landscape.invalid\` | the living landscape does not parse | fix it first — the fleet cross-check cannot run against a document nobody can read |
| \`landscape.service-unmodelled\` | a \`services/<svc>/\` no element in the landscape resolves to | draw it, or bind an existing element with \`metadata { service '<svc>' }\` — the fleet map is incomplete until you do |
| \`landscape.service-undocumented\` (warn) | a landscape element with no \`services/<id>/\` | document the service, bind the element to the directory it means, or tag it \`#external\` if it is not ours |
| \`landscape.binding-unknown\` | an element's \`metadata { service }\` names a directory that does not exist | fix the id or create the service — a binding is a claim, and this one is false |
| \`landscape.binding-duplicate\` (warn) | two elements resolve to the same \`services/<id>/\` | every element→service join picks one of them arbitrarily, so the other's edges are filed under a service that does not own them — bind each element to the directory it actually is, or tag the stray one \`#external\` |
| \`feature.unreadable\` | an artifact of a feature in flight could not be read — nothing about that feature was graded, and the rest of the fleet still was | fix the file the finding names; a feature silently skipped would have read as a clean one |
| \`sources.unverifiable-from-here\` (ok) | one finding PER SERVICE whose \`sources\` only its own repo can check — a confirmation, not work, so it never trips \`--strict\`, and it is present in \`--service\` runs from the docs repo too | run \`loam validate --service <id>\` from inside that service's repo to actually grade its provenance; the fleet rollup line is derived from these findings |
| \`agents.stale\` (warn) | the docs repo's AGENTS.md has no version stamp, or one older than the running binary — its flag and code tables may describe a loam that no longer exists | review AGENTS.md against the current \`loam --help\`, then update the \`<!-- generated by loam vX.Y.Z -->\` line; a hand-curated file silences it by bumping the stamp itself. Never regenerate the file — the team's edits outrank the template |

frontmatter and provenance — services' spec.md and arch.spec.md, and features'
intent.md, both modes:

| code | what it means | what to do |
|---|---|---|
| \`frontmatter.missing\` (warn) | no frontmatter at all | add owner, status and sources |
| \`frontmatter.malformed\` | the frontmatter block does not parse as YAML — owner, status and sources are unreadable, which is not the same fact as absent | fix the header; the field checks and the sources chain resume once it parses — never add fields to a block YAML refuses |
| \`frontmatter.field-mismatch\` | the doc names a different service/feature than the one it lives under | fix the frontmatter, or move the file |
| \`frontmatter.status-unknown\` | a status nobody defined (\`verifed\`) | use the documented vocabulary — a typo here reads as unverified forever |
| \`frontmatter.field-missing\` (warn) | owner, status or the identity field is absent | fill them in |
| \`sources.absent\` (warn) | the doc names no sources | nothing ties it to the code, so nothing can tell you when it goes stale |
| \`sources.path-missing\` | a listed source no longer exists, or is a glob pattern (no longer supported) | the code moved — re-read it and update the doc, do not just fix the path. For a pattern, name files or directories instead |
| \`sources.stale\` (warn) | the source files changed since the doc was vouched for — the finding names which paths were added, changed or removed, from the \`sources_files\` index the stamp carries | re-read the code at exactly those paths, correct the doc, then ask a human to \`loam vouch --service <id>\` |
| \`sources.empty\` (warn) | the declared \`sources\` exist but expand to no files at all — an empty directory, or a tree the repository ignores. A digest over nothing reads as current forever | point \`sources\` at the files the document was actually written from; \`loam vouch\` refuses to stamp this state with the same sentence |
| \`sources.skipped\` (warn) | a path under a listed source was found but NOT hashed: a symlink loam will not follow (its target is outside the repository, dangling, or not a file or directory) — the digest cannot go stale over bytes it never read | not yours to close by editing the document: either the symlink should not be under a listed source, or \`sources\` should name the real path. Report it |
| \`sources.unvouched\` (warn) | \`sources\` with no \`sources_digest\` — nobody ever stamped it | leave it: vouching is a human's reading, not yours |
| \`content.stale\` (warn) | the spec's body changed since it was vouched — \`status: verified\` is standing over words nobody has read. Unlike \`sources.*\` it needs no service repo, so it fires from the docs repo too | if you edited the doc, that is the point: report it and ask a human to re-vouch. Never revert the doc or touch the digest just to silence it |

\`loam archive\` alone — breaches only the merge computation can see, reported at
plan time (they never appear in \`validate\`):

| code | what it means | what to do |
|---|---|---|
| \`living.requirement-outside-requirements\` | the LIVING spec holds a requirement outside \`## Requirements\`, and the merge rewrites only that section — it would land in the file twice | re-home the requirement under \`## Requirements\`, then re-run; \`--approve\` does not override this |
| \`openapi.op-modified\` (warn) | the feature redefines an operation the living OpenAPI already has — the merge overwrites the living definition wholesale | make sure the redefinition is intended; if not, align the feature's openapi.yaml with the living one |
| \`openapi.path-item-modified\` (warn) | the delta redefines a PATH-level key (\`parameters\`, \`servers\`, \`summary\`, an \`x-\`) the living OpenAPI already has — the overwrite applies to EVERY operation on that path, including ones this feature never mentions | keep path-level keys out of the delta unless changing them for every operation on the path is the intent |
| \`service.no-model\` (warn) | the archive creates \`services/<id>/\` but nothing writes its \`model.likec4\` | run \`loam adopt --service <id>\` after the archive lands, or the new service ships without a C4 center and \`validate --all\` grades it incomplete |
| \`openapi.component-modified\` (warn) | a component the merged operations reference already exists in the living OpenAPI with different content — the merge copies the feature's version over it wholesale | make sure the redefinition is intended; if not, align the feature's component with the living one |
| \`openapi.ref-unresolved\` | a \`$ref\` reachable from the merged operations resolves in neither the feature's OpenAPI nor the living one — the merge would write a dangling reference | define the missing component or fix the ref; \`--approve\` merges the dangling reference anyway. External refs (not starting \`#/\`) are never checked |

\`sources.stale\` and \`content.stale\` are the warnings you cannot close by yourself.
Fix what the code now says, then hand it back — the stamp is a person's claim to
have read it.
`,
  },
  {
    name: "loam-verify",
    description:
      "Verify a built loam feature against its own promises, claim by claim, with evidence",
    argumentHint: "<FEAT-id>",
    body: `Check that the code somebody just built is the feature that was designed.

loam derives the questions; the test runner and you answer them. loam never
reads the service, so a verdict is worth exactly what its evidence is worth.

1. \`loam verify $1 --json\`. \`claims[]\` is the checklist, derived from the feature's
   own artifacts — one claim per new service, per operation its openapi delta adds,
   per tagged edge that names an operation, and per scenario of every changed
   requirement, arch.spec.md deltas included. Each has a stable \`id\` and a
   \`subject\` (the service whose code answers it); a claim that says arch.spec.md
   wants an integration/ops test, not an acceptance test. An ARCHIVED feature returns its record as frozen history instead
   (\`frozen: true\`) and \`--record\` / \`--results\` refuse it — \`loam unarchive\`
   first if the answers really must change.
2. The \`scenario.tested\` claims are the runner's to answer, not yours. In the
   service's repo, run the generated suite with a JSON report —
   \`npx cucumber-js --format json:report.json\` (cucumber-jvm, behave and
   SpecFlow emit the same format). The generated scenarios carry
   \`@loam-digest-…\` tags that ride into the report; that digest is the match,
   so never retitle or hand-edit a generated scenario to make one pass.
3. Answer every OTHER claim by finding it in the code. Not by reasoning that it
   must be there — by opening the file:
   - \`service.exists\` — the service is deployable: its build, its entry point.
   - \`api.exposes\` — the route handler serving that operationId, not the spec that
     declares it.
   - \`c4.calls\` — the call site in the CALLER.
4. Write those answers as JSON — evidence is \`file:line\`, one entry per place it can
   be seen:
   \`\`\`json
   { "answers": [
     { "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/split/Api.ts:42"] },
     { "id": "<claim id>", "verdict": "unconfirmed", "note": "the split service has no entry point yet" }
   ] }
   \`\`\`
5. Record, **in each affected service's own repository**, one service at a time:

   \`\`\`sh
   loam verify $1 --service <id> --results report.json --record answers.json --json
   \`\`\`

   \`--service <id>\` narrows the checklist to that service's claims and binds the
   answers to this repository's commit, writing ONE attestation into a shared
   \`schema: 2\` \`verification.yaml\`. Running it in the next repo adds that repo's
   attestation and leaves the others standing. In a repo whose ./loam.json
   declares a \`service\`, \`--service\` may be omitted — it is substituted, and the
   run still federates. \`--results report.json\` alone is legal when the
   checklist is all scenarios.

   ⚠ **Never run \`loam verify $1 --record answers.json\` without \`--service\`.**
   That is the legacy all-at-once form: it writes the WHOLE record from one place,
   and over a record that already carries other services' attestations it is
   refused (\`record-federated\`, naming them) precisely because it would erase
   them. If you meet that refusal, re-run with \`--service\`; do not work around it.

   The other refusals: \`answers-mismatch\` (an id
   nobody asked about, a claim you left out — re-run step 1, the feature moved —
   or an answers entry for a \`scenario.tested\` claim: the runner owns those),
   \`answers-unevidenced\` (a \`confirmed\` with nothing behind it),
   \`answers-unreadable\` (a report or answers file it cannot read),
   \`record-unreadable\` (a \`verification.yaml\` that exists but cannot be read as a
   record — it is never overwritten; a human repairs it),
   \`service-mismatch\` (\`--service\` names a service this repo does not declare) and
   \`repository-unavailable\` (\`--service\` from a repo that declares none, or whose
   commit cannot be read — an attestation must be bound to the code it is about).
6. Report every \`unconfirmed\` claim and what it would take to close it, and read
   \`discarded\` in the payload: it names every previous answer the new record does
   not carry, and each one is either evidence that went stale or evidence that was
   just dropped. A scenario claim the report failed or missed closes by fixing the
   code and re-running the suite — never by editing the generated .feature.
7. Reading is safe from anywhere: \`loam verify $1 --service <id> --json\` without
   \`--record\` writes nothing and works from the docs repo too. \`services\` lists
   every subject of the checklist, so it is how you find out which repos still
   owe an attestation.

Anything you cannot show is \`unconfirmed\` with a note. That is a successful record,
and it is the useful one: nothing gates on this file, so the only thing it is for is
telling the next reader the truth. \`loam archive\` will ship the feature either way —
which is exactly why a \`confirmed\` you cannot back up costs nothing now and misleads
everyone later.
`,
  },
  {
    name: "loam-ship",
    description: "Archive a finished loam feature — merge its deltas into the living docs",
    argumentHint: "<FEAT-id>",
    body: `Archive a shipped feature.

1. Confirm the code is actually built and merged. Archiving folds the delta into the
   living docs; doing it early makes the docs claim something that does not exist.
2. \`loam validate --feature $1 --json\` — must come back \`valid: true\`.
3. \`loam archive $1 --dry-run --json\` first. \`plan[]\` is every file the merge would
   write (\`create\` / \`update\`, then the final \`move\` into \`features/archive/\`), and
   none of them are written — read it before letting the merge touch the source of
   truth, and stop if a file you did not expect is on it. \`warnings[]\` is what the
   merge will do that is legal but lossy — advisory warnings never block, which is
   exactly why you read them now: \`openapi.op-modified\` means an operation the living
   contract already defines gets overwritten wholesale (\`openapi.component-modified\`
   is the same story for a component the merged operations carry), and \`delta.added-conflict\`
   means another feature in flight adds the same requirement — the first to archive
   lands it, and the other's archive is then refused (\`delta.added-duplicate\`: its
   ADDED now collides with the living spec) unless a human \`--approve\`s the
   replacement.
4. \`loam archive $1 --json\`. It merges three axes into the living state — requirements
   into \`services/<svc>/spec.md\`, endpoints into \`services/<svc>/openapi.yaml\`,
   elements and edges into \`architecture/landscape.likec4\` — then moves the feature
   under \`features/archive/\`. Success is \`ok: true\`; on \`ok: false\`, branch on
   \`error.code\`:
   - \`not-coherent\` — gating coherence issues; \`issues[]\` in the envelope lists them,
     each with \`gates\` resolved (advisory warnings do not block). Fix the breaches.
     \`--approve\` overrides the gating issues and is a human's call to make, not
     yours: report the breach and stop.
   - \`living-outside-requirements\` — the LIVING spec holds a requirement outside
     \`## Requirements\`, and the merge would duplicate it. Re-home it, then re-run.
     \`--approve\` does not move this one.
   - \`archive-exists\` — \`features/archive/\` already has that directory; a human
     decides what it is.
   - \`merge-failed\` — the merge could not be computed, or failed and was rolled
     back. Either way the living docs are unchanged; fix the reported cause, re-run.
   - \`docs-busy\` — another \`loam archive\` or \`loam unarchive\` holds the docs
     repo's lock. Nothing was read or written; wait for it and re-run once.
   - \`rollback-incomplete\` — the merge failed AND some files could not be restored.
     Stop and hand it to a human; the message lists the files to check.

Archived by mistake? \`loam unarchive $1\` restores the living docs from the snapshot
archive left in \`features/archive/$1*/.loam-before/\` and re-opens the feature. Do not
hand-edit the living docs back instead: the previous text of a \`MODIFIED\` requirement
is in that snapshot and nowhere else, so anything you write by hand is a guess.
`,
  },
];

/**
 * A tool the commands can be emitted for — the registry key is the `--tools`
 * id (OpenSpec's ids where the tool has one there). A path and a wrapper are
 * the WHOLE adapter: OpenSpec's per-tool command layer, minus everything loam
 * refuses on principle — no version stamps in command files, no
 * overwrite-on-update, no managed marker blocks in anyone else's file. Paths
 * and wrappers follow each tool's own documented convention, pinned in
 * test/agents.test.ts.
 */
export interface AgentTool {
  /** Repo-relative path segments of one command's file. */
  path(name: string): string[];
  /** The full file: this tool's wrapper around the shared body. */
  format(cmd: CommandContent): string;
}

/**
 * TOML basic-string escapes for the one non-markdown format. Today's bodies
 * carry neither backslashes nor `"""`, but the escape is what keeps a future
 * body edit from silently corrupting the generated TOML.
 */
const tomlLine = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const tomlBlock = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"""/g, '""\\"');

export const AGENT_TOOLS: Record<string, AgentTool> = {
  // The original target and the default. This wrapper must stay byte-identical
  // to what loam has always written: SLASH_COMMANDS below derives through it,
  // and an already-initialized repo must read as fully scaffolded (`skipped`),
  // never as drifted.
  claude: {
    path: (name) => [".claude", "commands", `${name}.md`],
    format: (c) =>
      `---\ndescription: ${c.description}\nargument-hint: ${c.argumentHint}\n---\n\n${c.body}`,
  },
  // Cursor invokes by flat file name (`/loam-check`); its frontmatter `name`
  // field spells that invocation form.
  cursor: {
    path: (name) => [".cursor", "commands", `${name}.md`],
    format: (c) => `---\nname: /${c.name}\n---\n\n${c.body}`,
  },
  // Copilot prompt files: `.prompt.md` extension, description-only frontmatter.
  "github-copilot": {
    path: (name) => [".github", "prompts", `${name}.prompt.md`],
    format: (c) => `---\ndescription: ${c.description}\n---\n\n${c.body}`,
  },
  // Gemini: TOML, and a namespace DIRECTORY — `.gemini/commands/loam/check.toml`
  // is invoked as `/loam:check`, so the file name drops the `loam-` prefix the
  // flat-named tools carry.
  gemini: {
    path: (name) => [".gemini", "commands", "loam", `${name.replace(/^loam-/, "")}.toml`],
    format: (c) =>
      `description = "${tomlLine(c.description)}"\nprompt = """\n${tomlBlock(c.body)}"""`,
  },
  opencode: {
    path: (name) => [".opencode", "commands", `${name}.md`],
    format: (c) => `---\ndescription: ${c.description}\n---\n\n${c.body}`,
  },
  // Cline reads workflows from `.clinerules/` — plain markdown, no frontmatter.
  cline: {
    path: (name) => [".clinerules", "workflows", `${name}.md`],
    format: (c) => `# ${c.name}\n\n${c.body}`,
  },
};

/**
 * The Claude-format files, keyed by command name. Kept as the exported shape
 * because it IS the on-disk contract of every repo initialized before
 * `--tools` existed — and derived through the same adapter that writes the
 * files, so the export and the disk can never disagree.
 */
export const SLASH_COMMANDS: Record<string, string> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, AGENT_TOOLS["claude"]!.format(c)]),
);

/**
 * Every command file the selected tools would lay down, in creation order —
 * the same list `init` probes for `skipped` BEFORE the scaffold runs, so
 * created + skipped is the same list on every repo.
 */
export function plannedCommandFiles(
  cwd: string,
  toolIds: string[],
): Array<{ path: string; content: string }> {
  return toolIds.flatMap((id) => {
    const tool = AGENT_TOOLS[id];
    if (tool === undefined) throw new Error(`unknown agent tool: ${id}`);
    return COMMANDS.map((c) => ({
      path: join(cwd, ...tool.path(c.name)),
      content: tool.format(c),
    }));
  });
}

/**
 * Write the slash commands for the selected tools into `cwd`. Existing files
 * are left alone — the never-overwrite contract covers every tool, not just
 * the default. Returns the paths created.
 */
export async function scaffoldAgentCommands(
  cwd: string,
  toolIds: string[] = ["claude"],
): Promise<string[]> {
  const created: string[] = [];
  for (const { path, content } of plannedCommandFiles(cwd, toolIds)) {
    if (existsSync(path)) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    created.push(path);
  }
  return created;
}
