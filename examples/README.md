# The example fleet

`docs/` is a complete, runnable loam docs repo. It is small enough to read in one sitting and large
enough that every row of [SCHEMA.md](../SCHEMA.md)'s canonical-joins table is exercised by something
— including the joins that only appear once a fleet has more than two services in it.

Run it from a clone. `docs/loam.json` is committed and says `"docsDir": "."`, so the tree governs
itself: every command below resolves to this fleet because it is run from inside it. There is
nothing to write first and nothing to delete afterwards.

```bash
cd examples/docs
loam list                          # the fleet and its maturity ladder
loam status                        # what to do next, derived from the files
loam validate --all                # the gate CI runs
loam archive FEAT-101 --dry-run    # the three-axis merge plan, writing nothing
loam archive FEAT-112 --dry-run    # an operation being retired, writing nothing
loam verify FEAT-088               # a shipped feature's done-check: attested
loam verify FEAT-120               # …and its pair, the same check: verified
loam dependencies                  # the active-feature graph
```

Working on loam itself and running from source, use `npx tsx ../../src/cli.ts <args>` in place of
`loam`. Not `npm run dev --`: npm runs a script from the package root, so it would leave
`examples/docs` and resolve some other `loam.json` — the fleet it reported would not be this one.

`test/examples.test.ts` pins the validate summary, every finding code and the archive plans
file-for-file, so nothing below can drift away from the code without a test going red.

## What is in it

Five services, drawn inside one grouping element so the map looks like ordinary grouped C4:

| service | what it is here to show |
|---|---|
| `checkout-web` | a UI service: page-specs under `ui/pages/`, no `openapi.yaml` of its own, and the one spec in the fleet that names no `sources` |
| `order-service` | the busiest spine: four operations, a produced event, a consumed event, and a deprecated operation with a feature already open to retire it |
| `payment-service` | the outbox, the acquirer, and an `arch.spec.md` whose `Covers:` lines reach the C4 model *and* the health signals |
| `identity-service` | the permission vocabulary's owner, and a deprecated operation whose consumer has not migrated — filed into `services/platform/` |
| `notification-service` | a service with no HTTP API at all — three consumed messages, one of them from a producer outside the fleet — filed into `services/platform/` |

Around them: `kafka` as an `#external` `#platform` system with a topic per channel (edges point at
the topic, never at the broker), `stripe` and `salesforce` as external systems, and
`architecture/permissions.yaml` as the fleet's authorization vocabulary.

**Three authored capability documents**, which are the business tree rather than the architecture:
`capabilities/checkout/spec.md`, `capabilities/identity/tokens/spec.md` and
`capabilities/order-notifications/spec.md`. The third carries the axis's second realizer: its one
promise — "a placed order produces exactly one confirmation" — is cross-service by construction, so
no service's `spec.md` can keep it, and `architecture/usecases/order-notification.likec4` claims it
with `#req-NOTIFY-ONCE` beside its `#cap-` tag. The other two are kept by service requirements
through `Realizes:`. Both ids are also declared in `architecture/capabilities.yaml` — the vocabulary
is the union of the two sides, and a name a document elaborates does not have to leave the YAML,
which is what keeps the metadata (`description`, `owner`) that a document has no field for. The
nested one carries the lesson: the id `identity/tokens` keeps its slash everywhere it is written, so
the tree spells it as directories, and `capabilities/identity/` holding no `spec.md` of its own is a
GROUP and earns no finding. Each requirement in both files is a promise a customer could check,
names no service, and carries a `Requirement-ID:` — required here, unlike in a service spec, because
these documents outlive every service that realizes them.

**Two glossary terms**, `glossary/order.md` and the nested `glossary/payments/authorization.md`,
each cited from the capability documents that use the word. This is the axis's whole mechanism in
two files: the citation is an ordinary markdown link, so `loam validate` resolves it like any other
and `loam list glossary` can answer "which documents use this term" as a join rather than a grep.
The two terms also cite EACH OTHER, which is deliberate — a glossary is a network of definitions —
and that reciprocal pair is exactly what does NOT count as adoption: both terms stay out of
`glossary.unlinked` because a capability document cites them, not because they cite each other.
Delete either of those two capability citations and the example gains a tenth warning.

**One architectural obligation, declared and applied and met** — which is three files agreeing, and
the axis's whole mechanism. `architecture/adrs/0001-transactional-outbox.md` says WHAT was decided;
`#obl-outbox` on the `payment-service → kafka.paymentEvents` edge in the fleet map says WHERE it
holds (on the publish edge, not on the service — payment-service also serves an API that owes
nothing of the kind); `architecture/obligations.yaml` declares the name so a mistyped tag is an
error rather than a word nobody notices; and `ARCH-PAY-OUTBOX` in payment-service's `arch.spec.md`
covers that same edge, which is the team saying it is met. Because all four line up, the example is
SILENT about the outbox — the working join produces no finding, which is what a working join should
do. The second declaration, `idempotency-key`, is the one that talks: it is declared and placed
nowhere, and `obligation.unapplied` is the warning in the table below.

