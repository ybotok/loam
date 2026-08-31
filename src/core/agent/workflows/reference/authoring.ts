/**
 * The `loam-authoring` reference page: the grammars of the documents you write.
 *
 * The architecture spec axis (`arch.spec.md` and its `Covers:` line), the
 * generated Gherkin suite, and the frontmatter/vouch chain that ties a
 * document to the code it was written from.
 *
 * All three are consulted at a moment you can name — while authoring one file
 * — and none of them is needed to form the question. That is the split this
 * page exists to make; ./reference.ts records why it had to be made at all.
 *
 * The text is the three AGENTS.md sections verbatim, in their original order,
 * so a cross-reference elsewhere in the corpus still names the same headings.
 */
import type { CommandContent } from "../../contract.js";

export const LOAM_AUTHORING: CommandContent = {
  name: "loam-authoring",
  description:
    "Reference: the grammars you author against — arch.spec.md, the generated Gherkin suite, frontmatter",
  // No arguments: one document, printed whole. See ./spine.ts for why the hint
  // is empty rather than a spelled-out "<none>".
  argumentHint: "",
  purpose:
    "What each document you author by hand must contain: the architecture requirements axis and its `Covers:` line, how scenarios become an executable suite, and the frontmatter fields `loam vouch` stamps.",
  invocation: "loam instructions loam-authoring",
  placeholders: [],
  spine: [
    "The architecture spec axis",
    "The generated Gherkin suite",
    "Frontmatter — who vouched for this, and from what",
  ],
  body: `The grammars you author against: the architecture spec axis, the generated Gherkin suite, and frontmatter.

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
description. A valid Markdown table AT THE MARGIN becomes the \`Examples:\` of
a \`Scenario Outline\`; a malformed table stays in the description and is
reported, because it will run once rather than once per row.

A step takes an ARGUMENT by carrying it INDENTED underneath: an indented table
becomes that step's data table (the rows an outbox or a DB table must hold after
the pass), a fenced block becomes its docstring, indentation intact (the request
payload). Indented under a step means this step's rows; at the margin means the
scenario's cases. A block no step precedes stays description and is reported as
\`strandedBlocks\` — the document reads, and the TEST lost its argument. Each scenario is
tagged \`@loam-digest-<16hex>\`: the same body
hash \`loam verify\` folds into its claim ids, riding into cucumber's JSON
report as a tag, so the suite, the claim and the report cannot quietly
disagree about what a scenario says. \`loam validate
--service <id>\`, run in the service repo, grades the suite by those digests
(\`gherkin.missing\` / \`gherkin.stale\` / \`gherkin.orphaned\`, all warn) — the
fix is always regeneration, never editing a generated file.

The flow, closed end to end: \`loam gherkin FEAT-101\` → \`loam steps --service
<id>\` (the phrase inventory: how many step definitions this suite needs, one
per phrase row, and which phrases differ only by an article or a trailing
clause) → write step definitions (outside \`loam/\`) → run the suite with a JSON report
(\`cucumber-js --format json:report.json\`) → implement until green →
\`loam verify FEAT-101 --service <id> --results report.json [--contract-results contract.json] [--record rest.json]\`,
run in that same service repo. The digest
tags ride through the runner into the report, so the \`scenario.tested\` claims
are answered mechanically from the passing report rather than anybody's word.
This proves which digest-matched report bytes loam accepted; it does not prove
the report was produced by executing the attested commit. See
\`loam instructions loam-done-check\` for what \`--record\` still covers.

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
`,
};
