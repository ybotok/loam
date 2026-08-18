---
id: ADR-order-service-0001
status: accepted
date: 2026-04-22
service: order-service
---

# 1. Orchestrate the payment from order-service rather than choreograph it

## Context
Placing an order needs an authorization, and the two obvious shapes were both on the table.

**Choreography**: order-service publishes `OrderPlaced`, payment-service consumes it,
authorizes, and publishes `PaymentAuthorized`; every service reacts to events and nobody is in
charge. **Orchestration**: order-service calls `authorizePayment` synchronously as part of
`createOrder` and drives the lifecycle itself, consuming `PaymentAuthorized` only to learn how
the decision landed.

The deciding question was not coupling — both shapes couple, one through a topic and one
through a contract — but where a placement that half-happened becomes somebody's problem. In
the choreographed shape there is no moment at which any single service can answer "is this
order going to be paid for", so the answer lives in the gaps between four consumers, and the
customer-facing failure (an order acknowledged that no card will ever be charged for) is
detectable only by reconciliation after the fact. checkout-web also needs a synchronous answer:
a checkout page that acknowledges and then silently drops the order is the failure this fleet
gets support tickets about.

## Decision
order-service orchestrates. `createOrder` calls `authorizePayment` before it acknowledges,
holds the order in `awaiting_payment`, and advances it to `confirmed` when
`payment.PaymentAuthorized` arrives. The event is a completion signal for a call this service
already made — not the trigger that starts the work.

Concretely: the synchronous edge `order-service -> payment-service` carries
`metadata { op 'authorizePayment' }`, and the asynchronous one carries
`metadata { consumes 'payment.PaymentAuthorized' }`. Both are drawn, because both are real.

## Consequences
- order-service is a hard runtime dependency on payment-service for placement, and
  `health.yaml` says so (`criticality: critical`). A payment-service outage stops placements;
  it is meant to be visible as `order_placement_failures`, not absorbed.
- The lifecycle is readable in one file — the state machine in `domain` — instead of inferred
  from four services' consumers. This is what makes ORD-CANCEL expressible at all: something
  has to own the transition that refuses a cancellation.
- Every call in the placement path must be idempotent, because orchestration means retrying.
  ARCH-ORD-IDEMPOTENCY carries that obligation, and it is the reason `createOrder` takes an
  `Idempotency-Key` header at all.
- Redelivery is still ours to handle: the authorization arrives at-least-once, so
  ARCH-ORD-DEDUPE keeps an applied-payment ledger. Orchestration removed the coordination
  problem, not the delivery guarantee.
- The v1 endpoint predates this decision and does not participate in it — it places orders
  without an idempotency key, which is exactly why FEAT-112 retires it rather than fixing it.
