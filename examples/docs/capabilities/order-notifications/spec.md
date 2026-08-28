# Order notifications

The customer has bought something and now wants to know it worked. Every event
in an [order](../../glossary/order.md)'s life that they would want to hear about
reaches them, once.

This capability carries the example's demonstration of the axis's second
realizer, and it is the reason the tree exists at all. The promise below is
**cross-service by construction**: an order is placed in one service, the event
crosses a broker, and a third service sends the message. No single service's
`spec.md` can promise "exactly one confirmation", because each of them promises
only its own part — `order-service` promises to announce the order,
`notification-service` promises to send what it receives, and neither can
promise what happens between them.

A USE CASE can, because it IS the hop sequence. So
`architecture/usecases/order-notification.likec4` carries `#req-NOTIFY-ONCE`
beside its `#cap-order-notifications` tag, and that tag is the architect's
answer to this promise: these hops, in this order, are what keeps it. loam
grades the claim down to the operation, and `capability.requirement-unrealized`
stays silent for this requirement because a flow keeps it.

Written with no `Operations:`, `Covers:`, `Publishes:` or `Consumes:` line —
those resolve against one service's own contract, and a capability requirement
must be observable from outside the fleet.

## Requirements

### Requirement: A placed order produces exactly one confirmation
Requirement-ID: NOTIFY-ONCE
The fleet SHALL send a customer exactly one confirmation for an order they
placed — not none if a service restarts mid-flight, and not two if a message is
delivered twice.

#### Scenario: The order is placed and the customer is told
- **Given** a customer who has just placed an order
- **When** the order is accepted
- **Then** they receive one confirmation naming that order

#### Scenario: The same event arrives twice
- **Given** a confirmation already sent for an order
- **When** the same event is delivered again
- **Then** the customer receives nothing further
