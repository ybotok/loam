# Migrating from OpenSpec

loam reimplements OpenSpec's requirement format from the outside: `### Requirement:` headings, `#### Scenario:` Given/When/Then blocks, `## ADDED|MODIFIED|REMOVED Requirements` delta sections. Compatibility is not assumed. Routine CI runs `test/openspec-compat.test.ts` over seven representative, verbatim files from [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (all provenance in [`test/fixtures/openspec/README.md`](test/fixtures/openspec/README.md)); `npm run test:openspec-corpus -- /path/to/OpenSpec` reproduces the larger result against the exact pinned v1.7.0 checkout. Everything below includes the known incompatibilities rather than hiding them.

## What carries over cleanly

At pinned commit `45cca5db6137ed209117cc70510eb3e057fb981b`, the optional sweep parses 157 Markdown files in the living and archived spec trees, 614 requirements, and 1846 scenarios and checks parse/serialize/parse stability of the requirement content. The seven files kept in this repository cover the representative living and delta shapes in the normal regression suite. Nested bullets, fenced blocks quoting markup, `**Reason for removal**:` prose, CRLF, a leading BOM, and non-ASCII requirement names survive. A `REMOVED` requirement with no scenarios is legal, as upstream writes them. An already-archived OpenSpec change re-applied to the living spec it produced changes nothing — the merge algebra agrees with OpenSpec's.

## The capability → service mapping is a human decision

OpenSpec's unit is the capability (`openspec/specs/<capability>/spec.md`); loam's is the service — a directory under `services/` bound to an element in the C4 landscape. Some capabilities are one service, some span several, some are a slice of one. Nothing mechanical can make that call, and loam does not try: decide where each capability's requirements live, and move them into the owning services' `services/<svc>/spec.md` under `## Requirements`.

## Migration is one-way

**loam reads OpenSpec; it never writes it.** Serializing drops `## Purpose` and the `## Requirements` wrapper, and OpenSpec's own `parseSpec` throws without both — so a spec that round-trips through loam intact is still rejected by OpenSpec's parser. Do not plan on a shared repo or a return path: migrate, then retire the OpenSpec tooling.

## What is lost

- **`## RENAMED Requirements`** — OpenSpec's fourth delta operation. loam does not merge renames, and since the section parses to zero requirements, no counting check can catch it — so the heading itself is a **loud error** (`delta.unknown-section`) telling the author to express the rename as a `REMOVED` requirement plus an `ADDED` one.
- **`## Purpose` prose and the `# H1` title** — invisible to every check. A living spec file keeps whatever prose is left in it (`loam archive` rewrites only the `## Requirements` section), but nothing reads it; a capability's "why" belongs in a feature's `intent.md` going forward.
- **Legacy "complete future state" deltas** — requirements under prose headings (`## Behavior`, `## Error Handling`) parse but carry no delta kind, so the merge skips them. Each one is named by `delta.requirement-not-merged` — a warning, so `loam validate` stays green on the legal OpenSpec shape, but it **gates `loam archive`**: the merge would silently drop the requirement. A delta whose requirements are *all* outside delta sections is refused outright (`delta.no-delta-sections`, error): it would merge nothing. Re-home such requirements under a real delta heading before archiving.

## What must be added

- **Frontmatter** — `service:` and `status:` on every living spec (plus `sources:` naming the code it was written from — literal files and directories, never glob patterns — so `loam vouch` has something to stamp). `loam validate` warns on absent fields and errors on a mismatched `service:` or an undocumented `status:`.
- **`Operations:` lines** — loam's extension, absent upstream (no corpus file has one, and none accidentally matches the regex). Until requirements carry them, the API axis is unchecked and `loam validate` says so per service: `api.ops-unlinked`.
- **`model.likec4` and a landscape element** — the C4 center OpenSpec never had. `loam adopt --service <id>` emits the brief for an agent to write the baseline model, spec and OpenAPI from the code.

Two smaller deltas in strictness, both pinned: heading matching is case-sensitive (`### requirement:` parses to nothing — no upstream file relies on lowercase), and RFC-2119 keywords are opaque body text (coverage is keyed off scenarios, which every upstream living requirement has anyway).

## Where every file goes

