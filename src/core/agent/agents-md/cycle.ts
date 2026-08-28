/**
 * What an agent DOES: the cycle step by step, adopting a service, the
 * done-check, what is authored versus derived, and the rules the validator
 * enforces.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const CYCLE = `## The cycle

0. **Wire the repo** — \`loam init --docs <path-to-docs-repo> --service <id>\` in
   each service repo, then \`loam doctor\`. Once per repository, before anything
   else; see "\`loam.json\` — the wiring" above. Every step below runs in a repo
   that has been through this one.
1. **Adopt** — a service with no documentation at all starts at
   \`loam adopt --service <id> --json\`, which briefs you on the baseline to write.
   See "Adopting a service" below. Once per service, not once per feature.
2. **Understand** — \`loam status --json\` first if you joined halfway or lost the
   session: it says what is in flight and what the next step is, for the fleet or
   for one feature (\`loam status FEAT-101 --json\`). Then \`loam list --json\` and
   \`loam show <service> --json\`.
   Then \`loam explore <service> --json\` around the services you believe are
   involved — it writes nothing and answers the one question the next step takes
   as an argument: which services this change actually touches. It reports the
   ring one hop out in the fleet map (\`neighbours\`), how far each service's
   documentation has got (\`maturity\`), what each already exposes, the features
   already in flight over the same ground (\`overlaps\`), and the \`loam new\` line
   the seeds imply (\`scaffold\`). \`--op <operationId>\` seeds from an operation
   when you know the call but not who owns it.
   Never propose a change to a service you have not read.
3. **Scaffold** — \`loam new FEAT-101 --title "..." --touches <existing> --new-service <new>\`.
   The scaffold leaves a \`delta.likec4\` whose context elements are commented out —
   a requirements-only feature should DELETE that file rather than ship an empty
   one — and gives every \`--new-service\` a \`specs/<svc>/arch.spec.md\` alongside.
   \`--capability <id>\` (repeatable, and it composes with \`--touches\`) scaffolds a
   capability delta instead of a service one — the inversion of this step, for a
   change whose BUSINESS side is what is known: open the promise that changes and
   derive the service work from it. An id the fleet has never named is scaffolded
   rather than refused, with the close spellings printed beside it; the archive
   is what creates the living \`capabilities/<id>/spec.md\`.
4. **Author** the four files the scaffold left as TODO: intent, delta.likec4,
   a spec.md per service, an openapi.yaml per new service. Finish with
   \`loam rebase FEAT-101\`: it pins every MODIFIED/REMOVED requirement and every
   operation in the contract delta to the living version you wrote it against.
   On the contract axis run it even when you changed nothing but one endpoint —
   that is exactly what marks the REST of the document as quotation the merge
   must not write. See "The requirement baseline".
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
landscape edit that did not land shows up. Done, stated once: \`--service\`
clean when run from inside the service's own repo, and \`--all\` reporting no
\`landscape.*\` finding. The fleet run is never SILENT — \`sources.unverifiable-from-here\`
(severity ok) appears per service as a confirmation, not work — so "keep going
until validation is quiet" is the wrong loop; the two runs above are the test.

Two rules the brief repeats and this file will too. An artifact that already
exists is reported as \`action: "diff"\` — read it and report what disagrees;
never replace it, because a document somebody wrote is evidence. And everything
you write is \`status: draft\`: promotion is \`loam vouch\`, run by a person in the
service's own repo — \`loam vouch --pack --service <id>\` (read-only) preps that read.

## The done-check

\`loam verify <FEAT>\` derives a checklist from the feature's own artifacts —
one claim per new service, per operation the delta adds, per tagged edge that
names an operation, and per scenario of every changed requirement, arch.spec.md
deltas included (those claims name their file, and the test they ask for is an
integration/ops test, not an acceptance test). Each claim has a stable id, so
two runs are diffable and an answer cannot drift onto a different question.

Three answer channels, and they never overlap. The \`scenario.tested\` claims
are the TEST RUNNER's to answer: run the generated suite with a cucumber JSON
report (\`cucumber-js --format json:report.json\`) and pass it back —
\`loam verify <FEAT> --results report.json\`. A claim is confirmed only when a
report scenario carrying its \`@loam-digest-<16hex>\` tag ran at least one step
and every step passed — every occurrence, when the report holds a re-run, and
every before/after hook with it. A failed, undefined, pending or skipped step,
a failed hook, or no matching scenario at all, is \`unconfirmed\` with the
reason. The digest is the only identity: a reworded spec scenario matches
nothing until the suite is regenerated and re-run. When a report exists,
ALWAYS pass \`--results\` — under it the runner owns every scenario claim, and
an answers-file entry for one is refused.

The \`api.exposes\` claims have a mechanical channel of their own: an API
contract-test run, passed back with
\`loam verify <FEAT> --contract-results contract.json\`. loam accepts one
shape — its own documented contract-results JSON,
\`{"loamContractReport": 1, "results": [{"operationId": "createSplit",
"status": "passed"}]}\` — emitted from your contract tool's report in one
transform (Specmatic's own coverage JSON is refused by design: its "covered"
status means exercised, not passed, so reading it would confirm what a red run
refuted). An entry whose status is exactly \`passed\` confirms the claim whose
operationId it names — the record says \`answered_by: external-runner\` and the
views mark the line \`[contract]\` — while a failed or unknown status and an
operation the report never exercised leave the claim \`unconfirmed\` with the
reason; entries naming operations outside the checklist are ignored.
\`verify.operation-contested\` (warn) is \`verify.digest-contested\`'s twin on
this axis: an operationId is unique per contract document, not per fleet, so
when two services on the checklist expose the same one, a report entry — which
names no service — cannot say whose suite exercised it, those claims stay
unconfirmed, and each service records its own with \`--service\`. Under the
flag the contract report OWNS every api.exposes claim in scope, so an
answers-file entry for one is refused (\`answers-mismatch\`), and the record
pins the file consumed in \`contractReport\` (path, sha256 of the bytes, mtime,
operation count) exactly as \`report\` pins the cucumber one. The verdict
ladder does not move: external evidence never answers a \`scenario.tested\`
claim, so \`attested\` versus \`verified\` still turns on scenario claims
alone.

\`--record\` without \`--results\` is the fallback for a service with no runnable
suite yet: there your word answers the scenario claims too. It still works, and
it costs something you must know about. The record says who answered
(\`answered_by: agent\`), and that answer changes the VERDICT: a feature whose
scenario claims rest on an agent's word is **attested**, not verified.
\`verify --json\` reports \`verdict: "attested"\` with \`verified: false\` and an
\`attested\` count, \`loam status\` marks it and adds a \`next.verify-attested\` step,
and the notice rides in \`notices[]\` under \`verify.scenario-attested\` (warn —
nothing gates on it, because a legacy service with no suite must still be able
to ship). Answer them mechanically the moment a suite runs:
\`loam verify <FEAT> --results <report.json>\`.

A record that leaves any claim unconfirmed or unanswered carries
\`verify.claims-open\` (warn) in \`notices[]\` — the one-line "not a clean
result" summary with all four counts, on the read view and the frozen
post-archive view alike; it gates nothing, and a feature with no record at all
never carries it, because not-started is not partial.

Federated \`--record\` also stamps \`evidence_pins\` on each agent-confirmed
citation — the cited file's sha256 at the attested commit, the cited line's
text, and the literal token the claim asserts (operationId, message name, edge
op). One notice rides beside the stamp: \`verify.evidence-token-missing\` (warn,
verdict-neutral, gates nothing) says a cited file at the attested commit does
not contain the claim's token — read that evidence first, while the answer can
still be corrected. \`loam validate\`, run later in the service's repo,
re-checks the pins and reports drift under the \`evidence.*\` findings; nothing
there moves a verdict either.

Two more codes belong to the record itself. \`verify.record-miscounted\` (error):
a \`verification.yaml\` whose \`summary\` block contradicts its own \`claims[]\` — the
record is refused as unreadable rather than believed in either half, and
re-recording is the repair, never editing the counts. \`verify.digest-contested\`
(warn): two or more services word a scenario identically, so they share one
\`@loam-digest-…\` tag and no single cucumber report can say whose suite ran it —
those scenario claims are left unconfirmed, and each service records its own
from its own repository with \`--service\`.

A federated record also says WHAT EACH SERVICE ANSWERED AGAINST. Every
attestation carries the \`checklist\` digest it answered and, when the docs repo
is a git checkout, the \`docsCommit\` that checklist was derived from — so the
record pins both sides, the service repo through \`commit\` and the question set
through these two. \`verify.checklist-forked\` (warn) is what that buys: it names the
services whose attestation answers a DIFFERENT checklist than the feature now
asks, which the record-level \`checklist\` field alone could never show — it
flagged every service or none, and never said which answers went stale. It is
measured against the present rather than pairwise between attestations, because
services that all answered a since-rewritten delta agree with each other and are
every one of them stale. Differing \`docsCommit\` values are NOT a finding:
recording a week apart is normal for a feature in flight.
Normal mid-rollout and it gates nothing; re-record the services on the older
version from their own repositories, or accept the split knowingly.
Attestations written before the field existed carry no \`checklist\` and are not
counted as a third version — silence is not disagreement.

A consumed report is written down: \`report\` and \`contractReport\` on the
record (or on that repository's attestation) each carry the path, a sha256 of
the bytes, the file's mtime and how much it held — tagged scenarios for the
one, distinct operationIds for the other. That identifies WHICH file answered
the claims, and — when the file is committed — that it matches the attested
commit. It does not prove the file came from executing that commit; no digest
can.

Everything else you answer from the code, and \`--record answers.json\` takes
those back, writing \`features/<FEAT>/verification.yaml\` — it travels into the
archive with the feature and reads without loam. Alongside the mechanical
flags, the answers file must answer exactly the claims no report owns: an
entry for a report-owned claim is refused (\`answers-mismatch\`), and a
mechanical flag alone is refused while claims outside its kind are
outstanding. Every recorded verdict says who answered it
(\`answered_by: runner | external-runner | agent\`), so a reviewer can tell a
green run from somebody's word.

**A cross-service feature is verified once per service, and the form matters.**
The claims of one feature belong to several services, and each service's code
lives in its own repository — so the recording form is federated:

\`\`\`sh
# in EACH affected service's own repo, not in the docs repo:
loam verify FEAT-101 --service payment-service --results report.json --record answers.json
# with an API contract suite, its report answers the api.exposes claims too:
loam verify FEAT-101 --service payment-service --results report.json --contract-results contract.json --record answers.json
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

`;
