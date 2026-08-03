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
    adrs/NNNN-*.md                   feature-level decisions             [authored]
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
- **`loam archive <FEAT>`** merges the delta into the living state on three axes — **requirements** (`spec.md`), **API** (`openapi.yaml`), **architecture** (`landscape.likec4`) — then archives the feature, so the living state stays complete. Archived deltas are the evolution history (like `git log`).
- **Coherence gate:** `loam validate --feature` checks the three axes agree (C4 edge `op` ↔ OpenAPI `operationId` ↔ requirement `Operations:`); `loam archive` **refuses an incoherent feature unless `--approve`** — the merge would otherwise corrupt the living docs.

Rules (`loam validate`): every requirement has ≥1 scenario; every C4 edge `op` resolves to an OpenAPI operation governed by a requirement; and **the diff applies** — a `MODIFIED`/`REMOVED` requirement exists in the living spec, an `ADDED` one does not, and a section heading matches `## ADDED|MODIFIED|REMOVED Requirements` exactly. A near-miss heading (`## ADDED Requirement`, singular) parses as prose, so without this check archive merges nothing and reports nothing.

## Two flows

- **Bootstrap (reverse):** `loam adopt` reads code -> draft `model.likec4` + `spec.md` + `openapi.yaml` + seeded `adrs/`, `runbook.md`, `health.yaml`. Human promotes `draft` -> `verified`.
- **Forward (generative):** author `features/<FEAT>/delta.likec4` -> `loam delta <FEAT>` projects it per-service into work + generated gherkin -> tests -> code. `loam validate` checks the built code against the delta.

## Status

`init`, `list` / `show` (navigation), `validate` (C4 + requirement + API coverage + cross-axis coherence + the landscape ↔ `services/` cross-check, single target or `--all`), `delta` (per-service projection), `archive` (three-axis merge, gated on coherence) and `vouch` (stamp a spec verified against the code it describes) are implemented, each with a `--json` contract. Remaining: `adopt` (LLM), `render` (diagrams), `health` compose, UI-prototype generation.
