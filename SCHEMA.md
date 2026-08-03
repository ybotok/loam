# loam docs-repo schema

This documents the layout of the **docs repo** — the single shared source of truth that `loam` reads and writes. A runnable example lives under [`examples/docs/`](examples/docs).

Everything here is plain files. `loam` derives views and indexes from them; delete `loam` and the docs remain.

## Layer stack

C4 is the center. Each artifact is a **source** (authored), a **hybrid** (agent-written at bootstrap, authored forward), or a **derived** view (generated from the model + spine).

```
presentation │ UI page-prototypes ─(consume)─► endpoints     spec = source · proto = derived  [later]
behavior     │ gherkin scenarios ──(govern)──► pages         source
contract     │ OpenAPI  ◄──(detail of C4 "exposes/calls")    hybrid
structure    │ C4 model — services, relationships            source (adopt-seeded)
ops / why    │ ADR · runbook · health                        source
truth        │ code                                          ground truth
```

All artifacts are wired by one **ID spine**: `FEAT-<id>`, service id, and C4 element ids, carried in frontmatter and LikeC4 tags.

## Layout

```
docs/
  AGENTS.md                        the process contract, travelling with the docs
  architecture/
    landscape.likec4                    global C4 (fleet landscape)
    landscape.health.yaml            composed health model              [derived, later]
  services/<svc>/
    model.likec4                        service C4 (containers/components)  [adopt]
    spec.md                          living requirements (Requirement/Scenario)  [adopt]
    openapi.yaml                     API contract                        [adopt / authored]
    adrs/NNNN-*.md                   MADR decisions                      [adopt-seed / authored]
    runbook.md                       operational runbook                 [adopt-draft / authored]
    health.yaml                      SLI/SLO, checks, critical deps       [authored]
    ui/pages/*.page.yaml             page-specs (UI services)            [later]
    flows/                           interaction flows -> sequence views  [later]
  features/<FEAT>/
    intent.md                        business intent / proposal (why)     [authored]
    delta.likec4                     C4 delta (architecture)             [authored]
    specs/<svc>/spec.md              requirement delta (ADDED/MODIFIED/REMOVED + scenarios)  [authored]
    specs/<svc>/openapi.yaml         the endpoints this feature adds     [authored]
    adrs/NNNN-*.md                   feature-level decisions             [authored]
    verification.yaml                the done-check: claims + verdicts + evidence  [loam verify --record]
  features/archive/<FEAT>/           a shipped change — the same files, plus:
    .loam-before/                    the bytes the merge overwrote        [written by loam]
```

## Conventions

**Frontmatter**: `status`, `owner`, `service` or `feature`, `last_verified`, `sources` (paths/globs), `sources_digest`. `loam validate` reads it in exactly two files — a service's living `spec.md` and a feature's `intent.md`, the two documents whose identity and status everything else joins on. `adrs/`, `runbook.md` and `health.yaml` are presence-tracked only (`loam list` says whether they exist); their frontmatter is read by nothing today, so a field written there is a note to a future reader, not a claim any check will catch. For the two checked files:

- `status` — services: `draft` -> `verified`; features: `proposed` -> `in_progress` -> `built` -> `done`. An undocumented value is an **error**: a typo (`verifed`) would otherwise read as unverified forever.
- `service` / `feature` — must match the directory the file lives under. A mismatch is an **error**; absence is a warning.
- `sources` — paths in the *service's own repo* the artifact was written from. Resolved when `loam` runs inside that repo (`service` in `loam.json`); a path that no longer exists is an **error**. This is the only mechanical tie between the docs and the code: everything else loam checks is internal consistency, which a fluent fiction satisfies too.
- `sources_digest` / `last_verified` — written by `loam vouch`, never by hand. The digest is a content hash of the files `sources` names, taken when a human last read them; `loam validate`, run in that repo, recomputes it and reports `sources.current`, `sources.stale` (the code moved since anyone looked), or `sources.unvouched` (`sources` with no digest — nobody has ever stamped it). All warnings: staleness is a signal, and only a person can say whether the doc is still right.
- Missing fields are warnings, and `loam list` reports the fleet's draft/verified/unmarked split.

