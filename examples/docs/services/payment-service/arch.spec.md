---
service: payment-service
status: draft
owner: payments-team
sources:
  - src/main/java/**
---

# payment-service — architecture spec

The **living architecture spec**: the obligations the business spec never carries —
the transactional outbox, retries, metrics and alerts. Same grammar as spec.md;
each requirement's `Covers:` line names the C4 elements, edges and health signals
its scenarios exercise, and `loam validate` checks every entry resolves
(`covers.unknown`) and every declared alert/SLI is covered (`health.uncovered`).

## Requirements

### Requirement: Events leave through the transactional outbox
The service SHALL write a domain event and the state change it reports in one
database transaction, published to kafka by an outbox relay — never a dual write.

Covers: paymentService.db, paymentService -> kafka

#### Scenario: Broker down at commit time
- **Given** an authorized payment whose `PaymentAuthorized` event is still in the outbox
- **When** kafka is unavailable
- **Then** the payment state stays committed and the event is published once kafka returns

### Requirement: Authorization health is measured and paged
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
