# order-service — requirement delta for FEAT-112

## REMOVED Requirements

### Requirement: Accept an order through the v1 API

Requirement-ID: ORD-PLACE-V1
Based-On: 3671415e0f4d7b13
The service SHALL accept an order through the pre-idempotency `/v1/orders` path for the one
partner integration that has not migrated.

Operations: createOrderV1

#### Scenario: A partner places an order through the v1 path
- **Given** a partner request with no idempotency key
- **When** it is posted to the v1 path
- **Then** an order is created and its id is returned
