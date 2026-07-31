---
id: ADR-FEAT-101-0001
status: accepted
date: 2026-07-20
feature: FEAT-101
---

# 1. Introduce a dedicated payment-split-service

## Context
Splitting logic is non-trivial and will be reused beyond checkout.

## Decision
Create a new bounded-context service `payment-split-service` rather than embedding the logic in `payment-service`.

## Consequences
- +1 service to operate, with clean ownership.
- `payment-service` gains a synchronous dependency — modeled as `criticality: degradable` in its `health.yaml`.
