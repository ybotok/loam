# Identity tokens

Somebody signs in once and stays signed in for a while; the fleet has to keep
answering "is this still them?" without asking again, and has to stop answering
yes the moment it should not.

This file also demonstrates NESTING, which is the part of the tree that is easy
to get wrong when reading the layout. The id is `identity/tokens` — one id, with
the slash inside it, exactly as `architecture/capabilities.yaml` spells the key
and exactly as a requirement's `Capability:` line writes it. The tree does not
collapse it and does not invent a separator: the id's own slashes ARE the
directories, so the document lives at `capabilities/identity/tokens/spec.md`.

`capabilities/identity/` therefore holds no `spec.md` of its own, and that earns
no finding: a directory with a capability beneath it is a group. It would earn
`capability.doc-missing` only if it held neither a document nor anything below.
If the fleet later decides that `identity` is a capability in its own right,
adding `capabilities/identity/spec.md` makes it one — a directory may be both a
capability and the parent of others, because that is what the ids already say.

## Requirements

### Requirement: A revoked session stops working everywhere
Requirement-ID: IDENTITY-REVOKE-EVERYWHERE
When a person's session is revoked, the fleet SHALL stop honouring it — in
every part of the product, not only the one they revoked it from.

#### Scenario: Signing out of a lost phone
- **Given** a person signed in on two devices
- **When** they sign out one of them from the other
- **Then** the signed-out device can no longer act as them

### Requirement: Signing in again does not silently extend an old session
Requirement-ID: IDENTITY-NO-SILENT-EXTENSION
The fleet SHALL NOT extend an existing session past its stated lifetime because
the person signed in again elsewhere.

#### Scenario: A second sign-in on a new device
- **Given** a session that expires in ten minutes
- **When** the same person signs in on another device
- **Then** the first session still expires in ten minutes
