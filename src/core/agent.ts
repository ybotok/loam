/**
 * The agent contract: what `loam init` lays down so a coding agent can run the
 * cycle without being told it each time.
 *
 * AGENTS.md goes into the docs repo — it travels with the thing it describes.
 * The slash commands go into the repo `init` runs in, because that is where the
 * agent is invoked. Neither is ever overwritten: they are starting points, and
 * a team's edits to them outrank ours.
 *
 * The stamp on the first line is the one concession to that never-refresh
 * contract: it records which loam wrote the file, so `loam validate --all` can
 * say when the tables below describe a binary that no longer exists
 * (`agents.stale` — detection only, never a rewrite; agents-stamp.ts).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  openapi.yaml                    its API contract
  adrs/  runbook.md  health.yaml  why it is like this, how to run it
features/<FEAT>/                  a change in flight
  intent.md                       why, in business terms
  delta.likec4                    the architecture change, tagged #<FEAT>
  specs/<svc>/spec.md             the requirement change for one service
  specs/<svc>/openapi.yaml        the endpoints this feature adds
  verification.yaml               what was checked once the code was built
features/archive/<FEAT>/          shipped changes — the evolution history
\`\`\`

**Living vs delta.** \`services/<svc>/spec.md\` is the complete current state.
\`features/<FEAT>/specs/<svc>/spec.md\` is a diff against it, reviewed as a diff, with
requirements grouped under \`## ADDED\`, \`## MODIFIED\` or \`## REMOVED Requirements\`.
\`loam archive\` folds the delta into the living state.

## Frontmatter — who vouched for this, and from what

Every markdown artifact opens with a YAML block:

\`\`\`yaml
---
service: payment-service     # or  feature: FEAT-101
status: verified             # services: draft -> verified
                             # features: proposed -> in_progress -> built -> done
owner: payments-team
last_verified: 2026-07-31    # written by \`loam vouch\` — do not hand-edit
sources:                     # paths in the SERVICE'S repo this was written from
  - src/main/java/com/shop/payment/
sources_digest: 6f1c0a…      # written by \`loam vouch\` — do not hand-edit
content_digest: 9b2f41…      # written by \`loam vouch\` — do not hand-edit
---
\`\`\`

\`sources\` matters more than it looks. Everything else loam checks is internal
consistency — and a corpus can agree with itself perfectly while describing nothing
that exists. \`sources\` is the one thing tying a document to code: \`loam validate\`,
run inside that service's repository, checks every listed path is still there.

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
which stamps the status, the date and both digests together. Never write those four
fields by hand: a status with no digest behind it is a claim with nothing behind it.

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

0. **Adopt** — a service with no documentation at all starts at
   \`loam adopt --service <id> --json\`, which briefs you on the baseline to write.
   See "Adopting a service" below. Once per service, not once per feature.
1. **Understand** — \`loam list --json\`, \`loam show <service> --json\`.
   Never propose a change to a service you have not read.
2. **Scaffold** — \`loam new FEAT-101 --title "..." --touches <existing> --new-service <new>\`.
3. **Author** the four files the scaffold left as TODO: intent, delta.likec4,
   a spec.md per service, an openapi.yaml per new service.
4. **Check** — \`loam validate FEAT-101 --json\`. Fix every error before writing code.
5. **Build** — \`loam delta FEAT-101 --service <svc> --json\` is the task for one service:
   intent, its requirement delta with scenarios verbatim, and the edges around it.
   Write one test per scenario **first**, from the Given/When/Then lines as written.
   If \`architecture.errors\` is non-empty the payload keeps \`ok: true\` (the command
   ran) but the exit code is 1: the C4 slice is empty because delta.likec4 did not
   parse, not because the feature changes no architecture — do not build on it.
6. **Verify** — \`loam verify FEAT-101 --json\` turns the feature's own promises into a
   checklist; answer each claim with evidence and record it. See "The done-check".
7. **Ship** — \`loam archive FEAT-101\` once the code is merged. \`--dry-run\` shows
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

Two rules the brief repeats and this file will too. An artifact that already
exists is reported as \`action: "diff"\` — read it and report what disagrees;
never replace it, because a document somebody wrote is evidence. And everything
you write is \`status: draft\`: promotion is \`loam vouch\`, run by a person in
the service's own repository.

## The done-check

\`loam verify <FEAT>\` derives a checklist from the feature's own artifacts —
one claim per new service, per operation the delta adds, per tagged edge that
names an operation, and per scenario of every changed requirement. Each claim
has a stable id, so two runs are diffable and an answer cannot drift onto a
different question.

You answer them. \`loam verify <FEAT> --record answers.json\` takes the answers
back and writes \`features/<FEAT>/verification.yaml\`, which travels into the
archive with the feature and reads without loam.

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
\`specs/<svc>/openapi.yaml\`, ADRs, runbooks, health.

Written by loam: the merge into \`services/<svc>/spec.md\`, \`services/<svc>/openapi.yaml\`
and \`architecture/landscape.likec4\` at archive time.

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

Every command takes \`--json\`. The one carve-out: an unknown flag or a missing
argument is refused by the option parser before loam runs, as plain text — so
unparseable output with exit 1 means the INVOCATION was wrong, not the docs.

Branch on \`findings[].code\`, never on the prose — the wording changes, the codes do
not. The code-by-code fix table lives in the \`/loam-check\` command \`loam init\` lays
down; the map of which invocation surfaces what:

- \`loam validate --service <id>\` grades one service's own axes: \`service.unknown\`,
  \`service.no-model\`, \`service.no-spec\`, \`service.no-openapi\`, \`c4.invalid\`,
  \`requirements.missing-scenarios\`, \`api.ungoverned\`, \`api.ops-unlinked\`,
  \`spine.landscape-invalid\`, \`spine.op-undefined\`, \`spine.op-link-missing\`.
- \`loam validate --feature <id>\` grades a change's three axes against each other and
  against the fleet in flight: \`delta.invalid\`, \`delta.nothing-tagged\`,
  \`spec-api.op-undefined\`, \`spec-api.op-pending\`, \`c4-api.op-undefined\`,
  \`c4-api.op-pending\`, \`c4.op-ungoverned\`, \`c4.op-link-missing\`,
  \`api.op-unconsumed\`, \`service.no-requirement-delta\`, \`archedge.uncovered\`, and
  the delta-shape group: \`delta.unknown-section\`, \`delta.no-delta-sections\`,
  \`delta.requirement-not-merged\`, \`delta.modified-unknown\`, \`delta.removed-unknown\`,
  \`delta.added-duplicate\`, \`delta.added-near-duplicate\`, \`delta.modified-pending\`,
  \`delta.removed-pending\`, \`delta.added-conflict\`.
- \`loam validate --all\` runs both of those for everything and adds the fleet
  cross-check: \`landscape.invalid\`, \`landscape.service-unmodelled\`,
  \`landscape.service-undocumented\`, \`landscape.binding-unknown\`, plus one summary
  line — \`sources.unverifiable-from-here\` — counting services whose \`sources\` only
  their own repos can check, and one check on this very file — \`agents.stale\`
  (warn) — when the version stamp on line 1 (\`<!-- generated by loam vX.Y.Z -->\`)
  is missing or older than the running binary: the tables here may describe a
  loam that no longer exists, so review this file against the current \`--help\`
  and update the stamp line. A hand-curated file silences it the same way, by
  keeping the stamp current. The file is never refreshed automatically — your
  edits outrank the template, so detection is all loam does.
- Both modes read frontmatter (\`frontmatter.missing\`, \`frontmatter.field-mismatch\`,
  \`frontmatter.status-unknown\`, \`frontmatter.field-missing\`); a service's spec.md
  additionally carries the sources chain (\`sources.absent\`, \`sources.path-missing\`,
  \`sources.unvouched\`, \`sources.stale\`) and the doc-side freshness check
  (\`content.stale\`) — the one provenance warning that needs no service repo, so
  it is reported from the docs repo too, \`--service\` and \`--all\` alike.
- \`loam archive\` alone reports the breaches only the merge computation can see:
  \`living.requirement-outside-requirements\` (error), \`openapi.op-modified\` (warn),
  \`openapi.component-modified\` (warn) and \`openapi.ref-unresolved\` (error).

\`loam validate <target>\` is the positional spelling of the first two: a feature id
or a service id, tried in that order, so the feature wins when one name could be
both and \`--service\`/\`--feature\` force the reading. The positional together with
\`--all\`, \`--service\` or \`--feature\` is refused (\`invalid-option\`).

\`--strict\` (every targeting mode, \`--all\` included) exits 1 when any finding
exists at all — warnings included. It changes the exit code and nothing else:
\`valid\` still means "no errors", and the \`--json\` payload stays byte-for-byte
what it was. The stricter grade is a per-invocation lever, visible in the CI
pipeline that passes the flag — deliberately not a per-repo profile.

\`loam delta <FEAT> --json\` exits 1 when \`architecture.errors\` is non-empty, with
\`ok: true\` and the full payload intact: the empty C4 slice means the delta did
not parse, not that the feature changes no architecture. Branch on the exit code
before consuming the slice as a task brief.

Findings with severity \`ok\` are confirmations, not work: \`c4.valid\`, \`delta.valid\`,
\`requirements.covered\`, \`api.covered\`, \`spine.resolved\`, \`coherence.ok\`,
\`landscape.matched\`, \`archedge.covered\`, \`sources.resolved\`, \`sources.current\`.

A finding's \`subject\` names the service it is about. The envelope separates \`ok\` (the
command ran) from \`valid\` (the docs pass). A refusal is \`ok: false\` with a stable
\`error.code\`: \`no-config\` / \`config-invalid\` (no loam.json / a corrupt one),
\`unknown-target\` (no such service or feature), \`invalid-option\` (flags that contradict
each other, or a value that cannot be right — a \`loam list\` section that is not
services or features included), \`already-exists\` (\`loam new\` refusing
to scaffold over an existing feature), \`sources-absent\` / \`sources-path-missing\`
(\`loam vouch\` refusing to stamp), \`not-coherent\` / \`living-outside-requirements\` /
\`archive-exists\` / \`merge-failed\` / \`rollback-incomplete\` (\`loam archive\` — see the
archive gate below), \`feature-active\` / \`snapshot-missing\` / \`snapshot-stale\` /
\`restore-failed\` / \`rollback-incomplete\` (\`loam unarchive\` — the last pair splits
exactly as archive's does; see "Taking an archive back"), \`answers-unreadable\` / \`answers-mismatch\` /
\`answers-unevidenced\` (\`loam verify --record\`), and \`internal\` — an unexpected
throw, the one code with no stable meaning.

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

/** Claude Code slash commands: `.claude/commands/<name>.md` -> `/<name>`. */
export const SLASH_COMMANDS: Record<string, string> = {
  "loam-adopt": `---
description: Adopt a service — write its baseline docs from its code, as draft, then validate
argument-hint: <service-id>
---

Write one service's baseline documentation into the loam docs repo (its path is
\`docsDir\` in ./loam.json). You read the code; loam states the work and checks the
result. It never reads the service — so anything you cannot show, do not write.

1. \`loam adopt --service $1 --json\`. That output IS the brief:
   - \`targets[]\` — every file to write. \`action: "diff"\` means the file ALREADY EXISTS:
     read it, diff your findings against it, report what disagrees. Do not replace it.
   - \`targets[].shape\` — the grammar of each artifact, and \`example\` where one is
     shorter than a description. Every rule there is one a later check depends on.
   - \`landscape\` — the elements and edges the fleet already has for this service.
     Bind to them; do not draw a second version of the same box. \`landscape.expects\`
     lists operations other services already call — your openapi.yaml owes them.
   - \`frontmatter\` — what to put in the header of every markdown artifact.
   - \`checks[]\` — what \`loam validate\` will run. \`unchecked[]\` — what it will not.
2. Read \`AGENTS.md\` at the docs repo root, then read the code: entry points, HTTP
   routes and handlers, published events, config, deploy manifests, tests.
   **Keep a list of every path you actually open.** That list becomes \`sources\`, and
   it is the only line tying the document to the repository.
3. Write the artifacts under \`services/$1/\`, in the order the brief lists them.
   Everything \`status: draft\`. Never write \`last_verified\`, \`sources_digest\` or
   \`content_digest\`.
4. \`loam validate --service $1 --json\`. Fix every error. \`sources.unvouched\` is
   expected on a fresh baseline — it closes when a person vouches, not when you do.
5. Hand back, and say three things: what you could not determine from the code, what
   the existing artifacts disagreed with, and which parts you are least sure of.
   Then a human runs \`loam vouch --service $1\` in the service's own repo.

Where the code does not say, write that it does not say. A confident sentence about
behaviour nobody can find is the one failure mode none of loam's checks can catch.
`,

  "loam-feature": `---
description: Start a new loam feature — scaffold it, then author the C4 delta and requirement deltas
argument-hint: <FEAT-id> "<title>"
---

Start a new feature in the loam docs repo (its path is \`docsDir\` in ./loam.json).

1. Read \`AGENTS.md\` at the root of the docs repo first — it defines the ID spine
   everything here depends on.
2. Understand the current state before proposing a change:
   - \`loam list --json\` — what services exist, and what documentation they are missing
   - \`loam show <service> --json\` — what a service owns, exposes, and who already calls it
3. Scaffold it: \`loam new $1 --title "$2"\`, adding \`--touches <id>\` for every service the
   feature touches and \`--new-service <id>\` for every one it introduces.
4. Author what the templates left as TODO:
   - \`intent.md\` — the problem in business terms
   - \`delta.likec4\` — new elements and edges, each tagged \`#$1\`; every call edge carries
     \`metadata { op '<operationId>' }\`
   - \`specs/<svc>/spec.md\` — one behaviour per requirement, SHALL, at least one
     Given/When/Then scenario; uncomment \`Operations:\` once the operation exists
   - \`specs/<svc>/openapi.yaml\` — define every operationId the edges reference
5. \`loam validate --feature $1 --json\`. Do not stop while \`valid\` is false.

The operation's three spellings — the edge's \`op\`, the requirement's \`Operations:\`
line, and the OpenAPI \`operationId\` — must match exactly.
`,

  "loam-implement": `---
description: Implement a loam feature's slice for one service — tests from the scenarios first
argument-hint: <FEAT-id> [service]
---

Implement one service's part of a feature.

1. \`loam delta $1 --service $2 --json\` (drop \`--service\` to use the service configured
   in ./loam.json). That output IS the task:
   - \`intent\` — why this exists
   - \`requirements[]\` — what to build, with \`scenarios[].lines\` verbatim
   - \`architecture\` — whether this service is new, and the calls in and out of it
   Exit 1 with \`ok: true\` means \`architecture.errors\` is non-empty: delta.likec4 did
   not parse, and the empty C4 slice is a parse failure, not "no architecture change".
   Stop and fix the delta (\`loam validate $1 --json\`) before building anything.
2. Write the tests FIRST — one per scenario, straight from the Given/When/Then lines.
   Do not paraphrase a scenario into something easier to pass; it is the acceptance
   criterion someone else reviews against.
3. Implement until they pass.
4. Honour the contract: every operation in \`architecture.inbound\` must exist under
   exactly that operationId, and every one in \`architecture.outbound\` must be called.
5. \`loam validate --feature $1 --json\` before handing back.

If the requirement is ambiguous, say so and stop — do not invent behaviour and
leave the spec disagreeing with the code.
`,

  "loam-check": `---
description: Validate the loam docs repo and fix what it reports
argument-hint: [--all | <FEAT-id> | <service>]
---

Run loam's checks and fix what they find.

- whole fleet: \`loam validate --all --json\`
- one target: \`loam validate <FEAT-id | service-id> --json\` — the feature reading is
  tried first; \`--feature <id>\` / \`--service <id>\` force one when a name could be both
- \`--strict\` (any mode) exits 1 on any warning too. Exit code only: \`valid\` and the
  payload do not change, so the stricter grade lives in the CI invocation, not the repo

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
| \`service.no-spec\` (warn) | no living spec.md — a part-adopted service, legal but unchecked | write it; until it exists, requirement coverage and API governance are vacuous |
| \`service.no-openapi\` (warn) | no openapi.yaml, and the landscape cannot prove nobody calls this service | write the contract, or model the service so the fleet map shows no one expects an API |
| \`api.ungoverned\` (warn) | operation(s) no requirement's \`Operations:\` line names | write the requirement, or link an existing one |
| \`api.ops-unlinked\` (warn) | operations AND requirements exist but zero \`Operations:\` lines join them — the API axis is vacuously green | link each requirement to the operations it governs |
| \`spine.landscape-invalid\` | the living landscape does not parse, so the C4↔API spine cannot be checked | fix architecture/landscape.likec4 first |
| \`spine.op-undefined\` | a landscape edge calls an operation this service's OpenAPI does not define | a broken contract between services — fix the edge or add the endpoint |
| \`spine.op-link-missing\` (warn) | a landscape "Calls" edge into this service with no \`metadata { op }\` | link it to the operationId |

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
| \`c4.op-ungoverned\` (warn) | an operation is called but no requirement governs it | write the requirement |
| \`c4.op-link-missing\` (warn) | a "Calls" edge in the delta with no \`metadata { op }\` | link it to the operationId |
| \`api.op-unconsumed\` (warn) | an added operation no edge consumes | model the caller, or say why it is provider-only |
| \`service.no-requirement-delta\` (warn) | a new service with no spec delta | write \`specs/<svc>/spec.md\` |
| \`archedge.uncovered\` (warn) | no scenario names a tagged edge (a heuristic) | write the scenario, or say why the edge needs none |
| \`delta.unknown-section\` | a heading that nearly matches the delta grammar | fix it — everything under it merges as NOTHING today, silently |
| \`delta.no-delta-sections\` | requirements, but no \`## ADDED/MODIFIED/REMOVED Requirements\` section anywhere — the whole delta would merge nothing | put every changed requirement under its delta section |
| \`delta.requirement-not-merged\` (warn, gates archive) | a requirement under a prose heading (\`## Behavior\`) instead of a delta section | move it under \`## ADDED\`/\`## MODIFIED\`/\`## REMOVED Requirements\` — as written, archive drops it. If it really is documentation, quote it under \`## Requirements\`, which is exempt |
| \`delta.modified-unknown\` | MODIFIED a requirement the living spec does not have | use ADDED, or fix the name (a spelling slip reads as a different requirement) |
| \`delta.removed-unknown\` | REMOVED one that does not exist | drop the section, or fix the name |
| \`delta.added-duplicate\` | ADDED a name the living spec already has | use MODIFIED — as written, the merge REPLACES the living requirement |
| \`delta.added-near-duplicate\` (warn) | ADDED a name that differs only in case from a living requirement — the merge matches exactly, so both would coexist | match the living spelling and use MODIFIED, or pick a distinct name |
| \`delta.modified-pending\` (warn) | the requirement is introduced by another feature in flight | archive that feature first |
| \`delta.removed-pending\` (warn) | REMOVED something another feature in flight introduces | archive that feature first |
| \`delta.added-conflict\` (warn) | two features in flight add the same requirement | whichever archives first lands it; the other's ADDED then collides with the living spec (\`delta.added-duplicate\`, error) and its archive is refused — coordinate now, or rework the later one as MODIFIED after the first ships |

\`--all\` — everything above for every target, plus the fleet cross-check:

| code | what it means | what to do |
|---|---|---|
| \`landscape.invalid\` | the living landscape does not parse | fix it first — the fleet cross-check cannot run against a document nobody can read |
| \`landscape.service-unmodelled\` | a \`services/<svc>/\` no element in the landscape resolves to | draw it, or bind an existing element with \`metadata { service '<svc>' }\` — the fleet map is incomplete until you do |
| \`landscape.service-undocumented\` (warn) | a landscape element with no \`services/<id>/\` | document the service, bind the element to the directory it means, or tag it \`#external\` if it is not ours |
| \`landscape.binding-unknown\` | an element's \`metadata { service }\` names a directory that does not exist | fix the id or create the service — a binding is a claim, and this one is false |
| \`sources.unverifiable-from-here\` | one fleet-level summary line, not per-service findings: N services' \`sources\` can only be checked from their own repos | run \`loam validate --service <id>\` from inside those repos |
| \`agents.stale\` (warn) | the docs repo's AGENTS.md has no version stamp, or one older than the running binary — its flag and code tables may describe a loam that no longer exists | review AGENTS.md against the current \`loam --help\`, then update the \`<!-- generated by loam vX.Y.Z -->\` line; a hand-curated file silences it by bumping the stamp itself. Never regenerate the file — the team's edits outrank the template |

frontmatter and provenance — services' spec.md and features' intent.md, both modes:

| code | what it means | what to do |
|---|---|---|
| \`frontmatter.missing\` (warn) | no frontmatter at all | add owner, status and sources |
| \`frontmatter.field-mismatch\` | the doc names a different service/feature than the one it lives under | fix the frontmatter, or move the file |
| \`frontmatter.status-unknown\` | a status nobody defined (\`verifed\`) | use the documented vocabulary — a typo here reads as unverified forever |
| \`frontmatter.field-missing\` (warn) | owner, status or the identity field is absent | fill them in |
| \`sources.absent\` (warn) | the doc names no sources | nothing ties it to the code, so nothing can tell you when it goes stale |
| \`sources.path-missing\` | a listed source no longer exists | the code moved — re-read it and update the doc, do not just fix the path |
| \`sources.stale\` (warn) | the source files changed since the doc was vouched for | re-read the code, correct the doc, then ask a human to \`loam vouch --service <id>\` |
| \`sources.unvouched\` (warn) | \`sources\` with no \`sources_digest\` — nobody ever stamped it | leave it: vouching is a human's reading, not yours |
| \`content.stale\` (warn) | the spec's body changed since it was vouched — \`status: verified\` is standing over words nobody has read. Unlike \`sources.*\` it needs no service repo, so it fires from the docs repo too | if you edited the doc, that is the point: report it and ask a human to re-vouch. Never revert the doc or touch the digest just to silence it |

\`loam archive\` alone — breaches only the merge computation can see, reported at
plan time (they never appear in \`validate\`):

| code | what it means | what to do |
|---|---|---|
| \`living.requirement-outside-requirements\` | the LIVING spec holds a requirement outside \`## Requirements\`, and the merge rewrites only that section — it would land in the file twice | re-home the requirement under \`## Requirements\`, then re-run; \`--approve\` does not override this |
| \`openapi.op-modified\` (warn) | the feature redefines an operation the living OpenAPI already has — the merge overwrites the living definition wholesale | make sure the redefinition is intended; if not, align the feature's openapi.yaml with the living one |
| \`openapi.component-modified\` (warn) | a component the merged operations reference already exists in the living OpenAPI with different content — the merge copies the feature's version over it wholesale | make sure the redefinition is intended; if not, align the feature's component with the living one |
| \`openapi.ref-unresolved\` | a \`$ref\` reachable from the merged operations resolves in neither the feature's OpenAPI nor the living one — the merge would write a dangling reference | define the missing component or fix the ref; \`--approve\` merges the dangling reference anyway. External refs (not starting \`#/\`) are never checked |

\`sources.stale\` and \`content.stale\` are the warnings you cannot close by yourself.
Fix what the code now says, then hand it back — the stamp is a person's claim to
have read it.
`,

  "loam-verify": `---
description: Verify a built loam feature against its own promises, claim by claim, with evidence
argument-hint: <FEAT-id>
---

Check that the code somebody just built is the feature that was designed.

loam derives the questions; you answer them from the code. It never reads the
service, so a verdict is worth exactly what its evidence is worth.

1. \`loam verify $1 --json\`. \`claims[]\` is the checklist, derived from the feature's
   own artifacts — one claim per new service, per operation its openapi delta adds,
   per tagged edge that names an operation, and per scenario of every changed
   requirement. Each has a stable \`id\` and a \`subject\` (the service whose code
   answers it). An ARCHIVED feature returns its record as frozen history instead
   (\`frozen: true\`) and \`--record\` refuses it — \`loam unarchive\` first if the
   answers really must change.
2. Answer every claim by finding it in the code. Not by reasoning that it must be
   there — by opening the file:
   - \`service.exists\` — the service is deployable: its build, its entry point.
   - \`api.exposes\` — the route handler serving that operationId, not the spec that
     declares it.
   - \`c4.calls\` — the call site in the CALLER.
   - \`scenario.tested\` — the test, and it must assert what the Given/When/Then says.
     A test named after the scenario that asserts something else is not coverage.
3. Write the answers as JSON — evidence is \`file:line\`, one entry per place it can
   be seen:
   \`\`\`json
   { "answers": [
     { "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/split/Api.ts:42"] },
     { "id": "<claim id>", "verdict": "unconfirmed", "note": "no test asserts the 60/40 split" }
   ] }
   \`\`\`
4. \`loam verify $1 --record answers.json --json\`. It refuses an answer set that does
   not answer the current checklist: \`answers-mismatch\` (an id nobody asked about, or
   a claim you left out — re-run step 1, the feature moved), \`answers-unevidenced\`
   (a \`confirmed\` with nothing behind it).
5. Report every \`unconfirmed\` claim and what it would take to close it.

Anything you cannot show is \`unconfirmed\` with a note. That is a successful record,
and it is the useful one: nothing gates on this file, so the only thing it is for is
telling the next reader the truth. \`loam archive\` will ship the feature either way —
which is exactly why a \`confirmed\` you cannot back up costs nothing now and misleads
everyone later.
`,

  "loam-ship": `---
description: Archive a finished loam feature — merge its deltas into the living docs
argument-hint: <FEAT-id>
---

Archive a shipped feature.

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
   - \`rollback-incomplete\` — the merge failed AND some files could not be restored.
     Stop and hand it to a human; the message lists the files to check.

Archived by mistake? \`loam unarchive $1\` restores the living docs from the snapshot
archive left in \`features/archive/$1*/.loam-before/\` and re-opens the feature. Do not
hand-edit the living docs back instead: the previous text of a \`MODIFIED\` requirement
is in that snapshot and nowhere else, so anything you write by hand is a guess.
`,
};

/**
 * Write the slash commands into `.claude/commands/` of `cwd`. Existing files are
 * left alone. Returns the paths created.
 */
export async function scaffoldAgentCommands(cwd: string): Promise<string[]> {
  const dir = join(cwd, ".claude", "commands");
  const created: string[] = [];
  for (const [name, body] of Object.entries(SLASH_COMMANDS)) {
    const path = join(dir, `${name}.md`);
    if (existsSync(path)) continue;
    await mkdir(dir, { recursive: true });
    await writeFile(path, body, "utf8");
    created.push(path);
  }
  return created;
}
