---
service: identity-service
status: draft
owner: platform-identity
sources:
  - internal/tokens/
  - cmd/
---

# identity-service

Issues the access tokens every other service in this fleet presents, and answers the
one question those services cannot answer for themselves: is this token still good?
This is the **living spec** — the complete current state, the operation on its way
out included. Feature deltas (ADDED/MODIFIED/REMOVED requirements) merge in here on
`loam archive`.

`status: draft`, and no digest anywhere in the frontmatter: nothing in this directory
has been vouched. `sources` names the two trees in the service's own repository these
requirements were written from, so that when `loam validate` runs inside that repo it
can say whether the code has moved since a human last read it (`sources.current` /
`sources.stale` / `sources.unvouched`). Writing `status: verified` by hand would be a
claim about bytes nobody hashed — the exact forgery `loam vouch` exists to make
impossible, which is why it and it alone writes `sources_digest`, `content_digest`,
`last_verified` and `vouched_by`.

One requirement below, `Answer legacy token validation`, deliberately draws
`api.requirement-deprecated`: it governs only an operation this service's OpenAPI
marks `deprecated: true`. That warning is the point — it is how a fleet sees, from
`loam validate` rather than from a migration wiki, which promised behaviour is being
retired and has not finished going.

## Requirements

### Requirement: Issue an access token

Requirement-ID: IDN-ISSUE
The service SHALL issue a signed, expiring access token to a client that presents
valid credentials, and SHALL refuse every other caller with one indistinguishable
refusal — a response that reveals which half of the credential was wrong turns the
token endpoint into a client-enumeration oracle.

Operations: issueToken
Capability: identity/tokens

#### Scenario: A valid client credential is exchanged for a token
- **Given** a registered client whose secret has not been revoked
- **When** it posts its credentials to the token endpoint
- **Then** a token signed by the currently active key is returned
- **And** the response states the expiry the token was minted with

#### Scenario: An unknown client is refused
- **Given** a client id that was never registered
- **When** it posts credentials to the token endpoint
- **Then** the request is refused with 401 and no token is minted
- **And** the body says only that authentication failed

#### Scenario: A revoked secret is refused identically
- **Given** a registered client whose secret was revoked an hour ago
- **When** it posts its old credentials to the token endpoint
- **Then** the request is refused with 401
- **And** the response is byte-identical to the unknown-client refusal, so the two cases cannot be told apart from outside

### Requirement: Introspect a token

Requirement-ID: IDN-INTROSPECT
The service SHALL report, for any token a caller presents, whether it is active now
and what it grants — computed from revocation state, never from the token's signature
alone, which stays valid for the whole of a revoked token's remaining lifetime. Only
callers holding `service/tokens:introspect` SHALL be answered: an introspection
endpoint open to anything on the network is a token-validity oracle for stolen
tokens.

Operations: introspectToken
Requires: service/tokens:introspect
Capability: identity/tokens

#### Scenario: An active token is described to its caller
- **Given** a token issued eight minutes ago with a thirty-minute lifetime
- **When** order-service introspects it
- **Then** the verdict is active, with the client it was issued to and the scopes it carries

#### Scenario: A revoked token reads inactive while its signature still verifies
- **Given** a token whose client was revoked after issuance
- **When** the token is introspected
- **Then** the verdict is inactive
- **And** no subject or scope is disclosed for it

#### Scenario: A caller without the introspection permission is told nothing
- **Given** a caller whose own token does not hold `service/tokens:introspect`
- **When** it introspects somebody else's token
- **Then** the request is refused before any verdict is computed
- **And** the refusal is the same whether or not the presented token exists, so a caller cannot use the refusal itself to test tokens

### Requirement: Answer legacy token validation

Requirement-ID: IDN-VALIDATE-LEGACY
`validateToken` is superseded by `introspectToken` and is kept alive for exactly one
reason: payment-service still calls it, and the fleet map says so with an op-linked
edge. Until that consumer migrates, the service SHALL answer the legacy endpoint with
the same verdict introspection would give — never a cheaper local signature check —
and SHALL NOT extend it: no new caller, no new field, no new status code. The
endpoint is retired by a feature delta that removes the operation and this
requirement together, not by quietly deleting either.

Operations: validateToken

#### Scenario: The legacy verdict agrees with introspection
- **Given** a token that introspection reports as active
- **When** the same token is checked through the legacy endpoint
- **Then** it is reported valid, with the same expiry introspection gave

#### Scenario: A revoked token is not reported valid by the legacy path
- **Given** a token whose client was revoked after issuance
- **When** the legacy endpoint is asked about it
- **Then** it is reported invalid
- **And** the answer came from revocation state, not from the token's signature
