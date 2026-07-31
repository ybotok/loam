# payment-service — requirement delta for FEAT-101

## MODIFIED Requirements

### Requirement: Authorize payment
The service SHALL reserve funds for an order before capture, and MAY delegate splitting to
`payment-split-service` when the order is flagged for splitting.

#### Scenario: Successful authorization
- **Given** an order with a valid payment method
- **When** authorization is requested
- **Then** funds are reserved and a `PaymentAuthorized` event is emitted

#### Scenario: Split order delegates to the split service
- **Given** an order flagged for splitting
- **When** authorization is requested
- **Then** payment-service calls `createSplit` on `payment-split-service`
