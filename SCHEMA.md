# loam docs-repo schema

This documents the layout of the **docs repo** — the single shared source of truth that `loam` reads and writes. A runnable example lives under [`examples/docs/`](examples/docs).

Everything here is plain files. `loam` derives views and indexes from them; delete `loam` and the docs remain.

## Layer stack

C4 is the center. Each artifact is a **source** (authored), a **hybrid** (extracted at bootstrap, authored forward), or a **derived** view (generated from the model + spine).

```
presentation │ UI page-prototypes ─(consume)─► endpoints     spec = source · proto = derived
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
    ui/pages/*.page.yaml             page-specs (UI services)            [authored]
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

**Frontmatter** (spec/adr/runbook/health/intent): `status`, `owner`, `service` or `feature`, `last_verified`, `sources` (paths/globs), `sources_digest`. Checked by `loam validate`:

- `status` — services: `draft` -> `verified`; features: `proposed` -> `in_progress` -> `built` -> `done`. An undocumented value is an **error**: a typo (`verifed`) would otherwise read as unverified forever.
- `service` / `feature` — must match the directory the file lives under. A mismatch is an **error**; absence is a warning.
- `sources` — paths in the *service's own repo* the artifact was written from. Resolved when `loam` runs inside that repo (`service` in `loam.json`); a path that no longer exists is an **error**. This is the only mechanical tie between the docs and the code: everything else loam checks is internal consistency, which a fluent fiction satisfies too.
- `sources_digest` / `last_verified` — written by `loam vouch`, never by hand. The digest is a content hash of the files `sources` names, taken when a human last read them; `loam validate`, run in that repo, recomputes it and reports `sources.current`, `sources.stale` (the code moved since anyone looked), or `sources.unvouched` (`sources` with no digest — nobody has ever stamped it). All warnings: staleness is a signal, and only a person can say whether the doc is still right.
- Missing fields are warnings, and `loam list` reports the fleet's draft/verified/unmarked split.

**Vouching** (`loam vouch --service <id>`, run in the service's own repo) is the human promotion `draft` -> `verified`: it stamps `status`, `last_verified` and `sources_digest` together, rewriting only the frontmatter. It refuses what it cannot verify — no `sources`, a source path that is gone, a pattern matching no file, or a repo that is not that service's — so a `verified` status always has a digest behind it.

The digest recipe (stable, and part of the contract): expand `sources` to repo-relative file paths — a directory means everything beneath it, `*`/`**`/`?` are matched as patterns, dot-entries are skipped — sort them, hash each file's bytes with sha256, feed `<path>\0<sha256-hex>\n` per file into an outer sha256, and keep the first 16 hex characters. Content, not mtime: git does not preserve modification times, so an mtime check would call every file stale after a fresh clone.

**Tags (LikeC4)**: element kinds and tags are declared in a `specification` block; a delta's new/changed elements carry the feature id as a tag (`#FEAT-101`) so `loam` can project the delta by tag and validate it.

**Service binding (element ↔ `services/<svc>/`)**: an element says which service it *is* with `metadata { service 'payment-service' }`. Without one, its **title** is used — which is what every existing repo relies on, and also the trap: rename a box in a diagram and every check that joined it to its directory silently stops matching. The binding is what makes a rename safe.

There is no manifest of services: the directories under `services/` **are** the list. `loam validate --all` cross-checks that list against the landscape in both directions:

- a `services/<svc>/` no element resolves to → `landscape.service-unmodelled` (**error**): the fleet map is incomplete, and every view derived from it is wrong;
- an element that looks like a service (top-level, not a `person`) with no directory → `landscape.service-undocumented` (**warning**): it may be someone else's system. Tag it `#external` to say so, and the warning stops;
- an element whose explicit binding names a directory that does not exist → `landscape.binding-unknown` (**error**). A binding is a claim about this repo; a title that fails to match is only a guess at one, which is why the two are graded differently.