**On the event spine the arrow follows the message** — producer → topic for `publishes`, topic →
consumer for `consumes` — and that is load-bearing rather than aesthetic. `publishes` binds the
edge's source and `consumes` binds its target, so a consume edge drawn the other way round binds to
nothing: the metadata parses, the document validates, and the check silently grades zero edges.
Nothing in loam reports that today, which is why the landscape says so in a comment.

## Four features, at four points in their life

The two archived ones are a **matched pair**, and the pairing is the point: same command, same
shape of record, two different verdicts. A showcase that demonstrated only one would teach that the
distinction is decorative — and keeping those two answers apart is most of what loam claims to be
for.

- **`features/archive/FEAT-088-refunds/`** — shipped, and **`attested`**. It was merged by the real
  `loam archive`, so its `.loam-before/` snapshot holds the exact bytes the merge overwrote and
  `loam unarchive FEAT-088` would put them back. Its `verification.yaml` is the done-check written
  down: every claim is confirmed, but the scenario claims rest on an agent's word instead of a
  digest-matched test run. loam does not pretend those are the same thing.
- **`features/archive/FEAT-120-refund-notification/`** — shipped, and **`verified`**. The sequel
  FEAT-088 left open: the money went back and nobody told the customer. It publishes
  `payment.PaymentRefunded` from payment-service and has notification-service turn it into the
  message the customer is waiting for — so it exercises the event spine end to end, across two
  services, with no HTTP anywhere in it.

  Its five scenario claims were answered by `--results` from the `scenario-report.json` beside it:
  loam's own runner-neutral `{"loamScenarioReport": 1, …}` shape, which any runner can be adapted
  into. Its two `event.declares` claims still rest on an agent's word. That mix is the honest
  common case — a suite that answers the scenarios, and wiring claims a human vouches for — and it
  still reads `verified`, because the verdict turns on the scenario claims alone.
- **`features/FEAT-101-payment-splitting/`** — in flight, and the big one: a new service arriving
  with its own requirements, architecture requirements and contract, a C4 delta that splices a
  nested element into the living landscape, a `MODIFIED` requirement that **renames its heading**
  while keeping its `Requirement-ID` — loam's rename mechanism — and an **event-contract delta**
  (`specs/payment-service/asyncapi.yaml`): a complete AsyncAPI 3.0 document restating
  payment-service's living contract under `loam rebase`-written `x-loam-based-on` pins and adding
  one new producer side, so the archive merges the new slots and leaves every pinned quote to the
  living contract's own copy.
- **`features/FEAT-112-retire-order-v1/`** — in flight, and the smallest legal shape: no
  `delta.likec4` at all, because retiring an operation moves no boxes. It carries the two halves
  loam requires together for a removal — a `REMOVED` requirement and an `x-loam-remove: true` marker
  inside the operation object.

## The warnings are the lesson

`loam validate --all` reports **0 errors and 10 warnings** here, and every one of them is
deliberate. An example that reported nothing would teach nothing about what these checks catch:

| finding | what it is demonstrating |
|---|---|
| `sources.absent` | `checkout-web`'s spec names no `sources`, so nothing ties it to code and `loam vouch` would refuse to stamp it |
| `spine.op-link-missing` | one landscape edge says it calls payment-service and names no operation, so no check can tell whether the call still exists |
| `spine.op-deprecated` | payment-service still calls identity-service's `validateToken`, which that contract marks `deprecated: true` — the consumer, not the provider, is the one being told |
| `api.requirement-deprecated` (×2) | `IDN-VALIDATE-LEGACY` and `ORD-PLACE-V1` each govern only a deprecated operation: promised behaviour on its way out |
| `permissions.unenforced` | `user/profile:read` is declared in the vocabulary and named by no requirement — the shape a vocabulary drifts into |
| `capability.unrealized` | `payments/settlement` is declared in `architecture/capabilities.yaml` and no living requirement's `Capability:` line names it — a promise nobody implemented, or a word nobody adopted; `loam list capabilities` shows it as `0 — unrealized` beside the realized ones |
| `capability.requirement-unrealized` | `checkout#CHECKOUT-PRICE-HONOURED` — one promise inside a capability whose OTHER promise three services realize, so the row above says nothing about it. That contrast IS the demonstration: `capability.unrealized` finds a capability nobody claimed, and only this code finds the gap inside a capability that looks healthy. Three requirements do carry `Realizes:` lines — `WEB-CHECKOUT`, `ORD-PLACE` and `PAY-AUTHORIZE` all name `checkout#CHECKOUT-CHARGE-ONCE` — and the fourth promise is simply not implemented, which is a normal state for a business document written ahead of the fleet |
| `c4.uncovered` | FEAT-101 adds a `checkout-web → payment-split-service` edge that no arch requirement covers, so its architectural obligations would ship untested |
| `obligation.unapplied` | `idempotency-key` is declared in `architecture/obligations.yaml` and no `#obl-` tag applies it anywhere on the fleet map — a decision that was reversed and left its word behind, or one nobody has placed yet. Its sibling `outbox` IS placed and IS covered, and says nothing: that contrast is the demonstration |

