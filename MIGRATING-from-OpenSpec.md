# Migrating from OpenSpec

loam reads OpenSpec requirement Markdown from the outside: `### Requirement:` headings, `#### Scenario:` blocks, and `## ADDED|MODIFIED|REMOVED Requirements` delta sections. Compatibility is measured, not inferred from a successful directory walk.

## Version matrix

> **Compatibility boundary:** the v1.9 exact-commit corpus is certified for the parser and one-way migration boundary documented here. That boundary is the Markdown and the staged migration, not OpenSpec's behavior: `audit-openspec` inventories v1.8/v1.9 workspace shapes, and loam does not reimplement v1.9 validation, archive recovery, capability retirement, Store or agent-delivery semantics.

| OpenSpec source | Exact pin | loam coverage | Status |
|---|---|---|---|
| [v1.9.0 release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.9.0) | `2826b8889e5223a9a8095d4428b60b56597e1020`, released 2026-08-13 | Full living + active + archived Markdown corpus sweep, seven verbatim regression fixtures re-vendored at this commit, and the documented audit/mapping/staged-apply path. | **Certified for this documented parser/migration boundary.** It is not bidirectional OpenSpec compatibility. |
| [v1.8.0 release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.8.0) | `d57889664cab4f2f061d236ec3ff82a5578701bb`, released 2026-08-05 | Audit inventories or preserves modern planning roots, Stores, nested capability paths, config context/rules/references, custom schemas/templates, per-change metadata, `skip_specs`, `RENAMED`, and authored artifacts. | **Inventoried, and superseded by the certified v1.9.0 pin.** No v1.8 exact-release sweep of its own runs; the shapes v1.8 introduced are carried by the v1.9 corpus. |
| [v1.7.0 release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.7.0) | `4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b` | The previously certified corpus, still swept file by file. | **Regression pin.** A parser change may not fix the current corpus by breaking the one somebody already migrated from. |
| Historical post-v1.7 `main` canary | `45cca5db6137ed209117cc70510eb3e057fb981b` | A third exact living + active + archived parser corpus. | **Regression pin only.** It is not a release and not a moving claim. |

