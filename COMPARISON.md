# Where loam fits

loam is not a replacement for an architecture renderer, a software catalog, a contract-testing
broker, an API-diff engine, or a code-level architecture test. It is the layer that keeps an
authored C4 model, requirements, contracts and verification evidence semantically connected while
the system changes. Most of the tools below can sit beside it; the useful question is which part of
the problem each one should own. One section is different in kind and carries a date: the
spec-driven change tools overlap loam's own job, and they change every week.

## Architecture as code: LikeC4 and Structurizr

[LikeC4](https://likec4.dev/) and the [Structurizr
DSL](https://docs.structurizr.com/dsl) describe architecture as code and turn it into navigable C4
views. They own modeling and visualization; loam deliberately uses LikeC4 for that job instead of
building another renderer. loam adds checked joins from the model to requirements, contracts and
evidence, plus the feature transaction that changes those artifacts together. Structurizr is an
alternative modeling environment, not a format loam currently reads.

## Software catalogs: Backstage

The [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) makes
software components, APIs, ownership and dependencies discoverable across an organization. It is
the stronger home for inventory, search, team ownership and a portal assembled from many systems.
loam keeps a smaller Git-native authority for architecture change: it checks what a feature means
across authored artifacts, but it does not provide a catalog server, discovery pipeline or portal.

## Architecture and event catalogs: EventCatalog

[EventCatalog](https://www.eventcatalog.dev/) gives domains, systems, services, APIs, events,
schemas and owners a connected, versioned and searchable documentation experience, with generation
from contract sources. It is closer to loam's subject matter than a general software catalog and is
the better presentation and discovery surface for event-driven architecture. loam's distinct job is
the local change protocol: exact requirement/model/contract joins, a deterministic validation gate
and a rollback-capable merge into living documents. There is no built-in connector between the two
today.

## Contract verification and deployability: Pact Broker

The [Pact Broker](https://docs.pact.io/pact_broker/overview) stores consumer contracts and provider
verification results; its [`can-i-deploy`](https://docs.pact.io/pact_broker/can_i_deploy) decision
uses tested application versions and deployment environments. That is stronger runtime-facing
evidence than loam's documentation and attestation record. loam sees a wider design transaction —
C4, requirements, OpenAPI, AsyncAPI and feature intent — but has no environment matrix and does not
replace consumer-driven contract tests.

## Contract change detection: oasdiff and buf

[oasdiff](https://github.com/oasdiff/oasdiff) and [Buf breaking-change
detection](https://buf.build/docs/breaking/overview/) inspect contract revisions in much greater
depth than loam. They answer whether an OpenAPI or Protobuf change is structurally breaking; loam
answers which authored consumers and requirements are joined to the operation or message being
changed — `loam diff` names them for a removal, a deprecation, and a modification of the operation
or anything its `$ref`s reach — and never whether the change breaks them. Authored means drawn or
written in the docs repo: a caller the map does not draw is invisible to it, and one drawn without
an operation on its edge is reported as a consumer nobody could check. Use the specialist diff in
CI beside loam rather than expecting either tool to infer the other half.

## Requirements traceability: OpenFastTrace, Doorstop, StrictDoc and Sphinx-Needs

[OpenFastTrace](https://github.com/itsallcode/openfasttrace/blob/main/doc/user_guide.md),
[Doorstop](https://doorstop.readthedocs.io/en/latest/),
[StrictDoc](https://strictdoc.readthedocs.io/) and
[Sphinx-Needs](https://sphinx-needs.readthedocs.io/) provide mature ways to identify requirements,
link them to other artifacts and report traceability. They are broader choices when requirements
engineering, compliance matrices or configurable document relations are the primary problem. loam
uses a deliberately fixed vocabulary of joins because those links also drive C4 projection,
contract coherence and one transactional feature lifecycle.

## Architecture conformance in code: ArchUnit and dependency-cruiser

[ArchUnit](https://www.archunit.org/userguide/html/000_Index.html) and
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) inspect implementation
dependencies and enforce rules such as layers, allowed imports and cycle freedom. They answer a
question loam intentionally does not: whether the code actually has the structure the architecture
claims. Use them to turn selected architecture rules into executable code checks; use loam to keep
the authored system model and the rest of its semantic record coherent.

## Spec-driven change tools, as of October 2026

These are the tools a team evaluating loam usually holds it against, and unlike the neighbours
above they overlap its job: each turns an intended change into specs an agent implements. They
release about weekly, so this section is dated — checked 2026-10-09 against each project's
releases, documentation and issue tracker — and each claim links its source. It records what each
offers for a change that crosses repositories or services, what is still open upstream, and where
loam differs. It does not rank them.

**OpenSpec** (1.14.1, published 2026-10-05)

- [Stores](https://openspec.dev/docs/stores), in beta since 1.5.0, keep specs in a repository of
  their own that several code repositories plan against; worksets, also beta, group them. The guide
  says OpenSpec does not route tasks to repositories: for a change spanning components, its pattern
  is a shared contract in the store plus a separate local change in each component repository,
  linked by hand. Since 1.14.0, a store-backed apply may also edit the code repository that
  declares the store.
- `openspec show <change> --diff` (1.11.0) renders each requirement of a change as a unified diff
  against its base, with `--json --diff` for pipelines
  ([releases](https://github.com/Fission-AI/OpenSpec/releases)).
- The [Cloud Agent](https://openspec.dev/blog/openspec-cloud-agents), in early access since
  2026-08-28 with new sign-ups paused on 2026-09-11, is hosted. It checks pull requests against
  spec requirements, shows requirements across repositories as in sync, drifted or needing a
  decision, scans daily and opens corrective pull requests. The page does not say how it detects
  drift.
- Open: [#725](https://github.com/Fission-AI/OpenSpec/issues/725), multi-repository and
  microservice spec management, open since 2026-02-18. On 2026-09-07 the maintainers' bot confirmed
  that shared changes with repository slices and explicit apply targets do not exist yet.

**Spec Kit** (1.1.2, 2026-10-07)

- The [contract-driven development
  guide](https://github.github.com/spec-kit/guides/contract-driven-development.html) (September
  2026) covers interfaces between repositories or components by convention: the owner publishes a
  versioned contract, consumers pin it, and provider and consumer contract tests go into the tasks.
  It excludes contract sync, cross-repository dependency resolution and release orchestration, and
  describes no automated check between consumer and provider.
- [`/speckit.converge`](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/converge.md)
  (June 2026) runs after implementation: the agent compares the code with one feature's spec, plan
  and tasks, classes each gap as missing, partial, contradicting or unrequested, and appends tasks
  for them.
- 1.1.1 added an experimental MCP server, and 1.1.2 MCP tools that list a project's artifacts
  ([releases](https://github.com/github/spec-kit/releases)).
- Open: [#4583](https://github.com/github/spec-kit/issues/4583), multi-repository microservices,
  open since 2026-09-14 and labelled triage-can-wait. The maintainer linked the contract-driven
  guide and asked whether it is enough to close it.

**Kiro** (IDE 1.2, CLI 2.28)

- [Feature specs](https://kiro.dev/docs/specs/) are Requirements-First or, since IDE 0.10
  (February 2026), Design-First — requirements derived from an existing architecture or sketch —
  and live per feature under `.kiro/specs`. Analyze Requirements (0.12, May 2026) checks a
  requirements document for ambiguity, conflicts and gaps before design.
- [Kiro Web](https://kiro.dev/changelog/web/introducing-kiro-web-preview/) (preview from
  2026-05-18) clones several repositories into one cloud session, coordinates a change across them
  and opens a pull or merge request in each repository it changed; since June, GitHub and GitLab
  repositories can share a session.
- For specs that span repositories, the [best-practices
  page](https://kiro.dev/docs/specs/best-practices/) suggests a central specs repository linked by
  submodules, packages or symlinks. The docs describe no merge of a finished spec into a living
  baseline and no drift detection; [#9435](https://github.com/kirodotdev/Kiro/issues/9435), open,
  asks for a git ref stamped into spec metadata and a warning when referenced code changed.

**Where loam differs**

- A cross-service change is one feature with a requirement delta for each service it touches, and
  each service's part is computed: `loam delta <FEAT> --service <id>` is that service's slice, and
  `loam tasks` lists the work per service, providers before consumers. That is the routing #725
  asks for, held as data rather than executed. loam clones nothing and opens no pull request;
  running an agent in each repository is the host's job — Kiro Web's, or a cloud agent's.
- The joins between services are exact tokens that `loam validate` grades: a call edge's `op`
  against the provider's OpenAPI `operationId`, a requirement's `Operations:` line against its own
  contract. Spec Kit's guide leaves that agreement to people, and converge and the Cloud Agent ask
  a model. loam asks no model and judges no meaning, so a requirement that is wrong but correctly
  joined passes.
- Drift is detected by digests kept in the files: `sources.stale` when vouched code moves,
  `content.stale` when vouched words move, and a digest on every generated scenario. The checks run
  in each repository's CI and store nothing elsewhere. There is no dashboard, and nothing opens a
  corrective pull request.
- Two gaps against these tools are open. loam has no per-requirement diff of a change against the
  living spec like `openspec show --diff`: `loam delta` prints whole requirements, and
  `loam archive --dry-run` says only which contract slots the merge quotes unchanged and which it
  overwrites. And it has no analysis pass before code like Kiro's Analyze Requirements.

## The boundary

Every individual mechanism loam uses has neighbours with more depth in that mechanism. loam's
boundary is their intersection: an authored C4 change and requirement deltas, joined to contracts
and distinguishable evidence, validated and merged as one reviewable filesystem transaction. If
only one of those axes matters, choose the specialist. loam starts paying when a change crosses
several of them and “all the files are valid” is weaker than “all the claims still agree.”
