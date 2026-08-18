/**
 * Reading loam's output, command by command: the code-by-code map of
 * `status`, `validate`, `doctor`, `rebase`, `dependencies`, `explore` and
 * `instructions`. This is the section that grows when a finding code is
 * added — test/codes-drift.test.ts checks every emitted code is documented
 * here or in a workflow body.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const COMMAND_MAP = `## Reading loam's output

Every command takes \`--json\`, and the envelope holds even when the INVOCATION
is wrong: with \`--json\` anywhere in the arguments, an unknown flag, unknown
command or missing argument still yields \`{ ok: false, error: { code:
"invalid-option" } }\` on stdout with exit 1 (commander's own diagnostic goes
to stderr; \`--help\` and \`--version\` output pass through untouched). Without
\`--json\` the same refusal is plain text on stderr with nothing on stdout.

Branch on \`findings[].code\`, never on the prose — the wording changes, the codes do
not. The code-by-code fix table lives in the \`/loam-check\` command \`loam init\` lays
down. \`init\` writes that body twice for every tool it configures: once as a slash
command in the tool's own command directory (you type it), and once as an Agent
Skill at \`<tool-dir>/skills/loam-check/SKILL.md\` (the model loads it by itself when
the task matches the skill's description). Same body, two ways in.

Which tools get them is detected from the repo: \`loam init\` scans for the
dot-directories of the tools it knows (\`.claude\`, \`.cursor\`, \`.gemini\`, …) and
writes for the ones it finds, falling back to Claude Code when it finds none.
\`loam init --tools <ids|all>\` overrides the scan — an unknown id is refused
(\`invalid-option\`) rather than skipped — and \`--no-commands\` / \`--no-skills\`
each suppress one delivery. The tools written for are recorded in
\`loam.json\` as \`agentTools\`, which is how \`loam doctor\` tells a file missing
because the binary grew a new command from one missing because nobody ever
selected that tool. The map of which invocation surfaces what:

- \`loam status [<FEAT>]\` is the orientation surface — the question you have when
  you join a repository halfway, or come back having lost the session, and the one
  every other command assumed you could already answer. It writes nothing and
  stores nothing: there is no state file, every answer is re-derived from the
  files, so a document someone edited in another window is visible on the next run
  with nothing to invalidate. Artifacts come back as \`missing\` (owed, nothing in
  the way — write it now), \`blocked\` (not written and not writable yet; the entry
  names what comes first), \`draft\` (on disk, and the shared checks report an error
  against it — what exists is wrong), \`ready\` (on disk and clean, but something
  outside the documents — code, a test run, a recording — still has to answer it)
  or \`done\`. The payload's reason to exist is \`next[]\`: ordered, first entry
  first, each carrying a code and the literal command to run. \`next.recover-commit\`
  outranks every other step in both forms and is never elided: a \`.loam-commit\`
  journal says a writer was killed mid-commit, so some of the files everything
  below is derived from may be half-written. Its command is the re-run the
  journal itself names — archive/unarchive repair from the pre-image, every
  other writer rolls its staged bytes forward — under the lock either way;
  except when the journal cannot be read, where it is \`loam doctor\` and the
  repair is a human's comparison against version control. Fleet-wide the rest are
  \`next.adopt-bound\` (this repository's own loam.json names a service the docs repo
  has no directory for at all — it outranks every other service's partial adoption,
  because it is the only step that is about the repo you are standing in, and it is
  the same state \`loam doctor\` reports as \`doctor.service-unknown\`),
  \`next.adopt\` (a service with no spec.md — nothing about it is written down, so
  no feature can be graded against it), \`next.complete-service\` (a living spec.md
  with no model.likec4 beside it), \`next.feature\` (something is in flight;
  ask \`loam status <FEAT>\` about it), \`next.archive\` (authored and verified —
  ship it, and everything waiting on it is released), \`next.fleet-clean\`
  (nothing is owed), \`next.elided\` (the fleet list hit its cap and says how many
  steps of the same kinds it left out — it is ordered most-unblocking first, so
  work down it and re-run) and \`next.fleet-gate\` (always last while anything is
  outstanding: \`loam validate --all\` is what CI runs, and the fleet form grades
  nothing itself). On one feature: \`next.author-intent\`, \`next.touch-service\`
  (no per-service delta at all yet), \`next.author-spec\`, \`next.author-openapi\`,
  \`next.author-scenarios\`, \`next.rebase\` (requirements or operations with no
  baseline pin — until they have one the merge cannot tell what it EDITS from what
  it merely quotes), \`next.archive-first\` (another feature in flight has to land
  before this one), \`next.fix-coherence\` (the three axes disagree and archive
  refuses), \`next.generate-tests\` (a per-service delta carries scenarios no test
  run has answered — \`loam gherkin <FEAT> --service <svc>\` in that service's own
  repository), \`next.verify\` (the done-check has not been started — or its record
  will not read, or it answers a checklist the feature has since moved out from
  under, which is not the same as a finished one), \`next.verify-unconfirmed\`
  (started, and claims are still open — close them from each affected service's
  own repository), \`next.attest-service\` (this repo IS one of the services that
  owes an answer, so the step is bound to this commit), \`next.verify-attested\`
  (every claim is confirmed but a scenario rests on an agent's word rather than a
  green run — see "The done-check"), \`next.archive\`, and \`next.archived\` for one
  that shipped.
  It grades nothing of its own: the verdict is the one \`loam validate --feature\`
  and \`loam archive\` compute — status takes the UNION of what both of them refuse,
  so it may be more pessimistic than either and can never be greener than both.
  \`verification\` carries \`verdict\` (\`verified\` | \`attested\` | \`unverified\`)
  and \`attested\` (how many scenario claims rest on an agent's word) beside the
  recounted totals, and \`checks.issues[]\` carries \`gates\` and \`details\` on every
  finding.
- \`loam validate --service <id>\` grades one service's own axes: \`service.unknown\`,
  \`service.no-model\`, \`service.no-spec\`, \`service.no-openapi\`, \`c4.invalid\`,
  \`c4.no-relationships\` (warn — the model declares elements and no edge joins
  anything, while more than one nested element or this service's own
  health.yaml dependencies say it should reach something; a model that reaches
  nothing is almost never true),
  \`requirements.missing-scenarios\`, \`requirements.stepless-scenario\`,
  \`spec.merge-conflict\`, \`spec.duplicate-requirement\`,
  \`spec.no-requirements\`, \`spec.repeated-operations\`, \`spec.repeated-covers\`,
  \`openapi.invalid\`, \`openapi.duplicate-operationid\` (one operationId in two
  (path, method) slots — every join on the id then picks one of them arbitrarily),
  \`openapi.response-undescribed\` (warn — operations whose responses declare no
  schema at all; a presence probe, what a schema says is never checked),
  \`openapi.ref-unresolved\` (warn here, error at archive plan time — an internal
  \`$ref\` resolving to nothing in the document),
  \`api.ungoverned\`, \`api.ops-unlinked\`,
  \`api.requirement-deprecated\`, \`spec-api.op-undefined\` (the living spec's own
  \`Operations:\` lines, not only a delta's), \`spine.landscape-invalid\`, \`spine.op-undefined\`,
  \`spine.op-link-missing\`, \`spine.op-deprecated\`,
  the async contract axis (AsyncAPI 3): \`service.no-asyncapi\`, \`asyncapi.invalid\`,
  \`asyncapi.duplicate-message\`, \`asyncapi.payload-undescribed\` (warn — a
  message whose payload declares no shape at all; non-JSON \`schemaFormat\`
  payloads are never judged), \`asyncapi.ref-unresolved\` (warn — internal
  \`$ref\`s resolving to nothing), \`spine.message-undefined\`,
  \`spec-event.message-undefined\`, \`spine.message-unproduced\`,
  \`spine.message-external\` (warn — the only declared producer is an
  \`#external\` element, so the consumer's own asyncapi.yaml is the contract;
  fires while it defines no shape for the message, silent once it does),
  \`asyncapi.message-contested\`, \`event.messages-unlinked\`, \`event.covered\`, and
  the architecture spec axis: \`covers.unknown\`, \`health.invalid\`, \`health.uncovered\`,
  \`health.dependency-unmodelled\` (warn — a health.yaml \`dependencies:\` id that
  nothing in this service's own model.likec4 answers to by element id, binding
  or title; the model, not the landscape, is what the on-call file must agree
  with). Run inside
  the service's own repo, once a generated suite exists under
  \`<gherkinDir>/loam/\`, it also grades that suite against the living specs:
  \`gherkin.missing\`, \`gherkin.stale\`, \`gherkin.orphaned\` (all warn — the fix is
  always regeneration, never editing a generated file). A service that never ran
  \`loam gherkin\` stays quiet, and a file tagged with a feature still in flight
  answers to that feature, not to the living spec it has not merged into yet.
- \`loam validate --feature <id>\` grades a change's three axes against each other and
  against the fleet in flight: \`delta.invalid\`, \`delta.nothing-tagged\`,
  \`delta.service-unknown\`, \`delta.service-id-invalid\` (a \`specs/<svc>/\`
  directory whose NAME is not a legal service id — archive refuses it too, and
  \`--approve\` does not override: the merge would materialise a
  \`services/<svc>/\` no authoring command can address),
  \`spec-api.op-undefined\`, \`spec-api.op-pending\`, \`c4-api.op-undefined\`,
  \`c4-api.op-pending\`, \`c4-api.op-deprecated\`, \`c4.op-ungoverned\`, \`c4.op-link-missing\`,
  \`c4.service-binding-invalid\` (an explicit \`metadata { service }\` binding
  that is not a legal service id — a tagged element's, or one nested anywhere
  inside its block, since the merge splices the whole authored block into the
  living landscape verbatim; archive refuses it too, and \`--approve\` does not
  override),
  \`api.op-unconsumed\`, \`service.no-requirement-delta\`, \`archedge.uncovered\`,
  \`spec.repeated-operations\` / \`spec.repeated-covers\` (on the feature's own
  spec deltas — same silent-line-loss check as service scope),
  \`spec.merge-conflict\` / \`requirements.stepless-scenario\` (same codes as
  service scope, graded on the feature's spec.md and arch.spec.md deltas —
  both breaches merge into the living document),
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
  cross-check: \`landscape.missing\`, \`landscape.invalid\`,
  \`landscape.merge-conflict\`, \`landscape.service-unmodelled\`,
  \`landscape.service-undocumented\`, \`landscape.binding-unknown\`,
  \`landscape.binding-duplicate\`, the fleet-shape advisories
  \`landscape.platform-candidate\`, \`landscape.datastore-private\` and
  \`landscape.datastore-shared\` (all warn — the map's legibility and coupling
  shapes: tag ubiquitous infrastructure \`#platform\` so the fleet view can
  exclude it, keep a single-consumer datastore inside its service's own model,
  and let a truly shared one state which data it shares), \`service.id-invalid\` (a \`services/<id>/\`
  directory every authoring command refuses to address — read commands like
  \`validate --service\`, \`show\` and \`status\` resolve it against the
  enumeration and still grade it, so it can be inspected but not changed
  through loam — fleet scope only, and graded before the map is opened, so it
  stands even when the landscape is missing or unreadable), plus a per-service
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
  read). It also grades what a WRITE that did not finish left in the docs repo,
  reported as \`writePath\` beside the findings: \`doctor.docs-locked\` (a held
  \`.loam-lock\` — a warning while its holder is alive, since the answer is to wait
  and re-run, and a BLOCKER in the two shapes nothing will ever release: a holder
  that is a process no longer existing on this host, or a lock file that cannot
  name a holder at all — empty or unparseable, a crash between its create and
  flush; either way every command that writes through the locked root
  refuses \`docs-busy\` until it is deleted), \`doctor.commit-interrupted\` (blocker:
  a \`.loam-commit\` naming a writer that was killed mid-commit, so the files it
  was committing may be half-written — re-run the command the finding prints and
  it recovers first, under the lock; when this repo is a service repo the same
  scan covers \`<gherkinDir>/loam/\`, the root \`loam gherkin\` commits into), \`doctor.commit-unreadable\` (blocker, and the worst case:
  the record of which files that commit had already written cannot be parsed, so
  nothing can grade it — compare against version control by hand) and
  \`doctor.staging-temps\` (warn: orphaned \`.loam-*.tmp\` scratch that was never
  linked into place — litter, not damage). Accessibility, portability and
  incomplete binding stay warnings:
  \`doctor.docs-unreadable\`, \`doctor.docs-readonly\`, \`doctor.docs-absolute\`
  (\`docsDir\` stored as an absolute path in a committed loam.json — it resolves
  only on the machine that ran \`loam init\`), \`doctor.inventory-unreadable\`,
  \`doctor.landscape-missing\`, \`doctor.service-unbound\` (no \`service\` in loam.json —
  never raised inside the docs repo itself, where having none is the correct state
  and binding one would be meaningless), \`doctor.service-unknown\` (loam.json names
  a service the docs repo has no directory for — the same state \`loam status\`
  reports as \`next.adopt-bound\`), \`doctor.likec4-config-missing\` (the docs repo
  has no \`likec4.config.json\`, so pointing LikeC4's own renderer at it fails:
  loam parses each \`.likec4\` file alone and each declares its own
  \`specification\` block, so a workspace load merges them and every declaration
  reads as a duplicate — the \`fix\` field carries the exact file to write),
  and the two about this repo's own generated command and skill files:
  \`doctor.agent-files-missing\` — some of them are absent, because the repo was
  initialized by an older binary or they were deleted — and
  \`doctor.agent-files-stale\` — some that ARE here carry no
  \`<!-- generated by loam vX.Y.Z -->\` stamp, or one older than the running
  binary, so the protocol and code tables they instruct an agent with may
  describe a loam that no longer exists. EXPECT the second one on the first
  \`loam doctor\` after an upgrade, on a repo nobody has touched: stamping is
  newer than the files, so nothing written by an earlier loam carries a stamp
  at all, and every one of them reads as unstamped. That is the intended
  reading — an unstamped file is one nobody has confirmed still describes this
  binary — but it means the finding is not evidence that anything was edited or
  broken.
  For the first, run the command the finding's own \`fix\` field spells: it names
  this repo's \`docsDir\`, its service binding and its tool ids explicitly, and
  \`loam init\` writes only the command and skill files that are absent and never
  touches one that already exists. (It does rewrite \`loam.json\` — but a re-run
  with no \`--docs\` keeps the pointer the file already commits, so it cannot move
  the fleet under you. Reach for \`--create\` only to make a docs repo that does
  not exist yet; beside a working \`docsDir\` it scaffolds a second, empty source
  of truth and \`validate --all\` then goes green over an empty fleet.)
  For the second there is no command: the repair is by hand, one file at a
  time. Read each file the finding names against the body this loam writes,
  then set (or add) its stamp line to \`<!-- generated by loam vX.Y.Z -->\` for
  the running version — or, if you have no local edits worth keeping, delete
  that file and re-run \`loam init\`, which lays the current one down. Neither is
  ever regenerated in place: your edits outrank the template, so detection is
  all loam does, and the stamp is a human's claim that the file still means what
  it says rather than a refresh. Leaving either finding standing costs entry
  points and the accuracy of what the entry points say, nothing else.
- \`loam rebase <FEAT>\` writes the baseline pins: \`Based-On:\` under every
  MODIFIED/REMOVED requirement in the feature's spec deltas, and
  \`x-loam-based-on\` on every operation in its openapi.yaml, from the living text
  as it stands right now. Run it when you finish authoring a delta and again
  after you resolve a collision — it is the one mechanism standing between two
  features in flight and silently reverting each other's landed work. It refuses
  rather than inventing a pin, and re-pinning is not resolving: see
  "The requirement baseline".
- \`loam dependencies [<FEAT>]\` derives the ordering of the features in flight
  from the artifacts themselves — requirement identities and OpenAPI
  operationIds, never from validator prose. It is the answer to every
  "another feature in flight does this first" finding, and to
  \`delta.added-conflict\` / \`delta.modified-conflict\`, which no ordering fixes.
- \`loam explore [<service>...]\` reads the fleet around a change nobody has
  written down yet, and writes nothing. It exists because \`loam new\`'s
  \`--touches\` list is the hardest call in the cycle and the only one nothing
  downstream catches: a list short by one service produces a feature that
  validates, archives and ships with a consumer nobody updated. What it derives
  is mechanical — the one-hop ring, each service's rung, its living operations,
  who already calls whom, and which active features cover the same services. It
  does NOT decide which of those neighbours you actually change; that is a
  judgement about intent, and loam does not make those.
- \`loam instructions [<workflow>] [args...]\` prints one of the six workflow
  protocols — \`loam-adopt\`, \`loam-feature\`, \`loam-implement\`, \`loam-check\`,
  \`loam-verify\`, \`loam-ship\` — with \`$1\`, \`$2\` filled in from the arguments you
  pass. The protocol ships inside the binary, so it describes the loam you are
  about to run rather than the one that scaffolded the repository; the command
  and skill files \`loam init\` writes are pointers at it. It reads no
  \`loam.json\` and no docs repo, deliberately: \`loam-adopt\`'s own first step is
  to run \`loam init\` when there is no config, so it cannot be the step that
  requires one.
`;
