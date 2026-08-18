# order-service — requirement delta for FEAT-088

A `MODIFIED` requirement carries its full new text rather than a diff, so the merge REPLACES the
living requirement instead of folding into it. That is what makes the `Based-On:` pin below
load-bearing: it is the digest of the living requirement this text was written against, and
`delta.baseline-stale` refuses the merge when the living text has moved under it. `loam rebase`
writes the line and nobody writes it by hand — a pin says "I read this version", so restamping
without re-reading merges your text over somebody else's.

## MODIFIED Requirements

### Requirement: Cancel an order
Requirement-ID: ORD-CANCEL
Based-On: 16ba4428e292c1d9
The service SHALL let an order be cancelled while nothing irreversible has happened to it, SHALL
return the customer's money when the order's payment was already captured, and SHALL refuse once
the order has been handed to fulfilment — a cancellation after that point is a return, which
this service does not model.

Operations: cancelOrder
Requires: user/orders:cancel

#### Scenario: A customer cancels before fulfilment
- **Given** an order in state `awaiting_payment`
- **When** its owner calls `cancelOrder`
- **Then** the order moves to `cancelled` and no further payment work is started

#### Scenario: Cancelling a confirmed order refunds its captured payment
- **Given** an order in state `confirmed` whose payment was captured
- **When** its owner calls `cancelOrder`
- **Then** `refundPayment` is called on payment-service for that payment
- **And** the order moves to `cancelled` only once the refund is recorded

#### Scenario: An order already handed to fulfilment cannot be cancelled
- **Given** an order in state `fulfilling`
- **When** `cancelOrder` is called for it
- **Then** the service refuses with 409 and the order stays `fulfilling`
