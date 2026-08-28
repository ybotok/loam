# Changelog

All notable project changes are recorded here. The format follows Keep a Changelog, and release
versions follow Semantic Versioning.

## [Unreleased]

_Each entry states the change and names every code, flag, path and payload key it introduced. The
case for a change — the alternative that was rejected, the defect it came from, the rule it
generalises — lives where it is maintained: [SCHEMA.md](SCHEMA.md) for the rule,
[ROADMAP.md](ROADMAP.md) for the priority and its exit criteria, and the commit that landed it._

### `loam --help` is grouped

- The twenty-eight commands now print under seven headings — **Set up · Read the fleet · Adopt what
  exists · Change it · Check it · Ship it · Migrate** — in the order the work happens, mirroring the
  six shipped workflow protocols rather than inventing a second taxonomy.
- **Nothing is hidden and nothing is renamed.** Every command still parses, still appears, and still
  carries the same flags; `test/help-groups.test.ts` asserts that no command is hidden, that every
  one has a heading, and that no stray heading exists. `src/cli.ts` throws on a command with no
  heading, so a twenty-ninth added without one fails the first time anybody runs the binary rather
  than landing quietly at the bottom of the page.
- [AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) now states that **help layout is
  not part of the frozen surface**: names,
  flags, exit codes, the envelope and the codes are frozen; which heading a command prints under is
  typography, and regrouping is not a compatibility event.

### The build's own contract, read as a check

- **New `contracts` block in `loam.json`**: `{ "contracts": { "openapi": "build/openapi.yaml" } }`
  names where this repository's BUILD writes its contract. `loam validate --service` digests that
  document and compares it with the committed `services/<id>/openapi.yaml` — **new finding
  `openapi.generated-stale` (warn)** when they differ, **`contracts.source-missing` (error)** when
  the path holds nothing (CI that validates before it builds), and **`contracts.source-invalid`
  (error)** when it escapes the repository or does not parse.
- **It reads, and never writes.** The copy into the docs repo stays a human `cp` reviewed in a pull
  request, which is what keeps the committed contract a document somebody agreed to rather than a
  cache of the build. This is the same category as `verify --results` ingesting a cucumber report:
  loam parses a standard document the team's build emitted, at a path a human named, and derives no
  meaning from it — no line of service code is read.
- **The digest is over canonical JSON, not bytes**, so two generator versions ordering keys
  differently, or a dumper re-wrapping a description, produce silence rather than a permanent
  warning nobody can clear. Service-repo only, and entirely silent for a repo with no `contracts`
  block — which is every existing repo.
- The premise this closes is SCHEMA's most load-bearing untested one: that the committed contract is
  what the service actually serves. Most fleets generate OpenAPI and copy it by hand, and until now
  nothing in the product could notice when the copy stopped being current.

### `docs.binary-behind` — the run that reports green without having graded the corpus

- **New finding `docs.binary-behind` (warn)**, on `loam validate --all` and `loam doctor`: the docs
  repo's `AGENTS.md` stamp names a loam NEWER than the binary reading it.
- **It is the only finding that changes what a PASS means rather than reporting a defect.** Every
  check loam has is an existence constraint over a value the parser recognised, so a binary that
  predates a grammar addition does not fail on the newer directive — it reads it as prose, produces
  no join, and reports green. Until now nothing said so: `agents.stale` grades only the opposite
  direction, and explicitly declined this case because the fix is different (upgrade the binary, do
  not edit the file).
- **Warn, not error**, on the `sources.stale` doctrine: a mixed-version fleet is ordinary, and
  failing every command in that repo aims a refusal at the wrong person. `--strict` is the lever
  for a fleet that wants it to gate. The message says plainly that a pass from this binary is
  incomplete rather than clean, and never sends anyone to edit `AGENTS.md`.
- Prerelease identifiers are compared, not ignored — in a 0.x product a prerelease is exactly where
  a generated file's form and a corpus grammar actually move, which `agents.stale` already learned
  the hard way at beta.2.

### Any test runner can answer a scenario claim

- **`--results` now also accepts `{"loamScenarioReport": 1, "results": [{"digest": "…", "status":
  "passed", "test": "…"}]}`**, chosen by its marker key, beside the cucumber JSON it already read.
  `digest` is the `@loam-digest-…` tag `loam gherkin` stamped; `status` is `passed` or `failed`;
  `test` is optional free text used as the evidence string.
- **This is a widened input dialect, not a weakened standard of proof.** The contract was never
  cucumber's JSON — it is the content-derived digest plus a status saying a real run reported it
  green, and both halves are present here. An answer from this shape is `answered_by: runner`,
  identical to a cucumber one, because it is the same claim answered to the same standard by the
  same identity. A fleet on JUnit, pytest, Playwright, Vitest or a house runner was previously held
  at `attested` **by a file format**, which is the one thing that distinction was never meant to
  mean.
- It adds no forgeability: loam cannot prove any JSON came from executing a commit — which is why
  the record stores the file's sha256 and mtime and claims nothing more — and a hand-written
  cucumber array was always exactly as easy to write.
- **Parsing is strict, and a `skipped` status is refused rather than guessed.** A scenario that did
  not run has no place in an answer sheet; omitting it leaves the claim unanswered rather than
  confirmed. A file carrying the marker is always graded as that shape even when malformed, so an
  author is told the real mistake instead of "this is not a cucumber array".

### Two corrections from review, before either shipped in a release

- **`spec.unknown-directive` no longer fires inside a fenced block.** A requirement body
  legitimately holds a fenced example, and inside one `Realises:` is a sample value rather than a
  misspelled directive — the check convicted a document that was exactly right, which is the one
  thing a near-miss guard may never do. Backtick and tilde fences both toggle; a real typo after a
  closed fence is still caught. Table cells never fired (a pipe-led line does not match the
  candidate pattern) and there is now a test saying so.
- **`verify.checklist-forked` is measured against the current checklist, not pairwise between
  attestations.** The pairwise reading answers the wrong question: three services that all attested
  against a since-rewritten delta agree with each other perfectly and are every one of them stale,
  which pairwise called clean. The notice now names the services whose answers are not about the
  questions being asked now. Differing `docsCommit` values remain **not** a finding — recording a
  week apart is normal for a feature in flight.

### A grammar guard: `spec.unknown-directive`

- **New finding `spec.unknown-directive` (warn)** — a requirement body line whose key is one or two
  edits from a directive and is not one: `Realises:`, `Capabilties:`, `Opertaions:`, `Publsihes:`.
- This was the one place the corpus was quieter than it looked. Every join is an existence
  constraint over a *parsed* value, so a key the parser does not recognise yields no value, no join
  and therefore no finding — the requirement claims to realize a promise, gets nothing, and validates
  clean. It is the judgement `obligation.unknown` already makes one axis over ("a mistyped tag reads
  exactly like a rule"), applied to the keys themselves.
- **Measured by edit distance, not by shared prefix**, deliberately: `closeIds`'s three-character
  prefix rule would report `Context:` as a near miss for `Consumes:`, in a check whose entire value
  is that it does not cry wolf. `Note:`, `Owner:`, `Rationale:`, `Status:` and `See:` are silent,
  and the example fleet's warning count is unchanged at ten.

### An attestation says what it answered, and against what

- **Two optional keys on each `ServiceAttestation`**: `checklist` (the digest that attestation
  answered) and `docsCommit` (the docs-repo HEAD it was derived from, when the docs repo is a git
  checkout). `commit` already pinned the service repo — the code the evidence points into — and
  nothing pinned the side the *question* came from.
- **New finding `verify.checklist-forked` (warn)** — two or more services on one record answered
  different versions of the feature's question set. The record carried a single top-level
  `checklist` digest, so this state could not be represented at all: the staleness check flagged
  both services or neither, and never said which answers went stale.
- **An attestation with no `checklist` field is not counted as a third version.** Silence is not
  disagreement, and reading it as such would fire this on every federated record written before the
  field existed. `docsCommit` is omitted rather than refused when the docs repo is not a git
  checkout — a docs repo is not obliged to be one.

### The pages say where loam is behind, not only where it is ahead

- **README's "Why" now carries what green does *not* mean**, pointing at
  `src/core/brief/unchecked.ts` — the fifteen statements of what no check will ever tell you, which
  the binary already prints into the adoption brief and no page had ever quoted. Completeness is the
  one worth naming out loud: forty behaviours documented as one requirement passes every check loam
  has. The `verified`/`attested` distinction moved up beside it.
- **COMPARISON.md gains "The wider field, and who is actually nearest"** — OpenFastTrace, Doorstop,
  Pact Broker, Backstage, EventCatalog, oasdiff/buf, StrictDoc/Sphinx-Needs and ArchUnit, each with
  the mechanism it shares and **who is ahead at it**. The page compared loam only to OpenSpec, which
  is the nearest tool on one of loam's seven joins and on none of the other six. Two entries are
  direct credit: OpenFastTrace put the version inside the coverage token years ago, and Doorstop
  stored a parent's fingerprint on a link thirteen years before `capability.realizes-stale`.

### A living `Realizes:` pin, so a moved promise stops being invisible

- **New finding `capability.realizes-stale` (warn).** A `Realizes:` entry may now carry the digest of
  the capability requirement it was written against — `Realizes: checkout#CHK-1@9f2c1a4b` — and
  `loam validate` reports one warning per pinned entry whose target has been rewritten since. Until
  now every capability check was an EXISTENCE constraint: `capability.realizes-unknown` fires when
  the target is *gone* and stays silent when the target merely *changed*, so an analyst could narrow a
  promise and every requirement claiming to keep it went on claiming so, in a corpus loam rewrote
  itself. It is a warn and not an error because re-reading a moved promise has three legitimate
  outcomes and loam cannot tell which; it never gates `loam archive`.
- **New flag `loam rebase --living`**, which writes and refreshes those pins across the living
  corpus and takes no feature id — so `rebase`'s `<FEAT>` argument is now optional, and every
  existing invocation still parses. It commits through the same journaled transaction as every other
  writer, under the same docs lock, and rewrites exactly one `Realizes:` line per requirement that
  already has one: it never invents a join on an author's behalf. Its stored rerun is
  `loam rebase --living`. `--service <id>` and `--dry-run` apply.
- **Nothing changes for a corpus that has not been pinned.** An entry without a pin grades exactly as
  it did before, forever, which is what lets this land with no migration.
- **`requirementDigest` now strips `Realizes:` pins as well as `Based-On:` lines.** Both are
  bookkeeping a requirement carries about its own joins, and a digest that moved when bookkeeping
  moved would make every pin self-invalidating — one `rebase --living` would go on to invalidate
  every `Based-On:` baseline in the fleet. The pinned and unpinned spellings of a requirement
  therefore digest identically, which `test/capability-realizes-pin.test.ts` asserts directly.

### The first hour starts from the fleet spine

- **`examples/fleet.yaml`** ships as a real `loam seed` input for the five-service example fleet, and
  **WORKFLOW.md's day zero step 2 now names `loam seed --from fleet.yaml`** instead of telling a
  reader to draw `architecture/landscape.likec4` by hand. `seed` has shipped since beta.1 and
  appeared in exactly one place in the prose: a command-table row.
- **README leads with two entry points that pay off before adoption starts** — "Start from the fleet
  spine" (seed, drop in the OpenAPI you already have, name the operation on each call edge, then
  `validate --all` convicts `spine.op-undefined` with no requirement Markdown anywhere) and "Guard
  the fleet's edges on every PR" (a copy-pasteable GitHub Actions job around `loam diff --base`,
  which exits 1 on a removal the fleet still consumes). Both state plainly that the run is red:
  `service.no-model` and `service.no-spec` are what a fleet at the bottom rung honestly looks like.
- **`test/spine-first.test.ts`** pins that sequence against the shipped `examples/fleet.yaml`,
  including the exact counts of the expected `service.no-model` and `service.no-spec` findings, so
  the documented first hour cannot drift from the binary.
- One stale cross-reference fixed: WORKFLOW.md sent readers to "the README's `loam diff` command
  note" for the oasdiff invocation, which lives in WORKFLOW.md's own command notes.

### Documentation — the pages say what the binary does, and four more claims are checked

- **README is the front door again, not the manual.** It carries the pitch, the install, the
  five-minute trial, one table row per command **with every flag the binary registers**, and links.
  Day zero, the per-command notes, the archive-protection walkthrough and the MCP server moved to
  [WORKFLOW.md](WORKFLOW.md); the fleet scorecard to [SCHEMA.md](SCHEMA.md); the measured fleet-run
  costs to `docs/BENCHMARKS.md`. Nothing was deleted, and the page is 53% shorter.
- **Five drift fixes, each one a claim that had stopped being true.** `loam list glossary` was
  missing from the command table; thirteen shipped flags were named on no page; the example fleet's
  headline read "0 errors, 7 deliberate warnings" against a fixture that has reported ten since the
  glossary and obligation axes landed; `loam mcp`'s prose listed eleven read commands after
  `loam_explain` made twelve; and SCHEMA's layout block — the tree readers take for the whole map —
  never drew `architecture/obligations.yaml`, `glossary/<term>.md`, `features/<FEAT>/glossary/`,
  `features/<FEAT>/capabilities/<cap>/spec.md` or `features/<FEAT>/specs/<svc>/asyncapi.yaml`.
- **Four new pins in `test/docs-facts.test.ts`, placed where the drift actually happened**: every
  registered long flag is named in README, the `loam list` row's sections equal the CLI's, SCHEMA's
  layout block names every artifact path `src/core/repo/` still builds, and the example fleet's
  counts are read out of `test/examples.test.ts` rather than carried as a fourth copy. Each was
  checked by breaking the fact it guards and watching it fail.
- **A derivable count no longer has a dated exemption.** ROADMAP's assessment claimed 261 modules
  and 21 commands for nine days against a tree holding 394 and 28, legally, because a dated heading
  covered counts that derive from one readdir. Only a passed/total test count keeps the exemption
  now; module, package, test-file and command counts are graded live on every page.
- **Every Markdown page wraps at 100 columns**, fences, tables and headings excepted, so a prose
  change reviews as a line-sized diff. The phrase assertions in `docs-drift`, `docs-facts` and
  `agent-contract` match through a whitespace flattener, which is what makes the wrap a formatting
  decision rather than a test-breaking one.
- **`[Unreleased]` states its changes rather than arguing them**, under a contract that is checked
  rather than promised: every code, flag, path and command an entry introduced — every one written
  in bold, which is how this file marks its subjects — is still named by the entry. What left is the
  argument, 31,342 words down to 12,572. One `ALLOWED_PROSE_TOKENS` entry was pruned with it,
  because the sentence carrying it was the case for a change, not the change.

### Added — architectural obligations: what the architect hands the team, for the rules that vary

- **`architecture/obligations.yaml`** declares the fleet's architectural obligations —
  `obligations: {<id>: {description, adr}}` — and a **`#obl-<name>` tag** on an element or an edge
  in `architecture/landscape.likec4` says where each one applies. loam had exactly one checked
  architect→team channel before this, and it works: an edge carrying `metadata { op }` obliges the
  provider to define that operationId or `spine.op-undefined` fails the gate.
