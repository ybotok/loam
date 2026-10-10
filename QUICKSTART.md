# loam quick start

From installation to the first agent-driven change, with the smallest useful setup. Section 2 is
ten minutes with the CLI alone — no agent, no service checkout, no adoption — and shows the check
only a fleet-wide map can make: a call between two services that names an operation the provider
does not have. From section 3 on, the guide uses one application and a local docs directory. A real
fleet normally keeps that directory in a separate repository; the commands and chat flow stay the
same.

## 1. Install

loam requires Node 22.22.3 or newer.

```bash
npm install -g @ybotok/loam
loam --version
```

A project-local install works too: `npm install --save-dev @ybotok/loam`, then replace `loam` below
with `npx loam`.

## 2. Ten minutes, CLI only: the fleet spine

Nothing here needs requirement Markdown, `loam adopt` or `loam vouch` — only the map and a contract
you already have. In an empty directory, write `fleet.yaml`: the services, and who calls whom.

```yaml
services:
  - order-service
  - payment-service

calls:
  - order-service -> payment-service
```

Make the docs repo there, and let `seed` draw the map from that file:

```bash
loam init --docs . --create
loam seed --from fleet.yaml
```

```text
architecture/landscape.likec4 written (replaced the scaffold's untouched stub) — 2 service(s), 1 call(s), from fleet.yaml
  + architecture/landscape.likec4
  + services/order-service/.gitkeep
  + services/payment-service/.gitkeep
  + architecture/services.likec4

Next:
  loam validate --all
  loam list --needs-work
  loam adopt --service order-service
```

Now the two things only you can do. First, put the provider's existing contract at
`services/payment-service/openapi.yaml` — copy the one its build produces; loam never generates it
and never reads the code. For this walk-through, one operation is enough:

```yaml
openapi: 3.1.0
info:
  title: payment-service
  version: 1.0.0
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses:
        "201":
          description: Authorized
          content:
            application/json:
              schema: { type: object }
```

Second, name the operation on the call edge in `architecture/landscape.likec4`. `seed` drew the
edge bare; replace that line with this one, spelled the British way on purpose:

```likec4
  svc_order_service -> svc_payment_service 'Authorises the order' {
    metadata { op 'authorisePayment' }
  }
```

```bash
loam validate --all --errors-only
```

```text
No C4 model at <docs>/services/order-service/model.likec4. Run `loam adopt` for 'order-service' first.  (service.no-model)
No C4 model at <docs>/services/payment-service/model.likec4. Run `loam adopt` for 'payment-service' first.  (service.no-model)
⚠ payment-service: 1 operation(s) not governed by any requirement — authorizePayment  (api.ungoverned)
✗ payment-service: landscape edge order-service → payment-service calls 'authorisePayment', not defined in payment-service's OpenAPI  (spine.op-undefined)

2 services, 0 features — 3 errors, 3 warnings
⚠ requirements axis not started fleet-wide (0 of 2 services), expected during staged adoption — 2 warning(s) grouped: service.no-spec×2; every finding is unchanged in --json

→ `loam explain <code>` says what a code means and how to fix it
```

