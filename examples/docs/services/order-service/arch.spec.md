---
service: order-service
status: draft
owner: orders-team
sources:
  - src/main/kotlin/
---

# order-service — architecture spec

The **living architecture spec**: the obligations no business scenario in `spec.md` was ever
going to carry. "Place an order" says an order is placed; it does not say that the placement
and its `OrderPlaced` row commit together, that a caller's retry must not buy the basket twice,
or that a redelivered `PaymentAuthorized` must confirm the order exactly once. Those are the
corners an agent writing the implementation cuts first, so they are written down mechanically
here instead of being trusted to a reviewer.

Same grammar as `spec.md`, and a separate requirement namespace — an arch requirement never
collides with a business one of the same name, and `loam gherkin` emits these tagged
`@architecture` so the suite knows an integration or operational test is being asked for.

What makes the file checkable is the `Covers:` line: it names the model objects a requirement's
scenarios exercise, and `loam validate` grades it both ways. Every entry must resolve against
this service's own `model.likec4` plus the landscape (`covers.unknown`, with a did-you-mean
hint, is the typo guard — a mistyped entry otherwise costs exactly the coverage it was written
for), and every `slis[].name` and `alerts[].name` in `health.yaml` must be named by one of them
(`health.uncovered`, or a signal ships to the on-call rotation with nothing testing it). Edge
entries below are spelled as this model draws them — `orderService.outbox -> kafka.orderEvents`
— because the endpoint that matters is the container; `order-service -> payment-service`
resolves too, through the `metadata { service }` binding on the root element.

## Requirements

### Requirement: Order creation is idempotent under a caller's key

Requirement-ID: ARCH-ORD-IDEMPOTENCY
The service SHALL record the `Idempotency-Key` of every accepted `createOrder` in the same
transaction that stores the order, and SHALL replay the stored response for a repeat of that
key rather than placing a second order or requesting a second authorization. checkout-web's
retry on a gateway timeout is not a rare path — it is the normal shape of a mobile checkout —
and without the key a customer's flaky connection charges the card twice.

Covers: orderService.db, orderService.domain -> paymentService

#### Scenario: checkout-web retries a placement it never saw acknowledged
- **Given** an order placed under `Idempotency-Key` "ik-8842" with an authorization already requested
- **When** the identical `createOrder` request arrives again after the caller timed out
- **Then** the stored response for "ik-8842" is returned unchanged
- **And** payment-service receives no second `authorizePayment` call

#### Scenario: An authorization call that times out is retried, not abandoned
- **Given** a `createOrder` whose `authorizePayment` call times out with no response
- **When** the placement path retries the authorization
- **Then** `authorizePayment` is called again for the same `orderId`, amount and currency
- **And** payment-service's idempotency by order id returns the first authorization instead of reserving funds twice

### Requirement: OrderPlaced leaves through the transactional outbox

Requirement-ID: ARCH-ORD-OUTBOX
The service SHALL write the order and its `OrderPlaced` event into the same database
transaction and SHALL publish the event from the outbox relay — never by writing to the
database and then to kafka. A dual write has no failure mode in which both sides agree: a crash
between them either announces an order nobody stored or stores one nobody hears about, and
notification-service is the service that pays for the second case.

Covers: orderService.outbox, orderService.outbox -> kafka.orderEvents

#### Scenario: The broker is unavailable when an order is placed
- **Given** an accepted order whose `OrderPlaced` row is still in the outbox table
- **When** kafka is unreachable
- **Then** the order stays committed and is readable through `getOrder`
- **And** the relay publishes the event once kafka returns, without the caller retrying

#### Scenario: The relay crashes after publishing and before marking the row sent
- **Given** an outbox row published to `order.events.v1` but not yet marked sent
- **When** the relay restarts and picks the row up again
- **Then** the event is published a second time with the same order id
- **And** consumers deduplicate on it, because this relay promises at-least-once and not exactly-once

### Requirement: PaymentAuthorized is consumed at least once and applied once

Requirement-ID: ARCH-ORD-DEDUPE
The service SHALL record the `paymentId` of every `payment.PaymentAuthorized` it applies, in
the transaction that advances the order, and SHALL ignore a message whose `paymentId` is
already recorded. The producer's outbox promises at-least-once delivery and a rebalance
redelivers whatever was in flight, so a consumer without a ledger is a consumer that confirms
an order it already confirmed — and, once ORD-CANCEL has moved on, resurrects a cancelled one.

Covers: orderService.consumer, kafka.paymentEvents -> orderService.consumer
Consumes: payment.PaymentAuthorized

#### Scenario: The same authorization is redelivered after a consumer rebalance
- **Given** an order confirmed from `payment.PaymentAuthorized` for payment "pay-77"
- **When** the same message is redelivered after the consumer group rebalances
- **Then** the ledger already holds "pay-77" and the message is acknowledged without a write
- **And** the order's state and its updated-at timestamp are unchanged

#### Scenario: The consumer fails mid-batch and the offset is not committed
- **Given** a batch of authorizations where the third message fails to apply
- **When** the consumer restarts from the last committed offset
- **Then** the first two are recognized by the ledger and skipped
- **And** the third is applied, so no authorization is lost to a partial batch

### Requirement: Order placement is measured and paged

Requirement-ID: ARCH-ORD-SIGNALS
The service SHALL export availability and placement-latency SLIs, and SHALL page the orders
on-call when placements fail at a sustained rate. Placement is the fleet's revenue path and it
fails silently from the customer's side — a broken authorization call looks like a slow
checkout — so the alert is on the outcome, not on any one dependency being down.

Covers: sli:availability, sli:order_placement_latency_p95_ms, alert:order_placement_failures

#### Scenario: Sustained placement failures page the on-call
- **Given** more than 2% of `createOrder` calls failing over five minutes
- **When** the alert rules are evaluated
- **Then** `order_placement_failures` pages the orders on-call with the runbook link

#### Scenario: The SLIs are exported against their objectives
- **Given** the service is serving traffic
- **When** its metrics endpoint is scraped
- **Then** `availability` and `order_placement_latency_p95_ms` report values against their SLOs

#### Scenario: A degraded payment-service shows up as placement latency, not as a silent stall
- **Given** payment-service answering `authorizePayment` slowly but successfully
- **When** placements queue behind it
- **Then** `order_placement_latency_p95_ms` rises above its objective before any request times out

### Requirement: The checkout journey settles either way

Requirement-ID: ARCH-ORD-CHECKOUT-JOURNEY
The service SHALL leave the fleet consistent on BOTH outcomes of the checkout journey: an
authorized payment advances the order exactly once however many times the event is delivered,
and a refused one leaves no funds reserved and no order that claims to be paid. The journey is
the only place the two outcomes are written down together — each service's own spec sees its
half and cannot say what the other half owes — which is what the drawn interaction is for.

Covers: view:checkoutJourney

#### Scenario: The authorized branch advances the order exactly once
- **Given** a placed order whose `authorizePayment` was approved
- **When** `payment.PaymentAuthorized` is delivered, redelivered after a rebalance, and delivered again
- **Then** the order advances once and the later deliveries are acknowledged without a write
- **And** no second authorization is requested for it

#### Scenario: The refused branch leaves nothing reserved
- **Given** a placed order whose `authorizePayment` was refused by the issuer
- **When** the placement path gives up on it
- **Then** the order is not advanced and reports no payment
- **And** any funds an earlier attempt reserved are refunded, so the customer holds no reservation for an order that will never ship
