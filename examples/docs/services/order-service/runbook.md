---
service: order-service
status: draft
owner: orders-team
---

# order-service — runbook

Nothing in this file is read by a check: `loam list` tracks that a runbook exists and stops
there. It is here because the two incidents below are the ones the architecture in
`arch.spec.md` makes possible, and the person paged at 03:00 needs the consequence spelled out,
not the requirement id.

## Deploy
- Pipeline: `.gitlab-ci.yml` -> `deploy:prod` (manual gate). Rolling, one pod at a time.
- Config: `application.yml`; secrets via Vault path `secret/order-service`.
- The outbox relay and the payment-consumer ship in the same image as the API and are switched
  on per deployment (`ORDER_RELAY_ENABLED`, `ORDER_CONSUMER_ENABLED`). Scaling the API to zero
  therefore stops publishing and consuming too — check both flags before assuming a broker
  fault.

## Health
- Liveness: `GET /actuator/health/liveness`
- Readiness: `GET /actuator/health/readiness` — checks the database and the kafka connection.
  It deliberately does NOT check payment-service: a payment-service outage must show up as
  failed placements and a page, not as every order-service pod dropping out of the load
  balancer at once.

## Common incidents

### Placement failures {#placement-failures}
`order_placement_failures` is paging, so more than 2% of `POST /orders` is returning 5xx.

1. Look at `authorizePayment` from this side first — the usual cause is payment-service, and
   `order_placement_latency_p95_ms` rising before the error rate is the signature.
2. If payment-service is healthy, check the database connection pool: placement writes the
   order, its idempotency key and its outbox row in one transaction, so pool exhaustion fails
   the whole placement rather than degrading it.
3. Do NOT drain the queue of retries by hand. Every accepted placement carries an
   `Idempotency-Key`; callers retrying is the designed path and a replay returns the first
   order.

### Outbox backlog
`OrderPlaced` events stop arriving while orders keep being placed — notification-service goes
quiet and nothing else looks wrong, because placements are still committing.

1. Check the `order_outbox_pending` gauge and the relay's lag against `order.events.v1`.
2. If kafka is unreachable, there is nothing to fix here: the relay retries and the backlog
   drains on its own once the broker returns. Orders are safe — that is the whole point of
   writing the event in the placement transaction.
3. If kafka is healthy and the relay is stuck, restart it. Republishing is safe: the relay
   promises at-least-once, consumers deduplicate, and a row published twice is a scenario
   ARCH-ORD-OUTBOX already covers.
4. Never delete outbox rows to clear a backlog. A deleted row is an order the fleet was never
   told about, and nothing downstream will ever notice.

## Escalation
- On-call channel: `#orders-oncall`; paging rotation `orders-oncall`.
- Payment authorization problems escalate to `#payments-oncall` — order-service orchestrates
  the payment (`adrs/0001-orchestrated-order-lifecycle.md`) but owns none of it.
- Broker problems escalate to the platform team; kafka is `#external #platform` in the
  landscape and nobody in this fleet operates it.
