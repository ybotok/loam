# Checkout

The customer has chosen what to buy and now wants to be done. Everything from
the filled cart to the confirmed, paid order is this capability: the prices they
were shown, the money leaving their card exactly once, and the confirmation that
tells them it worked.

This narrative slot is why the tree exists at all. `architecture/capabilities.yaml`
can declare the word `checkout` and nothing more; the paragraph above is what a
business analyst actually writes, and before this file there was nowhere in a
loam docs repo to put it. It is also the loam equivalent of OpenSpec's
`## Purpose` prose, which the migrator used to drop into `legacy/`.

The requirements below are the analyst's, and each one is a promise a customer
could check from outside — no operationId, no element id, no message name, and
no service named. That is the rule the tree is held to, and half of it is
checked: `Operations:`, `Covers:`, `Publishes:` and `Consumes:` are refused here
(`capability.requirement-service-scoped`), while "names no service" is an
authoring rule this file keeps and pull-request review holds, because matching
service names in prose would be a heuristic and loam does not guess.

Which services carry which part of this is not written here and must not be:
that is the fleet map's question, and `loam list capabilities` answers it from
the `Capability:` lines the service specs already carry.

## Requirements

### Requirement: A confirmed order charges the customer exactly once
Requirement-ID: CHECKOUT-CHARGE-ONCE
The fleet SHALL charge a customer at most once for a single confirmed order,
and SHALL confirm an order only after that charge has been authorized.

#### Scenario: The customer submits the same order twice
- **Given** a customer who has confirmed an order
- **When** they submit the same order again without changing it
- **Then** they are shown the order they already placed
- **And** their card is charged only for the first one

#### Scenario: Authorization is declined
- **Given** a customer whose card is declined
- **When** they confirm the order
- **Then** no order is confirmed
- **And** they are told the payment did not go through

### Requirement: The price shown is the price charged
Requirement-ID: CHECKOUT-PRICE-HONOURED
The fleet SHALL charge the total the customer was shown at the moment they
confirmed, even if a price changes while the order is being placed.

#### Scenario: A price changes mid-checkout
- **Given** a customer looking at a total of 40.00
- **When** the price of an item rises before they confirm
- **Then** confirming still charges 40.00
