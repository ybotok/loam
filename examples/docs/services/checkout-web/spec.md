---
service: checkout-web
status: draft
owner: checkout-team
---

# checkout-web

Customer-facing checkout UI.

## Requirements

### Requirement: Checkout flow
The UI SHALL take a customer from cart to payment to confirmation.

#### Scenario: Complete a checkout
- **Given** a cart with items
- **When** the customer pays
- **Then** an order confirmation is shown

## UI

Pages live under `ui/pages/`. Each page-spec links the endpoints it consumes and the
scenarios that govern it; planned: `loam render` generates an HTML prototype.
