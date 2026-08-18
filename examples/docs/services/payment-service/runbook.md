---
service: payment-service
status: draft
owner: payments-team
---

# payment-service — runbook

Frontmatter here is read by nothing: `loam list` tracks that this file EXISTS, and no check
grades a field in it. What is written above is a note to the next reader, not a claim loam will
catch when it goes stale.

## Deploy
- Pipeline: `.gitlab-ci.yml` -> `deploy:prod` (manual gate).
- Config: `application.yml`; secrets via Vault path `secret/payment-service`.

## Health
- Liveness: `GET /actuator/health/liveness`
- Readiness: `GET /actuator/health/readiness` (checks db + kafka)
- The SLIs and the alert are declared in `health.yaml`, and `arch.spec.md` carries the
  requirement that says what each one is for. A signal nothing covers is `health.uncovered`.

## Common incidents
- **Outbox relay lag** -> events delayed, and every consumer downstream of `payment.events`
  falls behind with it. Check the `outbox_pending` gauge; restart the relay. The payments
  themselves are unaffected: the outbox is what makes the state change and its event one
  transaction, so nothing is lost, only late.
- **DB connection exhaustion** -> 503s. Check pool metrics; scale or fix a leak.
- **Acquirer timeouts** -> authorizations in an unknown state. Do not retry by hand: the
  reconciliation job replays with the original idempotency key, which is the only path that
  cannot double-charge.
- **identity-service unavailable** -> declared `degradable` in `health.yaml`: cached
  introspection decisions carry requests for their remaining TTL, and authorization starts
  failing closed once the cache empties.

## Escalation
On-call channel: `#payments-oncall`.
