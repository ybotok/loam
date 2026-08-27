# payment-service — requirement delta for FEAT-101

## MODIFIED Requirements

### Requirement: Authorize a payment, splitting it when the order is flagged

Requirement-ID: PAY-AUTHORIZE
Based-On: 820301445e65f9f4
The service SHALL reserve funds for an order before capture, SHALL treat an authorization
request as idempotent by order id, and SHALL delegate splitting to `payment-split-service` when
the order is flagged for splitting.

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

#### Scenario: Split order delegates to the split service
- **Given** an order flagged for splitting
- **When** authorization is requested
- **Then** payment-service calls `createSplit` on `payment-split-service`
- **And** the authorization succeeds only once the split is recorded
