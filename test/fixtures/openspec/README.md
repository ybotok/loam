# Third-party OpenSpec fixtures

Verbatim, unmodified spec files from the public **[Fission-AI/OpenSpec]** repository.
They exist so `test/openspec-compat.test.ts` can check `src/core/spec.ts` against
markdown that OpenSpec actually produces, instead of against markdown we invented
while reimplementing the format.

**Do not edit these files.** Their value is that they are byte-for-byte upstream. If a
test needs a variation (a BOM, a `RENAMED` section, a lowercase heading), the test
derives it in-memory from a fixture rather than editing one.

## Licence

Third-party content, MIT licensed, © the OpenSpec authors. See
<https://github.com/Fission-AI/OpenSpec/blob/main/LICENSE>. `loam` is also MIT, so
vendoring these for test purposes is compatible; the copyright is not ours.

## Provenance

Fetched 2026-08-03 from commit `45cca5db6137ed209117cc70510eb3e057fb981b` (then the
tip of `main`). Every URL below is a permalink at that commit, so re-fetching
reproduces the exact bytes:

    https://raw.githubusercontent.com/Fission-AI/OpenSpec/45cca5db6137ed209117cc70510eb3e057fb981b/<path>

| Local file | Upstream path | Why this one |
| --- | --- | --- |
| `living/cli-list.spec.md` | `openspec/specs/cli-list/spec.md` | Canonical living spec: `# H1`, `## Purpose`, `## Requirements`, nested bullets under `- **THEN**` steps. |
| `living/artifact-graph.spec.md` | `openspec/specs/artifact-graph/spec.md` | A recent, densely-scenarioed living spec (7 requirements / 28 scenarios), no fenced blocks. |
| `living/openspec-conventions.spec.md` | `openspec/specs/openspec-conventions/spec.md` | OpenSpec's meta-spec: it documents the format *and* quotes `### Requirement:`, `#### Scenario:` and `## RENAMED Requirements` markup inside fenced blocks. The hardest fence-tracking case in the corpus. |
| `delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md` | `openspec/changes/archive/2025-08-19-adopt-delta-based-changes/specs/cli-diff/spec.md` | Smallest file carrying all three delta sections at once (`REMOVED`, `MODIFIED`, `ADDED`), plus a `**Reason for removal**:` metadata paragraph. |
| `delta/2025-12-28-restructure-schema-directories__artifact-graph.spec.md` | `openspec/changes/archive/2025-12-28-restructure-schema-directories/specs/artifact-graph/spec.md` | Clean modern delta (`MODIFIED` + `ADDED`) that pairs with `living/artifact-graph.spec.md`, so a real delta can be merged onto its real living spec. |
| `delta/2026-02-17-merge-init-experimental__cli-init.spec.md` | `openspec/changes/archive/2026-02-17-merge-init-experimental/specs/cli-init/spec.md` | `REMOVED` requirements carrying no scenarios (only `**Reason**` / `**Migration**` prose), and a delta heading on line 1. |
| `delta/2025-08-19-add-skip-specs-archive-option__cli-archive.spec.md` | `openspec/changes/archive/2025-08-19-add-skip-specs-archive-option/specs/cli-archive/spec.md` | Legacy "complete future state" delta: most requirements sit under prose headings (`## Behavior`, `## Error Handling`) rather than under a delta heading. The main incompatibility this suite pins. |

## Checksums

    91b72e751906fa59efad37140f694908d5a0017c4290877f0feca0831d768ea3  living/artifact-graph.spec.md
    d45409dc9827051072c0495f2eb99e1a7cbbb63be87951f88478f2eb2daa0849  living/cli-list.spec.md
    af564ec163f3873b4618e83dde34c0ba288e18c991f2ba264e0761c183ee8054  living/openspec-conventions.spec.md
    a74495fbb3fb197ba4d3bdea5afee39f6a03d61f749c5f71820f3a9587550b32  delta/2025-08-19-add-skip-specs-archive-option__cli-archive.spec.md
    b08d0aeaf1a284fa6e1dd0411b0847c206b0dbc386f49da655ae25965ee509e6  delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md
    9ee2d6cfaa698e95de8743a35b178d93351152d8718885e1ebcaa180c17fcba0  delta/2025-12-28-restructure-schema-directories__artifact-graph.spec.md
    3bf342704d3de056aeb90ed14f1035e46ff979ef04ad338ef29688882891a1a2  delta/2026-02-17-merge-init-experimental__cli-init.spec.md

## Corpus these seven were drawn from

The seven were chosen after running `parseRequirements` over **all 157** spec files in
that commit (36 under `openspec/specs/**`, 121 under `openspec/changes/archive/**`):
614 requirements and 1846 scenarios in total. They cover every structural shape the
full corpus exhibits. Findings that only the full sweep can establish — e.g. that no
OpenSpec file anywhere uses a BOM, a lowercase `### requirement:` heading, a live
`## RENAMED Requirements` section, or a line our `Operations:` regex would capture —
are recorded in the header comment of `test/openspec-compat.test.ts`.

[Fission-AI/OpenSpec]: https://github.com/Fission-AI/OpenSpec
