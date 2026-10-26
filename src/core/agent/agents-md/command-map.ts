/**
 * Reading loam's output: which codes each invocation can raise.
 *
 * {@link CODE_MAP} is the code-by-code map of `status`, `validate`, `doctor`,
 * `rebase`, `dependencies`, `explore`, `seed` and `instructions` — the part
 * `loam instructions loam-codes` prints. ../workflows/reference/codes.ts
 * composes it with `./map/`, `./map/lenses/` and `./refusals.ts`, in exactly the
 * order ../agents-md.ts used to concatenate them, so the assembled page is the
 * section byte for byte.
 *
 * This module used to hold the other delivery too: `READING_OUTPUT` and
 * `REFERENCE_PAGES`, the two AGENTS.md sections that stayed behind when the map
 * left. Since 0.2.0-alpha.1 AGENTS.md is the single ORIENTATION literal in
 * ../agents-md.ts, which carries its own condensed "Reading loam's output" and
 * "Reference pages" sections, and nothing assembled the two old constants into
 * anything loam shipped. They were deleted rather than left to be edited as if a
 * reader would ever see them.
 *
 * WHY THE MAP LEFT THE FILE, given that this package's whole subject is a file.
 * AGENTS.md is auto-loaded from the working directory by every agents.md-aware
 * host, on every session, and `loam init` writes it once and never refreshes it.
 * It reached 109,399 bytes; Codex truncates the AGENTS.md chain at 32,768 bytes
 * and Windsurf caps a workspace rule file at 12,000 characters, both silently.
 * Roughly seventy percent of the document was being dropped with no error and no
 * way for the reader to tell which half it held — and this section alone was
 * 44,433 of those bytes, 41% of the file. It is also the half a reader consults
 * at a moment it can name (a run reported something) rather than the half it
 * needs to form a question at all, which is what decided which side of the split
 * it went. ../workflows/reference/reference.ts carries the rest of that argument.
 *
 * The move is a move and not a deletion: every byte is still shipped, still in
 * the same corpus test/codes-drift.test.ts reads (AGENTS_MD + PROTOCOLS), and
 * still one command away rather than one file away.
 *
 * WHAT THE MAP IS, AND WHAT IT DELIBERATELY IS NOT. The unique content is which
 * codes which INVOCATION can raise: nothing else in the corpus says that, and an
 * agent choosing what to run needs it. What it does not carry is a per-code
 * gloss of what each code MEANS. That half used to be written twice — once here,
 * once in the /loam-check fix tables — in two independently worded places, in a
 * file `loam init` writes once and never refreshes, so the two drifted with
 * nothing able to say which had rotted. `loam explain <code>` now answers
 * meaning, severity and fix for every code named below, out of the running
 * binary. test/agent-contract.test.ts holds that pointer honest: every code
 * backticked in the corpus must resolve through `explainSubject`, so a family
 * added here without an explanation fails by name. Keep the code list; add the
 * gloss only where it says something `explain` cannot — a condition on when the
 * invocation raises it at all, or a cross-reference between two codes.
 *
 * ONE PARAGRAPH THE MOVE MADE FALSE, and the reason to look for others like it.
 * The `agents.stale` entry read "one check on this very file … the reason to
 * distrust what you are reading", which was true while these bytes WERE the
 * scaffolded AGENTS.md. On a page printed by the binary it is exactly backwards
 * — this page cannot be stale, and the file it warns about is somewhere else —
 * so the entry names AGENTS.md instead. A section that talks about its own
 * document does not survive being moved to another one; that is the class to
 * check for whenever anything else leaves this file.
 *
 * CODE_MAP is one part of the `loam-codes` page, which
 * ../workflows/reference/codes.ts assembles by PLAIN CONCATENATION — no join
 * separator — so it starts at the first character of its opening line and ends
 * with the newline that closes its last one. Keep that shape when editing, or
 * two parts glue onto one line on the printed page.
 */
import { STATUS_COMMAND } from "./map/status.js";

/**
 * The reference page's own opening: what the map is, where the /loam-check fix
 * tables sit beside it, and the one family `loam explain` cannot answer.
 */
const MAP_INTRO = `**What this page is.** It says which codes an INVOCATION can raise. It does
NOT say what they mean: that half is one command away and describes the loam you
are running rather than the one that scaffolded this repo. \`loam explain <code>\`
gives one code's meaning, its severity in each scope that grades it, and its fix;
\`loam explain --codes\` lists the whole vocabulary and \`loam explain --codes --json\`
is the machine-readable form. The one family \`explain\` does not answer
is the OpenSpec migration surface (\`openspec.*\`, \`mapping.*\`) — those commands run
before a repository has a governed loop to look a code up from — so those entries
alone keep their notes here.

The code-by-code fix table is a different document again: it lives in the
\`/loam-check\` command \`loam init\` lays
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
selected that tool.

The map:

`;

