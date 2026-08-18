---
id: ADR-FEAT-088-0001
status: accepted
date: 2026-07-02
feature: FEAT-088
---

# 1. Refunds belong to payment-service, not to order-service

## Context
Cancellation is an order concept and refunding is a money concept, and the cancellation flow
needs both. Putting the refund call in `order-service` is the shortest path; owning the refund
state there is the tempting next step.

## Decision
`order-service` calls `refundPayment` and owns nothing about it. The refund's state, its
idempotency and its reconciliation against the acquirer stay in `payment-service`, beside the
authorization and capture they are a continuation of.

## Consequences
- One service reconciles with the acquirer, so there is one answer to "what does the acquirer
  think happened".
- `order-service` gains a synchronous dependency on `payment-service` for cancellation, which
  its `health.yaml` already records as `critical`.
- A refund initiated anywhere else — support tooling, a future payouts service — goes through
  the same operation rather than a second implementation.
