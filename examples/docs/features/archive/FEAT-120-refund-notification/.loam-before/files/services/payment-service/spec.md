---
service: payment-service
status: draft
owner: payments-team
sources:
  - src/main/java/
---

# payment-service

Owns payment authorization and capture. This is the **living spec** — the complete current
state. Feature deltas (ADDED/MODIFIED/REMOVED requirements) merge in here on `loam archive`;
`features/archive/` keeps every one of those deltas, so "which change introduced this
requirement" stays a search rather than a record somebody has to maintain.

## Requirements

### Requirement: Authorize a payment

Requirement-ID: PAY-AUTHORIZE
The service SHALL reserve funds for an order before capture, and SHALL treat an authorization
request as idempotent by order id so that a caller's timeout-and-retry never reserves twice.

Operations: authorizePayment
Publishes: payment.PaymentAuthorized
Realizes: checkout#CHECKOUT-CHARGE-ONCE

#### Scenario: Successful authorization
- **Given** an order with a valid payment method
- **When** authorization is requested
- **Then** funds are reserved and a `PaymentAuthorized` event is emitted

#### Scenario: A retry of the same authorization returns the first result
- **Given** an authorization already reserved for order "A-1"
- **When** the same request arrives again after a caller timeout
- **Then** the original authorization is returned and no second reservation is made

#### Scenario: A second authorization for the same order with a different amount is refused
- **Given** an authorization already reserved for order "A-1" of 100.00 USD
- **When** an authorization of 120.00 USD is requested for the same order
- **Then** the request is refused with 409 and the first reservation stands

### Requirement: Capture an authorized payment

Requirement-ID: PAY-CAPTURE
The service SHALL settle a previously authorized payment, and SHALL refuse to capture a payment
it never authorized.

Operations: capturePayment
Publishes: payment.PaymentCaptured
Requires: service/payments:capture

#### Scenario: Capture an authorized payment
- **Given** an authorized payment
- **When** capture is requested
- **Then** the payment is settled and a `PaymentCaptured` event is emitted

#### Scenario: Capturing an unknown payment is refused
- **Given** a payment id no authorization ever created
- **When** capture is requested for it
- **Then** the request is refused with 404 and nothing is settled

### Requirement: Refund a captured payment

Requirement-ID: PAY-REFUND
The service SHALL return captured funds to the customer's payment method, SHALL reconcile the
refund against the acquirer before reporting it complete, and SHALL refuse a second refund of a
payment it has already refunded.

Operations: refundPayment
Requires: user/payments:refund

#### Scenario: Refund a captured payment in full
- **Given** a captured payment of 100.00 USD
- **When** a refund is requested for it
- **Then** 100.00 USD is returned to the customer's payment method
- **And** the payment is recorded as refunded

#### Scenario: A second refund of the same payment is refused
- **Given** a payment already refunded in full
- **When** a refund is requested for it again
- **Then** the request is refused with 409 and no second refund is issued