**Vouching** (`loam vouch --service <id>`, run in the service's own repo) is the human promotion `draft` -> `verified`: it stamps `status`, `last_verified` and `sources_digest` together, rewriting only the frontmatter. It refuses what it cannot verify — no `sources`, a source path that is gone, a pattern matching no file, or a repo that is not that service's — so a `verified` status always has a digest behind it.

The digest recipe (stable, and part of the contract): expand `sources` to repo-relative file paths — a directory means everything beneath it, `*`/`**`/`?` are matched as patterns, dot-entries are skipped — sort them, hash each file's bytes with sha256, feed `<path>\0<sha256-hex>\n` per file into an outer sha256, and keep the first 16 hex characters. Content, not mtime: git does not preserve modification times, so an mtime check would call every file stale after a fresh clone.

**Tags (LikeC4)**: element kinds and tags are declared in a `specification` block; a delta's new/changed elements carry the feature id as a tag (`#FEAT-101`) so `loam` can project the delta by tag and validate it. The tag is loam's only way of seeing the delta, so a `delta.likec4` that declares elements or relationships with none carrying the feature's tag is an **error** (`delta.nothing-tagged`): everything in it is invisible to the checks, and the archive would merge nothing.

**Service binding (element ↔ `services/<svc>/`)**: an element says which service it *is* with `metadata { service 'payment-service' }`. Without one, its **title** is used — which is what every existing repo relies on, and also the trap: rename a box in a diagram and every check that joined it to its directory silently stops matching. The binding is what makes a rename safe.

There is no manifest of services: the directories under `services/` **are** the list. `loam validate --all` cross-checks that list against the landscape in both directions:

- a `services/<svc>/` no element resolves to → `landscape.service-unmodelled` (**error**): the fleet map is incomplete, and every view derived from it is wrong;
- an element that looks like a service (top-level, not a `person`) with no directory → `landscape.service-undocumented` (**warning**): it may be someone else's system. Tag it `#external` to say so, and the warning stops;
- an element whose explicit binding names a directory that does not exist → `landscape.binding-unknown` (**error**). A binding is a claim about this repo; a title that fails to match is only a guess at one, which is why the two are graded differently.

Absences inside a service directory are graded too. A directory with no `spec.md` or no `openapi.yaml` is a **warning** (`service.no-spec`, `service.no-openapi`) — partial adoption is a supported state, but the checks those files feed are silently vacuous without them, and that has to be said. The openapi warning stays quiet only on positive evidence that nobody expects an API there: the landscape parses and no op-carrying edge targets the service. And `loam validate --service <id>` for a directory that does not exist at all is an **error** (`service.unknown`) that suggests close ids — never `loam adopt`, which would steer an agent into adopting the typo.

**API linkage (operationId)**: OpenAPI's `operationId` joins architecture and behavior — it is the token both C4 and specs reference.
- a C4 relationship names the operation it calls: `... -> ... 'Calls createSplit' { metadata { op 'createSplit' } }`;
- a requirement declares the operations it governs: an `Operations: createSplit` line;
- the operation is defined in the provider service's `openapi.yaml`.

`loam validate` then checks the **contract** (every edge's `op` exists in the target's OpenAPI — consumer-driven, gates) and **coverage** (every operation is governed by a requirement). Only the eight HTTP methods of a path item are read for operationIds — an id tucked inside a vendor extension (`x-legacy:`) does not exist, because a phantom id would mask a contract break. A service whose openapi defines operations while not one requirement carries an `Operations:` line gets a single **warning** (`api.ops-unlinked`): the API axis is unchecked there until someone links it — the exact state an adopted OpenSpec repo starts in.

**Page-specs** (`ui/pages/*.page.yaml`) are `[later]`: an example ships under `examples/docs/`, but no command reads pages yet, so the file's format is illustrative rather than contract. What is settled is only the job — a page names the operations it consumes and the scenarios that govern it, joining the same spine as everything else.

## Living spec vs delta (OpenSpec model)

Behaviour follows OpenSpec conventions: a **requirement** (`### Requirement:`, RFC-2119 SHALL/MUST) with **scenarios** (`#### Scenario:`, Given/When/Then). Scenarios are the acceptance criteria and the source for tests.

- **Living spec** — `services/<svc>/spec.md` (+ `landscape.likec4`): the complete current state — the "final spec of the whole product".
- **Delta** — `features/<FEAT>/specs/<svc>/spec.md` (+ `delta.likec4`): a change, reviewed as a diff, tagged to the feature.
- **`loam archive <FEAT>`** merges the delta into the living state on three axes — **requirements** (`spec.md`), **API** (`openapi.yaml`), **architecture** (`landscape.likec4`) — then archives the feature, so the living state stays complete. Archived deltas are the evolution history (like `git log`). `--dry-run` prints the whole plan and writes nothing.
- **Coherence gate:** `loam validate --feature` checks the three axes agree (C4 edge `op` ↔ OpenAPI `operationId` ↔ requirement `Operations:`). `loam archive` **blocks on the gating issues**. Severity and gating answer two different questions — severity says whether the *document* is valid (`validate` fails on errors), gating says whether the *merge* is safe — and they usually agree: errors gate, warnings do not. Where they diverge, the finding says so (`gates` in `--json`); today that is exactly `delta.requirement-not-merged`, a warning (the shape is legal OpenSpec, so adopted repos keep a green `validate`) that gates (the merge would silently drop the requirement). Advisory warnings are printed with the plan and never block. `--approve` overrides the gating issues only, and names each one it overrode. An operation that is missing from the provider's OpenAPI but defined by another feature still in flight is graded down to a warning (`spec-api.op-pending` / `c4-api.op-pending`) naming that feature — archive it first — because the fix is ordering, not authoring.
- **`loam unarchive <FEAT>`** takes an archive back: it restores the living docs and re-opens the feature.

### The smallest legal feature

A one-service bugfix needs exactly one file: `features/<FEAT>/specs/<svc>/spec.md` holding one `MODIFIED` requirement with its scenarios. That floor is verified against the checks, not asserted: with no `intent.md`, no `delta.likec4` and no openapi delta, `loam validate --feature` passes with zero errors and zero warnings, and `loam archive` plans exactly two writes — the living spec update and the move into `features/archive/`.

Each axis may be legitimately empty, and the checks grade absence differently from emptiness-by-accident:

- **`delta.likec4`** — absent, or present with an empty `model {}` (both verified: `delta.valid`, no landscape write in the plan): a behaviour fix moves no boxes and no edges, and the architecture merge simply has nothing to do. The line is drawn at content: a file that *declares* elements or relationships with none carrying the feature tag is an error (`delta.nothing-tagged`), because declared-but-untagged is almost always a forgotten tag, while declaring nothing is a legible statement that the architecture is unchanged.
- **openapi delta** — absent whenever the feature adds no operations; a requirement change that stays inside the existing contract has no API axis to speak on.
- **requirement delta** — the axis that is nearly always present, because a feature that changes no requirement changes no promised behaviour. The exception is architecture-only work: a new service in the C4 delta with no `specs/<svc>/spec.md` gets `service.no-requirement-delta` as a warning, not an error.

`intent.md` is required by no check today — an absent one produces no finding at all — but it is where the "why" lives, and `loam new` scaffolds it for a reason: the delta says what changed, and nothing else says what for.

### Where a capability lives (and why there is no capability layer)

A business capability — "payment splitting" — is spread across the living specs of every service that carries part of it. The obvious fix is a `capabilities/` layer holding the whole story in one place. **There is none, and there should not be one.**

The story is already whole and already derivable. Every requirement in a living spec arrived through exactly one feature, and that feature is still on disk under `features/archive/` with its intent, its C4 delta and its requirement deltas intact. "Which feature introduced this requirement" is a search, not a record — so a capabilities layer would be a second copy of text that already exists, which is a second thing that can disagree with the first. That is the same reason there is no service manifest.

A hand-written `capability:` label on a feature was considered and rejected for a sharper reason: **nothing could check it.** `sources` is hand-written too, but it is checkable — the paths exist or they do not, the digest matches or it does not. There is no ground truth for what counts as a capability, so the field would end up on some features and not others, in three spellings of the same theme, never revisited — while creating the impression that an index exists.

For a theme that genuinely crosses services and matches no structural unit, the mechanism already exists and is checkable: **a LikeC4 tag**. Tags are declared in a `specification` block, so a misspelling is a parse error rather than quiet drift; `validate` already reads them, `archive` already handles them, and they show up in the diagram.

### Considered and rejected: the rest of the OpenSpec feature set

loam takes OpenSpec's requirement format and leaves its machinery, deliberately. Most of that machinery compensates for not having a model; the landscape, the feature directories and the derived verify checklist already carry that load.

- **Workflow schema / DAG engine** — a feature's state is its `status:` frontmatter plus which directory it is in (`features/` vs `features/archive/`); an engine over that would be a second place the state lives.
- **Stores** — the files are the store; anything indexed from them is a cache loam can regenerate, which is what `loam list` does on every run.
- **Worksets** (hand-curated file bundles for an agent) — `loam delta <FEAT> --service <id>` derives the bundle from the model, so it cannot go stale the way a curated list does.
- **Profiles** (per-project behavior switches) — if `validate` means something different per repo, a fleet-wide green means nothing; `loam.json` holds the two facts loam needs (`docsDir`, `service`) and no switches.
- **TUI** — agents and CI get `--json`; humans get the files and the forge. A third surface would be a third thing to keep truthful.
- **Authored `tasks.md`** — the task list is derived (`loam delta`, `loam verify`), so it cannot drift from the delta it came from; an authored copy could.
- **Per-tool adapter matrix** — `AGENTS.md` travels with the docs and the slash commands are thin wrappers over the CLI, so any runner that can read a file and exec a binary is already supported.

The compatibility stance follows the same one-way logic: **loam reads OpenSpec, never writes it.** Serializing drops `## Purpose` and the `## Requirements` wrapper, both of which OpenSpec's parser requires — so loam output is not OpenSpec input, and pretending otherwise would corrupt someone's repo politely. [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) has the full account, with the evidence pinned in `test/openspec-compat.test.ts`.

### How archive writes, and how unarchive undoes it

The merge is computed in full before anything is written, and then committed file by file: each new version is staged as a temp file **in the target's own directory** and renamed into place, so a reader sees either the old bytes or the new ones and never a half-written document. If any file fails — including the final move into `features/archive/` — the files already swapped are put back from the bytes read before the swap, and the command says so. There is no journal: a process killed between two renames leaves a half-merged repo that nothing will roll back.

Undoing that merge is not a matter of inverting it. **A `MODIFIED` requirement's previous text is recorded nowhere** — the delta says what the requirement became, never what it was — and the landscape merge drops the feature tags, so the lines it added stop being identifiable the moment they land. Anything reconstructed would be a plausible guess at the old docs, which is the kind of quiet fiction the rest of loam exists to prevent.

So archive writes the bytes down. Before it swaps anything it copies every file it is about to overwrite into `<feature>/.loam-before/`, with a `manifest.json` naming each one, whether it existed at all (a file the merge *created* is restored by deleting it), and a hash of what the merge wrote. That directory travels with the feature into `features/archive/`, and `loam unarchive` puts it back.

Some checks run at plan time rather than in the gate, because only the computed merge can see them. A **living** requirement sitting outside `## Requirements` refuses the whole archive (`living.requirement-outside-requirements`, error): the merge rewrites only that section, so the requirement would land in the file twice — and `--approve` does not override it, because the duplication is mechanical, not a judgment call; re-home the requirement first. A delta that redefines a path+method the living OpenAPI already has (`openapi.op-modified`, warning) merges anyway, but the plan says so — the overwrite is wholesale, and the living definition it replaces deserved an eye. An unparseable `delta.likec4` fails the archive at plan time regardless of `--approve`: the alternative was archiving with the architecture axis silently dropped, which is the data loss this tool exists to prevent.

The OpenAPI merge carries components along with operations: every `#/components/<kind>/<name>` the merged path items reference — recursively, a component's own `$ref`s pulling in more — is copied from the feature document into the living one, so an operation never lands pointing at a schema that stayed behind. A needed component the living document already holds **identically** is left alone; one it holds **differently** is overwritten wholesale under the same discipline as an operation (`openapi.component-modified`, warning — the merge proceeds, the plan says so). A `$ref` reachable from the merged content that resolves in **neither** document blocks the archive (`openapi.ref-unresolved`, error): merging it would write a dangling reference. `--approve` overrides it — unlike the mechanical refusals, this one is a judgment call. External references — URLs, file paths, anything not starting `#/` — are out of scope: left untouched, never gated.

`loam archive --json` speaks the same machine contract as everything else: on success (or `--dry-run`) the plan (`{path, action, to?}` per file), the non-blocking warnings, and whatever `--approve` overrode; on refusal a stable `error.code` — `not-coherent` and `living-outside-requirements` carry the issues, `archive-exists` names a taken destination, `merge-failed` means nothing was written (or everything was rolled back), `rollback-incomplete` lists the files that need a hand.

`unarchive` refuses rather than guesses, each refusal under its own `--json` `error.code`:

- `feature-active` — a feature of that id is active again; restoring over it would bury work in flight;
- `snapshot-missing` — archived before snapshots existed (or by a different layout version); the living docs have to come back from version control instead;
- `snapshot-stale` — a merged file changed after the archive, so this would be a revert of someone else's work rather than an undo. `--force` says that was meant.

Rules (`loam validate`): every requirement has ≥1 scenario; every C4 edge `op` resolves to an OpenAPI operation governed by a requirement; and **the diff applies** — a `MODIFIED`/`REMOVED` requirement exists in the living spec, an `ADDED` one does not, and a section heading matches `## ADDED|MODIFIED|REMOVED Requirements` exactly. A near-miss heading (`## ADDED Requirement`, singular) parses as prose, so without this check archive merges nothing and reports nothing. `## RENAMED Requirements` — OpenSpec's fourth delta operation — gets the same error (`delta.unknown-section`) with a pointed message: loam does not merge renames; express one as a `REMOVED` requirement plus an `ADDED` one. And an `ADDED` name that differs from a living requirement's only in case is a warning (`delta.added-near-duplicate`): merge identity is exact-string, so both spellings would coexist in the living spec.

**The section heading is what gives a requirement its kind.** A requirement under any other H2 (`## Behavior`, `## Error Handling` — the shape older OpenSpec "complete future state" deltas use) has no kind, and archive merges nothing for it; `delta.requirement-not-merged` names each one and the heading that stranded it — a warning (the shape is legal OpenSpec, `validate` stays green) that **gates archive** (authored content must not vanish silently; `--approve` overrides). When *no* requirement in the file sits under a delta section — prose headings only, requirements above every heading, or a file that only quotes the living state — the grade goes up to an **error**, `delta.no-delta-sections`: a delta that would merge nothing as a whole is not a valid delta. `## Requirements` stays exempt from the per-requirement warning: quoting the living state inside a delta is legal and merges nothing by design. The heading must be reachable, too — a leading UTF-8 BOM used to hide `## MODIFIED Requirements` on line 1 and void the entire delta, so the parser strips one.

## The verification record

`features/<FEAT>/verification.yaml` is the done-check written down. `loam verify <FEAT>` derives a **checklist** from the feature's own artifacts — the same files `validate` reads, never the code:

| kind | one claim per | reads |
|---|---|---|
| `service.exists` | tagged top-level element the delta introduces | `delta.likec4` |
| `api.exposes` | operationId the feature's openapi delta adds that the living one lacks | `specs/<svc>/openapi.yaml` |
| `c4.calls` | tagged edge carrying `metadata { op }` | `delta.likec4` |
| `scenario.tested` | scenario of every ADDED/MODIFIED requirement | `specs/<svc>/spec.md` |

Each claim's **id** is `<kind>-<8 hex>`, hashed from the feature id and what the claim says (with an occurrence counter for genuine duplicates). For `scenario.tested` "what the claim says" includes a hash of the scenario's **body**, not just its title. So the same feature yields the same ids on every run — two runs are diffable — reordering the artifacts renames nothing, and **rewording a scenario renames its claim, even a Given/When/Then rewrite under an unchanged title**, which is the point: an answer about text nobody wrote must not carry over as if it still applied.

`loam verify <FEAT> --record <answers.json>` takes the answers back and refuses anything that does not answer the *current* checklist, each under its own `--json` `error.code`: `answers-unreadable` (not JSON, or a verdict outside `confirmed` / `unconfirmed`), `answers-mismatch` (an id nobody asked about, a claim with no answer, or one answered twice), `answers-unevidenced` (a `confirmed` with no `file:line` behind it). An unchecked claim must never be able to masquerade as checked.

The record is YAML, like the other data artifacts, and holds the claim text next to each verdict so it reads without loam:

```yaml
feature: FEAT-101
recorded: 2026-08-03
checklist: 4ae5ab9fc17df302        # digest of the claim ids these answer
summary: { claims: 4, confirmed: 3, unconfirmed: 1 }
claims:
  - id: api.exposes-2a8cee76
    kind: api.exposes
    claim: payment-split-service exposes operationId 'createSplit'
    verdict: confirmed
    evidence: [src/split/Api.ts:42]
  - id: scenario.tested-daed1f53
    kind: scenario.tested
    claim: scenario 'Split across two payees' … is covered by a test
    verdict: unconfirmed
    note: no test asserts the 60/40 split
```

It lives inside the feature, so `archive` carries it into `features/archive/<FEAT>/` with everything else. `loam verify` re-run later compares `checklist` against the current digest and reports the record as **stale** if the feature moved under it — while the feature is active. Once archived there is no current checklist to be stale against (the merge itself moved the feature's operations into the living OpenAPI, so a re-derived checklist could only disagree): `loam verify` on an archived feature renders the record verbatim as **frozen history** (`frozen: true` under `--json`, no staleness judgment), and `--record` refuses (`invalid-option` — there is no current checklist for the answers to answer): the record is about the words that shipped, and it stays that way.

**Verification does not gate `archive`.** Coherence gates because loam computed it from the documents; a verdict is an agent's word about code loam never read, and a gate in front of shipping teaches everyone that the cheapest way past it is to say yes. The record is for the reviewer who comes later, and an `unconfirmed` claim with a note is worth more there than a `confirmed` nobody can back up. `loam verify` exits 0 either way; branch on `verified` in the `--json` payload.

## Operating at fleet scale

One docs repo, a hundred services, many teams. The repo scales the way any shared codebase does — through the forge, not through loam features:

- **Ownership is CODEOWNERS.** `services/<svc>/**` belongs to the owning team; `features/**` to whoever drives cross-service change, with the owners of each touched service pulled in through the feature's `specs/<svc>/` paths. loam has no permission model and should not grow one — the forge already has it.
- **`vouch` and `archive` land through reviewed PRs.** Both rewrite the source of truth, and the PR supplies exactly what loam deliberately does not record: who approved, when, and the diff they saw. The voucher's identity is the PR author's git identity — no `vouched_by:` field, because git already refuses to forget.
- **Provenance runs where the code is.** `sources` resolve only inside a service's own repo, so each service repo's CI runs `loam validate --service <id> --json` and branches on the finding codes (`sources.current`, `sources.stale`, `sources.unvouched`). The docs repo's CI runs `loam validate --all`, which counts what it cannot check from there (`sourcesUnverifiableFromHere`). Aggregating the per-repo results into a fleet view happens outside loam, on purpose: the stable codes are the interface, and any CI system can pivot on them.

**The adoption readout measures presence, not truth.** `loam list --json` grades every service on one monotone ladder — `empty` (a directory and nothing else) → `partial` (some artifacts, but not the required triple) → `documented` (`model.likec4` + `spec.md` + `openapi.yaml` all present) → `sourced` (the living spec declares `sources`) → `vouched` (`status: verified` with a `sources_digest` behind it) — as a `maturity` string per service and a fleet rollup of counts per rung, with the same rollup as a line in the text view. Every rung is derived from artifact presence and provenance state alone; COMPLETENESS of what was written is on the adopt brief's unchecked list, so no rung is called "adopted" — a service with one endpoint documented out of thirty reaches `vouched` exactly as fast as a thorough one, and only a reader can tell them apart.

**The per-service summary a CI pipeline publishes.** Staleness and validity are computable only one service repo at a time, and loam ships no aggregator — but a fleet view needs a defined thing to aggregate, and without one "no report" is indistinguishable from "clean". So the contract is a shape, not a tool. Each service repo's CI derives this from `loam validate --service <id> --json` and publishes it wherever the fleet view reads:

```json
{
  "service": "payment-service",
  "valid": true,
  "errors": 0,
  "warnings": 2,
  "sources": { "current": 1, "stale": 0, "unvouched": 0, "absent": 0 },
  "generatedAt": "2026-08-03T12:00:00Z"
}
```

The derivation, verbatim (`jq`; the same logic fits a `node -e` one-liner):

```sh
loam validate --service "$SVC" --json | jq '{
  service: .targets[0].id,
  valid: .valid,
  errors: .summary.errors,
  warnings: .summary.warnings,
  sources: {
    current:   [.targets[0].findings[] | select(.code == "sources.current")]   | length,
    stale:     [.targets[0].findings[] | select(.code == "sources.stale")]     | length,
    unvouched: [.targets[0].findings[] | select(.code == "sources.unvouched")] | length,
    absent:    [.targets[0].findings[] | select(.code == "sources.absent")]    | length
  },
  generatedAt: (now | todate)
}'
```

`generatedAt` is the CI's clock, never loam's — loam output carries no timestamps, by design, so the same repo state always yields the same bytes. That is also what makes the timestamp the liveness signal: the rule is that every service repo's CI publishes this summary on every run, so a summary that is missing or whose `generatedAt` is old IS the "no report" state, and a fleet view renders it as unknown, never as clean. The derivation is pinned in `test/validate-contract.test.ts`, so the payload cannot drift out from under this recipe silently.

**One `landscape.likec4`, by decision.** A shared file every feature merges into sounds like a conflict factory, but archive appends disjoint regions far more often than not, and PRs resolve the rest. The trigger for revisiting is written down so nobody relitigates it early: when landscape merge conflicts become routine — weekly, not monthly — move per-service internals fully into `services/<svc>/model.likec4` and thin the landscape down to top-level elements plus cross-service edges. Until then, one file keeps the fleet map one diffable document.

## Two flows

- **Bootstrap (reverse):** `loam adopt --service <id>` emits a **brief**, not an extraction — the target paths (and which already exist, to be diffed and never overwritten), the grammar of each artifact, what the living landscape already says about the service, the frontmatter to write, the checks `loam validate --service <id>` will then run, and the ones that do not exist. An agent reads the code and writes draft `model.likec4` + `spec.md` + `openapi.yaml` + `adrs/`, `runbook.md`, `health.yaml`. A human promotes `draft` -> `verified` with `loam vouch`.
- **Forward (generative):** author `features/<FEAT>/delta.likec4` -> `loam delta <FEAT>` projects it per-service into work + generated gherkin -> tests -> code -> `loam verify <FEAT>` records what was actually built.

There is no code extractor on either side, by decision. Nothing deterministic reads a service and says what its architecture means, and two generated models of the same code disagree in wording every run — a done-check built on diffing them would flap until somebody turned it off. What is deterministic is the **question**: which files, in which grammar, bound to which existing elements; which operations, which edges, which scenarios. loam owns the questions and the checking; an agent owns the reading. `sources` and `verification.yaml` are where the answers are written down.

## Status

`init`, `list` / `show` (navigation), `adopt` (the baseline brief), `new` (feature scaffolding), `validate` (C4 + requirement + API coverage + cross-axis coherence + the landscape ↔ `services/` cross-check, single target or `--all`), `delta` (per-service projection), `verify` (the done-check checklist + its record), `archive` (three-axis merge, gated on gating coherence issues) / `unarchive` (put it back from the snapshot archive left behind) and `vouch` (stamp a spec verified against the code it describes) are implemented, each with a `--json` contract. Remaining: `render` (diagrams — delegated to LikeC4's own tooling), `health` compose, UI-prototype generation.
