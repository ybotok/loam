# Behavioral gherkin. Tags carry the spine (feature + services). Generated from the delta,
# refined by a human, then drives TDD. Also the source for the FEAT-101 sequence diagram.
@FEAT-101 @checkout-web @payment-split-service
Feature: Split a payment across payees

  Scenario: Customer splits a payment across two payees
    Given a payment of 100.00 USD for order "A-1"
    When the customer splits it as 60.00 to "seller-x" and 40.00 to "seller-y"
    Then payment-split-service records a split with two shares summing to 100.00
    And a "PaymentSplit" event is published to kafka
