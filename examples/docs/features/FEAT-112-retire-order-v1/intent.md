---
feature: FEAT-112
title: Retire the v1 order API
status: in_progress
owner: orders-team
services: [order-service]
---

# FEAT-112 — Retire the v1 order API

## Why
`createOrderV1` was deprecated when `createOrder` shipped with idempotency keys and a currency
field. The last caller — a partner integration — moved in June, and the operation has served no
traffic since. Leaving it declared is not free: it is a live surface with its own validation
path, and `api.requirement-deprecated` has been warning on the requirement that governs it ever
since the flag went on.

## Business acceptance
- `POST /v1/orders` no longer exists.
- No behaviour reachable only through the v1 path is lost: `createOrder` accepts everything the
  v1 request could express.

## Architectural summary
This feature is the **smallest legal shape** loam accepts, and deliberately so: it changes no
boxes and no edges, so there is no `delta.likec4` at all — an absent architecture axis is a
legible statement that the architecture is unchanged, and the merge simply has nothing to do
there. (A file that *declares* elements with none carrying the feature tag would be
`delta.nothing-tagged` instead: declared-but-untagged is almost always a forgotten tag.)

What it does carry is the two halves of an explicit removal, which loam requires together:
a `REMOVED` requirement whose `Operations:` line names the operation, and an
`x-loam-remove: true` marker inside that operation object in `specs/order-service/openapi.yaml`.
Either half alone is refused — a marker with no requirement is `openapi.remove-marker-unjustified`,
a `REMOVED` requirement with no marker is `openapi.remove-marker-missing` — because a contract
shrinking with nothing to point at is how a consumer finds out by outage.
