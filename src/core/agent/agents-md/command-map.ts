/**
 * Reading loam's output, in its two deliveries.
 *
 * {@link READING_OUTPUT} and {@link REFERENCE_PAGES} are what AGENTS.md keeps:
 * the `--json` envelope, the rule to branch on codes rather than prose, and the
 * index of the pages this file no longer carries. {@link CODE_MAP} is the
 * code-by-code map of `status`, `validate`, `doctor`, `rebase`, `dependencies`,
 * `explore`, `seed` and `instructions` — the part `loam instructions loam-codes`
 * prints. ../workflows/reference/codes.ts composes it with `./map/`,
 * `./map/lenses/` and `./refusals.ts`, in exactly the order ../agents-md.ts used
 * to concatenate them, so the assembled page is the section byte for byte.
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
 * READING_OUTPUT and REFERENCE_PAGES are sections of the AGENTS.md template.
 * ../agents-md.ts assembles the document by PLAIN CONCATENATION — no join
 * separator — so every section starts at the first character of its opening line
 * and ends with the newline that closes its last one. Keep that shape when
 * editing, or two sections glue onto one line in every docs repo loam scaffolds
 * from now on. CODE_MAP owes the same shape for the same reason, one level up:
 * reference/codes.ts concatenates it with the modules listed above.
 */
import { STATUS_COMMAND } from "./map/status.js";

/**
 * The section AGENTS.md keeps. Three facts an agent needs BEFORE it can form a
 * question — that every command speaks JSON, that the envelope survives a bad
 * invocation, and that codes are the contract and prose is not — plus the two
 * places the detail went.
 */
export const READING_OUTPUT = `## Reading loam's output

Every command takes \`--json\`, and the envelope holds even when the INVOCATION
is wrong: with \`--json\` anywhere in the arguments, an unknown flag, unknown
command or missing argument still yields \`{ ok: false, error: { code:
"invalid-option" } }\` on stdout with exit 1 (commander's own diagnostic goes
to stderr; \`--help\` and \`--version\` output pass through untouched). Without
\`--json\` the same refusal is plain text on stderr with nothing on stdout.

Branch on \`findings[].code\`, never on the prose — the wording changes, the codes do
not.

**What a code MEANS is one command away**, and the answer describes the loam you
are running rather than the one that scaffolded this repo. \`loam explain <code>\`
gives one code's meaning, its severity in each scope that grades it, and its fix;
\`loam explain --codes\` lists the whole vocabulary and \`loam explain --codes --json\`
is the machine-readable form. Reach for it rather than for a generated pointer:
this page is printed by the binary that defines the codes.

**Which codes an INVOCATION can raise** is the other half, and it is the one
thing nothing else carries. It is a reference page rather than a section here:
\`loam instructions loam-codes\`.

`;

/**
 * The index. A reference nobody can find is content deleted with extra steps,
 * so the exact command is spelled per page rather than described — and
 * test/agents.test.ts asserts that every name in REFERENCES appears here inside
 * its own `loam instructions` line, which is what makes a renamed page fail
 * loudly instead of leaving a pointer at nothing.
 */
