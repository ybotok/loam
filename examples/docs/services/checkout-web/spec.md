---
service: checkout-web
status: draft
owner: checkout-team
---

# checkout-web

The customer-facing checkout SPA. It owns no store and exposes no operations of its own —
every requirement below is satisfied by calling `order-service` and `payment-service` — which
is why no requirement here carries an `Operations:` line and why this directory holds no
`openapi.yaml`. That absence is graded on evidence, not on the file list: `service.no-openapi`
stays silent because the landscape parses and no op-linked edge points AT checkout-web, so
nobody is expecting a contract here. A UI in a fleet map that could not be read would get the
warning instead, because "I could not look" and "nobody calls me" are different facts.

**This spec names no `sources:`, on purpose.** `loam validate` reports `sources.absent`
against it, and that warning is the point: the UI baseline is not yet tied to code, so nothing
can tell you when the pages drift from what the SPA actually renders, and `loam vouch` would
refuse to stamp it. Every other service in this example names the paths in its own repository
its spec was written from; this one shows what the absence costs — a document that is internally
consistent, passes every join below, and is answerable to nothing outside itself.

## Requirements

### Requirement: Checkout flow

Requirement-ID: WEB-CHECKOUT
The UI SHALL carry a customer from a filled cart to a confirmed order in one pass, and SHALL
show a confirmation only for an order `order-service` has acknowledged — never for one the
client assumed went through.

#### Scenario: Complete a checkout
- **Given** a cart holding at least one line and a payment method the customer has entered
- **When** the customer confirms the purchase
- **Then** `createOrder` records the order and `authorizePayment` reserves the funds against it
- **And** the confirmation shows the order id the API returned, not one the UI minted

#### Scenario: Authorization is refused
- **Given** a filled cart and a card the issuer declines
- **When** the customer confirms the purchase
- **Then** the payment step stays open with the cart, address and delivery choice intact
- **And** the customer is asked for another payment method rather than being returned to the cart

#### Scenario: The customer submits twice
- **Given** a checkout that has already sent `createOrder` under an idempotency key
- **When** the customer presses the confirm button again before the first response arrives
- **Then** the second request carries the same key and `order-service` answers 409
- **And** the UI opens the order that already exists instead of starting a second checkout

### Requirement: Show order status

Requirement-ID: WEB-ORDER-STATUS
The UI SHALL show the current state of an order from `order-service`, and SHALL answer
identically for an order that does not exist and for one that belongs to somebody else, so a
guessed id cannot confirm that an order is real.

#### Scenario: Show the current state of an order
- **Given** a placed order the signed-in customer owns
- **When** the customer opens its status page
- **Then** the page renders the state `getOrder` returns
- **And** it does not fall back to the state the checkout flow last saw, stale since capture

#### Scenario: The order id is not the customer's
- **Given** an order id belonging to another customer
- **When** the signed-in customer opens its status page
- **Then** `order-service` answers 404 and the page says the order was not found
- **And** an id that was never issued produces the same page, so the difference leaks nothing

## UI

Pages live under `ui/pages/`, one file per page. Each page-spec joins the two axes a UI sits
between: `consumes:` names the fleet operations the page depends on, by the same `operationId`
the provider's `openapi.yaml` declares, and `behavior:` names the scenarios above that govern
what the page does with them. Where the matching landscape edge carries `metadata { op }`, the
fleet map and the page-spec name that operation twice and can be read against each other; where
it does not — the `checkout-web` → `payment-service` edge — the page-spec is the only place the
operation is written down at all. Planned: `loam render` generates an HTML prototype from the
page-spec, so the prototype and the requirement can never disagree about which endpoint a
button calls.

`split-payment.page.yaml` is the exception in this directory: it carries `feature: FEAT-101`
because the requirement governing it lives under `features/FEAT-101-payment-splitting/` and not
in this file yet. Its `behavior:` references are spelled with the feature id in front for exactly
that reason, and drop it once `loam archive` has folded the delta into the requirements above —
by hand, since no command reads page-specs yet and none will rewrite this one for you.
