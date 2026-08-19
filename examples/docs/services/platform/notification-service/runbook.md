---
service: notification-service
status: draft
owner: growth-team
---

# notification-service — runbook

A consumer-only worker: it serves no traffic, so nothing degrades when it stops — it falls
behind. Every incident below is a lag or a send failure, never a request error.

## Deploy
- Pipeline: `.gitlab-ci.yml` -> `deploy:prod` (manual gate).
- Config: `config/`; provider credentials via Vault path `secret/notification-service`.
- Rolling deploys rebalance the consumer group: expect a lag spike for the length of one
  rebalance, and do not roll again until it has drained.

## Health
- Liveness: `GET /internal/health/liveness`
- Readiness: `GET /internal/health/readiness` (consumer group joined + both stores reachable)
- There are no SLOs yet — see the comment at the top of `health.yaml`.

## Common incidents

### Consumer lag on one topic
Symptom: notifications arrive late; `kafka_consumergroup_lag` climbs on `order.events.v1`,
`payment.events.v1` or `crm.events.v1`.
- Check which partition is behind — a single hot partition is a slow handler, all of them is
  the provider (below) or the delivery log.
- Redelivery is safe on every topic, for two different reasons: `order.events.v1` and
  `payment.events.v1` because the delivery log is keyed on `(message id, channel)` and a
  replayed partition sends nothing twice, `crm.events.v1` because an update at or below the
  `version` already in the contact store is dropped. Resetting an offset FORWARD is safe on
  none of them — it drops confirmations nobody will re-emit.

### Provider throttling
Symptom: the sender's 429 rate rises and lag follows it on every topic at once.
- The sender backs off and retries; do not scale the consumer up, which only queues more
  work behind the same provider quota.
- Confirm the quota with the provider before raising concurrency. Sending faster than the
  quota converts throttling into hard rejections, and a rejected send is a customer who was
  never told.
- A held receipt (a capture whose order has not arrived — `NTF-RECEIPT`) looks identical in
  the lag graph. Check the held-receipt count before treating it as a provider problem.

## Escalation
On-call channel: `#growth-oncall`. Provider incidents escalate to the vendor's status page
first — this service has no way to deliver anything while the provider is down.
