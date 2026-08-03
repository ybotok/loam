---
service: payment-service
status: draft
owner: payments-team
---

# payment-service — runbook

## Deploy
- Pipeline: `.gitlab-ci.yml` -> `deploy:prod` (manual gate).
- Config: `application.yml`; secrets via Vault path `secret/payment-service`.

## Health
- Liveness: `GET /actuator/health/liveness`
- Readiness: `GET /actuator/health/readiness` (checks db + kafka)

## Common incidents
- **Outbox relay lag** -> events delayed. Check `outbox_pending` gauge; restart relay.
- **DB connection exhaustion** -> 503s. Check pool metrics; scale or fix a leak.

## Escalation
On-call channel: `#payments-oncall`.
