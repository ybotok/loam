---
feature: FEAT-120
status: built
owner: growth-team
---

# FEAT-120 — Tell the customer when a refund is issued

FEAT-088 gave the fleet refunds, and stopped at the money. A customer whose order is
cancelled after capture gets their funds back and hears nothing: support tickets asking
"has my refund gone through" are the second-most common contact reason this quarter,
behind delivery.

The refund already happens at a point payment-service knows exactly — the acquirer has
reconciled and the payment is recorded as refunded. That is the moment worth announcing,
and nothing announces it. This feature puts `payment.PaymentRefunded` on the existing
payment topic and has notification-service turn it into the message the customer is
waiting for.

Deliberately NOT in scope: a refund status endpoint. A customer who has been told does
not need somewhere to look, and an endpoint nobody calls is a contract to maintain
forever. If the tickets continue after this ships, that is the evidence for one.
