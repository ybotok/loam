---
service: identity-service
status: draft
owner: platform-identity
sources:
  - internal/tokens/
  - cmd/
---

# identity-service — architecture spec

The **living architecture spec**: the obligations no business scenario was ever going
to carry. Nothing in `spec.md` mentions key rotation or a cache TTL, because a caller
exchanging credentials for a token cannot observe either — and those are exactly the
places a coding agent cuts a corner unless the obligation is written where a test can
be generated from it.

Same grammar as `spec.md`, and one line more: `Covers:` is the architecture analog of
`Operations:`. Where a business requirement declares the operations it governs, an
architecture requirement declares the model objects its scenarios exercise — a C4
element id, an edge `source -> target`, or a health signal `sli:<id>` / `alert:<id>`.
`loam validate` grades the join in both directions: an entry that resolves to nothing
is `covers.unknown` (a mistyped id silently costs exactly the coverage it was written
for), and an SLI or alert in `health.yaml` that no requirement here covers is
`health.uncovered`. Every id below comes from `model.likec4` or `health.yaml` in this
directory; no entry names another service, because everything this service touches is
inside its own boundary. The element ids carry the full `marketplace.identityService.`
path because that is what the ids ARE: `model.likec4` extends the element the fleet map
declares inside the `marketplace` group, so a container it adds has no shorter spelling.
SCHEMA.md, "Two shapes of a service model", has the rule.

## Requirements

### Requirement: Signing keys rotate without invalidating live tokens

Requirement-ID: ARCH-KEY-ROTATION
The service SHALL keep the previous signing key verifiable for at least one full
token lifetime after promoting a new one, and SHALL never sign with a key that is
not already readable, from the key store, by every instance that answers
introspection. Rotation that flips both halves at once invalidates every token in
flight — an outage of the whole fleet, produced by a routine maintenance job, which
is why the overlap is a requirement and not a runbook note. The second half is the
one a single-instance test never catches: the signer and the verifier are different
processes reading the same store, and a key promoted before it lands there makes
one instance mint tokens the others report inactive.

Covers: marketplace.identityService.keyStore, marketplace.identityService.tokens -> marketplace.identityService.keyStore

#### Scenario: A rotation keeps tokens minted a minute earlier verifiable
- **Given** the active key K1 and tokens issued under it with thirty minutes of life left
- **When** K2 is promoted to active
- **Then** new tokens are signed with K2
- **And** tokens signed with K1 keep verifying until the last of them has expired

#### Scenario: A key is readable by every instance before it signs anything
- **Given** a newly generated key that is not yet in the key store the other instances read
- **When** the rotation job runs
- **Then** the key is written to the key store first and only then promoted to active
- **And** no token is ever signed with a key another instance could not verify

#### Scenario: Rotation is refused while the key store is unreachable
- **Given** the key store is unavailable
- **When** the rotation job runs
- **Then** it fails without promoting anything and the previous active key stays in use
- **And** the fleet keeps issuing tokens rather than half-rotating

### Requirement: Introspection is cached, and the cache cannot outlive a revocation

Requirement-ID: ARCH-INTROSPECT-CACHE
The service SHALL answer introspection from a cache whose entries expire within the
revocation propagation budget, SHALL delete a token's entry when that token is
revoked, and SHALL fall back to the key store when the cache is unavailable. The
cache holds derived state only: losing it costs latency, never correctness, and any
design where a cache miss can produce a *different verdict* is the bug this
requirement exists to prevent.

Covers: marketplace.identityService.introspectionCache, marketplace.identityService.tokens -> marketplace.identityService.introspectionCache

#### Scenario: A revocation invalidates the cached verdict immediately
- **Given** a token whose active verdict is cached
- **When** its client is revoked
- **Then** the cached entry is deleted as part of the revocation
- **And** the next introspection of that token reports inactive

#### Scenario: A cache entry cannot outlive the propagation budget
- **Given** a cached verdict written thirty seconds ago
- **When** it is read after its TTL has elapsed
- **Then** it is treated as a miss and the verdict is recomputed from revocation state

#### Scenario: The cache being down degrades latency, not the answer
- **Given** the introspection cache is unreachable
- **When** a token is introspected
- **Then** the verdict is computed from the revocations in the key store and is unchanged
- **And** the service stays available, paying for the miss in introspection latency alone

### Requirement: Token issuance is measured and paged

Requirement-ID: ARCH-ISSUE-HEALTH
The service SHALL export an availability and an issuance-latency SLI, and SHALL page
the identity on-call when issuance starts returning server errors. Issuance failing
is the one fault every other service in the fleet experiences as its own, so it is
paged rather than dashboarded.

Covers: sli:availability, sli:token_issue_latency_p99_ms, alert:token_issue_5xx

#### Scenario: Both SLIs are exported while the service serves traffic
- **Given** the service is serving token requests
- **When** its metrics endpoint is scraped
- **Then** `availability` and `token_issue_latency_p99_ms` report values against their SLOs

#### Scenario: Sustained issuance errors page the identity on-call
- **Given** more than 0.5% of token issuance requests return a server error over five minutes
- **When** the alert rules are evaluated
- **Then** `token_issue_5xx` pages the identity on-call

#### Scenario: An instance that cannot sign takes no traffic
- **Given** an instance whose active signing key failed to load
- **When** the readiness check is evaluated
- **Then** it reports not ready and is removed from the pool
- **And** the failure never reaches a caller as a server error
