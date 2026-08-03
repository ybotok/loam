---
feature: FEAT-101
title: Payment splitting
status: proposed            # proposed -> in_progress -> built -> done
owner: payments-team
services: [payment-service, payment-split-service, checkout-web]
---

# FEAT-101 — Payment splitting

## Why
Marketplaces need to split one customer payment across multiple payees (sellers).

## Business acceptance
- A customer can split a payment across 2+ payees before confirming.
- Each payee receives their share; the shares sum to the total.

## Architectural summary
New `payment-split-service`; `payment-service` and `checkout-web` call it; it publishes
`PaymentSplit`. UI adds a split-payment page in `checkout-web`. See `delta.likec4`.