**API linkage (operationId)**: OpenAPI's `operationId` joins architecture and behavior — it is the token both C4 and specs reference.
- a C4 relationship names the operation it calls: `... -> ... 'Calls createSplit' { metadata { op 'createSplit' } }`;
- a requirement declares the operations it governs: an `Operations: createSplit` line;
- the operation is defined in the provider service's `openapi.yaml`.

`loam validate` then checks the **contract** (every edge's `op` exists in the target's OpenAPI — consumer-driven, gates) and **coverage** (every operation is governed by a requirement).

**Page-specs** link architecture and behavior:
```yaml
consumes: [{ service, op }]                  # OpenAPI operations the page calls
behavior: [ "FEAT-101: file#Scenario" ]      # gherkin scenarios governing the page
```

## Living spec vs delta (OpenSpec model)

Behaviour follows OpenSpec conventions: a **requirement** (`### Requirement:`, RFC-2119 SHALL/MUST) with **scenarios** (`#### Scenario:`, Given/When/Then). Scenarios are the acceptance criteria and the source for tests.

- **Living spec** — `services/<svc>/spec.md` (+ `landscape.likec4`): the complete current state — the "final spec of the whole product".
- **Delta** — `features/<FEAT>/specs/<svc>/spec.md` (+ `delta.likec4`): a change, reviewed as a diff, tagged to the feature.
- **`loam archive <FEAT>`** merges the delta into the living state on three axes — **requirements** (`spec.md`), **API** (`openapi.yaml`), **architecture** (`landscape.likec4`) — then archives the feature, so the living state stays complete. Archived deltas are the evolution history (like `git log`). `--dry-run` prints the whole plan and writes nothing.
- **Coherence gate:** `loam validate --feature` checks the three axes agree (C4 edge `op` ↔ OpenAPI `operationId` ↔ requirement `Operations:`); `loam archive` **refuses an incoherent feature unless `--approve`** — the merge would otherwise corrupt the living docs.
- **`loam unarchive <FEAT>`** takes an archive back: it restores the living docs and re-opens the feature.

### How archive writes, and how unarchive undoes it

The merge is computed in full before anything is written, and then committed file by file: each new version is staged as a temp file **in the target's own directory** and renamed into place, so a reader sees either the old bytes or the new ones and never a half-written document. If any file fails — including the final move into `features/archive/` — the files already swapped are put back from the bytes read before the swap, and the command says so. There is no journal: a process killed between two renames leaves a half-merged repo that nothing will roll back.

Undoing that merge is not a matter of inverting it. **A `MODIFIED` requirement's previous text is recorded nowhere** — the delta says what the requirement became, never what it was — and the landscape merge drops the feature tags, so the lines it added stop being identifiable the moment they land. Anything reconstructed would be a plausible guess at the old docs, which is the kind of quiet fiction the rest of loam exists to prevent.

So archive writes the bytes down. Before it swaps anything it copies every file it is about to overwrite into `<feature>/.loam-before/`, with a `manifest.json` naming each one, whether it existed at all (a file the merge *created* is restored by deleting it), and a hash of what the merge wrote. That directory travels with the feature into `features/archive/`, and `loam unarchive` puts it back.

`unarchive` refuses rather than guesses, each refusal under its own `--json` `error.code`:

- `feature-active` — a feature of that id is active again; restoring over it would bury work in flight;
- `snapshot-missing` — archived before snapshots existed (or by a different layout version); the living docs have to come back from version control instead;
- `snapshot-stale` — a merged file changed after the archive, so this would be a revert of someone else's work rather than an undo. `--force` says that was meant.

Rules (`loam validate`): every requirement has ≥1 scenario; every C4 edge `op` resolves to an OpenAPI operation governed by a requirement; and **the diff applies** — a `MODIFIED`/`REMOVED` requirement exists in the living spec, an `ADDED` one does not, and a section heading matches `## ADDED|MODIFIED|REMOVED Requirements` exactly. A near-miss heading (`## ADDED Requirement`, singular) parses as prose, so without this check archive merges nothing and reports nothing.

