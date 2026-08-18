# payment-service — requirement delta for FEAT-088

## ADDED Requirements

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
