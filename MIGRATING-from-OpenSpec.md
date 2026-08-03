# Migrating from OpenSpec

loam reimplements OpenSpec's requirement format from the outside: `### Requirement:` headings, `#### Scenario:` Given/When/Then blocks, `## ADDED|MODIFIED|REMOVED Requirements` delta sections. Compatibility is not assumed — it is pinned in `test/openspec-compat.test.ts`, which runs loam's parser over verbatim spec files vendored from [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (all provenance in [`test/fixtures/openspec/README.md`](test/fixtures/openspec/README.md)). Everything below is transcribed from those pins, including what loam gets wrong.

## What carries over cleanly

Every requirement and scenario in the upstream corpus — 157 files, 614 requirements, 1846 scenarios — parses with the same names, the same delta kinds, and lossless round-trip of the bodies. Nested bullets, fenced blocks quoting markup, `**Reason for removal**:` prose, CRLF, a leading BOM, and non-ASCII requirement names all survive. A `REMOVED` requirement with no scenarios is legal, as upstream writes them. An already-archived OpenSpec change re-applied to the living spec it produced changes nothing — the merge algebra agrees with OpenSpec's.

## The capability → service mapping is a human decision

OpenSpec's unit is the capability (`openspec/specs/<capability>/spec.md`); loam's is the service — a directory under `services/` bound to an element in the C4 landscape. Some capabilities are one service, some span several, some are a slice of one. Nothing mechanical can make that call, and loam does not try: decide where each capability's requirements live, and move them into the owning services' `services/<svc>/spec.md` under `## Requirements`.

## Migration is one-way

**loam reads OpenSpec; it never writes it.** Serializing drops `## Purpose` and the `## Requirements` wrapper, and OpenSpec's own `parseSpec` throws without both — so a spec that round-trips through loam intact is still rejected by OpenSpec's parser. Do not plan on a shared repo or a return path: migrate, then retire the OpenSpec tooling.

## What is lost

- **`## RENAMED Requirements`** — OpenSpec's fourth delta operation. loam does not merge renames, and since the section parses to zero requirements, no counting check can catch it — so the heading itself is a **loud error** (`delta.unknown-section`) telling the author to express the rename as a `REMOVED` requirement plus an `ADDED` one.
- **`## Purpose` prose and the `# H1` title** — invisible to every check. A living spec file keeps whatever prose is left in it (`loam archive` rewrites only the `## Requirements` section), but nothing reads it; a capability's "why" belongs in a feature's `intent.md` going forward.
- **Legacy "complete future state" deltas** — requirements under prose headings (`## Behavior`, `## Error Handling`) parse but carry no delta kind, so the merge skips them. Each one is named by `delta.requirement-not-merged` — a warning, so `loam validate` stays green on the legal OpenSpec shape, but it **gates `loam archive`**: the merge would silently drop the requirement. A delta whose requirements are *all* outside delta sections is refused outright (`delta.no-delta-sections`, error): it would merge nothing. Re-home such requirements under a real delta heading before archiving.

## What must be added

- **Frontmatter** — `service:` and `status:` on every living spec (plus `sources:` naming the code it was written from, so `loam vouch` has something to stamp). `loam validate` warns on absent fields and errors on a mismatched `service:` or an undocumented `status:`.
- **`Operations:` lines** — loam's extension, absent upstream (no corpus file has one, and none accidentally matches the regex). Until requirements carry them, the API axis is unchecked and `loam validate` says so per service: `api.ops-unlinked`.
- **`model.likec4` and a landscape element** — the C4 center OpenSpec never had. `loam adopt --service <id>` emits the brief for an agent to write the baseline model, spec and OpenAPI from the code.

Two smaller deltas in strictness, both pinned: heading matching is case-sensitive (`### requirement:` parses to nothing — no upstream file relies on lowercase), and RFC-2119 keywords are opaque body text (coverage is keyed off scenarios, which every upstream living requirement has anyway).