The seven verbatim fixtures come from the v1.9.0 commit and run in routine CI. A scheduled/manual matrix separately sweeps all three pinned commits across living, active, and archived spec trees: v1.9.0 211 files / 746 requirements / 2317 scenarios; v1.7.0 207 / 739 / 2273; canary 209 / 742 / 2284. These test requirement/scenario parsing, not every v1.8/v1.9 workspace feature. The [fixture provenance, immutable upstream paths, and checksums](https://github.com/ybotok/loam/blob/main/test/fixtures/openspec/README.md) and the [compatibility tests](https://github.com/ybotok/loam/blob/main/test/openspec-compat.test.ts) use absolute GitHub URLs because this guide is also shipped in the npm tarball while `test/` is not.

OpenSpec v1.10.0 (released 2026-08-19) changed no requirement-Markdown format, so the certified v1.9.0 boundary also covers documents it writes; its workspace-level additions are inventoried like the v1.8/v1.9 shapes above.

An audit result of `ready: true` means that the particular files the installed loam inspected satisfy loam's documented migration checks. It is not a statement that every behavior of the OpenSpec version which created them has been certified. In particular, a v1.8/v1.9 `.openspec.yaml` field such as `retire_capabilities` is inventoried and preserved with the source tree, but loam does not translate OpenSpec capability retirement into a loam service or feature lifecycle action.

## Start with a read-only audit

```bash
loam audit-openspec /path/to/repo
loam audit-openspec /path/to/repo --json
```

The input may be a repository containing `openspec/`, the `openspec/` directory itself, or a Store checkout. Modern `config.yaml`, Store metadata, nested capability folders, per-change `.openspec.yaml`, `skip_specs: true`, and project custom schemas are inventoried.

For a **Store checkout** the planning shape decides the root and the store marker decides only the kind: the planning content may sit at the checkout root or under `<checkout>/openspec`, and a checkout with a `.openspec-store/store.yaml` but planning content in neither place is refused by name rather than audited as an empty, compatible workspace. Planning content in *both* places is the pre-existing `Ambiguous OpenSpec root` refusal, unchanged. A root that holds no living spec and no active change at all is never `ready` (`openspec.workspace-empty`): a verdict over a corpus nobody read is the one answer this command must not be able to give.

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

The mapping is versioned and bound to both the canonical planning root and a SHA-256 inventory digest. That digest covers the **living tree and the active changes only** — not `changes/archive/**`. Frozen history is reported as diagnostics that never gate, so letting a colleague's typo fix inside an archived change invalidate a 900-line mapping somebody spent a day completing was a cost with no safety behind it. An edit to a living spec or an active delta still invalidates it, which is the case the binding exists for.

Digest and artifact paths are planning-root relative regardless of whether audit receives the repository container or its `openspec/` directory (`@workspace/` is reserved for Store metadata outside that root):

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

The mapping of requirements to services stays a human decision — but the capability ids and their associations are preserved mechanically. Apply declares every living and active-horizon capability id in the target's `architecture/capabilities.yaml`, and every routed requirement carries a `Capability: <id>` line joining it back to that declaration, so migration is no longer the step where the analyst's capability structure is lost to everything but `legacy/`. `loam list capabilities` in the staged target answers "what realizes payments/refunds now" from day one.

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

Before apply, loam repeats the audit and compares the fresh source root/digest with the mapping. Any living or active source edit since review invalidates the mapping. The target must be absent or empty, must not overlap the OpenSpec source, and **must not sit inside a live loam fleet**: a target under the `docsDir` of a governing `loam.json` — or under any directory holding `architecture/landscape.likec4` — is refused, because every staged feature would otherwise be enumerated by `loam list` and `loam validate --all` as a phantom feature of the governing fleet. A sibling of `docsDir` is fine. Writes are staged and swapped with rollback; source files and live loam docs are never modified, and every refusal above leaves the target directory absent rather than half-written.

The target contains:

- `services/<service>/spec.md` with mapped living requirements and `status: draft`, each requirement carrying a `Capability:` line for the capability it was routed from;
- `architecture/capabilities.yaml` declaring the union of living and active-horizon capability ids (empty bodies — no description is invented, the authored `## Purpose` prose stays verbatim under `legacy/`);
- `features/<FEAT>-<slug>/intent.md` for every active change;
- `features/<FEAT>-<slug>/specs/<service>/spec.md` with routed ADDED/MODIFIED/REMOVED sections for every non-`skip_specs` change;
- feature ADR/legacy files according to the explicit proposal/design/tasks dispositions, plus an exact read-only copy of the complete source change tree under `legacy/openspec/`, **and the living capability tree verbatim under `legacy/openspec/specs/`** — `## Purpose` prose, section prose between a heading and its first requirement, and capability `design.md` have no loam equivalent, so they are copied rather than converted and nothing is silently lost;
- `migration-plan.json` with active changes, mappings, archive diagnostics and every artifact disposition;
- normalized `mapping.yaml`;
- `FOLLOW-UP.md` naming the work that still blocks a trustworthy fleet;
- and the target's own `loam.json` (`{"docsDir": "."}`), `AGENTS.md`, and an **empty** `architecture/landscape.likec4`. The target is therefore a standalone docs repo, which is what makes `FOLLOW-UP.md`'s instructions runnable where they are written: `loam validate --all`, `loam status`, `loam rebase <FEAT>` and `loam doctor` all work inside it. The landscape is laid down empty on purpose — OpenSpec carries no topology, and a generated one would be a guess presented as the map — so every staged service surfaces as exactly one `landscape.service-unmodelled`, which is follow-up item one.

This is deliberately called **staged migration docs**, not a finished or green loam repository. Apply uses the reviewed feature ids and materializes active changes, but it does not invent C4 topology/deltas, OpenAPI contracts, source provenance, or vouch evidence. `skip_specs: true` changes still receive intent and legacy artifacts but no feature spec delta. Every feature therefore remains review material until the follow-up checklist is complete.

## What carries over mechanically

The exact-commit corpus gate checks living, active, and archived spec trees. The certified corpus is the OpenSpec v1.9.0 release `2826b888`: 211 Markdown files, 746 requirements, and 2317 scenarios. The v1.7.0 release `4e16790` (207, 739, 2273) and the post-v1.7 main canary `45cca5d` (209, 742, 2284) remain as regression sweeps. All three sweeps check parse/serialize/parse stability of requirement content. Nested bullets, fenced markup, removal prose, CRLF, BOM and non-ASCII names survive. `REMOVED` requirements with no scenarios remain legal.

Modern ADDED/MODIFIED/REMOVED deltas are readable, but “readable” is not “ready”: routing to services, loam frontmatter, Operations/Covers links and feature identity still require decisions.

## Shapes that need repair or review

- **Mixed legacy complete-state deltas.** Any BASE requirement stranded under `## Behavior`, `## Error Handling` or another prose heading is reported even if the same file also contains a valid ADDED/MODIFIED section. Re-home it before conversion.
- **`## Requirements` inside an active change delta** is a **blocker** (`openspec.change-quoted-requirements`), which needs saying plainly because it is the shape OpenSpec's own living-spec template mandates and it looks correct. In a *living* spec that heading is the requirements section; in a *change delta* it is the one explicitly non-merging quote section, so requirements sitting under it stage nothing. loam refuses rather than counting requirements it cannot route — which is also what guarantees the per-change requirement counts in `migration-plan.json` equal what apply actually stages. Re-home them under `ADDED`, `MODIFIED` or `REMOVED`.
- **Markdown under `specs/` named neither `spec.md` nor `design.md`** (`openspec.nonstandard-living-spec`) — a `Spec.md` on a case-sensitive filesystem, a `spec.markdown`, a hand-split `part-2.md`. No capability reads it, so migrating would leave its requirements behind. This is the living twin of the same check on change specs.
- **Dot-prefixed directories under `changes/`** (`openspec.hidden-change-directory`) — a `.wip-refunds/` convention. They are not enumerated as changes, so nothing under them migrates. loam blocks rather than walking them: rename or move the directory before migrating, and its content is never silently dropped. Under `changes/archive/` the same finding is an archive diagnostic and does not gate, because frozen history never blocks.
- **An ISO-8601 `created` timestamp** in `.openspec.yaml` is a valid date. It used to fail the whole workspace; a calendar date with an optional time and offset is now accepted.
- **Spec-less changes.** They are valid only when a present, valid `.openspec.yaml` explicitly sets `skip_specs: true` and its named built-in or project custom schema resolves. A custom artifact graph never implies this opt-out by itself. Otherwise an active zero-delta change is a blocker. Explicit `skip_specs` suppresses generated feature specs while preserving intent, metadata, and authored legacy material. **This is the blocker a live workspace hits first** (`openspec.change-no-specs`): a change still at the proposal stage of OpenSpec's artifact pipeline has a `proposal.md` and no `specs/` tree yet, which is normal upstream and unmigratable here. Finish it, archive it, or migrate from a commit that predates it — the audit names the directory.
- **v1.8/v1.9 lifecycle metadata.** `retire_capabilities` changes what OpenSpec archive is allowed to delete when the last requirement is removed. loam records the metadata field and preserves the exact change tree, but does not infer that an OpenSpec capability is a loam service or translate retirement into a loam deletion. Review that intent manually before apply and express any loam retirement through loam's own modeled change.
- **Malformed RENAMED.** A rename-only delta is not “empty”, but every section must supply a FROM/TO pair and every active pair needs an identity decision.
- **External Store pointer.** A config-only code repo with `store: <id>` identifies external planning. Audit the registered Store checkout itself; loam does not guess a machine-local registry path.
- **Frozen archive history.** Legacy shapes are diagnostics only. Keep `changes/archive/` read-only where it is; do not reconstruct it as loam `features/archive/`, whose entries imply loam computed and snapshotted the merge.

## What must be added after staged apply

- Truthful `sources:` paths from each service repository, followed by human `loam vouch`; staged specs intentionally remain `status: draft`.
- `Operations:` links to provider OpenAPI `operationId`s, and `Covers:` links where architecture requirements are created.
- `architecture/landscape.likec4`, service `model.likec4`, and explicit fleet relationships.
- Service OpenAPI contracts and provider-before-consumer sequencing where inbound edges already name operations.
- LikeC4 and OpenAPI deltas for the already mapped active feature ids (`FEAT-12`, `BUG-42`, and so on); OpenSpec's prose change id/title remains visible in the staged slug, annotations, plan, and preserved source tree.
- Human disposition of `config.yaml.context`, per-artifact rules, custom schemas/templates, Stores/references, Purpose prose and generated tool instructions.

## Modern artifact disposition guide

| OpenSpec artifact | Migration treatment |
|---|---|
| `config.yaml` (`schema`, `context`, `rules`, optional `store`) | Inventory and review. Move durable operating context into the docs contract; do not silently convert workflow rules into different validator semantics. |
| `specs/<nested/capability>/spec.md` | Map requirements to one or more services. Apply stages combined `services/<svc>/spec.md` files, declares the capability id in `architecture/capabilities.yaml`, and stamps each routed requirement with a `Capability:` line. |
| `specs/<capability>/design.md` | Review as a service ADR; do not mark accepted merely because the file existed. |
| `changes/<id>/.openspec.yaml` | Preserve schema/`skip_specs`/created and all inventoried field names in the plan and exact feature-local legacy tree. Current fields such as `retire_capabilities` are not silently converted into loam lifecycle actions. |
| `changes/<id>/proposal.md` | Explicit `convert-to-intent`, or retain/manual-review in feature legacy material; the original is also preserved. |
| `changes/<id>/specs/**/spec.md` | Validate and route ADDED/MODIFIED/REMOVED requirements into the mapped feature/service delta, preserving delta kinds; keep the original beneath `legacy/openspec/`. |
| `changes/<id>/tasks.md` | Preserve as a non-authoritative feature-local legacy checklist with its explicit disposition until reviewed. |
| `changes/<id>/design.md` | Stage as proposed feature ADR material for `review-as-feature-adr`, otherwise retain as legacy; never imply acceptance merely because it existed. |
| `changes/archive/**` | Keep read-only as OpenSpec history; diagnostics do not gate living/active readiness. |
| `schemas/<name>/schema.yaml` and templates | Review custom workflow semantics. The schema name must resolve as a direct portable member of `schemas/`; even a workflow with no specs artifact still needs explicit valid `skip_specs: true` for a zero-spec change. |
| `.openspec-store/store.yaml`, `references`, Worksets | Record planning ownership/references for humans. They do not become a second loam fleet topology automatically. |
| OpenSpec-generated skills/commands/instruction blocks | Remove after cutover so agents do not receive two live process contracts. |

## Cutting over

The staged target has two halves, and only one of them moves.

1. Work `FOLLOW-UP.md` until `loam validate --all` **inside the target** is green. That is the gate; nothing before it means anything, because a staged target is deliberately red on arrival.
2. Move `services/` and `features/` into the live fleet.
3. Leave the rest behind: `legacy/`, `mapping.yaml`, `migration-plan.json`, `FOLLOW-UP.md`, and the target's own `loam.json` and `AGENTS.md` are review residue. They exist so a human can check the conversion, and the live fleet has its own copies of the last two.
4. Remove OpenSpec's generated skills, commands and instruction blocks from every repo, so agents stop receiving two live process contracts.

## Migration is one-way

loam reads OpenSpec; it never writes back into the OpenSpec workspace. Loam serialization does not preserve OpenSpec's required `## Purpose` and `## Requirements` framing as an OpenSpec round-trip contract — but the source framing is not lost either: the verbatim living tree under `legacy/openspec/specs/` is what makes "no authored artifact is silently lost" cover living capabilities and not only change trees. Migrate into a separate target, review it, cut over once, and retire the old tooling only after the staged follow-up is complete.
