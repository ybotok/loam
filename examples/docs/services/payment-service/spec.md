---
service: payment-service
status: verified
owner: payments-team
last_verified: 2026-07-31
sources:
  - src/main/java/**
---

# payment-service

Owns payment authorization and capture. This is the **living spec** — the complete current
state. Feature deltas (ADDED/MODIFIED/REMOVED requirements) merge in here on `loam archive`.

## Requirements

### Requirement: Authorize payment
The service SHALL reserve funds for an order before capture.

#### Scenario: Successful authorization
- **Given** an order with a valid payment method
- **When** authorization is requested
- **Then** funds are reserved and a `PaymentAuthorized` event is emitted

### Requirement: Capture payment
The service SHALL settle a previously authorized payment.

#### Scenario: Capture an authorized payment
- **Given** an authorized payment
- **When** capture is requested
- **Then** the payment is settled
