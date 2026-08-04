# Migrating from OpenSpec

loam reads OpenSpec requirement Markdown from the outside: `### Requirement:` headings, `#### Scenario:` blocks, and `## ADDED|MODIFIED|REMOVED Requirements` delta sections. Compatibility is measured, not assumed.

Two upstream baselines are named separately:

- released behavior: **OpenSpec v1.7.0**, exact commit `4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b`;
- compatibility canary: post-release `main` commit `45cca5db6137ed209117cc70510eb3e057fb981b`.

The seven verbatim fixtures come from the main canary and run in routine CI. A scheduled/manual matrix separately checks the exact release and canary commits across living, active, and archived spec trees: release 207 files / 739 requirements / 2273 scenarios; canary 209 / 742 / 2284. These test requirement/scenario parsing, not every modern workspace feature. Provenance and checksums are in [`test/fixtures/openspec/README.md`](test/fixtures/openspec/README.md).

## Start with a read-only audit

```bash
loam audit-openspec /path/to/repo
loam audit-openspec /path/to/repo --json
```

The input may be a repository containing `openspec/`, the `openspec/` directory itself, or a Store checkout. Modern `config.yaml`, Store metadata, nested capability folders, per-change `.openspec.yaml`, `skip_specs: true`, and project custom schemas are inventoried.

Audit separates four different facts:

- `readiness.living` — living specs are mechanically readable;
- `readiness.active` — active deltas will not silently strand content;
- capability/service mappings, active change/feature mappings, rename identities, and authored artifact dispositions — human decisions still required (`readiness.mappingsResolved`, `changesResolved`, `renamesResolved`, and `dispositionsResolved` stay separate);
- `archiveDiagnostics` — anomalies in frozen history, reported but never allowed to block migration of living/active truth.

An audit that completed exits successfully even when it found blockers. Root, YAML and I/O failures still fail. This makes “the audit ran” distinct from `ready`/`mechanicallyCompatible`.

## Generate and complete the mapping

Audit is read-only by default. An explicit output path outside the OpenSpec source writes a non-overwriting skeleton:

```bash
loam audit-openspec /path/to/repo --write-mapping /tmp/openspec-map.yaml
```

The mapping is versioned and bound to both the canonical planning root and a SHA-256 inventory digest. Digest and artifact paths are planning-root relative regardless of whether audit receives the repository container or its `openspec/` directory (`@workspace/` is reserved for Store metadata outside that root):

```yaml
version: 1
source:
  root: /path/to/repo/openspec
  inventoryDigest: sha256:...

capabilities:
  payments/refunds:
    services:
      - payment-service
    suggestedServices:
      - refunds
    requirementServices:
      Authorize: []

changes:
  add-refund:
    feature: FEAT-12
    suggestedFeature: FEAT-1
    title: Add refund

renames:
  "changes/rename/specs/payments/spec.md:1:1":
    from: Old name
    to: New name
    existingRequirementId: null
    requirementId: payments.authorize

artifacts:
  changes/add-refund/proposal.md:
    kind: proposal
    disposition: convert-to-intent
    suggestedDisposition: convert-to-intent
  changes/add-refund/tasks.md:
    kind: tasks
    disposition: preserve-as-legacy-checklist
    suggestedDisposition: preserve-as-legacy-checklist
```

`suggestedServices`, `suggestedFeature`, and `suggestedDisposition` are hints, not decisions. The fields that count are `services`, an explicit `changes.<OpenSpec-id>.feature` plus `title`, `requirementId` where needed, and `disposition`. Feature ids use loam's `<word>-<number>` grammar and must be unique across active changes.

### Capability → service is a human decision

OpenSpec's unit is a capability; loam's unit is a service bound to the C4 landscape. A nested capability id stays nested (`payments/refunds`) rather than collapsing to `payments`. Mapping scope is the union of living capabilities and capabilities found only in active deltas, so a brand-new nested capability cannot disappear merely because it has not reached `specs/` yet.

- With one selected service, every requirement in the capability goes there.
- With several selected services, `requirementServices` must allocate every living **and active** requirement to one or more of them. Apply refuses an omitted allocation or a service outside the declared list.
- If two mapped capabilities would create the same heading/`Requirement-ID` in one service, apply refuses instead of guessing which requirement wins.

