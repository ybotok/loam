---
service: notification-service
status: draft
owner: growth-team
sources:
  - internal/consumer/
  - internal/sender/
  - cmd/notifier/
---

# notification-service

Turns fleet events into customer email and SMS. This is the **living spec** — the complete
current state; feature deltas merge in here on `loam archive`.

This service exposes **no HTTP API**: the liveness and readiness probes in `health.yaml` are the
only ports it listens on, and nothing in the fleet calls them. That is a documented shape rather
than a gap — no edge in the landscape carries `metadata { op }` into this service, so
`loam validate` stays silent about the missing `openapi.yaml` instead of warning. The silence is
earned rather than granted: it turns into a warning the moment the landscape stops proving
nobody calls this service — it goes missing, or it stops parsing — and into an error the moment
a requirement here grows an `Operations:` line or an op-linked edge points in. Every requirement
below therefore carries a `Consumes:` line and no `Operations:` line: what this service promises
is a reaction to a message, and the message name is the only join it has.

## Requirements

### Requirement: Notify a customer when an order is placed

Requirement-ID: NTF-ORDER-PLACED
The service SHALL send exactly one order-confirmation notification per order, addressed to the
contact details it holds for the customer at the moment the confirmation is rendered.

Consumes: order.OrderPlaced

#### Scenario: First delivery of an order event
- **Given** an `order.OrderPlaced` carrying an `orderId` this service has never sent a confirmation for
- **When** the consumer handles it
- **Then** a confirmation is rendered from the contact details on file and handed to the provider
- **And** the delivery log records the send under that `orderId`

#### Scenario: The broker redelivers an event already sent
- **Given** a confirmation already recorded in the delivery log for that `orderId`
- **When** kafka redelivers the same `order.OrderPlaced`
- **Then** no second notification is sent and the event is acknowledged
- **And** the customer is not told twice about one order

### Requirement: Send a receipt when a payment is captured

Requirement-ID: NTF-RECEIPT
The service SHALL send a receipt for every captured payment, stating the captured amount and
currency exactly as the capture reported them.

Consumes: payment.PaymentCaptured

#### Scenario: Receipt follows a capture
- **Given** a `payment.PaymentCaptured` for an order this service has already confirmed
- **When** the consumer handles it
- **Then** a receipt showing `capturedAmount` in `currency` is sent to the contact on file

#### Scenario: A capture arrives before the order it belongs to
- **Given** a `payment.PaymentCaptured` whose `orderId` this service has not yet seen on the order topic
- **When** the consumer handles it
- **Then** the receipt is held until the matching `order.OrderPlaced` arrives, and sent then
- **And** no receipt is sent for an order the customer has not been told exists

### Requirement: Keep contact details current

Requirement-ID: NTF-CONTACT
The service SHALL keep its copy of a customer's email and phone in step with the CRM, applying
an update only when it is newer than the copy already held.

Consumes: crm.CustomerUpdated

#### Scenario: A newer update replaces the copy on file
- **Given** contact details held at `version` 4 for a customer
- **When** a `crm.CustomerUpdated` for that customer arrives at `version` 5
- **Then** the stored email and phone are replaced with the ones the event carries

#### Scenario: An out-of-order update is ignored
- **Given** contact details held at `version` 5 for a customer
- **When** a `crm.CustomerUpdated` for that customer arrives at `version` 4
- **Then** the stored details are left as they are
- **And** the next notification still goes to the newer address

#### Scenario: A customer this service has never notified
- **Given** a `crm.CustomerUpdated` for a `customerId` with no contact details on file
- **When** the consumer handles it
- **Then** the details are stored, so the first notification for that customer is addressable
