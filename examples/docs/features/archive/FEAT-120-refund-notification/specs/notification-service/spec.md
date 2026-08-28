# notification-service — requirement delta for FEAT-120

## ADDED Requirements

### Requirement: Notify a customer when a refund completes

Requirement-ID: NTF-REFUND
The service SHALL send exactly one refund notification per refunded payment, stating the
refunded amount and currency exactly as the refund reported them, and SHALL NOT send one
until the refund is complete.

Consumes: payment.PaymentRefunded
Capability: order-notifications

#### Scenario: A completed refund is announced once
- **Given** a `payment.PaymentRefunded` for an order this service has already confirmed
- **When** the consumer handles it
- **Then** a refund notification is rendered with the refunded amount and currency
- **And** the delivery log records the send under that `paymentId`

#### Scenario: The broker redelivers a refund already announced
- **Given** a refund notification already recorded in the delivery log for that `paymentId`
- **When** kafka redelivers the same `payment.PaymentRefunded`
- **Then** no second notification is sent and the event is acknowledged
