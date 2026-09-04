---
service: payment-service
status: draft
owner: payments-team
sources:
  - src/main/java/
---

# payment-service — architecture spec

The **living architecture spec**: the obligations the business spec never carries —
the transactional outbox, retries, metrics and alerts. Same grammar as spec.md;
each requirement's `Covers:` line names the C4 elements, edges and health signals
its scenarios exercise, and `loam validate` checks every entry resolves
(`covers.unknown`) and every declared alert/SLI is covered (`health.uncovered`).

An edge entry resolves by exact element id **or** by the service an endpoint stands for, which
is why the edge entries below name `payment-service` rather than `marketplace.paymentService`:
the landscape draws this service inside a grouping element, and an edge written against a group
path would have to be rewritten the day somebody moves the box. A CONTAINER has no such coarser
name, so `marketplace.paymentService.outbox` is spelled in full — `model.likec4` extends the
element the map declares inside `marketplace`, so that IS the container's id. SCHEMA.md, "Two
shapes of a service model", has the rule and the migration step that requalifies these lines.

## Requirements

### Requirement: Events leave through the transactional outbox

Requirement-ID: ARCH-PAY-OUTBOX
The service SHALL write a domain event and the state change it reports in one
database transaction, published to kafka by an outbox relay — never a dual write.

Covers: marketplace.paymentService.outbox, payment-service -> kafka.paymentEvents
Publishes: payment.PaymentAuthorized, payment.PaymentCaptured

#### Scenario: Broker down at commit time
- **Given** an authorized payment whose `PaymentAuthorized` event is still in the outbox
- **When** kafka is unavailable
- **Then** the payment state stays committed and the event is published once kafka returns

#### Scenario: The relay redelivers rather than dropping
- **Given** an outbox row the relay published but could not mark as sent
- **When** the relay restarts
- **Then** the event is published a second time and consumers deduplicate on `paymentId`

### Requirement: Card authorization survives an acquirer timeout

Requirement-ID: ARCH-PAY-ACQUIRER
The service SHALL send an idempotency key with every acquirer call and SHALL reconcile a
timed-out authorization against the acquirer before deciding it failed — a timeout is an
unknown outcome, never a decline.

Covers: payment-service -> stripe

#### Scenario: The acquirer times out and the money was in fact reserved
- **Given** an authorization request that times out at the acquirer
- **When** the reconciliation job replays the request with the same idempotency key
- **Then** the acquirer returns the original authorization and no second charge exists

### Requirement: Authorization health is measured and paged

Requirement-ID: ARCH-PAY-HEALTH
The service SHALL export its availability and latency SLIs and page on a sustained
authorization error rate.

Covers: sli:availability, sli:latency_p99_ms, alert:payment_authorization_5xx

#### Scenario: Error-rate alert fires
- **Given** more than 1% of authorization requests fail over five minutes
- **When** the alert rules are evaluated
- **Then** `payment_authorization_5xx` pages the payments on-call

#### Scenario: SLIs are exported
- **Given** the service is serving traffic
- **When** its metrics endpoint is scraped
- **Then** `availability` and `latency_p99_ms` report values against their SLOs
