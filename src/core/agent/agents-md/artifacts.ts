/**
 * The document's opening arc: what the docs repo HOLDS — the layout, how its
 * documents link to each other, the glossary, architectural obligations, and
 * the `loam.json` wiring every repository commits.
 *
 * The three sections that used to close this file — the architecture spec
 * axis, the generated Gherkin suite, and the frontmatter/vouch chain — are now
 * the `loam-authoring` reference page (../workflows/reference/authoring.ts),
 * printed by `loam instructions loam-authoring` rather than written into
 * AGENTS.md. They are grammars consulted while writing ONE document, and the
 * file they were in is auto-loaded on every session by hosts that truncate it
 * silently; ./command-map.ts's header carries the measurement that decided it.
 * What is left here is what an agent must know before it can form a question
 * at all.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const ARTIFACTS = `# Working in this docs repo

This is a **loam** docs repo: the shared source of truth for a governed software
system — its architecture, requirements, contracts and evidence. Everything here
is plain files. \`loam\` reads and writes them; delete \`loam\` and the docs remain.

**The bar this artifact set aims at is reproducibility**: a reader should be able
to answer, from these files alone — what each governed boundary exposes, what it
reaches, what shapes it exchanges, how it is run, and what pages whom —
without opening the code. \`loam validate\` grades form and joins, never depth:
green means the files agree with each other, and the bar is what "done" is
measured against — a thin baseline that validates is thin, not done.

## Layout

\`\`\`
architecture/landscape.likec4     the living C4 model of the whole system
architecture/permissions.yaml     optional system-wide authorization vocabulary
architecture/obligations.yaml     optional ARCHITECTURAL obligations (#obl-<name> on the map)
architecture/adrs/NNNN-*.md       optional SYSTEM-level decisions (MADR) — only their links are graded
glossary/<term>.md                optional domain vocabulary — one file per term, nesting allowed
services/<svc>/
  model.likec4                    this governed boundary's C4
  spec.md                         its living requirements (current state)
  arch.spec.md                    its living ARCHITECTURE requirements (outbox, retries, alerts)
  openapi.yaml                    its API contract
  asyncapi.yaml                   its AsyncAPI 3 event contract
  usecases/<name>.likec4          optional flows INSIDE this boundary — dynamic views over its containers, graded when tagged #req- (any .likec4 beside model.likec4 is read the same way)
  adrs/  runbook.md  health.yaml  why it is like this, how to run it
features/<FEAT>/                  a change in flight
  intent.md                       why, in business terms
  delta.likec4                    the architecture change, tagged #<FEAT>
  specs/<svc>/spec.md             the requirement change for one governed boundary
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

## The glossary — the system's domain words

\`glossary/<term>.md\`, one file per term, nesting allowed
(\`glossary/payments/authorization.md\` is the term \`payments/authorization\`). There is
no \`glossary.yaml\`: a definition is prose, and the DIRECTORY is the list. The
directory's existence is the opt-in — a system without one hears nothing.

**A term is checkable because a link is a join.** Cite it from the document that
uses the word — a requirement, a capability document, a feature's intent — with an
ordinary relative link:

\`\`\`markdown
An [Order](../../glossary/order.md) is what a customer has confirmed.
\`\`\`

A citation that does not resolve is \`link.unresolved\` like any other; a term nothing
outside \`glossary/\` cites is \`glossary.unlinked\` (warn). Terms citing each other is
normal and does NOT count as adoption — a glossary is a network of definitions, and
two terms defining each other say nothing about whether the system uses either word.
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

Write the definition for a reader who knows the business and not this system: what the
word means, and what it is NOT (an order is not a cart). Never which service owns it —
that is the system map's question and it changes.


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

A governed system is **N + 1 repositories**: this docs repo, and one per governed
implementation boundary. Paths and commands call that boundary a \`service\`; it
may be a modular monolith, a network service, a CLI or a worker. Every repo
commits its own \`loam.json\`, so an agent, human or CI runner can find the rest
of the system. There is no global config; without a \`loam.json\`, commands refuse
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
- \`service\` — the canonical id of the governed boundary THIS repo contains, i.e. the
  \`services/<id>/\` directory it is allowed to speak for. \`loam vouch\`,
  \`loam gherkin\` and \`loam verify --service\` when writing with \`--record\`,
  \`--results\` or \`--contract-results\` bind to it; without it they refuse
  (\`repository-unavailable\`) rather than write another boundary's documents
  from a repo that is not that boundary's. A read-only verify checklist needs no
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
the system map, and reports the service binding — run it first when anything
behaves as though the system were empty.

**Living vs delta.** \`services/<svc>/spec.md\` is the complete current state.
\`features/<FEAT>/specs/<svc>/spec.md\` is a diff against it, reviewed as a diff, with
requirements grouped under \`## ADDED\`, \`## MODIFIED\` or \`## REMOVED Requirements\`.
\`loam archive\` folds the delta into the living state.

`;
