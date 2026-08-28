# Authorization

The card issuer's promise that the money for an [order](../order.md) is there
and reserved. It is not a payment: no funds have moved, and an authorization
expires if nothing captures it.

The distinction matters to the business and not only to the payments team. A
customer whose card was authorized has not been charged, so "we took your money"
is the wrong thing to tell them — and a confirmed order that was never
authorized is the failure `checkout#CHECKOUT-CHARGE-ONCE` exists to rule out.

Filed under `glossary/payments/` because the tree spells nesting the way the
capability tree does: this term's id is `payments/authorization`, and a flat
directory is not the only shape a growing vocabulary is allowed.
