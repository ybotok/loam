---
service: checkout-web
status: verified
owner: checkout-team
last_verified: 2026-07-31
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
scenarios that govern it; `loam render` generates an HTML prototype.