**The section heading is what gives a requirement its kind.** A requirement under any other H2 (`## Behavior`, `## Error Handling` — the shape older OpenSpec "complete future state" deltas use) has no kind, and archive merges nothing for it; `delta.requirement-not-merged` (warning) names each one and the heading that stranded it. `## Requirements` is exempt: quoting the living state inside a delta is legal and merges nothing by design. The heading must be reachable, too — a leading UTF-8 BOM used to hide `## MODIFIED Requirements` on line 1 and void the entire delta, so the parser strips one.

## The verification record

`features/<FEAT>/verification.yaml` is the done-check written down. `loam verify <FEAT>` derives a **checklist** from the feature's own artifacts — the same files `validate` reads, never the code:

| kind | one claim per | reads |
|---|---|---|
| `service.exists` | tagged top-level element the delta introduces | `delta.likec4` |
| `api.exposes` | operationId the feature's openapi delta adds that the living one lacks | `specs/<svc>/openapi.yaml` |
| `c4.calls` | tagged edge carrying `metadata { op }` | `delta.likec4` |
| `scenario.tested` | scenario of every ADDED/MODIFIED requirement | `specs/<svc>/spec.md` |

Each claim's **id** is `<kind>-<8 hex>`, hashed from the feature id and what the claim says (with an occurrence counter for genuine duplicates). So the same feature yields the same ids on every run — two runs are diffable — reordering the artifacts renames nothing, and **rewording a scenario renames its claim**, which is the point: an answer about text nobody wrote must not carry over as if it still applied.

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

It lives inside the feature, so `archive` carries it into `features/archive/<FEAT>/` with everything else. `loam verify` re-run later compares `checklist` against the current digest and reports the record as **stale** if the feature moved under it.

**Verification does not gate `archive`.** Coherence gates because loam computed it from the documents; a verdict is an agent's word about code loam never read, and a gate in front of shipping teaches everyone that the cheapest way past it is to say yes. The record is for the reviewer who comes later, and an `unconfirmed` claim with a note is worth more there than a `confirmed` nobody can back up. `loam verify` exits 0 either way; branch on `verified` in the `--json` payload.

## Two flows

- **Bootstrap (reverse):** `loam adopt --service <id>` emits a **brief**, not an extraction — the target paths (and which already exist, to be diffed and never overwritten), the grammar of each artifact, what the living landscape already says about the service, the frontmatter to write, the checks `loam validate --service <id>` will then run, and the ones that do not exist. An agent reads the code and writes draft `model.likec4` + `spec.md` + `openapi.yaml` + `adrs/`, `runbook.md`, `health.yaml`. A human promotes `draft` -> `verified` with `loam vouch`.
- **Forward (generative):** author `features/<FEAT>/delta.likec4` -> `loam delta <FEAT>` projects it per-service into work + generated gherkin -> tests -> code -> `loam verify <FEAT>` records what was actually built.

There is no code extractor on either side, by decision. Nothing deterministic reads a service and says what its architecture means, and two generated models of the same code disagree in wording every run — a done-check built on diffing them would flap until somebody turned it off. What is deterministic is the **question**: which files, in which grammar, bound to which existing elements; which operations, which edges, which scenarios. loam owns the questions and the checking; an agent owns the reading. `sources` and `verification.yaml` are where the answers are written down.

## Status

`init`, `list` / `show` (navigation), `adopt` (the baseline brief), `validate` (C4 + requirement + API coverage + cross-axis coherence + the landscape ↔ `services/` cross-check, single target or `--all`), `delta` (per-service projection), `verify` (the done-check checklist + its record), `archive` (three-axis merge, gated on coherence) / `unarchive` (put it back from the snapshot archive left behind) and `vouch` (stamp a spec verified against the code it describes) are implemented, each with a `--json` contract. Remaining: `render` (diagrams — delegated to LikeC4's own tooling), `health` compose, UI-prototype generation.
