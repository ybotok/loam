# Third-party OpenSpec fixtures

Verbatim, unmodified spec files from the public **[Fission-AI/OpenSpec]** repository.
They exist so `test/openspec-compat.test.ts` can check `src/core/document/` against
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

The released behavior baseline is **OpenSpec v1.9.0**, tag commit
`2826b8889e5223a9a8095d4428b60b56597e1020`, released 2026-08-13 — the current
upstream release, and at the time of vendoring also the tip of `main`. These
fixtures were re-vendored from that commit on 2026-08-18. Six of the seven were
byte-identical to the 2026-08-03 canary they came from before; only
`living/openspec-conventions.spec.md` moved, when upstream #1508 rewrote its
capability paths as `<capability-path>/ # One or more directories` to document
nested capabilities. Every URL below is a permalink at the v1.9.0 commit, so
re-fetching reproduces the exact bytes:

    https://raw.githubusercontent.com/Fission-AI/OpenSpec/2826b8889e5223a9a8095d4428b60b56597e1020/<path>

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
    b6730156d02c1a04722d6065cd509a2c620cee5d35f4afe7c39d710911aca861  living/openspec-conventions.spec.md
    a74495fbb3fb197ba4d3bdea5afee39f6a03d61f749c5f71820f3a9587550b32  delta/2025-08-19-add-skip-specs-archive-option__cli-archive.spec.md
    b08d0aeaf1a284fa6e1dd0411b0847c206b0dbc386f49da655ae25965ee509e6  delta/2025-08-19-adopt-delta-based-changes__cli-diff.spec.md
    9ee2d6cfaa698e95de8743a35b178d93351152d8718885e1ebcaa180c17fcba0  delta/2025-12-28-restructure-schema-directories__artifact-graph.spec.md
    3bf342704d3de056aeb90ed14f1035e46ff979ef04ad338ef29688882891a1a2  delta/2026-02-17-merge-init-experimental__cli-init.spec.md

## Full corpus gate

The scheduled/manual corpus gate runs `parseRequirements` over every tracked Markdown
file below living, active, and archived spec trees at three exact commits:

| `--baseline` | Commit | Files | Requirements | Scenarios |
| --- | --- | --- | --- | --- |
| `release` (v1.9.0) | `2826b8889e5223a9a8095d4428b60b56597e1020` | 211 | 746 | 2317 |
| `legacy` (v1.7.0) | `4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b` | 207 | 739 | 2273 |
| `canary` (post-v1.7 `main`) | `45cca5db6137ed209117cc70510eb3e057fb981b` | 209 | 742 | 2284 |

The older two are kept because a parser change that fixes the current corpus by
breaking an older one would break a repository somebody has already migrated from.
The seven vendored files remain the routine offline regression set; the
exact-checkout sweeps detect corpus-wide drift.

To reproduce a sweep, use a clean checkout at the selected exact commit:

    git clone https://github.com/Fission-AI/OpenSpec.git /tmp/OpenSpec
    git -C /tmp/OpenSpec checkout 2826b8889e5223a9a8095d4428b60b56597e1020
    npm run test:openspec-corpus -- --baseline release /tmp/OpenSpec

    git -C /tmp/OpenSpec checkout 4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b
    npm run test:openspec-corpus -- --baseline legacy /tmp/OpenSpec

    git -C /tmp/OpenSpec checkout 45cca5db6137ed209117cc70510eb3e057fb981b
    npm run test:openspec-corpus -- --baseline canary /tmp/OpenSpec

The script refuses another commit or locally modified corpus paths and checks the
baseline-specific totals, so a future upstream checkout cannot silently masquerade as
any pinned baseline. The script itself is typechecked by `npm run typecheck` through
`tsconfig.scripts.json`: it once spent eight days failing at module resolution
because only `src/` was compiled and this gate runs on a schedule.

[Fission-AI/OpenSpec]: https://github.com/Fission-AI/OpenSpec