### Change → feature is explicit

Every active OpenSpec change gets one `changes.<id>` entry. Fill both the loam feature id and the human title. The skeleton deliberately leaves `feature: null` next to a deterministic suggestion; suggestions never make a migration ready. Unknown OpenSpec change ids, malformed feature ids, blank titles, and duplicate feature ids block apply.

### RENAMED keeps identity

Audit parses every OpenSpec FROM/TO pair and gives it a stable mapping key. FROM must select exactly one living requirement in that delta's capability. If that requirement already has a `Requirement-ID`, the skeleton reuses it and refuses a replacement; otherwise assign a valid id. Apply places that id on the staged living source and emits a `MODIFIED` requirement with the TO heading, the same body/scenarios, and an `OpenSpec-Living-Source` annotation. Conflicting targets, duplicate sources/targets, identity collisions, and multi-change rename chains block instead of being flattened to `REMOVED` + `ADDED`.

### Authored artifacts require explicit disposition

Every active `proposal.md`, `design.md`, and `tasks.md` appears in the mapping with `disposition: null` until a human chooses. A suggestion does not make migration ready.

Typical choices are:

- proposal → `convert-to-intent`;
- design → `review-as-feature-adr` (proposed decision material, not automatically an accepted ADR);
- tasks → `preserve-as-legacy-checklist` until progress/order information has been reviewed;
- `retain-read-only` or `manual-review` when conversion would overstate what is known.

## Dry-run and explicit apply

Validate the completed mapping without writing anything:

```bash
loam migrate-openspec /path/to/repo --map /tmp/openspec-map.yaml
loam migrate-openspec /path/to/repo --map /tmp/openspec-map.yaml --json
```

`--mapping` remains a deprecated spelling of `--map`. Dry-run is always the default and never creates the target.

Writing requires both flags:

```bash
loam migrate-openspec /path/to/repo \
  --map /tmp/openspec-map.yaml \
  --apply \
  --target /tmp/loam-migration-review
```

Before apply, loam repeats the audit and compares the fresh source root/digest with the mapping. Any source edit since review invalidates the mapping. The target must be absent or empty and must not overlap the OpenSpec source. Writes are staged and swapped with rollback; source files and live loam docs are never modified.

The target contains:

- `services/<service>/spec.md` with mapped living requirements and `status: draft`;
- `features/<FEAT>-<slug>/intent.md` for every active change;
- `features/<FEAT>-<slug>/specs/<service>/spec.md` with routed ADDED/MODIFIED/REMOVED sections for every non-`skip_specs` change;
- feature ADR/legacy files according to the explicit proposal/design/tasks dispositions, plus an exact read-only copy of the complete source change tree under `legacy/openspec/` so no authored artifact is silently lost;
- `migration-plan.json` with active changes, mappings, archive diagnostics and every artifact disposition;
- normalized `mapping.yaml`;
- `FOLLOW-UP.md` naming the work that still blocks a trustworthy fleet.

This is deliberately called **staged migration docs**, not a finished or green loam repository. Apply uses the reviewed feature ids and materializes active changes, but it does not invent C4 topology/deltas, OpenAPI contracts, source provenance, or vouch evidence. `skip_specs: true` changes still receive intent and legacy artifacts but no feature spec delta. Every feature therefore remains review material until the follow-up checklist is complete.

## What carries over mechanically

The exact-commit corpus gate checks living, active, and archived spec trees. OpenSpec v1.7.0 release `4e16790` contributes 207 Markdown files, 739 requirements, and 2273 scenarios; main canary `45cca5d` contributes 209, 742, and 2284. Both sweeps check parse/serialize/parse stability of requirement content. Nested bullets, fenced markup, removal prose, CRLF, BOM and non-ASCII names survive. `REMOVED` requirements with no scenarios remain legal.

Modern ADDED/MODIFIED/REMOVED deltas are readable, but “readable” is not “ready”: routing to services, loam frontmatter, Operations/Covers links and feature identity still require decisions.

## Shapes that need repair or review

