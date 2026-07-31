# checkout-web — requirement delta for FEAT-101

## ADDED Requirements

### Requirement: Split payment on checkout
The UI SHALL let a customer split a payment across two or more payees before confirming.

#### Scenario: Customer splits a payment across two payees
- **Given** a payment of 100.00 USD
- **When** the customer assigns 60.00 to "seller-x" and 40.00 to "seller-y"
- **And** confirms
- **Then** `createSplit` is called on `payment-split-service`
- **And** the split is shown as confirmed
