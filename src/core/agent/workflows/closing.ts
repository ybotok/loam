import type { CommandContent } from "../contract.js";

/**
 * The two post-build workflows, paired: the done-check (`loam-verify`) and the
 * merge it precedes (`loam-ship`). One file for two commands because six
 * workflows meet the five-file package cap somewhere, and this is the seam the
 * cycle already has — both describe what happens after the code is built, and
 * each body names the other's refusals (`record-federated`, `not-coherent`).
 */
export const LOAM_VERIFY: CommandContent = {
  name: "loam-verify",
  description:
    "Verify a built loam feature against its own promises, claim by claim, with evidence",
  argumentHint: "<FEAT-id>",
  purpose:
    "Check that the code somebody built is the feature that was designed. loam derives the questions; a test runner and you answer them. loam never reads the service, so a verdict is worth exactly what its evidence is worth.",
  invocation: "loam instructions loam-verify $1",
  placeholders: ["feature"],
  spine: [
    "`loam verify` — the checklist, derived from the feature's own artifacts",
    "run the generated suite with a JSON report: the scenario claims are the runner's to answer, not yours",
    "answer the remaining claims yourself, every one carrying a `file:line` that resolves",
    "record from each affected service's own repository, bound to that service",
    "read the verdict honestly — a scenario confirmed on your word is `attested`, not `verified`",
  ],
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
   If there is no runnable suite yet you MAY answer them yourself, and the record
   will say so: \`answered_by: agent\` makes the feature **attested**, not verified
   (\`verified: false\`, \`verdict: "attested"\`, the \`verify.scenario-attested\`
   notice, and a \`next.verify-attested\` step in \`loam status\`). Nothing gates on
   it — a legacy service with no suite must still be able to ship — but say so
   when you hand back, and close it with \`--results\` the moment a suite runs.
   \`verify.digest-contested\` (warn) is the case where two services word a
   scenario identically: they share one digest, so no single report can say whose
   suite ran it, and each service must record its own with \`--service\`.
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
   record — it is never overwritten; a human repairs it, and
   \`verify.record-miscounted\` is the reason when its \`summary\` block contradicts
   its own \`claims[]\`: neither half can be believed, so re-record rather than
   editing the counts),
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
   owe an attestation, and \`loam status $1 --json\` says the same thing in the
   shape of a next step.

Anything you cannot show is \`unconfirmed\` with a note. That is a successful record,
and it is the useful one: nothing gates on this file, so the only thing it is for is
telling the next reader the truth. \`loam archive\` will ship the feature either way —
which is exactly why a \`confirmed\` you cannot back up costs nothing now and misleads
everyone later.
`,
};