**Two of the five are filed into a subsystem.** `services/platform/` (its `subsystem.yaml` is the
marker — title and description, never members) groups `identity-service` and `notification-service`,
while the other three sit unfiled — the permanent, normal state a partially organized fleet lives
in, counted by `loam list` and never a finding. Placement is not identity: both services' specs,
contracts and digests are byte-identical to their unfiled days, every command addresses them by bare
id, and `architecture/subsystems.likec4` — GENERATED by `loam subsystem sync`, one view per
subsystem, one `include` per line — is the only file the grouping added. Edit the tree with
`loam subsystem move|rename|rm` and the views file travels in the same transaction; edit it by hand
and `validate --all` answers `subsystem.views-stale`. Each of the five services also carries a
`likec4.config.json` — written by `loam subsystem sync`, create-only, never graded for content —
because the root project excludes `services/**` and that file is what registers a service's
`model.likec4` as a LikeC4 project of its own: `npx likec4 validate examples/docs` names six
projects, `fleet` and the five services, and with more than one project it needs `--project fleet`
(or a service's name) to grade one. (`order-service` and `payment-service` stay
unfiled deliberately: FEAT-088's committed version-2 snapshot restores them by literal path, and the
`loam unarchive FEAT-088` walkthrough must keep working byte-for-byte.)

Plus one count rather than a finding: `sourcesUnverifiableFromHere: 4`. Four specs name paths in
their own service repositories, and this is none of those repositories — the fleet gate reports the
blind spot instead of resolving it. Running `loam validate --service <id>` inside each service repo
is what closes it.

## What the example deliberately does not carry

- **`AGENTS.md`.** A real docs repo has one, written by `loam init --docs . --create`. It is left
  out here because a generated `AGENTS.md` carries the version stamp of the binary that wrote it,
  and this tree is committed while the binary keeps moving — a stamped copy in the repository would
  be stale by the next release and would say so to every reader of the example.

  **`loam.json` used to be left out with it**, on the same "keep the tree a pure set of documents"
  reasoning, and that trade was wrong: without it the example could not be RUN. `loam status` here
  answered "No loam.json found" and exited 1, and the workaround this page printed instead — a
  throwaway `loam.json` at the repository root — then governed every other directory in the clone,
  so `loam init` from anywhere below it refused, and forgetting to delete it silently pointed later
  commands at the example fleet. It is committed now, byte-for-byte the two lines `loam init` writes
  for a docs repo that governs itself, which makes `cd examples/docs` the whole of the setup.
- **`payment-split-service`'s own `asyncapi.yaml`.** The async axis has the full feature lifecycle
  now — FEAT-101's `specs/payment-service/asyncapi.yaml` demonstrates the merge half on a living
  contract — but the NEW service's contract for the drawn `PaymentSplit` edge is deliberately
  deferred: the edge keeps the message in its title and no `metadata { publishes }`, because that
  metadata is a join and the join demands a contract declaring the send
  (`c4-event.message-undefined` refuses one without it). A
  `specs/payment-split-service/asyncapi.yaml` would ride the archive's creation branch once the
  consumer of `PaymentSplit` exists. The comment in `delta.likec4` says so rather than leaving it to
  be discovered.
- **A generated Gherkin suite.** `loam gherkin` writes into a *service's* repository, and there are
  none here — this fleet is six repositories, and `docs/` is one of them. The same reason leaves
  `sources` unresolvable and every service `draft`: `loam vouch` only runs where the code is, so no
  SERVICE in this tree can be promoted past `draft`.

  That is a different word from FEAT-120's `verified` verdict and the two must not be read as one.
  A service's ladder rung (`empty → partial → documented → sourced → vouched`) says a human stamped
  its living spec against the code; a feature's verdict says how its claims were answered. FEAT-120
  is `verified` in a fleet whose services are all `draft`, which is exactly the state a team is in
  the day its first suite goes green.