- **Mixed legacy complete-state deltas.** Any BASE requirement stranded under `## Behavior`, `## Error Handling` or another prose heading is reported even if the same file also contains a valid ADDED/MODIFIED section. Re-home it before conversion. `## Requirements` remains the one explicitly non-merging quote section.
- **Spec-less changes.** They are valid only when a present, valid `.openspec.yaml` explicitly sets `skip_specs: true` and its named built-in or project custom schema resolves. A custom artifact graph never implies this opt-out by itself. Otherwise an active zero-delta change is a blocker. Explicit `skip_specs` suppresses generated feature specs while preserving intent, metadata, and authored legacy material.
- **Malformed RENAMED.** A rename-only delta is not “empty”, but every section must supply a FROM/TO pair and every active pair needs an identity decision.
- **External Store pointer.** A config-only code repo with `store: <id>` identifies external planning. Audit the registered Store checkout itself; loam does not guess a machine-local registry path.
- **Frozen archive history.** Legacy shapes are diagnostics only. Keep `changes/archive/` read-only where it is; do not reconstruct it as loam `features/archive/`, whose entries imply loam computed and snapshotted the merge.

## What must be added after staged apply

- Truthful `sources:` paths from each service repository, followed by human `loam vouch`; staged specs intentionally remain `status: draft`.
- `Operations:` links to provider OpenAPI `operationId`s, and `Covers:` links where architecture requirements are created.
- `architecture/landscape.likec4`, service `model.likec4`, and explicit fleet relationships.
- Service OpenAPI contracts and provider-before-consumer adoption where inbound edges already name operations.
- LikeC4 and OpenAPI deltas for the already mapped active feature ids (`FEAT-12`, `BUG-42`, and so on); OpenSpec's prose change id/title remains visible in the staged slug, annotations, plan, and preserved source tree.
- Human disposition of `config.yaml.context`, per-artifact rules, custom schemas/templates, Stores/references, Purpose prose and generated tool instructions.

## Modern artifact disposition guide

| OpenSpec artifact | Migration treatment |
|---|---|
| `config.yaml` (`schema`, `context`, `rules`, optional `store`) | Inventory and review. Move durable operating context into the docs contract; do not silently convert workflow rules into different validator semantics. |
| `specs/<nested/capability>/spec.md` | Map requirements to one or more services. Apply stages combined `services/<svc>/spec.md` files. |
| `specs/<capability>/design.md` | Review as a service ADR; do not mark accepted merely because the file existed. |
| `changes/<id>/.openspec.yaml` | Preserve schema/`skip_specs`/created metadata in the plan and exact feature-local legacy tree. |
| `changes/<id>/proposal.md` | Explicit `convert-to-intent`, or retain/manual-review in feature legacy material; the original is also preserved. |
| `changes/<id>/specs/**/spec.md` | Validate and route ADDED/MODIFIED/REMOVED requirements into the mapped feature/service delta, preserving delta kinds; keep the original beneath `legacy/openspec/`. |
| `changes/<id>/tasks.md` | Preserve as a non-authoritative feature-local legacy checklist with its explicit disposition until reviewed. |
| `changes/<id>/design.md` | Stage as proposed feature ADR material for `review-as-feature-adr`, otherwise retain as legacy; never imply acceptance merely because it existed. |
| `changes/archive/**` | Keep read-only as OpenSpec history; diagnostics do not gate living/active readiness. |
| `schemas/<name>/schema.yaml` and templates | Review custom workflow semantics. The schema name must resolve as a direct portable member of `schemas/`; even a workflow with no specs artifact still needs explicit valid `skip_specs: true` for a zero-spec change. |
| `.openspec-store/store.yaml`, `references`, Worksets | Record planning ownership/references for humans. They do not become a second loam fleet topology automatically. |
| OpenSpec-generated skills/commands/instruction blocks | Remove after cutover so agents do not receive two live process contracts. |

## Migration is one-way

loam reads OpenSpec; it never writes back into the OpenSpec workspace. Loam serialization does not preserve OpenSpec's required `## Purpose` and `## Requirements` framing as an OpenSpec round-trip contract. Migrate into a separate target, review it, cut over once, and retire the old tooling only after the staged follow-up is complete.