export const LOAM_SHIP: CommandContent = {
  name: "loam-ship",
  description: "Archive a finished loam feature — merge its deltas into the living docs",
  argumentHint: "<FEAT-id>",
  purpose:
    "Merge a shipped feature into the living specs, API and landscape. This is the one command that rewrites the source of truth, so every step before it exists to make the merge reviewable before it runs.",
  invocation: "loam instructions loam-ship $1",
  placeholders: ["feature"],
  spine: [
    "confirm the code is actually built and merged — archiving early makes the docs claim something that does not exist",
    "`loam validate --feature $1` must come back valid; if it says nothing pinned the delta, rebase and re-validate first",
    "`loam archive $1 --dry-run` — read the whole plan and every warning before the merge touches anything",
    "`loam archive $1` for real, and read what it reports it did",
    "`loam unarchive $1` is the undo if the plan turns out to have been wrong",
  ],
  body: `Archive a shipped feature.

1. Confirm the code is actually built and merged. Archiving folds the delta into the
   living docs; doing it early makes the docs claim something that does not exist.
   \`loam status $1 --json\` answers "is this actually finished" in one call, and its
   \`next[]\` names what is outstanding if it is not.
2. \`loam validate --feature $1 --json\` — must come back \`valid: true\`.
   If it reports \`delta.baseline-missing\` or \`openapi.baseline-missing\`, run
   \`loam rebase $1\` and re-validate BEFORE going on: those two say nothing has
   pinned what this delta was written against, so the merge cannot tell the text
   you EDITED from the text you merely restated. Both gate the archive — the
   dry run in step 3 refuses on them too — and the only way past without the
   pins is a human's \`--approve\`.
3. \`loam archive $1 --dry-run --json\` first. \`plan[]\` is every file the merge would
   write (\`create\` / \`update\`, then the final \`move\` into \`features/archive/\`), and
   none of them are written — read it before letting the merge touch the source of
   truth, and stop if a file you did not expect is on it. \`warnings[]\` is what the
   merge will do that is legal but lossy — advisory warnings never block, which is
   exactly why you read them now: \`openapi.op-modified\` means an operation the living
   contract already defines gets overwritten wholesale (\`openapi.component-modified\`
   is the same story for a component the merged operations carry),
   \`service.no-model\` means a service arrives with no C4 centre behind it, and
   \`delta.added-conflict\`
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
     each with \`gates\` and \`overridable\` resolved (advisory warnings do not block).
     Fix the breaches. \`--approve\` overrides the gating issues and is a human's
     call to make, not yours: report the breach and stop. Two codes it does not
     override even then — \`delta.service-id-invalid\` (a \`specs/<svc>/\` name the
     id grammar refuses) and \`c4.service-binding-invalid\` (a \`metadata { service }\`
     binding it refuses, anywhere inside a tagged element's block): each names a
     path the merge would write mechanically, they arrive with
     \`overridable: false\`, and the fix is a rename, never the flag.
     \`openapi.remove-marker-path-level\` arrives
     here too: an \`x-loam-remove\` written beside the methods instead of inside the
     operation retires nothing.
   - \`living-outside-requirements\` — the LIVING spec holds a requirement outside
     \`## Requirements\`, and the merge would duplicate it. Re-home it, then re-run.
     \`--approve\` does not move this one.
   - \`archive-exists\` — \`features/archive/\` already has that directory; a human
     decides what it is.
   - \`merge-failed\` — the merge could not be computed, or failed and was rolled
     back. Either way the living docs are unchanged; fix the reported cause, re-run.
     A file loam cannot decode as UTF-8 refuses here by name rather than being
     rewritten with replacement characters. So does a living document that still
     holds git conflict markers — the \`spec.merge-conflict\` /
     \`landscape.merge-conflict\` findings ride in \`findings[]\`, and \`--approve\`
     does not override them: the loss is mechanical, not a judgment call.
   - \`docs-busy\` — another \`loam archive\` or \`loam unarchive\` holds the docs
     repo's lock. Nothing was read or written; wait for it and re-run once.
   - \`commit-interrupted\` — a previous archive or unarchive was killed mid-commit
     and this run cannot repair it on its own: a half-written file was edited
     since, its pre-image is gone or altered, or \`.loam-commit\` cannot be read.
     Run \`loam doctor\` (\`doctor.commit-interrupted\` / \`doctor.commit-unreadable\`
     name the same state) and hand it to a human — re-running does not help.
   - \`rollback-incomplete\` — the merge failed AND some files could not be restored.
     Stop and hand it to a human; the message lists the files to check.

Archived by mistake? \`loam unarchive $1\` restores the living docs from the snapshot
archive left in \`features/archive/$1*/.loam-before/\` and re-opens the feature. Do not
hand-edit the living docs back instead: the previous text of a \`MODIFIED\` requirement
is in that snapshot and nowhere else, so anything you write by hand is a guess. It
refuses under \`snapshot-corrupt\` when a pre-image's bytes no longer match the digest
the archive recorded — \`--force\` does not override that one, because the damage is
to the undo itself — and under \`snapshot-missing\` for an archive older than the
current snapshot format. Both mean version control is the way back.
`,
};
