# payment-split-service — architecture delta for FEAT-101

Architectural obligations of the new service — what no business scenario was ever
going to say. Each requirement's `Covers:` line names the delta's tagged elements
and edges it accounts for; a tagged addition nothing covers is `c4.uncovered`.
(The `checkout-web -> payment-split-service` edge is left uncovered on purpose —
it is the example's demonstration of that warning.)

## ADDED Requirements

### Requirement: PaymentSplit leaves through the transactional outbox
The service SHALL record a split and its `PaymentSplit` event in one database
transaction, published to kafka by an outbox relay — never a dual write.

Covers: paymentSplitService, paymentSplitService -> kafka

#### Scenario: Broker down when a split is recorded
- **Given** a recorded split whose `PaymentSplit` event is still in the outbox
- **When** kafka is unavailable
- **Then** the split stays committed and the event is published once kafka returns

### Requirement: createSplit is idempotent under retries
The service SHALL treat createSplit as idempotent by order id, so a caller's
timeout-and-retry never records a second split.

Covers: paymentService -> paymentSplitService

#### Scenario: payment-service retries createSplit
- **Given** a split already recorded for order "A-1"
- **When** the same createSplit request arrives again after a caller timeout
- **Then** the original split is returned and no second split is recorded
