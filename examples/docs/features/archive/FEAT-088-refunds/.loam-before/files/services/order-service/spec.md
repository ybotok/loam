---
service: order-service
status: draft
owner: orders-team
sources:
  - src/main/kotlin/
---

# order-service

Owns the order lifecycle — placement, the payment it orchestrates, and cancellation. This is
the **living spec**: the complete current state, not a changelog. Feature deltas
(`## ADDED|MODIFIED|REMOVED Requirements`) merge in here on `loam archive`, so what is written
below is always what the service promises today.

Three join lines carry the whole file into the rest of the docs, and each is graded:
`Operations:` names operationIds from `openapi.yaml` (an operation nobody names is
`api.ungoverned`; a name nothing defines is `spec-api.op-undefined`), `Publishes:` / `Consumes:`
name messages `asyncapi.yaml` declares an `action: send` / `action: receive` for
(`spec-event.message-undefined` otherwise), and `Requires:` names a pair
`architecture/permissions.yaml` declares (`permissions.unknown` otherwise). The architectural
obligations behind these promises — idempotency, the outbox, the dedupe ledger, the alerts —
are not here; they live in `arch.spec.md`, which is a separate requirement namespace.

## Requirements

### Requirement: Place an order
Requirement-ID: ORD-PLACE
The service SHALL accept an order for a customer's basket, obtain a payment authorization from
payment-service before acknowledging it, and announce the accepted order to the fleet. The
authorization answers in band — `authorizePayment` returns the reservation, so nothing is
acknowledged on a card nobody has reserved. The order is still placed in state
`awaiting_payment`: what clears that state is `payment.PaymentAuthorized`, and the requirement
that acts on it is ORD-ON-AUTHORIZED.

Operations: createOrder
Publishes: order.OrderPlaced

#### Scenario: A basket becomes an order
- **Given** a customer with a basket of two lines and a valid payment method
- **When** `createOrder` is called with a fresh `Idempotency-Key`
- **Then** the order is stored in state `awaiting_payment`
- **And** `order.OrderPlaced` is announced with the order id, the customer id and the total

#### Scenario: A reused idempotency key with a different basket is refused
- **Given** an order already placed under `Idempotency-Key` "ik-8842"
- **When** `createOrder` is called again with that key and a basket that differs from the first
- **Then** the service refuses with 409 and names the conflicting key
- **And** the first order is left exactly as it was placed

### Requirement: Read an order
Requirement-ID: ORD-READ
The service SHALL return an order's current state to its owner, so checkout-web's status page
reads the order rather than inferring it from payment events it cannot see.

Operations: getOrder

#### Scenario: An order is read back
- **Given** an order placed for customer "cus-31"
- **When** `getOrder` is called for that order id
- **Then** the response carries the order's state, its lines and its total

#### Scenario: An order id that was never issued
- **Given** an order id no placement ever produced
- **When** `getOrder` is called for it
- **Then** the service answers 404 rather than an empty order

### Requirement: Cancel an order
Requirement-ID: ORD-CANCEL
The service SHALL let an order be cancelled while nothing irreversible has happened to it, and
SHALL refuse once the order has been handed to fulfilment — a cancellation after that point is
a return, which this service does not model.

Operations: cancelOrder
Requires: user/orders:cancel

#### Scenario: A customer cancels before fulfilment
- **Given** an order in state `awaiting_payment`
- **When** its owner calls `cancelOrder`
- **Then** the order moves to `cancelled` and no further payment work is started

#### Scenario: An order already handed to fulfilment cannot be cancelled
- **Given** an order in state `fulfilling`
- **When** `cancelOrder` is called for it
- **Then** the service refuses with 409 and the order stays `fulfilling`

### Requirement: Accept an order through the v1 API
Requirement-ID: ORD-PLACE-V1
The service SHALL keep accepting orders on the v1 endpoint for as long as the partner batch
importer still calls it. This is legacy: v1 takes a flat basket with no idempotency key and no
currency, so a retried import creates a second order and every total is assumed to be EUR. It
is kept alive for one remaining caller and nothing new may be built on it — FEAT-112 retires
the endpoint once that importer has moved to `createOrder`.

Operations: createOrderV1

#### Scenario: The partner batch importer places an order on v1
- **Given** the partner importer, the only caller left on v1
- **When** it posts a flat basket to `createOrderV1`
- **Then** an order is placed exactly as `createOrder` places one, with the currency defaulted to EUR
- **And** no idempotency key is recorded, so a replayed import would place a second order

### Requirement: Advance an order when payment is authorized
Requirement-ID: ORD-ON-AUTHORIZED
The service SHALL move an order to `confirmed` when payment-service announces that the order's
payment was authorized, and SHALL leave an order that is no longer awaiting payment untouched.
The authorization decision belongs to payment-service; what this requirement owns is the order
state that follows from it.

Consumes: payment.PaymentAuthorized

#### Scenario: Authorization confirms the order
- **Given** an order in state `awaiting_payment`
- **When** `payment.PaymentAuthorized` arrives naming that order
- **Then** the order moves to `confirmed` and becomes eligible for fulfilment

#### Scenario: Authorization arrives for an order the customer already cancelled
- **Given** an order cancelled while its authorization was still in flight
- **When** `payment.PaymentAuthorized` arrives naming that order
- **Then** the order stays `cancelled` and is never confirmed
- **And** the authorization is left to expire uncaptured, because this service never captures