- **`obligation.uncovered` (warn) is the prerequisite the roadmap named, discharged.**
  `c4.uncovered` could always say "this architecture object owes a requirement" — but only about a
  NEW tagged element in a feature's `delta.likec4`, never about the map the fleet actually runs on.
- **`obligation.unknown` (error) and `obligation.unapplied` (warn)** are the same join read in both
  directions, with the asymmetry `permissions.unknown`/`permissions.unenforced` already carry: a tag
  that resolves to nothing reads exactly like a rule the fleet keeps, while a declaration nobody has
  placed yet is an honest state.
- **`obligation.adr-missing` (error)** — an `adr:` field naming no file.
- **`obligation.invalid` (error)** suspends the family, as the permission and capability
  vocabularies' invalid states do.
- **The file is the opt-in**: a fleet without `architecture/obligations.yaml` produces no obligation
  finding at all, however many tags its map already carries.

### Added — a feature brings its own words, and the merge keeps their links pointing at them

- **`features/<FEAT>/glossary/<term>.md`** is copied into `glossary/` by `loam archive` and removed
  again by `loam unarchive`, so the vocabulary a change introduces ships and unships with it and is
  reviewed beside the requirements that use it.
- **The route is CREATE-ONLY**, and that is a decision rather than an unfinished half.
  **`glossary.term-exists` (error)** refuses a term the living glossary already defines, and
  **`--approve` does not override it** — approving it would be approving a deletion nobody
  described.
- **A feature may cite the word it is introducing** at that word's future living path.
- **`loam archive` now re-expresses relative links in the text it moves**, and this closes a defect
  that predates the glossary.

### Added — the domain glossary: `glossary/<term>.md`, checked through the links that cite it

- **`glossary/<term>.md`** is the fleet's domain vocabulary — one FILE per term, nesting allowed
  (`glossary/payments/authorization.md` is the term `payments/authorization`), and **no
  `glossary.yaml` anywhere**.
- **`glossary.unlinked` (warn)** — a term no document outside `glossary/` cites: a word the fleet
  never adopted, or a definition left behind by a rename.
- **A whole glossary nobody cites is ONE finding**, not one per term.
- **`loam list glossary`** — a fourth explicit-only section beside `capabilities`.

### Added — a markdown link is a join, and `loam validate` now resolves it

- **`link.unresolved` (error)** — a relative markdown link in an authored document whose target does
  not exist.
- **The corpus is every authored markdown document**: both spec axes living and delta, `runbook.md`,
  every `adrs/` file at all three altitudes, `intent.md`, and each capability document.
- **`link.unreadable` (error)** — a document in that corpus that could not be decoded, almost always
  UTF-16 (PowerShell's `>` and `Out-File` write it unasked).

### Added — `loam archive` refuses a business promise nothing keeps, in both directions

- **`capability.uncovered`** — a feature ADDS a capability requirement and no `Realizes:` line in
  the same feature's service deltas names it.
- **`capability.remove-requirement-realized`** — the same join taken in the removal direction, and
  it closes a hole that used to archive at exit 0: a feature removing a capability requirement that
  a living service requirement still realizes merged cleanly, and the next `loam validate --all`
  then failed with `capability.realizes-unknown` against a service document nobody had touched.
- **`loam status --json` gains `capabilities` artifact rows** (additive; present only when the
  feature carries the directory, with an optional `capability` key).

### Added — a feature can change a capability, and `loam archive` merges it

- **`features/<FEAT>/capabilities/<cap>/spec.md`** carries a delta against the living
  `capabilities/<cap>/spec.md`, in the requirement grammar and delta algebra every service spec
  already uses: `## ADDED|MODIFIED|REMOVED Requirements`, `Requirement-ID:` identity, `Based-On:`
  pins.
- **`loam rebase` learned the capability axis**, because `delta.baseline-missing`'s own message
  tells you to run it. Additive `--json` keys: `capabilities` and `capabilityPins` (a `PinOutcome`
  carrying `capability` instead of `service`).
- **The three capability-document rules now gate archive**, not just `loam validate`:
  `capability.requirement-unidentified`, `capability.requirement-service-scoped` and
  `capability.requirement-inert-join` are graded on the DELTA as well as on the living document.
- **A `--json` nuance worth knowing:** `Issue.subject` on a `delta.*` code no longer always names a
  service.
- **A fleet with no `features/*/capabilities/` sees no change and pays nothing** — one `existsSync`
  per feature, no read, no finding.

### Changed — `loam list capabilities` and `loam validate` now give the SAME answer to "is this promise kept"

- **`loam list capabilities --json` carries both corpora.** Each `requirements[]` row gains `keptBy`
  (additive): the ids of the `#cap-`/`#req-` tagged flows that keep that promise, beside the
  `realizedBy` service requirements that realize it.
- **An unreadable `architecture/` degrades rather than refusing.** The rows themselves come from
  `capabilities.yaml` and `capabilities/`, both readable, and `validate --all` already reports the
  broken document as `landscape.invalid` — so the listing prints what it has and marks the flows
  unread.
- **`capability.unrealized` counts flows too.** A capability whose every promise is kept by a tagged
  flow, named by no service requirement at all, was being told it was "a promise nobody implemented
  or a word nobody adopted" while loam's own report said the promise was kept.
- **Bare `loam list --json` is byte-identical**, and pays nothing: the capabilities section stays
  explicit-opt-in, and the flow read keeps its byte-scan gate in front of any LikeC4 load.

### Added — `#req-`: a use case can keep a business promise, which is the only way a cross-service one gets kept

- **A `dynamic view` already tagged `#cap-<slug>` may now carry `#req-<slug>`**, naming one of that
  capability's requirements.
- **`usecase.requirement-unresolved` (error)** — six failures with six fixes, and the message says
  which happened: no resolved `#cap-` tag, two of them, a capability with no document, a document
  with no requirements yet, an id that document does not declare (close ids offered, each already
  spelled as the tag to write), or two ids flattening to one slug.
- **A tag name accepts exactly `[A-Za-z0-9_-]`, measured at the `likec4@1.59.2` pin**, so the slug
  rule is now a whitelist rather than "flatten a slash": a `Requirement-ID` may legally contain a
  `.`, and a capability id its `/`.
- **Only a RESOLVED claim keeps a promise.** A broken `#req-` tag suppresses nothing, so
  `capability.requirement-unrealized` goes on firing beside the error — a typo that silenced it
  would turn a mistake into a green fleet.

### Added — `Realizes:`, the join that makes the business tree checkable

- **A service requirement says which promise it serves**: `Realizes: checkout#CHECKOUT-CHARGE-ONCE`,
  a list line resolving against a requirement in `capabilities/<cap>/spec.md`.
- **The separator is the LAST `#`, not the first.** The requirement half's grammar excludes `#`
  while a capability id is a YAML key and a directory name and is constrained nowhere, so splitting
  at the last one is unambiguous for every id there is.
- **`capability.realizes-unknown` (error)** — the entry names no capability requirement.
- **`capability.requirement-unrealized` (warn, fleet scope)** — a capability requirement no living
  `Realizes:` line names, one warning per requirement, subject `<capability>#<id>`.
- **`capability.requirement-inert-join` (error)** — a requirement in a capability document carrying
  `Capability:` or `Realizes:`.
- **Realizing a REQUIREMENT realizes its capability.** A requirement carrying only `Realizes:`
  counts toward `capability.unrealized`, and one carrying both joins is counted once.
- **`loam list capabilities --json` gains `requirements[]` per capability** (additive), each with
  what realizes it.

### Added — `capabilities/<cap>/spec.md`: the business tree an analyst can actually write in

- **A capability may now be declared by a DOCUMENT, not only by a name in
  `architecture/capabilities.yaml`, and the vocabulary is the union of the two.** Nothing is removed
  and nothing is deprecated: a fleet that declares twenty names in YAML and has written four
  documents is the normal state of an adoption, and both sides grade.
- **The directory IS the list.** A directory under `capabilities/` is a capability if and only if it
  holds `spec.md`; nesting is spelled by the tree, so the id `payments/refunds` lives at
  `capabilities/payments/refunds/spec.md` and `payments` may be a capability in its own right beside
  it. There is no manifest, for the reason `loam init`'s removed `loam.docs.json` was removed: a
  second list is a second thing that can disagree.
- **The opt-in widened, so a fleet can start grading capabilities without touching the YAML.**
  `architecture/capabilities.yaml` was this axis's only opt-in; now either file is.
- **`capability.doc-missing` (warn)** — a directory under `capabilities/` holding neither the
  document nor a capability beneath it: what `mkdir` leaves behind halfway through creating one.
- **`capability.requirement-unidentified` (error)** — a requirement in a capability document with no
  `Requirement-ID:`.
- **`capability.requirement-service-scoped` (error)** — a capability requirement carrying
  `Operations:`, `Covers:`, `Publishes:` or `Consumes:`.
- **The authored tree's own grades are not suppressed behind `capability.invalid`.** The suppression
  exists to stop a cascade of grades resolved against a file nobody can read; a directory holding no
  document, and a requirement with no stable id, consult no vocabulary at all.
- **What is NOT in this release, each owned by the roadmap:** the `Realizes:` join from a service
  requirement back to a capability requirement, the feature-local
  `features/<FEAT>/capabilities/<cap>/` delta merged by the transactional archive, and
  `loam new <FEAT> --capability <cap>`.

### Changed — a use case is now a CONSUMER, so `loam diff` can refuse where it used to warn

- **Read this one before upgrading CI.** A use-case hop is now a consumer, so a removal whose ONLY
  consumer is a step in a `#cap-`-tagged flow moves from `diff.op-removed` (warn, exit 0) to
  `diff.op-removed-consumed` (error, exit 1) — the same removal, the same command, a different
  verdict. A repository with tagged use cases may see `loam diff` start failing a pipeline that
  passed.
- **A CONTESTED hop is never a victim.** When the relationships backing a hop disagree about the
  operation, a removal touching it is reported as a suspension rather than as a broken flow: silence
  would claim nothing depends on it, and a victim would claim something does.
- **`loam context` gains one new exit-1 condition**: `architecture/` failing to parse as a LikeC4
  project is now a hole in the pack.
- **`loam diff` spends no new code for any of this.** Use-case victims ride the `details[]` of the
  two codes above, naming the flow, the hop number, the step title and the file:
  `use case 'uc_checkout' step 4 'authorizes the payment' (architecture/usecases/checkout.likec4)`.

### Added — the blast radius of a feature, in hops

- **`loam delta` and `loam status <FEAT>` gain a `useCases` key** (additive; nothing removed): the
  flows whose hops touch a service the feature addresses, each with its ordered steps and the
  services each step resolves to.
- **The landscape is loaded lazily**, because `loam delta` sits in `/loam-implement`'s hot path and
  a LikeC4 workspace spin there is felt on every iteration.
- **`loam context` and `loam explore --capability` see flows too.** The pack carries `useCaseSteps`
  for the service it is packing and `capabilities[].useCases` fleet-wide, and an `architecture/`
  that will not parse becomes a **hole** rather than an absence — the pack says it could not look,
  never that there are none.

### Added — a home for fleet-level decisions, and one way to link between documents

- **`architecture/adrs/NNNN-*.md` — ADRs about the fleet.** They existed at exactly two altitudes
  before this: a service's own decisions and a feature's.

### Added — `loam validate --all` grades a business use case, hop by hop

- **A `dynamic view` tagged `#cap-<slug>` is now a checked use case**, and four new stable codes
  grade it.
- **`usecase.step-unbacked` (error)** — a hop the model does not declare.
- **`usecase.capability-unresolved` (error)** — a `#cap-` tag that names no declared capability, or
  two.
- **`usecase.step-contested` (warn)** — the relationships backing one hop disagree about the
  operation, listed as candidates. It suppresses `usecase.step-unlinked` for the same step,
  structurally rather than by rule — the warn is derived from the attributed verdict, and the two
  verdicts are disjoint.
- **`usecase.step-unlinked` (warn)** — a backed hop that names no operation of the provider's
  contract, grouped under the OpenAPI adoption axis.

### Changed — the source-file limit is 400 lines, up from 300

- **A house limit, not a published contract — but it is in `CONTRIBUTING.md` and `AGENTS.md`, so it
  is stated here.** `test/code-limits.test.ts` now fails a `src/` file over **400** lines rather
  than 300.
- **What moved it was a measurement.** Across 359 files in `src/` the median was 150 and p90 was 283
  — and **thirteen files sat at exactly 300**, with sixteen more between 290 and 300.
- **400 rather than 500 or 600, because a ceiling has to keep asking.** The case for having one is
  that `src/core/agent.ts` reached 2,387 lines with nothing asking; at p90 283 a 500-line ceiling
  would be inert for years.

### Changed — `architecture/` is read as one LikeC4 project, so a use case can live in its own file

- **`validate --all` now loads `architecture/landscape.likec4` together with every
  `architecture/usecases/*.likec4` as ONE project**, the way the LikeC4 renderer has always read
  that directory.
- **Why a file of its own, rather than the landscape's `views { }` block.** Readability is the
  visible half — an analyst opens `usecases/checkout.likec4` and reads one business flow instead of
  scrolling a fleet-sized map.
- **Diagnosis improves rather than widening.** A typo'd element in a use-case file is attributed to
  THAT file: `landscape: architecture/usecases/checkout.likec4 has 2 error(s)`, and when more than
  one document is broken every detail line carries its own file.
- **Two authoring rules invert inside `architecture/`, and both are enforced by LikeC4 rather than
  by loam.** Exactly one document declares the `specification` block: every `.likec4` file loam
  parses alone must declare its own, while a second declaration inside one project is a duplicate
  error blamed on BOTH files (measured).
- **The generated `architecture/subsystems.likec4` is excluded from that project**, and
  docs/DESIGN.md rule 26 already said why: it stays a byte compare, and loam reads its contents in
  no document.
- **No new command, no new flag and no `--json` key for THIS change** — the loader is a mechanism,
  and the codes that grade on it are the use-case section above.

### Fixed — a service filed under a subsystem was named at a directory that does not exist

- **Every message that names an existing service's directory now spells it from the enumeration.**
  `services/<id>/` is right for an unfiled fleet and wrong for every filed one: a service under
  `services/platform/` lives at `services/platform/<id>/`, and eight separate messages joined the
  root form anyway — so `loam status` told a reader to go to `services/checkout-web/` when the
  directory was `services/commerce/checkout-web/`, and `loam gate --service identity-service`
  reported on `services/identity-service/` for a service at `services/platform/identity-service/`.
- **Eight sites, one rule.** `loam status`'s two adoption rungs, `loam gate`'s target and partner
  rungs, `loam validate --all`'s `landscape.service-unmodelled` and the datastore-placement fix in
  `fleet-shape`, the `loam adopt` brief's landscape instruction and artifact shape, `loam vouch`'s
  confirmation prompt, and `loam seed`'s "left exactly where it is" line — which was the worst of
  them, because that sentence is ABOUT placement.
- **`serviceTreePath` in `core/kernel/ids/dirs.ts` is that implementation**, with
  `serviceTreePathOf(docsDir, id)` beside `locateServicePaths` for callers that hold only an id.
- No new code, no new flag, no `--json` key: every change is message text and the internals that
  feed it.

### Added — a docs repo now scaffolds a README, the one file in it addressed to a person

- **`loam init --create` writes `README.md` first.** Everything else a docs repo starts with is
  either a document about the fleet or `AGENTS.md`, which runs to some 1500 generated lines and is
  named so that a human does not open it.
- `migrate-openspec` stages the same file, because its target is meant to be the docs repo
  `loam init` makes.

### Fixed — an authored view id could take the whole fleet map down while the gate printed green

- **`validate --all` now refuses a landscape view whose id loam generates**
  (`subsystem.view-id-collision`, **error**, one finding per colliding id, fleet scope).
- **Exactly one pair is compared, and that is the measured scope rather than a simplification.** A
  duplicate view id *inside* one document is already two LikeC4 errors, so `landscape.invalid` has
  had it all along (measured).
- **The check asks the generator what it mints.** `core/repo/tree/views.ts` now exports its id
  function and the `subsystem_` prefix instead of keeping them private, because a check carrying its
  own copy of that escaping would go quiet the day the encoding changed — and going quiet is the
  failure this whole family exists to prevent.

### Changed — the view doctrine narrows: loam reads what a view DECLARES, never what a view SHOWS

- **`docs/DESIGN.md` gains rule 26, and the written doctrine finally matches the enforced one.**
  loam's prose said it "never parses views"; what it actually never does is COMPUTE one.
- **Nothing is asked of any fleet, and nothing grades a views block's absence.** A repo that
  declares no dynamic view owes loam nothing, today or ever; `loam init` still scaffolds no `views`
  block — and that stays true after the use-case section above, whose four codes grade only a view
  somebody deliberately tagged. **Rule 26 itself adds no command, no flag, no stable code, no
  `--json` key and no severity change** — it records a boundary, not a behaviour.
- **`npm run arch:check` gains a `view-stage` scan, so the doctrine is a failing build rather than a
  paragraph.** `computedModel` and `layoutedModel` may not appear in `src/` at all (zero
  occurrences, so no whitelist — the one mention is inside a comment, which the scan's `codeOnly`
  blanks), and `$data` may appear only under `src/core/c4/parsed/`, which confines the blast radius
  of an upstream shape change to one module.
- **`test/likec4-view-shape.test.ts` pins the parsed record's shape at the `likec4@1.59.2` pin,
  written before any reader exists.** Ten measured facts, each load-bearing: LikeC4 synthesises an
  `index` view into every document (`_type: "element"`, no `sourcePath`) that a reader must ignore;
  a `<-` reply is recorded reversed AND flagged `isBackward`, while a forward step carries no such
  key; a `loop` is a nested entry with no endpoints and no `astPath` of its own; an untagged view
  reads `tags: null`; a step carrying `metadata` is a parse error, and a `#cap-` tag written after
  `title` is five of them.
- **loam now READS a declared `dynamic view`, and grades nothing on it yet.**
  `src/core/c4/parsed/dynamic-views.ts` normalizes the parsed record into `ParsedView`/`ParsedStep`
  — id, tags, title, description, and ordered steps carrying `source`, `target`, `title`, `notes`,
  `isBackward` and `astPath` — and it is the only module permitted to touch `$data`.
- **`astPath` is carried but optional, and that is a refusal rather than an oversight.** Every leaf
  carries one at the pin, so requiring it would look free — and would mean that an upstream release
  which stopped emitting the field turned every use case in the fleet into a view with zero steps at
  exit 0.
- **Two modules split, no behaviour changed.** `core/c4/likec4.ts` reached the 300-line limit, and
  the seam was already in it: resolving an element id to the `services/<id>/` directory it stands
  for is a distinct phase from loading a document, and runs over loam's own records rather than
  LikeC4's — it moved verbatim to `core/c4/resolve/service.ts` (28 importers rewritten, 22 of them
  one line longer, which is what splitting a widely-imported module costs and is not payable by
  squeezing a comment).