A real OpenSpec repo is more than spec files. The full layout — pinned by OpenSpec's own meta-spec, vendored at [`test/fixtures/openspec/living/openspec-conventions.spec.md`](test/fixtures/openspec/living/openspec-conventions.spec.md) — is `openspec/project.md`, `openspec/AGENTS.md`, `openspec/specs/<capability>/spec.md` (plus an optional `design.md`), `openspec/changes/<change-id>/{proposal.md, tasks.md, design.md (optional), specs/<capability>/spec.md}`, and `openspec/changes/archive/<date>-<id>/`; newer OpenSpec additionally manages an `<openspec-instructions>` block in the repo root's `AGENTS.md` and per-tool slash commands. Every artifact has a disposition, and none of them is converted by tooling — migration is judgment work, so building a converter would only automate the judgment away:

| OpenSpec artifact | Disposition |
|---|---|
| `specs/<capability>/spec.md` | Requirements move into the owning services' `services/<svc>/spec.md` under `## Requirements`. Which service owns which capability is the human decision covered above. |
| `specs/<capability>/design.md` | Service-level ADR under `services/<svc>/adrs/` — it records established patterns, which is decision material, not requirement material. |
| `changes/<id>/` in flight | Finish it under OpenSpec first, or convert it into a `features/<FEAT>/` (rows below). Never run both tools over one change. |
| `changes/<id>/proposal.md` | `features/<FEAT>/intent.md` — the same job under a different name: why, what, impact. |
| `changes/<id>/specs/<capability>/spec.md` | `features/<FEAT>/specs/<svc>/spec.md`. Modern delta-sectioned files carry over verbatim; legacy "complete future state" files hit the checks in "What is lost" above and need re-homing before they archive. |
| `changes/<id>/tasks.md` | **Discard.** loam derives the task list (`loam delta`, `loam verify`), so it cannot drift from the delta it came from; an authored copy could — SCHEMA.md's "Considered and rejected" records the decision. What a stale checklist knew that the delta does not is nothing. |
| `changes/<id>/design.md` | Feature-level ADR under `features/<FEAT>/adrs/`, not an appendix to `intent.md`: intent answers *why* and design answers *how*, and folding the two together would blur the one document a reviewer reads first. |
| `changes/archive/` | **Do not convert.** Keep it read-only where it is, as history. loam's `features/archive/` starts empty on purpose: an entry there means `loam archive` computed the merge and snapshotted the bytes it overwrote, and a converted OpenSpec archive would be an unverifiable reconstruction wearing that uniform. The frozen tree stays greppable, which is all history owes anyone. |
| `project.md` | Its content becomes the preamble and conventions of the docs repo's `AGENTS.md` — project context is process contract, and that file travels with the docs. |
| `openspec/AGENTS.md`, the `<openspec-instructions>` block, per-tool slash commands | **Remove after migration.** `loam init` writes its own `AGENTS.md` into the docs repo and the `/loam-*` commands into `.claude/commands/` — or into other agent tools' command directories via `init --tools`; two live instruction sets means an agent obeying whichever it read last. |

**Feature ids.** `loam new` requires `<word>-<number>` (`ID_RE` in `src/commands/new.ts`), and the id must survive being read back off the directory name (`featureIdFromDirName` in `src/core/repo.ts`). OpenSpec change names are kebab prose (`add-two-factor-auth`), which is not a valid id — so assign sequential ids and keep the old name as the slug: `loam new FEAT-12 --title "Add two factor auth"` scaffolds `features/FEAT-12-add-two-factor-auth/`, which reads back as exactly `FEAT-12`. The round-trip holds even for slugs that open with a digit (`FEAT-12-2fa-rollout` → `FEAT-12`), so no old change name can corrupt the id it is filed under.

**Adoption order.** Adopt provider services before their consumers. A service's `loam adopt` brief includes what the landscape already says about it — its inbound edges, and the `expects` list: the operationIds the fleet already calls, which its new `openapi.yaml` must define or `spine.op-undefined` fires the moment it lands. Providers first means each consumer is later adopted against contracts that exist; consumers first means edges into services whose contracts are still unwritten, and every such edge is a check deferred.

**Renames flatten.** Rename history is intentionally lost in the flattening — a rename becomes `REMOVED` + `ADDED` with no link between them — and the provenance of a renamed requirement is still recoverable by searching `features/archive/` for both names, which turns up the feature that retired the old one and the feature that introduced the new one.