(`<docs>` is the absolute path of the directory; a fleet scorecard follows, cut here.) The last
`✗` line is the one you came for: one letter between the map and the provider's contract, an
**error**, and no other check a team normally runs would see it. `loam explain spine.op-undefined`
says what it means and what to do. The two `service.no-model` errors are not misconfiguration:
they are a truthful reading of a fleet where adoption has not started, and they stay until each
service has a model. Spell the operation `authorizePayment` and the `✗` line is gone — the edge now
reads `spine.resolved` in `--json`. Committed, this directory is a docs repo, and README's
[PR recipe](README.md#guard-the-fleets-edges-on-every-pr) guards these edges on every pull request
from here on — `loam diff --base` names who still calls an operation a branch removes.

A change can start before any adoption, too. A feature that only states requirements needs no C4
delta and no contract change:

```bash
loam new FEAT-1 --title "Idempotent payment authorization" --touches order-service --touches payment-service
```

```text
FEAT-1 scaffolded at features/FEAT-1-idempotent-payment-authorization
  + features/FEAT-1-idempotent-payment-authorization/intent.md
  + features/FEAT-1-idempotent-payment-authorization/delta.likec4
  + features/FEAT-1-idempotent-payment-authorization/specs/order-service/spec.md
  + features/FEAT-1-idempotent-payment-authorization/specs/payment-service/spec.md

Next: fill in the delta, then `loam validate --feature FEAT-1`.
If this feature changes no architecture, delete delta.likec4 — a requirements-only
feature is complete without it, and an empty `model {}` validates clean too.
```

Delete `delta.likec4`, write the intent's Why and Scope and its `owner`, and replace each
`specs/<service>/spec.md` with the requirement that service takes on — the file's comment carries
the template. payment-service's, for example:

```markdown
# payment-service — requirement delta for FEAT-1

## ADDED Requirements

### Requirement: Authorize a payment once per idempotency key
Requirement-ID: PAY-AUTHORIZE-IDEMPOTENT
Operations: authorizePayment

The service SHALL return the original authorization, and charge nothing, when a request repeats an
idempotency key it has already authorized.

#### Scenario: A retried authorization is not charged twice
- **Given** a payment authorized under idempotency key K
- **When** an authorization request arrives again with key K
- **Then** the response carries the original authorization and no second charge is made
```

```bash
loam validate --feature FEAT-1
loam archive FEAT-1 --dry-run
```

```text
FEAT-1
✓ order-service: requirements covered (1 requirement, all with scenarios)
✓ payment-service: requirements covered (1 requirement, all with scenarios)
  coherence: ✓ C4 · requirements · OpenAPI agree
archive FEAT-1  (dry run)

  requirements: order-service — created living spec.md (1 requirement(s))
  requirements: payment-service — created living spec.md (1 requirement(s))

  plan — 2 file(s):
    create  services/order-service/spec.md
    create  services/payment-service/spec.md
    move    features/FEAT-1-idempotent-payment-authorization → features/archive/FEAT-1-idempotent-payment-authorization

  dry run — nothing was written.
```

The archive would write each service's first living `spec.md` from the change itself, and the
`Operations:` line already joins payment-service's requirement to the contract above. That is the
small-change loop WORKFLOW.md calls
[the honestly-small change](WORKFLOW.md#the-honestly-small-change), used as a first entry. The adoption below is still how a service's existing behaviour gets written down; this is
how a change that cannot wait for it starts.

## 3. Wire one project

Run this in the code repository you want to govern:

```bash
loam init --docs loam-docs --create --service commerce-app
loam doctor
```

This creates a docs repo under `loam-docs/`, binds the current code checkout to the governed
boundary `commerce-app`, and installs command and Agent Skill pointers for the AI tools it detects.
Commit the generated `loam.json`, agent files and docs directory. Use your real stable service or
application id instead of `commerce-app`.

`--create` is only for a new docs repo. To join an existing shared docs repo from one service's
checkout, use:

```bash
loam init --docs ../architecture-docs --service commerce-app --agent-profile service
loam doctor
```

`--agent-profile service` installs the entry points that run beside the code — adopt, implement,
check, verify and report — and leaves feature authoring and shipping to the shared docs repo,
which takes `--agent-profile docs` when its own `loam init` runs. Without the flag every checkout
gets all seven. The one-project setup above keeps all seven on purpose: there, the code repo is
also where features are written and shipped.

## 4. Adopt what already exists

In chat, use the explicit entry point:

```text
/loam-adopt commerce-app
```

The agent loads the version-matched protocol, asks loam for an adoption brief, reads the code, writes
the baseline as draft, and validates it. It must report what it did not inspect or could not prove.
The agent does not vouch for its own work. After reviewing the baseline, a person runs:

```bash
loam vouch --service commerce-app
```

Most hosts use `/loam-adopt`; Gemini uses `/loam:adopt`, Amazon Q uses `@loam-adopt`, and a
skills-only host can use `$loam-adopt`. A natural-language request such as “adopt commerce-app into
loam” may load the same skill automatically, but the explicit spelling is the predictable path.

## 5. Make the first change

For this one-project setup, stay in the wired code repo: its `loam.json` resolves `loam-docs/`, and
its generated agent entries are already present. In a separately cloned team docs repo, run
`loam init` there once to install that repo's own entries before starting chat.

```text
/loam-feature FEAT-101 "Split payments"
```

The agent explores the living model before it proposes anything, scaffolds the feature, authors its
intent and deltas, and validates the result. Then use the remaining entry points as the work moves:

```text
/loam-implement FEAT-101 commerce-app
/loam-check FEAT-101
/loam-verify FEAT-101
/loam-ship FEAT-101
```

`loam-implement` runs in each affected code checkout. `loam-check`, `loam-verify` and `loam-ship`
read the files and machine envelopes rather than relying on conversational memory. Shipping begins
with an archive dry run and still waits for the code merge and any human-only decision.

At any point, this is the reliable way to resume:

```bash
loam status --json
```

Its ordered `next[]` is the work queue. The agent runs an entry only when `next[].execution.runnable`
is true; edits, work in another checkout and human review stay visibly different.

## 6. When something behaves badly

Use the support entry point; it is not another lifecycle step:

```text
/loam-report
```

Or ask naturally: “Create a loam problem report for what just happened.” The generated
`loam-report` Agent Skill preserves the symptom, collects `loam --version`, `loam doctor --json`,
relevant status and the smallest safe reproduction, and writes a separate file:

```text
loam-reports/NNN-YYYY-MM-DD-short-symptom.md
```

`NNN` is the report's ordinal — at least three digits, zero-padded, one more than the highest
already in the directory, which
`loam doctor` reports together with how many reports are open, sent, fixed or superseded — and a
`Status: open` line in the header is where the report's own state is kept (`doctor` reads it from
the header block above the first `##` heading, never from a quoted template inside the body). The report records
expected versus actual behavior, stable codes, relevant locations, write state, classification and
missing evidence. It replaces secrets with `<redacted>`, prefers repo-relative
paths, does not copy source/spec bodies, does not retry a writer merely to reproduce it, and never
uploads or submits anything automatically. Review the file before sharing or committing it.

If the report command or skill file is missing after an upgrade, rerun `loam init`. loam refreshes
only pointers whose recorded digest still matches; a file your team edited remains untouched.

## What to read next

- [WORKFLOW.md](WORKFLOW.md) explains the complete lifecycle and human/agent boundary.
- [SCHEMA.md](SCHEMA.md) defines every docs-repo artifact and join.
- [COMPARISON.md](COMPARISON.md) explains where loam fits beside neighboring tools.
- [docs/SERVICE-TEAMS.md](https://github.com/ybotok/loam/blob/main/docs/SERVICE-TEAMS.md) is the
  one screen for a team whose repository is one service in a fleet.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) covers an OpenSpec migration.

Three rules prevent most surprises: use `--create` only once, let a human vouch, and branch on JSON
codes rather than message prose.
