---
id: ADR-identity-service-0001
status: accepted
date: 2026-06-02
service: identity-service
---

# 1. Introspect tokens centrally instead of validating them locally

## Context
Every service in the fleet has to decide whether a caller's token is good. The
original answer was `GET /tokens/{token}/valid` (`validateToken`): a boolean, cheap
to call, and cheap to cache — which is precisely what made it wrong.

The endpoint answered from the token's signature and expiry, so it could only ever
say "this was issued by us and has not expired yet". It could not say "this client
was revoked eleven minutes ago". A revoked client therefore kept transacting until
its token's natural expiry, and lengthening token lifetimes — the obvious fix for the
load this endpoint put on the key store — made the revocation window longer in exact
proportion.

The boolean was also a dead end for authorization: a caller that needs the subject
and the scopes has to fetch them somewhere, and every consumer had begun decoding the
token itself to get them. Two services were already trusting claims they had not
verified.

## Decision
`POST /tokens/introspect` (`introspectToken`) is the single answer, in the shape of
RFC 7662: it returns `active` computed from **revocation state**, together with the
subject and scopes, and an unknown, expired or revoked token is `{"active": false}`
with a 200 rather than a 4xx — the caller asked a question and got an answer.

`validateToken` is marked `deprecated: true` in `openapi.yaml` and keeps working. Its
verdict is now computed the same way as introspection's, so the two can never
disagree; only its response shape stays frozen.

Introspection is gated on `service/tokens:introspect` and served from a short-TTL
cache. Both obligations are written down where a test can be generated from them —
`IDN-INTROSPECT` in `spec.md` for the permission, `ARCH-INTROSPECT-CACHE` in
`arch.spec.md` for the cache's TTL, its invalidation on revocation, and its fallback.

## Consequences
- Revocation propagates within the cache TTL instead of within a token lifetime.
- Every consumer now makes a network call where it used to decode locally, which is
  why the cache and its single-flight behaviour are architecture requirements rather
  than an implementation detail; the stampede failure mode is in `runbook.md`.
- `validateToken` is deprecated rather than deleted, and that is a deliberate,
  visible state rather than a decision postponed. payment-service still calls it —
  the landscape edge `paymentService -> identityService` carries
  `metadata { op 'validateToken' }` — so deleting the operation would break a
  consumer with nothing having proposed the break. Instead the flag makes the
  migration legible to `loam validate`: `spine.op-deprecated` names the consumer that
  has not moved, and `api.requirement-deprecated` names `IDN-VALIDATE-LEGACY` as
  behaviour on its way out. Both warnings stay until the migration is finished, and
  they are how anyone can see it is not.
- Retirement is an explicit change, not a cleanup: a feature delta carries
  `x-loam-remove: true` inside the operation in
  `features/<FEAT>/specs/identity-service/openapi.yaml` plus a `REMOVED` requirement
  naming `validateToken`, and `loam archive` deletes the operation and the
  requirement together. That is the step that ends this ADR's transitional state.
