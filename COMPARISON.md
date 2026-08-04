# loam vs OpenSpec

loam reimplements [OpenSpec](https://github.com/Fission-AI/OpenSpec)'s requirement format from the outside and deliberately leaves its machinery behind — [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) covers the mechanics of moving a repo. This page is the other half of that story: an honest comparison. Where loam is categorically ahead, where OpenSpec is simpler *and sufficient*, and what loam refuses to take even though the upstream has it. OpenSpec facts below are pinned to the corpus snapshot vendored under [`test/fixtures/openspec/`](test/fixtures/openspec/) plus the upstream's public state as of August 2026; the compatibility claims are enforced by [`test/openspec-compat.test.ts`](test/openspec-compat.test.ts), not asserted.

## The one-paragraph verdict

OpenSpec's own community documents two pains: **specs drift** until they contradict each other — nothing ties a spec to the code it describes, and validation is structural only — and there is **no unified system model**: capabilities are a flat list of directories, so the picture of how the system hangs together has to be reassembled by hand. loam is built around the two mechanisms that answer exactly those: a **trust chain** (`sources` → content digests → human `vouch` → mechanical `verify`, where a scenario counts as tested only when a green cucumber run says so) and a **C4 model at the center**, with every artifact joined to it by one ID spine and a three-axis coherence gate in front of every merge. The price is a steeper entry — LikeC4, frontmatter conventions, an operationId spine — and a young ecosystem against a very large one.

## Six axes

| Axis | OpenSpec | loam |
|---|---|---|
| **System model** | Flat capability specs; no elements, no relationships, no deployment view — "no unified system model" is an acknowledged limitation | C4 landscape ([LikeC4](https://likec4.dev)) at the center; behavior spec, architecture spec and OpenAPI joined to it by one ID spine (`FEAT-*`, service id, C4 element id, `operationId`) |
| **Change workflow** | Change folders with delta sections; textual merge, warn-and-continue; RENAMED supported | Three-axis transactional merge: the whole plan is computed before a byte is written, staged, snapshotted, rolled back on failure; a coherence gate blocks a merge the three axes disagree on; landscape insertion is service-grouped and order-independent, so concurrent archive PRs touching different services do not conflict by construction |
| **Executability** | Scenarios are bold-bullet markdown no BDD runner reads — "specs are documentation, not verifiable contracts" | `loam gherkin` emits real, digest-stamped `.feature` files; `loam verify --results` confirms a scenario **only** from a green cucumber run carrying that digest — an agent cannot *say* a scenario is tested |
| **Drift control** | None — validation checks markdown structure, never code correspondence | `sources` name the code a doc was written from; `vouch` stamps a sources digest and a content digest; `validate` then reports `sources.stale` (the code moved) and `content.stale` (the doc moved) fleet-wide |
| **AI integration** | 30+ tools, `/opsx:*` workflows, artifact-graph schemas | `AGENTS.md` travels with the docs as the self-sufficient contract; `loam init --tools` writes slash-command wrappers for Claude Code, Cursor, GitHub Copilot, Gemini CLI, opencode and Cline; the `adopt` brief is honest to a fault — it lists what will be checked *and what nothing checks* |
| **Entry curve & ecosystem** | `npm install`, plain markdown, minutes to first change; tens of thousands of stars, an active Discord, frequent releases | You learn LikeC4, frontmatter conventions and the operationId spine before the checks start paying you back; young project, small history |

## When OpenSpec is enough

Honesty cuts both ways. If you have **a single repository**, a small team, and **no cross-service API contracts**, most of what loam adds is weight you do not need: the C4 axis, two kinds of digest, an architecture requirement file. OpenSpec's "markdown spec and go" is simpler and, for that shape of project, sufficient. Use it.

## When loam

- A **fleet** of services where a business-simple feature routinely spans several of them, and the interesting failures live on the edges — a consumer calling an operation the provider's contract no longer defines.
- A **legacy adoption campaign**: docs written largely by agents, where an unverified corpus invites exactly the quiet fictions the trust chain exists to catch.
- A team that wants the **done-check mechanical**: not "the agent says it's done" but a derived checklist where scenario claims are answered by the test runner and everything else carries a `file:line`.

## What loam takes from OpenSpec

The requirement format, verbatim: `### Requirement:` headings, `#### Scenario:` blocks, the `## ADDED | MODIFIED | REMOVED Requirements` delta algebra. The entire vendored upstream corpus — 157 files, 614 requirements, 1846 scenarios — parses losslessly, and an already-archived OpenSpec change re-applied to the living spec it produced changes nothing: the merge algebras agree. The multi-tool slash-command mechanics (a content source plus thin per-tool format adapters) are also borrowed from OpenSpec's integration design — it earned that one.

## What loam deliberately refuses

Each of these exists upstream and was considered, not overlooked. The long-form reasoning lives in [SCHEMA.md](SCHEMA.md) under "Considered and rejected".

- **Workflow/DAG engine** (artifact-graph, `schema.yaml`): a feature's state is its frontmatter plus which directory it is in; an engine over that is a second place the state lives. A configurable workflow graph across a hundred services means a hundred potentially different workflows — and a fleet-wide green that means nothing.
- **Stores** (shared planning repos): the docs repo *is* the shared planning surface, and it has what Stores lack — a model of how the services relate.
- **`RENAMED` sections**: requirement identity is heading text, and the upstream's own rules for case/whitespace rename conflicts are the evidence of how brittle that is. loam makes the heading a loud error and asks for `REMOVED` + `ADDED`; the provenance of a rename stays recoverable by searching `features/archive/` for both names.
- **Writing OpenSpec back** (bidirectional compatibility): serializing through loam drops `## Purpose` and the `## Requirements` wrapper, both of which OpenSpec's parser requires. Pretending otherwise would corrupt someone's repo politely. Migration is one-way: migrate, then retire the old tooling.
- **TUI, worksets, profiles, authored `tasks.md`**: agents and CI get `--json`; humans get the files and the forge; task lists are derived so they cannot drift.

## Migrating

[MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — what carries over cleanly (almost everything), what is lost (RENAMED, `## Purpose` prose, legacy "complete future state" deltas), what must be added (frontmatter, `Operations:` lines, the C4 model), and a disposition table for every file in a real OpenSpec repo.