- **`SCHEMA.md`'s planned `services/<svc>/flows/` tree is retired rather than built.** A
  cross-service interaction flow is a `dynamic view` in `architecture/landscape.likec4` — the one
  document that already holds every cross-service edge.

### Fixed — a tag declared on a LikeC4 specification KIND could switch the fleet gate off

- **`validate --all` no longer reports a fleet it has stopped checking as agreeing.** LikeC4 1.59.0
  added tags on specification kinds, and 1.59.2 applies them to every element of the kind before
  loam sees anything: `specification { element softwareSystem { #external } }` puts `#external` on
  every `softwareSystem` in the document. loam reads `#external` as "deliberately not ours — stop
  grading it", so those six words silenced the landscape↔services reconciliation for the whole fleet
  at once, and the run ended on `landscape.matched` — *"N service(s) modelled —
  architecture/landscape.likec4 and services/ agree"* — over a map nothing had checked.
- **One new stable finding code, `landscape.kind-tag-graded` (error).** It fires when the
  landscape's `specification` block declares `#external` or `#platform` on an element kind **and**
  at least one element of that kind stands for a real `services/<id>/` directory — by an explicit
  `metadata { service }` binding, or by a title naming one.
- **A graded tag on a kind is still legal where it exempts nothing of ours** — and it has to be:
  `examples/docs/architecture/landscape.likec4` declares `element topic { #external #platform }` so
  that the Kafka topics nested inside an external broker do not each demand a
  `services/payment.events/` nobody owes, and that spelling is the one that scales.
- **`loam archive` now refuses a delta that declares its own feature tag on a kind**
  (`merge-failed`, exit 1, nothing written).

### Fixed — a feature delta's non-model blocks were silently discarded on archive

- **`loam archive` now refuses a delta whose `deployment { }` or `global { }` block, or whose
  `dynamic view`, the landscape merge cannot carry** (`merge-failed`, exit 1, nothing written;
  `--approve` does not override — the loss is mechanical, not a judgement about coherence).
- **A static `views { }` block is still accepted and still not merged** — `loam new` scaffolds one
  into every delta, and it is meant to be rendered while the feature is in flight rather than to
  travel.

### Added — `loam seed`: the fleet map templated from human-stated facts

- **New command `loam seed [--from <file>] [--json]`** — a tiny human-authored `fleet.yaml` (a
  `services:` list of ids, optional `subsystems:`, `externals:` and `calls:` lines like
  `checkout -> payments`) templated mechanically into `architecture/landscape.likec4` — one
  `softwareSystem` per service bound with `metadata { service '<id>' }`, `#external` systems, plain
  edges, the scaffold's own two views — plus one `services/<id>/` directory per service (under its
  subsystem where one is declared, with the marker and the regenerated
  `architecture/subsystems.likec4` in the same commit), all in one journaled transaction under the
  docs lock.
- **Seed never overwrites human work.** It writes the landscape only when the file is absent, is the
  scaffold's untouched stub, or carries seed's own line-1 stamp (`// loam-seed sha256:<digest of the
  rest>`) with a matching digest — a self-verifying record, no state anywhere else.
- **`loam status`'s empty-fleet teaching ladder now names the mechanical path**: the
  `next.author-landscape` rung over an untouched scaffold stub teaches `loam seed --from fleet.yaml`
  alongside authoring by hand.

### Added — the single-repo trial: `loam init` teaches the first hour

- **`loam init`'s human output now ends with the first-hour sequence** —
  `loam adopt --service <id> --json` → `loam validate --service <id>` → `loam vouch --service <id>`
  → `loam status`, each with a one-line reason — printed exactly when a single run both creates the
  docs repo (`--create`) and ends with a service bound (`--service`, or a binding the repo's
  existing `loam.json` already carried): the composition of the README's new five-minute trial.

### Added — `loam explain`: the vocabulary wall, answered from the binary

- **New command `loam explain [<subject>] [--json]`** — what a finding code, a refusal code or a
  loam concept means, without a docs repo and without wiring: like `loam instructions` it reads no
  `loam.json`, because the vocabulary wall is hit in the first minute in an unfamiliar repository. A
  finding code (`spine.op-undefined`) answers with the /loam-check fix table's own row — severity
  note, "what it means" and "what to do" verbatim, plus the `loam validate` invocation that surfaces
  it where the adoption brief knows one — **parsed at runtime from the same workflow body the binary
  ships**, so the explanation cannot drift from the documentation; a code graded in more than one
  table (service scope and `loam archive` plan time, say) explains every context.
- **`loam validate` and `loam verify` text reports gain a one-line footer** — `` → codes ride in
  `--json`; `loam explain <code>` says what one means and how to fix it `` — printed only when a
  non-ok finding (validate) or a notice (verify) was printed, appended as the report's last line,
  and only in text mode: every `--json` payload is byte-identical to before.
- **`loam mcp` gains `loam_explain`** — the read-tool table grows to twelve; one optional `subject`
  argument, read-only like the rest.

### Added — `loam list --subsystem` and `--owners`: the adoption campaign, sliced by group and by team

- **`loam list` gains `--subsystem <name>`** — the services section limited to one subsystem's
  services, at any depth, resolved against the same flat namespace every `loam subsystem` verb
  reads.
