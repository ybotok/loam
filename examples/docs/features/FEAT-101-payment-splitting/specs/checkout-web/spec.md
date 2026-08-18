# checkout-web — requirement delta for FEAT-101

## ADDED Requirements

### Requirement: Split payment on checkout

Requirement-ID: WEB-SPLIT
The UI SHALL let a customer split a payment across two or more payees before confirming, and
SHALL show the recorded split back to them before the payment is taken.

#### Scenario: Customer splits a payment across two payees
- **Given** a payment of 100.00 USD
- **When** the customer assigns 60.00 to "seller-x" and 40.00 to "seller-y"
- **And** confirms
- **Then** `createSplit` is called on `payment-split-service`
- **And** the split is shown as confirmed

#### Scenario: A split that does not sum to the total cannot be confirmed
- **Given** a payment of 100.00 USD
- **When** the customer assigns 60.00 to "seller-x" and 30.00 to "seller-y"
- **Then** the confirm control stays disabled and the remaining 10.00 is shown as unassigned