export const REFERENCE_PAGES = `## The reference pages

This file is the orientation: the layout, the cycle, what gates and what only
advises, and what the words mean. Four things it does NOT carry — the grammars
you consult while writing ONE document, and the inventory of what each command
can report — are **reference pages**, printed by the binary rather than written
here. That is why: this file is auto-loaded on every session and never
refreshed, while a page out of the binary describes the loam you are actually
running, and is read at the one moment it is needed.

- \`loam instructions loam-codes\` — which codes each invocation can raise:
  \`validate --service\` / \`--feature\` / \`--all\`, \`status\`, \`doctor\`, \`gate\`,
  \`context\`, \`diff\`, \`explore\`, \`dependencies\`, \`rebase\`, \`seed\`, \`subsystem\`,
  \`mcp\`, the use-case views, the containment refusals, the error envelope, and
  the OpenSpec migration surface.
- \`loam instructions loam-spine\` — the ID spine: every join between the
  artifacts (\`operationId\`, message name, \`Covers:\`, \`Requires:\`,
  \`Capability:\`, \`Realizes:\`), the \`Based-On:\` baseline pins on both the
  requirement and the contract axis, how to draw a shared broker, and how to
  declare a message produced outside the fleet.
- \`loam instructions loam-authoring\` — the grammars you author against:
  the architecture spec axis (\`arch.spec.md\` and its \`Covers:\` line), the
  generated Gherkin suite, and frontmatter with the vouch chain behind it.
- \`loam instructions loam-done-check\` — the done-check: how \`loam verify\`
  derives its claims, the three channels that may answer them, the federated
  recording form, and what separates **verified** from **attested**.

Each takes no arguments and prints whole. \`loam instructions\` with no argument
lists them beside the six workflow protocols; \`loam explain <code>\` answers any
single code without opening a page at all.

`;

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
  \`spine.message-unproduced\`, \`spine.message-external\`,
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
  \`delta.service-unknown\`, \`delta.service-id-invalid\`, \`spec-api.op-undefined\`,
  \`spec-api.op-pending\`, \`c4-api.op-undefined\`, \`c4-api.op-pending\`,
  \`c4-api.op-deprecated\`, \`c4.op-ungoverned\`, \`c4.op-link-missing\`,
  \`c4.service-binding-invalid\`, \`api.op-unconsumed\`,
  \`service.no-requirement-delta\`, \`archedge.uncovered\`, and — the same four
  codes service scope raises, graded here on the feature's own spec.md and
  arch.spec.md deltas, because every one of those breaches merges into the
  living document — \`spec.repeated-operations\`, \`spec.repeated-covers\`,
  \`spec.merge-conflict\` and \`requirements.stepless-scenario\`. Then the
  architecture spec axis (\`c4.uncovered\`, plus \`covers.unknown\` on the
  feature's arch.spec.md deltas), the delta-shape group:
  \`delta.unknown-section\`, \`delta.no-delta-sections\`,
  \`delta.requirement-not-merged\`, \`delta.modified-unknown\`, \`delta.removed-unknown\`,
  \`delta.added-duplicate\`, \`delta.added-near-duplicate\`, \`delta.modified-pending\`,
  \`delta.removed-pending\`, \`delta.added-conflict\`, \`delta.modified-conflict\`,
  \`delta.living-duplicate-requirement\`, and the API-removal group:
  \`openapi.remove-marker-anonymous\`, \`openapi.remove-op-consumed\`.
  The event axis is graded in feature scope too — the \`asyncapi.*\`
  baseline/removal/conflict codes plus \`c4-event.*\` and \`spec-event.*\`.
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
  \`landscape.datastore-shared\`, \`service.id-invalid\` (fleet scope only, and
  graded before the map is opened, so it stands even when the landscape is
  missing or unreadable), a per-service \`sources.unverifiable-from-here\`, and
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
  (the same state \`loam status\` reports as \`next.adopt-bound\`),
  \`doctor.likec4-config-missing\`, and the two about this repo's own generated
  command and skill files: \`doctor.agent-files-missing\` and
  \`doctor.agent-files-stale\`.
  EXPECT the second one on the first \`loam doctor\` after an upgrade. It is not
  evidence that anything was edited or broken: staleness reads the version
  stamp only. Re-running \`loam init\` refreshes an unchanged pointer only when
  its current bytes still match the digest recorded in \`loam.json\`; an
  unrecorded or customized file stays in place for a human to review.
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
  edit makes the file yours — seed then refuses \`seed-landscape-edited\`
  rather than overwrite. Then adopt each service: \`loam adopt --service <id>\`.
- \`loam instructions [<page>] [args...]\` prints one of the six workflow
  protocols — \`loam-adopt\`, \`loam-feature\`, \`loam-implement\`, \`loam-check\`,
  \`loam-verify\`, \`loam-ship\` — with \`$1\`, \`$2\` filled in from the arguments you
  pass, or one of the four reference pages — \`loam-codes\`, \`loam-spine\`,
  \`loam-authoring\`, \`loam-done-check\` — which take no arguments. With no
  argument at all it lists both sets. The pages ship inside the binary, so they
  describe the loam you are about to run rather than the one that scaffolded the
  repository; the command and skill files \`loam init\` writes are pointers at it,
  and so is AGENTS.md's own "The reference pages" section. It reads no
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
