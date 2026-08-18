# payment-split-service — requirement delta for FEAT-101

A delta is reviewed as a diff. Every requirement below sits under an `## ADDED|MODIFIED|REMOVED
Requirements` heading, which is what gives it a kind: a requirement under any other H2 merges as
nothing, and `delta.requirement-not-merged` names it rather than letting authored text vanish.

## ADDED Requirements

### Requirement: Split a payment

Requirement-ID: SPL-SPLIT
The service SHALL split a payment across two or more payees such that the shares sum to the
total, and SHALL refuse a split whose shares do not.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00 USD for order "A-1"
- **When** it is split 60.00 to "seller-x" and 40.00 to "seller-y"
- **Then** a split with two shares summing to 100.00 is recorded
- **And** a `PaymentSplit` event is published to kafka

#### Scenario: Reject a split that does not sum to the total
- **Given** a payment of 100.00 USD
- **When** a split of 60.00 + 30.00 is requested
- **Then** the split is refused with 422 and the shares that were sent are echoed back

#### Scenario: Split across many payees
- **Given** a payment of 100.00 USD for order "A-1"
- **When** it is split across the payees below
- **Then** a split with those shares is recorded

  | payee    | share |
  |----------|-------|
  | seller-x | 50.00 |
  | seller-y | 30.00 |
  | seller-z | 20.00 |

### Requirement: Read a split

Requirement-ID: SPL-READ
The service SHALL return a recorded split with its shares, so that checkout can show a customer
what was agreed before confirmation.

Operations: getSplit

#### Scenario: Read a recorded split
- **Given** a split recorded for order "A-1"
- **When** it is requested by its id
- **Then** its shares and their payees are returned

#### Scenario: Read a split that does not exist
- **Given** a split id nothing ever recorded
- **When** it is requested
- **Then** the request is refused with 404
