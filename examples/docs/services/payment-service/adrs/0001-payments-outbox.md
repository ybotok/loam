---
id: ADR-payment-service-0001
status: accepted
date: 2026-05-10
service: payment-service
---

# 1. Use a transactional outbox for payment events

## Context
Payment state changes must publish events without dual-write races between the DB and Kafka.

## Decision
Persist events to an outbox table in the same transaction as the state change; a relay publishes to Kafka.

## Consequences
- At-least-once delivery with idempotent consumers.
- Extra outbox table and relay process to operate (see `runbook.md`).
