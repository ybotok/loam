---
feature: FEAT-088
title: Refund a captured payment
status: built
owner: payments-team
services: [payment-service, order-service]
---

# FEAT-088 — Refund a captured payment

## Why
Cancelling an order after capture leaves the customer's money with us. Support has been issuing
refunds by hand in the acquirer's dashboard, which means the fleet's own records say the payment
is still captured — the ledger and the truth disagree, and nothing in the docs said which one to
believe.

## Business acceptance
- A captured payment can be refunded in full.
- Cancelling an order whose payment was captured refunds it as part of the cancellation.
- A second refund of the same payment is refused rather than issued twice.

## Architectural summary
`payment-service` gains `refundPayment`; `order-service` calls it when it cancels an order that
was already captured. No new service and no new message: a refund is a state change of an
existing payment, and the event that reports it is deliberately left for the payout work that
needs it.
