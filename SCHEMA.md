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
  loam.docs.json                     manifest { version, services[] }
  architecture/
    landscape.likec4                    global C4 (fleet landscape)
    landscape.health.yaml            composed health model              [derived, later]
  services/<svc>/
    model.likec4                        service C4 (containers/components)  [adopt]
    spec.md                          capability spec + frontmatter       [adopt]
    openapi.yaml                     API contract                        [adopt / authored]
    adrs/NNNN-*.md                   MADR decisions                      [adopt-seed / authored]
    runbook.md                       operational runbook                 [adopt-draft / authored]
    health.yaml                      SLI/SLO, checks, critical deps       [authored]
    ui/pages/*.page.yaml             page-specs (UI services)            [authored]
    flows/                           interaction flows -> sequence views  [later]
  features/<FEAT>/
    intent.md                        business intent + acceptance         [authored]
    delta.likec4                        C4 delta                            [authored]
    adrs/NNNN-*.md                   feature-level decisions             [authored]
    scenarios/*.feature              gherkin (behavioral)                [authored/generated]
```

## Conventions

**Frontmatter** (spec/adr/runbook/health/intent): `status` (`draft` -> `verified`, or `proposed` -> `done`), `owner`, `service` or `feature`, `last_verified`, `sources` (globs).

**Tags (LikeC4)**: element kinds and tags are declared in a `specification` block; a delta's new/changed elements carry the feature id as a tag (`#FEAT-101`) so `loam` can project the delta by tag and validate it.

**Page-specs** link architecture and behavior:
```yaml
consumes: [{ service, op }]                  # OpenAPI operations the page calls
behavior: [ "FEAT-101: file#Scenario" ]      # gherkin scenarios governing the page
```

## Two flows

- **Bootstrap (reverse):** `loam adopt` reads code -> draft `model.likec4` + `spec.md` + `openapi.yaml` + seeded `adrs/`, `runbook.md`, `health.yaml`. Human promotes `draft` -> `verified`.
- **Forward (generative):** author `features/<FEAT>/delta.likec4` -> `loam delta <FEAT>` projects it per-service into work + generated gherkin -> tests -> code. `loam validate` checks the built code against the delta.

## Status

MVP encodes this layout + `init`. `adopt`/`delta`/`validate` land next; `render` (sequence/C4 diagrams), `health` compose, and UI-prototype generation follow.
