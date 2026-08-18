---
feature: FEAT-101
title: Payment splitting
status: in_progress          # proposed -> in_progress -> built -> done
owner: payments-team
services: [payment-service, payment-split-service, checkout-web]
---

# FEAT-101 — Payment splitting

## Why
Marketplaces need to split one customer payment across multiple payees (sellers). Today a
seller is paid by a separate transfer run reconciled by hand at the end of the day, which is
where every payout dispute this quarter came from: the customer's payment and the sellers'
shares are two records nothing joins.

This file is where the "why" lives, and the archive gate holds it to that: the delta says what
changed, and nothing else says what for. A feature whose `intent.md` is missing, or says nothing
outside the scaffold's own comments, is refused by `intent.empty` — a warning that gates, so a
change cannot fold into the living docs with its reason unwritten.

## Business acceptance
- A customer can split a payment across 2+ payees before confirming.
- Each payee receives their share; the shares sum to the total.
- A split that does not sum to the total is refused, and the customer is told which shares are
  in play — a silent rounding fix is a payout dispute six weeks later.

## Architectural summary
New `payment-split-service`; `payment-service` and `checkout-web` call it; it publishes
`PaymentSplit`. UI adds a split-payment page in `checkout-web`. See `delta.likec4`, and
`adrs/0001-dedicated-split-service.md` for why the logic is not folded into `payment-service`.

## Not in this feature
Payouts themselves. A split records who is owed what; moving the money is separate work, and
deliberately not smuggled in here — a feature whose intent and whose delta describe different
scopes is one nobody can review as a diff.

The `PaymentSplit` event is drawn in `delta.likec4` and joined to no contract yet, because the
async axis has no feature delta: there is no `specs/<svc>/asyncapi.yaml`, no merge and no
baseline pin. The new service's `asyncapi.yaml` is written into `services/payment-split-service/`
in the same reviewed PR that archives this feature. That is a real limitation of loam today, not
an omission in this example.
