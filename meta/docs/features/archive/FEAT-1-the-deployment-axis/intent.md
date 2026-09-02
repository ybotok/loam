---
feature: FEAT-1
title: The deployment axis
status: proposed
owner: spentsov
---

# The deployment axis

## Why

A LikeC4 `deployment { }` block is legal in a loam docs repo today, and completely unread.
The parser resolves every `instanceOf` in it — a container renamed out from under a
deployment node fails the gate as `landscape.invalid` — and after that nothing happens:
no requirement can name a node, no `#obl-` tag placed on a datacenter is graded, no report
counts one, and the context pack an agent implements from does not mention topology at all.
Integrity holds at the level of syntax and is absent at the level of requirements.

Four facts were measured against a copy of `examples/docs` before this feature was written,
and each is the reason for one requirement below.

- `parsedModel().deployment` already returns nodes with their tags, instances carrying the
  `element.id` that joins back to the logical model, and relationships carrying metadata.
  The record is materialised by the call both loaders already make, so reading it costs no
  second parse and no new file format.
- `extend` resolves across documents of one project: a second file added a datacenter inside
  a living region and drew an edge to a node declared in the first. A feature can therefore
  bring topology as a whole-file copy, the way it brings a flow, with no text splice.
- A `#obl-` tag on a deployment node is invisible. The control is exact: the same undeclared
  tag on a model element raises `obligation.unknown`, and on a `datacenter` raises nothing.
  That is fail-open — a rule an architect placed does not exist for any check — and it is a
  defect rather than a missing feature.
- `Covers:` has three entry forms and none of them names a deployment object, so the
  requirement that describes replication between two clusters has nothing to attach to and
  reports `covers.unknown` when it tries.

The operator is a team standing up a standby cluster in a second datacenter. The repeated
task is keeping RTO/RPO requirements attached to a topology that keeps changing; the failure
mode is a requirement about replication staying green after the node it described was renamed
or removed; the current workaround is prose that resolves to nothing. The acceptance
criterion is that a topology change which orphans a covered requirement is convicted without
a human noticing it first.

## Scope

One service, because there is only one: `services/loam/`, this repository. The change adds
`src/core/deployment/` as a top-level subject — the same shape of axis `src/core/usecases/` is
one model over: a reader in `src/core/c4/`, an axis package that owns the feature-local slot and
the derivations, and the commands that consume it.

This paragraph first predicted the package's edges and got one of them wrong, which is worth
leaving in rather than tidying away: it claimed a dependency on `src/core/kernel/`, and the
kernel names it uses — `DocsDir`, `FeatureDir` — are BRANDED TYPES, so they cost an annotation
and not an import the model counts. The edge the prediction missed was `src/core/coherence/`,
which is where the create-only refusal is raised. Both were corrected against the tree before
the archive, which is the whole reason a delta sits unarchived while the code lands.

Deliberately **not** in scope, and each for a reason already written down in this repository:

- **Reading Terraform, Helm or cluster state.** That is an extractor, and there will not be
  one. The map stays authored; loam states the work and checks the result.
- **A check that a service is deployed in at least two datacenters.** It would need loam to
  start reading `criticality` out of `health.yaml`, which is prose on purpose, and it would
  turn `architecture/obligations.yaml` into the policy engine that file says in its own words
  it is not. The multi-datacenter rule is an ordinary architecture requirement whose
  `Covers:` line names the nodes; loam grades the join and never the architecture.
- **An `environment` concept above LikeC4.** `deploymentNode` is that mechanism already, and
  the fleet names its own kinds.

`src/core/c4/parsed/deployment.ts` is where the parse adapter lands, and it draws no box: the collapse
rule maps `src/core/c4/**` onto `loam.core.c4`, so the reader shows up in this model only as
the edge into it. That is the model working as designed, not an omission.
