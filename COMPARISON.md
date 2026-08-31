# Where loam fits

loam is not a replacement for an architecture renderer, a software catalog, a contract-testing
broker, an API-diff engine, or a code-level architecture test. It is the layer that keeps an
authored C4 model, requirements, contracts and verification evidence semantically connected while
the system changes. Most of the tools below can sit beside it; the useful question is which part of
the problem each one should own.

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
changed. Use the specialist diff in CI beside loam rather than expecting either tool to infer the
other half.

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

## The boundary

Every individual mechanism loam uses has neighbours with more depth in that mechanism. loam's
boundary is their intersection: an authored C4 change and requirement deltas, joined to contracts
and distinguishable evidence, validated and merged as one reviewable filesystem transaction. If
only one of those axes matters, choose the specialist. loam starts paying when a change crosses
several of them and “all the files are valid” is weaker than “all the claims still agree.”
