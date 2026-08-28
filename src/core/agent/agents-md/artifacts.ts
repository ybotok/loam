/**
 * The document's opening arc: what the docs repo HOLDS — the layout, the
 * `loam.json` wiring, the architecture spec axis, the generated Gherkin
 * suite, and the frontmatter/vouch chain.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const ARTIFACTS = `# Working in this docs repo

This is a **loam** docs repo: the shared source of truth for a fleet of services —
their architecture, their contracts, and what they are required to do. Everything
here is plain files. \`loam\` reads and writes them; delete \`loam\` and the docs remain.

**The bar this artifact set aims at is reproducibility**: a reader should be able
to answer, from these files alone — what the service exposes, what it reaches and
depends on, what shapes it exchanges, how it is run, and what pages whom —
without opening the code. \`loam validate\` grades form and joins, never depth:
green means the files agree with each other, and the bar is what "done" is
measured against — a thin baseline that validates is thin, not done.

## Layout

\`\`\`
architecture/landscape.likec4     the living C4 model of the whole fleet
architecture/permissions.yaml     optional fleet authorization vocabulary
architecture/obligations.yaml     optional ARCHITECTURAL obligations (#obl-<name> on the map)
architecture/adrs/NNNN-*.md       optional FLEET-level decisions (MADR) — only their links are graded
glossary/<term>.md                optional domain vocabulary — one file per term, nesting allowed
services/<svc>/
  model.likec4                    this service's C4
  spec.md                         its living requirements (current state)
  arch.spec.md                    its living ARCHITECTURE requirements (outbox, retries, alerts)
  openapi.yaml                    its API contract
  asyncapi.yaml                   its AsyncAPI 3 event contract
  adrs/  runbook.md  health.yaml  why it is like this, how to run it
features/<FEAT>/                  a change in flight
  intent.md                       why, in business terms
  delta.likec4                    the architecture change, tagged #<FEAT>
  specs/<svc>/spec.md             the requirement change for one service
  specs/<svc>/arch.spec.md        the architectural requirement change, same delta grammar
  specs/<svc>/openapi.yaml        the endpoints this feature adds
  specs/<svc>/asyncapi.yaml       the event-contract delta (optional; a complete AsyncAPI 3 document)
  verification.yaml               what was checked once the code was built
features/archive/<FEAT>/          shipped changes — the evolution history
\`\`\`

## Linking between documents

Documents here link to each other with **standard markdown links**, and the
target is a relative path to the file:

\`\`\`markdown
[0001 — transactional outbox](../../architecture/adrs/0001-transactional-outbox.md)
\`\`\`

Two reasons, and the second is the one that decides it. A markdown link renders
as a link in pull-request review, which is where these documents are actually
read, while \`[[0001 transactional outbox]]\` renders there as the literal
brackets somebody typed. And its target is a real relative path, so "does this
link resolve" is a filesystem question with a yes-or-no answer — where resolving
a wikilink means reimplementing Obsidian's shortest-unique-path search across the
whole repo, which is guessing, and loam refuses and names rather than guessing.

You lose nothing by it. Obsidian reads a repo written this way with no
integration at all — graph view, backlinks and search all work on markdown links
— and its per-vault \`Use [[Wikilinks]]\` setting turns OFF, after which its own
autocomplete and rename-tracking produce markdown links too. The authoring
comfort is a toggle in somebody's editor, not a decision this repo carries.

**\`loam validate\` resolves these links** (\`link.unresolved\`, error): a relative
target that names nothing is a broken join, reported once per document with
every bad link and its line. A link here is a **join**, not decoration — a
requirement that names a term wants that term's document linked, and an ADR that
supersedes another wants to say which, the same kind of relationship
\`Operations:\` and \`Covers:\` already state.

Three things are deliberately NOT graded, so write them freely: a target outside
this repository (\`../../some-service/README.md\` — that tree may not be checked
out beside these documents), a link to a heading (\`#section\`), and any link
inside a fenced code block or an inline code span, which is how a document shows
the convention without being convicted for it.

CASE **is** graded, and deliberately: \`[Order](Order.md)\` beside a file called
\`order.md\` resolves on Windows and macOS and 404s on GitHub and every Linux
runner, so the message names the stored spelling on all of them alike.

## The glossary — the fleet's domain words

\`glossary/<term>.md\`, one file per term, nesting allowed
(\`glossary/payments/authorization.md\` is the term \`payments/authorization\`). There is
no \`glossary.yaml\`: a definition is prose, and the DIRECTORY is the list. The
directory's existence is the opt-in — a fleet without one hears nothing.

**A term is checkable because a link is a join.** Cite it from the document that
uses the word — a requirement, a capability document, a feature's intent — with an
ordinary relative link:

\`\`\`markdown
An [Order](../../glossary/order.md) is what a customer has confirmed.
\`\`\`

A citation that does not resolve is \`link.unresolved\` like any other; a term nothing
outside \`glossary/\` cites is \`glossary.unlinked\` (warn). Terms citing each other is
normal and does NOT count as adoption — a glossary is a network of definitions, and
two terms defining each other say nothing about whether the fleet uses either word.
\`loam list glossary\` prints every term with the documents that cite it.

**A feature may bring a new word with it**: write it at
\`features/<FEAT>/glossary/<term>.md\` and \`loam archive\` copies it into \`glossary/\`,
\`loam unarchive\` takes it back out. This route is CREATE-ONLY — a term the living
glossary already defines is \`glossary.term-exists\`, which \`--approve\` does not
override, because the merge is a whole-file copy and would replace an authored
definition wholesale. To CHANGE a definition, edit \`glossary/<term>.md\` directly in
the same pull request, where git produces an ordinary conflict.

Cite the new word at its FUTURE living path (\`../../../../glossary/order.md\` from a
\`specs/<svc>/\` delta) — that link resolves while the feature is in flight, and the
merge re-expresses it from wherever the text lands, so it keeps resolving afterwards.

Write the definition for a reader who knows the business and not this fleet: what the
word means, and what it is NOT (an order is not a cart). Never which service owns it —
that is the fleet map's question and it changes.


## Architectural obligations — what the architect hands the team

An architect has always had one checked channel here: an edge carrying
\`metadata { op 'authorizePayment' }\` obliges the provider to define that operationId,
or \`spine.op-undefined\` fails the gate. Obligations are the same handoff for the rules
that VARY — an outbox on this publisher and not that one, a circuit breaker on two
edges out of five — and they are three separate things on purpose:

- an **ADR** in \`architecture/adrs/\` says WHAT was decided, as thin or as thick as the
  decision needs;
- a **\`#obl-<name>\` tag** on an element or an edge in \`architecture/landscape.likec4\`
  says WHERE it applies, so one ADR governs three edges and not the fourth without the
  document forking;
- **\`architecture/obligations.yaml\`** declares the names, so a mistyped tag is an error
  rather than a word nobody notices.

\`\`\`yaml
obligations:
  outbox:
    description: Publishers write the event and the state change in one transaction.
    adr: architecture/adrs/0001-transactional-outbox.md   # relative to the docs repo root
\`\`\`

**Your side of it is \`Covers:\`**. A tagged object with no living requirement covering it
is \`obligation.uncovered\` (warn), and the finding names the service, the object and the
exact line to write — \`Covers: <element>\` or \`Covers: <source> -> <target>\` in that
service's \`arch.spec.md\`, with a scenario that proves it. An id is its own tag suffix,
so it may hold letters, digits, \`_\` and \`-\` only.

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
  \`loam gherkin\` and \`loam verify --service\` when writing with \`--record\`,
  \`--results\` or \`--contract-results\` bind to it; without it they refuse
  (\`repository-unavailable\`) rather than write another service's documents
  from a repo that is not that service's. A read-only verify checklist needs no
  binding and works from the docs repo.
- \`gherkinDir\` — optional, default \`features\`: the directory \`loam gherkin\`
  writes its own \`loam/\` subtree into.
- \`agentTools\` — optional: the agent tools \`loam init\` has written command and
  skill files for here, accumulated across runs. Written by \`init\`, read by
  \`loam doctor\`; nothing else depends on it, and a config without it loads.

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

**Effective configuration and dependency semantics live here too, by
convention.** Facts about the service that no artifact structurally holds —
the value a deploy chart actually sets, the retry budget a client library
hardcodes ("retries: -1 is unbounded"), the delivery or idempotency guarantee
a driver decides — are ARCH REQUIREMENTS: prose with a \`Covers:\` line naming
the element or edge whose behaviour the fact decides. loam will never verify
the values; naming the home is the point. A service whose timeout comes from
an env var in a chart in another repository is otherwise described by no file
in this repo, and two adoptions will file the same fact two different ways.

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
derived space — and a committed one: an emission lands through the same lock
and journal the docs repo's writers use, as \`loam/.loam-lock\` and
\`loam/.loam-commit\` dotfiles that exist only while a run is in flight (or
after a kill, where the journal is what lets the next run finish the job).
Regeneration rewrites its scope and deletes its orphans, so
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
description. A valid Markdown table becomes the \`Examples:\` of a
\`Scenario Outline\`; a malformed table stays in the description and is
reported, because it will run once rather than once per row. Each scenario is
tagged \`@loam-digest-<16hex>\`: the same body
hash \`loam verify\` folds into its claim ids, riding into cucumber's JSON
report as a tag, so the suite, the claim and the report cannot quietly
disagree about what a scenario says. \`loam validate
--service <id>\`, run in the service repo, grades the suite by those digests
(\`gherkin.missing\` / \`gherkin.stale\` / \`gherkin.orphaned\`, all warn) — the
fix is always regeneration, never editing a generated file.

The flow, closed end to end: \`loam gherkin FEAT-101\` → write step definitions
(outside \`loam/\`) → run the suite with a JSON report
(\`cucumber-js --format json:report.json\`) → implement until green →
\`loam verify FEAT-101 --service <id> --results report.json [--contract-results contract.json] [--record rest.json]\`,
run in that same service repo. The digest
tags ride through the runner into the report, so the \`scenario.tested\` claims
are answered mechanically from the passing report rather than anybody's word.
This proves which digest-matched report bytes loam accepted; it does not prove
the report was produced by executing the attested commit. See "The done-check"
for what \`--record\` still covers.

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
vouch_scope: sampled 2/9 seed=1a2b3c4d5e6f7089   # only when the vouch read a SAMPLE
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
one the code has moved out from under (\`sources.stale\`). On \`sources.stale\` or
\`content.stale\`, \`loam vouch --pack --service <id>\` (read-only, stamps nothing)
prints exactly what to re-read before the human re-vouches — the body's diff since
the last vouch, the source files that moved, and the sections already covered.

\`content_digest\` is the same promise about the document itself: a hash of the
body below the frontmatter, stamped by the same vouch. It closes the other half of
the forgery — editing a spec after it was vouched used to leave \`status: verified\`
standing over words nobody read. \`loam validate\` recomputes it wherever it can
read the doc (no service repo needed, so it fires from the docs repo too) and
reports \`content.stale\` (warn): only a person can say whether verified still
holds of the new words.

\`vouch_scope\` appears only when the person vouched after reading a SAMPLE of the
document — \`loam vouch --sample <n>\`, whose whole purpose is that a partial read
is recorded as a partial read. Its value is one flat string,
\`sampled <k>/<n> seed=<16 hex>\`: k sections read of n, and the seed those k were
chosen with. The seed is \`sha256(<service> NUL <content_digest> NUL <sources_digest>)\`
truncated to 16 hex characters, and the sections are ranked by
\`sha256(<seed> NUL <index> NUL <heading>)\` with the lowest k taken, over every H2
and H3 heading of the body outside code fences — so anybody holding the document
can recompute exactly which sections that person was shown, and an agent cannot
steer the pick without rewriting the document (which changes the seed and voids the
stamp). \`status\` stays \`verified\` and the maturity rung stays \`vouched\`: the scope
qualifies that claim, it is not a fourth status. \`loam validate\` reports
\`sources.sampled-vouch\` (warn) while it is there, \`loam list\` shows
\`vouched (sampled)\`, and a later FULL \`loam vouch\` deletes the field. Never write
or delete it by hand: removing it turns a partial read into a full one on every
surface at once, which is the one forgery this field exists to make impossible.

Write \`sources\` for anything you author from reading code, and leave \`status: draft\`
until a human has read it. Promoting draft to verified is their call, not yours, and
it has its own command — \`loam vouch --service <id>\`, run inside that service's repo,
which stamps the status, the date, the identity (\`vouched_by\`, from git), both digests
and the per-file index
(\`sources_files\`, which is what lets a later \`sources.stale\` name the paths that
moved) together — into the living spec.md
and, when the service has one, arch.spec.md, in one all-or-nothing run: a file whose
sources cannot be verified refuses the whole vouch. Never write those six fields by
hand: a status with no digest behind it is a claim with nothing behind it. If the
document changed under vouch between the read and the write, it refuses with
\`vouch-raced\` and stamps nothing — re-read and re-run.

**\`loam vouch\` is not yours to run**, and it is built so that it cannot be. It is
the one command whose output is a claim about a HUMAN act — everything else loam
checks is internal consistency, which fluent prose satisfies on its own — so it
refuses \`vouch-unattended\` when stdin is not a terminal (and in \`--json\` mode,
where a question cannot be asked), answers \`vouch-declined\` when the person says
no, and refuses \`vouch-unattributable\` when git can name nobody, because a stamp
with no \`vouched_by\` behind it records only that the word was written. \`--yes\`
exists for a person's own scripted run; typing it on someone's behalf is
writing their name. The generated command and skill files pre-approve loam's
read-only and authoring verbs one by one and deliberately not this one: when
the work is done, hand back and say a vouch is owed.

`;
