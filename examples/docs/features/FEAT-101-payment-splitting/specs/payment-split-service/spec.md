# payment-split-service — requirement delta for FEAT-101

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across two or more payees such that the shares sum to the total.

#### Scenario: Split across two payees
- **Given** a payment of 100.00 USD for order "A-1"
- **When** it is split 60.00 to "seller-x" and 40.00 to "seller-y"
- **Then** a split with two shares summing to 100.00 is recorded
- **And** a `PaymentSplit` event is published to kafka

#### Scenario: Reject a split that does not sum to the total
- **Given** a payment of 100.00 USD
- **When** a split of 60.00 + 30.00 is requested
- **Then** the split is rejected
