---
service: checkout-web
status: verified
owner: checkout-team
last_verified: 2026-07-31
---

# checkout-web — capability spec

## Capabilities
- **Checkout flow** — cart -> payment -> confirmation.
- **Split payment** — let a customer split a payment across payees (FEAT-101).

## UI
Pages live under `ui/pages/`. Each page-spec links the endpoints it consumes and the
scenarios that govern it. `loam` generates an HTML prototype from each page-spec.
