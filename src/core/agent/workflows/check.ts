import type { CommandContent } from "../contract.js";

/**
 * The fix tables: run loam's checks and repair what they find, code by code.
 * The largest body on purpose — it is the other half of the codes-drift
 * documentation corpus (with ../agents-md/), so a new finding code gets its
 * row here.
 */
export const LOAM_CHECK: CommandContent = {
  name: "loam-check",
  description: "Validate the loam docs repo and fix what it reports",
  argumentHint: "[--all | <FEAT-id> | <service>]",
  purpose:
    "Run loam's checks and fix what they find. Branch on `findings[].code`, never on the prose — and remember that a coherence finding marked `gates` stops `loam archive` even when it is only a warning.",
  // No `$1`, unlike the other five. This body carries no placeholder at all —
  // `loam-check`'s argument is a target you pass to `loam validate`, not
  // something the protocol interpolates — and the argument hint's FIRST form
  // is `--all`, so `loam instructions loam-check $1` expanded to
  // `loam instructions loam-check --all`, which commander reads as an unknown
  // option and refuses with exit 1. A pointer file whose one instruction
  // fails leaves an agent with no protocol at all, which is a state the fat
  // body could never reach. The command still tolerates a leading-dash
  // argument (see `allowUnknownOption` in commands/instructions.ts); this is
  // the half of the fix that stops loam printing the broken line in the first
  // place.
  invocation: "loam instructions loam-check",
  // The one protocol whose body names no placeholder: its target (`--all`, a
  // feature id, a service id) is spelled inside the `loam validate` line the
  // agent chooses, not substituted into the page.
  placeholders: [],
  spine: [
    "`loam validate --all` in the docs repo for the fleet, or `loam validate <target>` for one feature or service",
    "fix every error, and every finding that gates the archive",
    "leave an advisory warning standing only if you can say why, and say it",
    "re-run until the grade is the one you meant",
  ],
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
| \`c4.no-relationships\` (warn) | the model parses, declares elements, and no relationship joins anything — while its own evidence says it should reach something: more than one nested element, or dependencies declared in this service's health.yaml. A model that reaches nothing is almost never true; both green states of the first adoption (2 elements / 0 relationships and 19 / 19) printed identical verdicts before this | draw the edges the service actually has — what its containers call, what reads and writes its stores, what it depends on at runtime. A bare root-plus-one-container baseline with no other evidence stays silent on purpose: nothing proves it thin |
| \`requirements.missing-scenarios\` | a requirement with no scenario | add the acceptance criteria; do not delete the requirement |
| \`requirements.stepless-scenario\` | a scenario with a heading and no recognizable steps — it satisfies the coverage rule and tests nothing: cucumber runs it vacuously green and \`loam verify --results\` can never confirm it. Graded on spec.md and arch.spec.md alike, in \`--service\` and \`--feature\` scope both, because a stepless scenario in a delta merges into the living spec and is called covered forever after | write the body as \`- **Given/When/Then**\` bullets |
| \`spec.merge-conflict\` | a requirement document still holds \`<<<<<<<\` / \`=======\` / \`>>>>>>>\` markers — nobody wrote what it now says. Graded on living spec.md/arch.spec.md and on a feature's deltas of them, in both scopes | resolve the conflict in the file the finding names. \`loam archive\` refuses (\`merge-failed\`) on a conflicted living document it would rewrite, and \`--approve\` does not override it: the merge rewrites the requirements section and takes whichever marker lines fall inside it, so a conflict anyone can see would become a document nobody can tell is wrong |
| \`spec.duplicate-requirement\` | one \`### Requirement:\` name defined twice in one living spec.md or arch.spec.md — a merge edits only the first, the rest live on as stale copies | keep exactly one block per name (merge the bodies); the two files are separate namespaces, so a name in both is fine |
| \`spec.requirement-id-invalid\` | a \`Requirement-ID\` violates \`[A-Za-z][A-Za-z0-9._-]{0,127}\` | replace it with a portable stable ID; do not remove an established ID merely to silence the check |
| \`spec.requirement-id-repeated\` | one requirement declares \`Requirement-ID\` more than once | keep exactly one identity line |
| \`spec.requirement-id-duplicate\` | one ID identifies multiple requirements in the same file | give each requirement its own stable ID |
| \`spec.repeated-operations\` (warn) | a second \`Operations:\` line in one requirement body — the last line REPLACES the earlier ones, whose list is silently lost (living specs and feature deltas alike) | merge them into one comma-separated \`Operations:\` line |
| \`spec.repeated-covers\` (warn) | same for \`Covers:\` — the last line wins, the earlier list is silently lost | merge them into one comma-separated \`Covers:\` line |
| \`spec.no-requirements\` (warn) | a LIVING spec.md with no \`### Requirement:\` block at all — every requirement-driven check below it is vacuous, not passing | write the requirements, or say in the file why the service has none yet |
| \`service.unreadable\` | an artifact of this service could not be read (permissions, a dangling symlink) — nothing about the service was checked, and the rest of the fleet still was | fix the file the finding names; a service silently skipped would have read as a clean one |
| \`service.no-spec\` (warn) | no living spec.md — a part-adopted service, legal but unchecked | write it; until it exists, requirement coverage and API governance are vacuous |
| \`service.no-openapi\` (error, or warn) | no openapi.yaml — deleted, renamed, or never written. ERROR when something already written down joins into the absent file: a LIVING non-REMOVED requirement's \`Operations:\` line, or a landscape edge carrying \`metadata { op }\` into this service. The finding's \`details\` list the stranded operationIds. WARN when nothing joins into it but the landscape cannot prove nobody calls this service (it is absent, or it does not parse). Silent when the landscape parses and no edge calls an operation here — a worker, a cron or a UI owes no contract | error: put the file back — every link the \`details\` name resolves to nothing until it is there. If the operations are genuinely gone, retire them through a feature delta (REMOVED requirement + \`x-loam-remove\` marker) instead of deleting the contract out from under them. warn: write the contract, or model the service in the fleet map so it shows no one expects an API |
| \`openapi.invalid\` | openapi.yaml exists but does not parse — an unreadable contract proves nothing, so no \`api.*\` or spine finding is graded against it (before this code, the empty parse graded every inbound edge \`spine.op-undefined\`) | fix the YAML first — the API axis is unchecked until it reads |
| \`openapi.remove-marker-living\` | a living openapi.yaml contains feature-only \`x-loam-remove: true\` | remove the marker from living; retire the operation through a feature delta with a matching REMOVED requirement |
| \`openapi.duplicate-operationid\` (warn) | one operationId occupies two (path, method) slots in a living contract — every join on the id (a requirement's \`Operations:\` line, an edge's \`metadata { op }\`, a removal marker) then picks one of them arbitrarily | give each slot its own id; the identity of an operation is its path and method, and the id is how the other axes name it |
| \`openapi.baseline-stale\` | the living operation changed after this delta edited it | somebody landed a change to it in between. Re-read the living operation, fold in what you still mean, then \`loam rebase <FEAT>\` |
| \`openapi.baseline-missing\` (warn, one per service) | operations in this feature's openapi.yaml carry no \`x-loam-based-on\` | run \`loam rebase <FEAT>\`. Until you do, the merge cannot tell the operations you EDITED from the ones you merely restated, so it upserts all of them — and every restated one reverts whatever landed on it |
| \`openapi.baseline-invalid\` | an \`x-loam-based-on\` that is not a digest, or one on an operation the living contract has no slot for | \`loam rebase\` writes the value; a new operation has no living version to be based on, so drop the marker there |
| \`spec-api.op-undefined\` | a LIVING requirement's \`Operations:\` line names an operationId this service's openapi.yaml does not define (the same code fires inside a feature delta) | define the endpoint, or correct the \`Operations:\` line — the two axes disagree about what the service exposes |
| \`api.ungoverned\` (warn) | operation(s) no requirement's \`Operations:\` line names | write the requirement, or link an existing one |
| \`api.ops-unlinked\` (warn) | operations AND requirements exist but zero \`Operations:\` lines join them — the API axis is vacuously green | link each requirement to the operations it governs |
| \`api.requirement-deprecated\` (warn) | a requirement's \`Operations:\` list resolves only to operations the OpenAPI marks \`deprecated: true\` — the behaviour it governs is on its way out | migrate the requirement to the replacement operation, or retire it with the ops it governs |
| \`spine.landscape-invalid\` | the living landscape does not parse, so the C4↔API spine cannot be checked | fix architecture/landscape.likec4 first |
| \`spine.op-undefined\` | a landscape edge calls an operation this service's OpenAPI does not define | a broken contract between services — fix the edge or add the endpoint |
| \`spine.op-link-missing\` (warn) | a landscape "Calls" edge into this service with no \`metadata { op }\` | link it to the operationId |
| \`spine.op-deprecated\` (warn) | a landscape edge calls an operation this service's OpenAPI marks \`deprecated: true\` — the consumer is standing on a contract being retired | migrate the consumer to the replacement operation; deprecation is the first step of retiring an op, and the op stays defined until a human removes it |
| \`service.no-asyncapi\` | no asyncapi.yaml, and message link(s) already point into it — a landscape edge's \`metadata { publishes }\` / \`metadata { consumes }\`, or a LIVING requirement's \`Publishes:\` / \`Consumes:\` line. The \`details\` list the stranded message names. Silent when nothing joins into it: an async contract is optional, and most services touch no topic | put the file back — every link the \`details\` name resolves to nothing until it is there |
| \`asyncapi.invalid\` | asyncapi.yaml exists but does not parse — an unreadable contract proves nothing, so no \`event.*\` or message-spine finding is graded against it | fix the YAML first — the event axis is unchecked until it reads |
| \`asyncapi.duplicate-message\` (warn) | one message name is declared in two slots — every join on the name (an edge's \`metadata { publishes }\`, a requirement's \`Publishes:\` line) then picks one of them arbitrarily | give each declaration its own name, or factor the second into a \`$ref\` at the first |
| \`spine.message-undefined\` | a landscape edge \`publishes\`/\`consumes\` a message this service's asyncapi.yaml declares no \`action: send\`/\`receive\` operation for | declare the operation, or correct the edge — the fleet map and the contract disagree about what this service puts on the wire |
| \`spec-event.message-undefined\` | a LIVING requirement's \`Publishes:\` / \`Consumes:\` line names a message this service's asyncapi.yaml does not declare in that direction | declare it, or correct the line |
| \`spine.message-unproduced\` | this service consumes a message NO service in the fleet declares an \`action: send\` for. The inverse of \`spine.op-undefined\`, and it has no HTTP analog: on the API axis the provider owns the contract and the check is local, while an event's schema lives in the producer's repo | find the producer and have it declare the message, or correct the name — a consumer joined to nothing reads a payload nothing defines |
| \`asyncapi.message-contested\` (warn) | two or more services declare they send one message name — every consumer's join picks one of them arbitrarily | namespace the message by its owning domain; one message has one producer, and which contract a consumer reads must not be a coin flip |
| \`event.messages-unlinked\` (warn) | messages AND requirements exist but zero \`Publishes:\`/\`Consumes:\` lines join them — the event axis is vacuously green | link each requirement to the messages it governs |
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
| \`delta.service-unknown\` | a \`specs/<svc>/\` directory addresses a service that neither exists as \`services/<svc>/\` nor is introduced by this feature's own tagged delta.likec4 — a typo in \`--touches\`, which archive would otherwise materialise as a phantom service directory | fix the id (the message offers close ones); suspended while \`delta.invalid\` stands, because an unparseable delta cannot be asked what it introduces |
| \`delta.service-id-invalid\` | a \`specs/<svc>/\` DIRECTORY NAME that is not a legal service id (a space, a \`..\`, a Windows-reserved stem like \`NUL\`, a trailing dot) — archive would materialise \`services/<svc>/\` from it, a directory every authoring command then refuses to address (\`service.id-invalid\`). Never suspended: the name is illegal whatever the delta says | rename the specs/ directory to a legal id; \`--approve\` does not override this one — the breakage is mechanical, not a judgment call |
| \`spec.merge-conflict\` | a spec delta (\`specs/<svc>/spec.md\` or \`arch.spec.md\`) still holds \`<<<<<<<\` / \`=======\` / \`>>>>>>>\` markers — the same code and the same sentence as service scope, because the markers merge into the living document as prose under somebody's requirement | resolve the conflict before archive; the merge rewrites the requirements section and the marker lines inside it disappear with it |
| \`requirements.stepless-scenario\` | a scenario in a spec delta with a heading and no steps — same code as service scope, and it merges into the living spec as a requirement the coverage rule calls covered from then on | write the body as \`- **Given/When/Then**\` bullets |
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
| \`c4.service-binding-invalid\` | an explicit \`metadata { service }\` binding — a tagged element's, or an untagged child's anywhere inside its block, since the merge splices the whole authored block verbatim — is not a legal \`services/<id>/\` name (a space, a \`../\`, a Windows-reserved stem); archive would write the name into the living landscape, and a \`../\` collapses its \`services/\` probe out of the docs repo | fix the binding to the directory the element means; \`--approve\` does not override this one — the path the name becomes is mechanical, not a judgment call |
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
| \`service.id-invalid\` | a \`services/<id>/\` directory whose name is not a legal service id — every authoring command refuses it, so nothing in that directory can be changed through loam. Fleet scope only: the SET of service directories is what makes the id a question, and a \`--service\` run is already refused by its own guard before it gets this far (the guard refuses only a name that neither exists as a directory nor is a legal id — a badly-named directory that DOES exist resolves through the enumeration and grades as an ordinary target, still without this finding). Graded before the map is opened, so it stands even when the landscape is missing or unreadable | rename the directory, then update its \`service:\` frontmatter, its \`metadata { service }\` binding in the landscape, and any \`features/<FEAT>/specs/<id>/\` naming it |
| \`landscape.merge-conflict\` | the fleet map still holds conflict markers — it is two halves of two different maps, and every cross-service check reads it. Checked BEFORE the parse and returns like \`landscape.invalid\`: nothing is concluded from the file, so no \`landscape.service-unmodelled\` fires behind it | resolve it keeping BOTH sides' elements and edges; ten people adopting ten services into one landscape.likec4 in the same week is how it happens. \`loam archive\` refuses on it too (\`merge-failed\`, not overridable with \`--approve\`) |
| \`landscape.service-unmodelled\` | a \`services/<svc>/\` no element in the landscape resolves to | draw it, or bind an existing element with \`metadata { service '<svc>' }\` — the fleet map is incomplete until you do |
| \`landscape.service-undocumented\` (warn) | a landscape element with no \`services/<id>/\` | document the service, bind the element to the directory it means, or tag it \`#external\` if it is not ours |
| \`landscape.binding-unknown\` | an element's \`metadata { service }\` names a directory that does not exist | fix the id or create the service — a binding is a claim, and this one is false |
| \`landscape.binding-duplicate\` (warn) | two elements resolve to the same \`services/<id>/\` | every element→service join picks one of them arbitrarily, so the other's edges are filed under a service that does not own them — bind each element to the directory it actually is, or tag the stray one \`#external\` |
| \`landscape.platform-candidate\` (warn) | an \`#external\` element consumed by three or more services and not tagged \`#platform\` — a hub on its way to making the fleet view unreadable | declare \`tag platform\` in the \`specification\` block and tag the element (LikeC4 refuses an undeclared tag, so both steps are needed): the fleet view then excludes it, and a platform view over \`include * -> element.tag = #platform\` keeps "who depends on it" answerable |
| \`landscape.datastore-private\` (warn) | a datastore element with exactly one consumer service at fleet level — drawn as a peer, it reads as a system in its own right | it is that service's internals: move it into \`services/<id>/model.likec4\` as a nested container and delete it from the landscape, or add the second consumer's edge if another service really reaches the same data |
| \`landscape.datastore-shared\` (warn) | a datastore element consumed by two or more services — the strongest coupling in the fleet, stated rather than inferred | shared means the same DATA: if they read the same tables or keys, keep it drawn and let the warning state the coupling; if they only share a host or cluster (two schemas, two lock paths), model one private store per service and put the blast radius in the runbook |
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
| \`sources.unwalked\` (warn) | \`sources\` leaves whole top-level paths of the service repo untouched — the \`details\` name them, measured against the files git tracks. The one completeness signal loam can compute: every other check compares the documents with each other, and a corpus agrees with itself perfectly while describing a third of a service. Silent where git cannot answer (not a repository, not installed) | open them. Each one is either a part of the service nobody read — go back to the walk \`loam adopt\` printed — or something this document legitimately does not owe, and then say which and why in the hand-back. Do NOT add paths to \`sources\` that you did not read: the list is a record of what was opened, and padding it destroys the only tie the document has to the code |
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
| \`openapi.remove-marker-path-level\` | an \`x-loam-remove: true\` written at PATH level, beside the methods instead of inside the operation being retired — it names no operation, so it retires nothing, and it is not a contract key either | move the marker inside the operation (with its \`operationId\`), or delete it. The merge is safe either way — a feature-only key is never published into the living contract — but the removal you asked for will not happen |

\`sources.stale\` and \`content.stale\` are the warnings you cannot close by yourself.
Fix what the code now says, then hand it back — the stamp is a person's claim to
have read it.
`,
};