- **`loam list` gains `--owners <path>`** — a mechanical, read-only join of each listed service's
  directory to the owning teams in the user-named CODEOWNERS file (loam still has no permission
  model of its own; the forge's file stays the authority). `--json` gains the additive `owners` key:
  `path`, `teams[]` (owner plus that team's services in the listing's own filtered-and-ordered row
  order — the per-team campaign worklists), `unowned[]` (rows no rule matched, listed explicitly),
  `skippedRules[]`.
- **One new stable refusal, `owners-unreadable`** (exit 1): the CODEOWNERS path cannot be read, or a
  line in it cannot be parsed as `pattern owner…` — the message names the path and line.
- Considered and deferred: joining `features/**` to teams (the campaign worklist is services-only
  until someone asks), and any wider CODEOWNERS pattern grammar — implementing the fleet-wide `*`
  default above all — a half-implemented glob would attribute services the forge never did, so the
  subset grows only deliberately, with its own CHANGELOG line.

### Added — the axis-adoption rollup on `validate --all`

- **`loam validate --all --json` gains the additive `adoption` key on the `scorecard` payload** —
  services participating in each contract axis (`requirements`, `arch`, `openapi`, `asyncapi`,
  `permissions`, `capabilities`), one mechanical rule per axis (a requirement block for the two spec
  axes, file presence for the two contract files, a non-REMOVED `Requires:`/`Capability:` entry for
  the two vocabularies), the denominator carried once as the payload's existing `services` count.
- **Text mode groups the warnings a fleet-wide not-started axis alone causes under one banner per
  axis** — e.g. a freshly declared capability vocabulary's per-capability `capability.unrealized`
  warns collapse to
  `⚠ capabilities axis not started fleet-wide (0 of N services), expected during staged adoption — k warning(s) grouped: …`.

### Added — `loam vouch --sample <n>`: a partial read, recorded as one

- **New flag `loam vouch --sample <n> [--service <id>] [--yes] [--json]`** — vouch after reading a
  deterministic sample of `<n>` sections per spec-axis file, instead of the whole document.
  `--sample` never loosens attendance — no TTY and no `--yes` is still `vouch-unattended`, `--json`
  without `--yes` still refuses, and vouch stays off the generated agent allowlist.
- **The scope is stamped beside `vouched_by`, never inside `status`** — a new frontmatter field
  `vouch_scope: sampled <k>/<n> seed=<16 hex>`, written by `loam vouch` and never by hand.
- **A sampled vouch is distinguishable from a full one on every surface that reports trust.**
  `loam list` shows `vouched (sampled)` in text and adds `vouchScope: "sampled"` to the row in
  `--json` (additive, omitted for a full vouch; `maturity` stays `vouched`). `loam validate` reports
  the new warning `sources.sampled-vouch`.
- **One new stable code, `sources.sampled-vouch` (warn)** — one finding per sampled spec file,
  naming k of n, the seed and `last_verified`, from the docs repo as well (it needs no service repo,
  like `content.stale`).
- **Both spec axes count, and the fleet summaries say so.** The sample is per file, so a service
  whose `arch.spec.md` alone was sampled is one part of whose documentation nobody read:
  `loam list`, `loam show` and `loam status` grade the service from EITHER axis, and `show` prints
  the scope per file (with `archSpec.vouch_scope` additive in `--json`).
- **A later full vouch clears it.** `loam vouch` with no `--sample` deletes the `vouch_scope` field
  (the shared frontmatter writer gained an explicit list of keys to remove — deletion is something a
  call site names, never a null value it happens to hold — leaving the body byte-identical and every
  neighbouring line in place), so a document that has since been read in full stops reporting as
  sampled.
- **`--sample` composes with `--pack`.** `loam vouch --pack --sample <n>` prints the reading list
  for the sampled vouch that follows, through the same seeded derivation — so the pack and the stamp
  can never prescribe different sections — and prints only those sections in place of the full
  heading list.

### Added — `loam vouch --pack`: the re-vouch reading pack

- **New flag `loam vouch --pack [--service <id>] [--json]`** — a re-vouch now starts from a printed
  delta instead of a full re-read: for each spec-axis file (spec.md, and arch.spec.md when present)
  the pack prints (a) the file's git diff from the last commit in the DOCS repo's history whose body
  hashes to the stamped `content_digest`, with a section-level summary (changed/added/removed
  headings), (b) the source files that moved against the stamped `sources_files` index —
  added/changed/removed paths in the stale finding's own one-column layout — and (c) the sections
  whose text is identical to the vouched ancestor's, listed under `vouched_by`/`last_verified` so
  the read can stop where it should.
- **`--pack --yes` is refused** (`invalid-option`, exit 1): `--pack` is the reading list and `--yes`
  the unattended stamp, and a pack that immediately stamped would defeat the read it just
  prescribed.

### Added — `loam verify --diff-answers`: mechanical cross-examination of two blind answer sets

- **New flag `loam verify <FEAT> --diff-answers a.json b.json [--service <id>] [--json]`** — a
  read-only lens that validates BOTH answer sets with the same `checkAnswers` discipline the record
  path uses, against the same derived checklist, then reports per claim who agrees with whom:
  `cross.agree-confirmed`, `cross.agree-unconfirmed`, `cross.disagree` — joined by deterministic
  claim id only, never by claim text — plus the `cross.evidence-disjoint` warn notice naming
  agreed-confirmed claims whose cited FILE sets do not overlap (a trailing `:line` or `:start-end`
  suffix is normalized away, so two citations into one file never read as disjoint).
- **Agreement is not verification, structurally**: the payload deliberately carries no `verified`,
  `verdict` or `attested` key, `verification.yaml` is untouched (byte-identical before and after, no
  docs lock taken, works while a writer holds one), and nothing this flag does can upgrade
  `attested` to `verified` — two agents agreeing (usually two contexts of the same model, so
  correlated) ranks where a reviewer reads first, it proves nothing.
- **Refusals reuse existing codes and name WHICH file**: `answers-unreadable` / `answers-mismatch` /
  `answers-unevidenced` prefixed by "first/second answer set (`<file>`)"; `invalid-option` for a
  combination with `--record`/`--results`/`--contract-results`, for an arity other than exactly two
  files, and for an archived feature (frozen history has no current checklist to answer).

### Added — evidence pins: federated records stamp what was cited, and `loam validate` convicts drift

- **`loam verify <FEAT> --service <id> --record` now stamps `evidence_pins` under each
  agent-confirmed claim** — one pin per `file:line` citation: the cited file's sha256 at the
  attested commit (CRLF-normalized, so a Windows checkout's line endings can never read as drift),
  the cited line's text (trimmed, capped at 200 characters), and the literal token the claim asserts
  (the operationId, message name or edge op), carried structurally so nothing ever parses claim
  prose — stamped only when the attested blob actually contains it, so the validate-side token lint
  can only ever convict a disappearance, never re-litigate an absence the record-time notice already
  reported once.
- **One new record-time notice, `verify.evidence-token-missing`** (warn, in the existing
  `notices[]`, text and `--json` alike): a just-confirmed citation's file at the attested commit
  does not contain the claim's own token.
- **`loam validate`, run in a service's own repository, re-checks the pins** of every ACTIVE feature
  record that service has attested and reports the new `evidence.*` finding family: ok
  `evidence.checked` / `evidence.unpinned`, warn `evidence.unresolved` / `evidence.moved` /
  `evidence.line-changed` / `evidence.token-missing`, plus warn `evidence.record-unreadable` for a
  verification.yaml that exists but cannot be read — a hand edit that breaks the record must surface
  here as a finding, not as a silently green run.
- **No new command, no new flag, no new `ErrorCode`, no exit-code change**; the `--json` additions —
  `evidence_pins` inside the read and frozen views' `claims[]`, the notice, the findings — are
  additive payload keys.

### Added — `loam list --needs-work --review-order`: the blast-radius review queue

- **`loam list --needs-work` gains `--review-order`** — the adoption worklist sorted by blast
  radius: for each service, the number of DISTINCT other services that depend on it — drawing a call
  edge into it (with or without an `op`; a delivery edge carrying `consumes` is not a call, because
  on the event spine the arrow follows the message), subscribing to a message it produces via a
  drawn `consumes` edge, or carrying a living `Consumes:` requirement line naming a message its
  asyncapi.yaml declares `action: send` for.

### Changed — `loam status` walks the first hour of an empty docs repo

- **`loam status` in a docs repo with zero services and zero features now teaches the first hour
  instead of reporting it clean.** Three new stable `next[]` codes, in order:
  `next.author-landscape` (also emitted when `architecture/landscape.likec4` is still the scaffold's
  untouched bytes, not only when it is absent — the step names the file and the literal command),
  `next.bind-service` (wire a service repo's `loam.json` to this fleet) and `next.adopt-first`
  (write the first baseline).

### Added — `loam diff`: semantic branch diff of the docs repo, with the victims named

- **New command `loam diff --base <ref> [--json]`** — the fleet-meaningful delta between the living
  docs and a base git ref of the docs repo (a branch, `origin/main`, a commit sha): services
  added/removed, living requirements added/removed/modified (by `Requirement-ID:`/heading identity
  and content digest, so a `loam rebase` pin never reads as a change), OpenAPI operations
  added/removed/newly-deprecated, AsyncAPI messages added/removed, and cross-service joins that
  appeared or went away.
- **Fourteen new stable finding codes, zero new `ErrorCode` union members**:
  `diff.service-added`/`-removed`, `diff.requirement-added`/`-removed`/`-modified`,
  `diff.op-added`/`-removed`/`-removed-consumed`/`-deprecated`,
  `diff.message-added`/`-removed`/`-removed-consumed`, `diff.consumer-added`/`-removed` — documented
  in the generated AGENTS.md's command map.
- **loam now asks read-only git questions in the DOCS repo** (`rev-parse`/`ls-tree`/`show` — no
  checkout, no temp writes, every child process bounded by the same timeout and output caps
  provenance uses).
- **`loam mcp` gains `loam_diff`** — the read-tool table grows to eleven; the tool schema marks
  `base` required (the table now models required flags, mirrored against commander's own
  `requiredOption` by the shape test), and a call without it is refused as invalid params before any
  argv is built.

### Added — `loam verify --contract-results`: contract-test reports answer the `api.exposes` claims

- **New flag `loam verify <FEAT> --contract-results <file>`** — answer the `api.exposes` claims
  mechanically from an API contract-test report, the way `--results` answers the `scenario.tested`
  claims from a cucumber one.
- **Records gain a `contractReport:` pin and `answered_by: external-runner`** — the consumed
  report's path, sha256, mtime, distinct-operation count and format land on the record (all-at-once)
  or inside the recording service's attestation (federated, pruned with its answers, resolved inside
  the attesting repository and bound to the attested commit exactly as `report:` is), and each
  contract-confirmed claim says an external runner answered it (`[contract]` on the printed line).
- **The verdict ladder does not move** — a contract report can never answer a `scenario.tested`
  claim, so `attested` versus `verified` still turns on scenario claims alone; a contract-confirmed
  `api.exposes` claim counts toward `verified` exactly as an agent-confirmed one always has, with
  strictly more provenance behind it.
- **Ownership mirrors `--results`, contested operations included**: under the flag the contract
  report owns every `api.exposes` claim in scope — an answers-file entry for one refuses
  `answers-mismatch`, a mechanical flag alone refuses while other claims are outstanding, an
  unreadable or unrecognizable report refuses `answers-unreadable` naming the accepted shape, and
  the flag refuses on archived features exactly as `--record` does. An operationId that more than
  one service on the checklist exposes is `verify.digest-contested`'s case on this axis — a report
  entry names no service, so those claims stay `unconfirmed` and the run carries the new
  **`verify.operation-contested`** notice (warn, gating nothing, an open-vocabulary notice code
  exactly as `verify.claims-open` was); `--service` resolves it.

### Added — `loam mcp`: the read commands as MCP tools over stdio

- **New command `loam mcp`** — a hand-rolled MCP stdio server (JSON-RPC 2.0, newline-delimited,
  protocol revision 2025-06-18 negotiated down to 2025-03-26/2024-11-05) for hosts that reach tools
  through MCP rather than a shell.
- **One machine contract, not two**: every tool result carries the command's `--json` envelope
  VERBATIM in `content[0].text` (and parsed again as `structuredContent`), with `isError` following
  the envelope's `ok` — so `ok`, `error.code` and every payload key mean exactly what they mean at
  the CLI, and a refusal (`no-config`, `unknown-target`, …) arrives as a readable envelope with
  `isError: true`, not as a dead call.
- **No new stable codes, no envelope changes, no new dependency** — the server is hand-rolled on
  `node:stream` and the existing commander wiring; `@modelcontextprotocol/sdk` was considered and
  declined (three runtime dependencies is a product decision).

### Added — `loam gate`: can-i-deploy, answered from recorded evidence

- **New command `loam gate [--service <id>] [--strict] [--json]`** — a can-i-deploy-shaped PURE
  QUERY for deploy pipelines outside loam's lifecycle: it executes nothing, writes nothing, takes no
  lock, and answers only from evidence previous runs recorded.
- **Four new stable finding codes, all in the open finding vocabulary — zero new `ErrorCode` union
  members.** `gate.service-undocumented` (error): the gated service itself sits below `documented`,
  so the docs cannot say what its joins are; re-running succeeds once `loam adopt`'s required
  artifact set exists — and under a map that cannot be read it fires only when the service is below
  `documented` regardless of whether an API is owed, because the api question is then unanswerable
  and one unanswerable fact yields one finding.
- **The `--json` payload** carries `verdict`, `strict`, `landscape` (`read`/`absent`/`invalid`),
  `partners[]` (maturity rung, consumer/provider role, the joining operations and messages,
  `external`), `features[]` (the record's own tallies and three-valued verdict per touching feature)
  and `checks[]` (findings by check, in the shared finding shape) — so a pipeline wanting a stricter
  bar (vouched partners, no attested scenarios) branches on data rather than waiting for a flag.
- **No new ErrorCode strings, no changed envelope fields, and no change to what gates the archive**:
  verify still never gates the merge, archive still reads no verification record — `loam gate`'s
  verdict is advice to a deploy pipeline loam does not own (WORKFLOW.md's "What actually gates" now
  says so beside the other two gates).

### Added — `loam context`: one service's docs slice as one deterministic briefing

- **New command `loam context <service>`** — assemble, for one service, the exact docs slice bound
  to it as one payload an agent loads before working in that service's repository: the living
  requirements and arch requirements VERBATIM (bodies and Given/When/Then lines, with the
  `Operations:`/`Covers:`/`Requires:`/`Capability:`/`Publishes:`/`Consumes:` joins parsed out beside
  them), the OpenAPI operations with the requirements governing each (`x-loam-remove` filtered), the
  AsyncAPI messages with their send/receive direction, the fleet edges one hop out with the map's
  own health beside them (the `landscape` key carries `present` and `parses`, so silence is evidence
  rather than absence), the `Requires:` permissions resolved against `architecture/permissions.yaml`
  (an undeclared entry is carried with `declared: false`, never refused), the capabilities the
  service realizes — with both fleet vocabularies' own health beside their sections, so
  `declared: false` under an unreadable vocabulary reads as "nobody could look" — maturity and
  frontmatter provenance, presence pointers for runbook/health/ADRs, and every ACTIVE feature's
  delta over the service in `loam delta`'s own payload shapes, each ending with the runnable
  `loam delta <FEAT> --service <id>` line.
- **Exit 1 with `ok: true` when the pack has a silent hole** — a landscape that is present but does
  not parse, an unreadable living `openapi.yaml`/`asyncapi.yaml`, an unreadable fleet vocabulary
  (permissions or capabilities), another service's spec file the capability rollup could not read
  (degraded per file into the `capabilitiesUnread` payload key, never a refusal — one service's
  briefing is not hostage to a sibling's encoding), or an included feature whose `delta.likec4` has
  errors or whose contract delta does not parse — and a feature whose delta does not parse is still
  INCLUDED in every service's pack with its errors in the payload, because a change nobody can read
  is in flight, not absent.
- **Internal relocation**: the delta projection helpers (`apiChanges`, `eventChanges`, `archSlice`,
  `introducedServices`, `livingServices`) moved from `src/commands/delta/slices.ts` to the new
  `src/core/projection/` package, and `stripFrontmatter` to `src/core/document/frontmatter.ts`, the
  day the pack became their second caller — commands do not import commands, so the shared
  projection now lives in core.
- **`/loam-implement` gains the pack as its load step** — `loam context $2 --feature $1 --json`
  right after `loam status`, before `loam delta`: the delta is what changes, the pack is what it
  changes into, and reading it first is how a MODIFIED requirement lands as an edit rather than a
  rewrite.

### Added — `loam open`: an editor workspace derived from the committed bindings

- **New command `loam open`** — writes a `.code-workspace` file joining the docs repo and every
  service checkout whose committed `loam.json` binds to it.
- A sibling whose `loam.json` exists but cannot be read is reported in `skipped[]` — never fatal,
  and never a member, because an unreadable binding proves nothing; a sibling bound to a different
  docs repo is silently not a member.

### Added — the fleet scorecard

- **`loam validate --all --json` gains one additive payload key, `scorecard`** — ceiling-vs-actual
  aggregates for the whole fleet, recomputed per invocation from the reads the run already makes and
  never stored: `services` with the maturity rollup (every rung present), `provenance` (vouched
  services · stale source digests · sources unverifiable from here — the latter two counted off this
  run's own findings by subject, so each is the same number the report prints beside them),
  `verification` (recorded records — the features axis's `active` count is their one shared
  denominator — the three-valued verdicts, and `claims.answered` — the confirmed claims split by
  their own `answered_by`, one count per provenance with all three keys always present: `runner` (a
  digest-matched cucumber run), `external-runner` (an operationId-matched contract report) and
  `agent` (somebody's word, and every record too old to carry the field)), `operations` (defined →
  governed · deprecated, plus deprecated operations something still joins to), `messages` (defined →
  linked), `c4` (the fleet map's drawn systems, by the map's own census — actors, externals,
  groupings and containers excluded — → covered by an arch requirement) and `features` (active, with
  each feature's fleet stage over all five stage keys).
- **`loam validate --all` text output appends a "fleet scorecard" table** after the summary footer —
  one line per axis, ceiling before actual.

### Added — inverse coverage on the event axis, and the partial-verification honesty line

- **New stable finding code `event.ungoverned`** (warn) — `loam validate --service` / `--all` now
  warns, per living asyncapi.yaml, when declared message(s) are named by no requirement's
  `Publishes:`/`Consumes:` line, listing the orphaned names.
- **New verify notice `verify.claims-open`** (warn) — `loam verify`'s read view and the frozen
  post-archive view now carry a one-line honesty summary whenever a record EXISTS and leaves claims
  unconfirmed or unanswered: "not a clean result", with all four counts and the agent's-word share
  of the confirmed.
- **WORKFLOW.md gains "The honestly-small change"** — the walkthrough for a one-service,
  requirements-only change: scaffold with `--touches`, delete the scaffolded C4 delta on the
  scaffold's own printed advice, author intent.md and one spec delta, and ship down the three-step
  `next[]` (`next.generate-tests`, `next.verify`, `next.archive`), with `loam status` printing "(not
  written — none owed)" beside every artifact the change legitimately skips.
- No new command, flag, exit code, or envelope key; both new codes are open-vocabulary
  finding/notice codes, exactly as `api.ungoverned` and `verify.scenario-attested` were before them.

### Added — the LikeC4 canary

- **A weekly scheduled workflow** (`.github/workflows/likec4-canary.yml`, manual dispatch included)
  **installs `likec4@latest` over the exact 1.59.2 lockfile pin and runs the LikeC4-touching suites
  against it**, then the committed 120-service benchmark as informational evidence in the run's step
  summary.

### Documentation

- **The product comparison now follows OpenSpec v1.10.0** (released 2026-08-19) while the certified
  parser/migration corpus stays pinned at the v1.9.0 commit
  `2826b8889e5223a9a8095d4428b60b56597e1020` — v1.10.0 changed no requirement-Markdown format
  upstream, and COMPARISON.md, README.md and MIGRATING-from-OpenSpec.md now name the divergence as
  deliberate.

### Added — the shipped documentation is now guarded like a contract

- **package.json, the release preflight, and the smoke share one reviewed package-file list**
  (`scripts/package-docs.mjs`): `files[]` set-inequality with the reviewed list is now a release
  blocker and an `npm test` failure, and every reviewed page must be relatively linked from README —
  adding a shipped document is deliberately a three-place edit, and the blocker names all three
  places.
- **New drift guards run inside `npm test`** (test/docs-facts.test.ts, test/package-docs.test.ts):
  counted facts in the shipped pages must match the live tree or sit under ROADMAP's dated
  assessment snapshot; the README command table is set-equal to the built program's commands;
  SCHEMA's `architecture/permissions.yaml` example is parsed through the real vocabulary reader,
  pinning the documented `owned_by`/`enforced_by`/`description` spellings; every dotted backticked
  token in the shipped pages must be a stable code loam actually emits, a verify claim kind, or a
  reasoned allowlist entry; and each documented known gap is paired with the roadmap sentence that
  owns closing it, so shipping a roadmap item fails the gate until the gap prose leaves with it.
- No new command, flag, exit code, envelope key, or stable code; nothing in `dist/` changed.

### Added — the capability axis

- **New fleet document `architecture/capabilities.yaml`** — shape
  `capabilities: {<id>: {description, owner}}`, both leaf fields optional (`{}` is a legal
  declaration); ids are flat keys with `/` allowed for nesting (`payments/refunds` stays one key,
  never collapsed).
- **New requirement-grammar line `Capability:`** (also accepted as `Capabilities:`) — a
  comma-separated LIST, legal in both spec files, living and delta alike, parsed beside
  `Operations:`/`Covers:`/`Requires:` with the same keep-last quirk.
- **New stable finding code `capability.unknown`** (error) — a `Capability:` entry that the
  vocabulary does not declare, with close-name suggestions; graded on living spec.md/arch.spec.md at
  the service target and on a feature's deltas of both via coherence.
- **New IssueCode `capability.unknown`** — the delta-side shape of the same rule **gates
  `loam archive`** (not-coherent), overridable with `--approve`; the only new archive gate in this
  item.
- **New stable finding code `capability.invalid`** (error) — the file exists but does not read as a
  vocabulary; reported exactly once per `validate --all` run (single-target runs stay silent about
  the file), suppressing the rest of the family, because a hundred findings about one broken file is
  a cascade rather than a diagnosis.
- **New stable finding code `capability.unrealized`** (warn) — a declared capability no living
  non-`REMOVED` requirement names; one finding per capability, subject = the id.
- **`loam list capabilities`** — new explicit-only section (the no-argument default and every
  existing section's payload are byte-unchanged); new additive `--json` payload key `capabilities`
  with deterministic, diff-stable ordering (rows by id, `realizedBy` by service/file/requirement,
  `statuses` keys sorted).
- **`loam explore --capability <id>`** — new repeatable flag seeding the exploration from a declared
  capability's realizing services; every miss (undeclared, or declared and realized by nothing)
  lands in the new additive payload field `unresolvedCapabilities` — explore still refuses nothing.
- **`migrate-openspec --apply` preserves capability identity**: the staged target declares the union
  of living and active-horizon OpenSpec capability ids in `architecture/capabilities.yaml` (empty
  bodies — no description is invented, the authored `## Purpose` prose stays verbatim under
  `legacy/`), and every routed requirement — living, delta and rename-materialized alike — carries a
  `Capability: <id>` line.

### Added — subsystems: `services/` may now be a tree, and no identity notices

Nested directories under `services/` are now legal: a directory marked by a `subsystem.yaml` is a
**subsystem** and is walked, at any depth.
- **Three-way classification, the third branch a refusal.** A directory under `services/` holding
  `subsystem.yaml` is a subsystem (walked); one holding any service artifact is a service (not
  walked deeper); one holding **neither** while containing subdirectories is the new error
  `subsystem.unmarked`, naming every service stranded beneath it — those services stay enumerated
  and counted, so the fleet is never silently smaller (the deleted-marker merge race).
- **`subsystem.yaml` is a marker, not a manifest** — optional `title`, `description`, `owner`; never
  members (SCHEMA.md, "Subsystems").
- **The tree is mirrored into a GENERATED views file, never into the authored landscape.**
  `architecture/subsystems.likec4` holds LikeC4 views only — no model, no tags, no `specification` —
  one view per subsystem enumerating every service beneath it (members resolved to landscape
  *element* ids through the same `metadata { service }`-then-title join every check uses; a member
  nothing models is omitted, which `landscape.service-unmodelled` already reports). New fleet-scope
  error **`subsystem.views-stale`** in `validate --all`: the file's bytes do not match the tree —
  exactly one finding on exactly one file, graded by byte comparison (nothing in loam ever parses
  the generated file), fixed by the one command.
- **New command `loam subsystem <verb>`** — `new`, `move`, `rename`, `rm`, `list`, `history`,
  `sync`; options `--into`, `--under`, `--title`, `--description`, `--owner`, `--json`.
- **`loam subsystem move <name>... --into <sub|.>` is ONE transaction over N directory renames plus
  the generated views file** — the first consumer of the crash journal's new moves half.
- **`loam adopt --subsystem <name>`** — the brief's artifact paths land inside the named group, so
  an adoption need not land unfiled and cost a second command.
- **`loam list` gains additive `--json` keys**: `services[].subsystem` (the path as a string array,
  `[]` = unfiled), top-level `subsystems[]` (`name`, `path`, `title`, transitive `memberCount`) and
  `unfiledServices` (a count — unfiled is permanent and normal, so it is never a finding).
- **`subsystem move`/`rename` notice old snapshots.** When an archived feature holds a version-2
  snapshot addressing a directory being moved by its literal pre-move path, the move prints a notice
  (JSON: additive `warnings` key) naming the feature — `loam unarchive <FEAT> --force` after the
  move would restore into the old location, resurrecting the pre-move directory beside the moved
  one.

### Changed — archive snapshots are re-keyed by service id (manifest version 2 → 3)

The undo snapshot's manifest (`features/archive/<dir>/.loam-before/manifest.json`) bumps to
**version 3**: every entry under `services/` now carries `(service, artifact)` — the service id and
the artifact's path inside the service directory — beside the as-archived literal `path`, and
`loam unarchive` resolves the write target through the **current** services enumeration, falling
back to the literal path when the id is not enumerated.

### Added — the AsyncAPI feature lifecycle

- **File-format contract** (SCHEMA.md): a feature changes an async contract through
  `features/<FEAT>/specs/<svc>/asyncapi.yaml` — a complete AsyncAPI 3.0 document.
- **`loam rebase` pins asyncapi slots**: every slot a feature's asyncapi.yaml restates is pinned
  against the living contract; `rebase --json`'s `pins[]` entries may now carry
  `file: "asyncapi.yaml"` with `kind` = the section name and `target` = the slot key (new values in
  existing fields — no envelope key changes).
- **New validate finding `asyncapi.remove-marker-living`** (error): a living asyncapi.yaml carrying
  `x-loam-remove: true` — at ANY depth: a slot, an inline channel message, or anywhere else one
  leaked (the document root, `info`), the sweep exactly as deep as the strip — names where it sits,
  the `openapi.remove-marker-living` discipline on the event axis.
- **The coherence gate grades the event axis** (`validate --feature` and the archive gate alike,
  since the gate consumes coherence issues wholesale). Three strings validate already emitted joined
  the IssueCode union unchanged: `asyncapi.invalid` (now also fired for a FEATURE's own
  asyncapi.yaml, suspending that service's event checks and gating archive),
  `asyncapi.ref-unresolved`, and `spec-event.message-undefined` (now also graded on delta
  requirement lines in feature scope). **What a `--json` consumer notices.** The event axis grades
  two things that need no asyncapi.yaml at all: a feature delta's tagged edges carrying
  `metadata { publishes }` / `{ consumes }` (`c4-event.message-undefined`) and a delta requirement's
  `Publishes:`/`Consumes:` lines (`spec-event.message-undefined`).
- **The merge is verdict-driven, per slot** (`channels.<key>` / `operations.<key>` /
  `components.messages.<key>`): a pinned QUOTE is never a merge input — not even under `--approve` —
  so a change that landed on the living contract after the delta was written survives an archive
  that merely restates the slot (the lost-update case); an EDIT overwrites; a `stale` pin still
  writes, because reaching the merge at all means `--approve` said to, and the plan names what it
  cost.
- **New stable plan-warn codes**, each with a /loam-check fix-table row:
  `asyncapi.message-modified`, `asyncapi.channel-modified`, `asyncapi.operation-modified` — the
  delta redefines a slot the living AsyncAPI already has and the merge overwrites it wholesale, the
  event axis's mirror of `openapi.op-modified`'s family.
- **`asyncapi.ref-unresolved` is now also a gating plan issue** (it stays a validate warn on living
  contracts): a `$ref` the MERGED document would carry that resolves in neither the feature's
  asyncapi.yaml nor the living one — including a removal that deletes a slot the living document
  still references — refuses the archive at `not-coherent` unless `--approve`.
- **New gating plan code `asyncapi.remove-marker-inline`** (error, `--approve` overrides, with a
  /loam-check fix-table row): an `x-loam-remove: true` nested on an INLINE channel message
  (`channels.<ck>.messages.<mk>`).
- **`archive --json` gains the additive `asyncapiRemovals` key** (`[{service, slots}]`, the labels
  of living slots the plan deletes), beside `openapiRemovals`.
- **New verify claim kind `event.declares`** in `CLAIM_KINDS` (the `verification.yaml` value
  vocabulary), after `api.exposes` in the checklist's story order: one claim per genuinely NEW
  (direction, message) a feature's asyncapi delta declares relative to the living contract's
  send/receive sets — `"<svc> declares it <sends|receives> message '<name>'"`.
- **`delta --json` gains the additive per-service `events` key** —
  `{changes: [{slot, message, direction, remove}], unreadable, error?}`, the event-axis mirror of
  the `api`/`openapi` pair: every message declaration in the feature's asyncapi.yaml with the slot
  it lives in, the direction the document's own operations give it (`send`/`receive`/null), and its
  removal marker; the text view prints the same rows. **An unreadable feature asyncapi.yaml now
  makes `loam delta` exit 1** exactly as the openapi path does — the brief is an implementation
  task, and "no event work here" over a YAML error is work silently dropped.
- **`loam status` sees the event axis.** The feature artifact table gains an `asyncapi` row per
  touched service (additive `--json` value in the `ARTIFACT_IDS` vocabulary; never required — an
  event contract is genuinely optional, so absence is `done` like arch.spec.md), the `asyncapi.*` /
  `c4-event.*` / `spec-event.*` finding families now turn their responsible artifact row `draft`
  (asyncapi.yaml, delta.likec4 and the spec delta respectively), a feature whose findings include
  `asyncapi.baseline-missing` gets a `next.rebase` step naming `loam rebase`, and a blocked
  verification's `blockedBy` list names `asyncapi` among the feeders it waits on.
- **The authoring surfaces teach the axis**: `loam new`'s spec template comment documents the
  `Publishes:`/`Consumes:` requirement lines and when to hand-create `specs/<svc>/asyncapi.yaml`
  (nothing is scaffolded — the axis's absence-grading rests on the contract being optional), and the
  `/loam-feature` workflow carries the event-axis authoring step beside the openapi one, rebase
  pinning included.

### Changed — `validate --all` parses the fleet's C4 documents in one workspace

`loam validate --all` now parses the run's C4 documents — every service model, every active
feature's delta, and the landscape — in **one** LikeC4 workspace instead of spinning up one
workspace per document: measured **~18.8x faster** (13.7s → 0.73s median) on the committed
120-service benchmark, with peak memory roughly halved (docs/BENCHMARKS.md).

### Changed — a restated component or path-level key can no longer silently revert a landed change

The operation pin's discipline now reaches the two surfaces it deliberately did not: path-item
non-method keys (`parameters`, `servers`, `summary`, `x-*`) and every `components/<kind>/<name>`.
The merge skips quoted surfaces exactly as it skips quoted operations, and component copying is
verdict-driven: **archives that used to exit 0 while a restated component or path-level key
overwrote another feature's landed change now refuse until `loam rebase <FEAT>` runs or `--approve`
says the overwrite is meant.** `loam validate` moves with it: a feature whose delta restates a
path-level key or a component another change has since moved now fails where it passed, on the same
`openapi.baseline-stale`, before any archive is attempted.

### Changed — the architecture rules became one executable gate

- **New contributor gate `npm run arch:check`** runs every architecture check the design docs state
  — file-level import cycles, the package graph, the core→commands ban (named and type-only imports;
  a bare side-effect or dynamic import is not seen), the barrel ban, the console/process boundary
  with `core/envelope/json.ts` as the one named exception, the child-process timeout/`maxBuffer`
  policy, and brand-cast containment — each with a negative self-test in `test/arch-gate.test.ts`.
- **Under `--json`, an unreadable loam.json no longer prints a stray line on stderr.** The
  `config-invalid` envelope message now carries the actual parse problem (stdout stays the single
  machine-readable stream); in text mode the same sentence prints from the command layer.
- **`loam verify --record`'s git questions are bounded** — a 10-second deadline whose refusal says
  the deadline fired (a blocking credential helper used to hang the record forever), and a
  deliberate 64 MiB output cap in place of Node's implicit 1 MiB that refused sound evidence over 1
  MiB.
- **Validated identities are branded types end to end.** Feature ids, docs directories and feature
  directories join service ids: the smart constructors in `core/kernel/ids/` are the only bridge,
  the path builders in `core/repo/paths.ts` refuse raw strings at compile time, and `arch:check`
  fails a brand cast outside the constructor modules.

### Changed — every multi-file writer now commits through a journaled, crash-consistent transaction

`loam archive` and `loam unarchive` have long committed through a lock, a byte-level
compare-and-swap, a snapshot and a fsynced `.loam-commit` journal.
- **`loam rebase`** journals its pin writes.
- **`loam vouch`** now takes the docs lock for its commit window (the roadmap called this lock
  missing) — the slow half, reading specs and hashing sources, stays unlocked so independent
  services' vouches do not serialise — and journals the spec.md/arch.spec.md pair.
- **`loam new`** builds its entire scaffold in memory, then commits it under the lock as one set of
  exclusive creates.
- **`loam gherkin`** — the writer the roadmap named, a plain write/delete loop in the service repo —
  commits through staging, the lock and the journal at **`<gherkinDir>/loam/.loam-lock`** /
  **`.loam-commit`**, two new transient dotfiles in the directory loam already owns.
- **`loam verify --record`** recovers (or refuses **`commit-interrupted`**) under its held lock
  before the authoritative read — the last docs-repo writer that could still silently write over a
  half-commit.
- **`loam validate` leads every mode with the new error finding `docs.commit-interrupted`** while a
  `.loam-commit` sits in the docs repo: a half-merged tree graded green would certify bytes no run
  produced, and in CI that green merges.
- **`loam doctor` covers the service repo too:** when loam.json names a service, the same residue
  scan runs over `<gherkinDir>/loam/` and grades with the same `doctor.docs-locked` /
  `doctor.commit-interrupted` / `doctor.commit-unreadable` / `doctor.staging-temps` codes; the
  report gains an additive `serviceWritePath` key.
- **Recovery is reported, not silent:** any journaled writer that first rolls a predecessor's commit
  forward carries an additive `recovered` key in its `--json` payload and says so in the human view
  — docs changing beyond the command's own writes would otherwise read as its doing.
- **`recovered.feature` and `status`'s `interrupted.feature` no longer always name a feature.** When
  the journal being recovered was left by `loam vouch` or `loam gherkin`, the field holds the
  **service** id those commands were committing for, and `recovered.command` / `interrupted.command`
  can now read `rebase`, `vouch`, `new` or `gherkin` where they only ever read `archive` or
  `unarchive`.
- **`loam doctor --json`'s `writePath.intent` now has two shapes.** A journal from the smaller
  transaction reads `{version: 2, command, rerun, target, …}` — no `feature`, and each file carries
  the staged `tmp` beside its digests.
- **`loam gherkin --dry-run` recovers before it plans** — archive's own dry-run precedent.
- A journal written by this loam and found by an older one grades as `doctor.commit-unreadable`
  (fail-safe, human-directed) — worth knowing where fleets pin loam per repo.

### Changed — recording a verification is now atomic, locked, and compare-and-swap

- **`loam verify --record` / `--results` takes the docs repo's advisory lock and commits the record
  atomically.** The record used to be one plain `writeFile` from an unlocked read, which lost work
  three ways: two services recording one feature concurrently could read the same pre-image and the
  last writer silently discarded the other's attestation; a process killed mid-write left the only
  record truncated (and every later `--record` refusing on `record-unreadable`); and an edit landing
  between the read and the write was buried. A kill mid-record leaves the previous record whole plus
  a staging temp that `loam doctor` already names under its write-path residue.
- **The git questions `verify --record` asks now have a deadline and an output cap.** Every `git`
  call on the record path (`rev-parse`, `diff`, `show`) runs while the docs lock is held, and none
  of them was bounded: a git blocked on a credential-helper prompt hung the record forever with the
  lock in hand, wedging every `archive`, `rebase` and other `--record` in the fleet behind a live
  pid that stale-lock breaking rightly refuses to touch.
- **A staging failure while recording answers `merge-failed`, not `internal`.** A read-only feature
  directory or a full disk at the staging step escaped as the one code with no stable meaning; it is
  now the same refusal archive gives the identical condition — nothing was recorded, the record is
  as the last writer left it.
- **`loam doctor` grades a `.loam-lock` that cannot name its holder as damage, and exits 1 where it
  exited 0.** An empty or unparseable lock file — what a crash inside a lock create used to leave,
  or an editor's accident — got the warning "wait for it to finish", advice that can never work:
  stale-lock breaking rightly refuses to interpret a lock it cannot read, so nothing was ever going
  to release it while every writer refused `docs-busy` forever. **What a `--json` consumer
  notices:** the finding keeps its `doctor.docs-locked` code but arrives with `severity: "blocker"`,
  so `healthy` is `false` and a preflight that passed over such a lock now fails.
- **A `verification.yaml` that is a symlink to a target that does not exist now refuses
  `record-unreadable`, naming the broken link.** The read side used to call it absent while the
  commit's exclusive create saw the link itself and refused — so every `--record` answered
  `record-raced` with advice (re-run) that could never work.

### Changed — the OpenSpec compatibility baseline moves to v1.9.0, and the gate that backs it runs again

- **`audit-openspec` and `migrate-openspec` now report v1.9.0 as the certified release baseline.**
  The banner line and `baselines.release` under `--json` carry `1.9.0` /
  `2826b8889e5223a9a8095d4428b60b56597e1020` (2026-08-13, and the tip of `main` when pinned) instead
  of `1.7.0` / `4e16790`.

### Fixed

- **The OpenSpec corpus gate had not run for eight days: it failed at module resolution, not at a
  corpus.** `scripts/check-openspec-corpus.ts` imported `../src/core/spec.js`, which moved into
  `src/core/document/` when core's leaves became packages, so every scheduled and manual invocation
  died with `ERR_MODULE_NOT_FOUND` while three documents pointed at it as the evidence for the
  compatibility claim.

### Documentation

- Added the evidence-backed `ROADMAP.md`, updated the product comparison to OpenSpec v1.9 while
  preserving the exact v1.7 compatibility baseline, documented
  AsyncAPI/authorization/response-governance joins, and reconciled release, pilot, contributor,
  security and generated-agent guidance with the implemented contracts.

### Added — the decision layer gets somewhere to live: outlines, an authorization vocabulary, and a walk that asks for both

- **A markdown table in a scenario body is now a `Scenario Outline`.** `loam gherkin` emits the
  table as `Examples` — one row per case, columns padded, deterministic to the byte — instead of
  dropping it into the scenario description where cucumber ran it as one vacuous scenario.
- **`architecture/permissions.yaml` — the fleet's authorization vocabulary — and the `Requires:`
  line that joins to it.** A third spine beside `Operations:` and `Covers:`, because neither can
  carry a permission: the cardinality is wrong for an operation, a permission is not a C4 element,
  and OpenAPI's `security` carries permission NAMES only for oauth2/openIdConnect — the spec
  requires an empty scope array for `http bearer` and `apiKey`, which is what most of a legacy fleet
  authenticates with. Three codes: **`permissions.unknown`** (error — an entry the vocabulary does
  not declare; an ERROR where its `Covers:` sibling is a warning, because an invented permission
  reads exactly like a real one in the requirement, in the generated scenario and in the test
  somebody then writes from it), **`permissions.invalid`** (the file exists and does not read as a
  vocabulary — reported alone, since grading every `Requires:` line against it would be a cascade
  rather than a diagnosis), and **`permissions.unenforced`** (warn — a declared permission no
  requirement anywhere in the fleet names, the mirror of `api.ungoverned`).
- **`api.response-ungoverned` (warn) — a declared 4xx/5xx response no scenario reaches.**
  `api.ungoverned` grades whole OPERATIONS against requirements, so an endpoint with one happy-path
  requirement and twelve declared failure codes was fully governed by every check loam had — and the
  refusals are precisely where a service's decision layer surfaces.
- **`sources` is described as digest input rather than a reading list.** Nobody follows those paths
  and nothing asks them to — the value is that `vouch` hashes their content so a later `validate`
  can say the code moved.

### Fixed

- **An optional `arch.spec.md` could refuse an entire `--all` run.** The new fleet-wide `Requires:`
  sweep read both requirement documents of every service without checking existence first, and
  `FleetContext.readRequirements` throws ENOENT — which surfaced as `repository-unavailable` with no
  targets and nothing validated.

### Changed — three archives that used to exit 0 now refuse, because each one was a silent loss

- **Unpinned deltas gate the archive.** `delta.baseline-missing` and `openapi.baseline-missing` keep
  their warn severity — `loam validate` stays green, the documents are legal — but both now carry
  `gates`, so `loam archive` (dry run included) refuses instead of merging.
- **A scaffold nobody edited cannot archive.** Two new gating warnings from
  `loam validate --feature`, `loam status` and the archive gate: **`scaffold.placeholder`** — a
  feature document still carries `loam new`'s exact template text (a `TODO — name the behaviour`
  requirement, a `TODO — name the case` scenario, an `<angle-bracket>` fill-in, a
  `TODO — what this service owns` description) — and **`intent.empty`** — intent.md is missing or
  says nothing outside the scaffold's own comments.
- **A feature's own broken openapi.yaml is now named.** `validate --feature` reports
  **`openapi.invalid`** (error — the same code the living contract gets) when a feature's
  `specs/<svc>/openapi.yaml` exists but does not parse, and suspends the service's contract-axis
  checks instead of grading against the empty parse — which used to skip every baseline pin and
  removal marker in the broken file silently and false-fire `spec-api.op-undefined` against
  requirements whose operations the unreadable file defined.

### Fixed — the fleet map's containers are visible to the checks that guard removals and ordering

- The element→service resolver was called without the enumerated fleet in exactly the places that
  are repository-aware: the removal gate's consumer scan, the feature dependency graph, coherence's
  edge grading, arch coverage and its `Covers:` matcher, the verify checklist, and `loam delta`'s
  projection.

### Fixed — edge metadata loam parsed but did not keep

- **`loam archive` dropped an event binding at exit 0.** What makes two C4 edges the same edge
  accounted for `metadata { op }` and ignored `metadata { publishes }` and `metadata { consumes }`
  entirely.

### Added — fleet-shape and contract-depth checks

These checks are specified with repository-owned synthetic docs fixtures and compare artifacts loam
already parses.
- **`landscape.platform-candidate` (warn)** — an `#external` element consumed by three or more
  distinct services and not tagged `#platform`.
- **`landscape.datastore-private` / `landscape.datastore-shared` (warn)** — a fleet-level `database`
  element graded by its consumer count.
- **`c4.no-relationships` (warn)** — a parsed model with elements and zero relationships, when its
  own evidence says it should reach something: more than one nested element, or dependencies
  declared in this service's health.yaml.
- **`health.dependency-unmodelled` (warn)** — every `dependencies:` id in health.yaml must resolve
  in the service's OWN `model.likec4`, by element id, `metadata { service }` binding, or title
  (exact match, did-you-mean hints, no case folding).
- **The contract-depth probes** — form validated and depth did not: an operation whose one response
  is `description: OK`, a message whose payload is bare `type: object`, and a `$ref` to a schema
  nobody wrote all validated exactly as cleanly as complete contracts. Four warns close it:
  **`openapi.response-undescribed`** (no response declares a schema while at least one should —
  204/304 excepted), **`asyncapi.payload-undescribed`** (a payload declaring no shape at all; a
  non-JSON `schemaFormat` is never judged, so the Avro migration stays a document change), and
  **`openapi.ref-unresolved` / `asyncapi.ref-unresolved`** (internal `$ref`s to nothing — on the
  async axis these used to vanish silently).
- **`spine.message-external` (warn), and `spine.message-unproduced` narrows to mean what it says** —
  a message produced outside the fleet was inexpressible: the landscape said the producer was
  `#external` and the error fired anyway, so a truthful map cost a red build and the exit ramp was
  deleting the link.

### Changed — the adopt protocol makes deployment evidence boundaries explicit

- **The reproducibility bar is stated**, beside the honest half: `loam validate` grades form and
  joins, never depth, so green means the files agree with each other — and `unchecked[]` now says
  nothing measures a shallow baseline against the service.
- **`api.covered` carries both counts** — operations governed and living requirements — because the
  ratio is the one signal that lets a reviewer smell a thin baseline from the summary line.

### What a `--json` consumer notices, upgrading to this release

- **Repos that were green can newly show warnings** — the eight codes above, plus `agents.stale`
  from the version bump itself (and this time the AGENTS.md review is real work: the code tables
  materially changed). `valid` stays true and plain exit codes stay 0, but **a `--strict` CI job
  that exited 0 yesterday can exit 1 today**. A freshly migrated OpenSpec repo now reports
  `openapi.response-undescribed` as its honest state — OpenSpec never carried response schemas.

- **One red case turns green**: a consumed message whose only producer is an `#external` `publishes`
  edge no longer errors. Fleets that took the old exit ramp — deleting the link to get green — get
  no signal to restore it; re-add the edge and the consumption, the map is allowed to be truthful
  now.

- **`landscape.matched` no longer appears** on a fleet where any fleet-shape warning fires — a map
  with a shape warning did not fully agree.

- No envelope keys changed shape; the new findings ride the existing `findings[]`/`details`
  contract, and prose (including `api.covered`'s message) was reworded freely as always. A feature's
  per-service deltas live in `features/<FEAT>/specs/<svc>/`, and that `<svc>` is a directory name
  somebody typed — but unlike `--service`, nothing ever asked the id grammar about it.
  `specs/Payment Service/` (with the space) validated green —
  `✓ Payment Service: requirements covered`, even, because a tagged element whose *title* matched
  the directory counted as introducing the service — and `loam archive` then exited 0 and
  materialised `services/Payment Service/`. The very next `loam validate --all` failed it with
  `service.id-invalid`: a directory loam itself wrote, and one no loam command can address or
  re-create. New finding: **`delta.service-id-invalid`** (error), from `loam validate --feature`,
  `loam status`, and the archive gate, naming the `specs/<svc>/` directory and the exact rule the
  name breaks — the same sentence `service.id-invalid` uses, Windows-reserved stems (`NUL`) and
  trailing dots (`payments.`) included. `loam archive` refuses on it before anything joins the name
  into a path, `--dry-run` included, and **`--approve` does not override it**: which service you
  meant is a judgment call, but a name the grammar refuses is a directory loam can never address,
  mechanically. The fix is a rename of the specs/ directory. The same guarantee on the architecture
  axis. A tagged element's explicit `metadata { service '…' }` binding is a name the landscape merge
  splices into the living `architecture/landscape.likec4` verbatim, and the archive probes
  `services/<binding>/` with it — `metadata { service '../outside-svc' }` parses in LikeC4 without a
  single error, validated with nothing but a warning, archived at exit 0, and the `../` collapsed
  the probe right out of `services/`. The next `validate --all` then failed the very map archive had
  just written (`landscape.binding-unknown`). New coherence issue: **`c4.service-binding-invalid`**
  (error), from `loam validate --feature`, `loam status`, and the archive gate, naming the element
  and the rule its binding breaks; **`--approve` does not override it either**, for the same reason.
  The check's scope is the splice's, not the tag's: the merge carries a tagged element's authored
  block into the living landscape byte for byte, untagged children included, so an untagged
  `container` nested inside a tagged system — `metadata { service '../outside-svc' }` on the child —
  is held to the same grammar, because its binding reaches the living map exactly as its parent's
  does. A prose title with no binding stays legal C4 — a title becomes a path only through
  `specs/<svc>/`, which the finding above now guards. Together the two codes close every text→path
  route into the archive merge. **What a `--json` consumer notices.** `loam validate --feature` can
  now exit 1 on repos that used to pass, with `delta.service-id-invalid` or
  `c4.service-binding-invalid` in `findings[]` — and the same two findings reach
  `loam validate --all` and the bare positional `loam validate <FEAT>`, which grade every feature
  through the same check: a repo that exited 0 yesterday exits 1 today, and a CI job running
  `validate --all` fails naming the feature. The fix is renaming the `specs/<svc>/` directory or
  editing the `metadata { service }` binding, never a flag. `loam archive` refuses both with the
  envelope code `not-coherent` and the offending finding in `issues[]`, whether or not `--approve`
  was passed; a refusal `--approve` cannot move now also says "--approve does not override this" in
  `error.message`, and every issue `archive --json` emits (`issues[]`, `warnings[]`, `overridden[]`)
  carries a new additive `overridable` key — whether `--approve` can move it — so a consumer
  branches on data instead of keeping its own code list. One ordering change rides along: the
  illegal `specs/<svc>/` name is refused ahead of the conflict-marker scan, so a feature carrying
  both defects reports `not-coherent` where it used to report `merge-failed`. A `services/<bad>/` a
  previous archive already created is repaired by renaming — the `service.id-invalid` message spells
  the three places the old name is written.

### Fixed — coherence grading resolves an edge's target before it builds a path

The coherence check behind `loam validate --feature`, `loam status` and the archive gate joined an
op-edge's *declared* target — the element's `metadata { service '…' }` binding, or its title —
straight into `services/<target>/` to read the living spec, the living OpenAPI and the deprecation
flags. **What a `--json` consumer notices.** Nothing, unless a feature's delta declared a target
that never matched a `services/` or `specs/` directory *and* the joined path landed on a real file:
those repos can newly see `c4-api.op-undefined` (error, gates archive) and `c4.op-ungoverned` (warn)
where the out-of-repo file used to satisfy the check.

### Fixed — `loam validate` resolves a service name before it builds a path

`loam validate --service <name>` and `loam validate <name>` both spelled
`<docsDir>/services/<name>/` out of whatever the caller typed, and neither ever checked it.
`loam validate --service ../../outside/services/x` therefore resolved **above the docs repo**, and
where a `spec.md` happened to sit at that path loam opened it, graded it, and reported its
frontmatter back through `--json`.

### Added — `loam adopt` states the walk, and `validate` grades it

- **`walk[]` in the brief** — nine ordered stops, each naming what to open, what to take from it,
  and which artifacts it feeds (`lands`).
- **`sources.unwalked` (warn) / `sources.walked` (ok)** — the walk graded against the repository,
  reported by `loam validate --service <id>` run inside the service's own repo.

### Added — how to draw a shared broker, before the fleet map becomes a star

A broker modelled as ONE element is the node every service in the fleet points at: a map that read
fine at five services is a star with sixty spokes at sixty, and nothing warns on the way there,
because loam parses the model and renders no view.

## [0.1.0-beta.3] - 2026-08-08

Still a prerelease under the `beta` dist-tag; the 5–10 service pilot has not run yet. The entries
below describe implementation behavior and repository-owned synthetic fixtures; they claim no
production-fleet or external execution evidence. One breaking change, in `loam vouch`; read that
section before upgrading a CI job.

### Changed — `loam vouch` now records a person, and refuses when it cannot

**This is a breaking change for any script or CI job that runs `loam vouch`: add `--yes`.**

`vouch` is the one command in loam whose output is a claim about a human act — everything else it
checks is internal consistency, which fluent prose satisfies on its own. Its own docblock called it
"the one command that records a person", and it recorded none: no identity of any kind, no
interactive gate. Run twice, unattended, from a script, it stamped `status: verified` both times.
Meanwhile every generated command and skill file pre-approved `Bash(loam:*)`, which handed the agent
that wrote a draft the power to promote its own draft. That inverts the argument loam makes about
test evidence everywhere else — an agent must not be able to *say* a scenario is tested — by letting
one say a spec matches the code.

Three changes close it, and none of them is a signature:

- **`vouched_by` is stamped beside `status` and `last_verified`**, taken from git —
  `GIT_COMMITTER_*`/`GIT_AUTHOR_*` first and then `user.name`/`user.email`, which is git's own
  precedence, so a CI job and a laptop resolve it the same way. It is a name, not a proof: git
  config is a text file. What it buys is that a reviewer can ask a *specific person* what they read,
  which is the question `status: verified` was silently answering with nobody. It rides `--json` as
  `vouched_by`, and a re-vouch refreshes it.
- **`--yes`, and a confirmation when there is a terminal.** Without `--yes`, `vouch` refuses
  `vouch-unattended` when stdin is not a TTY, and in `--json` mode regardless (a question cannot be
  asked on a stream whose contract is one JSON document). On a terminal it states what is about to
  be claimed and takes only an explicit yes; `vouch-declined` is the answer when the person says no.
  `vouch-unattributable` is the refusal when git can name nobody at all — better than stamping an
  anonymous claim.
- **The generated `allowed-tools` allowlist names loam's verbs one by one** —
  `Bash(loam adopt:*), Bash(loam validate:*), …` — and deliberately not `vouch`. A verb missing from
  the list is not forbidden, only unapproved: the agent asks, and a person answers. That is the
  correct cost for this one, and it is what makes the refusal something a human sees rather than
  something an agent routes around.

New error codes: `vouch-unattended`, `vouch-unattributable`, `vouch-declined`. Existing specs
carrying `status: verified` with no `vouched_by` are not re-graded — nothing new fires on them — but
the next vouch stamps a name.

### Fixed — a docs repo that could be cloned, and rendered

- **`loam init --create` writes `services/.gitkeep` and `features/.gitkeep`.** Both directories were
  created empty; git tracks files, not directories, so after the first push neither existed for
  anyone who cloned. A missing `services/` is a *blocker* in `doctor`, so the second person to touch
  the repo got a red preflight on a repository the first person left green.
- **`loam init --create` writes `likec4.config.json`, and the docs repo is a loadable LikeC4
  workspace again.** loam parses every `.likec4` file *alone*, so the landscape, each
  `services/<id>/model.likec4` and each `features/<FEAT>/delta.likec4` legitimately declares its own
  `specification { … }` block and re-declares the elements it names. LikeC4's own loader merges the
  whole tree into one model, so pointing `npx likec4 start` at the repo root — the command loam's
  own brief recommends — reported every one of those declarations as a duplicate: on loam's
  four-file `examples/docs`, 16 errors from the renderer and 0 from `loam validate --all`. The
  scaffolded config declares the root as one project scoped to `architecture/`; a service model or
  feature delta renders from its own directory (`npx likec4 start services/<id>`), which is what
  parsing them in isolation meant all along. `doctor` reports `doctor.likec4-config-missing`
  (warning) on a docs repo created before this, with the exact file to write in its `fix`.

### Fixed — three commands that answered the wrong question

- **`loam status` now sees the repository it is standing in.** With `loam.json` naming a service the
  docs repo has no directory for — a freshly wired service repo, the most common repo there is — the
  fleet count made "nothing is in flight and every service is written down" vacuously true, and
  `next.fleet-clean` came out on top. `doctor` had the right answer (`doctor.service-unknown`) at
  the same moment, and the documented agent loop reads `status --json` and runs `next[0]`: an agent
  following it was sent to start a feature instead of adopting the service under its feet. The new
  step is **`next.adopt-bound`**, first in `next[]` (behind only `next.recover-commit`), and
  suppressed under an explicit `--service`, which is a question about a different service.
- **`doctor.service-unbound` is no longer raised inside the docs repo.** Having no service binding
  there is the correct state — the docs repo is the fleet, not any one service — and the `fix` it
  printed (`loam init --service <id>` here) would have made the repo wrong. `currentService` still
  reports `unbound`; only the advice is gone.
- **`loam instructions` checks the arguments it substitutes.** `loam instructions loam-adopt "$PWD"`
  rendered a protocol reading `services//Users/someone/work/svc/` — a page of confident instructions
  built around a value no loam command accepts. Each workflow now declares what its `$1`, `$2`, …
  stand for, and a service-id or feature-id placeholder is checked against the same grammar
  `loam adopt` and `loam new` use before anything is printed (`invalid-option`). An *unsupplied*
  placeholder is still left standing, and a free-text one (a feature title) is still free.

### Fixed — `doctor.agent-files-stale` and `agents.stale` across a prerelease

`versionTrails` compared only the numeric triple, so `0.1.0-beta.1` neither trailed nor outranked
`0.1.0-beta.2`. But beta.2 is precisely the release that changed the *form* of every generated file
— embedded protocol text became a pointer at `loam instructions` — and its own changelog told
readers to delete the files and re-run `loam init`. The one upgrade that most needed the warning was
the one bump shape that could never raise it. Prerelease identifiers are now compared per semver:
numerically where they are numbers, a prerelease behind its own final release, and a longer
identifier list ahead of a prefix of itself. A stamp whose version is not valid semver still reads
as no stamp at all, unchanged.

### Added — the async contract axis (AsyncAPI 3), phase one

Kafka was already drawable in the fleet map and describable in prose, and that was all: a
`paymentService -> kafka 'Publishes PaymentAuthorized'` edge read as fully documented while naming
no contract anybody could check. The event axis gives it the treatment the HTTP axis has — an
artifact, a join token, and findings — in a first slice that reads and grades but does not yet
merge.

- **`services/<svc>/asyncapi.yaml`** — the async contract, sibling of `openapi.yaml`, optional and
  adopt-seeded. **AsyncAPI 3.0 only**: its operations are named top-level objects carrying
  `action: send|receive`, which is the exact analog of an `operationId`, where 2.x spells the same
  thing as `publish`/`subscribe` under a channel and leaves whose perspective they take ambiguous. A
  2.x document declares no `operations` and reads as a contract with no messages rather than as a
  mis-parsed one. No new runtime dependency: the document is read with the `yaml` parser already
  present, by the same shallow structural walk `core/openapi.ts` uses.
- **The join token is a message name**, spelled three times and required to be identical: a
  landscape edge's `metadata { publishes '...' }` / `metadata { consumes '...' }`, a requirement's
  `Publishes:` / `Consumes:` line, and the message's `name` in `asyncapi.yaml` (its declaration key
  when it has no `name`).
- **loam never reads inside a message's `payload`.** It joins on names and on the `action` of the
  operation carrying them, and nothing else. Write payloads as JSON Schema; a fleet that later
  adopts Avro changes a `schemaFormat` line in its documents and nothing in loam. Keep payloads
  inside the document rather than `$ref`-ing an external `.avsc` — external references are out of
  scope here exactly as on the OpenAPI axis.
- **New finding codes**, all from `loam validate --service <id>`: `service.no-asyncapi`,
  `asyncapi.invalid`, `asyncapi.duplicate-message`, `spine.message-undefined`,
  `spec-event.message-undefined`, `spine.message-unproduced`, `asyncapi.message-contested`,
  `event.messages-unlinked`, and the `ok` confirmation `event.covered`. No existing code changed,
  and no refusal that used to succeed now fails: every one of these fires only on a file or a
  `metadata` key that did not exist before this release.
- **`spine.message-unproduced` is the check with no HTTP analog**, and it is why the axis exists. On
  the API axis the provider owns the contract, so "does this operation exist" is answered inside one
  service's directory. An event's schema lives in the *producer's* repository, so "does anybody
  publish what I consume" is a fleet question — and a consumer joined to nothing was previously
  indistinguishable from a healthy one. `asyncapi.message-contested` is its other half: two services
  claiming to send one name means every consumer's join picks one arbitrarily.
- **`service.no-asyncapi` has two grades, not three.** Its `service.no-openapi` sibling warns when
  the landscape cannot prove nobody calls a service, because most services expose HTTP. An event
  contract is genuinely optional and most services touch no topic, so the absent file is an
  **error** when something already joins into it — the stranded message names ride in `details` —
  and **silence** otherwise.
- `asyncapi.yaml` presence rides in `loam list`/`loam show` (`has.asyncapi`, and a lowercase `e` in
  the text flags, beside the arch spec's `a`). It is deliberately **not** part of the maturity
  ladder: making it a fourth required artifact would demote every already-`documented` service in
  the fleet without one byte of their files changing.

**Not in this slice, and stated so nobody reads the absence as a bug:** a feature cannot yet add a
message. There is no `features/<FEAT>/specs/<svc>/asyncapi.yaml`, no merge, no baseline pin, and no
`verify` claim on this axis — a message is retired, for now, by editing the living contract in a
reviewed PR. Deprecation markers and a removal family are deliberately absent rather than pending:
an async contract that only ever grows has nothing to mark, because a consumer reading a topic with
lag breaks on a removed field regardless of what the document says about it.

## [0.1.0-beta.2] - 2026-08-07

Still a prerelease, still under the `beta` dist-tag: the 5–10 service pilot has not run yet, and
this release changes what `loam init` leaves in a repository, which is exactly the kind of thing a
pilot is for. Two new commands, that change to the generated files, and a code-quality pass over
`src/` with the defects it turned up. The refactoring half is invisible by construction; what
follows is only the part a user can observe.

### Added

- **`loam explore [<service>...]`** — read the fleet around a change nobody has written down yet,
  and write nothing. It answers the one question `loam new` takes as an argument: which services a
  feature touches. For each seed it reports the ring one hop out in the fleet map, each service's
  maturity rung and living operations, who already calls whom, the active features already covering
  the same services, and the literal `loam new` line the seeds imply. `--op <operationId>` seeds
  from an operation when you know the call but not who owns it; `--as <FEAT>` names the feature in
  the suggested line. A seed naming no `services/<id>/` is reported with its near-misses rather than
  refused — a feature may be introducing that service, and a typo looks identical until you read the
  list. The neighbours are deliberately **not** folded into the suggested command: loam knows those
  services are connected, not whether you change them.
- **`loam instructions [<workflow>] [args...]`** — print one of the six workflow protocols
  (`loam-adopt`, `loam-feature`, `loam-implement`, `loam-check`, `loam-verify`, `loam-ship`) with
  `$1`, `$2` filled in from the arguments given. With no argument it lists them. It is the only
  command that reads no `loam.json` and no docs repo, deliberately: `loam-adopt`'s own first step is
  to run `loam init` when there is no config, so it cannot be the step that requires one.
- **[WORKFLOW.md](WORKFLOW.md)** — the working protocol as a document: the artifact graph and its
  five derived states, what actually gates and what only advises, the six workflows, how an agent
  drives the cycle from `--json`, and why there is no task-list artifact.

### Changed — what `loam init` writes into a command or skill file

- **A generated file is now a pointer at `loam instructions`, not a copy of the protocol.** It
  carries the workflow's purpose and its spine — the verbs, in order — and defers this release's
  flags, finding codes and fix tables to the binary; a fresh `.claude/commands/` drops from about 53
  KB to about 11 KB, and the finding-code tables move with it. The protocol itself is unchanged and
  complete; only its delivery moved. The reason is that the two go stale in opposite directions and
  only one is fixable: loam never regenerates a generated file (your edits outrank the template, and
  that is not changing), so a protocol copied into a repository will eventually describe a different
  loam with total confidence, while a pointer cannot. `doctor.agent-files-stale` still reports a
  file whose version stamp has fallen behind, and now has almost nothing to be wrong about.
- **Nothing rewrites an existing file.** A repository scaffolded by an earlier loam keeps exactly
  the files it was given, full protocol text and all — re-running `loam init` over it leaves them
  byte-unchanged. The version stamp is how you tell, and `loam doctor` raises
  `doctor.agent-files-stale` against them only once this binary's stamp is ahead of theirs. To take
  the new form, delete the files and re-run `loam init`.
- Both new commands reuse the existing refusal codes (`invalid-option`, `unknown-target`). No stable
  code was added, changed or removed.
- **The feature-id grammar has one home.** It was spelled privately in `loam new` and again in the
  OpenSpec migration; `core/ids.ts` owns it now, so an id one command accepts cannot be an id the
  other refuses. The only user-visible edge is wording: `migrate-openspec`'s
  `mapping.feature-id-invalid` message now ends with the same "e.g. FEAT-101 or BUG-42" example
  every other refusal gives. The code is unchanged.

### Fixed — commands that wrote or attested on evidence they had not checked

- **`archive` no longer installs an unreadable feature contract as the living one.** A feature
  `openapi.yaml` that does not parse as an OpenAPI document was planned verbatim into
  `services/<svc>/openapi.yaml` and reported `ok: true`; every other command reads `readOpenapi`'s
  `unreadable` flag, and the one that writes was the one that did not. It now refuses with
  `merge-failed`, naming the file. The same code now answers when the contract is being created
  rather than merged — that case used to escape as `internal`.
- **`verify --record` no longer attests when it could not check the report.** The committed-report
  binding check tested for git's exit code 1 and nothing else, so a `git diff` killed by a signal —
  a CI timeout, the OOM killer, a fork failure — skipped the check and wrote the attestation anyway.
  A run that cannot reach an exit status is now a refusal that says git could not be run to
  completion.
- **An interrupted `archive` can be retried on a docs repo composed of symlinks.** Checking whether
  the snapshot was stale resolved the manifest's paths through a symlink test meant for writes, so a
  `services/<svc>/` mounted from a sibling checkout — a layout every walk of the repo follows on
  purpose — turned every retry into a permanent refusal. That check only reads a file and compares a
  digest; containment is now judged without resolving the mount. `unarchive`, which writes the
  pre-image back, deliberately keeps the stricter test.
- **A malformed `.loam-before/manifest.json` or `.loam-lock` is answered, not assumed.** Both were
  read through a cast: well-formed JSON that was not an object slipped past as "a different loam",
  and a bare `null` threw a `TypeError` out of the refusal itself. They now answer
  `commit-interrupted` and `docs-busy` respectively — the codes that case always deserved.
- **A `spec.md` whose bytes are UTF-16LE is refused on the write path.** The write path's UTF-8
  guard was a weaker copy of the read path's and missed exactly the file the read path had been
  hardened against: such a document parsed as zero requirements, so a merge computed over an empty
  baseline and wrote that back.

### Fixed — user errors reported as `internal`

- **`list`, `show` and `validate` report `repository-unavailable`** where a filesystem failure
  carries no path — a directory where `spec.md` belongs reports EISDIR with no `path`, which
  defeated the guard. `status` had this fix; the other three copies of the same catch block did not.
- **`loam.json` that cannot be read reports `config-invalid`.** The read sat one line above its own
  `try`, so a config file that was a directory, or carried a restrictive permission bit, crashed
  every command in the CLI.
- **`loam new` refuses instead of scaffolding into a directory that is not a docs repo**, and
  **`loam adopt` refuses (`docs-missing`)** instead of briefing an agent to write a baseline into a
  docs repo that does not exist. Both previously exited 0.

### Fixed — checks that answered differently depending on where they were asked

- **A relocated operation grades the same under `validate`, `status` and `archive`.** `FleetContext`
  carried a second implementation of `serviceOperationIds` that interleaved removals with upserts,
  so an operation removed at one path and defined at another answered "undefined" or "defined"
  depending on which the author spelled first — and `spec-api.op-undefined` is a gating error.
- **`c4.op-ungoverned` joins per service.** Operation ids are unique only within a contract, so an
  operation governed on one service suppressed the warning for an unrelated service that shared its
  name.
- **`api.covered` no longer counts a REMOVED requirement as governing.** An operation whose only
  governing requirement was removed now reports `api.ungoverned` (a warning; nothing about gating or
  exit codes changes).
- **`loam status` (fleet form) reports `blocked` for a repo holding an interrupted commit journal**,
  agreeing with the per-feature form, which already did. It previously said `done` and "ship it"
  over a tree the other form called blocked.
- **`loam delta` exits 1 when the feature's `openapi.yaml` does not parse**, matching the rule the
  architecture axis already had, and its `--json` payload carries an `openapi` key saying so. An
  unparseable contract used to project as "no operations".

### Fixed — deletion that reached outside the repository

- **`loam gherkin` orphan cleanup no longer follows a symlinked directory out of the repo.**
  Enumeration follows symlinks by design, so a planted `<gherkinDir>/loam/sub -> /outside` produced
  orphan paths that `unlink` resolved and deleted elsewhere. A symlinked `.feature` sitting directly
  in `loam/` is still removed — the link goes, its target survives — which is the distinction the
  guard now draws.

### Changed — internal structure

No behaviour depends on this, and it is recorded because the next contributor will notice it: the
eight runtime import cycles in `src/core/` are gone, five helper modules were extracted from the
modules that happened to hold them (`document-bytes`, `records`, `steps`, `concurrency`, and the
docs-repo gate), and the duplicated spellings of six shared rules now have one home each.
`docs/CODE-STYLE.md` records the conventions and the defect behind each one.

## [0.1.0-beta.1] - 2026-08-06

The first published release, and a prerelease on purpose: it ships under the `beta` dist-tag, not
`latest`. This entry covers the pre-publication hardening pass. Most of it is not new capability —
it is the difference between a command that reports a problem and one that was quietly blind to it,
and in four places it is the difference between an undo that works and one that certifies text
nobody wrote. Grouped by what a user would notice.

### Fixed — data loss and silent failure

- **A file whose bytes are not UTF-8 is no longer rewritten.** The whole write path moves bytes
  rather than strings; text is produced only where a parser needs it. Undecodable content refuses
  the merge (`merge-failed`, naming the file) instead of replacing every such byte with U+FFFD — in
  the living document *and* in the snapshot meant to undo it, which left nothing to restore from. A
  non-UTF-8 `openapi.yaml` now grades `openapi.invalid` instead of being handed to the YAML parser
  with the damage already done.
- **`unarchive` no longer restores an edited snapshot and certifies it.** The snapshot manifest is
  version 2: every entry records `before`, a sha256 of the pre-image it will restore, alongside the
  existing `after`. `unarchive` hashes each pre-image before staging anything and refuses on a
  mismatch (`snapshot-corrupt`) — and `--force` deliberately does not override it, because `--force`
  discards later changes to the living docs while the damage here is to the undo itself. A version-1
  snapshot is refused as `snapshot-missing`.
- **A commit killed halfway can now be repaired.** `archive` and `unarchive` fsync an intent journal
  (`.loam-commit`) before the first swap and recover from it on the next run, under the lock: an
  archive is undone, an unarchive is finished (the merged text it was replacing is recorded nowhere
  else). Where the files no longer permit a safe repair the answer is `commit-interrupted`, a
  refusal. Previously a SIGKILL between two renames left a half-merged repo that `doctor` called
  healthy, `validate` blamed on the author's delta, and nothing could roll back.
- **A removal marker can no longer be published into a living contract.** `x-loam-remove` written at
  path level, beside the methods, names no operation and retires nothing; `archive` gates it
  (`openapi.remove-marker-path-level`) and the marker is stripped from every merge branch, so it
  never reaches the fleet's living OpenAPI under any flag.
- **Symlinked service and feature directories are enumerated.** A `services/<svc>` or
  `features/<FEAT>` reached through a symlink used to vanish from every listing, which also produced
  a false `landscape.binding-unknown` for the service that was right there. Dangling links are
  skipped exactly as an absent directory is.

### Fixed — checks that were blind

- **Nested landscape elements are graded.** The landscape cross-check kept only top-level elements,
  so ordinary grouped C4 — services under an `enterprise`, `group` or `boundary` — reported *every*
  service as unmodelled. The tree is walked instead: an element is at service level when no ancestor
  already stands for a service, an element that contains a service is a grouping, and
  `landscape.binding-unknown` is now graded at any depth.
- **A missing `openapi.yaml` no longer silences the API axis.** It is an **error** when a living
  non-`REMOVED` `Operations:` line or an op-linked landscape edge already points into the absent
  file, with the stranded operationIds in `details`; a warning when nothing does and the landscape
  cannot prove nobody calls the service; silent when it can. Correspondingly, one absent contract is
  one finding rather than one `spine.op-undefined` per inbound consumer — a file that is not there
  proves nothing about an edge.
- **A feature delta addressed to a nonexistent service is refused** (`delta.service-unknown`, naming
  close ids). A typo in `--touches` used to validate green and materialise a phantom service
  directory on archive.
- **`openapi.duplicate-operationid` fires in service scope**, not only through an unrelated
  feature's delta — so `validate --all` sees it on a fleet with no feature in flight.
- **`c4.uncovered` no longer fires on a re-declared edge.** A delta that restates a living edge to
  hang a requirement on it was told to write a decorative architecture requirement.
- **`loam doctor` reports what it could not see before**: a held or stale `.loam-lock`, an
  interrupted commit, orphaned staging temp files, and generated command/skill files that have
  fallen behind (below).

### Changed — verification says which answers came from a test run

`--record` may still confirm a `scenario.tested` claim on an agent's word; a service with no
runnable suite yet has to be able to record its answers. What changed is that the record now says
so, everywhere:

- a three-valued **`verdict`** — `verified`, `attested`, `unverified` — recomputed from `claims[]`
  on every read and never taken from the record's own `summary:` block. `verified` in `--json` is
  exactly `verdict === "verified"`, so a record with zero claims no longer reads as verified by
  arithmetic;
- `verify.scenario-attested` (warning, gating nothing) naming each claim, on the read view, the
  recording view and the frozen post-archive view alike; `loam status` re-reports it and offers
  `next.verify-attested`, and such a feature reaches `stage: ready`, never `done`;
- a `summary:` block contradicting its own `claims[]` makes the whole record `record-unreadable`
  (`verify.record-miscounted`) — neither half can be believed, so neither is reported as fact;
- `--results` writes down **which report it read** (path, sha256, mtime, tagged-scenario count),
  must resolve inside the attesting repository in federated mode, and refuses a committed report
  that differs from the attested commit. That says which file was consumed; it does not say the file
  came from executing that commit, and no digest can;
- two services wording a scenario identically share one digest, so a single report cannot say whose
  suite ran it: those claims are left unconfirmed under `verify.digest-contested` rather than
  confirming both.

### Changed — `loam status` is a projection over the gates

`status` used to say "ship it" on trees `archive` refused. It now takes `stage` and `next[]` from
the union of what `validate --feature` errors on and what `archive` refuses to merge, so it may be
more pessimistic than either and is never greener than both — an invariant with a test behind it.
Also: `checks.coherent` runs the same functions `validate` does (coherence, provenance, missing
scenarios); `owesContract` keys on the contract *file* rather than the service directory; `next[]`
names `loam delta`, `loam gherkin` and `loam rebase`; the fleet form is capped at ten steps plus a
`next.elided` notice and always ends on `next.fleet-gate`; and a filesystem failure that carries no
path (a directory where a file belongs) is reported rather than crashing the command.

### Changed — generated agent files carry a version stamp

Every generated command and skill body now opens with `<!-- generated by loam vX.Y.Z -->`, and
`loam doctor` raises `doctor.agent-files-stale` for a file with no stamp or an older one. loam still
never rewrites a generated file — the fix is a human's — but drift is now detectable, which it
previously was not: a command file mangled to one line left `doctor: healthy: true`. Doctor also
stops reporting a repo initialized `--no-skills` as missing its skills.

`loam rebase` and `loam status` were added to the shipped workflow bodies, which is where the
mechanism that prevents two in-flight features from overwriting each other actually gets run.
`doctor`'s fix line now spells `loam adopt --service <id>`; the positional form it used to print is
refused by the CLI, and a new test parses every command loam prints against the real CLI so that
class of defect cannot return silently.

### Changed — `loam init` keeps the pointer it was given

`--docs` wins only when it is actually passed. A re-run in a wired repository keeps the `docsDir`
its committed `loam.json` already names, `--create` included, and spreads the rest of the config
forward; `--json` reports `docsDirSource` as `flag`, `config` or `default`. Following `doctor`'s
advice to re-run `init` used to repoint the repo at an empty decoy over which `validate --all` went
green.

### Fixed — the OpenSpec on-ramp

- **A Store checkout is audited by its planning shape, not by its marker.** A
  `.openspec-store/store.yaml` beside real `specs/` used to make audit look for
  `<checkout>/openspec`, find nothing, and report `ready: true, capabilities: 0` — then apply a
  target holding no requirements at all. The shape picks the root; the marker picks only the kind; a
  checkout with planning content in neither place is refused by name.
- **A workspace nobody could read is never `ready`** (`openspec.workspace-empty`).
- New blockers for shapes that silently migrated nothing: `openspec.change-quoted-requirements`
  (requirements under `## Requirements` inside an active delta — the shape OpenSpec's own living
  template mandates, which stages nothing in a change), `openspec.nonstandard-living-spec` (markdown
  under `specs/` named neither `spec.md` nor `design.md`), `openspec.hidden-change-directory` (a
  dot-prefixed directory under `changes/`, which enumeration skips).
- **The source digest no longer covers archived changes.** Frozen history never gates, so it must
  not be able to invalidate a completed mapping either; a living or active edit still does.
- **The staged target is a real docs repo** — its own `loam.json`, `AGENTS.md` and an empty
  `architecture/landscape.likec4` — so `FOLLOW-UP.md`'s instructions run where they are written, and
  `FOLLOW-UP.md` now ends with the cutover procedure: `services/` and `features/` move, everything
  else is review residue.
- **A target inside a live loam fleet is refused**, instead of producing phantom features in every
  `loam list`.
- The living capability tree is copied verbatim under `legacy/openspec/specs/`, so `## Purpose`
  prose, section prose and capability `design.md` are preserved rather than dropped; an ISO-8601
  `created` timestamp is a valid date; fenced FROM/TO examples inside a `## RENAMED Requirements`
  block are no longer parsed as renames; and a rename's TO name no longer demands a service
  allocation the router never asks for.

### Performance

`loam list` and `loam validate --service` are now flat in landscape edge count: loam reads LikeC4's
parsed model and never computes a view, which it had no use for. On a generated 120-service fleet
the same commands previously did not finish above roughly 200 edges. Measured at 120 services and
400/800 edges on an 8-core laptop: `list --json` 1.1–1.5 s, `validate --service <id> --json` 1.4–1.6
s. `loam init` no longer scaffolds a `views { view index { include * } }` block it never reads.

`loam validate --all` remains ~30 s on that fleet — it parses a fresh LikeC4 workspace per service —
and no speedup is claimed for it. Its target loop is now a bounded pool rather than a serial
`await`, which is byte-for-byte output-identical and deterministic in ordering, but measured as a
wash on the hardware available; the lever that moved this command was the parsed model, not the loop
shape.

### Fixed — release engineering

- The CI `package` job could never pass: `release-check.mjs` refused `--fixture-ready` whenever
  `GITHUB_ACTIONS` was set. The guard now keys on a tag ref, which is what it was actually
  protecting against. Any claim that CI had validated release readiness was false before this.
- `npm run test:package` failed against the current tarball — the smoke test called
  `loam init --docs docs` without `--create`.
- Five release scripts spawned `npm.cmd`/`loam.cmd` without a shell, which Node ≥ 20.12 rejects on
  Windows; they now resolve npm's CLI and run it through `process.execPath`. Windows itself is
  unexercised here — there is no Windows host — so this is verified structurally and a platform
  runtime check remains outstanding.
- `pack-release` and `verify-release-artifact` compared an unpeeled `GITHUB_SHA` against `HEAD`, so
  an annotated or signed tag — the `npm version` and `git tag -a/-s` default — could never pass.
  Both peel now; `git tag -s v<version>` works.
- Release artifact retention raised 1 → 14 days, so a candidate awaiting human approval outlives a
  weekend; CI narrowed to pushes on `main` with a concurrency group, so tags no longer run both
  workflows in parallel.

### Documentation

README, COMPARISON, SCHEMA and MIGRATING were re-checked claim by claim against the code and against
upstream OpenSpec live on 2026-08-05. Corrected: the documented migration entry point
(`migrate-openspec <root>` returns `invalid-option`; `audit-openspec` is the real first step and
appeared nowhere in the README), the corpus and test counts, the `--baseline` flag the reproduction
recipe needs, the Executability and agent-surface comparison rows, and the claim that OpenSpec has
no multi-repo story — Stores shipped in v1.5.0, and the honest argument is their documented "No
sync, ever — by design" plus the absence of any lockfile or commit pin. Removed: the argument that
upstream's generated instructions are broken, which upstream fixed inside 48 hours and which loam
had in its own surface.

### Added

- A tag-driven npm release gate using GitHub OIDC trusted publishing and provenance.
- A reproducible two-fleet pilot harness and scorecard contract.

### Changed

- The supported runtime now matches the direct LikeC4 dependency: Node.js 22.22.3 or newer.

## Upgrading to this release

Nothing to upgrade from — this is the first published version. One note for a repository initialized
from a pre-release build: the first `loam doctor` after installing this one reports
`doctor.agent-files-stale` for **every** generated command and skill file. Earlier builds wrote no
version stamp, so "no stamp" and "an old stamp" are indistinguishable, and loam refuses to assume
the instructions on disk describe this binary. Read each file, then bump its stamp by hand, or
delete it and re-run `loam init` — the drift is reported and never repaired for you.
