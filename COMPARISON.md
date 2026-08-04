# loam vs OpenSpec

loam reimplements part of [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s requirement format from the outside and deliberately makes different workflow choices — [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) covers the mechanics of moving a repo. OpenSpec facts below are pinned to **v1.7.0**, commit `45cca5db6137ed209117cc70510eb3e057fb981b`, rather than an evergreen claim about upstream. Routine CI runs [`test/openspec-compat.test.ts`](test/openspec-compat.test.ts) over **seven representative, verbatim fixtures**. The historical all-corpus result is reproducible, but opt-in: `npm run test:openspec-corpus -- /path/to/OpenSpec` checks all 157 Markdown files in the living and archived spec trees of a clean checkout at that exact commit.

## The one-paragraph verdict

OpenSpec v1.7.0 is the lower-friction choice for planning and evolving behavior in a repository. It also has beta Stores for planning shared across repositories, configurable artifact graphs, broad agent-tool integrations, `RENAMED` requirements, and an agent-led `/opsx:verify` review. loam targets a narrower fleet problem: it persists a **trust chain** (`sources` → content digests → human `vouch`), puts a **C4 service topology at the center**, joins behavior, architecture, and OpenAPI through one ID spine, and can accept scenario evidence from a real Cucumber run. That additional structure costs setup and concepts, and loam's ecosystem and release history are much younger.

## Six axes

| Axis | OpenSpec | loam |
|---|---|---|
| **System model** | Capability-oriented specs. Beta Stores place shared planning in a separate Git repo, but do not define service elements, relationships, or deployment views. | C4 landscape ([LikeC4](https://likec4.dev)) at the center; behavior spec, architecture spec, and OpenAPI joined by `FEAT-*`, service id, C4 element id, and `operationId`. |
| **Change workflow** | Change folders with delta sections and configurable artifact graphs. Archive prepares and validates all target specs before writing, supports `RENAMED`, then writes targets sequentially and moves the change. | Three-axis merge across requirements, OpenAPI, and landscape. The plan is computed first, gated for cross-axis coherence, staged, snapshotted, and rolled back if a write fails; `unarchive` restores recorded bytes. |
| **Implementation evidence** | `/opsx:verify` instructs the active coding agent to search code and tests for completeness, correctness, and coherence. It is useful but advisory and its conclusions depend on that run. | `loam verify` derives stable claims. Agent answers carry `file:line` evidence; scenario claims can only be confirmed by digest-matched green Cucumber results. |
| **Drift control** | CLI validation checks planning structure. Agent-led verify can find implementation drift on demand; v1.7.0 does not persist file/content attestations for later mechanical comparison. | `sources` name the code a doc was written from; `vouch` stamps source and content digests; later validation reports code movement (`sources.stale`) and doc movement (`content.stale`). |
| **Multi-repo & topology** | Stores address cross-repo sharing and Git-backed planning ownership. Service topology and contract edges remain outside the requirement model. | One docs repo is both shared planning surface and explicit fleet topology; cross-service calls are checked against provider operationIds. |
| **AI integration & entry curve** | Broad generated skills/commands, profiles, schemas, and plain Markdown make the first change quick. | A smaller integration surface, plus LikeC4, frontmatter, and the operationId spine to learn before the fleet checks pay off. |

## When OpenSpec is enough

Honesty cuts both ways. If you have **a single repository**, a small team, and **no cross-service API contracts**, most of what loam adds is weight you do not need: the C4 axis, two kinds of digest, an architecture requirement file. OpenSpec's "markdown spec and go" is simpler and, for that shape of project, sufficient. Use it.

## When loam

- A **fleet** of services where a business-simple feature routinely spans several of them, and the interesting failures live on the edges — a consumer calling an operation the provider's contract no longer defines.
- A **legacy adoption campaign**: docs written largely by agents, where an unverified corpus invites exactly the quiet fictions the trust chain exists to catch.
- A team that wants the **done-check mechanical**: not "the agent says it's done" but a derived checklist where scenario claims are answered by the test runner and everything else carries a `file:line`.

## What loam takes from OpenSpec

The core requirement shape: `### Requirement:` headings, `#### Scenario:` blocks, and the `## ADDED | MODIFIED | REMOVED Requirements` delta algebra. Seven upstream files are vendored as representative regression fixtures. A separate sweep of the pinned v1.7.0 checkout checks 157 Markdown files in its living and archived spec trees, 614 requirements, and 1846 scenarios, including parse/serialize/parse stability of the requirement content; it is not disguised as part of the default offline suite. The multi-tool slash-command pattern — one content source plus thin per-tool adapters — is also borrowed from OpenSpec's integration design.

## What loam deliberately refuses

Each of these exists upstream and was considered, not overlooked. The long-form reasoning lives in [SCHEMA.md](SCHEMA.md) under "Considered and rejected".

- **Workflow/DAG engine** (artifact-graph, `schema.yaml`): a feature's state is its frontmatter plus which directory it is in; an engine over that is a second place the state lives. A configurable workflow graph across a hundred services means a hundred potentially different workflows — and a fleet-wide green that means nothing.
- **Stores as a second abstraction**: OpenSpec's beta Stores solve a real cross-repo ownership problem. loam keeps one shared docs repo as its planning surface because that same repo also owns the service topology; adopting both mechanisms would create two locations for fleet planning.
- **`RENAMED` sections**: requirement identity is heading text, and the upstream's own rules for case/whitespace rename conflicts are the evidence of how brittle that is. loam makes the heading a loud error and asks for `REMOVED` + `ADDED`; the provenance of a rename stays recoverable by searching `features/archive/` for both names.
- **Writing OpenSpec back** (bidirectional compatibility): serializing through loam drops `## Purpose` and the `## Requirements` wrapper, both of which OpenSpec's parser requires. Pretending otherwise would corrupt someone's repo politely. Migration is one-way: migrate, then retire the old tooling.
- **TUI, worksets, profiles, authored `tasks.md`**: agents and CI get `--json`; humans get the files and the forge; task lists are derived so they cannot drift.

## Migrating

[MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — what carries over cleanly (almost everything), what is lost (RENAMED, `## Purpose` prose, legacy "complete future state" deltas), what must be added (frontmatter, `Operations:` lines, the C4 model), and a disposition table for every file in a real OpenSpec repo.
