# Order

What a customer has committed to buy: a set of items, a total they were shown,
and the intent to pay it. An order exists from the moment the customer confirms
— before any money moves, and whether or not the
[authorization](payments/authorization.md) succeeds.

An order is not a cart. A cart is what the customer is still editing; an order
is what they have decided. Nothing in the fleet edits an order in place.

The word is used in `capabilities/checkout/spec.md` and
`capabilities/order-notifications/spec.md`, and the services that carry parts of
those promises use it in the same sense. That agreement is what a glossary is
for, and the links to this file are what make it checkable: `glossary.unlinked`
would name this term the day nothing cited it any more.
