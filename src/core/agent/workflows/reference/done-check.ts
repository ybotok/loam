/**
 * The `loam-done-check` reference page: how `loam verify` derives its claims,
 * who may answer them, and what separates **verified** from **attested**.
 *
 * It is the longest single section the corpus had after the code inventory —
 * three answer channels, the federated recording form, the evidence pins and
 * the six codes the record itself can carry — and every word of it is read at
 * one moment in the cycle, step 7. AGENTS.md's own step 7 names this page.
 *
 * The text is the AGENTS.md section verbatim. See ./reference.ts for why the
 * four pages exist and what was traded for them.
 */
import type { CommandContent } from "../../contract.js";

export const LOAM_DONE_CHECK: CommandContent = {
  name: "loam-done-check",
  description:
    "Reference: the done-check — how `loam verify` derives claims, and verified versus attested",
  // No arguments: one document, printed whole. See ./spine.ts for why the hint
  // is empty rather than a spelled-out "<none>".
  argumentHint: "",
  purpose:
    "What `loam verify` asks, which of the three channels may answer each kind of claim, how a cross-service feature is recorded from each service's own repository, and why an agent's word yields `attested` rather than `verified`.",
  invocation: "loam instructions loam-done-check",
  placeholders: [],
  spine: ["The done-check"],
  body: `The done-check: what \`loam verify\` asks, who may answer it, and what the answer is worth.

## The done-check

\`loam verify <FEAT>\` derives a checklist from the feature's own artifacts —
one claim per new service, per operation the delta adds, per tagged edge that
names an operation, and per scenario of every changed requirement, arch.spec.md
deltas included (those claims name their file, and the test they ask for is an
integration/ops test, not an acceptance test). Each claim has a stable id, so
two runs are diffable and an answer cannot drift onto a different question.

Three answer channels, and they never overlap. The \`scenario.tested\` claims
are the TEST RUNNER's to answer: run the generated suite and pass its report
back — cucumber JSON (\`cucumber-js --format json:report.json\`), or loam's own
runner-neutral shape \`{"loamScenarioReport": 1, "results": [{"digest": "…",
"status": "passed"}]}\` that any runner can be adapted into, chosen by its
marker key. The digest is the contract, never the dialect: both read
\`answered_by: runner\` because both are a real run reporting that digest green,
so a JUnit or pytest fleet is not held at \`attested\` by a file format —
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
\`--record\` is a pure lens on the checklist. A read-only verify checklist needs no
binding and works from the docs repo, or from anywhere else — the refusals above
are about WRITING an attestation, and only about that. Every run lists all
subjects in \`services\`, and a recorded run reports in \`discarded\` every previous
answer the new record does not carry.

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
`,
};
