# 0001 — Event publishers write through a transactional outbox

Status: accepted
Date: 2026-08-28

## Context

A service that writes its own state and then publishes an event about it has two
places to fail between. The failure is silent and asymmetric: the state change
lands, the event does not, and every consumer's view of the world is quietly
wrong until somebody reconciles by hand.

## Decision

A service that publishes a domain event SHALL write the event and the state
change it reports in one database transaction, and relay it to the broker
afterwards. Never a dual write.

## Scope

This is not a fleet-wide policy every service inherits — that is the shape this
repository deliberately does not use. It applies where it is tagged: see
`#obl-outbox` in [the fleet map](../landscape.likec4), which today marks the
`payment-service → kafka.paymentEvents` edge and nothing else.
`payment-service`'s [ARCH-PAY-OUTBOX](../../services/payment-service/arch.spec.md)
is the requirement that keeps it.

## Consequences

A publisher needs an outbox table and a relay. A consumer must tolerate a
duplicate: the relay guarantees at-least-once, which is why
`checkout#CHECKOUT-CHARGE-ONCE` is a promise about the customer's card and not
about the number of messages.