const MAP_REST = `- \`loam validate --service <id>\` grades one service's own axes: \`service.unknown\`,
  \`service.no-model\`, \`service.no-spec\`, \`service.no-openapi\`, \`c4.invalid\`,
  \`c4.declaration-diverged\`, \`c4.element-unowned\`,
  \`c4.no-relationships\`, \`requirements.missing-scenarios\`,
  \`requirements.stepless-scenario\`, \`requirements.assertionless-scenario\`,
  \`requirements.examples-unbound\`, \`requirements.examples-unreferenced\`,
  \`spec.merge-conflict\`, \`spec.duplicate-requirement\`, \`spec.no-requirements\`,
  \`spec.repeated-operations\`, \`spec.repeated-covers\`, \`openapi.invalid\`,
  \`openapi.duplicate-operationid\`, \`openapi.response-undescribed\`,
  \`openapi.ref-unresolved\`, \`api.ungoverned\`, \`api.ops-unlinked\`,
  \`api.requirement-deprecated\`, \`spec-api.op-undefined\`,
  \`spine.landscape-invalid\`, \`spine.op-undefined\`, \`spine.op-link-missing\`,
  \`spine.op-deprecated\`; the async contract axis (AsyncAPI 3):
  \`service.no-asyncapi\`, \`asyncapi.invalid\`, \`asyncapi.duplicate-message\`,
  \`asyncapi.payload-undescribed\`, \`asyncapi.ref-unresolved\`,
  \`spine.message-undefined\`, \`spec-event.message-undefined\`,
  \`spine.message-unproduced\`, \`spine.message-external\`, \`spine.message-unbound\`,
  \`asyncapi.message-contested\`, \`event.messages-unlinked\`, \`event.ungoverned\`,
  \`event.covered\`; and the architecture spec axis: \`covers.unknown\`,
  \`health.invalid\`, \`health.uncovered\`, \`health.dependency-unmodelled\`.
  Run inside the service's own repo, once a generated suite exists under
  \`<gherkinDir>/loam/\`, it also grades that suite against the living specs:
  \`gherkin.missing\`, \`gherkin.stale\`, \`gherkin.orphaned\`. A service that never
  ran \`loam gherkin\` stays quiet — that whole trio is conditional on the suite
  existing here — and a file tagged with a feature still in flight answers to
  that feature, not to the living spec it has not merged into yet.
- \`loam validate --feature <id>\` grades a change's three axes against each other and
  against the fleet in flight: \`delta.invalid\`, \`delta.nothing-tagged\`,
  \`delta.specification-not-merged\`, \`delta.service-unknown\`, \`delta.service-id-invalid\`, \`spec-api.op-undefined\`,
  \`spec-api.op-pending\`, \`c4-api.op-undefined\`, \`c4-api.op-pending\`,
  \`c4-api.op-deprecated\`, \`c4.op-ungoverned\`, \`c4.op-link-missing\`,
  \`c4.service-binding-invalid\`, \`api.op-unconsumed\`,
  \`service.no-requirement-delta\`, \`archedge.uncovered\`, and — the same four
  codes service scope raises, graded here on the feature's own spec.md and
  arch.spec.md deltas, because every one of those breaches merges into the
  living document — \`spec.repeated-operations\`, \`spec.repeated-covers\`,
  \`spec.merge-conflict\` and \`requirements.stepless-scenario\`. A feature
  whose verification record will not read as one raises
  \`evidence.record-unreadable\` (warn) here as well. Then the
  architecture spec axis (\`c4.uncovered\`, plus \`covers.unknown\` on the
  feature's arch.spec.md deltas), the delta-shape group:
  \`delta.unknown-section\`, \`delta.no-delta-sections\`,
  \`delta.requirement-not-merged\`, \`delta.modified-unknown\`, \`delta.removed-unknown\`,
  \`delta.added-duplicate\`, \`delta.added-near-duplicate\`, \`delta.modified-pending\`,
  \`delta.removed-pending\`, \`delta.added-conflict\`, \`delta.modified-conflict\`,
  \`delta.living-duplicate-requirement\`, and the API-removal group:
  \`openapi.remove-marker-anonymous\`, \`openapi.remove-op-consumed\`, and
  \`openapi.op-revived\` (warn, gates archive: the delta spells an operation an
  archived feature retired, or at an address one retired or moved it away
  from while it lives on elsewhere, so the merge would put it back).
  The event axis is graded in feature scope too — the \`asyncapi.*\`
  baseline/removal/conflict codes, \`asyncapi.slot-revived\` (the same revival
  on a channel, operation or message), plus \`c4-event.*\`, \`spec-event.*\` and
  \`spine.message-unbound\` (a tagged edge's event key bound to a topic or other infrastructure).
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
  \`landscape.platform-candidate\` and
  \`landscape.datastore-shared\`, \`service.id-invalid\` (fleet scope only, and
  graded before the map is opened, so it stands even when the landscape is
  missing or unreadable), the four renderer-wiring warnings a
  \`loam subsystem sync\` repairs — \`service.likec4-config-missing\` (a model that
  STANDS ALONE, declaring its own \`specification\`, with no
  \`likec4.config.json\` beside it: it renders nowhere from the docs root),
  \`service.likec4-config-stray\` (that file beside a model that EXTENDS the map,
  where it registers a project that CLAIMS the model, out of the root project
  where the map's kinds are),
  \`service.model-excluded\` (the root \`likec4.config.json\` excludes an extending
  model's directory, so the renderer never loads it) and
  \`service.model-unexcluded\` (it does NOT exclude a standalone model's, so the
  renderer merges that model into the map and calls every declaration a
  duplicate) — plus \`c4.fleet-project-invalid\` (warn: every document reads clean
  where loam grades it and the ONE project the renderer builds out of the map and
  every extending model does not, because something is declared in two of them),
  a per-service \`sources.unverifiable-from-here\`, and
  one check on the docs repo's own AGENTS.md, \`agents.stale\`. That last one is
  the reason to distrust THAT file rather than this page: it fires when its
  version stamp on line 1 (\`<!-- generated by loam vX.Y.Z -->\`) is missing or
  older than the running binary, which is exactly when what it says may name a
  loam that no longer exists. It is never refreshed automatically — your edits
  outrank the template, so detection is all loam does, and a hand-curated file
  silences it the same way, by keeping the stamp current. This page has no such
  failure mode: it is printed by the binary it describes.
  \`loam validate --all\`'s \`--json\` payload also carries the additive \`scorecard\` key — per-axis ceiling-vs-actual fleet
  aggregates, the text report appending the same table; derived per run and never stored, so week-over-week is the pipeline's job: capture the key per run into a metrics store.
  \`scorecard.adoption\` counts the services PARTICIPATING in each contract axis
  (requirements, arch, openapi, asyncapi, permissions, capabilities; the
  denominator is \`scorecard.services\`) — an axis at 0 of N reads "not started",
  which is expected during staged adoption and distinct from partially adopted.
  Text mode folds the warnings such an axis alone causes under one banner per
  axis and says so; \`--json\` carries every finding unchanged, and the summary
  counts, exit codes and \`--strict\` are identical either way.
- \`loam doctor\` is read-only local/fleet preflight — the first thing to run in a
  repo that behaves as though the fleet were empty. Every finding carries a
  \`fix\` field naming the exact command or edit, so this is the one family you
  rarely need \`loam explain\` for. Its blockers are \`doctor.config-missing\`,
  \`doctor.config-invalid\`, \`doctor.docs-missing\`, \`doctor.services-missing\`, and
  the three that say the fleet map cannot be read at all —
  \`doctor.landscape-merge-conflict\`, \`doctor.landscape-invalid\` and
  \`doctor.landscape-unreadable\`. It also grades what a WRITE that did not finish
  left in the docs repo, reported as \`writePath\` beside the findings:
  \`doctor.docs-locked\`, \`doctor.commit-interrupted\`, \`doctor.commit-unreadable\`
  and \`doctor.staging-temps\`. When this repo is a service repo that same scan
  covers \`<gherkinDir>/loam/\`, the root \`loam gherkin\` commits into.
  Accessibility, portability and incomplete binding stay warnings:
  \`doctor.docs-unreadable\`, \`doctor.docs-readonly\`, \`doctor.docs-absolute\`,
  \`doctor.inventory-unreadable\`, \`doctor.landscape-missing\`,
  \`doctor.service-unbound\` (never raised inside the docs repo itself, where
  having no service binding is the correct state), \`doctor.service-unknown\`
  (the same state \`loam status\` reports as \`next.adopt-bound\` — or, when an
  active feature introduces the service, as that feature's \`next.feature\`, and
  then the finding names the feature and \`currentService.introducedBy\` lists
  it: there is nothing to adopt),
  \`doctor.likec4-config-missing\`, and the two about this repo's own generated
  command and skill files: \`doctor.agent-files-missing\` and
  \`doctor.agent-files-stale\`.
  The second one fires only for a file whose body differs from the one this
  loam writes AND whose stamp is missing or older — so after an upgrade, expect
  it when the release changed the pointer text, never for a stamp-only
  difference, and never for an edited body under a current stamp (that stamp is
  the record that somebody reviewed it). Re-running \`loam init\` refreshes an
  unchanged pointer only when its current bytes still match the digest
  recorded in \`loam.json\`; an unrecorded or customized file stays in place
  for a human to review.
  One more warning is about the docs repo's AGENTS.md rather than these files:
  \`doctor.agents-md-shadowed\` reports a \`CLAUDE.md\`, \`.claude/CLAUDE.md\` or
  \`CLAUDE.local.md\` in the docs repo or above it that does not import AGENTS.md.
  Claude Code reads AGENTS.md only when none of those exists, so its sessions
  there start without this orientation. The fix is one line, \`@AGENTS.md\`, in
  that file, and it is yours to add.
- \`loam rebase <FEAT>\` writes the baseline pins: \`Based-On:\` under every
  MODIFIED/REMOVED requirement in the feature's spec deltas, and
  \`x-loam-based-on\` on every operation in its openapi.yaml, from the living text
  as it stands right now. Run it when you finish authoring a delta and again
  after you resolve a collision — it is the one mechanism standing between two
  features in flight and silently reverting each other's landed work. It refuses
  rather than inventing a pin, and re-pinning is not resolving: see
  "The requirement baseline". An operation or event slot the delta spells that
  an ARCHIVED feature retired is not pinned as new: rebase prints the
  \`openapi.op-revived\` / \`asyncapi.slot-revived\` finding (and \`revived[]\` in
  \`--json\`) and leaves the call — delete the quote, or re-add on purpose — to
  you. It judges the delta as it will write it, pins included, so a quote its
  own repin turns into an edit — repinned over whatever lives now at an
  address an archived feature moved the entry away from — is in that list too,
  under \`--dry-run\` as well.
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
  judgement about intent, and loam does not make those. \`--op <operationId>\`
  seeds from the operation's defining service; \`--capability <id>\` (repeatable)
  seeds from a declared capability's realizing services, and an id that seeds
  nothing lands in the additive \`unresolvedCapabilities\` — beside
  \`loam list capabilities\`, the rollup those seeds are read from.
- \`loam seed --from fleet.yaml\` is the onboarding entry point for an empty
  fleet: a tiny human-authored YAML — a \`services:\` list of ids, optional
  \`subsystems:\`, \`externals:\` and \`calls:\` lines like
  \`checkout -> payments\` — templated mechanically into
  architecture/landscape.likec4 (one bound element per service, plain edges, no
  guessed operationIds) plus one services/<id>/ directory per service, in one
  journaled transaction. Not an extractor: the human stated every fact, and
  "who calls whom" is the one thing no generator can read off a repository.
  The seeded landscape carries a line-1 stamp; while it stands unedited,
  editing fleet.yaml and re-running regenerates the map, and the first hand
  edit anywhere in the file, including above the stub, makes it yours — seed
  then refuses \`seed-landscape-edited\`
  rather than overwrite. So seed is a day-zero step: fleet.yaml has no spelling
  for \`metadata { op }\`, and once an edge carries one the map grows through
  adopt briefs and feature C4 deltas, not through seed. Then adopt each
  service: \`loam adopt --service <id>\`.
- \`loam instructions [<page>] [args...]\` prints one of the six workflow
  protocols — \`loam-adopt\`, \`loam-feature\`, \`loam-implement\`, \`loam-check\`,
  \`loam-verify\`, \`loam-ship\` — with \`$1\`, \`$2\` filled in from the arguments you
  pass, the \`loam-report\` support protocol, or one of the five reference pages —
  \`loam-codes\`, \`loam-spine\`, \`loam-authoring\`, \`loam-done-check\`,
  \`loam-drawing\` — which take no arguments. With no argument at all it lists all three sets. The pages ship
  inside the binary, so they describe the loam you are about to run rather than
  the one that scaffolded the repository; the command and skill files
  \`loam init\` writes are pointers at it, and so is AGENTS.md's own
  "Reference pages — fetch when needed" section. It reads no
  \`loam.json\` and no docs repo, deliberately: \`loam-adopt\`'s own first step is
  to run \`loam init\` when there is no config, so it cannot be the step that
  requires one.
`;

/**
 * The reference page's body, up to the modules that continue it. The bullets
 * are ordered so `status` — the orientation command, the one to run when you
 * have lost the session — is read first.
 */
export const CODE_MAP = MAP_INTRO + STATUS_COMMAND + MAP_REST;
