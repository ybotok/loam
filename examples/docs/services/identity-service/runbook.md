---
service: identity-service
status: draft
owner: platform-identity
---

# identity-service — runbook

Written for whoever is holding the pager at 03:00, so every step below is one a
stranger to this service can carry out. `loam list` tracks only that this file
exists; nothing in it is checked, which means the burden of keeping it true is on
the same PR that changes the behaviour it describes.

Read this together with `arch.spec.md`: the two incidents below are the failure
modes ARCH-KEY-ROTATION and ARCH-INTROSPECT-CACHE exist to prevent, and each
mitigation here is the manual version of a promise the service is supposed to keep
on its own.

## Deploy
- Pipeline: `.github/workflows/release.yml` → `deploy-prod`, gated on a manual approval.
- Config: `config/prod.yaml`; the signing key material is never in it — the service
  reads keys from the key store at startup and gets its store credentials from Vault
  (`secret/identity-service`).
- Rollout is one instance at a time, and the gate is readiness (below). A key store
  the new revision cannot reach fails readiness and stalls the rollout, which is the
  intended outcome: half a fleet unable to sign is worse than a paused deploy.

## Health
- Liveness: `GET /healthz` — the process answers. Nothing behind it is checked, so
  this never restarts an instance for a dependency's fault.
- Readiness: `GET /readyz` — the active signing key is loaded and the key store
  answers. An instance that is up and cannot sign must take no traffic; it would
  turn every issuance into a 5xx and burn `token_issue_5xx` for a fault that a
  rolling restart fixes.
- SLIs and the alert are declared in `health.yaml`; the arch requirement covering
  them is ARCH-ISSUE-HEALTH.

## Common incidents

### A rotation promoted a key the other instances cannot read
**Symptom.** Token issuance is fine, and every other service starts rejecting
tokens: 401s spread across the fleet within seconds of a rotation job running,
while `token_issue_5xx` stays quiet because *this* service is healthy. The
consumers are refusing on an introspection verdict of `active: false` — freshly
minted tokens that this service itself will not vouch for.

**Cause.** The new key was promoted to active before every instance could read it
from the key store, or the previous key was retired inside one token lifetime.
Either breaks the overlap ARCH-KEY-ROTATION requires: the instance that mints and
the instance that answers introspection are different processes, and only the key
store makes them agree.

**Mitigation.**
1. Demote to the previous key: `identityctl keys promote --key <previous-kid>`.
   Tokens already signed with the bad key keep reading inactive; they expire within
   a lifetime and there is nothing to do about them.
2. Confirm the key store holds both kids, and that a *different* instance than the
   one you are on can verify a token minted with the new kid, before promoting
   anything again.
3. Do not "fix" it by shortening the token lifetime — that widens the outage.

**Prevention.** Write, wait one full token lifetime, then promote. The rotation job
does this on its own; a manual promotion is the way it gets skipped.

### The introspection cache stampeded
**Symptom.** The key store's connection pool saturates and `token_issue_latency_p99_ms`
climbs past its SLO — issuance signs from the same store, so a flood of introspection
misses shows up on the issuance SLI even though issuance is not what changed. Usually
right after a cache restart, a failover, or a mass revocation that cleared many
entries at once.

**Cause.** Every introspection missed at the same moment and each miss became a
key store read. The service stays *correct* through this — ARCH-INTROSPECT-CACHE
requires a miss to produce the same verdict — so what is failing is latency, and
the cure is to protect the store rather than to bypass the cache.

**Mitigation.**
1. Check the miss rate and the store's pool metrics before touching anything; if
   the pool is not saturated, this is a different incident.
2. Raise the per-key single-flight window (`introspection.singleflight_ms`) so that
   concurrent misses for one token collapse into one store read.
3. If the store is already saturated, shed introspection load at the gateway before
   restarting the cache — a cold restart replays the stampede.
4. Never disable the cache to "get more capacity": every request then reaches the
   store.

**Prevention.** Jittered TTLs and single-flight on miss, both of which the cache
layer owns; a mass revocation should delete entries in batches rather than flush.

## Escalation
- On-call channel: `#identity-oncall`; the alert `token_issue_5xx` pages it directly.
- Because every service depends on this one, an incident here is announced in
  `#fleet-incidents` as soon as it is confirmed, before it is understood — the
  consumers are the ones who will see the symptom first.
- Owning team: platform-identity.
