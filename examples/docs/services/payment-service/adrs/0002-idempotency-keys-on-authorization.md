---
id: ADR-payment-service-0002
status: accepted
date: 2026-06-18
service: payment-service
---

# 2. Make authorization idempotent by order id

## Context
Callers retry on timeout, and a timed-out authorization is an unknown outcome rather than a
failure: the funds may already be reserved at the acquirer. Retrying without an identity for the
request reserves twice, and the second reservation is invisible until a customer complains.

## Decision
`authorizePayment` is idempotent by order id. A repeat of a request already recorded returns the
original authorization; a request naming the same order with a *different* amount is refused
with `409` rather than treated as a new attempt, because the two cannot both be what the caller
meant. The same idempotency key travels to the acquirer, so the reconciliation job can replay a
timed-out call safely.

## Consequences
- Retries are safe, and `order-service` may retry `authorizePayment` without a compensating flow.
- The refusal path is a real branch of the contract, so it is written as a scenario rather than
  as prose — `api.response-ungoverned` is what asks for it.
- An order whose amount legitimately changes needs a new order id, which the order lifecycle in
  `services/order-service/` already gives it.
