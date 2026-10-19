# Changelog

All notable project changes are recorded here. The format follows Keep a Changelog, and release
versions follow Semantic Versioning.

## [Unreleased]

_Each entry states the change and names every code, flag, path and payload key it introduced. The
case for a change — the alternative that was rejected, the defect it came from, the rule it
generalises — lives where it is maintained: [SCHEMA.md](SCHEMA.md) for the rule,
[ROADMAP.md](ROADMAP.md) for the priority and its exit criteria, and the commit that landed it._

### Changed — one consumer index: `loam archive`, `loam validate` and `loam diff` agree about who still consumes an operation or a message

No code or flag was added; one additive `--json` key on two existing codes. Who still consumes what
a change takes out was answered three ways — the coherence gate (`openapi.remove-op-consumed`,
`asyncapi.remove-message-consumed`), `loam diff`'s victims (`diff.op-removed-consumed`,
`diff.message-removed-consumed`, the `-deprecated`/`-modified` details, `diff.consumer-added` /
`diff.consumer-removed`) and `loam archive`'s `openapi.op-modified` / `asyncapi.message-modified`
warnings — and the three copies read different documents. They are one index now; SCHEMA.md's
"Who still consumes it" states the rules.

- **More consumers are found, so more removals are refused:**
  - **Edges come from the whole `architecture/` project**, not `architecture/landscape.likec4`
    alone, for the gate as for `loam diff` and the archive's overwrite warnings: an edge with `metadata { op }` (or `consumes`) drawn in
    `architecture/calls.likec4` or in a use-case document counts. The gate passed such a removal
    and the next `validate --all` reported `spine.op-undefined` on the edge. Where only a sibling
    document fails to parse, the map file's own edges still count.
  - **The gate names use-case hops** attributed to the operation (or backed by a `consumes` edge),
    as `loam diff` already did.
  - **An `arch.spec.md` `Operations:` line** of another service counts, as a spec.md one does —
    for the gate, `loam diff`'s victims, `diff.consumer-added` / `diff.consumer-removed` and the
    archive's overwrite warnings. So an
    operation's `diff.consumer-added` / `-removed` is not reported while the consumer's
    `arch.spec.md` cannot be read on the other side, as it never was over an unreadable `spec.md`.
    The consumer's own `openapi.yaml` does not suppress it: an unreadable contract proves no
    ownership, so the line counts on that side too. The exception is a line whose join exists only
    because that contract did not parse on one side, while on the other side it reads and defines
    the id: there the line names the consumer's own operation, and only the contract's readability
    changed. No `diff.consumer-added` / `diff.consumer-removed` is reported for it — before, one per
    provider of the id, each counted in the `--json` summary's `added` / `removed`. The contract's own
    `unreadable[]` entry is still reported, and `loam diff` still exits 1 on it.
  - **The provider's own `spec.md` requirements count for a marker retirement too**, as they do for
    the overwrite of the entry below: one still naming the retired operation after the merge (a
    second one beside the REMOVED requirement) archived at exit 0 and left `spec-api.op-undefined`.
    Its `arch.spec.md` `Operations:` lines count for neither shape: `validate` grades such a line in
    spec.md only, so one in arch.spec.md strands nothing. An edge the provider draws to itself
    counted already, and still does — the spine grades it like any other.
    `loam diff` and the archive's overwrite warnings still leave the provider's own documents out:
    they name who ELSE is affected.
  - **On the event axis the provider's own `Publishes:` lines count**, as the merge would leave
    them. A message slot re-keyed to another name, or a send operation turned to receive, while the
    provider's requirement still publishes the message, archived at exit 0 and the next
    `validate --all` reported `spec-event.message-undefined`; it is `asyncapi.remove-message-consumed`
    now. So do its own `publishes` edges, which the spine grades on their source: a full retirement
    over a living `paymentService -> billingService { metadata { publishes '…' } }` archived at exit
    0 and left `spine.message-undefined` on the provider. The remedy names "drop or redraw its
    publishes edge".
  - **Fail closed**: a spec the merge refuses to apply — a malformed `Requirement-ID:` in the
    living spec or the delta — no longer answers "no consumers". The living requirements count,
    plus every requirement the delta ADDS or MODIFIES.
  - **A consumer document loam cannot read refuses the removal**, as the gate did before it asked
    one index: another service's `spec.md` or `arch.spec.md` that does not decode as UTF-8, the
    provider's own `spec.md` (either spec file, for a message), or a service id two directories
    claim. `openapi.remove-op-consumed` /
    `asyncapi.remove-message-consumed` name each in `details[]` and say the gate could not check —
    never that the fleet still consumes it. An edge drawn with no `metadata { op }` and a contested
    use-case hop still never refuse; `loam diff` lists them as doubts, as before.
  - **`loam diff` counts only a service that SENDS a message as still producing it.** A removed
    message another service declares only with `action: receive` — a consumer's own declaration,
    which validate requires — was `diff.message-removed` (warn), "still declared by" that consumer,
    while the gate refused the same removal and the next `validate --all` reported
    `spine.message-unproduced` there. It is `diff.message-removed-consumed` now, naming the gate's
    consumers; the warning for a message another service does send reads "still sent by".
- **Fewer refusals where the consumer was false or already retired:**
  - **Another service's `Operations:` line naming an id its own contract defines** names its own
    operation, and is no consumer (gate, `loam diff`, `diff.consumer-added` / `-removed`, the
    archive's overwrite warnings): shared
    ids such as `healthCheck` no longer refuse a rename, and `--approve` is no longer the only way
    past a fleet `validate --all` calls clean.
  - **Read after the feature's merge**: a consumer requirement the same feature MODIFIES to drop
    the id, or REMOVES, no longer counts — another service's included, which is the remedy the
    refusal itself names.
  - **A message another service would still send after the merge strands no consumer.**
    `asyncapi.remove-message-consumed` counted every `consumes` edge, `Consumes:` line and use-case
    hop of a message whoever sent it, so retiring it from one of two senders was refused over the
    other sender's consumers. Its remedy said to drop that sender's own `consumes` edge. Meanwhile
    `loam diff` reported the same removal as `diff.message-removed` (warn), "still sent by …", and
    the next `validate --all` was clean. Now a consumer refuses only while no service would send the
    message after this feature's merge. The senders are read as the merge leaves them: a service
    the feature carries an event delta for sends what its merged contract would (the delta itself
    where it creates that contract), so moving production to another service in the same feature
    passes, and a feature that retires the message from every sender is still refused. An unreadable contract never counts as
    a sender. Beside another sender, the provider's own `Publishes:` lines, its own `publishes`
    edges and its own unreadable spec files still refuse; another service's unreadable spec file,
    or an id two directories claim, does not. This predates the one index: the gate behaved the
    same before it. The message is reworded to say which case applies. With no sender left it reads
    "no readable contract would still send it after this merge" and adds the route "keep another
    service sending it". With a sender left it names the senders, lists only the provider's own
    documents, and gives only their remedy.
  - **An `#external` element that publishes the message keeps its consumers produced too**, for
    the gate and for `loam diff` as for `validate`. Both counted only senders inside the fleet, so
    retiring a message from its only fleet sender was refused while an `#external` element still
    published it (an edge from it with `metadata { publishes }`), and after `--approve` `loam diff`
    reported `diff.message-removed-consumed` (error) — while `spine.message-unproduced` accepts such
    a producer and the next `validate --all` was clean. Now the outside producer counts as a
    sender, read off the living `architecture/` project with validate's own rule: only while the
    project parses, and not from an edge the feature's own C4 delta draws. `loam diff` reports
    `diff.message-removed` (warn), "still sent by `<title>` (#external)", and a refusal for the
    provider's own documents, which it still does not excuse, names it the same way. With no sender
    left, the refusal now also says "nor does an #external element publish it", and its route
    reads "keep another service sending it (…) or an #external element publishing it (a publishes
    edge from it in the living architecture/ project)". This predates the one index too.
  - **`openapi.remove-marker-missing` is owed only while there is a living operation to retire**:
    not for an id the service's living contract does not define (a consumer's REMOVED requirement
    naming another service's operation), and not for one the delta already replaces at its method
    and path (no marker could be written there). A living `openapi.yaml` that does not parse proves
    neither, so the marker is still owed there, as before. The overwrite's "REMOVE the requirement"
    route can now be followed; its message says a REMOVED requirement owes no marker there.
    `asyncapi.remove-marker-missing` likewise skips a message the merge already takes out.
- **`details[]`** (additive) on `openapi.remove-op-consumed` and `asyncapi.remove-message-consumed`:
  the consumers, one per line, in the order `loam diff` lists the victims of the same removal.
- **Messages reworded**: the remedies name the `architecture/` project instead of
  `architecture/landscape.likec4`, and say a requirement is retired in the feature's
  `specs/<service>/` delta; `diff.op-removed`'s no-consumer sentence reads "no current edge,
  requirement or use-case hop names it".
- **Exit code:** where a consumer is newly found, `loam archive` exits 1 (`not-coherent`) without
  `--approve`; `loam validate --feature`, `loam validate <FEAT>` and `loam validate --all` (for every
  active feature in that shape) exit 1; `loam status` counts the finding as gating; `loam show
  <FEAT> --json` reports `review.readyToArchive: false`; and `loam diff` exits 1
  (`diff.op-removed-consumed` / `diff.message-removed-consumed`, `breaking: true`) where a removal
  now has a victim — a removed message whose only other declarer receives it included, which exited
  0. Where another service's spec file does not decode, `loam validate --feature`
  reports `openapi.remove-op-consumed` / `asyncapi.remove-message-consumed` naming the file where it
  reported `feature.unreadable`, at exit 1 as before, and `loam archive` exits 1 as before. Where
  two directories claim a service id, or the provider's own `spec.md` does not decode (either spec
  file, for a message), `loam
  archive` and `loam validate --feature` exit 1 for the removal whatever those documents say —
  before, 0 unless a copy the gate could read named it — until the document reads or `--approve` is
  passed. Where a refusal was false or the consumer is retired in the same feature, each
  of those exits 0 for that shape unless something else gates. That includes a message retired from
  one sender while another service would still send it after the merge, or while an `#external`
  element still publishes it, where only consumers were
  named: `loam archive`, `loam validate --feature`, `loam validate <FEAT>` and `loam validate
  --all` exited 1 and now exit 0, `loam status` no longer counts it as gating, and `loam show
  <FEAT> --json` no longer reports `review.readyToArchive: false` for it. `loam diff` reports
  `diff.op-removed` (warn) where its only victim was a same-id requirement, and
  `diff.message-removed` (warn) where an `#external` element still publishes the removed message —
  it exited 1 (`diff.message-removed-consumed`, `breaking: true`) and now exits 0 unless something
  else fails. `--approve` overrides
  every one of these refusals as before. `--strict` changes nothing here beyond that: every finding
  in this entry is an error, or is unchanged.

### Fixed — `loam instructions loam-spine` says what `loam rebase` pins for a revived quote

The page said `loam rebase` "pins neither shape". That has been false since rebase began grading
the delta it will write. Rebase never pins a retired operation as new, but it does repin a quote
of an address a move vacated over the operation that lives there now, and it reports the revival
that edit makes. The page now says so, in line with the `loam-codes` command map, WORKFLOW.md
and SCHEMA.md.

### Fixed — an operation with no `operationId` is a slot like any other

No code, flag or payload key was added. The OpenAPI reader used to drop an operation written
without an `operationId`. It now keeps it by its method and path, never by an id: requirements,
edges and removal markers still cannot name it, and it gets no finding of its own. The checks that
work by slot now see it:

- **`openapi.op-revived` names it.** When a quote lands where such an operation lives, the message
  says `<METHOD /path> now holds an operation with no operationId, and archiving this delta
  replaces it there`. Its move-back remedy adds that, if that operation is to stay, the same delta
  must define it at another address. The message no longer calls that address one "the living
  contract no longer has". Followed as it used to read, the remedy led to an archive that deleted
  the operation with nothing naming it.
- **`loam rebase` and `loam validate` agree about a pin over it.** Rebase always pinned against
  whatever stood at the slot, but validate refused that pin with `openapi.baseline-invalid` ("no
  operation at that slot").
- **Pins are now required at these slots.** An unpinned quote over such an operation counts into
  `openapi.baseline-missing` (warn, gates archive), and so does an unpinned delta operation without
  an `operationId` over a living one. Their pins are graded like any other (`-stale`, `-invalid`).
  **Exit code:** `loam archive` now exits 1 (`not-coherent`) on either shape until `loam rebase`
  pins it, or `--approve` merges unpinned. `openapi.baseline-missing` is a warning that gates:
  `loam validate` exits as before on it, except `--strict` (and `--all --strict`), which fails on
  any warning and so now exits 1; `loam status` counts it as gating, and `loam show <FEAT> --json`
  reports `review.readyToArchive: false` until the pin is written.
- **A pin on such an operation where nothing lives is `openapi.baseline-invalid` (error)**, as it is
  for a named operation (rebase never writes one; a malformed pin on such an operation is refused
  the same way). **Exit code:** `loam validate --feature`, `loam validate <FEAT>` and `loam validate
  --all` (for every active feature carrying one) now exit 1 on it, where they exited 0 with no
  finding; `loam archive` exits 1 (`not-coherent`) without `--approve`; `loam status` counts it as
  gating; `loam show <FEAT> --json` reports `review.readyToArchive: false`.
- **`openapi.remove-op-consumed`** also fires when the delta defines an operation with no
  `operationId` where a consumed one lives. Before, a delta holding only such an operation upserted
  over the consumed one with no finding of any kind.

### Changed — `loam archive` refuses an overwrite that takes a consumed operation out of the contract

No code, flag or payload key was added: an existing code covers a second shape.

- **`openapi.remove-op-consumed` (error, `--approve` overrides) now also fires for an overwrite.**
  A feature's `openapi.yaml` defines another operationId at the method and path where a living
  operation lives, and the contract the archive would write then defines the living one nowhere.
  The merge replaces it there with no removal marker naming it, so before this only the advisory
  `api.op-unconsumed` fired, the archive passed without `--approve`, and the next `validate`
  reported `spine.op-undefined` / `spec-api.op-undefined`. The consumers are a removal's — the one
  consumer index of the entry above — including the provider's own `spec.md` requirements as the
  merge would leave them: one the feature MODIFIES to name the new operation, or REMOVES, no longer counts. The
  message names what replaces the operation and where, and says to define it at another address in
  the same delta if it is to stay.
- **Exit code:** on this shape `loam archive` now exits 1 (`not-coherent`) without `--approve`,
  and `loam validate --feature`, `loam validate <FEAT>` and `loam validate --all` (for every active
  feature in this shape) exit 1. `loam status` counts it as gating, and `loam show <FEAT> --json`
  reports `review.readyToArchive: false` until it is fixed or archived past with `--approve`. With
  `--approve` the archive merges as before and lists the finding in `overridden[]`.
- **`c4-api.op-removing`** now also fires for a new tagged edge onto an operation the delta
  replaces that way.
- An overwrite of an operation nothing names is unchanged: `api.op-unconsumed` stays advisory. On
  the event axis `asyncapi.remove-message-consumed` already graded the simulated merge's sent
  messages, so a channel, operation or message slot redefined under another identity was caught
  like a retirement for its OTHER consumers — but not for the provider's own `Publishes:` line,
  which the consumer-index entry above adds.

### Changed — `loam archive` refuses a delta that would bring back an operation another feature retired

Two codes, both added to the `IssueCode` union, and one additive `--json` key were added.

- **New `openapi.op-revived` (warn, gates archive).** A feature's `openapi.yaml` spells an
  operation (by operationId) that its service's living contract no longer holds, and an ARCHIVED
  feature retired it with an `x-loam-remove: true` marker — any archived feature, including one
  whose directory carries the same feature id as the one being graded. Before this, the
  quote read as an addition: a delta that had only quoted `createOrderV1` archived after the
  feature retiring it and put it back into the living contract at exit 0, with the advisory
  `api.op-unconsumed` the only finding. The message names the operation, the retiring feature(s)
  and both remedies — delete the quote if it only restated the operation; archive with `--approve`
  if the feature brings it back on purpose.
- **New `asyncapi.slot-revived` (warn, gates archive)** — the same on the event axis: a `channels`
  or `operations` slot by its key, or a message by its name, that an archived feature retired. A
  channel-slot removal's inline messages are named from that feature's `.loam-before/` snapshot
  pre-image, read only while it still hashes to the digest its manifest recorded.
- **Both codes also cover an address an archived feature VACATED.** An archived feature that
  relocated an operation (a marker on the old slot, the same operationId defined at a new one)
  vacated the old address — and so did one that retired it there, once a later feature re-added it
  somewhere else. A later delta quoting the operation at that address — unpinned — archived at
  exit 0 and put the id back beside where it lives, one operationId at two slots (only the
  advisory `openapi.duplicate-operationid` said so afterwards): the slot-keyed baseline gate saw
  nothing living at the slot, and the id-keyed check saw the id living. That quote is now
  `openapi.op-revived` too. Both codes are judged on the contract the archive would write: the
  check runs the archive's own merge of the delta over the living contract and compares where each
  operationId (each message name) stands there with where it stands now. One the merged contract
  answers at two or more addresses — one of them new, and vacated by an archived feature — is the
  finding; one the living contract still holds that it answers at exactly one address is not,
  whether the delta moves it back with its own removal marker where it lives now or swaps another
  operation in there (with or without an operationId — the merge replaces what stands at that
  method and path). A removal marker standing where the id does not live deletes nothing, so it
  no longer excuses the quote. The message says which archived feature moved the operation and
  where to, or retired it there, and — apart from
  that, since anything landed after can have moved it again — where it lives now; its remedy names
  the address to drop: delete the quote, or, to move it back on purpose, add a removal marker
  where it lives now — and where the delta already spells that address, so no marker can be
  written there, archive with `--approve` instead. Where another operation lives at the quoted
  address now (on the event axis, another message is declared at the quoted key), the message
  names it and says archiving replaces it there — the merge writes one entry per address —
  instead of calling the address one the living contract no longer has, and the move-back remedy
  says to define it at another address (key) in the same delta if it is to stay: followed as it
  read before, the remedy reached a clean gate and an archive that deleted the other operation
  with nothing naming it. The retired-shape message names such an entry too. A quote of an
  address an archived feature moved the operation away from is the finding even where the living
  contract holds the operation nowhere (taken out of its new address by a hand edit, which leaves
  no marker): the move is on the record, and the message reads as a retirement brought back,
  naming the move. On the event axis the vacated addresses are `components.messages` keys (a
  marker there) and the inline declarations a channel removal took; a delta that restates the
  channel a name stands inline in with a `$ref`, or retires it, takes the name out of there and
  is not graded. For an inline declaration the remedy names the channel (restate it with a
  `$ref`, or retire it), never a marker nested on the inline message, which retires nothing. For
  a `components.messages` key the remedy also names every channel (or operation) of the merged
  contract still `$ref`-ing that key, to restate with the `$ref` pointed at the quoted key: told
  only to retire the key, an author left the channel pointing at nothing, and its send stopped
  sending the message — `asyncapi.remove-message-consumed`, which gates. `asyncapi.baseline-invalid`'s
  move-back remedy says the same. A channel or operation slot is its key, so a "moved" one is a
  retirement, as before. A message inline under a channel the delta brings back is reported by
  the channel's finding alone only while the merged contract declares the name nowhere else; where
  an archived feature re-declared it under `components` as it retired the channel, the inline
  declaration is a finding of its own (one message name in two places) — it was skipped, and
  `--approve` archived `asyncapi.duplicate-message`.
- **Exit code: `loam archive` now exits 1 (`not-coherent`) on this shape** without `--approve`;
  with `--approve` it merges as before, and the operation lands in `overridden[]` and the text
  output's "archiving despite" list, naming what came back and whose retirement it reverses.
  `loam validate --feature` and `--all` report both codes as warnings: exit unchanged, except
  under `--strict`, which fails on any warning and so now exits 1 on this shape. `loam status`
  counts them as gating like every warning that gates, and `loam show <FEAT> --json` reports
  `review.readyToArchive: false` for such a feature until the quote is deleted (or the feature is
  archived past it with `--approve`).
- **`loam rebase` no longer calls a retired operation one "this feature is adding".** It pins
  nothing for it either way, and now prints the same finding after its pin lines; the additive
  `--json` key `revived[]` carries the findings (`severity`, `code`, `gates`, `subject`,
  `message`). The operation's `pins[]` row still reads `unresolved`. The check runs over the
  delta as rebase will write it, pins included, under `--dry-run` too: a quote pinned to its
  own content is skipped by the merge, and repinned over another operation that now lives at an
  address an archived feature moved it away from it becomes an edit that would put it back
  there — that finding is in `revived[]` as well, and its `pins[]` row reads `repinned`. The
  text output's revival banner no longer says "nothing was pinned" for such items.
- **`openapi.baseline-invalid` and `asyncapi.baseline-invalid` reworded** for a pin whose living
  operation or slot is gone: they used to say "drop the marker", which turned the quote into the
  revival above. They now say to re-read the living contract and delete the quote unless the
  feature deliberately brings it back. When the living contract still holds the operationId (or,
  for a `components.messages` key, the message name) elsewhere, the message instead says a
  parallel feature MOVED it there (or retired it here, and another re-added it there) and where it
  lives now, and to make any change there — never to archive past the revival finding, which would
  answer it at both addresses. The `/loam-check` rows and `loam explain` say the same. `loam
  rebase`'s text says such items were retired by an archived feature "or moved to another address
  by one".
- **What it reads, and what it cannot see.** Only files under `features/archive/` — the archived
  deltas' removal markers and each feature's `.loam-before/` snapshot; no git. A marker counts only
  if the merge carried it out: the snapshot's pre-image must hold the marker's operationId at its
  method and path (an event marker: its channel or operation key, or its message name at its
  `components.messages` key), and a contract the archive created or never wrote lost nothing. A
  marker archived past `openapi.remove-target-missing` / `-mismatch` (or the `asyncapi.*` twins)
  under `--approve` deleted nothing, so a genuinely new operation it happened to name is not a
  revival. A feature with no intact snapshot cannot be checked, and its markers count as written.
  A removal made by hand-editing a living contract, or an archived feature deleted from disk,
  leaves nothing to read, and a quote of such an operation still grades as an addition. A marker
  with no `operationId` or one written at path level retired nothing when its feature archived, so
  it is never named as the retirer.

### Added — `#suite-<name>` tags and `loam list suites`: which services a test suite needs up

No code was added. One reserved tag prefix, one list section and one positional argument were.

- **A `dynamic view` may carry `#suite-<name>` tags** to say which test suites the journey runs in —
  a separate prefix from `#cap-`, many-to-many (one view may carry several), each declared as
  `tag suite-<name>` in the landscape's `specification` block like every LikeC4 tag, so a mistyped
  suite is a parse error.
- **A view carrying only `#suite-` tags is now a use case.** The one opt-in predicate takes three
  prefixes (`cap-`, `req-`, `suite-`), and so does the byte scan that lets a fleet with no use cases
  skip the LikeC4 load. Such a view's hops are graded by `loam validate` like any other use case's
  (`usecase.step-unbacked`, `usecase.step-contested`, `usecase.step-unlinked` — at fleet scope, and
  per service for a flow beside a service's model), and every reader that names use cases sees it:
  `loam diff`'s removed-operation victims, `loam delta` and `loam status`'s use-case blast radius,
  and the context packs. A view that already carried `#cap-` or `#req-` is unaffected, and an
  untagged view is still never graded. On a fleet that had drawn `#suite-`-tagged views before this
  release, those views can now earn findings.
- **New section `loam list suites [<name>] [--json]`** — the answer to "which services must be up
  for suite X". `[section]` accepts `suites`, and a new optional positional `[name]` narrows the
  listing to one suite. Additive `--json` keys, emitted only with this section: `suites[]` (`name`,
  `views[]` of `{id, file}`, `services[]` — enumerated service ids, sorted — and `unresolved[]` of
  `{element, external}`: the participants that resolve to no service, `external` true when the
  element or anything it is drawn inside carries `#external`, the walk stopping at the first
  element bound to or titled for a service as `loam gate`'s partner reading does), `ungrouped[]` (`{id, file}` of every
  use case carrying no `#suite-` tag, never narrowed by `[name]`), and `useCases` (`state`:
  `absent` | `ok` | `unreadable`, beside `unreadable` and, when unreadable, `error`, spelled as
  `loam list capabilities` spells them). Over an `architecture/` that does not parse the section
  degrades instead of refusing, and `suites` / `ungrouped` are absent rather than `[]`. Only the
  fleet map's use cases are listed. The text view prints one block per suite — its services, the
  unresolved participants marked `!`, its use cases — then the use cases in no suite.
- **Refusals use existing codes.** An unknown suite name is `unknown-target` with close names; a
  `[name]` after any other section, and `--needs-work` with `suites`, are `invalid-option` (a name
  after another section used to be commander's "too many arguments", also `invalid-option` under
  `--json`). The campaign flags (`--subsystem`, `--owners`) refuse `suites` as they refuse every
  section but `services`.
- The MCP tool `loam_list` gains the matching optional `name` argument, and its `section`
  description now lists `glossary` and `suites`. `name` without `section` is refused as invalid
  params (`-32602`) rather than read as a section.
- `examples/docs` tags its one use case `#suite-smoke` and `#suite-notifications`, so
  `loam list suites` there answers checkout-web, notification-service and order-service, with
  `customer` and the `#external` topic `kafka.orderEvents` named as unresolved.

### Changed — the use-case byte scan opens on a `#` tag reference, not on a bare prefix

No code, flag or payload key was added, changed or retired.

- **loam starts LikeC4 for use cases only when a document references a reserved tag.** The scan in
  front of every reader of the fleet's use cases, and of a service's own flows, used to open on the
  bare text `cap-`, `req-` or `suite-` anywhere in a file. It now opens on `#cap-`, `#req-` or
  `#suite-`, with only whitespace, line breaks or comments between the `#` and the name, as LikeC4
  allows. That is the only way a view carries a tag, so no use case is missed.
- **A broken `.likec4` beside a service's model that names a prefix only in prose no longer fails
  the service.** In `0.2.0-alpha.8`, a file with no tagged view that mentioned `cap-` or `req-`
  anywhere — a title, a comment — was loaded, and if it did not parse, `validate --service` (and
  `--all`, per service) reported `usecase.flow-invalid`, an error, exit 1. This release's `suite-`
  prefix would have added a third such substring (an id like `test-suite-runner`). Now the file is
  skipped, like any untagged diagram.
- **The same holds at fleet scope.** Suppose `architecture/` does not parse, carries no tagged view,
  and only declares `tag cap-…` / `tag req-…` or names a prefix in prose. It now reads as declaring
  no use case. `useCases.unreadable` is then `false` where it used to be `true` in
  `loam status --json`, `loam delta --json` and `loam list capabilities --json`, and so is
  `useCaseScan.unreadable` in `loam context --json`. `validate --all` still reports that map as
  `landscape.invalid`.
- A `#` followed by a reserved prefix still opens the scan wherever it is written, a comment
  included.

### Changed — `loam-feature` asks whether a feature is owed, and analyzes before it pins

No code, flag or payload key was added, changed or retired. What changes is the protocol text an
agent is handed, the `intent.md` a new feature starts from (and which of its text `intent.empty`
counts), and what the documentation says a feature's contract delta holds.

- **`loam instructions loam-feature` opens with a step 0.** A change that touches no requirement,
  operation or fleet edge — a refactor, a dependency bump, a fix back to behaviour the living spec
  already documents — needs no feature: a code PR, then `loam validate --service <id>` and
  `loam vouch --pack --service <id>` in the service repo, and a person's vouch. WORKFLOW.md's "The
  honestly-small change" now opens with the same lane.
- **A new, ungraded step 4b, "Analyze before you pin", sits between authoring and `loam rebase`.**
  The agent reads `loam show <FEAT> --json`, `loam context <service> --feature <FEAT> --json` and the
  `explore` neighbours, then writes questions under `## Open questions` in `intent.md`: ambiguous
  SHALLs, values, limits and windows two services state differently (and which side refuses),
  `Realizes:` lines that do not deliver their capability, each edge's timeout, retry, partial
  failure and compensation, and neighbours left out of `--touches`. A person answers by editing the
  file. `loam-implement` sends an ambiguity it meets to the same section.
- **`loam new` scaffolds an optional `## Open questions` heading in `intent.md`**, over a comment
  only. **`intent.empty` now reads past that section:** questions an agent writes there are not the
  feature's Why, so an intent whose only prose is open questions still gates the archive. The generated `loam-feature` command and skill pointers
  list both new steps in their spine; an unedited pointer refreshes on the next `loam init`.
- **A feature's `openapi.yaml` / `asyncapi.yaml` is documented as holding only what the feature
  adds, changes or removes.** SCHEMA.md, WORKFLOW.md, the `loam-spine` and `loam-feature` pages,
  the `spec.md` scaffold's comment and the example deltas taught "a complete document, not a
  patch". The merge never needed one: it walks only the paths, methods and slots a delta spells, a
  local `$ref` resolves into the living contract, and an add-only delta needs no `loam rebase`.
  Each needless quote is one more pin and, once a parallel feature removes the quoted operation,
  either a blocking `openapi.baseline-invalid` (pinned) or an archive that puts the retired operation
  back (unpinned); `loam-check`'s fix for the first now says to delete the quote. The
  `loam-spine` page also no longer says path-level keys and components go unpinned —
  `x-loam-baselines` covers them.
- **WORKFLOW.md gains "Build on the envelope":** a tracker export from `loam tasks <FEAT> --json`
  keyed on unit ids (and what rewording re-keys one), a rollup of the per-service CI summaries
  that reads a missing or old report as unknown, and `npx likec4 mcp` beside `loam mcp` on the same
  docs repo.
- **The `loam-codes` page points at AGENTS.md's "Reference pages — fetch when needed" section** —
  it named a "The reference pages" section that does not exist — and lists `loam-report` among the
  pages `loam instructions` prints.

### Added — `loam new --modifies <Req-ID>`: a small change is new → edit → archive

- **New repeatable flag `--modifies <Req-ID>` on `loam new`.** Each value names a living
  requirement, by its `Requirement-ID:`, in a service the feature `--touches`. The scaffold copies
  that requirement into the service's delta, uncommented, under `## MODIFIED Requirements`, with
  its `Based-On:` pin already set. It is the same pin `loam rebase` writes, so a rebase right after
  reports it `unchanged`, and the living text moving before archive is still `delta.baseline-stale`.
  An `arch.spec.md` requirement lands in a scaffolded `specs/<svc>/arch.spec.md`. Before this, the
  author copied the requirement by hand and ran `loam rebase` to pin it.
- **When every touched service has a `--modifies` and no `--new-service` or `--capability` is
  given, no `delta.likec4` is written.** A feature that only rewrites requirements changes no
  architecture, and the scaffold already told authors to delete the file in that case. `created`
  in `--json` simply omits it. Any other combination scaffolds `delta.likec4` as before.
- **Refusals use existing codes.** An id that no touched service's living spec carries is
  `unknown-target`. The message names the close ids in those specs, or the untouched service that
  does carry the id (`add --touches <svc>`). A value that is not a Requirement-ID, or an id two
  touched documents both carry, is `invalid-option`. A living spec loam cannot decode is
  `merge-failed`, as `loam rebase` refuses it. Every refusal writes nothing.
- The opt-in MCP author tool `loam_new` gains the matching `modifies` argument. No code or payload
  key was added.

### Added — `loam_adopt`: the adopt brief on the MCP server

- **`loam mcp` serves a sixteenth read tool, `loam_adopt`**, mirroring `loam adopt [--service <id>]
  [--subsystem <name>] [--targets] --json` (JSON arguments `service`, `subsystem`, `targets`). Its
  result is the CLI's `adopt` envelope, verbatim. It is advertised `readOnlyHint: true` like every
  base tool, because `adopt` writes nothing: it hands the agent the brief, and the agent writes the
  baseline. Until now an MCP-only host could fetch the loam-adopt protocol through
  `loam_instructions` and could not run its first step, `loam adopt --service <id> --json`. No
  code, flag or payload key was added to the CLI; `tools/list` returns one more tool.

### Changed — `loam init --create` with no service prints the docs repo's first hour

- **A run that creates a docs repo and binds no service now ends with `next — the docs repo's first
  hour:`**: `loam seed --from fleet.yaml` (or draw the map by hand), `loam init --docs <docs-repo>
  --service <id> --agent-profile service` in each service's own repo, `loam adopt --service <id>
  --json` there, and `loam status`. It used to print nothing after the scaffold list. These are
  WORKFLOW.md's Day zero steps and the rungs `loam status` already names on an empty fleet. A run
  that binds a service still prints the single-repo trial's hour, and a join still prints neither.
  Human output only: no code, flag or payload key was added, and the `--json` envelope is unchanged
  for both variants.

### Changed — every service bind loam prints names `--agent-profile service`

No code, flag or payload key was added, changed or retired. What changes is printed text and one
`--json` value.

- **The bind command now reads `loam init --docs <path> --service <id> --agent-profile service`**
  in `loam status`'s `next.bind-service` step, its `loam explain` entry, the docs repo's first hour,
  the generated AGENTS.md (`## The cycle`, step 0), and the `loam-adopt` and `loam-implement`
  protocols. README, QUICKSTART and docs/SERVICE-TEAMS.md already told a fleet to bind each service
  checkout this way, because `--agent-profile` defaults to `full`, and `full` writes `loam-feature`
  and `loam-ship` into the service repo. But every bind command loam printed left the flag out, and
  an agent runs the command loam prints. WORKFLOW.md's Day zero step 3 now spells it too.
- **`next.bind-service`'s `command` in `status --json` `next[]` carries the new text.** Its
  `execution` block still names the same two placeholders.
- **Two binds keep their old form on purpose.**
  - `loam-adopt` names the single-repo trial (`--create`, used only when the docs repo does not
    exist yet) as the one bind that keeps the full profile.
  - `doctor.service-unbound`'s fix is a re-run in a checkout that is already wired. An omitted
    `--agent-profile` there keeps the profile that checkout recorded.

### Changed — the OpenSpec compatibility pin moves to v1.14.1, and a weekly canary watches the newest release

No code, CLI flag or payload key was added, changed or retired. The `audit-openspec` /
`migrate-openspec` payload shape is unchanged, but the value it reports as the certified release moves.

- **`audit-openspec` and `migrate-openspec` now report OpenSpec v1.14.1 as the certified release.**
  The banner line and `baselines.release` under `--json` carry `1.14.1` / `v1.14.1` /
  `87c3595ace6a2e22957f39ebe5b74c2f2316e0cb` (released 2026-10-05) instead of `1.9.0` / `2826b88`.
  `baselines.mainCanary` is unchanged. The corpus gate's `--baseline release` is now the v1.14.1
  corpus: 223 Markdown files, 765 requirements and 2475 scenarios, every file round-tripped. v1.9.0
  stays as the new `--baseline previous` regression pin beside `legacy` (v1.7.0) and `canary`, and
  the scheduled `ci.yml` matrix runs all four. The sweep found no parser gap. The grammar OpenSpec
  1.13 added — a closing `#` run, `*`/`+` bullets on `REMOVED` and `RENAMED`, repeated delta
  sections — was already read by the migration, and a new test pins the repeated sections.
  `audit-openspec` and `migrate-openspec --apply`, run on OpenSpec's own v1.14.1 workspace, staged
  all 251 living requirements and 747 scenarios across 36 services. The seven vendored fixtures stay
  at v1.9.0, since v1.14.1 has no shape they lack. MIGRATING-from-OpenSpec.md's version matrix
  records all of this.
- **The corpus sweep reads each file through the migration's own reader.** That reader is the one
  `audit-openspec` and `--apply` use: loam's parser plus the grammar only OpenSpec accepts. The
  sweep used to read with loam's parser alone. Every pinned corpus gives the same totals either way.
- **A new scheduled workflow, `.github/workflows/openspec-canary.yml`, watches the newest OpenSpec
  release.** It runs weekly and on manual dispatch. It resolves the newest `vX.Y.Z` tag with
  `git ls-remote` and sweeps it with the new `--baseline latest` mode of `npm run
  test:openspec-corpus`. That mode reports how the totals moved from the certified pin instead of
  refusing an unpinned commit, and still fails on a file that does not round-trip. The workflow also
  audits OpenSpec's own workspace and diffs upstream's parser sources against the pin, in its step
  summary. It has no push or pull-request trigger and blocks nothing; CONTRIBUTING.md's "The
  OpenSpec canary" is the runbook. The README's note that `--baseline` defaults to `canary` was
  wrong — it defaults to `release` — and now says so.

### Added — documentation: running loam where service work runs, a CLI-only first ten minutes, and what loam costs an agent

No code, flag, command or payload key was added, changed or retired; the binary is unchanged. The
new paths are `docs/SERVICE-TEAMS.md` and `scripts/payload-sizes.ts`.

- **README has a service-repo CI recipe** beside the docs repo's fleet-edges one. The workflow
  checks out the service and the docs repo as sibling subdirectories of the workspace, so a
  committed relative `docsDir` such as `../docs` resolves. It does not use `path: ../docs`, which
  `actions/checkout` refuses. It runs `loam validate --service <id> --json` at the same pinned
  version, and two `jq` programs turn the findings, or a refusal, into `::error` / `::warning`
  annotations and a `$GITHUB_STEP_SUMMARY` table. A deploy pipeline can add
  `loam gate --service <id> --since <ref>`. It is followed by setup for cloud agents in a service
  repo: a `copilot-setup-steps.yml` and a Codex environment setup script, each cloning the docs
  repo into the committed `docsDir` with a read token from a secret.
- **README's day-zero binding passes `--agent-profile service`**, and says why: the profile
  defaults to `full`, which puts `loam-feature` and `loam-ship` into every service checkout.
  QUICKSTART's command for joining a shared docs repo passes it too.
- **QUICKSTART opens with ten minutes of CLI only.** A two-service `fleet.yaml`, `loam seed`, one
  provider `openapi.yaml` and one misspelled `op` on an edge give `spine.op-undefined`, with no
  agent and no adoption. A requirements-only `loam new --touches … --touches …` then validates and
  plans its archive before either service is adopted. Every output shown was produced by running
  the commands. The single-project path moves to sections 3–6.
- **`docs/SERVICE-TEAMS.md`, one screen for a team whose repository is one service in a fleet:**
  four commands, five slash commands, what a person signs when they vouch, and the fifteen codes
  they will actually meet. README, QUICKSTART and the Docs list link to it.
- **COMPARISON.md names OpenSpec, Spec Kit and Kiro again, in one dated section.** "Spec-driven
  change tools, as of October 2026" sets out what each offers for a change that crosses
  repositories: OpenSpec Stores and worksets, `show --diff` and the Cloud Agent; Spec Kit's
  contract-driven guide, `/speckit.converge` and MCP server; Kiro's Design-First specs and Kiro
  Web. It records what is still open upstream (OpenSpec #725, Spec Kit #4583) and where loam
  differs, including the two gaps it has against them. Each claim links its source. The rest of
  the page stays an ecosystem map, and `test/docs-drift.test.ts` now allows the three names only
  inside that dated section.
- **`docs/BENCHMARKS.md` has a table of agent-facing payload sizes**, in bytes and ~tokens:
  the generated `AGENTS.md`, `loam adopt --service <id> --json` with and without `--targets`,
  every `loam instructions` page with and without `--no-fix-tables`, and `loam explain <code>
  --json` across the whole vocabulary. `npx tsx scripts/payload-sizes.ts --write` generates it from
  the tree, and `test/docs-facts.test.ts` regenerates it and fails when the committed table
  differs. README's adopt row now points at that table instead of quoting a dated figure.
  `test/docs-drift.test.ts` now also requires every exact `@ybotok/loam@<version>` in README to be
  this checkout's version.

### Changed — `loam archive`'s overwrite warnings name the current consumers

No code or flag was added. Existing warnings now fill a payload key that was always empty.

- **`openapi.op-modified` and `asyncapi.message-modified` now say who the overwrite affects.**
  Each message ends with one of three phrases: `N current consumer(s) still name it`,
  `whether current consumers name it could not be fully answered`, or
  `no current consumer names it`. The warning's `details` (until now always `[]`) list the
  consumers, in `archive --json` `warnings[]` and, when the contract merge is refused as
  `not-coherent`, in the same warning's entry in `issues[]`:
  - edges of the `architecture/` project;
  - other services' living requirements, in either spec file;
  - use-case hops;
  - and last, any consumer whose documents could not be read, or any caller drawn without an
    `op`.

  The human plan prints the same lines under the warning. This is the scan `loam diff` runs for
  `diff.op-modified` and `diff.message-modified`. Here it runs over the living fleet as it stands
  before the merge, and only when one of these warnings fires. On the 120-service benchmark fleet
  that costs about 130 ms. Severity is unchanged, and neither warning gates the archive. Whether a
  change breaks a consumer is still not graded (`oasdiff breaking` / `asyncapi diff` do that).
- `openapi.component-modified` and `asyncapi.component-modified` do not name consumers. A
  component's consumers are the operations or messages whose `$ref` closure reaches it, and loam
  has no index of those.

### Fixed — an MCP tool argument is never read in another argument's slot

No code, flag or payload key was added, changed or retired. Two MCP input schemas each gained one
JSON Schema keyword, named below.

- **A `tools/call` that supplies an optional positional argument while leaving out an earlier one is
  refused as invalid params (`-32602`)**, naming the argument left out, as a missing required
  argument already is. Positionals reach the command by position, so the later value used to be read
  as the earlier one: `loam_instructions` with `args` and no `workflow` took the first arg as the
  workflow name. An empty `args` still passes. The defect is present in `0.2.0-alpha.8`.
- **The MCP tools' advertised input schemas now say that `name` needs `section` and a non-empty
  `args` needs `workflow`**, the rule a tool call already enforces, so a client that validates a
  call against `tools/list` is no longer refused `-32602` for a call the schema allowed.
  `loam_list`'s schema gains `dependentRequired` (`name` → `section`); `loam_instructions`' gains
  `dependentSchemas`, requiring `workflow` once `args` has a member, because an empty `args` still
  passes. Both are standard JSON Schema keywords; no tool, argument or other schema key changed.

### Fixed — `loam validate` reports an unreadable verification record from the docs repo

No code, flag or payload key was added. An existing code fires in one more place.

- **`evidence.record-unreadable` (warn) now fires on the feature target too**, under
  `validate --feature <FEAT>`, `validate <FEAT>` and every active feature under `validate --all`, run
  from anywhere. A `features/<FEAT>/verification.yaml` or `verification/<svc>.yaml` with git
  conflict markers, broken YAML, a shape that is not a record, or a summary that contradicts its
  claims used to pass `validate --all` in the docs repo with no finding. `verify` refused the file,
  and `status`, `gate` and `tasks` reported it. Until now only the service target raised this code,
  and only from the service's own repository. The finding names the file and gives the same repair
  as the service-target finding. Its `locations` hold that file as `primary`. It is a warning, as
  it is on the service target. `valid`, the exit code and `loam archive` are unchanged, and
  `--strict` fails on it. In a service repository's `validate --all` the same file is reported
  twice: once by the service target and once by the feature target.

### Fixed — `loam diff` reads a spec saved as UTF-16 without a byte-order mark the same way on both sides

No code, flag, path or payload key was added, changed or retired.

- On disk, a `spec.md` or `arch.spec.md` saved as UTF-16 without a byte-order mark was refused as
  unreadable. At the base ref, the same bytes were read as a readable spec with no requirements.
  That happened because only the working-tree side checked for NUL characters. So an untouched file
  was suspended on one side only, and a branch that re-saved the file as UTF-8 reported every
  requirement in it as `diff.requirement-added`. The base side now applies the same decoding rule as
  the working tree. Both sides report the file as unreadable, and the spec axis is suspended. The
  contract axes are unchanged: their readers on both sides already applied the same rule.

### Fixed — a writer waiting on the lock no longer deletes the next writer's live lock

No code, flag, path or payload key was added, changed or retired. What changes is that concurrent
writers no longer fail, or share one commit window, when a lock holder exits while another writer
waits for it.

- **A stale `.loam-lock` is broken only while the holder judged dead still holds it.** A writer
  that finds the lock held reads the holder, and if that pid no longer exists on this host, it
  breaks the lock. Under CPU load the holder could release normally and exit between that read and
  the pid check, and a third writer could take the lock in the same gap. The waiter then deleted
  the third writer's live lock and took one of its own, so two writers were inside one commit window.
  One of four concurrent `loam gherkin --json` runs failed as `merge-failed` (`ENOENT … rename
  '….feature.loam-<pid>-…tmp'`): the second writer's recovery read the first's in-flight journal as
  an interrupted commit and swept its staged files. The code is shared by every writer that takes
  the lock (`archive`, `unarchive`, `new`, `seed`, `rebase`, `subsystem`, `verify --record`, `vouch`,
  `gherkin`), and the defect is present in `0.2.0-alpha.8`. The waiter now re-reads the lock after
  its verdict, and moves it to a private name before removing it. Anything it moved that is not the
  lock it judged goes back in place. A crashed holder's lock is still reclaimed as before.

### Fixed — `validate --all --base` grades the landscape by what the branch changed in it

No code, flag, path or payload key was added, changed or retired; the unscoped `validate --all` is
unchanged.

- **A call edge the branch adds or edits in `architecture/` is graded against its provider's
  contract**, even when the provider is not in scope. README's own example — `authorisePayment` on
  an edge into a contract spelling it `authorizePayment` — used to pass both PR gates on the example
  fleet and, even under `--strict`, on a freshly seeded spine-first fleet. It now fails as
  `spine.op-undefined` (and `spine.op-deprecated`, `spine.op-link-missing` and `spine.resolved` read
  the same way), filed on the `landscape` target. Only those edges are graded: the provider is not
  pulled into scope, so its own documents — on a seeded fleet, its `service.no-model` — stay out of
  the PR's verdict. An edge is new when its (source, target, op) is; a reformat grades nothing.
- **The landscape re-grades a fleet-wide vocabulary only when the file that carries it changed.**
  `permissions.*` rides a scoped run only when `architecture/permissions.yaml` changed,
  `capability.*` only when `architecture/capabilities.yaml` or `capabilities/` did,
  `obligation.invalid` and `obligation.unapplied` only when `architecture/obligations.yaml` did,
  `glossary.*` only when `glossary/` did, and `agents.stale` / `docs.binary-behind` only when
  `AGENTS.md` did. A one-line map edit on the example fleet is no longer red under `--strict` on four
  warnings that were all there at the base.
- README's spine-first section now says that under the `--base` gate a PR adding a service's
  `openapi.yaml` stays red until that service has a `model.likec4` — `service.no-model` is the
  ratchet working as designed.
- **Each service target in scope reports a committed map that does not parse, even when the branch
  left `architecture/` alone.** On such a branch the scoped run emits no `landscape` target, yet
  each service in scope still said `spine.landscape-invalid … the parser output is reported once,
  on the landscape target`, with empty `details`. So the parser output was reported nowhere. Each
  service's `spine.landscape-invalid` now carries the parser output in `details` whenever the run
  has no `landscape` target, as `validate --service` always has. A feature target does not report
  the map, so a run whose only targets are features still says nothing about it. The defect
  predates this release's `--base` changes and is present in `0.2.0-alpha.8`.

### Fixed — one LikeC4 typo no longer floods agent-facing output

No code, flag, path or payload key was added, changed or removed; what moves is the TEXT of the
diagnostics LikeC4 hands loam, and one warning that stops cascading.

- **A parser's "Expecting: one of these possible Token sequences" message is cut to its first four
  alternatives plus `… (+N more)`**, keeping the `but found: '…'` line — on every surface that
  prints a LikeC4 diagnostic (`validate`, `context`, `show`, `tasks`, `doctor`, `gate`,
  `archive`). One dropped quote in the example fleet's order-service model made `loam validate
  --service order-service` print 18,503 lines (434 KB; 458 KB as `--json`); it now prints 27 lines
  (1.7 KB; 5.5 KB as `--json`).
- **Each LikeC4 diagnostic is reported once, in line order.** The same message at the same line of
  the same file used to be listed twice, and the lexer's error led the parser's even when it sat a
  dozen lines below the fault. The `N error(s)` count in `c4.invalid`, `delta.invalid` and the other
  parse findings now counts distinct diagnostics.
- **`covers.unknown` is no longer raised for a service whose own `model.likec4` does not parse.**
  `c4.invalid` is the one finding; the six `covers.unknown` warnings the example fleet showed for one
  dropped quote named ids that were spelled right. The same suspension already applied to a model
  extending a map that does not parse.
- **A broken document no longer bloats anybody else's briefing.** A dropped quote in a feature's
  `delta.likec4` made `loam context order-service --json` 626 KB instead of 24 KB (now 27 KB). The
  fleet map's parse error reached `useCaseScan.error` on every service's `context --json` and the
  `loam gate` "landscape cannot be used" message raw — 173 KB and 152 KB — and now goes through the
  same spelling as every other diagnostic, which adds its 1-based `L<n>:` line (23 KB and 2 KB).

### Fixed — `doctor.agent-files-stale` fires on a changed body, not on every release

No code, flag, path or payload key was added, changed or retired; what a repo NOTICES is that
`loam doctor` stops warning about generated command and skill files whose only difference is the
version stamp.

- The stamp sits inside every generated command and skill file, so every release used to turn every
  one of them stale in every repo, even when the release had not changed a word of the pointer — a
  warning that is always on, which then hid the release where a pointer really did change. A file is
  now stale only when its body, the stamp line set aside, is not what this loam writes, AND its stamp
  is missing or older. Line endings do not count (a Windows checkout that converts them to CRLF is
  not a change). A customized body under a current stamp stays quiet, as before. Same code, same severity;
  the `agents.staleFiles` list in `loam doctor --json` simply stops naming stamp-only files.

### Fixed — relationship order is the same on every run

No code, flag, path or payload key was added, changed or retired; lists built from relationships
come back in one stable order.

- LikeC4 indexes relationships by a hash of the document's path, and loam stages documents under a
  fresh random folder per run, so an edge whose hash happened to come out all digits (about one in
  2,200) jumped to the front of the list on that run only; inside a project of several documents the
  base order was whichever file finished reading first. A scheduled CI run failed on it. Every loader
  now returns relationships sorted by source, target, title, `op`, `publishes`, `consumes` and tags,
  so anything listed from edges — `loam explore`'s neighbours, the candidates a
  `usecase.step-contested` finding names, findings emitted per edge — keeps one order between runs
  and machines. That order is no longer the declaration order.

### Fixed — the repository no longer claims a version is published

No code, flag, path or payload key was added, changed or retired; only documentation moved.

- README called the version in `package.json` "the newest published version", by construction of
  the test that pinned it — and kept saying so for `0.2.0-alpha.8`, whose publish failed. It now
  names that version as the version of the checkout and points at the npm dist-tags as the source of
  truth; the drift test forbids the publication claim in README and in the CHANGELOG section of the
  checkout's own version. The `0.2.0-alpha.8` section below carries a dated note that it was never
  published.
- The `0.2.0-alpha.3` section said `npm i @ybotok/loam@alpha` installs it. That release was tagged
  and withdrawn before its publish step, which only the `0.2.0-alpha.4` section said. It now carries
  the same kind of dated note.
- README said Codex reads `.codex/skills/`. That is the folder the `codex` target writes, and Codex
  still loads it, but Codex's skills documentation names only `.agents/skills`. README now says so
  and points at the `agents` target for the documented root. The `codex` target's path is
  unchanged.
- README and WORKFLOW no longer quote byte sizes and code counts that had gone stale (the
  `loam-check` page, the AGENTS.md orientation, the finding-code total). A finding- or refusal-code
  count quoted on a shipped page is now graded against `loam explain --codes`.

### Changed — `loam archive` moves the delta's bytes and nothing else's

- **The requirements merge splices instead of re-serializing.** A living requirement the delta does
  not touch is written back byte for byte; only ADDED requirements and the ones a MODIFIED replaces
  are serialized. Before, the whole `## Requirements` run was re-serialized, so a living spec
  written without a blank line under `### Requirement:` had one inserted under every untouched
  requirement by its first archive — the diff, `loam vouch --pack` and the re-vouch all widened to
  the whole section. `loam unarchive` is unchanged and still restores every byte. Each kept slice
  is matched to its requirement by `Requirement-ID:` (the heading when there is none), never by
  position; if the slices and the living requirements do not match one to one, the whole run is
  re-serialized as before rather than one requirement's text landing in another's place.
- **`archive --json` gains the additive `revouchOwed` key** (`[{service, path, owner}]`, on the
  dry run and the real merge alike): every vouched living `spec.md` / `arch.spec.md` the merge
  moves under its vouch stamp, with the frontmatter's `owner` (`null` when none is recorded).
  `content.stale` follows on each — unchanged and still a warning; no new code, nothing `--strict`
  lets through. The human view prints the same list under a `re-vouch owed` line, naming
  `loam vouch --service <id>` and saying the re-vouches belong in the archive's own PR, which
  `loam validate --all --base <ref> --strict` keeps red until they land. The `/loam-ship` protocol
  gains that step, and README's docs-repo PR recipe says so.
- The human view of `loam archive` no longer prints its `archive <id>` header twice.

### Fixed — the adopt brief's spec examples

- The `spec.md` and `arch.spec.md` examples in `loam adopt`'s brief name the service being adopted
  in their frontmatter `service:` and title, where they used to say `payment-service` for every
  service — a verbatim paste failed `frontmatter.field-mismatch`. Their requirements now carry the
  canonical blank line under `### Requirement:`, so a spec copied from them is not reflowed by its
  first archive.

### Fixed — fleet readouts tell the truth about trust

A vouched spec edited after the vouch (`content.stale`, computable from the docs repo) was reported
by `loam validate` and by no fleet readout; `sources.unwalked` fired in every service repo straight
after a fresh vouch; and the human `status`/`list` views printed a verification count without
saying who answered it. Additive throughout — no code, flag or key changed or was removed, and the
maturity rung of every service is unchanged.

- **New stable code `next.revouch`** in `loam status`'s fleet `next[]` (and under `--service`): one
  step per vouched service whose `spec.md` or `arch.spec.md` changed since the vouch, naming the
  documents. Its `command` is `loam vouch --service <id>` and its `execution` is
  `kind: "human-review"`, `runnable: false`, `cwd: "service-repo"` — a re-vouch is a person's act.
  While one stands, `status` no longer reports `next.fleet-clean`.
- **New payload key `services.contentStale`** on `loam status --json` (fleet form): of `vouched`, the
  services with a document moved under its stamp — a subset, like `sampledVouched`. The human line
  reads `N vouched (M stale)`.
- **New payload key `scorecard.provenance.contentStale`** on `loam validate --all --json`: services
  with a `content.stale` finding in that run. The text row reads `N vouched — M stale content ·
  K stale digest(s) · …` (it used to say `0 stale digest(s)` beside the warning).
- **New payload key `answered` inside `verification`** on `loam status --json` (the feature form, and each
  `features[].verification` of the fleet form) and on each `features[]` row of `loam gate --json`,
  which spreads the same record: the confirmed claims per `answered_by`
  (`runner`, `external-runner`, `agent`), the split `list --json` already carried. The human views
  print it beside the verdict — `status <FEAT>` as `verified 19/19 confirmed (13 runner · 6 agent)`,
  `list`'s verification column as `7/7 (5 runner · 2 agent)`. The verdict and its definition are
  unchanged.
- **`loam list`** shows such a service as `vouched (stale)` (or `vouched (sampled, stale)`) and counts
  it in the maturity line; its `missing` — in text and in `--json`, and likewise in `explore` and the
  context pack, which share it — now reads `re-vouch (<file> changed since the vouch)`, so
  `list --needs-work` (with `--review-order` and `--owners`) lists it instead of answering
  "nothing to do". The `maturity` value stays `vouched`.
- **`sources.unwalked`** no longer counts loam's own files — `loam.json` and the agent files recorded
  in its `agentFiles` — or any `.gitignore` toward its denominator. `.gitignore` is the file that
  defines what git tracks, so it is the measuring instrument, never a part of the service a spec
  owes; `package.json`, READMEs and the like stay in. A freshly vouched service repo is no longer
  red under `validate --service --strict` for files it cannot honestly list in `sources`.
- **`loam list` legend** names the `e` (events / AsyncAPI) column: `[e]vents`.
- **SCHEMA.md**: the per-service CI summary shape gains `contentStale` (the count of `content.stale`
  findings), and its jq derivation counts it. **WORKFLOW.md** states that `loam gate --strict` also
  fails on a join partner's `content.stale`.

### Added

- **New warning `frontmatter.owner-mismatch`** from `loam validate` (`--service` and `--all`) when
  one service's `spec.md` and `arch.spec.md` both name an `owner` and the two differ. `loam show`
  and `loam context` print only `spec.md`'s owner, so the other value was a second answer nobody
  saw. Its `details` list each file's value (`spec.md: <owner>`, `arch.spec.md: <owner>`). Silent
  when either file names no owner (that stays `frontmatter.field-missing`). It compares the two
  files only, never CODEOWNERS. As a warning it fails `loam validate --strict`, so a service that
  passed `--strict` with two different owners now exits 1 there until they agree.
- **`openapi.generated-stale` now says what moved.** The finding gains `details` naming each
  operationId that differs between the build's contract and the committed copy — `served, not in
  the committed copy: <id>` and `committed, no longer served: <id>` — and its message counts both
  sides, or says every operationId matches when the difference is inside an operation or outside
  `paths`. The digest still decides whether it fires; same code, same severity.
- **`diff.op-modified` (warn)**: an operationId present at the base ref and now, whose operation
  changed — its own definition, its method or path, or anything its internal `$ref`s reach, so a
  field renamed in a shared `components` schema counts. **`diff.message-modified` (warn)** is the
  same for an AsyncAPI message: its declaration or anything its payload `$ref`s reach. Both name
  the authored consumers in `details[]` (the same scan `diff.op-deprecated` runs) and point at
  oasdiff or `asyncapi diff`; neither grades whether the change is breaking, so neither sets
  `breaking` or changes the exit code. A PR that renamed a required field used to print "no
  fleet-meaningful changes" and exit 0 with nothing else.
- **The `modified` count in `loam diff --json`'s `summary` now counts both new codes** beside
  `diff.requirement-modified`. The key is unchanged; a diff over a changed contract reports a
  higher number than before.
- A newly deprecated operation is still reported once, as `diff.op-deprecated`, not also as
  `diff.op-modified`.

### Changed

- **An AsyncAPI 1.x or 2.x document is `asyncapi.invalid`, once.** loam reads AsyncAPI 3.0 only,
  and a document whose `asyncapi:` field says `1.` or `2.` used to read as a 3.0 contract with no
  messages: one `spine.message-undefined` per landscape edge, one `spec-event.message-undefined` per
  requirement and a `spine.message-unproduced` on every consumer, none naming the version. It now
  takes the unreadable path every broken contract takes — one `asyncapi.invalid` whose `details`
  name the version and `asyncapi convert --target-version=3.0.0`, and nothing on the event axis
  graded against it. The same applies to a feature's own `asyncapi.yaml` under `--feature`. The
  `asyncapi.invalid` message, and the `context` / `delta` lines for an unreadable event contract,
  now say "does not read as AsyncAPI 3.0" rather than "does not parse". **It is an error:
  `loam validate` now exits 1 on such a document even where no edge or requirement names its
  messages** — a document that used to pass. `asyncapi convert --target-version=3.0.0` upgrades it.
- **`loam diff --base <ref>` exits 1 while a CHANGED `asyncapi.yaml` says 1.x or 2.x.** The
  document is listed in that service's `unreadable[]` once for each side on which it says 1.x or
  2.x, counted in the `unreadable` total of `summary`, and the service reads
  `change: "changed"`; it used to read as a contract with no messages and exit 0. One the branch
  did not touch does not do this — see the next entry. `asyncapi convert --target-version=3.0.0`
  upgrades it.
- **`loam diff --base <ref>` skips an unreadable `openapi.yaml` or `asyncapi.yaml` that the base
  ref holds byte for byte.** Such a contract is no longer listed in `unreadable[]`, counted in
  `summary`, or the reason a service reads `change: "changed"`, so an unconverted
  AsyncAPI 2.x file, or a broken OpenAPI file, that the branch never touched no longer fails every
  PR's diff with exit 1. A contract the branch changed, or one only one side cannot read, still
  suspends its axis and exits 1. `spec.md` and `arch.spec.md` are not skipped: an unreadable one
  stays suspended even when untouched, because another service's removal may be the one that
  could not be checked against it. No key is added or removed.
- **Suggested element ids follow `loam seed`'s convention.** For a service the fleet map does not
  draw yet, the `loam adopt` brief and the `loam new` delta scaffold now suggest `svc_<id>` (dots
  and dashes folded to `_`, e.g. `svc_payment_service`) instead of a camel-cased name, and
  `loam new --touches <id>` reuses the element id the map already draws the service as. A service
  the map nests inside another element is quoted by its last segment with a note naming the parent,
  since a dotted id is no top-level declaration. The commented example in a freshly seeded
  `architecture/landscape.likec4` uses the seeded ids too. Element ids stay cosmetic —
  `metadata { service '<id>' }` is the join — so nothing already written needs to change.
- **`seed-landscape-edited` gives advice that can be followed.** The refusal and `loam explain
  seed-landscape-edited` used to say "fold the edits into fleet.yaml and delete the file", which is
  impossible once an edge carries `metadata { op }` (fleet.yaml cannot). They now say seed runs
  once, before any operation is drawn, and that the map grows from then on through
  `loam adopt --service <id>` and feature C4 deltas. Same code, same exit code.
- **`migrate-openspec` and `audit-openspec` read the OpenSpec 1.13 requirement grammar.** A
  `RENAMED` pair written with a `*` or `+` bullet, or with no bullet, is a pair (it was
  `openspec.renamed-malformed`); a `REMOVED` section written as a bullet list (`-`, `*` or `+`) of
  requirement headings is read as those removals (it was `openspec.change-empty`); and a closing
  `#` run on a `### Requirement:` or `#### Scenario:` heading is dropped at ingest, so
  `### Requirement: Invoice totals ###` stages as `Invoice totals` and a MODIFIED delta naming it
  no longer fails `loam validate` as `delta.modified-unknown`. loam's own parser is unchanged.
- **An inbound landscape edge into the provider with no `metadata { op }`** (and no
  `publishes`/`consumes`) is now listed in the `details[]` of `diff.op-removed`,
  `diff.op-removed-consumed`, `diff.op-deprecated` and `diff.op-modified` as a consumer whose
  operation is unknown. A removal with such a caller and no named one now says "could NOT be fully
  answered" instead of "no current landscape edge or living requirement names it". It stays a
  warning, exit 0: a map `loam seed` drew, every edge without an op, does not fail every removal.
- **Without `--json`, a commander usage error** (a missing `--base` on `loam diff`, an unknown flag
  or command, a missing argument) now prints a fix line naming `loam <command> --help` and the code
  line `invalid-option  ·  loam explain invalid-option` under commander's own message, like every
  other refusal. stdout stays empty, exit 1; the `--json` envelope is unchanged.
- README's `.github/workflows/fleet-edges.yml` **pins loam to an exact version** (`LOAM`) and says
  how to move the pin, **adds an oasdiff step** per changed `services/*openapi.yaml`, and no longer
  labels the `diff` step "did you break a consumer?". `test/docs-drift.test.ts` keeps the pin equal
  to the version README names.

### Contributors — release preflight and test harness

- `npm run release:check` checks that every dependency a `package-lock.json` entry names resolves
  to another entry, the way Node looks it up, and then runs `npm ci --dry-run --offline` on a
  scratch copy of `package.json` and `package-lock.json` (new `scripts/lockfile-check.mjs`): the
  check that would have refused `0.2.0-alpha.8`'s stripped lockfile before the tag instead of after
  it. The structural walk comes first because npm's own verdict depends on the npm asked: npm 11
  refuses that lockfile, npm 10 (Node 22.22.3) installs it.
- The test harness creates its temporary directories under the canonical (symlink-resolved) temp
  root, so the suite passes on macOS without a `TMPDIR` override.

### Changed — a federated verification record is one file per service (a file-format event)

- **New path written: `features/<FEAT>/verification/<svc>.yaml`.** `loam verify <FEAT> --service
  <svc> --record` (and `--results` / `--contract-results` under `--service`, and the bound form that
  substitutes `--service` from loam.json) now writes that service's attestation to a file of its
  own instead of into one shared `verification.yaml`. Each file is a `schema: 2` record holding
  exactly one attestation and that service's answers; the directory is the record, and the verdict
  and counts are computed from the union of its files when anything reads it. What a repo notices:
  two teams recording two different services on two docs-repo branches no longer conflict when
  their PRs merge — the shared file conflicted every time (add/add from an empty start, content
  conflicts on `summary:`, `claims:` and `attestations:` once one attestation had landed).
- **Old path still read, forever: `features/<FEAT>/verification.yaml`**, active and archived, in
  every shape loam has written. A one-file federated record reads exactly as before until a service
  records again; that service's new file then supersedes its share of the old one (the old file is
  not rewritten), and the write that leaves nothing in it counting removes it. An all-at-once
  (schema-1) record is removed by the first `--service` write, which lists its answers in
  `discarded` — the same answers the old overwrite listed.
- **The all-at-once form is unchanged on disk.** `loam verify <FEAT> --record` without `--service`
  still writes the one file `verification.yaml` — it answers the whole checklist from one place, so
  there is no second writer to collide with and no service to name a file after — and is still
  refused `record-federated` over any record carrying attestations, now including per-service files.
- **When services answered different versions of the checklist**, a record kept as per-service files
  counts the answers of the files that answered the version the feature asks NOW — `loam verify`
  (read and `--record`), `loam tasks`, and `status`, `list` and `gate` for an in-flight feature all
  derive it — and falls back to the newest file (by `recorded` date, a later service id breaking a
  same-day tie) only for an archived feature's frozen view or when no file answered the current
  version. The others stay in `attestations` and are named by `verify.checklist-forked` until they
  record again — now on the recording run's own output (`notices` under `--json`) as well as the
  read view, so the service whose answers a tally leaves out is named where the tally is printed. A
  same-day record from a service with a later id against an older checklist no longer drops the
  current answers and makes every reader call the record stale. A one-file record keeps its old
  reading. The `verify.checklist-forked` message no longer suggests accepting the split.
- **`record-unreadable` names the file that failed and the repair that is safe for it.** Git conflict
  markers in any record file are detected before the YAML is parsed and named with their lines. A
  service's own `verification/<svc>.yaml` is that service's word alone, so its advice is to repair
  it or delete it and record that service again; the one-file `verification.yaml` may hold other
  services' attestations, so its advice is to repair it or restore it from version control (after a
  merge, the copy on the branch you merged into) — never to delete it. The old advice ("delete it
  and record again") erased other teams' attestations when followed on a shared record, and a
  `verify.record-miscounted` record's "record the answers again" looped straight back into the same
  refusal. The same per-file advice reaches `evidence.record-unreadable`, and the `status` and
  `gate` sentences for an unreadable record no longer say "delete it". A per-service file holding
  anything but its own service's attestation is unreadable too.
- **`path` in a recording `verify --json` payload** is the file this run wrote — the service's own
  `verification/<svc>.yaml` under `--service`. The `path` inside `recorded` on the read and frozen views, and the
  `verification` artifact's `path` in `status`, name the `verification/` directory once it exists,
  the one file otherwise. `archive` and `unarchive` carry the directory with the feature they move.
  No code or flag was added, changed or retired, and no payload key was added or removed. What
  changes is the VALUE of four `path` keys, and each may now name a DIRECTORY: `path` on a recording
  `verify --json`, the `path` inside `recorded` on the read and frozen views, the `verification` artifact's
  `path` in `status --json`, and the `path` on a `next.verify` step in `status --json` (which follows
  the artifact's). A script that opens one of them as a file must now expect
  `features/<FEAT>/verification` — a directory — once any service has recorded under `--service`.
- **A loam older than this release does not read `verification/<svc>.yaml`.** It sees only
  `verification.yaml`, so `status`, `gate` and `verify` under an older pin report a feature recorded
  this way as having no record (`gate --strict` then exits 1 on `gate.feature-unverified`), and an
  older all-at-once `--record` writes a `verification.yaml` that this release ignores beside the
  directory (its answers carry no attestation). Upgrade every repository that records or gates a
  feature together — the docs repo's pipelines and each service repo's pin.
- **`features/<FEAT>/verification/` is loam's from this release.** Every non-dot `*.yaml` in it is
  read as one service's attestation file, and one that is not (a hand-made `k6.yaml`, say) is
  `record-unreadable`: `verify` refuses and `status` shows the record as unreadable. Keep anything
  else beside the feature, not inside that directory.

### Changed — `verified` means a run of the stamped scenario, and the runner-neutral path is findable

- **A cucumber run must have run the stamped scenario's step count.** `verify --results` used to
  confirm a `scenario.tested` claim from any report element carrying its `@loam-digest-…` tag whose
  steps passed — a one-step stub tagged by hand confirmed five-step scenarios. A matched cucumber
  element must now have run exactly as many steps as `loam gherkin` emits for the scenario (`And` /
  `But` included); otherwise the claim is `unconfirmed`, noted `ran N step(s) where the stamped
  scenario has M`. The step text is not compared (outlines fill their placeholders in, dialects
  differ on keyword spacing). cucumber-js's hook entries inside `steps[]` (`hidden`, keyword
  `Before`/`After`) are read as hooks, not steps: they no longer count toward the steps, and a
  failing one is reported `failed in a before/after hook`. `loamScenarioReport` entries carry no
  steps and are held to their status, as before. What a repo notices: a report whose elements do
  not run every stamped step stops confirming.
- **A `--results` file that is not JSON is refused naming both accepted shapes.** A JUnit XML report
  died with the parser's raw "Unexpected token '<'". It is still `answers-unreadable`, and the
  message now says the file is XML or not JSON and names what `--results` reads: cucumber JSON
  (cucumber-js, cucumber-jvm, behave, SpecFlow/Reqnroll, pytest-bdd `--cucumberjson`, godog) or
  loam's runner-neutral `{"loamScenarioReport": 1, …}`. A `--contract-results` file that is not JSON
  names its one shape the same way.
- **`loamScenarioReport` is named wherever cucumber is.** The `--results` description in
  `loam verify --help` now reads "cucumber JSON, or loam's runner-neutral loamScenarioReport JSON for
  any other runner"; the `check` in the `done` block `loam tasks` prints for a `scenario.tested` unit names both
  report shapes; the `verify.scenario-attested` message's suggested command reads
  `--results <report.json>` and names both; WORKFLOW, the verify, implement and done-check protocols
  and the cycle `loam explain` teaches say the same. So does the `next.verify-attested` step in
  `status --json` — its `statement` names both shapes and its `command` now reads
  `loam verify <FEAT> --results <report.json>` (it was `--results <cucumber-report.json>`) — and
  `loam explain next.verify-attested`.
- **The all-at-once `--record` checks each evidence entry shaped like a `file:line`.** Without
  `--service` it accepted any non-empty evidence — `src/foo.py:1` for a file that does not exist —
  and printed `verified`, while the federated form refused the same citation. An evidence entry of
  an agent-confirmed answer that is shaped like a `file:line` (one token ending in `:<digits>`, not
  a URL) must now be a canonical relative path to a regular file inside the repository loam.json was
  found in, with that line in it; otherwise `answers-unevidenced`, exit 1, where it used to be
  recorded. Every other entry — prose ("manual QA by Alice"), a URL, a path with no line — is
  recorded exactly as before. The form still binds to no commit and stamps no pins. Evidence that
  lives in another service's repository is recorded from there, with `--service`. A missing cited
  file is now named in the repository's own spelling ("does not exist in this repository") in both
  forms, never through the machine's absolute path.
- No code, flag, path or payload key was added, changed or retired.

### Added — `loam gate --since <ref>`: the deploy gate no longer forgets a feature at archive

- **`loam gate` used to grade in-flight features only**, so a feature left the verification check
  the moment it was archived — and `loam archive` reads no verification record, by design. On the
  example fleet `gate --service order-service --strict` went from exit 1 (FEAT-112 unverified) to
  exit 0 after `loam archive FEAT-112`; a contract-only feature escaped even a vouched service,
  because `content_digest` covers the spec bodies and not `openapi.yaml`/`asyncapi.yaml`. Without
  the new flag that is still exactly what the gate does, and `--help`, WORKFLOW.md and
  `loam explain gate.feature-unverified` now say so.
- **New flag `--since <ref>`** on `loam gate`: a docs-repo git ref — the docs commit the pipeline's
  last deploy recorded. Every feature archived after it that carries a `specs/<service>/` delta is
  graded too, by its frozen verification record, under the existing warn-only
  `gate.feature-unverified` (or the reused `verify.scenario-attested`). "Archived after" means its
  `features/archive/<FEAT>/` directory is absent at the ref, or differs from what it held there —
  committed since or not — so a feature unarchived, edited and archived again is graded as the new
  ship it is, not skipped as one an earlier deploy answered for. When git will not say what changed
  under `features/archive/`, every archived feature touching the service is graded. Its message
  names the ref and points at `loam unarchive <FEAT>` rather than a `loam verify --record` an
  archived feature refuses. The ref is read from the docs repo's own git exactly as
  `loam diff --base` reads its base, and refused the same way: `repository-unavailable` when git
  cannot answer from the docs repo (or cannot list `features/archive/` at the ref), `unknown-target`
  when the ref names no commit. No new code; no deployment state is stored.
- **An archived record is held to the checklist its feature shipped with.** A record gone stale
  before the archive (a scenario appended after it was written) read `stale`/`unverified` in flight
  and `verified` with no finding once archived, because an archived record is never judged against
  a checklist re-derived after the merge. `loam archive` now writes the digest of the checklist a
  fresh `loam verify` derives just before the merge — when the feature carries a readable record —
  into its snapshot manifest as a new key, **`checklist`**, in
  `features/archive/<FEAT>/.loam-before/manifest.json` (additive: the manifest stays version 3,
  `unarchive` ignores the key, and an older loam reading the manifest is unaffected). `gate --since`
  grades the frozen record against it: a record answering an older checklist is `state: "stale"`,
  `verdict: "unverified"`, with a `gate.feature-unverified` saying the feature moved after its
  record was written. A manifest without the key — an archive made by an older loam — is graded as
  before, as frozen history, and the row says so. `list`, `status` and `verify` keep reading an
  archived record as frozen history, never stale.
- **New `--json` payload keys:** top-level `since` — `{ ref, commit }` under `--since`, `null`
  without it — and, only on a row `--since` added, `features[].archived` (`true`) and
  `features[].checklistAtArchive` (the captured digest, or `null` when the archive captured none).
  An in-flight row carries neither key, so a payload without the flag is unchanged apart from
  `since: null`. The text view titles the block "verification — in flight, and archived since
  <ref>", marks those rows `· archived`, and adds a line under a recorded row whose archive
  captured no checklist.
- **The MCP `loam_gate` tool** gains the matching `since` string argument.

## [0.2.0-alpha.8] - 2026-09-21

The work packet: the verify checklist read forwards. Still a prerelease on the `alpha` line.
**Not published (noted 2026-10-10):** the `v0.2.0-alpha.8` tag was cut, but its release run failed at
`npm ci` — npm on Windows had stripped other platforms' optional packages from the tagged commit's
`package-lock.json` during the version bump (restored on `main` the same day) — so the publish never
ran. `npm i @ybotok/loam@alpha` does not install this version, and `npm view @ybotok/loam dist-tags`
is the record of what does. Everything in it is additive — no stable code was added,
changed or retired, no existing flag, path or payload key moved, and nothing a repository has
committed needs to change. What a repo NOTICES after upgrading: one new read-only command
(`loam tasks`), new keys on two `--json` payloads it may already consume, and a corrected SCHEMA
sentence about how scenario digests are salted — the code did not move, the sentence did.

### Added — `loam tasks`, the derived answer to "what do I do next, and what closes it"

The question an authored task file answers is a good one; the file is the wrong place to answer it,
because a second mutable state drifts from the spec it was copied out of. So this is that answer
DERIVED — the `loam verify` checklist read forwards, one work unit per promise the feature makes,
each carrying the step it is waiting on and the fact that retires it, recomputed on every run from
the delta, the generated suite and the verification record. SCHEMA's "Deliberate limits of the
workflow surface" row refusing an authored `tasks.md` as authoritative state **stands unchanged**;
this is the projection that row has always pointed at, and it is a projection precisely so that
nothing here can disagree with the documents it was derived from.

- **New read-only command `loam tasks <FEAT> [--service <id>] [--next] [--json]`.** It writes
  nothing, anywhere, ever, and creates no artifact. Every unit it reports is one claim of the same
  checklist `loam verify` derives, **under the same id** — a unit and the answer that closes it are
  one identity on both commands. The one unit with no claim behind it is minted for an ADDED or
  MODIFIED requirement carrying no scenario at all (kind requirement.described): nothing to test
  means nothing for the checklist to ask, and a promise with no acceptance criteria is still work.
- **`units[]` is the projection**, one entry per unit, carrying `id`, `kind`, `subject`, `at`,
  `claim`, `dependsOn[]`, a `done` block, and — where the ledger has them — `digest`, `operation`,
  `token` and a `source` naming the document, the 1-based line and, for a scenario, its body
  verbatim.
- **`at` is the step the unit is waiting at**, one of `describe`, `generate`, `implement` or
  `attested` — never a percentage. It is spelled `at` rather than `stage` or `verdict` on purpose:
  both of those already mean something else on payloads an agent reads beside this one.
- **Done is a fact, not a tick.** A closed unit stops appearing, and exactly one thing closes one: a
  claim recorded `confirmed` in a `verification.yaml` that is **not stale** against the current
  checklist. A stale record closes nothing — the words moved under the answers. An agent-attested
  scenario never vanishes: it stays visible at `attested`, because attested is not verified and a
  work list that hid the difference would be the gate that teaches everyone to say yes.
- **`frontier` is the ids of the first ten open units in derived order**, providers before consumers
  on the exact token join `c4.calls.token == api.exposes.operation` — never a reading of prose —
  with `frontierElided` saying how many open units it left off. **The order is advice and never a
  lock**: nothing is assigned, nothing is reserved, and working out of order is legal and invisible
  to every other command.
- **`--next` is the leaf packet**: the same payload with `units` narrowed to the frontier head, and
  what an orchestrator hands one coding agent. Everything else is left whole on purpose, so a cheap
  model handed one unit cannot read it as the whole job. The text view prints that leaf in full —
  the scenario's Given/When/Then verbatim and never reflowed (those are the bytes the digest was
  taken over), its digest, the `done` block whose `check` is the fact that closes the unit, and the
  literal follow-up command. Literal rather than a shape to fill in, because "the appropriate verify
  invocation" is a guess the reader will get wrong.
- **`--service <id>` is a pure lens** over the same derivation, and adds `waitingOn[]`: the open
  units in OTHER services that this service's units depend on.
- **`stamps` is `read` or `unknown`.** `unknown` means the bound service repo's generated suite could
  not be read — could-not-look, and never nothing-wrong.
- **The rest of the payload**: `feature`, `service` (the lens, or null), `services[]`, `path`,
  `intent`, `checklist` (the digest of the question set the units derive from), `record` (`absent`,
  `recorded`, `stale` or `unreadable`), `size{requirements,scenarios,operations,messages,calls}` —
  the size of the DELTA and never of the open work, so that "this feature is small" and "this
  feature is nearly done" cannot become one sentence — `contracts{expose[],call[]}`,
  `counts{open,done,attested}`, and `review[]`, the four instructions for re-deriving this answer
  and reviewing it.
- **A broken `delta.likec4` or contract axis exits 1 with `ok: true`**, naming what it could not read
  in `unreadable` (`architecture`, `contracts[]`). That is `loam delta`'s own rule rather than a new
  one: a feeder that could not be read empties the packet, an agent consuming an empty packet reads
  "nothing to do", so the envelope stays informative and true while the exit code stops a pipeline
  building on it.
- **New MCP read-only tool `loam_tasks`**, declaring `readOnlyHint` like every other read tool; the
  base table is fifteen tools where it was fourteen.
- **No stable code was added, changed or retired, and no existing flag, path or payload key moved.**
  The change is purely additive: everything `loam tasks` reports is a projection of state other
  commands already derive and grade.

### Added — `loam delta --json` carries the joins and the lines it had been dropping

- **New additive keys per requirement**: `line` (where it sits in the document it was parsed from, so
  a consumer can send an author to the line rather than to the file), `basedOn`, `requires`,
  `capabilities`, `realizes`, `publishes` and `consumes`. Every one of them is already written on the
  requirement and every one names work — which permission gates it, which capability it belongs to,
  which named promise it realizes, which messages it produces and consumes — and an implementer
  handed this projection had to go and read the Markdown it claimed to have projected to find them.
- **New additive keys per scenario**: `line`, and `digest`, the 16-hex scenario body hash. That
  digest is the exact join key the rest of the toolchain already uses — the `@loam-digest-<16hex>`
  tag `loam gherkin` stamps and the string `loam verify --results` matches a cucumber report on — so
  a consumer of this brief can now name the test that answers an acceptance criterion instead of
  regenerating the suite to find out. It is salted by the owning service and the axis, like every
  other spelling of it, so an arch requirement's scenarios digest differently from identically
  worded business ones.
- **Nothing existing moved.** Every key this payload already carried is untouched, the text output is
  unchanged, and no stable code was added or changed.

### Added — `loam gherkin --json` says which stamp belongs to which scenario

- **New additive key `files[].stamped`**, a list of `{scenario, digest}` pairs. `digests` was a bare
  array and `scenarios` a bare count, so the one thing a consumer needed — which stamp belongs to
  which scenario — was the one thing this payload could not say, and the only way to learn it was to
  read the generated file back off disk. A `kept` row reads its pairs off the file that is really on
  disk, because its numbers describe the in-flight emission that stayed rather than the one that was
  withheld.
- **`digests` and `scenarios` are unchanged beside it**, and no stable code was added or changed: the
  envelope permits adding a key and never changing one.

## [0.2.0-alpha.7] - 2026-09-07

Infrastructure belongs on the fleet map, and the render is navigable at fleet scale. Still a
prerelease on the `alpha` line: `npm i @ybotok/loam@alpha` installs it. One code is REMOVED —
`landscape.datastore-private`, the first code this project has ever retired — and no flag, path or
payload key is. What a repo NOTICES on its first `validate --all` after upgrading: a
`subsystem.views-stale` error against the new `architecture/services.likec4`, in every fleet whose
map draws a service, cleared by one `loam subsystem sync`; a second one against
`architecture/subsystems.likec4` wherever subsystems exist, because those views gained boundary
edges and an `of` subject; and silence where a datastore drawn beside the services used to be told
to move.

**Upgrading: one `loam subsystem sync` per docs repo, once.** `loam validate --all` reports
`subsystem.views-stale` (error) against the new `architecture/services.likec4` in EVERY existing
docs repo whose fleet map draws a service — flat fleets with no subsystems included, because the
file is new everywhere and an absent generated file is a state of its own. This is not a
subsystems-only upgrade: a fleet that has never run `loam subsystem new` gets the finding too. A
repo that DOES have subsystems gets a second finding on the same run, against
`architecture/subsystems.likec4`, because the subsystem views gained boundary edges and an `of`
subject and every existing copy therefore re-renders differently. One `loam subsystem sync` writes
both files and clears both findings. `loam archive` names the same repair rather than claiming
"complete + current". Nothing else in a repository has to change, and no document a team wrote is
touched — and a document a team wrote that is already standing at one of the two generated paths is
refused by name rather than overwritten (below).

### Removed — `landscape.datastore-private`, because where a store is drawn is the team's choice

- **`landscape.datastore-private` (warn) is retired.** It fired on a `database` element drawn at
  fleet level with exactly ONE consumer, and its whole message prescribed deleting the peer and
  writing the store inside its owner. The identical store nested was silent, so the check graded the
  DRAWING and not the architecture — a restriction rather than a fact about the fleet. A store one
  service owns may now be nested under that service's element or drawn beside the services, and loam
  grades neither. The code is not in the frozen `ErrorCode` or `IssueCode` unions, so removing it
  breaks no contract; `loam explain landscape.datastore-private` no longer answers, and the row is
  gone from the agent-facing check table.
- **`landscape.datastore-shared` (warn) is unchanged**, both arms. Two or more services on one store
  is a fact about coupling, not a restriction, and it fires at two consumers for both placements
  alike. What survives from the retired code's message is the one clause that was a fact about
  LikeC4 rather than a preference, and SCHEMA's "Private stores" now leads with it: a second
  consumer's edge resolves only against a declaration the MAP holds, because a per-service project
  is `architecture/` plus one model.
- **Infrastructure is not a service.** A new `INFRA_KINDS` set in `core/vocabulary/maturity.ts` —
  `database`, `queue`, `topic`, `cache`, `bucket`, compared case-insensitively — takes such an
  element out of four surfaces at once: the drawn-service census behind
  `landscape.service-undocumented`, the `loam gate` partner set (an infra endpoint is dropped from
  the `partners` payload, exactly as an actor already was), the `loam verify` checklist (a
  fleet-level store no longer mints a `service.exists` claim no repository can answer), and the
  scorecard's element denominator, whose `c4` row now counts services rather than services plus
  their stores. The hook is the kind NAME, with the same limitation `ACTOR_KINDS` lives with: a
  fleet spelling its kind `postgres` is not covered, and a tag can be added later as a second
  spelling. A store BOUND to a directory with `metadata { service }`, or titled like one, stays an
  adopted service on every one of the four surfaces — the census predicate wins over the kind.
  `landscape.service-undocumented`'s message gained a THIRD remedy beside "bind it" and "tag it
  `#external`", spelled from the same set: neither of the old two was true of a store the fleet
  owns, and that message is the only place an author learns which kind spellings loam reads.
- `c4.uncovered` was left alone, and the measurement is the reason: a delta drawing
  `splitLedger = database 'split-ledger'` earns it, and adding `Covers: splitLedger` to the
  feature's `arch.spec.md` delta silences it exactly, with no `covers.unknown`. The remedy the
  message names is true, so this is not a residual restriction — and the code fires only on elements
  a feature DELTA adds, never from `validate --all` over a living tree.
- The acceptance criterion, run for real: a `database` drawn at fleet level, owned by the fleet, with
  one consumer, no `#external` tag and no binding, now earns ZERO findings from `loam validate --all`
  and from `loam gate`.

### Added — `architecture/services.likec4`: one generated overview view per service

- **New generated path `architecture/services.likec4`**, written by `loam subsystem sync` beside
  `architecture/subsystems.likec4`, removed by it when the fleet map draws no service, and owned
  outright by loam: views only, byte-reproducible, one view per service the map resolves, sorted by
  service directory id. Each view is declared `of` its service's element, which is what makes the
  fleet map, every subsystem view and every other service view click-through into it with no
  authored link — measured at likec4 1.59.2. Peers are NAMED one by one rather than wildcarded,
  because on a map that groups its services the wildcard form collapses every peer to its group box
  and yields no drill-down at all (measured on a 120-service fleet: 0 of 10 nodes navigable). Median
  at 58 services in 11 groups: 10 nodes, 8 edges per view, about 7 ms of layout each.
- **Titles are folders.** A per-service view is titled `<subsystem path> / <service directory id>`,
  built from the same path helper the subsystem views use, so both generated files fold into one
  browser folder tree mirroring `services/`. LikeC4 has no view-folder syntax — `views { group … }`
  is a parse error at the pin — and splitting the title on `/` is the whole mechanism.
- **An authored view of the same element keeps precedence.** Two views `of` one element are legal;
  the first document alphabetically wins the default navigation target and both stay reachable,
  because the subject's own node cycles to the other. `architecture/landscape.likec4` sorts before
  `architecture/services.likec4`. loam does not detect the authored view and never will:
  docs/DESIGN.md rule 26 forbids reading what a view SHOWS.
- **Subsystem views gained two things** in the same generator: `include <member> -> *, * -> <member>`
  per member, so a subsystem view answers "what does this group touch" and not only "who is in it",
  and `view subsystem_<name> of <ancestor>` when the map holds an element owning exactly that
  subsystem's members. Measured at 58/11: ~14 nodes, ~38 edges, 12 of 14 nodes navigable. Every
  existing `architecture/subsystems.likec4` therefore re-renders differently and is stale once.
- **`subsystem.views-stale` now grades two files**, one finding per file, each naming its own path in
  `subject`, `locations[0]` and the message. No new code was minted: both files are written by one
  command in one commit and repaired by one run, which is what makes one code honest.
- **`subsystem.view-id-collision` reserves `service_` as well as `subsystem_`.** A `service_` id is
  reserved only for a service the fleet map actually DRAWS, so an unmodelled `services/<id>/`
  reserves nothing; the message names which generated file and which prefix.
- `deployment.doc-reserved` refuses a feature deployment document named `services.likec4` for the
  same reason it already refused `subsystems.likec4`: both names are generated, overwritten
  wholesale, and parsed by nothing.
- **No writer overwrites a generated views file it did not write, and refusing is now an exit 1.**
  Both generated paths are filenames loam RESERVES inside `architecture/`, a directory the team
  owns, and every writer of them rewrites the file whole — so a repository that already kept a
  hand-authored diagram at one of those paths would have lost it, silently, on the first run after
  the release that reserved the name. Reproduced before the guard existed: with a hand-authored
  `architecture/services.likec4` in the tree, `loam subsystem new platform` printed
  `architecture/services.likec4 updated` and destroyed it, first line and all.
- **What makes a file loam's is its FIRST LINE**, `// generated by loam`, with a leading byte-order
  mark stripped before the test — a Windows editor adds one without changing a fact, and without the
  strip loam would call its own output authored and refuse to regenerate it for good. A hand EDIT of
  a generated file keeps that line, so it is still loam's to repair and one `loam subsystem sync`
  puts it back: that has always been what `subsystem.views-stale` says. Only a file that never
  carried the mark is somebody else's. **A 0-byte file at either path counts as somebody else's** —
  it carries no mark — so an empty `architecture/subsystems.likec4` or
  `architecture/services.likec4` is no longer filled in; delete it and re-run.
- **`loam subsystem sync` declines the one file and finishes the rest.** `--json` reports the new
  `action` value **`refused`** — on `action` for `architecture/subsystems.likec4`, on
  `serviceViews.action` for `architecture/services.likec4`, one predicate behind both — while the
  other generated file, the per-service project files and the root `exclude` are still done and
  still reported, and the **exit code is 1**. That is `loam validate`'s shape rather than a refusal
  envelope, and the non-zero exit is the point: `loam validate --all` goes on reporting
  `subsystem.views-stale` for that path with `loam subsystem sync` named as the repair, so a run in
  a hook or a CI step must not report success over a file it can never fix.
- **`loam subsystem new` / `rm` / `move` / `rename` and `loam seed` refuse WHOLE**, before a byte is
  staged: `error.code` `already-exists`, exit 1, nothing written and — for `move` and `rename` —
  nothing renamed. No new code was minted, because that is what `already-exists` has always meant on
  these verbs; `loam seed` can answer it for the first time. They refuse whole rather than per-file
  because their entire contract is that the generated files land in the SAME commit as the change,
  so completing the structural half would manufacture the very `subsystem.views-stale` state that
  commit window exists never to leave behind — irreversibly, for a `move` that also stages renames.
- **The refusal sentence is one sentence, verbatim from all five writers.** It names the mark loam
  looked for, says that not one byte changed, and gives the way out: rename the file to a name loam
  does not reserve — every other `.likec4` under `architecture/` renders in the same project, so the
  diagram is not lost — or delete it, then re-run.
- **Payload keys, all additive.** `loam subsystem sync --json` keeps `path` and `action` meaning the
  subsystem file and adds `serviceViews: { path, action }`; `loam subsystem new` / `move` / `rm` /
  `rename --json` keep `views` and add `serviceViews`; `loam archive --json` keeps
  `subsystemViewsStale` and adds `staleViews: string[]`, the generated files it left behind. Nothing
  existing changed meaning.
- The generated-file SET is now one table (`GENERATED_ARCHITECTURE_FILES`), read by the path
  builders, the name reservation, both project loads that must EXCLUDE these files (the fleet map's
  and `c4.fleet-project-invalid`'s), archive's staging and `loam seed`'s. Four readers that must
  never disagree about which files are generated, and a name in one but not another failed silently
  both ways while there was only one.

### Added — the intra-service use-case slot, published rather than graded

- **`loam adopt` briefs `services/<…>/<id>/usecases/<name>.likec4` as an OPTIONAL target**, with the
  tag grammar and a worked example: a `dynamic view` tagged `#req-<Requirement-ID>` as the first
  thing in the view body, the tag declared once (in the landscape's `specification` for an extending
  model, in the model's own for a standalone one), every hop backed by a relationship the model
  declares, and the view id namespaced by the service because an extending model's views share the
  root project's flat id namespace. Optional-and-absent prints lowercase `missing` and is not a
  finding — the existing mechanism for an optional artifact, not a new one.
- **The generated AGENTS.md names the slot and its title convention**,
  `'<subsystem path> / <service id> / <use case>'`, so an authored use-case view lands in the same
  browser folder as its service's generated overview.
- **No new finding code, and no check on absence.** docs/DESIGN.md rule 26 — presence is never owed,
  and no check may grade a view's absence — is enforced by `scripts/arch-check.mjs`, so there is no
  service.usecases-missing and there never will be. The grader (`c4.valid`'s
  ` · K tagged flow(s) graded`) has existed since 2026-09-03; all that was missing was anyone being
  told. A usecase.flow-untagged check, which would grade a view that EXISTS, is recorded on
  [ROADMAP.md](ROADMAP.md) with its promotion bar rather than built.

## [0.2.0-alpha.6] - 2026-09-04

A service model may extend the fleet map, and the nine problem reports one fleet filed against the
previous release are closed. Still a prerelease on the `alpha` line: `npm i @ybotok/loam@alpha`
installs it. Nothing below removes a code, a flag or a payload key; two things a script may have
read do move: every LikeC4 line number loam prints is 1-based now, and seven feature-delta codes
plus the feature arm of `usecase.flow-invalid` answer `--feature <FEAT-id>` in
`loam explain --json` where they answered `--service <id>`. What a repo NOTICES on its first
`validate --all` after upgrading: a model written in the extending shape earns the renderer-wiring
warnings until one `loam subsystem sync` — which now also deletes a stray per-service
`likec4.config.json` beside such a model — a root `exclude` that hides the map is
`landscape.excluded`, and a standalone model whose copies of the map's elements disagree with it
is `c4.declaration-diverged`; a repository whose models all stand alone is asked to migrate
nothing, and its root `exclude` is not touched.

### Fixed — one rule for a service's own edge, and the document that actually failed, on every surface

- `loam context` and `loam explore` name the `architecture/` document that ACTUALLY failed in their
  printed warning, off the `landscape.broken` key their `--json` payloads already carried. `parses`
  answers for the PROJECT, so with a broken sibling the landscape file has no errors at all — and
  both printers still said `architecture/landscape.likec4 does not parse`, a claim about bytes loam
  had read fine. `explore`'s absent arm keeps the file name: `present` is about the FILE, which is
  the write target every brief asks for edits to.
- An edge whose two endpoints resolve to the SAME service is that service's own internal wiring,
  and no surface files it as an inbound call any more. `loam adopt --json` already dropped it; the
  one shared derivation does now, so `loam context`, `loam explore`, `loam show` and
  `loam vouch --pack` stopped reporting a service as its own caller (`← <id> "reads"`), and
  `loam list`'s fleet-wide spelling of the same rule stopped reading an `op`-carrying self-edge as
  proof that somebody calls the service — a service nobody calls was told it owed an OpenAPI
  contract, grading `partial` in `list` while `context` said `documented`. `landscape.touched` and
  `landscape.service-isolated` are unchanged: they read the relationships, so the map still draws
  an edge on the service.
- The adopt brief's `service.model-excluded` row describes both entry shapes: one covering the
  DIRECTORY, which `loam subsystem sync` rewrites, and one shaped like a FILE
  (`services/**/model.likec4`), which sync cannot repair and has to be removed or narrowed by hand.
  The finding's own message already said which one you have; the brief promised sync for both.
- `loam diff` classifies a base ref's tree with the same reserved-directory rule the live walk uses
  (`adrs/`, `usecases/`, `ui/` — shared as one set, not respelled). A service directory holding only
  the `services/<id>/usecases/` slot used to be absent from the base AND to contribute a phantom
  service called `usecases`, so committing it and diffing the unchanged tree reported one addition
  and one removal.

### Added — one model, many documents: a service model may extend the fleet map

- `services/<…>/<svc>/model.likec4` now comes in two shapes, and the FILE's own grammar decides
  which — never a config key, never a flag. A model declaring no `element` kind inside a top-level
  `specification { }` block is an **extending model**: loam parses it inside the `architecture/`
  project and it says what is inside the service with `extend <fully-qualified id> { … }` on the
  element the map already binds to the directory, re-declaring no kind, no tag and no partner. A
  model that declares one is a **standalone model**, parsed alone exactly as every model was
  before — legal forever, and not what `loam adopt` briefs any more. SCHEMA.md's new
  "Two shapes of a service model" carries both, the grades below, and the ordered migration recipe.
- New `c4.declaration-diverged` (warn, service target, subject the service, one finding per element):
  a STANDALONE model and the fleet map (`architecture/`) both declare one element, and the
  two copies disagree about `kind`, `title`, the tag SET or the `metadata { service }` binding. The
  message prints both declarations, names which fields differ, and offers the two repairs — copy the
  map's declaration verbatim, or migrate to the extending shape. `description` is deliberately not
  compared: it is prose nothing grades, while the other four each change what a view shows or what
  loam resolves. Silent while the map does not parse. This is the check that had no code: a fleet's
  copies of `kafka` and its identity provider had already lost `#platform` on every copy but the
  map's, and nothing in loam read two documents together.
- New `c4.element-unowned` (warn, service target, subject the service, one per element): an
  EXTENDING model declares an element outside the element that resolves to its own service. A system
  the service reaches belongs in `architecture/landscape.likec4`, declared once; another service's
  internals belong in that service's model.
- New `c4.fleet-project-invalid` (warn, `landscape` target, subject the service whose directory
  holds the file): `--all` only, only when at least one extending model exists, the map itself
  parses, and no root `exclude` entry hides the map (`landscape.excluded` below is then the whole
  answer). loam loads every `.likec4` the root LikeC4 project reads except the generated
  `architecture/subsystems.likec4` — the map, its siblings, every extending model and every
  `.likec4` beside one — and reports each error that is NOT already present in the map alone, in a
  per-service project, or in a service-flow project the same run made. That difference is the class
  no per-service grade can see: two services each declaring `tag req-AUTH` locally, two models
  adding the same child id under one element, a broken untagged sibling nobody opted in. All three
  are renderer-fatal and all three were silent.
- Three new renderer-wiring warnings on the `landscape` target, root-gated like
  `service.likec4-config-missing` and repaired by the same `loam subsystem sync`:
  `service.likec4-config-stray` (a `likec4.config.json` beside an EXTENDING model — the renderer
  registers a project holding nothing, or holding the model alone where it cannot parse),
  `service.model-excluded` (the root `likec4.config.json`'s `exclude` covers an extending model's
  directory, naming the entry that does it, so the renderer never loads the model) and
  `service.model-unexcluded` (it does NOT cover a STANDALONE model's directory, so the renderer
  merges that model into the map and reports every kind and element it declares as a duplicate —
  blanking the whole root project, not one service).
- New `landscape.excluded` (warn, `landscape` target, `loam validate --all`) — the root
  `likec4.config.json`'s `exclude` covers `architecture/landscape.likec4` itself. loam keeps
  grading the map whatever that list says, so every finding in the run is right; the renderer does
  not, and until now nothing said so. A repo notices it as one line at the top of `validate --all`
  naming the entry verbatim — typically an `architecture/*.likec4` written for a palette — INSTEAD OF
  the `c4.fleet-project-invalid` cascade the same entry used to produce, and it is the only line in
  the run that names the cause. `c4.fleet-project-invalid` is not graded while the entry stands: that
  check loads the fleet project the way the renderer does, with no floor under the map, so the one
  line came back as an unresolved `extend` in every extending model — 161 warnings on the packaged
  five-service example. Its message says the fleet project is unread rather than clean, and grading
  resumes the moment the entry goes. Never gating: with the map kept by the loader, every fact loam grades holds
  identically either way. The repair is the team's own edit — `loam subsystem sync` maintains only
  the `services/` entries and will not touch it, and the message says so rather than sending its
  reader to a command that reports success and changes nothing.
- `loam subsystem sync` now maintains the root `likec4.config.json`'s `exclude` as well as the
  per-service files. It rewrites the list to hold `services/<tree>/**` for exactly the models that
  stand alone: the wholesale `services/**` and every `services/<tree>/**` naming a directory that IS
  a service are removed, every other entry is kept in the order the team wrote it (a
  `services/legacy/**` for a directory that is no service survives), and the standalone entries are
  appended sorted. It runs when at least one extending model exists or when a standalone model's
  directory is not covered, so a repository whose models all stand alone behind `services/**` is
  never touched. Same staged transaction as the rest of `sync`; `--json` gains the additive
  `projects.exclude` (whether it rewrote, the resulting entries, and what was added and removed) and
  the text view prints one line when it did. A root config that is not JSON is left alone with a
  printed note.
- `loam init --docs <path> --create` now scaffolds `likec4.config.json` with
  `exclude: ["**/node_modules/**", "features/**"]`. `services/` is deliberately not excluded — the
  models a fresh repository writes extend the map, and the root project is the only place they
  parse. A feature's `delta.likec4` keeps its own `specification` block and stays excluded.
- The landscape the scaffold writes teaches the extending shape. Its `views` paragraph told a fresh
  repository that a service model "renders from its OWN directory" and that "each declares its own
  `specification` block, so the renderer can only be given one of them at a time" — written before
  an extending model belonged to the root project, and printed in the same `loam init --docs .
  --create` run that now excludes `features/**` precisely because it does. And the check that says
  a map is still untouched scaffolding now accepts EVERY generation loam has shipped, not just the
  current text: it is a byte-suffix match, so rewording the comment reclassified every older
  untouched scaffold as hand-authored — `loam seed` refused one its own scaffold had written
  (`seed-landscape-edited`, nothing written) and `loam status` dropped the teaching rung from the
  empty-fleet ladder. The two `v0.1.0-beta` stubs (no `views` block, no `tag platform`) and the
  `v0.2.0-alpha.1`-through-`.5` stub are all recognised, frozen beside the writer.
- `loam adopt --service <id>` briefs the extending shape: all four `shape` rules of the
  `model.likec4` target are rewritten, and the `example` is a `model { extend <id> { … } }` document
  with the fleet element's real id substituted in where the brief resolves exactly one. The brief's
  `checks[]` gains `c4.declaration-diverged`, `c4.element-unowned`, `service.likec4-config-stray`,
  `service.model-excluded`, `service.model-unexcluded` and `c4.fleet-project-invalid`, and its
  renderer statement in `unchecked[]` says the root project now holds the map and every extending
  model. `/loam-adopt` steps 3, 4 and 5 and `/loam-check`'s three fix tables carry the same.
- The packaged example fleet (`examples/docs`, what `loam init --example` copies out) is migrated:
  all five models extend the map, the five `services/**/likec4.config.json` are gone, the root
  `exclude` is the scaffold's two entries, `architecture/landscape.likec4` gains `element database`
  and the `notification-provider` system that notification-service's model used to declare for
  itself, and every `Covers:` entry and `views` block names the map's fully-qualified ids. Its
  `loam validate --all` result is unchanged: 0 errors and the same ten deliberate warnings.
- `loam archive` now writes a service's OWN `model.likec4`, not just the fleet map. A delta's
  additions nested under a service whose model EXTENDS the map — a container, a store, a
  container-level edge — are spliced into that model's `extend <fqn> { … }` block instead of into
  `architecture/landscape.likec4`, and a model with no `extend` block for that fqn gains one. A
  relationship goes to the model of the service owning its SOURCE, else its TARGET, else stays on
  the map: a service-level edge is where every fleet check reads it. A service-level element, a
  STANDALONE model and a service with no model.likec4 keep the previous behaviour byte for byte.
  What a repo notices: `loam archive` prints a second
  `architecture: merged into services/<…>/model.likec4 — +N element(s), +M relationship(s)` line
  beside the landscape one, the model path appears in the `--json` plan (and in `--dry-run`) as an
  ordinary write, `loam unarchive` restores it from the same `.loam-before` snapshot as any other
  overwritten file, and the service is no longer `c4.invalid` (duplicate declaration) the moment its
  model declares the container the adopt brief told it to declare. No new payload key and no new
  error code. Re-archiving adds nothing a second time — existence is checked against the models too
  — and two archives touching one model's `extend` block land adjacently.
- The archive's existence check now reads the extending models by TITLE as well as by id, so a
  container a service already draws under a different identifier is recognised instead of being
  spliced in beside itself: a delta adding `cache = container 'Order cache'` under a service whose
  model already declares `orderCache = container 'Order cache'` adds nothing and leaves the model
  byte for byte, which is what the same delta against the same title on the fleet map has always
  done. Nothing is routed to that model, so the plan names only the landscape — the second
  `merged into services/<…>/model.likec4` line appears when a model actually receives something.
  The models' title join is scoped to one service — it fires only when both the model's
  declaration and the addition resolve to the SAME explicitly bound service — because every
  extending model in a fleet names a container `api`, and the map's global title index is a
  pre-binding fallback, not a rule to spread.
- An extending model with no `model { }` block — an empty file, a `views { }`-only file, a tags-only
  `specification { }`, all three shapes loam calls extending on purpose — gains one when a feature's
  addition is routed into it, instead of refusing the whole archive with `merge-failed`. It is the
  same call the merge already makes one level down, where a model that has never named a container's
  parent gains the `extend <fqn> { }` block rather than refusing.
- `loam archive` proves the model it would write. The merged model is loaded as the project the
  per-service grade reads it in — the `architecture/` documents with this archive's own merged
  landscape in place, plus the model — and an archive whose model would not parse is refused at plan
  time (`merge-failed`) with nothing written, naming the model path and the first three errors. Two
  causes actually occur, and the refusal names both: a kind or tag the map's `specification` block
  does not declare, and a reference to ANOTHER service's interior, which lives in that service's own
  model and is in no project this one can see. A container-level edge whose two ends belong to two
  different services is the case that changes: it used to merge, because both containers landed on
  the map beside it, and it is now refused — there is no legal placement for it, and the answer is
  to draw that call service to service.
- What a repo notices: nothing, until a model is written in the new shape or `loam subsystem sync`
  is run. A repository whose models all stand alone keeps every finding it had, and its root
  `exclude` is not touched. Write one extending model — or upgrade a repo whose scaffold predates
  `services/**` being excluded — and the next `loam validate --all` reports the renderer-wiring
  warnings above until one `sync`; that one sync rewrites the root `exclude`, writes the project
  file a standalone model is owed and DELETES the stray one beside every extending model, so after
  it the renderer's project picker holds one entry instead
  of one per adopted service, and a fleet-wide duplicate that used to blank the whole picture is
  reported as `c4.fleet-project-invalid` before anybody opens the renderer.

### Changed — a model's grades follow its shape, and `--service` reads the whole map project

- `service.likec4-config-missing` is narrowed to STANDALONE models. A model that extends the map
  belongs to the root project, so it is owed no per-service `likec4.config.json` and never earns
  this warning; the same directories earn `service.likec4-config-stray` instead while a file left
  over from before the migration is still sitting there, and `loam subsystem sync` — which now also
  stops writing the file for extending models — is the repair for both. The message is reworded to
  say which shape it is about.
- `loam validate --service <id>` now reads the whole `architecture/` project, exactly as `--all`
  does, instead of `architecture/landscape.likec4` alone. A use-case file under `architecture/` that
  does not parse therefore reports `spine.landscape-invalid` on a single-service run too, where it
  used to be visible only under `--all`. `c4.declaration-diverged` compares against that same
  project.
- `c4.invalid` and `c4.valid` keep their codes and change scope with the shape. For an extending
  model every error the per-service project raises is the MODEL's — including one the parser blames
  on `architecture/landscape.likec4`, because the map parses clean on its own — and `c4.valid`'s
  message reads `extends the fleet map — N elements · M relationships`. When the map itself does not
  parse, an extending model cannot be read at all: neither code is emitted for it, and
  `spine.landscape-invalid` carries one clause more saying the model extends the map and so cannot
  be read either.
- `landscape.service-unmodelled` is raised on the `--service` target too, and stays an error. An
  EXTENDING `model.likec4` says what is inside an element the fleet map binds, so a service whose
  directory no map element resolves to has nothing to be inside and no count in the model means
  anything: `loam validate --service <id>` reports it and exits 1 where the same tree used to come
  back `c4.invalid` for a model read alone. `/loam-check`'s `--service` table carries a row of its
  own for it and `loam explain landscape.service-unmodelled` answers for both scopes. A standalone
  model is unaffected — the fleet run still owns that state.
- `subsystem.view-id-collision`'s census covers every extending model's authored view ids under
  `--all`, not the landscape's alone: those documents are in the same root project now, and a view
  id claimed twice there makes the renderer refuse the whole project.
- `spine.landscape-invalid` names the document that actually broke. The finding is raised against
  the whole `architecture/` PROJECT and the message hardcoded `architecture/landscape.likec4`, so an
  `architecture/usecases/x.likec4` with a typo sent every service's reader to a file that parses and
  the real path appeared nowhere in the payload. The message now lists the broken documents
  repo-relative and comma-separated — the spelling `landscape.invalid` already used under `--all` —
  each `details` line carries its own file once two or more are broken, and `locations` carries the
  first broken file as `primary` beside the service directory as `scope`. `loam explain`'s "fix the
  file the message names" is true now.
- `c4.declaration-diverged` finds the copies it was written for. It joined on the literal element
  id, so in a GROUPED map — one nesting its services under a parent, as loam's own example does — a
  standalone model's `paymentService` never met the map's `marketplace.paymentService` and the check
  was silent on the shape it exists for. The join is now the id; then the `metadata { service }`
  binding when both documents wrote one; then the map element whose id ends with the model's as a
  dotted tail. A tail two map elements answer to joins nothing — a divergence reported against the
  wrong peer is worse than the silence. The message names the other side as `the fleet map
  (architecture/)` rather than a file it never read, and names the map's own id when it differs.
- `c4.declaration-diverged` no longer joins a standalone model's `db`, `api` or `agent` to a
  container the map draws INSIDE another service. The dotted-tail rung stands, and a tail that
  carries a dot (`paymentService.api` ↔ `marketplace.paymentService.api`) is joined as before; the
  BARE last segment is now a key only for a FLEET-LEVEL map element — one no ancestor of which
  stands for a service, which is a top-level element and equally a box the map draws inside a plain
  grouping element, by the same fleet-census predicate every other fleet check asks. Grouping is a
  drawing convenience, not ownership: a `cache` the map draws inside an `infra` group is the FLEET's
  cache, so a standalone model that declares its own top-level `cache` gives one name two meanings
  and is reported. Only a SERVICE owns an interior. What a repo notices: a private cache called
  `db` beside another service's `db` was warned about and told to copy that service's title
  verbatim; it is now silent. loam's own `meta/docs` carried the workaround for it, and no longer
  does — its `coding agent` element is spelled `agent` again.
- `c4.declaration-diverged` stops asking for a copy that is already there — in both directions.
  Since LikeC4 1.59.0 a kind can carry tags and every element of that kind arrives with them, so a
  tag difference can be one no element declaration writes and no copy can fix. loam now decides that
  by SIMULATING the copy rather than by matching one shape of it: when the tag sets are all that
  differ and copying the map's literal tags across would leave them still differing, the message
  says so, names `specification { element <kind> { … } }` as where they come apart, and says WHICH
  document declares tags on that kind, so an author knows which file to open. Both shapes reach it
  now: the model writing `#external` on an element whose map twin inherits `#external #platform`
  from `element topic { … }` used to be told to copy the map's bare line, and doing exactly that
  produced the other arm of the same message (measured on `examples/docs`' order-service). Grammar:
  "the kind differs" / "the title differs" / "the tags differ".
- Three messages say what they could not say before. `c4.invalid` on a model written in BOTH shapes
  at once — an element kind declared in `specification { }` beside an `extend` — gains one `details`
  line saying the kind is what makes the file standalone, so the `extend` resolves nothing, and
  which of the two lines to drop. `usecase.flow-invalid` whose project refuses an undeclared
  `#req-`/`#cap-` tag gains one line naming the `tag <name>` declaration that is missing and the
  `specification { }` block it belongs in. And `c4.valid` gains ` · K tagged flow(s) graded` when
  the service's own project declared any, so a HEALTHY intra-service flow is visible on one surface
  instead of none. Both hints are the FIRST `details` line rather than the last: the cap is ten
  lines in text and in `--json`, and a model written in both shapes at once produces dozens of
  cascading errors, so the one line that diagnosed it was truncated away in exactly the case it
  exists for.
- A `.likec4` beside `model.likec4` that the service's own `likec4.config.json` `exclude` covers is
  no longer read, graded or reported. loam staged every sibling regardless, so a file the renderer
  never loads earned `usecase.flow-invalid` under a message claiming the project is read the way the
  renderer reads it. Standalone models only — that file IS the project config there; a model that
  extends the map is read in the root project, and a per-service config beside it is
  `service.likec4-config-stray`. The RECURSIVE spelling counts too: a leading `**/` compiled to a
  required `/`, so `**/usecases/**`, `**/views.likec4` and `**/*.likec4` matched nothing while the
  renderer (measured, likec4 1.59.2) hides exactly what they name — `usecase.flow-invalid` gated the
  run at exit 1 over a file in no project loam was reading.
- `spine.landscape-invalid` says "a, b have N error(s)" when it names more than one document; it
  read "a, b has N error(s)".
- `c4.element-unowned` leads with the remedy that fits a private store. The message listed the two
  remedies that move an element OUT of the service — the map, or another service's model — and
  omitted the one an author usually wants: a store or component this service owns goes INSIDE the
  `extend <fqn> { }` block, where its id becomes `<fqn>.<name>`. Following what the tool printed
  moved a private store to fleet level and earned `landscape.service-undocumented`.

### Added — problem reports carry an ordinal and a status, and `loam doctor` counts them

- The `loam-report` protocol (`loam instructions loam-report`) names its file
  `loam-reports/NNN-YYYY-MM-DD-<short-slug>.md`: `NNN` is an ordinal of at least three digits,
  zero-padded, one
  more than the highest already in the directory, `001` over an empty or absent one, widening past
  three digits rather than reusing a number, and the
  protocol tells the agent to read it from `loam doctor --json` rather than count the directory
  itself. A path that already exists is a concurrent report claiming that ordinal — take the next
  one; the collision suffix is gone. That check is on the PATH while the promise is about the
  ordinal, so the protocol also tells the agent to re-run `doctor` after writing: two entries
  sharing an ordinal means the later `Recorded` renames to the next free one.
  The directory is `loam-reports/` beside the `loam.json` that resolved
  (else beside the directory the agent runs in) — `reports.dir` carries it WITH that segment on the
  end, so it is written into rather than joined onto — the ordinal is unique within it, and a
  report is cited by
  ordinal — in a commit message, an issue or another report's cross-references — never by filename.
  The document template gains `- Status: open` directly after `- Classification:`, with the
  vocabulary `open` / `sent` (handed to the author — the person forwarding a report sets it, never
  the agent writing it) / `fixed in <version>` / `superseded by <NNN>`; a report is closed by
  editing its own `Status` line, and there is no index to keep in step with it. Every safety
  sentence is unchanged: `<redacted>`, "Never re-run" a writer, "do not upload", and the section
  headings.
- `loam doctor --json` gains one additive key, `reports`: `reports.dir` (the absolute path of the
  `loam-reports` directory beside the `loam.json` that resolved — and, when a `loam.json` was FOUND
  but could not be parsed, beside that file, which is the same root `agents` is inspected against;
  only where no config file exists at or above the run directory does it fall back to the run
  directory. The last segment is ON it, so the protocol writes inside the path rather than
  joining the name a second time), `reports.present`, `reports.total`, `reports.next` (the ordinal
  the next report takes, padded
  to at least three digits and widening past them, `001` when there is none), and `entries[]` —
  every `*.md` in the directory
  sorted by the ordinal its name claims, numerically, with unnumbered legacy names last (byte order
  stopped being report order at exactly the width the ordinal widens to: `1000-…` sorts before
  `998-…`), each carrying `file`, `ordinal` (the leading three-or-more-digit ordinal,
  `null` for a name written before the numbering, including the `YYYY-MM-DD-…` shape) and
  `status` (`open` | `sent` | `fixed` | `superseded` | `unstated`, read as the first word of the
  `- Status:` line in the report's HEADER FIELD BLOCK — the lines above the first `##` heading,
  quoted code skipped in BOTH markdown spellings, fenced and indented, so a report quoting the
  protocol's own template counts as whatever its own header says — and `fixed in 0.2.0-alpha.5`
  counts as `fixed`). The
  human view prints one row after `agents`:
  `reports       loam-reports/ 12 · open 3 · sent 5 · fixed 3 · superseded 1 · next 013` — zero
  counts omitted, the total always shown, `reports       (none)` when the directory is absent or
  empty.
- Reading it is best-effort and emits no finding: an unreadable file is an entry with status
  `unstated`, an unreadable directory is `present: true` with `total: 0`, and a status word this
  vocabulary does not know is `unstated` rather than a sixth bucket. No new code is emitted and
  `doctor`'s `healthy` does not move for anything in the directory — an open report is not a
  defect in the repository holding it. Reading stays local: nothing is transmitted, which is the
  constraint the protocol is built around.
- AGENTS.md's support paragraph now says reports are numbered and that `loam doctor` counts the
  directory and says which ordinal is next.
- What a repo notices: `loam doctor` prints a `reports` row it never printed before — `(none)`
  on a repository that has never written one — and `loam doctor --json` carries a `reports` object
  beside `agents`. Existing reports keep their names and are counted as `unstated` with no
  ordinal until someone renames them and adds a `Status:` line; the next report an agent writes
  lands as `loam-reports/001-…` in a directory of legacy names, because `next` is one past the
  highest ordinal present and a `YYYY-MM-DD-…` name has none.

### Added — the adopt brief on an edgeless landscape element

- `loam adopt --service <id> --json` gains two additive keys under `landscape`: `landscape.touched`
  — `true` when at least one edge in the `architecture/` project has an endpoint resolving to
  the service (an intra-service edge counts: the predicate `loam context` prints as "(modelled, no
  edges touch it)"), `null` whenever `landscape.modelled` is `null` or `false` — and
  `landscape.attested`, the calls the service's own `model.likec4` declares across its boundary
  (`direction`, `counterpartId`, `counterpart`, and `title` / `op` / `publishes` / `consumes` where
  the edge carries them), sorted and de-duplicated, `[]` when the model is absent, does not parse,
  or declares none, and read only in the edgeless state. `landscape.modelled` and
  `landscape.elements` are now decided by the same element→service resolver `validate --all` grades
  `landscape.service-unmodelled` on: a container titled like a sibling service, nested inside an
  element bound to another service, resolves to its ancestor — so `loam adopt` reports such a
  service `modelled: false` where it reported `true`, which is the answer the fleet run was already
  giving.
  `landscape.instruction` is no longer `null` on element existence alone: while an element resolves
  to the service and no edge touches it, the brief names each attested call and asks for it as ONE
  edge on the existing element, collapsed to the service and naming the other party as the map
  already spells it — or, with nothing attested, points at the walk's outbound and message stops and
  says draw NOTHING rather than invent an edge — and names the element's tags loam does not read (a
  placeholder such as `#provisional`, and the view written `exclude element.tag = #<that>` that
  keeps an adopted service hidden). The `architecture/landscape.likec4` target is back in that state
  with `action: "edit"`, `required: true`, a shape refusing a second element and an edge-only
  example. The text view prints the instruction under "what the fleet already says about this
  service" and flags the row `EDGELESS` ("an element exists, no edge does") instead of `UNDRAWN`.
  Until now `loam seed --from fleet.yaml` left every service absent from `calls:` as a bound,
  edgeless element the brief then declared finished.
- New `landscape.service-isolated` (warn, never gating, `--all` only, on the landscape target,
  `subject` the service id): an element resolves to `services/<…>/<svc>/`, no edge anywhere in the
  `architecture/` project touches it, and that service's `model.likec4` parses and declares at least
  one call across its
  boundary — the message names the first three. Evidence-gated on purpose: silent for a service with
  no model (a seeded fleet), an unparseable model (`c4.invalid` owns it), a model reaching nothing,
  an unmodelled service (`landscape.service-unmodelled` owns it), and a service the map already
  touches with ONE edge while its model attests five — the check is touched/untouched, not a set
  difference; `#external` elements are never
  subjects. It suppresses `landscape.matched` like every finding. The brief's `checks[]`, the
  `/loam-check` `--all` table and AGENTS.md's adopt step carry it; `/loam-adopt` step 5 states
  the silent cases and points at `landscape.touched` in step 1.
- One more statement in the adoption brief's unchecked list, now seventeen: whether an adopted
  service is VISIBLE on the fleet map — a placeholder tag that survives adoption, a curated view
  that lists its members by id, and `include *` collapsing to a boundary element
  (`include <boundary>.**`). `/loam-adopt` step 3 names that housekeeping as part of the landscape
  edit.
- `loam adopt --service <id>` reads the fleet map as the `architecture/` PROJECT — the landscape
  plus every other `.likec4` under `architecture/`, minus the generated `subsystems.likec4` — where
  it read `architecture/landscape.likec4` alone. It is the document set `landscape.service-isolated`
  already grades `touched` over, so `landscape.modelled`, `landscape.elements`, `landscape.inbound`,
  `landscape.outbound`, `landscape.expects`, `landscape.touched`, `landscape.attested` and
  `landscape.instruction` now answer about the same map `loam validate --all` does. What a repo
  notices: a fleet that keeps a second `model { }` block, a use case or a palette in a sibling
  `architecture/*.likec4` no longer gets a brief demanding edges it has already drawn —
  `touched: true`, `instruction: null`, and no eighth `architecture/landscape.likec4` target — where
  the fleet run on the same tree reported `landscape.matched`. The same widening makes
  `landscape.parses` false, and `landscape.modelled` `null`, when any document under `architecture/`
  fails to parse: the landscape file parsing on its own does not rescue a map the renderer cannot
  load. No key added, no key removed. The edgeless instruction names the element's home as "the
  fleet map (architecture/)" rather than a file it did not read — the WRITE still lands in
  `architecture/landscape.likec4`, and the target's `path` says so.
- The adopt brief's `model.likec4` example is headed with the service being adopted
  (`// order-service's own C4 …`) instead of the literal `payment-service` it carried for every
  service — one line above an `extend <fqn>` the brief already substituted, so the personalised half
  taught an agent the rest of the header had been personalised too. `<svc>` joins `<fqn>` as a
  placeholder the shape rules leave literal and `serviceBrief` fills in; the example never leaves
  either in the payload.
- What a repo notices: a drawn-but-edgeless service whose model reaches other systems gains one
  `landscape.service-isolated` warning per service on its next `loam validate --all` — under
  `--strict`, CI is red until an edge lands or the element is genuinely edgeless and stays so (a
  model attesting no cross-boundary call is silent); a seeded service nobody listed under `calls:`
  is briefed the edges instead of nothing.

### Added — a home for an intra-service use case

- A `dynamic view` over one service's own containers now has a slot loam reads and grades: any
  `.likec4` beside `services/<…>/<svc>/model.likec4` (`usecases/<name>.likec4` by convention,
  `views.likec4` read the same) or a tagged view inside model.likec4 itself — exactly the document
  set the per-service renderer project registers, read whether or not `likec4.config.json` exists.
  `loam validate --service <id>`, and `--all` per service, grade every view tagged
  `#req-<Requirement-ID>` with the codes the fleet target already uses: `usecase.step-unbacked`
  (error), `usecase.step-contested` (warn), `usecase.requirement-unresolved` (error — resolved
  against THIS service's spec.md and arch.spec.md ids, four arms), `usecase.capability-unresolved`
  (error — a `#cap-` tag beside a model is refused by placement, vocabulary or not) and
  `usecase.flow-invalid` (error — a sibling that breaks the service project; model.likec4 keeps
  grading alone, never `c4.invalid`). Untagged views are never graded, and an untagged sibling is
  not even loaded while no view in the project opts in and no sibling mentions either reserved
  prefix anywhere in its bytes; once loaded — a tagged view inside model.likec4 itself, or `req-` /
  `cap-` in a sibling's comment or title — a project that does not read is one
  `usecase.flow-invalid` whether or not any view in it opted in. A resolved service-local `#req-`
  feeds nothing else yet. The feature slot for such a flow is deferred (ROADMAP).
- Every surface that names a code for a `#req-` tag declared TWICE — once in the map's
  `specification` and once in a tags-only block beside the `extend` — now names the one loam
  actually emits. SCHEMA.md, `/loam-adopt` step 3 and `loam instructions loam-codes` all said
  `c4.fleet-project-invalid` (a warning); measured, the finding lands where the second declaration's
  FILE is: `c4.invalid` — an error that gates, suspends the model's grading and cascades six
  `covers.unknown` — when the tags-only block is inside model.likec4, and `usecase.flow-invalid`
  when it is in a sibling. `c4.fleet-project-invalid` is the fleet-scope class one step out: two
  SERVICES each declaring the same tag locally, which no per-service project can see. No behaviour
  changed; an agent routing on the printed code was being sent to the wrong severity and the wrong
  repair.
- Two corrections to the shared step graders, at fleet altitude too: a hop whose two endpoints
  resolve to ONE service is no longer backed by that service's internal edges on the service tier
  (measured: every internal relationship was a candidate, so an unbacked hop between two containers
  of one service graded attributed and could never earn `usecase.step-unbacked`); and
  `usecase.step-unlinked` no longer fires when the caller resolves to the provider — a service owes
  no operationId to itself, and that is the guard's whole scope: a hop from a service-local flow
  into another service's element still warns, exactly as it does on the fleet map. What a repo
  notices: a landscape that draws a service as containers with a tagged hop between two of them
  loses a wrong `usecase.step-unlinked` warning and may gain a right `usecase.step-unbacked` error;
  a service directory holding a tagged `dynamic view` beside its model starts being graded.
- `loam diff` no longer counts a service as a consumer of its own operation, on either half of the
  question. A landscape edge whose SOURCE and TARGET both resolve to the provider is the provider's
  own internal call — the rule `usecase.step-unlinked` already states — and so is a use-case hop
  whose two endpoints resolve to it; the edge half excluded nothing while the message half already
  did, so the downgrade this list promised could not be observed in the configuration it described.
  Both are excluded now, and it is: a removal whose only trace in the fleet is the provider calling
  itself reports `diff.op-removed` (warn) and the run exits 0, where it reported
  `diff.op-removed-consumed` (error, `breaking: true`, exit 1). A second service's edge naming the
  operation is still `diff.op-removed-consumed`.
- The adopt brief's `checks[]` gains six `--service` rows: the five above and
  `usecase.step-unlinked`, which the service target reports for a hop into a sibling's stand-in, and
  which `/loam-check`'s `--service` table now carries a row of its own for. The arch.spec.md shape
  names the hop-sequence slot; AGENTS.md's layout paragraph names the slot itself
  (`services/<…>/<svc>/usecases/*.likec4`) and the styling opt-in beside it.
- `loam explain` answers the right scope for the eight codes only a feature run raises. A markdown
  fix table ends at the first line that is not a `|` row, and nothing separated `/loam-check`'s
  `--feature <FEAT-id>` rows from the `--service <id>` ones sitting above them, so
  `capability.uncovered`, `capability.remove-requirement-realized`, `glossary.term-exists`,
  `usecase.flow-exists`, `deployment.doc-exists`, `deployment.doc-invalid`,
  `deployment.doc-reserved` and the feature/archive arm of `usecase.flow-invalid` all came back
  `scope: "--service <id>"` — a service run can raise none of them. They now read
  `--feature <FEAT-id>`. What a consumer notices: `entries[].scope` changes value for those eight
  in `loam explain <code> --json` and in `loam explain --codes --json`; the meanings and the fixes
  are unchanged, and no code was added or removed.

### Changed — the generated subsystem views join the repository's styling

Every view in the generated `architecture/subsystems.likec4` now carries `global style subsystems`
— written after its `title` and `description`, before its `include`/`group` — exactly when the
`architecture/` project (the landscape merged with every other `.likec4` under `architecture/` the
root `exclude` does not cover — a `palette.likec4` beside the map counts, and one under an excluded
path is loaded by nobody; the one
load `loam subsystem sync`, `validate --all` and `archive` share) declares a global style with the
id `subsystems`, in either form: `global { styleGroup subsystems { … } }` or
`global { style subsystems … }`. loam reads only that the id is declared — a census of the keys of
`$data.globals.styles` beside the view-id census in `core/c4/parsed/view-ids.ts` — and never what
the group says (docs/DESIGN.md rule 26). Nothing is written otherwise, and the file is
byte-identical to before. When the project declares style groups under other names only, one
comment line between the header and `views {` names them and says none is `subsystems`; there is
no single-group fallback, because a second group declared for a hand-drawn view would otherwise
switch the generated views' styling off on a change that touched no subsystem. Styling therefore
restales the generated file on two triggers, and `subsystem.views-stale`, `loam explain` and the
fix tables name both: declaring or removing the group named `subsystems` changes whether the views
carry the `global style subsystems` line, and declaring or removing a group under ANY OTHER name
changes the disclosure comment. What a repo notices:
a fleet that already declares a group named `subsystems` (or any group, for the disclosure line)
sees one `subsystem.views-stale` on its next `validate --all`, cleared by one `loam subsystem sync`.
`loam seed` renders the file from that same project — the landscape it is about to write, staged
beside every other `architecture/` document — so a palette kept in a sibling such as
`architecture/usecases/palette.likec4` is referenced by the seeded views and never a stale file
straight after a seed. No new code, flag or `--json` key. `LoadedDoc` gains the additive field
`globalStyles` (the sorted declared ids), produced alike by every loader and pinned by the three
parity suites; seven tripwire assertions in `test/likec4-view-shape.test.ts` pin the parsed shape
at likec4@1.59.2.

### Changed — the fleet's consumer census reads the models, not the map alone

- `landscape.datastore-private`, `landscape.datastore-shared` and `landscape.platform-candidate`
  count a consumer that a service's own EXTENDING `model.likec4` attests — an outbound call at the
  element or a descendant — beside the edges `architecture/` draws. Under the extending shape the
  container-level call lives in the model and only the service-level twin reaches the map, so a
  store whose consuming edges were all drawn in models had zero consumers and earned nothing at all,
  and a store reached by three models plus one map edge was reported `landscape.datastore-private`
  naming the single service the map happened to draw. Extending models only: their ids are the map's
  fully-qualified ids, so the join is exact, while a standalone model's ids are its own file's and
  are never matched to a landscape element. A model that does not parse, or cannot be read,
  contributes nothing.
- `landscape.datastore-shared` now fires for a NESTED store. A store sitting inside the element that
  resolves to its owner — declared there on the map, or added by the owner's extending model — is
  private by construction and silent at one consumer, and is graded at two: `subject` is the store's
  title as before, and the message adds ` — <owner>'s own store, written as '<fqn>'` beside the
  consuming services it names — the store's OWN id, since `<fqn>` IS the store and the earlier
  "nested under" sent a reader looking for a containing element of that name. The message then
  states the reversibility directionally: the two placements give the store the same id, but with a
  second consumer the move is one-way — out of the `extend` block onto the map is always safe, and
  back into it breaks every other consumer's edge.
  Until now the
  strongest coupling two services can have rendered perfectly and was graded nowhere, because the
  census only ever looked at elements drawn at fleet level.
- `landscape.datastore-private`'s remedy names the placement instead of a directory, and names it
  for the consumer's own model SHAPE rather than assuming one. For an EXTENDING consumer it says to
  write the store in that model's `extend <fqn> { … }` block, or inside `<fqn>` on the map when the
  map draws that service's containers. For a consumer whose model STANDS ALONE — or that loam could
  not read as extending — it says the map placement and offers the migration to the extending shape
  as the other arm, because `extend <fqn>` in a standalone model resolves nothing (such a model is
  parsed alone) and following the old sentence there turned a run with 0 errors into `c4.invalid`.
  Either way it states what happens next: a second service
  reaching the same data draws a container-level edge to `<fqn>.<name>` in its own model plus a
  service-level edge on the map, and loam counts that consumer — so the state is
  `landscape.datastore-shared`, never silence. It also states which of the two placements keeps that
  door open: the edge resolves only against a store the MAP declares, because a per-service project
  is `architecture/` plus one model. The old "or add the second consumer's edge" is gone as an equal
  remedy and survives as "if another service reaches the same data today, draw its edge and this
  becomes that warning now". It also states the measured reversibility with its condition — the two
  placements give the store the same id, `<fqn>.<store>`, and with one consumer either move is free:
  out of the `extend` block onto the map always is, and back into it while no other service's model
  or map edge names the store (measured on `examples/docs`: moving `db` out of order-service's `extend`
  block into `orderService` on the map left the model at 12 elements · 8 relationships, left
  `Covers: marketplace.orderService.db` in its `arch.spec.md` resolving, and left checkout-web's
  container-level edge to it resolving) — and it qualifies the "never silence" promise: a consumer
  whose model stands alone is not counted, because its ids are its own file's, so its edge belongs
  on the map.
- `landscape.datastore-private` and `landscape.datastore-shared` never take an element that stands
  for a `services/<id>/` as their subject, at ANY depth. The fleet-level half has always skipped
  one (a datastore bound to a directory is the binding checks' subject); the NESTED half did not,
  so a `database` carrying `metadata { service '<id>' }` and drawn inside another service's
  element became a store "owned" by its own binding, and one more reader made it
  `landscape.datastore-shared` — advising the team to give each service a private copy of a
  service. Both halves and the model-declared store census now share one `standsForService`
  predicate, handed down on the input record because a `fleet/map/` module may not import `fleet/`.
- `landscape.invalid`'s message generalises its hint. It spoke about use-case flows alone, so an
  author whose MODEL EDGE named a container was told to move a flow that does not exist. It now says
  that an unresolved name an extending model declares — a use-case hop or an edge naming
  `<service-fqn>.<container>` — renders for the renderer and resolves for nobody here, and that the
  repair is to name the SERVICE on the map and the container in that service's own model.
- `landscape.service-isolated` never takes an `#external` element as its subject. The claim rested
  on "an `#external` element is not an enumerated service", which is false for an element carrying
  the tag AND a `metadata { service '<id>' }` binding to a directory that exists: the input set had
  no tag filter, so a foreign box answered for one of our services. The isolation input SET now
  skips `#external`, matching `landscape.binding-duplicate` and
  `landscape.binding-unknown`. `landscape.service-unmodelled` keeps the unfiltered set — the
  directory IS drawn. The `touched` walk applies NO tag filter, deliberately: it answers a different
  question — does the map draw any edge on this service — and LikeC4 puts a kind tag on every
  element of the kind, so `element topic { #external }` (the idiom
  `examples/docs/architecture/landscape.likec4` documents) made an edge drawn from a service's OWN
  topic stop touching that service. The warning fired on a service the map demonstrably reaches
  while `loam adopt` reported `touched: true` on the same tree; the walk is the brief's
  `landscape.touched` predicate exactly, tag and all.

### Changed — the renderer wiring, measured rather than assumed

- `loam subsystem sync` now DELETES a `likec4.config.json` that sits beside a model which EXTENDS
  the fleet map, in the same journaled commit as everything else it writes, and `--json` `projects`
  gains `projects.removed` (POSIX paths relative to the docs root, sorted by path (not by service
  id — the survey's own order); `[]` on a run that removed none)
  beside `projects.created`. The text view prints one `removed <path>` line per file and one
  sentence saying why. The note this corrects said such a nested project was registered EMPTY and
  therefore harmless; measured on likec4 1.59.2 it CLAIMS the model — the workspace loads two
  projects, the model is Invalid inside its own one (the map's kinds are not in there with it) and
  `export json --project fleet` loses the service's containers wherever that nested project claims
  the model (measured both ways at the 1.59.2 pin: it did on a seeded fleet, and did not on
  `examples/docs`, where the root project kept the model — what happens in every state is that the
  docs root stops being a one-project workspace and `likec4 validate .` refuses without
  `--project`). A repo that migrated 56 models to
  `extend` and ran one `sync` kept 56 stray files and 57 projects; it now keeps one. A leftover
  beside a model that is GONE still stays — that one really is the team's, and a nested project
  holding no `.likec4` is silently absent from the renderer's list. `service.likec4-config-stray`'s
  message is rewritten to the measured consequence and now names a repair `sync` actually performs.
  `projects.current` narrows with it: it counts the services owed a project file that already had
  one, and a model that extends the map is owed none — so on the run that deletes the strays it
  drops by exactly the length of `projects.removed`, and every run after that reports the same
  number both spellings would have.
- `loam subsystem sync` no longer rewrites the generated views file when the map cannot be read.
  `action` gains the value `blocked`: with `architecture/` unreadable and
  `architecture/subsystems.likec4` already present, the run writes nothing about that file, prints
  the reason, and `--json` carries that action plus `blocked.reason` reading `landscape-invalid` —
  exit 0, because `loam validate --all`'s `landscape.invalid` is the gating surface. Before this,
  any load error rendered the tolerant shape: the file was rewritten down to title and description,
  losing the `global style subsystems` line, every `include` and the boundary comment, while `sync`
  reported `updated … 1 subsystem view(s)` and answered `current` ever after. The render also now
  falls back to the landscape FILE when only a SIBLING document breaks the project, so a duplicate
  `subsystems` group declared in two `architecture/` documents costs nothing. With no generated file
  yet, and inside a tree-changing verb's commit window (`new`/`move`/`rm`/`rename`, whose contract is
  that the file lands with the change), the tolerant shape is still written and the same one-line
  note is printed.
- The `architecture/` document set every reader shares now honours the root `likec4.config.json`'s
  `exclude`. A `.likec4` under `architecture/` the renderer never loads is no longer loaded by loam
  either: a palette under an excluded path used to yield a `global style subsystems` reference the
  fleet project could not resolve — `likec4 validate` Invalid on every run while `loam validate
  --all` reported 0 errors, `doctor` was healthy and `sync` said "current" — and a broken excluded
  document blanked the whole map. A root config loam cannot read an `exclude` list out of filters
  nothing.
- An `exclude` entry is now read the way the renderer reads it, measured rather than reasoned about.
  loam interpreted only a literal `/**` suffix, so a root config written `services/**/*`,
  `services/*`, `services/` or the bare `services/<tree>` hid every extending model with zero
  findings; the first repair of that read the entry as a walk over path SEGMENTS, which is not what
  LikeC4 does either. Measured at the 1.59.2 pin on a scratch fleet of five documents, by putting
  one entry in the root config and counting the "N files" `npx likec4 validate .` reports: a bare
  entry is a raw PREFIX with no end anchor (`services/pay` -> 3 files, hiding BOTH
  `services/payment-service` and `services/payments/payment-service`; `architect` -> 3, hiding all of
  `architecture/`), it must start on a `/` boundary (`ervices` and `ces/payment-service` -> 5, that
  is, nothing), `*` stays inside one segment while `**` crosses (`architecture/*.likec4` -> 4, so
  the nested use case survives; `*.likec4` -> 0), and a glob form does NOT prefix-match
  (`services/pay/**` -> 5). LikeC4 prefixes an entry that does not begin with a doubled star with
  one, joins it onto the project folder and matches with picomatch `contains: true` — the missing
  end anchor is that option. So `service.model-excluded` fires now, naming the entry verbatim, on
  every spelling including a starred middle segment; `service.model-unexcluded` no longer
  false-positives on a standalone model whose directory such an entry already covers; and
  `subsystem sync` takes back an entry that hides an extending model whatever its spelling — the
  write side asked "which directory does this entry name", which answers nothing for a starred
  segment, so `services/*/svc-b` hid a model forever while `service.model-excluded` named that same
  command as the repair — and appends nothing for a directory the surviving list already covers.
- The root `exclude` filter on the `architecture/` document set now has a floor:
  `architecture/landscape.likec4` stays in the set whatever the list says. Without one, an entry a
  team writes for a palette (`architecture/*.likec4` covers both) left the architecture project
  holding ZERO documents — and an empty project parses with zero errors, so every reader took it for
  "the map declares nothing". On a seeded two-service fleet that produced four errors, all false:
  `landscape.service-unmodelled` twice, naming the very file that models both services and telling
  the reader to add an element already in it, plus `c4.invalid` on the extending model; and
  `loam subsystem sync` answered `updated` and rewrote a good generated file down to a title, with
  no line in either run mentioning the `exclude` entry that caused it. loam now grades one document
  the renderer may skip rather than asserting a fleet's whole architecture says nothing.
- `loam subsystem sync` answers `blocked` whenever the `architecture/` PROJECT does not parse, not
  only when `architecture/landscape.likec4` itself is unreadable. The landscape-file fallback that
  saves the element join says nothing about the STYLE CENSUS — a palette may live in any `.likec4`
  under `architecture/` — so a run made while an unrelated sibling was broken reported `updated`,
  deleted the `global style subsystems` line from a good generated file, answered `current` ever
  after, and never earned `subsystem.views-stale` while the map stayed invalid. The file is now left
  byte-identical in that state and the note names what was unavailable.
- `loam subsystem sync --json` carries `projects.exclude.unreadable` (boolean, emitted on every
  run). `entries: []` alone collapsed the two answers loam insists must stay apart: "the root
  project excludes nothing" and "loam could not read an `exclude` list out of the root file". The
  text view has always had a note for the second; a machine consumer reading `entries: []` got the
  opposite of the truth about what the renderer will load. Additive, beside `projects.exclude.removed`.
- `loam subsystem sync`'s "— nothing to write." tail is dropped when the run rewrote the root
  `likec4.config.json`'s `exclude`. It counted only the per-service project files created and
  removed, so a run with a current views file printed "nothing to write." immediately above the line
  reporting the rewrite.
- `c4.fleet-project-invalid` now enumerates what the renderer actually loads. The document set is a
  walk of the docs root — everything the root `exclude` leaves, minus the generated
  `architecture/subsystems.likec4`, minus every standalone service directory (owned by
  `service.model-unexcluded`), minus `features/` (a delta carries its own `specification` and the
  directory is transient). A `.likec4` in a SUBSYSTEM directory — the parent of service directories
  — was in none of the three roots the check used to merge: `validate --all` came back
  byte-identical to baseline and never named the file while `npx likec4 validate --project fleet .`
  reported Invalid over the same tree. The finding also gains `locations` (the file the error is IN,
  not `architecture/landscape.likec4` on every one of them) and `details`, and its tail now names
  the failure it actually is — a double declaration, an unresolved reference, or neither — instead
  of always blaming a double declaration.
- Every LikeC4 line number loam prints is 1-based, the way an editor counts — and deliberately NOT
  the way `likec4 validate` prints it, which passes the LSP range's start line through and so says
  `Line 8` for a fault on line 9.
  `c4.invalid`'s details said `L3` for an error on line 4; `c4.fleet-project-invalid` printed
  `model.likec4:0` for a declaration on line 1; and the feature arm of `usecase.flow-invalid`
  printed no line at all and an ABSOLUTE Windows path into loam's own staging tree — it now spells
  the authored file docs-relative with forward slashes and an `L<n>`, exactly as the service arm of
  the same code does, in the text view, in `--json` and in the `loam archive` block message.

### Fixed — the adoption brief answers off the document it actually read

- `loam adopt` no longer briefs a write to the shared fleet map when the map could not be READ.
  The eighth target (`architecture/landscape.likec4`) is emitted on `landscape.modelled === false`
  — a read that succeeded and found nothing — and on the edgeless state; `modelled: null` ("loam
  could not read the map", which since the `architecture/`-project widening includes a broken
  palette or use case beside a landscape that parses perfectly) now emits no target at all.
  It used to fall through the same gate as "the map draws nothing for this service", so the brief
  handed an agent the UNDRAWN block — "add one top-level element bound to its directory" — for a
  service the map already declares and binds, and splicing it earned `landscape.binding-duplicate`.
  `landscape.instruction` carries the whole answer instead and names the documents that failed.
- `loam adopt`'s fleet-map instruction and the text view's landscape headline no longer name
  `architecture/landscape.likec4` as the broken file when the document that failed is a SIBLING
  under `architecture/`. The instruction now names the failing documents docs-relative with their
  error count — the same spelling `validate --all`'s `landscape.invalid` prints — and the headline
  says `The fleet map (architecture/) does not parse — fix that first; the files are named below.`
  The brief and the fleet run on the same tree used to blame two different files.
- `loam adopt` no longer marks `openapi.yaml` required because a document beside the fleet map
  broke. The API question is answered off the landscape FILE (`landscape.callersKnown`, added to
  `--json`: true when the `architecture/` project parses, and true when it does not but the
  landscape file does), which is the evidence `loam list` and `loam context` already read: a broken
  `architecture/palette.likec4` used to flip `openapi.yaml` from `create missing` to
  `create MISSING` for a browser UI the map proves nobody calls, and told the agent to write an API
  contract for it. With the landscape file itself unreadable the contract is still owed.
- `loam adopt`'s model.likec4 example prints a short `<your-element-id>` where loam has no id to
  substitute, and carries the reason once as a `//` comment above the block. The placeholder used
  to be a 103-character English sentence spliced into all three code positions `<fqn>` occupies —
  the `extend` line, the source of a container edge and `view of` — on the command's most common
  invocation, a brand-new adoption.
- `loam adopt`'s arch.spec.md shape rule named `c4.fleet-project-invalid` (warn, `--all`) for a
  `#req-` tag declared both in the map and beside the model. Measured, that is `c4.invalid` (error,
  and the model's grading is suspended behind it) when the tags-only block is in model.likec4 and
  `usecase.flow-invalid` when it is in a sibling; `c4.fleet-project-invalid` is the fleet-scope
  class one step out, two SERVICES each declaring the same tag locally. The rule now says so, and
  matches the same statement in SCHEMA.md.
- `loam adopt`'s model.likec4 shape rule for `c4.element-unowned` leads with the nested remedy —
  a store or component this service OWNS goes INSIDE the `extend <fqn> { }` block, where its id
  becomes `<fqn>.<name>` — before the two existing arms, matching the `--service` fix table and
  SCHEMA's grades table.
- `loam adopt`'s `landscape.invalid` check description said "architecture/landscape.likec4 exists
  but does not parse". It now says the `architecture/` PROJECT does not parse — the landscape or
  any `.likec4` beside it — and that the message names the document that broke.

### Fixed — one tree, one answer: the gate's preview, and the map's other readers

- The merge preview every feature-side gate reads is now routed exactly as `loam archive` routes:
  the fleet's extending models reach it, so an addition the delta nests inside a service is
  previewed in that service's `model.likec4` and not on the map. Without them the preview held
  interior the archive puts somewhere else, and `usecase.flow-invalid` — the gate `--approve`
  cannot override — failed open on the one shape it exists for. Measured on a copy of
  `examples/docs`: a feature nesting `cache` under `marketplace.orderService` and hopping
  `checkoutWeb -> marketplace.orderService.cache` from `features/<FEAT>/usecases/` passed
  `validate --feature`, archived at exit 0, and left a fleet whose next `validate --all` reported 7
  errors — one `landscape.invalid` plus one `spine.landscape-invalid` per service — against a file
  its author never wrote. The gate now refuses before anything is written, `validate --feature`
  gives the same verdict, and a flow hopping between elements the map itself draws still archives.
  `deployment.doc-invalid` is wired the same way and had the same hole.
- `loam context <service>` reads the fleet map as the `architecture/` PROJECT — the landscape
  merged with every use case, palette and second `model { }` block beside it — never
  `architecture/landscape.likec4` alone. Two commands answered opposite things about one tree:
  measured on a two-service fleet with a broken `architecture/palette.likec4` beside a landscape
  that parses, `loam adopt --service order-service` reported `parses: false` and refused to say
  anything about the map, while `loam context order-service` reported `parses: true`,
  `modelled: true` and listed the map's edges — and an agent handed both has no way to tell which is
  right. `landscape.present` is still a fact about the FILE; `landscape.parses` is now a fact about
  the project the renderer loads, so a broken sibling reads here as "nobody could look", the answer
  `validate --all` and `adopt` already gave. The second load of that same project the deployment
  slice used to make when the landscape file declared no `deployment { }` block is gone with it: one
  parse, one answer.
- `loam seed` computes the generated views file's style census from the `architecture/` documents
  the root `likec4.config.json`'s `exclude` leaves, not from a raw walk of the directory. A
  `palette.likec4` under an excluded path is loaded by neither the renderer nor `validate --all`,
  yet seed read it and wrote `global style subsystems` into `architecture/subsystems.likec4` — a
  name the fleet project cannot resolve, written by the command whose own `next` line is
  `loam validate --all`. The same defect one command over from the one the exclude filter fixed in
  the loader. The fleet use-case scan's cheap tag gate was corrected with it: it walked
  `architecture/` for itself, which could only over-scan (it is a prefilter before a load that does
  apply the exclude), but two lists that disagree about what the project is are two answers waiting
  to drift.
- `landscape.invalid`'s head reads `<documents> have N error(s)` once more than one document broke,
  matching `spine.landscape-invalid`. The named list is comma-joined when the `architecture/`
  project has errors in two files, and the fleet line said "a, b has 4 error(s)" directly above the
  service line saying "a, b have 4 error(s)" about the same two files — one report, two spellings of
  one fact.

### Fixed — a second verification round: what the archive routes, and what every message names

- `loam archive` no longer refuses a delta written in the legacy title-join spelling inside a group
  the map declares. Routing an addition into a service's extending model now requires the delta to
  spell the whole parent chain in the MAP's own ids — a living element, a container an extending
  model already declares, or a declaration this same delta adds — instead of only requiring that
  *some* ancestor be living. A grouped map (`marketplace = group { … }`, the shape
  `loam init --example` ships) made the old guard pass on `marketplace.orderSvc`, the addition was
  written as `extend marketplace.orderSvc` — an id the map has never declared — and the model's
  parse net refused the whole archive with `merge-failed` and nothing written. What a repo notices:
  such a delta merges onto `architecture/landscape.likec4` under the map's own id and exits 0 again,
  exactly as it does when the service's model is standalone or absent. The documented remainder is
  unchanged: a title-joined parent keeps the map path.
- A service a feature INTRODUCES now keeps its interior out of the fleet map when its directory
  already holds an extending model. The new element's containers arrive inside its authored bytes and
  carry no feature tag of their own — LikeC4 does not inherit tags, so nothing in the addition set
  could see them — and they rode onto the map: `loam adopt --service <svc>` then told the team to
  write the same container into `extend <fqn> { }`, and the renderer reported a duplicate element
  blamed on both files while the service graded `c4.invalid`. Now the box lands on the map without
  its interior, the children are spliced into the model's `extend <fqn> { }` block (created if
  absent), and `loam archive` prints the second
  `architecture: merged into services/<…>/model.likec4` line for it. A service arriving with no
  directory at all, and one whose block also draws an internal edge between its own containers, keep
  the previous behaviour byte for byte — an edge written inside the block names its endpoints by
  their local names and there is no legal split, so the block rides whole. That is ONE decision and it covers the whole block: a child or an edge
  the delta tags with the feature rides with a block that rides and is spliced with a block that
  splits, never placed twice. While the two were decided separately the tagged child landed in both
  documents and the merge refused itself, `merge-failed`, on a delta neither half was wrong about.
- Both C4 merges now splice with the target document's own line endings. A CRLF
  `architecture/landscape.likec4` or `services/<…>/model.likec4` came back with a handful of bare-LF
  lines in the spliced region, and a CRLF delta's blank lines arrived carrying the target indent as
  trailing whitespace. A document with one convention keeps it; a document that is already mixed is
  left alone, because there is no convention to match.
- `landscape.datastore-shared` and `landscape.datastore-private` now state the reversibility of a
  private store's placement **directionally**, because the unconditional clause was false in every
  state `datastore-shared` prints in. The two placements do give the store the same id
  (`<owner-fqn>.<store>`), but the move is only free one way: out of the owner's `extend` block onto
  the owner's element on the map is always safe, and back INTO the `extend` block breaks every other
  consumer's edge — `c4.invalid` on that service's model, or `landscape.invalid` when the edge is
  drawn on the map — because a per-service project is `architecture/` plus one model, so an `extend`
  block is visible to its own service's project alone. `datastore-shared` needs a second consumer to
  fire, so the state it prints in is exactly the state in which map→extend breaks; `datastore-private`
  has one consumer, so it says both moves are free *today* and names the condition that ends that.
- `landscape.datastore-private`'s no-model arm offers a model to WRITE, not one to migrate: with no
  `model.likec4` at all it now says "write an extending model at `<path>`" one sentence after saying
  loam read no extending model there. The STANDALONE arm still says "migrate the model", which is
  correct for it.
- `landscape.service-isolated`'s message names the fleet map rather than one file: "no edge in the
  fleet map (architecture/) touches it". The check's input is the `architecture/` PROJECT — an edge
  added to `architecture/extra.likec4` and never to `landscape.likec4` silences it, measured — so the
  message now agrees with SCHEMA, with `loam explain landscape.service-isolated` and with the adopt
  brief, all three of which already said "anywhere in `architecture/`".
- `loam doctor` prints LikeC4 line numbers 1-based, through the same `errorText` helper every other
  surface uses. `doctor.landscape-invalid` hand-rolled its own `(line <n>)` spelling and passed the
  LSP range through raw, so it named the line above the fault and disagreed with `validate --all`
  about one error on one tree. The message now reads
  `architecture/landscape.likec4 does not parse: L<n>: <message> — and N more`.
- `loam context --json` and `loam explore --json` gain `landscape.broken`: the `architecture/`
  documents that failed, docs-relative POSIX, deduped and sorted, `[]` while `landscape.parses` is
  true. Spelled exactly as `landscape.invalid` and the adopt brief spell them, so the three surfaces
  name one file one way. Both commands read the `architecture/` PROJECT, so the document at fault is
  very often a sibling beside a landscape that reads perfectly.
- The adopt brief no longer promises a warning that cannot fire. On an element carrying `#external`,
  the edgeless instruction and the `landscape.likec4` target's shape rule say that
  `landscape.service-isolated` will NOT fire (the check removes every `#external` element from its
  subject set), that this brief is the only place the state is named, and that dropping `#external`
  makes the check apply again. Every other tree keeps the previous sentence.
- The adopt brief's `checks[]` row for `c4.declaration-diverged` names "the fleet map
  (`architecture/`)" instead of `architecture/landscape.likec4`. The map is a project; LikeC4 hands
  back no source document for an element, and the finding's own message and `loam explain` already
  refused to name a file.
- `loam adopt --json`'s `landscape.inbound`/`landscape.outbound` drop an edge whose two endpoints
  resolve to the SAME service — a service's own internal wiring drawn on the map made it its own
  caller. `landscape.touched` is unchanged: it is now read off the map's relationships rather than
  off those two lists, so it still counts an intra-service edge and still matches
  `landscape.service-isolated`'s predicate exactly.
- The service arm's use-case findings (`usecase.step-unbacked`, `usecase.step-unlinked`,
  `usecase.requirement-unresolved`, `usecase.capability-unresolved`) carry the flow FILE as
  `locations[0]` with role `primary` and the service directory beside it as `scope`. They carried the
  service directory alone, so a `--json` consumer had to parse the prose to learn which `.likec4` to
  open. `usecase.flow-invalid` on the same arm already named its file.
- `usecase.flow-invalid`'s undeclared-tag hint tells a `cap-` author the placement rule instead of a
  declaration that cannot help: a capability is claimed at fleet altitude, so declaring `tag cap-…`
  beside a model makes the file parse and earns `usecase.capability-unresolved` on the next run. The
  `req-` hint is unchanged.
- The services tree walk never classifies a service's own reserved subdirectory (`adrs`, `usecases`,
  `ui` — SCHEMA's service layout) as a service or a subsystem. Writing the documented
  `services/<id>/usecases/<name>.likec4` slot into a directory holding no artifact FILE used to make
  the walk read `usecases` as a service and its parent as an unmarked group: three errors
  (`subsystem.unmarked`, `landscape.service-unmodelled` for `services/<id>/usecases/`,
  `landscape.binding-unknown` for the real service) earned by following the instruction `loam init`
  had just scaffolded. Such a directory is also not counted when deciding whether a directory is a
  group, so a real service filed beside a reserved slot still refuses with `subsystem.unmarked` and
  is still named.
- `loam` now strips a leading UTF-8 byte-order mark before parsing the root `likec4.config.json`.
  PowerShell's `Out-File` writes one by default, so a Windows shell saving the file loam itself wrote
  left every `exclude` grade silent while the renderer went on applying the list (measured:
  `npx likec4 validate .` at 3 source files of 8 with `services/**` in force, `loam validate --all`
  at 0 errors and `doctor` healthy). A rewrite through `loam subsystem sync` drops the mark.
- `service.model-excluded` asks the FILE question too. An `exclude` entry shaped like a file
  (`services/**/model.likec4`, `**/model.likec4`) hides a model as thoroughly as one naming its
  directory, and nothing said so: on `examples/docs` such a line took the renderer to 3 source files
  of 8 while `loam validate --all` printed the string "exclude" not once. It is reported now, with
  the repair that fits it — `loam subsystem sync` maintains only the `services/` directory entries,
  so the file shape has to be narrowed or deleted by hand, and the message says which shape you have.
- `loam seed` no longer overwrites a hand edit written ABOVE the scaffold's landscape stub.
  `isLandscapeStub` matched with `endsWith`, so anything a person put before the stub was invisible
  to the guard: a two-line "OWNED BY THE ARCHITECTURE GUILD — do not regenerate" header was replaced
  without a word while seed printed "replaced the scaffold's untouched stub", against its own refusal
  text ("Seed never overwrites human work"). The suffix match existed for exactly one prefix — the
  comment preamble `migrate-openspec` stages above the identical stub, closed by a bare `//` line —
  so that is now the only prefix accepted, at every scaffold generation. What a repo notices:
  `loam seed` refuses with `seed-landscape-edited` and writes nothing, and `loam status` calls such a
  map `authored` rather than `stub`. A repo staged by `migrate-openspec` still seeds.
- `loam doctor` counts the report corpus that is there when the config is the thing that is broken.
  Read from a SUBDIRECTORY of a repo whose `loam.json` does not parse, it used to report
  `total 0, next 001` while naming the broken config's own path in the same envelope — handing out an
  ordinal five existing reports already used. `doctor` is the preflight that runs precisely when the
  config may not resolve, so `reports.dir` now resolves beside the `loam.json` it FOUND.
- `/loam-check`'s `c4.fleet-project-invalid` row spells the `details` format the finding emits:
  `<path>: L<n>: <error>`, with the colon after the path that the message's own head has always
  carried. The row promised `<path> L<n>: <error>`, so an agent splitting on the documented separator
  split in the wrong place.

## [0.2.0-alpha.5] - 2026-09-03

An adopted service's model renders from the docs root. Still a prerelease on the `alpha` line:
`npm i @ybotok/loam@alpha` installs it. Nothing below is breaking. What a repo with adopted services
NOTICES: one `service.likec4-config-missing` warning per service on its first `validate --all`
until one `loam subsystem sync`, and from that sync on `--project` for `likec4 validate` at the
docs root.

### Added — an adopted service's model renders from the docs root

The root `likec4.config.json` excludes `services/**`, and has to; what that cost was never stated:
an adopted service's `model.likec4` — the artifact `loam adopt` spends the most effort on — was a
box on the fleet map with nothing renderable inside it in the renderer opened at the docs root, and
the only documented way to see its containers was one `npx likec4 start services/<id>` per service.
One problem report; one file per service closes it.

- `loam subsystem sync` now writes `services/<…>/<svc>/likec4.config.json` beside every service
  `model.likec4` that has none, whenever the root `likec4.config.json` exists — **create-only**: a
  file that exists is yours and is never compared, rewritten or removed. Measured at the pinned
  likec4, a project file inside a service directory registers the model as a project of its own
  regardless of the root's exclusion, so `npx likec4 start` at the docs root shows `fleet` plus one
  project per service. Without the root file nothing is written and the text says `loam doctor`
  prints it. `subsystem sync --json` carries an additive `projects` key, `{ root, created, current }`
  — whether the root file exists, the repo-relative paths written this run (sorted by id), and how
  many model-bearing services already had one. `action` still describes
  `architecture/subsystems.likec4` alone.
- `loam validate --all` gains one warning per service, `service.likec4-config-missing`, on the
  `landscape` target with the service's tree path as its `scope`: `model.likec4` exists and the
  project file does not. Never an error, never gating, never in `--service`, `status` or `doctor`;
  the fix is `loam subsystem sync`, never a hand-written file. `doctor.likec4-config-missing`'s fix
  text now hands over to `sync` once the root file is written.
- The project name: the id with every `.` folded to `-` (LikeC4's name grammar refuses the byte),
  prefixed `service-` when that would equal the root project's `fleet` or LikeC4's reserved
  `default`; `title` is the id verbatim, and the title is what the renderer's picker shows. Not
  injective — an id spelled billing.core beside one spelled billing-core, or `service-fleet` beside
  `fleet` — and LikeC4 suffixes the later one `-1`; disclosed, never graded.

What a repo NOTICES on upgrade: one warning per adopted service on the first `validate --all` until
one `loam subsystem sync` — under `--strict`, CI is red until then; after that `sync`, N untracked
files (`sync` does not `git add` them) and `move-uncommitted` on the next `loam subsystem move` of
such a service until they are committed; from the first `sync` on, `likec4 validate` at the docs
root needs `--project <name>` (measured: with more than one project it refuses bare, while
`likec4 build` and `likec4 export` take every project and need no flag); and the renderer's project
list grows by one per adopted service, beside `fleet`. No command, flag, exit code or envelope key
changes; `projects` is additive.

## [0.2.0-alpha.4] - 2026-09-03

The view title becomes the subsystem's path. `0.2.0-alpha.3` was tagged and **never published** — it
was withdrawn before its publish step for a reason unrelated to the code — so this is the release
that carries both it and the entry below, and `npm i @ybotok/loam@alpha` moves from `0.2.0-alpha.2`
straight to this one. A repo upgrading from either reports one `subsystem.views-stale` until one
`loam subsystem sync`.

### Changed — a generated subsystem view is titled by its path

`0.2.0-alpha.3` gave each view the subsystem's own label. It now carries the whole path — every
marked ancestor's label and its own, joined with ` / `, so `services/platform/order-flow` reads
`Platform / Order flow`. Measured against the pinned likec4: the renderer reads that as a folder
path, so the view list mirrors the directory tree a human already navigates — one folder per
ancestor, the leaf's own label as the title — and two subsystems whose labels are equal are told
apart by their parents instead of appearing twice under one name. The box a view draws keeps the
subsystem's own label, unprefixed.

Because loam is now the one composing with `/`, it owns what a `/` inside an authored label would
do: measured, LikeC4 would show only the last segment and add a folder level the tree does not have,
so a slash in a marker's `title` becomes `∕` (U+2215) and the whole authored label stays visible as
one folder name. The alternative — a fixed `loam subsystems /` prefix — bought the same folder
without the churn and put loam's own name in a reader's UI; the tree's own words won.

Two costs, both real: the generated bytes move again, so a repo upgrading from `0.2.0-alpha.3`
reports one `subsystem.views-stale` until one `loam subsystem sync`; and renaming a PARENT's title
now rewrites the bytes of every view beneath it.

## [0.2.0-alpha.3] - 2026-09-03

The generated subsystem views, made readable — and the defect that hunt found underneath them.
Still a prerelease on the `alpha` line. **Not published (noted 2026-10-10):** the `v0.2.0-alpha.3`
tag was cut, but it was withdrawn before its publish step — the `0.2.0-alpha.4` section above says
so, and that release carries everything here — so `npm i @ybotok/loam@alpha` never installed this
version, and `npm view @ybotok/loam dist-tags` is the record of what does. Nothing below is
breaking, and one entry is a change every repo NOTICES: the generated file's bytes move, so the
first `loam validate --all` after upgrading asks for one `loam subsystem sync`.

### Fixed — a `subsystem.views-stale` no command could clear

`loam validate --all` grades `architecture/subsystems.likec4` against the whole `architecture/`
project — the landscape merged with every `architecture/usecases/*.likec4` — while `loam subsystem
sync` and the write verbs rendered it from `landscape.likec4` alone. One use-case document declaring
an element bound to a filed service was therefore enough to make `sync` answer `current` while
`validate --all` exited 1 with `subsystem.views-stale`, whose message names `sync` as the repair.
Reproduced on `examples/docs`; the two now read the same documents. No code, flag or payload key
changes.

### Changed — the generated subsystem views carry a label and a boundary

`architecture/subsystems.likec4` exists only to be rendered, and in the renderer its views were the
least readable objects in a docs repo: no title, so LikeC4 showed the hex-escaped id
(`subsystem_platform__order_2dflow`), and leaf includes only, so a fleet drawn as ordinary
grouped C4 rendered flat. Every view now carries `title` (the marker's, or the directory name) and
`description` when the marker authors one, and draws a boundary: the model's own containing element
when one holds exactly the subsystem's members, a `group '<title>'` mirroring the directory subtree
when the landscape nests nothing, and — when the members are nested but no element owns exactly them
— no box plus one comment line, `// model: no boundary — …`, which is loam's whole answer to a tree
and a map that disagree. Nothing grades that comment: placement still carries no policy.

Marker text is normalized to one line and escaped before it is written (measured: a raw `'` in a
title is two parse errors and blanks the fleet's whole map in the renderer; `Ops' } view evil {` is
zero errors and injects a view). [SCHEMA.md](SCHEMA.md) states the rules.

What a repo notices, and what it costs:

- the first `loam validate --all` after upgrading reports exactly one `subsystem.views-stale` error
  (exit 1) until one `loam subsystem sync` runs. `sync` does not `git add`, so the repair leaves one
  unstaged one-file diff to commit;
- the boundary depends on which OTHER services sit under an element, so an unrelated adoption or
  archive can flip a view from boxed to flat and restale the file. `loam archive` now withholds its
  "living spec + landscape are now complete + current" line, prints one warning naming
  `loam subsystem sync`, and adds `subsystemViewsStale: true` to its `--json` payload when it left
  the file behind;
- `subsystem.views-stale` and `subsystem.view-id-collision` now carry `locations`: the generated
  file (or `architecture/` when it does not exist yet) and the claimant document respectively. Both
  used to fall back to the landscape, sending an editor to a file with nothing to fix in it.

No command, flag, exit code, envelope key or stable code string changes; `subsystem.views-stale` is
not in the `IssueCode` union and carries no `gates` key, so `loam archive` remains unaffected by it.

## [0.2.0-alpha.2] - 2026-09-02

The deployment axis, and the two defects the axis surfaced on its way in. Still a prerelease on the
`alpha` line: `npm i @ybotok/loam@alpha` installs it. Nothing below is breaking, but two entries are
changes a repo can NOTICE — a fleet that had already placed a `#obl-` tag on a `deploymentNode`
starts seeing findings it was never shown, and `loam status` stops asking an architecture-only
feature for a business spec.

### Added — the deployment axis: topology joined to requirements

A LikeC4 `deployment { }` block has always been legal in a docs repo and was completely unread. The
parser resolved every `instanceOf`, and after that no requirement could name a node, no `#obl-` tag
on a datacenter was graded, and the context pack an agent implements from did not mention topology
at all. Five things change, and a fleet that draws no topology is unaffected by every one of them —
the axis opts in on the block's existence, the way the obligation vocabulary opts in on its file.

- **`Covers:` gains a fourth entry form.** `node:<id>` names a deployment node or an instance, and
  `node:a -> node:b` names an edge between them; both match literally. This is the form that lets an
  architecture requirement about replication name the two clusters it is written about, and a
  topology change that renames one now reports `covers.unknown` with the real ids offered — spelled
  with the prefix, because that is the line the author has to type. Both sides of an edge carry the
  prefix or neither; a bare id stays an element entry.
- **An obligation on a deployment object is graded.** `obligation.unknown`, `obligation.unapplied`
  and `obligation.uncovered` now walk the topology as well as the logical model. This is a
  behaviour change a repo can notice: a `#obl-` tag on a `deploymentNode` used to be invisible to
  every check, so a fleet that had placed one starts seeing findings it was never shown. A
  datacenter is owned by no service, so `obligation.uncovered` drops `subject` there and names the
  requirement's home in general terms rather than picking a team.
- **A feature can bring topology.** `features/<FEAT>/deployment/<name>.likec4` is a create-only
  document `loam archive` copies into `architecture/` and `loam unarchive` takes back — the third
  whole-file slot, beside `usecases/` and `glossary/`. Say `extend` in it to add to a region the
  living map already declares; two features may extend one region from documents of their own and
  both archive. Two new codes, both errors and neither overridable: **`deployment.doc-exists`** when
  the feature's document names a file the living tree already holds, and **`deployment.doc-invalid`**
  when it cannot be read against the map the feature's own merge would leave behind. The second is
  what makes the ordinary case legal — a document instancing a service only this feature's
  `delta.likec4` adds resolves, because the corpus inside a feature window is feature ∪ living — and
  refuses the case where the merge does not land what the document names. `delta.likec4` still
  refuses a `deployment { }` block and now names this slot instead of the living landscape.
  A third, **`deployment.doc-reserved`**, refuses a name loam owns inside `architecture/` —
  `subsystems.likec4`, `landscape.likec4`, or a path under `usecases/` — whether or not the target
  exists, because two of the three fail silently when it does not: nothing parses the generated
  subsystem views and `loam subsystem sync` overwrites them wholesale.
- **`loam context` carries the topology.** `--json` gains `living.deployment` — the service's
  instances, and the deployment edges touching them from either end.
- **One more statement in the adoption brief's unchecked list**, now sixteen: nothing here knows
  whether the second cluster exists, is reachable, or holds the data a requirement claims, and no
  check counts datacenters — how many a service needs is a decision the fleet writes down as a
  requirement, never one loam evaluates.

### Fixed — the never-overridable archive refusal names what actually refused

It said `N element binding(s) name an illegal service id` for every code in that register, and had
done since the use-case slot put a second one there — about features that bind nothing. The headline
now counts the refusals and the closing line names their codes; each issue keeps its own sentence.
The `--json` envelope is unchanged: consumers branch on `issues[].code` and `overridable`, which is
what that split exists for.

### Fixed — `loam status` no longer invents work for an architecture-only feature

A feature whose only requirement delta is `specs/<svc>/arch.spec.md` reported two things that were
not true, and both are corrected. The `spec` row read `missing` and `next.author-spec` told the
author to write business requirements the change does not have — while `loam validate --feature`
accepted the same tree at exit 0 and `coherence`'s `service.no-requirement-delta` stayed silent,
because every other reader counts the service DIRECTORY and not which corpus is in it. And the
`verification` row read `blocked` with `blockedBy: ["delta", "spec", "openapi", "asyncapi"]`,
telling the reader there was nothing to derive a checklist from — while `featureChecklist` reads
`arch.spec.md` and `loam verify` on that feature returns a real checklist.

The fleet form carried the same defect independently, and it broke the rule stated one line below
it in its own source: `loam status` with no feature reported `missing <svc>/spec` and staged the
feature `missing`, over a feature `loam status <FEAT>` called `ready`. Both forms now accept either
corpus as the service's requirement delta, and `<svc>/spec` is named only when neither exists.

Three payload-visible consequences, all in `loam status --json`: `artifacts[]`'s `spec` row is
`required: false` when the service's `arch.spec.md` delta exists (it was unconditionally `true`),
`arch-spec` now counts as a verification feeder, so `blockedBy` gained `"arch-spec"` in the
one case that is still genuinely blocked — a feature with no requirement delta of either kind —
and `features[]`'s `missing` and `stage` no longer report an architecture-only feature as
incomplete. No finding code, flag or exit code changes. This is the change to read if a script
branched on `artifacts[].required` or on `features[].missing`.

The case is the one `arch.spec.md` exists for: an outbox, a retry policy, an alert — obligations no
business scenario was ever going to carry, so the feature that adds one has no business requirement
to write. Found by authoring loam's own architecture change through loam's own lifecycle, which is
the trigger ROADMAP's self-hosting section records for that axis.

## [0.2.0-alpha.1] - 2026-09-01

The first release of the 0.2 line, and the whole accumulated body since `0.1.0-beta.3` — 116
entries, 53 of them additions. It opens a new line at `alpha` rather than continuing `0.1.0-beta.4`
because the surface moved that far: the use-case, business, glossary and obligations axes all
landed, and the agent interface became a dual-entry contract of generated commands and skills.

Still a prerelease, and the 5–10 service pilot still has not run. The entries below describe
implementation behavior and repository-owned synthetic fixtures; they claim no production-fleet or
external execution evidence.

**It publishes under the `alpha` npm dist-tag**, so `npm i @ybotok/loam@alpha` — or the exact
version — installs this one. `latest` is moved onto a release by hand once it has published, and
until it is, a plain `npm i @ybotok/loam` still resolves to `0.1.0-beta.3`. No
entry below is marked breaking, but a repository upgrading from beta.3 should read the `Changed`
sections first: the view doctrine narrowed, a use case became a consumer (`loam diff` refuses where
it warned), and the scaffolded `AGENTS.md` became a pointer. Every generated file stamped by an
earlier loam now reports against this binary — `doctor.agent-files-stale` for the command and skill
files, `agents.stale` for a docs repo's `AGENTS.md`. Both are detection, not damage: a file whose
recorded digest still matches is refreshed by re-running `loam init`, and a customized one stays
yours to review and re-stamp by hand.

### Security — the private reporting route is live, and every document says so

GitHub Private Vulnerability Reporting is enabled on `ybotok/loam`, verified from the repository's
PUBLIC advisories page — the same view an outside researcher gets — rather than taken on trust.
`SECURITY.md` now names [the advisory form](https://github.com/ybotok/loam/security/advisories/new),
says what to include and what to leave out, and keeps the one warning the old text was right about:
a GitHub issue, pull request or discussion is public the moment it is opened. The
`private-security-route` release blocker and the detail-free-issue fallback are gone — the fallback
existed only while the private form did not, and leaving it standing would offer a public route
beside a private one. `test/docs-drift.test.ts` inverts and keeps the blocker constant, so absence
is now the invariant.

### Added — the agent interface is progressive, executable and ownership-aware

- **`QUICKSTART.md` now ships in the npm package.** It gives the shortest complete path from
  install through adoption and the first explicit agent-driven feature, with the host-specific
  command spellings and the human-only vouch/archive boundaries in one place.
- **`loam-report` is a generated command and Agent Skill in every profile.** It collects an
  unexpected binary or agent-integration run into
  `loam-reports/YYYY-MM-DD-<short-slug>.md`: version, expected/actual behavior, stable codes and
  locations, doctor/status and write-state evidence, minimal safe reproduction, classification and
  missing evidence. The protocol redacts secrets and home paths, never retries a writer merely to
  reproduce it, and never repairs, uploads or submits anything automatically. Bare
  `loam instructions --json` adds the support entry under the additive `support` key; the six-item
  `workflows` array remains the lifecycle contract.
- **The documented chat contract is explicitly dual-entry.** The generated command is the
  recommended predictable path (`loam-feature` → `loam-implement` → `loam-check` → `loam-verify`
  → `loam-ship`), while natural language may load the matching Agent Skill. Both deliveries retain
  one shared body and defer to the same binary-owned `loam instructions` page; no command or skill
  name changed.
- **The always-loaded generated `AGENTS.md` is now 8,793 bytes**, measured on the file `loam init
  --create` actually writes. Detailed workflow, authoring and
  code material stays behind `loam instructions`; `loam-check` pointers start with
  `--no-fix-tables` and fetch individual fixes through `loam explain <code>`.
- **`loam status --json` adds `next[].execution`.** It distinguishes runnable commands from edits,
  external-repository work and human review; carries `cwd`; and never presents a command containing
  unresolved `<placeholders>` as runnable. The original `command` field remains compatible.
- **Serialized findings add `locations[]`, and validate targets add `path`.** Producers may emit
  exact file/line/pointer locations; otherwise the shared serializer supplies the narrowest proved
  service, feature or landscape scope. Codes and message text are unchanged.
- **`loam show <FEAT> --json` adds `review`.** The pack joins the intent excerpt, tagged C4 objects,
  API/event changes, dependencies, artifact and verification state, use cases, blockers, advisories
  and executable next actions from the existing semantic projections.
- **`loam init` adds `--agent-profile <full|service|docs>` and safe refresh.** `loam.json` gains
  additive `agentProfile` and `agentFiles` fields. An unchanged generated command/skill pointer is
  refreshed when its recorded sha256 still matches; a customized file is never overwritten.
- **`loam mcp` adds resources, a common output schema and opt-in `--author`.** Orientation and every
  workflow/support/reference page are readable at `loam://orientation` and
  `loam://instructions/<name>`. `--author` adds `loam_new`, `loam_rebase`, `loam_gherkin` and
  `loam_archive_plan` (server-enforced `--dry-run`); `vouch`, verification recording and a committing
  archive remain excluded. `loam init --mcp-author` writes this launch mode.

### Changed — the product boundary is a governed system, not a microservice topology

- **The public position is now “architecture-first semantic integrity and change governance for
  evolving software systems.”** README and npm metadata no longer define loam as a microservice-only
  framework. Distributed service fleets remain the richest contract-spine case; modular monoliths
  and hybrid systems take the same lifecycle without pretending their internal modules are network
  services.
- **The existing `service` vocabulary is defined, not renamed.** In flags, paths, config and stable
  codes it remains the frozen term for one governed implementation boundary. A modular monolith uses
  one `services/<app>/` directory and one bound C4 root; nested modules participate in feature
  deltas and `Covers:` while fleet maturity, dependency and scorecard views continue to aggregate at
  the bound service level. No command, flag, path, envelope field or stable code changed.
- **README, WORKFLOW, SCHEMA, the ecosystem overview and the generated docs-repo README and agent
  contract carry the same topology contract.** They distinguish modular, distributed and hybrid
  shapes, show the nested C4 spelling, and state the current module-level reporting limit rather
  than turning the broader position into a claim the binary does not make.
- **The ecosystem page no longer defines loam against OpenSpec.** It now gives short, non-adversarial
  boundaries with architecture-as-code tools, catalogs, contract tooling, traceability systems and
  code-level architecture checks. OpenSpec remains documented only where the product has a real
  compatibility concern: the one-way migration guide and its pinned parser corpus.

### Fixed — a Windows checkout read the generated subsystem views file as stale

- **The generated `architecture/subsystems.likec4` is now compared by content, not by bytes, in all
  four places that ask the question.** `renderSubsystemViews` only ever emits LF; `core.autocrlf=true`
  is Git for Windows' installer default and a docs repo ships no `.gitattributes`, so an ordinary
  Windows clone got the file back with CRLF and not one fact in it changed. Under a byte compare
  `loam validate --all` reported one error, and the repair the finding advertises made it worse:
  `loam subsystem sync` answered `updated`, rewrote with LF, git then showed the file permanently
  modified, and the next checkout restored the CRLF — a loop with no stable exit. The rule now lives
  once, as `viewsAgree` beside the generator that mints the bytes, and `loam validate`,
  `loam seed`, `loam subsystem sync` and every subsystem transaction take it. The compare is still
  never a parse, absent / must-be-absent / mismatched are still three distinct messages, and a real
  content edit under CRLF is still `subsystem.views-stale`. Measured on this repository's own
  `examples/docs`: 1 error to 0, with no other check moving.
- **`loam seed` and `loam subsystem move` no longer journal a no-op rewrite of that file** on such a
  clone. What gets written when the file really has moved is unchanged.

### Fixed — `loam status`'s first rung sent the agent to the gate

- **`next.author-landscape` now carries the command its own statement names** — `loam init --create`
  when `architecture/landscape.likec4` is absent, `loam seed --from fleet.yaml` when it is still the
  scaffold's untouched stub — where both arms used to carry `loam validate --all --json`. Over a
  repository with no services `validate --all` answers `ok: true` with `landscape.matched`, so an
  agent running the documented loop (WORKFLOW.md: read `next[0]`, run the command it names, repeat)
  changed nothing and read back the identical `next[0]` on every pass: a livelock on the first rung
  of the first hour, on the one command built to answer "what now". No new `next.*` code and no new
  payload key.
- **`next.fleet-gate`'s statement writes `` `loam validate --all` `` where it wrote
  `` `validate --all` ``**, so the sentence is visible to the checks that read a backticked
  `loam <verb>` span as an instruction rather than exempt from them.

### Fixed — `loam gherkin` and `loam vouch` said `invalid-option` when the flags were fine

- **A wrong-repo refusal now carries a wrong-repo code.** `loam gherkin --service <id>` and
  `loam vouch --service <id>` run from the docs repo, or from a repo bound to a different service,
  both refused under `invalid-option` — whose `loam explain` row says the invocation itself is
  wrong, which was false for both and sent a user whose flags were correct off to re-read their
  flags. Each now emits the pair `loam verify --record --service` has always emitted for the
  identical condition: **`repository-unavailable`** when loam.json declares no `service` at all, and
  **`service-mismatch`** when it declares a different one. Both human-facing messages are unchanged,
  exit stays 1, the `--json` envelope is unchanged, and no code is new. Refusing with no service
  named anywhere is still `invalid-option`; that one really is a bad invocation.
- **`loam explain service-mismatch` and `loam explain repository-unavailable` name all three
  commands** that can now answer with them, where both rows described only `loam verify`.
- **The generated `AGENTS.md` lists the two codes on the `gherkin` and `vouch` rows.**

### Fixed — the example fleet could not be run

- **`examples/docs/` now carries its own `loam.json`**, holding the same `{ "docsDir": "." }` that
  `loam init --docs . --create` writes for a docs repo that governs itself. `cd examples/docs &&
  loam status` used to answer "No loam.json found" and exit 1, and the workaround both READMEs
  printed — a throwaway `loam.json` at the loam repository root — then governed every directory
  under it, so `loam init` from a sibling refused with "loam.json already governs this directory"
  and forgetting to delete it silently redirected later commands at the example fleet.
- **`examples/README.md`'s runnable block is now `cd examples/docs` plus the installed binary**,
  with no file to write first and none to delete afterwards, and it names the from-source
  substitute (`npx tsx ../../src/cli.ts`) explicitly. `test/examples.test.ts` pins the file the
  walkthrough depends on; neither archive dry-run plan enumerates it.

### Fixed — three README claims the tree had stopped supporting

- **The Windows caveat under "Explore the example fleet" is gone.** It advised a re-clone with
  `core.autocrlf=false` — advice that never transferred to the reader's own docs repo, where the
  same defect lived and no re-clone was on offer. The comparison is by content now, so the caveat is
  simply false.
- **"Explore the example fleet" is `cd examples/docs` plus the installed binary**, the same commands
  in the same order. ROADMAP's claim that the throwaway root config is the documented first
  experience is dropped with it.
- **The commands table said `--errors-only` "prints just the errors". It never did.** The report
  drops only the `ok` confirmations, so every warning survives the filter. The row now carries the
  sentence the workflow protocol and the generated `AGENTS.md` already use, and
  `test/agent-contract.test.ts` pins it against both the corrected wording and the old claim. No
  flag changed and no behaviour moved.

### Added — three narrowing flags, because the agent-facing payloads had outgrown the work they describe

- **`loam instructions [<workflow>] --no-fix-tables`.** Every generated command and skill file says
  "run this first" and points at `loam instructions loam-check`, which was **83,731 bytes** — about
  21k tokens, 223 fix-table rows — with no way to narrow it. The flag collapses each
  `| code | what it means | what to do |` block to one line naming how many rows went and how to get
  them back, and the page becomes **3,541 bytes**; `--json` goes 84,201 to 3,769, the narrowed text
  riding in the existing `body` field so no envelope key is added or renamed. `/loam-verify`'s
  notice table strips through the same path (12,439 to 8,839); the four protocols carrying no table
  come back untouched. **The paragraph that introduces each table stays** — it is what says which
  scope graded a code, and `spec.merge-conflict` means different things in two of them. Off by
  default, so all six protocols are byte-identical without it, asserted against the shipped bodies
  rather than claimed.
- **The stripper shares the parser's block detection** (`withoutFixTables` beside `parseFixRows` in
  `src/core/explain/fix-tables.ts`) rather than carrying a regex of its own. A stripper that
  disagreed with the parser about where a table begins would ship a page that reads perfectly and
  sends an agent to look up a code nothing explains; a test asserts every code the narrowing removes
  still resolves through `explainSubject`.
- **A generated command and skill file now says how to READ the protocol, not only to run it** — add
  `--no-fix-tables`, then `loam explain <code>` for each code the run actually reports. One
  sentence; the stub stays under 2.3 KB. Existing generated files are never rewritten, so the clause
  reaches repositories scaffolded from this release on.
- **`loam adopt --targets`.** The brief was **42,873 bytes** per service and had no narrowing flag,
  while `walk`, `checks` and `unchecked` are the same bytes for every service — a twelve-service
  adoption paid that invariant text twelve times. `--targets` emits only what varies by service and
  comes back at **17,805 bytes**. It carries one required extra key, **`full`**, naming the run that
  returns the rest, because a narrowing flag that made
  [the fifteen statements of what nothing checks](https://github.com/ybotok/loam/blob/main/src/core/brief/unchecked.ts)
  invisible would quietly undo the one promise the brief exists to keep. The default payload is
  unchanged.
- **`loam explain --codes`.** The code vocabulary could not be enumerated through the machine
  contract: `loam explain --json` with no subject returned six concept terms, and the ~100 issue
  codes and 46 refusal codes were reachable only from TypeScript source or from a 223-row prose
  table inside an 84 KB body. `--codes` lists **273 codes — 227 findings and 46 refusals** — each row
  the same answer `explain <code> --json` already gives for that one, so there is no second shape to
  keep in sync. No derived `severity` or `gates` field: those have one authority in
  `core/vocabulary/issue.ts` and a second answer here could disagree with it. Like every other
  `explain` form it reads no config, so it works in an unfamiliar directory before anything is
  wired.
- **A named backlog rather than a silent gap.** The coverage test that holds `--codes` against every
  stable code loam emits ships with an explicit list of the families that have no `explain` row yet —
  `doctor.*`, `next.*`, `diff.*`, `gate.*` and the `openspec.*` / `mapping.*` migration surface —
  with a written reason per family. It can only shrink.

### Added — `loam explain` answers the four families it has never been able to

- **`doctor.*`, `next.*`, `diff.*` and `gate.*` — 65 codes no fix table anywhere graded.**
  `loam explain`'s finding content is parsed at runtime out of the `/loam-check` tables, and those
  grade documents; these families grade wiring, a recommendation, a change between two refs and a
  deploy question, so `explain` returned nothing for any of them. `loam explain <code>`,
  `<code> --json` and `--codes` now answer them in the shape they already returned — no new key, no
  second envelope. The listing goes from 274 codes to **339** (293 finding, 46 refusal).
- **A registry, and it is not the duplication `fix-tables.ts` argues against.** That argument is
  about a second copy of prose the `/loam-check` bodies already ship, which would silently trail
  them. These 65 have no row anywhere, so the registry is the only copy — the same shape, and the
  same reason, as the sibling `refusals.ts`. Every meaning and fix is written from the emitter:
  `doctor`'s own `fix` fields, each `next[]` step's `statement` and `command`, the `DiffCode` union's
  doc comments. Where the "what to do" column is genuinely empty — a `next.*` step's action IS the
  step — it says so instead of inventing a second instruction.
- **A test keeps the two sources disjoint**: the registry may not answer a code a fix table already
  answers, so the parsed and hand-written halves can never drift into two answers a reader cannot
  tell apart. The backlog of unanswerable codes shrinks from 116 to **51** — the OpenSpec migration
  surface and two `ok`-severity confirmations, each with its written reason.

### Changed — the scaffolded `AGENTS.md` becomes a pointer, and the reference ships with the binary

- **109,399 B to 29,720 B (−73%), under the 32,768 bytes Codex truncates the AGENTS.md chain at for
  the first time.** Every agents.md-aware host auto-loads that file from the working directory, every
  session, and it is never regenerated — so for those hosts roughly 70% of it was being silently
  dropped, with no error and no way for the reader to tell which half it got.
- **This is loam's own doctrine, finally applied to the file that never got it.** `scaffold.ts`
  argues it for the command files in its own words — *"Thinning the file is the third option. What
  remains is what does not move between releases"* — and README's "a generated file is a pointer,
  not a protocol" makes the same case. Nothing new was decided here.
- **`loam instructions` now serves four reference pages beside the six workflow protocols**:
  `loam-codes` (44,132 B — which codes each invocation can raise), `loam-spine` (15,590 — the ID
  spine and the `Based-On:` pins), `loam-authoring` (12,021 — `arch.spec.md`, the generated Gherkin
  suite, frontmatter) and `loam-done-check` (11,126 — how `loam verify` derives its claims, and
  verified versus attested). Each takes no arguments and prints whole. Bare `loam instructions`
  lists them under their own heading — **not** flattened in with the workflows, because a list of
  ten names would read as a ten-step process, which is the one thing the six-step cycle must not be
  confused with. `--json` carries them in an additive `references` key beside `workflows`.
- **`loam init` writes no new file for a page.** They feed `PROTOCOLS`, never `SLASH_COMMANDS` or
  the scaffold's file list, so moving 44 KB out of `AGENTS.md` did not put it back as four new
  artifacts in every repository loam touches. Printed by the binary, they describe the loam you are
  about to run rather than the one that scaffolded the repository — which is strictly better than
  what they replaced, since `AGENTS.md` is written once and never refreshed.
- **What stays is what a reader needs to form a question at all**: the layout, the cycle, which
  element is which service, `loam.json`, linking, the glossary, obligations, the validator's rules,
  the archive gate and its undo. A new `## The reference pages` section names each page with the
  exact command that prints it, and the cycle's steps 4 and 7 name the command where they used to
  name a heading that has left the file.
- **The move was verbatim, and that was checked rather than assumed**: zero headings and zero stable
  codes lost, audited against the index. `codes-drift` is untouched and green by construction — the
  codes moved from one half of the `AGENTS_MD + PROTOCOLS` corpus into the other.
- **Still over Windsurf's 12,000-character cap**, and no further move fixes that: what remains is
  the teaching, not duplication.

### Changed — the scaffolded `AGENTS.md` stops storing the code vocabulary twice

- **124,587 B to 109,399 B (−12%).** `loam init` writes that file into the docs repo and every
  agents.md-aware host auto-loads it from the working directory. Its `## Reading loam's output`
  section is a per-invocation inventory — which codes each way of running loam can raise — and each
  code carried a gloss of what it means. The `/loam-check` tables carry the same codes with
  meaning-and-fix. **143 codes were explained twice, in two independently worded places, in a file
  nothing regenerates** — so the two drift and nothing says which copy rotted.
- **The inventory stays; the gloss goes.** All 335 codes the file named are still named, still
  backticked, still grouped by the invocation that raises them — that is unique content and
  `codes-drift` reads this file as half its corpus. What a code MEANS now comes from
  `loam explain <code>`, out of the running binary. `## Reading loam's output` falls from 59,621 B
  to 44,433 B and every other section is byte-identical. A parenthetical that carried something
  other than the meaning — a cross-reference, a severity that differs by scope — was kept.
- **The OpenSpec migration codes keep their notes inline**, because `loam explain` does not answer
  them. **A test fails by name if any other code this file mentions cannot be explained**, so the
  pointer can never outrun the catalogue.
- **A size assertion** now stands beside the file, because the number is load-bearing: Codex
  truncates the AGENTS.md chain at 32,768 bytes by default and Windsurf caps a workspace rule file
  at 12,000 characters, so a file over the cap loses its tail with no error at all. **This change
  does not reach that cap and does not claim to** — the twenty-two remaining sections are 64,548 B
  of teaching, not duplication, and cutting them is a separate decision about what a scaffolded
  `AGENTS.md` is for.

### Added — `loam validate --all --base <ref>`, the ratchet a partly-adopted system had no setting for

- **Grade only the targets changed since a base git ref of the docs repo.** `--all` is green over
  undocumented boundaries because warnings do not gate, and `--all --strict` is red from the first
  minute of adoption until the last boundary is written — so a team could install a gate that never
  notices adoption stalling at 8%, or one they could not turn on until the work everyone hoped CI
  would motivate was already done. Measured on a twelve-boundary system with one documented:
  `--all --strict` exits 1 on thirteen warnings, eleven of them on boundaries nobody touched;
  `--all --base HEAD~1 --strict` exits 1 on two, both on the branch's own boundary.
- **Spelled `--base`, not `--since`** — already loam's word for "a base git ref of the docs repo" on
  `loam diff` and `loam vouch --pack`. It requires `--all` and refuses `invalid-option` beside a
  positional target, `--service` or `--feature`: two scopes is a contradiction, not a narrowing.
- **Changed paths map to targets through the service and feature enumerations, never a path split.**
  A service filed under a subsystem does not live at `services/<id>/`, and a `split("/")` would
  return the subsystem name, match no id, and print a green over nothing. Untracked files count:
  `validate` grades the working tree, so a boundary adopted five minutes ago and not yet committed
  is in scope.
- **The run says what it looked at, in both views.** The summary reads "N of M services, K of L
  features in scope since `<ref>`", and the payload gains an additive `scope` object naming the base,
  the resolved commit and the targets. **A run with zero targets in scope prints that it graded
  nothing and exits 0 — never the bare word "valid".** The fleet scorecard is omitted from a scoped
  run: its denominators are the graded targets, so over a narrowed set it would describe adoption the
  run never measured.
- No new stable code: an unreachable repository or an unresolvable ref refuse with the codes
  `loam diff` already uses.
- **The honest limit, stated in the docs beside the recipe:** a `--base`-scoped validate cannot see a
  victim boundary the change did not touch. `loam diff --base` remains the gate for that.

### Added — one vendor-neutral skills root, and the machine surface wired at `init`

- **`loam init --tools` gains `agents`: the `.agents/skills/<name>/SKILL.md` root**, read by Cursor,
  GitHub Copilot, Codex, Gemini CLI, Zed and Roo Code, each cited per its own documentation. Skills
  only — none of the six documents a command file under that root, so none is written. Purely
  additive: no existing tool's skill path moved. Detection is `.agents/skills`, never a bare
  `.agents/` — the same rule that keeps a bare `.github/` from meaning Copilot.
- **`loam init --mcp` writes a repo-root `.mcp.json`** pointing an MCP host at `loam mcp` for this
  repository. The MCP facade is the only typed, schema-carrying delivery loam has, and it was the
  one that required a human to hand-edit JSON — so in practice scaffolded repositories got the prose
  deliveries and never the machine one. Opt-in and default off: the file arranges for a process to be
  launched on every machine that checks the repository out.
- **The launch form follows the install.** Where `node_modules/.bin/loam` exists — the per-repo
  devDependency install the README documents — the entry is `npx --no loam mcp`; otherwise the bare
  binary. A fixed `"loam"` would have written an unlaunchable entry into exactly those repositories.
- **Only the repo-root `.mcp.json`.** `.github/.mcp.json` is already a Copilot detection marker, so
  writing it would make the next scan detect a tool loam itself installed; `.cursor/mcp.json` and
  `.vscode/mcp.json` carry different schemas; `.gemini/settings.json` is a general settings file that
  could only be merged into. An existing file is reported skipped and left byte for byte alone.

### Added — an evaluator can see loam working without modelling anything first

- **`loam init --example <dir>`** copies the packaged example fleet — five services, four features
  at four points in their life, and its own `loam.json` — into a fresh directory through the same
  journaled transaction every other loam writer uses, and prints the three commands that make the
  point. It binds no repository, records no `docsDir` and generates no agent files, so it refuses
  `invalid-option` beside `--docs`, `--service`, `--create` or `--tools`, and `already-exists` when
  the target is occupied. No new stable code.
- **The `examples/` tree now ships in the published package.** `npm i -g @ybotok/loam` delivered no
  example at all, so the first question an evaluating team asks — "show me a working one" — was
  answered with "model your own boundaries first, then come back". The tarball grows by 89 files and
  about 77 kB packed.
- **Fixed with it: the shipped-page link audit resolved relative targets against the package root
  rather than against the page carrying them.** Every audited page sat at the root until `examples/`
  shipped, so the two were the same string. For a page in a subdirectory they are not, and the audit
  would have called correct links broken and missed broken ones.

### Added — `loam --help` says where to start, and what to run when lost

- **The help page ends with two lines: `loam init --create` for a first run, `loam doctor` for a
  lost one.** The seven headings already put thirty commands in the order of the work, but nothing
  on the page said that `init` must precede all of them or which command answers "what now" — the
  last thing a newcomer read was `help [command]`. Both lines name a command that parses:
  `test/agent-commands-runnable.test.ts` takes `HELP_EPILOG` by import and hands both invocations to
  the real program, exactly as it takes the `init` first-hour lines.

### Changed — `loam explain` is reachable from the message that needs it

- **Every text-mode refusal now prints its stable code and the lookup on stderr**, as one line after
  the message: `<code>  ·  loam explain <code>`. Measured over eight wrong first-hour invocations,
  all eight printed prose and no code, and only `loam validate` mentioned `loam explain` at all — so
  reaching an explanation meant re-running the whole command with `--json` and reading `error.code`,
  which is the knowledge a new user does not yet have. `vouch-declined` is the one refusal that
  stays silent: loam asked, a person said no, and there is nothing to look up.
- **`loam validate`'s text report carries each finding's code**, appended to every line whose
  severity is not `ok`; the `ok` confirmations stay clean, so a mostly-green report keeps its
  contrast. A code is printed only where `loam explain` can answer it — a pointer to an explanation
  that does not exist is worse than none. `gherkin.path-outside` gained the fix-table row it had
  been missing, which is what made that true rather than nearly true.
- **The explain footer was reworded to match**: the old "codes ride in `--json`" clause existed only
  because no code was ever on screen.
- **`--json` stdout is byte-identical on every path**: the refusal pointer is a stderr line, and the
  finding codes are the ones the envelope already carried.

### Fixed — `loam adopt`'s human view printed 650 lines with nothing telling a reader what they were

- **The default view opens with a three-line orientation block**: how many briefed artifacts are
  required and still outstanding and which, a decode of the artifact table's flags (`MISSING` in
  capitals is required and absent, lowercase `missing` optional, `present` means diff it, `UNDRAWN`
  is the shared map this boundary owes an element), and what the remaining four hundred lines are.
  This is step 1 of the five-minute trial, and the two rows that orient a person landed around line
  470 of 646.
- **The outstanding count includes the fleet-map edit, which `required && !exists` misses.**
  `architecture/landscape.likec4` exists for every docs repo after its first service, so the file is
  present while nothing in it resolves to the new boundary — an error the moment `validate --all`
  runs. A fresh boundary is briefed as three artifacts owed, not two.
- Every number is computed from the brief just assembled. No new flag, nothing moved behind one, and
  no change to `--json` or to `--targets`.

### Changed — `loam status` leads with the boundary you are standing in

- **The fleet form now leads its `next[]` with the service this repository's `loam.json` binds.**
  The binding was visible to the worklist only while that service was *un*adopted; once adopted, the
  repository you are standing in became invisible again and the list reverted to every service,
  alphabetically. In a ten-repo system that opened every developer's `status` with nine other
  boundaries' adoption work, and past ten services the ten-entry cap elided their own step entirely
  — so working down the list as documented never reached it.
- **A stable partition applied before the cap, not a sort**: the bound service's steps move to the
  front and every other service keeps the order it had, so an unbound reader sees exactly the list
  it saw before. `--service <id>` is unaffected — that flag is an explicit question about one
  service. No `next.*` code added, removed or changed.

### Added — a `--json` envelope now says which loam wrote it, and which command answered

- **Every envelope carries `version`, the binary's own, beside `contractVersion`.** The two are
  separate on purpose: `contractVersion` versions the SHAPE, `version` versions the BUILD, so a
  release never reads as a contract break. Only `instructions` and `explain` said which loam
  produced their output; `validate --all`, `status`, `list`, `context` and `gate` did not — so a
  consumer holding a payload could not apply the caution `docs.binary-behind` exists to express, and
  could not detect a mixed-version system from the contract at all. It is stamped by the two
  emitters in `src/core/envelope/json.ts`, not by each command, which is why no command can be added
  without it. **`version` is on the refusal envelope too**: a refusal is what a caller is most
  likely to be holding when the build is the question.
- **Every success payload now carries `command`, the CLI command name.** `adopt`, `archive`,
  `delta`, `gherkin`, `init`, `list`, `new`, `rebase`, `seed`, `show`, `subsystem`, `unarchive`,
  `validate`, `verify` and `vouch`'s stamp payload gained it, so an MCP host multiplexing tool
  results branches on one field instead of sniffing for the presence of `valid` or `services`. All
  seven `subsystem` verbs emit `command: "subsystem"` — it is one registered command with a verb
  positional. **A refusal deliberately carries no `command`, and a test now says so**: the error
  emitter has no command in scope, and threading one would cost module-level mutable state or an
  extra argument through every deep caller of `fail()`.
- Every key here is additive: no existing key changed name, type, value or relative order.

### Added — `loam validate --json` now says what to do about the codes it raised

- **The payload carries `fixes`, a top-level map from each raised code to its fix.**
  `loam validate --all --json` is the command every generated protocol names at step 1, and it was
  the one that answered "what do I do next" in prose only. An agent holding the payload either had
  the fix tables in context already or spawned a separate `loam explain` process per code — having
  first guessed that it could.
- **A map keyed by code, not a field on each finding** — the argument `report.ts` already makes
  about its `DETAIL_LIMIT`: ten services raising `sources.absent` produce ONE entry, and the whole
  map costs 398 bytes there. On `examples/docs`, 51 findings become 9 entries and the payload grows
  16,433 → 17,731 bytes.
- **Only codes a non-`ok` finding raised**, **resolved through the same function
  `loam explain <code>` calls** so the two surfaces cannot disagree (a test asserts every value
  equals what `explain --json` returns), and **a code no fix table grades is absent, not a
  placeholder** — the named backlog in `test/explain.test.ts` is where that gap is supposed to itch.
  Nine codes that two tables grade differently carry both, each prefixed by its scope.
- Not behind a flag: a flag would mean an agent has to already know the fixes exist in order to ask
  for them, which is the gap being closed. `{}` on a green run, so no consumer branches on the key.

### Added — `loam mcp`: read-only annotations, and `instructions` + `steps` as tools

- **Every MCP tool advertises `annotations: { readOnlyHint: true, openWorldHint: false }`.**
  `tools/list` emitted exactly `{name, description, inputSchema}`, so a host had no machine signal
  that `loam_validate` or `loam_status` only reads files, and every call fell into the same approval
  path as a mutating tool — which is the friction the read-only-only table was built to avoid.
  `idempotentHint` and `destructiveHint` are deliberately absent: MCP defines both as meaningful
  only when `readOnlyHint` is false. `outputSchema` was considered and deferred, with the reason
  recorded beside the annotations.
- **The read-only claim is derived, not attested.** `test/mcp-protocol.test.ts` computes the
  transitive value-import closure of every served command from `scripts/source-graph.mjs` and fails
  if one reaches a module that commits. Adding a writer to the table now goes red instead of
  shipping a hint that tells every host it is safe to auto-approve; a negative control asserts nine
  known writers still DO reach that seam, so the guard cannot pass for everything if the seam moves.
- **`loam_instructions` and `loam_steps` join the table — twelve read tools become fourteen.** Both
  read nothing and write nothing, and both were unreachable over MCP, so an MCP-only host could not
  fetch the protocol its own generated skill points at. `--no-fix-tables` rides as the JSON property
  `noFixTables`, named for what setting it true DOES, because commander's own attribute for a
  negated option is `fixTables` and the two would otherwise mean opposite things.
- **`tools/call` can actually run them, and a test now proves that for every advertised tool.** The
  dispatcher builds its own program from a second, hand-written roster — `core/` may not import
  `commands/`, so the two lists cannot be one — and nothing counted them against each other. Landing
  the tools without the dispatcher made `tools/list` promise fourteen while two of them answered
  `{ ok: false, error: { code: "invalid-option", message: "unknown command 'instructions'" } }`, an
  envelope that reads as the CALLER's mistake. `test/mcp-serve.test.ts` now calls every tool in
  `MCP_TOOLS` and fails on `unknown command`.

### Fixed — the generated allowlist stopped short of the verbs the protocols instruct

- **`allowed-tools:` in every generated skill file now names 23 of loam's 29 verbs, and the six it
  omits carry a written reason.** It named 17, and four of the missing were verbs loam's own
  protocols call mandatory: `/loam-implement` opens with `loam context` and requires `loam steps`,
  `/loam-check`'s fix table says to run `loam subsystem sync`, and every generated file now tells
  the agent to read the protocol narrow and run `loam explain <code>` per reported code. Each
  stalled on a permission prompt at exactly the step its own protocol calls required — worst for
  `loam explain`, the documented escape from an 84 KB page. Added: `context`, `diff`, `explain`,
  `gate`, `steps`, `subsystem`.
- **The rule is now "every verb the CLI registers except the named exclusions", and it admits no
  silent third category.** `UNAPPROVED` maps each excluded verb to its reason — `vouch` (an agent
  must not be able to say a spec matches the code), `mcp` (a long-running server, not a call that
  returns), `seed` and `open` (a human's statement and a human's editor), `audit-openspec` and
  `migrate-openspec` (a one-time on-ramp against a foreign workspace). Still an enumeration, never
  `Bash(loam:*)`: the wildcard is what would let an agent promote its own draft to `verified`.
- **`test/agents.test.ts` grades both halves against the binary** instead of spot-checking six
  verbs: one test requires every backticked `loam <verb>` the protocols teach to be pre-approved or
  named in `UNAPPROVED`; the other asserts the emitted list equals the registered commands minus
  `UNAPPROVED`'s keys.

### Fixed — a tool that does not substitute `$1` got a refusal instead of the protocol

- **`loam instructions <workflow> $1` prints the protocol instead of refusing.** Every generated
  command file carries Claude's positional `$1`/`$2` spelling into all twenty dialects, and Cline,
  Kilo Code and Roo Code substitute nothing — so those three sent loam the literal `$1` and got
  `invalid-option` on the first instruction of the workflow. A literal `$1`…`$9` now reads as an
  unsupplied argument and the placeholder is left standing, exactly as passing no argument does. An
  argument that merely contains one (`FEAT-$1`) is still checked and still refused.

### Fixed — `loam delta` printed `Covers:` twice

- **The text briefing printed each requirement's body verbatim and then re-printed `Operations:`
  and `Covers:` from the parsed fields**, so a requirement carrying either line showed it twice
  while the five other directives showed it once. A directive line is a body line by design — it
  stays in the requirement's text so the document round-trips and its digest is stable — so the
  re-print was always redundant. The duplicated lines are gone; `--json` is unchanged, and so is
  every other command. Found by running `loam delta` over loam's own self-model.

### Added — a feature can bring a use case

- **New feature-delta slot: `features/<FEAT>/usecases/<name>.likec4`.** A views-only LikeC4 document
  holding the `dynamic view`s a change brings with it. `loam archive` copies each one into
  `architecture/usecases/<name>.likec4` and `loam unarchive` removes it again, through the same
  transaction and the same `.loam-before/` snapshot as every other axis. The route is CREATE-ONLY:
  to change a living flow, edit `architecture/usecases/<name>.likec4` directly in the same pull
  request.
- **New issue code `usecase.flow-exists`** (error, archive-gating, **not** `--approve`-overridable):
  the feature introduces a flow the living `architecture/usecases/` already holds, and the merge is a
  whole-file copy that would replace an authored hop sequence wholesale. The same shape and severity
  as `glossary.term-exists`.
- **New issue code `usecase.flow-invalid`** (error, archive-gating, **not** `--approve`-overridable):
  the feature's flows could not be read against the map its own merge would leave behind — a parse
  error, a hop naming an element the merge does not land, or a landscape merge that itself refuses.
  Nothing is written; the archive stops at plan time rather than copying a flow into `architecture/`
  for the next reader's `loam validate --all` to fail on.
- **`capability.uncovered` now counts a feature-local flow as cover.** A `dynamic view` under the
  feature's own `usecases/` whose `#cap-` and `#req-` tags both resolve keeps the promise, resolving
  against the capability vocabulary and requirement ids the same feature's merge would leave behind —
  the both-corpora rule `Realizes:` already follows. Only a resolved claim counts, so a broken tag
  still earns its own error and silences nothing. **Its message changed**: it now names
  `features/<FEAT>/usecases/<name>.likec4` and the two tags to write, where it used to say the flow
  route opened only after the promise was living. When the flow half could not be evaluated — the
  flows unreadable, or `architecture/capabilities.yaml` not readable as a vocabulary so no `#cap-`
  tag resolves — the message says so and makes no claim about the flows, rather than reporting that
  none of them keeps the promise. The `Realizes:` half is still checked and still gates.
- **`delta.likec4` still refuses a `dynamic view`, and now says where one goes.** The refusal is
  unchanged and mechanical — that document re-declares the landscape's identifiers and carries its
  own `specification` block, so it cannot be read beside the map in one LikeC4 project — but its
  message names the new slot instead of sending the author to `architecture/landscape.likec4`. A
  `deployment view` still goes to the living map.
- **New path in the layout: `features/<FEAT>/usecases/`** (`SCHEMA.md`, the shipped `AGENTS.md`).

### Added — one predicate decides what a use case is

- **A `dynamic view` tagged only `#req-<slug>` is now visible to every reader**, not just to
  `loam validate --all`. `loam diff`'s victim walk, `loam delta` and `loam status`'s blast radius,
  the context and explore packs and `loam list capabilities` all take the same opt-in, which is
  exported as `isUseCase`; no caller spells the prefix test itself any more. The cheap byte scan that
  lets a fleet with no use cases skip the LikeC4 load was widened with it — a fleet whose only flow
  was `#req-`-tagged declared `tag req-…` and no `cap-` anywhere, so the scan answered "no use cases"
  and nothing loaded the project at all.
- No code, flag, exit code or payload key changed. A fleet whose flows all carry `#cap-` sees no
  difference; a fleet with a `#req-`-only flow sees it appear in reports that previously omitted it.

### Added — the step catalogue

- **New authored document: `services/<svc>/steps.yaml`** — a `steps:` list of step TEXTS recording
  which phrases a team has decided its suite defines. Optional; the file's existence is the opt-in.
- **`loam steps` reports written phrases against catalogued ones.** New additive `--json` key
  `catalogue` carrying `present`, `path`, `entries`, and — when the file exists and parses —
  `uncatalogued` (written, not catalogued: the work-list, in the inventory's own order), `unwritten`
  (catalogued, nothing writes it) and `duplicated` (two entries collapsing onto one phrase). An
  absent catalogue and an unreadable one are different answers and neither reports a work-list:
  `unreadable` carries the reason instead. Existing keys are untouched.
- **No new stable code, and `loam validate` does not read the catalogue.** A phrase written before
  its glue is the normal order of work; the near-duplicate groups stay a report, and no
  phrase-similarity finding ships. The exit code is unchanged in every case — `loam steps` remains a
  read.

### Fixed — a slot-less AsyncAPI delta merges instead of archiving silently

- **A feature `asyncapi.yaml` that declares component surfaces and no channel, operation or message
  slot now merges them.** It archived at exit 0 having written nothing, and unlike its OpenAPI twin
  the early return was the symptom rather than the cause: the only write loop ran over the slots, so there was no writer for anything else, no enumeration of what lay outside the three slot
  sections, and no pin that could reach a `components.schemas` value — the event pin is written INTO
  a slot value, which works because every slot value is a mapping and a JSON Schema is not.
- **`loam rebase` writes a root `x-loam-baselines` record into a feature `asyncapi.yaml`**, pinning
  each component surface to the digest of the living value, ordered after the slot pins so a surface
  digest never contains a slot pin and the record never enters a slot digest.
  `stripAsyncapiMarkers` removes that record on every branch, including the early one — otherwise
  the archive's create path published it into the living contract and nothing caught it, because the
  removal-marker walk only looks for `x-loam-remove`.
- **New code `asyncapi.component-modified`** (warn, archive plan), the event-axis sibling of
  `openapi.component-modified`. `asyncapi.baseline-missing`, `-stale` and `-invalid` now grade
  component surfaces as well as slots, with unpinned surfaces folded into the SAME per-service
  counter rather than a second warning.
- **`asyncapi.ref-unresolved` no longer fires for a target the delta itself declares.** A feature
  that adds `components.messages.Refunded` alongside the `components.schemas.RefundPayload` its
  payload references now merges both and resolves; one whose target nothing anywhere defines still
  gates, and that case is the negative control in the suite.

### loam models its own architecture in loam

- **`meta/docs/` is a docs repo describing loam itself.** Its landscape holds 70 containers — the
  top-level subjects of `src/` — and 403 relationships, the real value imports;
  `services/loam/arch.spec.md` carries fourteen of `docs/DESIGN.md`'s numbered rules as requirements
  with `Covers:` lines onto real model objects, and opens by naming the twelve it cannot cover,
  because `Covers:` can only point at an object that EXISTS and roughly a third of loam's own rules
  prohibit edges that do not.
- **`npm run meta:check` (`scripts/self-model.mjs`) runs in CI beside `npm run arch:check`.** It
  fails on a package with no box, a box with no package, an import with no relationship, a
  relationship with no import, and a mutual dependency between top-level subjects outside its named
  baseline. It prints the fix and never applies it: loam reads no source tree, by standing non-goal,
  so this script CONVICTS the model and does not generate it. `scripts/source-graph.mjs` is the one
  definition of an edge, shared with `scripts/package-graph.mjs` so `import type` cannot be exempt
  on one side and not the other.
- **`.gitignore`'s `loam.json` is anchored to `/loam.json`.** Unanchored, it ignored a file of that
  name at any depth — which is why a self-model directory could not be committed at all. The
  throwaway root config the Quick start writes is still ignored; a committed one in a subdirectory
  is not.
- No command, flag, exit code, envelope field or stable code changed.

### Fixed — `docs/DESIGN.md` had stopped describing the tree, and its pin had never fired

- **The package-layout table had no row for nine `core/` packages** (`brief`, `explain`, `glossary`,
  `links`, `obligations`, `owners`, `provenance`, `scaffold`, `usecases`) and a false `Depends on`
  cell in eleven more — `core/c4/` claimed to depend on nothing while importing `repo` and
  `kernel`. The column is recomputed from the derived graph and now has a machine-checked
  counterpart. The DAG-levels table placed `verify/` below `gherkin/`, which it imports, and the
  "7-level DAG" is ten levels per package and eleven per file.
- **DESIGN said loam makes 27 `register*` calls producing 28 commands**; it is 28 and 29, and the
  page contradicted itself two rows later. **The pin that should have caught it had never matched**:
  it required a literal space before `commands` and the page wraps at exactly that point. That loop
  in `test/docs-facts.test.ts` now runs over the flattened text — every other pattern in it had the
  same hole — and a new assertion requires the sentence to be PRESENT before anything grades it. A
  pin that can pass vacuously is worse than none, which is the doctrine that file already states.
- **"Every edge points up the row order" is now qualified**, because it was false at a granularity
  nothing checked: `core/c4` ↔ `core/repo` and `core/repo` ↔ `core/provenance` are mutual, and
  `scripts/package-graph.mjs` cannot see either — it keys on the full relative directory, so
  `core/c4/project` and `core/c4` are different nodes. Both are held in an `ACCEPTED_CYCLES`
  baseline that may only shrink; breaking them is a hub move and a follow-up.

### Fixed — a components-only OpenAPI delta merges instead of archiving silently

- **A feature `openapi.yaml` that declares `components` and no `paths` now merges those components
  into the living contract.** It used to archive at exit 0 having written nothing: `mergeOpenapiPaths`
  answered no-op on the absence of `paths` before it had even parsed the living document, and the
  component closure is the last thing the merge runs — so components merged only as a side effect of
  merging a path. The no-op now consults the surface enumeration the baseline gate and `loam rebase`
  already share, so a contract delta whose entire content is a component is a merge, not silence.
- **A genuinely new component in such a delta is promoted before the ref fixpoint is seeded**, not
  after, so its own `$ref`s ride the same sweep: a components-only delta pointing at a schema neither
  document defines still gates `openapi.ref-unresolved`, naming `components/<kind>/<name>` as the
  source. Reachability still decides the new-component question whenever the delta merges paths at
  all — an unreferenced schema riding in beside a path change stays behind, as before.
- The archive plan names what it merged (`openapi: <svc> — merged (component schemas/Split)`) and no
  longer prints an empty `merged ()`. No command, flag, exit code, envelope key or stable code
  changed.

### The two-fleet pilot is removed

- **Removed `docs/pilot/`, `scripts/pilot-harness.mjs`, the `pilot:run` and `pilot:check` npm
  scripts, and the CI step that ran them.** The pilot was a plan for evidence, not evidence, and it
  had become the one `## Now` item that no work inside this repository could advance. Nothing in
  the shipped binary referenced it: no command, flag, code or payload key changes, and no page loam
  writes into a docs repo mentioned it.
- **`docs/pilot/RELEASE-READINESS.md` moved to `docs/RELEASE-READINESS.md`.** It is a release
  document — npm trusted publishing, tag discipline, provenance, post-publication verification — and
  it outlives the pilot that happened to file it. Its one pilot-specific checklist item is now the
  security review alone.

### `loam steps` — how many step definitions a suite actually needs

- **New read-only command `loam steps`** (`--service <id>`, `--duplicates`, `--json`). It collapses
  every written step in a service's living `spec.md` and `arch.spec.md` onto the phrase a step
  definition matches, and reports each phrase with its count, the keywords it appears under and the
  requirements it comes from — plus the two numbers a team plans from: how many steps are written,
  and how few phrases cover 80% of them.
- **Why it is a command and not a check.** The glue layer is where a generated suite dies: the step
  text is free prose from a spec bullet, so one precondition gets three spellings and the registry
  grows without bound until people go back to hand-written tests. Nothing in loam could previously
  say how bad that was. It emits **no finding and no stable code** — a near-duplicate is a judgement
  about writing, and a phrase-similarity warning is the kind of check a fleet turns off, taking the
  real findings beside it.
- **The phrase key is a contract** and `test/steps-inventory.test.ts` pins it case by case: the
  Gherkin keyword is dropped (every runner resolves Given/When/Then/And/But against one registry, so
  `Given the ledger is open` and `And the ledger is open` are one definition); quoted strings,
  `<placeholders>` and standalone numbers collapse to `{s}` / `{p}` / `{n}`, because those three are
  exactly what a definition captures as an argument; `v1` and `oauth2` keep their digits. Nothing
  measures edit distance.
- **`nearDuplicates`** groups phrases that differ only by a leading article or a trailing
  `because …` / `while …` clause — two definitions where one was meant, and the fix is the spec's
  wording rather than a second definition.
- **It reads the living specs, not the emitted files**, so it answers the same way in a repo that has
  never run `loam gherkin`, and needs no service repo to stand in. `/loam-implement` and the
  generated `AGENTS.md` now both send an agent here before it writes any glue.

### An outline's header and its placeholders must agree

- **New `requirements.examples-unbound` (error)**: a scenario with an `Examples` table uses a
  `<placeholder>` no column supplies. Cucumber substitutes nothing, so the step definition receives
  the literal angle-bracket text and either fails obscurely or matches and asserts against a string
  nobody meant.
- **New `requirements.examples-unreferenced` (warn)**: an `Examples` column nothing refers to —
  usually the fossil of a rename. The column still lists six cases, the step that used it now names
  something else, and the outline runs six identical passes that read as six cases of coverage.
- **Steps, docstrings and data-table cells all count as references**, because cucumber substitutes
  into all three: `<fee>` inside a request payload is a real use, and a check that read only the step
  lines would call its column dead and invite the author to delete it.
- **Scoped to scenarios that HAVE an `Examples` table.** A plain scenario's angle brackets are prose
  — a URL template, a generic, one of loam's own scaffold sentinels — and a fleet that writes no
  outline earns nothing from either code.

### A scenario that asserts nothing is a finding

- **New `requirements.assertionless-scenario` (error)**: a scenario whose body has steps and no
  `Then` anywhere in it. It arranges and acts and asserts nothing, so the run confirms only that the
  setup did not throw — and answers its `scenario.tested` claim on that. `And`/`But` are
  continuations, so with no `Then` above them they continue the setup.
- **Disjoint from `requirements.stepless-scenario` by construction** (that one has no steps at all),
  and graded in the same four places: living `spec.md` and `arch.spec.md`, and a feature's deltas of
  both — a delta merges into the living spec and is called covered from then on.
- It matters most where the least is left to check: under the runner-neutral answer sheet there are
  no step results to count, so a document-side check is the only thing that can tell a dense scenario
  from a mute one.

### A step can carry an argument: payload docstrings and expected-state tables

- **A fenced block written under a step becomes that step's Gherkin docstring**, info string carried
  through as the content type and **indentation preserved rather than trimmed** — a request or
  response payload whose leading whitespace has been eaten is one no step definition can compare
  against. **An indented Markdown table under a step becomes that step's data table** (the markdown
  separator row is dropped; Gherkin has none), which is how an expected-state assertion — the rows an
  outbox, a topic or a table must hold after one data pass — can be written at all.
- **Indentation is the whole disambiguation**, and it is the one behaviour change to existing
  documents: a table INDENTED under a step is now that step's rows, while a table at the scenario
  body's left margin is still the `Examples:` of a `Scenario Outline`, unchanged. A spec that wrote
  its expected rows indented under a `Then` was previously emitting them as the scenario's case
  matrix — the same scenario run once per expected row, with the step itself receiving nothing.
- **No digest moves.** The scenario digest hashes the markdown source, not the rendering, so every
  `@loam-digest-…` stamp, every `scenario.tested` claim and every recorded answer is unchanged by
  this. A suite generated by an earlier loam keeps its stamps and still grades `gherkin.current`;
  regenerate to pick up the new rendering.
- **New per-scenario emission loss `strandedBlocks`** (text, and a new `files[].strandedBlocks` key
  under `loam gherkin --json` — additive): a fenced block or an indented table that no step precedes,
  or an indented table loam cannot read. It stays in the description, so the document still reads
  correctly and the file is still valid Gherkin; what is lost is the ARGUMENT, and nothing downstream
  can otherwise notice.
- **Two defects fixed on the way in.** A Markdown table inside a fenced payload was hoisted out and
  emitted as the scenario's `Examples:`, turning one data pass into an outline parameterized by the
  contents of its own request body — fences are now recognised before tables. And a table cell
  holding a literal pipe written `\|` was read as two cells, so the row's width stopped matching the
  header and the WHOLE table was reported unreadable against the one row that needed the escape;
  `\|` and `\\` now unescape on the way in and are re-escaped on the way out, along with `|`, `\` and
  newline in every emitted cell.
- `parseStampedFeature` now skips docstring bodies. Every staleness verdict rests on that parse, so a
  payload containing a line reading `Scenario: …` or beginning with `@` would otherwise have been
  deciding what the suite promises.

### `loam --help` is grouped

- The twenty-eight commands now print under seven headings — **Set up · Read the fleet · Adopt what
  exists · Change it · Check it · Ship it · Migrate** — in the order the work happens, mirroring the
  six shipped workflow protocols rather than inventing a second taxonomy.
- **Nothing is hidden and nothing is renamed.** Every command still parses, still appears, and still
  carries the same flags; `test/help-groups.test.ts` asserts that no command is hidden, that every
  one has a heading, and that no stray heading exists. `src/cli.ts` throws on a command with no
  heading, so a twenty-ninth added without one fails the first time anybody runs the binary rather
  than landing quietly at the bottom of the page.
- [AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) now states that **help layout is
  not part of the frozen surface**: names,
  flags, exit codes, the envelope and the codes are frozen; which heading a command prints under is
  typography, and regrouping is not a compatibility event.

### The build's own contract, read as a check

- **New `contracts` block in `loam.json`**: `{ "contracts": { "openapi": "build/openapi.yaml" } }`
  names where this repository's BUILD writes its contract. `loam validate --service` digests that
  document and compares it with the committed `services/<id>/openapi.yaml` — **new finding
  `openapi.generated-stale` (warn)** when they differ, **`contracts.source-missing` (error)** when
  the path holds nothing (CI that validates before it builds), and **`contracts.source-invalid`
  (error)** when it escapes the repository or does not parse.
- **It reads, and never writes.** The copy into the docs repo stays a human `cp` reviewed in a pull
  request, which is what keeps the committed contract a document somebody agreed to rather than a
  cache of the build. This is the same category as `verify --results` ingesting a cucumber report:
  loam parses a standard document the team's build emitted, at a path a human named, and derives no
  meaning from it — no line of service code is read.
- **The digest is over canonical JSON, not bytes**, so two generator versions ordering keys
  differently, or a dumper re-wrapping a description, produce silence rather than a permanent
  warning nobody can clear. Service-repo only, and entirely silent for a repo with no `contracts`
  block — which is every existing repo.
- The premise this closes is SCHEMA's most load-bearing untested one: that the committed contract is
  what the service actually serves. Most fleets generate OpenAPI and copy it by hand, and until now
  nothing in the product could notice when the copy stopped being current.

### The example fleet now demonstrates both verdicts

- **New archived feature `FEAT-120-refund-notification`** in `examples/docs/`, and it reads
  **`verified`**. It is the sequel FEAT-088 left open — the money went back and nobody told the
  customer — so it publishes `payment.PaymentRefunded` from payment-service and has
  notification-service turn it into the customer's message: the event spine end to end, across two
  services, with no HTTP anywhere in it.
- **The two archived records are a matched pair, and that is the point.** FEAT-088's scenario claims
  rest on an agent's word (`attested`); FEAT-120's on a digest-matched runner report (`verified`).
  A showcase demonstrating only the lesser verdict teaches that the distinction is decorative —
  which is the one thing this product may not teach, since keeping those two answers apart is most
  of what it claims to be for.
- **Every artifact was produced by the real commands**, not hand-written: `loam new`, `loam rebase`,
  `loam gherkin` (which is where the five scenario digests came from), `loam verify --results`, then
  `loam archive` — snapshot, manifest and all. The `scenario-report.json` beside the record is a
  real `loamScenarioReport` file, and the record's `report:` block carries that file's true sha256.
- Its two `event.declares` claims still rest on an agent's word, and it is `verified` anyway — the
  verdict turns on the scenario claims alone. That mix is the honest common case: a suite that
  answers the scenarios, and wiring claims a human vouches for.
- The fleet still reports **0 errors and exactly the same ten deliberate warnings**: the merge
  disturbed nothing. `test/examples.test.ts` now pins both verdicts and asserts they stay different,
  so "fixing" the example by making both sides agree fails the suite.
- `examples/README.md` also separates two words that were being read as one: a SERVICE's ladder rung
  (`draft` → … → `vouched`) is not a feature's verdict. FEAT-120 is `verified` in a fleet whose
  services are all `draft`, which is exactly where a team stands the day its first suite goes green.

### `docs.binary-behind` — the run that reports green without having graded the corpus

- **New finding `docs.binary-behind` (warn)**, on `loam validate --all` and `loam doctor`: the docs
  repo's `AGENTS.md` stamp names a loam NEWER than the binary reading it.
- **It is the only finding that changes what a PASS means rather than reporting a defect.** Every
  check loam has is an existence constraint over a value the parser recognised, so a binary that
  predates a grammar addition does not fail on the newer directive — it reads it as prose, produces
  no join, and reports green. Until now nothing said so: `agents.stale` grades only the opposite
  direction, and explicitly declined this case because the fix is different (upgrade the binary, do
  not edit the file).
- **Warn, not error**, on the `sources.stale` doctrine: a mixed-version fleet is ordinary, and
  failing every command in that repo aims a refusal at the wrong person. `--strict` is the lever
  for a fleet that wants it to gate. The message says plainly that a pass from this binary is
  incomplete rather than clean, and never sends anyone to edit `AGENTS.md`.
- Prerelease identifiers are compared, not ignored — in a 0.x product a prerelease is exactly where
  a generated file's form and a corpus grammar actually move, which `agents.stale` already learned
  the hard way at beta.2.

### Any test runner can answer a scenario claim

- **`--results` now also accepts `{"loamScenarioReport": 1, "results": [{"digest": "…", "status":
  "passed", "test": "…"}]}`**, chosen by its marker key, beside the cucumber JSON it already read.
  `digest` is the `@loam-digest-…` tag `loam gherkin` stamped; `status` is `passed` or `failed`;
  `test` is optional free text used as the evidence string.
- **This is a widened input dialect, not a weakened standard of proof.** The contract was never
  cucumber's JSON — it is the content-derived digest plus a status saying a real run reported it
  green, and both halves are present here. An answer from this shape is `answered_by: runner`,
  identical to a cucumber one, because it is the same claim answered to the same standard by the
  same identity. A fleet on JUnit, pytest, Playwright, Vitest or a house runner was previously held
  at `attested` **by a file format**, which is the one thing that distinction was never meant to
  mean.
- It adds no forgeability: loam cannot prove any JSON came from executing a commit — which is why
  the record stores the file's sha256 and mtime and claims nothing more — and a hand-written
  cucumber array was always exactly as easy to write.
- **Parsing is strict, and a `skipped` status is refused rather than guessed.** A scenario that did
  not run has no place in an answer sheet; omitting it leaves the claim unanswered rather than
  confirmed. A file carrying the marker is always graded as that shape even when malformed, so an
  author is told the real mistake instead of "this is not a cucumber array".

### Two corrections from review, before either shipped in a release

- **`spec.unknown-directive` no longer fires inside a fenced block.** A requirement body
  legitimately holds a fenced example, and inside one `Realises:` is a sample value rather than a
  misspelled directive — the check convicted a document that was exactly right, which is the one
  thing a near-miss guard may never do. Backtick and tilde fences both toggle; a real typo after a
  closed fence is still caught. Table cells never fired (a pipe-led line does not match the
  candidate pattern) and there is now a test saying so.
- **`verify.checklist-forked` is measured against the current checklist, not pairwise between
  attestations.** The pairwise reading answers the wrong question: three services that all attested
  against a since-rewritten delta agree with each other perfectly and are every one of them stale,
  which pairwise called clean. The notice now names the services whose answers are not about the
  questions being asked now. Differing `docsCommit` values remain **not** a finding — recording a
  week apart is normal for a feature in flight.

### A grammar guard: `spec.unknown-directive`

- **New finding `spec.unknown-directive` (warn)** — a requirement body line whose key is one or two
  edits from a directive and is not one: `Realises:`, `Capabilties:`, `Opertaions:`, `Publsihes:`.
- This was the one place the corpus was quieter than it looked. Every join is an existence
  constraint over a *parsed* value, so a key the parser does not recognise yields no value, no join
  and therefore no finding — the requirement claims to realize a promise, gets nothing, and validates
  clean. It is the judgement `obligation.unknown` already makes one axis over ("a mistyped tag reads
  exactly like a rule"), applied to the keys themselves.
- **Measured by edit distance, not by shared prefix**, deliberately: `closeIds`'s three-character
  prefix rule would report `Context:` as a near miss for `Consumes:`, in a check whose entire value
  is that it does not cry wolf. `Note:`, `Owner:`, `Rationale:`, `Status:` and `See:` are silent,
  and the example fleet's warning count is unchanged at ten.

### An attestation says what it answered, and against what

- **Two optional keys on each `ServiceAttestation`**: `checklist` (the digest that attestation
  answered) and `docsCommit` (the docs-repo HEAD it was derived from, when the docs repo is a git
  checkout). `commit` already pinned the service repo — the code the evidence points into — and
  nothing pinned the side the *question* came from.
- **New finding `verify.checklist-forked` (warn)** — two or more services on one record answered
  different versions of the feature's question set. The record carried a single top-level
  `checklist` digest, so this state could not be represented at all: the staleness check flagged
  both services or neither, and never said which answers went stale.
- **An attestation with no `checklist` field is not counted as a third version.** Silence is not
  disagreement, and reading it as such would fire this on every federated record written before the
  field existed. `docsCommit` is omitted rather than refused when the docs repo is not a git
  checkout — a docs repo is not obliged to be one.

### The pages say where loam is behind, not only where it is ahead

- **README's "Why" now carries what green does *not* mean**, pointing at
  `src/core/brief/unchecked.ts` — the fifteen statements of what no check will ever tell you, which
  the binary already prints into the adoption brief and no page had ever quoted. Completeness is the
  one worth naming out loud: forty behaviours documented as one requirement passes every check loam
  has. The `verified`/`attested` distinction moved up beside it.
- **COMPARISON.md gains "The wider field, and who is actually nearest"** — OpenFastTrace, Doorstop,
  Pact Broker, Backstage, EventCatalog, oasdiff/buf, StrictDoc/Sphinx-Needs and ArchUnit, each with
  the mechanism it shares and **who is ahead at it**. The page compared loam only to OpenSpec, which
  is the nearest tool on one of loam's seven joins and on none of the other six. Two entries are
  direct credit: OpenFastTrace put the version inside the coverage token years ago, and Doorstop
  stored a parent's fingerprint on a link thirteen years before `capability.realizes-stale`.

### A living `Realizes:` pin, so a moved promise stops being invisible

- **New finding `capability.realizes-stale` (warn).** A `Realizes:` entry may now carry the digest of
  the capability requirement it was written against — `Realizes: checkout#CHK-1@9f2c1a4b` — and
  `loam validate` reports one warning per pinned entry whose target has been rewritten since. Until
  now every capability check was an EXISTENCE constraint: `capability.realizes-unknown` fires when
  the target is *gone* and stays silent when the target merely *changed*, so an analyst could narrow a
  promise and every requirement claiming to keep it went on claiming so, in a corpus loam rewrote
  itself. It is a warn and not an error because re-reading a moved promise has three legitimate
  outcomes and loam cannot tell which; it never gates `loam archive`.
- **New flag `loam rebase --living`**, which writes and refreshes those pins across the living
  corpus and takes no feature id — so `rebase`'s `<FEAT>` argument is now optional, and every
  existing invocation still parses. It commits through the same journaled transaction as every other
  writer, under the same docs lock, and rewrites exactly one `Realizes:` line per requirement that
  already has one: it never invents a join on an author's behalf. Its stored rerun is
  `loam rebase --living`. `--service <id>` and `--dry-run` apply.
- **Nothing changes for a corpus that has not been pinned.** An entry without a pin grades exactly as
  it did before, forever, which is what lets this land with no migration.
- **`requirementDigest` now strips `Realizes:` pins as well as `Based-On:` lines.** Both are
  bookkeeping a requirement carries about its own joins, and a digest that moved when bookkeeping
  moved would make every pin self-invalidating — one `rebase --living` would go on to invalidate
  every `Based-On:` baseline in the fleet. The pinned and unpinned spellings of a requirement
  therefore digest identically, which `test/capability-realizes-pin.test.ts` asserts directly.

### The first hour starts from the fleet spine

- **`examples/fleet.yaml`** ships as a real `loam seed` input for the five-service example fleet, and
  **WORKFLOW.md's day zero step 2 now names `loam seed --from fleet.yaml`** instead of telling a
  reader to draw `architecture/landscape.likec4` by hand. `seed` has shipped since beta.1 and
  appeared in exactly one place in the prose: a command-table row.
- **README leads with two entry points that pay off before adoption starts** — "Start from the fleet
  spine" (seed, drop in the OpenAPI you already have, name the operation on each call edge, then
  `validate --all` convicts `spine.op-undefined` with no requirement Markdown anywhere) and "Guard
  the fleet's edges on every PR" (a copy-pasteable GitHub Actions job around `loam diff --base`,
  which exits 1 on a removal the fleet still consumes). Both state plainly that the run is red:
  `service.no-model` and `service.no-spec` are what a fleet at the bottom rung honestly looks like.
- **`test/spine-first.test.ts`** pins that sequence against the shipped `examples/fleet.yaml`,
  including the exact counts of the expected `service.no-model` and `service.no-spec` findings, so
  the documented first hour cannot drift from the binary.
- One stale cross-reference fixed: WORKFLOW.md sent readers to "the README's `loam diff` command
  note" for the oasdiff invocation, which lives in WORKFLOW.md's own command notes.

### Documentation — the pages say what the binary does, and four more claims are checked

- **README is the front door again, not the manual.** It carries the pitch, the install, the
  five-minute trial, one table row per command **with every flag the binary registers**, and links.
  Day zero, the per-command notes, the archive-protection walkthrough and the MCP server moved to
  [WORKFLOW.md](WORKFLOW.md); the fleet scorecard to [SCHEMA.md](SCHEMA.md); the measured fleet-run
  costs to `docs/BENCHMARKS.md`. Nothing was deleted, and the page is 53% shorter.
- **Five drift fixes, each one a claim that had stopped being true.** `loam list glossary` was
  missing from the command table; thirteen shipped flags were named on no page; the example fleet's
  headline read "0 errors, 7 deliberate warnings" against a fixture that has reported ten since the
  glossary and obligation axes landed; `loam mcp`'s prose listed eleven read commands after
  `loam_explain` made twelve; and SCHEMA's layout block — the tree readers take for the whole map —
  never drew `architecture/obligations.yaml`, `glossary/<term>.md`, `features/<FEAT>/glossary/`,
  `features/<FEAT>/capabilities/<cap>/spec.md` or `features/<FEAT>/specs/<svc>/asyncapi.yaml`.
- **Four new pins in `test/docs-facts.test.ts`, placed where the drift actually happened**: every
  registered long flag is named in README, the `loam list` row's sections equal the CLI's, SCHEMA's
  layout block names every artifact path `src/core/repo/` still builds, and the example fleet's
  counts are read out of `test/examples.test.ts` rather than carried as a fourth copy. Each was
  checked by breaking the fact it guards and watching it fail.
- **A derivable count no longer has a dated exemption.** ROADMAP's assessment claimed 261 modules
  and 21 commands for nine days against a tree holding 394 and 28, legally, because a dated heading
  covered counts that derive from one readdir. Only a passed/total test count keeps the exemption
  now; module, package, test-file and command counts are graded live on every page.
- **Every Markdown page wraps at 100 columns**, fences, tables and headings excepted, so a prose
  change reviews as a line-sized diff. The phrase assertions in `docs-drift`, `docs-facts` and
  `agent-contract` match through a whitespace flattener, which is what makes the wrap a formatting
  decision rather than a test-breaking one.
- **`[Unreleased]` states its changes rather than arguing them**, under a contract that is checked
  rather than promised: every code, flag, path and command an entry introduced — every one written
  in bold, which is how this file marks its subjects — is still named by the entry. What left is the
  argument, 31,342 words down to 12,572. One `ALLOWED_PROSE_TOKENS` entry was pruned with it,
  because the sentence carrying it was the case for a change, not the change.

### Added — architectural obligations: what the architect hands the team, for the rules that vary

- **`architecture/obligations.yaml`** declares the fleet's architectural obligations —
  `obligations: {<id>: {description, adr}}` — and a **`#obl-<name>` tag** on an element or an edge
  in `architecture/landscape.likec4` says where each one applies. loam had exactly one checked
  architect→team channel before this, and it works: an edge carrying `metadata { op }` obliges the
  provider to define that operationId or `spine.op-undefined` fails the gate.
- **`obligation.uncovered` (warn) is the prerequisite the roadmap named, discharged.**
  `c4.uncovered` could always say "this architecture object owes a requirement" — but only about a
  NEW tagged element in a feature's `delta.likec4`, never about the map the fleet actually runs on.
- **`obligation.unknown` (error) and `obligation.unapplied` (warn)** are the same join read in both
  directions, with the asymmetry `permissions.unknown`/`permissions.unenforced` already carry: a tag
  that resolves to nothing reads exactly like a rule the fleet keeps, while a declaration nobody has
  placed yet is an honest state.
- **`obligation.adr-missing` (error)** — an `adr:` field naming no file.
- **`obligation.invalid` (error)** suspends the family, as the permission and capability
  vocabularies' invalid states do.
- **The file is the opt-in**: a fleet without `architecture/obligations.yaml` produces no obligation
  finding at all, however many tags its map already carries.

### Added — a feature brings its own words, and the merge keeps their links pointing at them

- **`features/<FEAT>/glossary/<term>.md`** is copied into `glossary/` by `loam archive` and removed
  again by `loam unarchive`, so the vocabulary a change introduces ships and unships with it and is
  reviewed beside the requirements that use it.
- **The route is CREATE-ONLY**, and that is a decision rather than an unfinished half.
  **`glossary.term-exists` (error)** refuses a term the living glossary already defines, and
  **`--approve` does not override it** — approving it would be approving a deletion nobody
  described.
- **A feature may cite the word it is introducing** at that word's future living path.
- **`loam archive` now re-expresses relative links in the text it moves**, and this closes a defect
  that predates the glossary.

### Added — the domain glossary: `glossary/<term>.md`, checked through the links that cite it

- **`glossary/<term>.md`** is the fleet's domain vocabulary — one FILE per term, nesting allowed
  (`glossary/payments/authorization.md` is the term `payments/authorization`), and **no
  `glossary.yaml` anywhere**.
- **`glossary.unlinked` (warn)** — a term no document outside `glossary/` cites: a word the fleet
  never adopted, or a definition left behind by a rename.
- **A whole glossary nobody cites is ONE finding**, not one per term.
- **`loam list glossary`** — a fourth explicit-only section beside `capabilities`.

### Added — a markdown link is a join, and `loam validate` now resolves it

- **`link.unresolved` (error)** — a relative markdown link in an authored document whose target does
  not exist.
- **The corpus is every authored markdown document**: both spec axes living and delta, `runbook.md`,
  every `adrs/` file at all three altitudes, `intent.md`, and each capability document.
- **`link.unreadable` (error)** — a document in that corpus that could not be decoded, almost always
  UTF-16 (PowerShell's `>` and `Out-File` write it unasked).

### Added — `loam archive` refuses a business promise nothing keeps, in both directions

- **`capability.uncovered`** — a feature ADDS a capability requirement and no `Realizes:` line in
  the same feature's service deltas names it.
- **`capability.remove-requirement-realized`** — the same join taken in the removal direction, and
  it closes a hole that used to archive at exit 0: a feature removing a capability requirement that
  a living service requirement still realizes merged cleanly, and the next `loam validate --all`
  then failed with `capability.realizes-unknown` against a service document nobody had touched.
- **`loam status --json` gains `capabilities` artifact rows** (additive; present only when the
  feature carries the directory, with an optional `capability` key).

### Added — a feature can change a capability, and `loam archive` merges it

- **`features/<FEAT>/capabilities/<cap>/spec.md`** carries a delta against the living
  `capabilities/<cap>/spec.md`, in the requirement grammar and delta algebra every service spec
  already uses: `## ADDED|MODIFIED|REMOVED Requirements`, `Requirement-ID:` identity, `Based-On:`
  pins.
- **`loam rebase` learned the capability axis**, because `delta.baseline-missing`'s own message
  tells you to run it. Additive `--json` keys: `capabilities` and `capabilityPins` (a `PinOutcome`
  carrying `capability` instead of `service`).
- **The three capability-document rules now gate archive**, not just `loam validate`:
  `capability.requirement-unidentified`, `capability.requirement-service-scoped` and
  `capability.requirement-inert-join` are graded on the DELTA as well as on the living document.
- **A `--json` nuance worth knowing:** `Issue.subject` on a `delta.*` code no longer always names a
  service.
- **A fleet with no `features/*/capabilities/` sees no change and pays nothing** — one `existsSync`
  per feature, no read, no finding.

### Changed — `loam list capabilities` and `loam validate` now give the SAME answer to "is this promise kept"

- **`loam list capabilities --json` carries both corpora.** Each `requirements[]` row gains `keptBy`
  (additive): the ids of the `#cap-`/`#req-` tagged flows that keep that promise, beside the
  `realizedBy` service requirements that realize it.
- **An unreadable `architecture/` degrades rather than refusing.** The rows themselves come from
  `capabilities.yaml` and `capabilities/`, both readable, and `validate --all` already reports the
  broken document as `landscape.invalid` — so the listing prints what it has and marks the flows
  unread.
- **`capability.unrealized` counts flows too.** A capability whose every promise is kept by a tagged
  flow, named by no service requirement at all, was being told it was "a promise nobody implemented
  or a word nobody adopted" while loam's own report said the promise was kept.
- **Bare `loam list --json` is byte-identical**, and pays nothing: the capabilities section stays
  explicit-opt-in, and the flow read keeps its byte-scan gate in front of any LikeC4 load.

### Added — `#req-`: a use case can keep a business promise, which is the only way a cross-service one gets kept

- **A `dynamic view` already tagged `#cap-<slug>` may now carry `#req-<slug>`**, naming one of that
  capability's requirements.
- **`usecase.requirement-unresolved` (error)** — six failures with six fixes, and the message says
  which happened: no resolved `#cap-` tag, two of them, a capability with no document, a document
  with no requirements yet, an id that document does not declare (close ids offered, each already
  spelled as the tag to write), or two ids flattening to one slug.
- **A tag name accepts exactly `[A-Za-z0-9_-]`, measured at the `likec4@1.59.2` pin**, so the slug
  rule is now a whitelist rather than "flatten a slash": a `Requirement-ID` may legally contain a
  `.`, and a capability id its `/`.
- **Only a RESOLVED claim keeps a promise.** A broken `#req-` tag suppresses nothing, so
  `capability.requirement-unrealized` goes on firing beside the error — a typo that silenced it
  would turn a mistake into a green fleet.

### Added — `Realizes:`, the join that makes the business tree checkable

- **A service requirement says which promise it serves**: `Realizes: checkout#CHECKOUT-CHARGE-ONCE`,
  a list line resolving against a requirement in `capabilities/<cap>/spec.md`.
- **The separator is the LAST `#`, not the first.** The requirement half's grammar excludes `#`
  while a capability id is a YAML key and a directory name and is constrained nowhere, so splitting
  at the last one is unambiguous for every id there is.
- **`capability.realizes-unknown` (error)** — the entry names no capability requirement.
- **`capability.requirement-unrealized` (warn, fleet scope)** — a capability requirement no living
  `Realizes:` line names, one warning per requirement, subject `<capability>#<id>`.
- **`capability.requirement-inert-join` (error)** — a requirement in a capability document carrying
  `Capability:` or `Realizes:`.
- **Realizing a REQUIREMENT realizes its capability.** A requirement carrying only `Realizes:`
  counts toward `capability.unrealized`, and one carrying both joins is counted once.
- **`loam list capabilities --json` gains `requirements[]` per capability** (additive), each with
  what realizes it.

### Added — `capabilities/<cap>/spec.md`: the business tree an analyst can actually write in

- **A capability may now be declared by a DOCUMENT, not only by a name in
  `architecture/capabilities.yaml`, and the vocabulary is the union of the two.** Nothing is removed
  and nothing is deprecated: a fleet that declares twenty names in YAML and has written four
  documents is the normal state of an adoption, and both sides grade.
- **The directory IS the list.** A directory under `capabilities/` is a capability if and only if it
  holds `spec.md`; nesting is spelled by the tree, so the id `payments/refunds` lives at
  `capabilities/payments/refunds/spec.md` and `payments` may be a capability in its own right beside
  it. There is no manifest, for the reason `loam init`'s removed `loam.docs.json` was removed: a
  second list is a second thing that can disagree.
- **The opt-in widened, so a fleet can start grading capabilities without touching the YAML.**
  `architecture/capabilities.yaml` was this axis's only opt-in; now either file is.
- **`capability.doc-missing` (warn)** — a directory under `capabilities/` holding neither the
  document nor a capability beneath it: what `mkdir` leaves behind halfway through creating one.
- **`capability.requirement-unidentified` (error)** — a requirement in a capability document with no
  `Requirement-ID:`.
- **`capability.requirement-service-scoped` (error)** — a capability requirement carrying
  `Operations:`, `Covers:`, `Publishes:` or `Consumes:`.
- **The authored tree's own grades are not suppressed behind `capability.invalid`.** The suppression
  exists to stop a cascade of grades resolved against a file nobody can read; a directory holding no
  document, and a requirement with no stable id, consult no vocabulary at all.
- **What is NOT in this release, each owned by the roadmap:** the `Realizes:` join from a service
  requirement back to a capability requirement, the feature-local
  `features/<FEAT>/capabilities/<cap>/` delta merged by the transactional archive, and
  `loam new <FEAT> --capability <cap>`.

### Changed — a use case is now a CONSUMER, so `loam diff` can refuse where it used to warn

- **Read this one before upgrading CI.** A use-case hop is now a consumer, so a removal whose ONLY
  consumer is a step in a `#cap-`-tagged flow moves from `diff.op-removed` (warn, exit 0) to
  `diff.op-removed-consumed` (error, exit 1) — the same removal, the same command, a different
  verdict. A repository with tagged use cases may see `loam diff` start failing a pipeline that
  passed.
- **A CONTESTED hop is never a victim.** When the relationships backing a hop disagree about the
  operation, a removal touching it is reported as a suspension rather than as a broken flow: silence
  would claim nothing depends on it, and a victim would claim something does.
- **`loam context` gains one new exit-1 condition**: `architecture/` failing to parse as a LikeC4
  project is now a hole in the pack.
- **`loam diff` spends no new code for any of this.** Use-case victims ride the `details[]` of the
  two codes above, naming the flow, the hop number, the step title and the file:
  `use case 'uc_checkout' step 4 'authorizes the payment' (architecture/usecases/checkout.likec4)`.

### Added — the blast radius of a feature, in hops

- **`loam delta` and `loam status <FEAT>` gain a `useCases` key** (additive; nothing removed): the
  flows whose hops touch a service the feature addresses, each with its ordered steps and the
  services each step resolves to.
- **The landscape is loaded lazily**, because `loam delta` sits in `/loam-implement`'s hot path and
  a LikeC4 workspace spin there is felt on every iteration.
- **`loam context` and `loam explore --capability` see flows too.** The pack carries `useCaseSteps`
  for the service it is packing and `capabilities[].useCases` fleet-wide, and an `architecture/`
  that will not parse becomes a **hole** rather than an absence — the pack says it could not look,
  never that there are none.

### Added — a home for fleet-level decisions, and one way to link between documents

- **`architecture/adrs/NNNN-*.md` — ADRs about the fleet.** They existed at exactly two altitudes
  before this: a service's own decisions and a feature's.

### Added — `loam validate --all` grades a business use case, hop by hop

- **A `dynamic view` tagged `#cap-<slug>` is now a checked use case**, and four new stable codes
  grade it.
- **`usecase.step-unbacked` (error)** — a hop the model does not declare.
- **`usecase.capability-unresolved` (error)** — a `#cap-` tag that names no declared capability, or
  two.
- **`usecase.step-contested` (warn)** — the relationships backing one hop disagree about the
  operation, listed as candidates. It suppresses `usecase.step-unlinked` for the same step,
  structurally rather than by rule — the warn is derived from the attributed verdict, and the two
  verdicts are disjoint.
- **`usecase.step-unlinked` (warn)** — a backed hop that names no operation of the provider's
  contract, grouped under the OpenAPI adoption axis.

### Changed — the source-file limit is 400 lines, up from 300

- **A house limit, not a published contract — but it is in `CONTRIBUTING.md` and `AGENTS.md`, so it
  is stated here.** `test/code-limits.test.ts` now fails a `src/` file over **400** lines rather
  than 300.
- **What moved it was a measurement.** Across 359 files in `src/` the median was 150 and p90 was 283
  — and **thirteen files sat at exactly 300**, with sixteen more between 290 and 300.
- **400 rather than 500 or 600, because a ceiling has to keep asking.** The case for having one is
  that `src/core/agent.ts` reached 2,387 lines with nothing asking; at p90 283 a 500-line ceiling
  would be inert for years.

### Changed — `architecture/` is read as one LikeC4 project, so a use case can live in its own file

- **`validate --all` now loads `architecture/landscape.likec4` together with every
  `architecture/usecases/*.likec4` as ONE project**, the way the LikeC4 renderer has always read
  that directory.
- **Why a file of its own, rather than the landscape's `views { }` block.** Readability is the
  visible half — an analyst opens `usecases/checkout.likec4` and reads one business flow instead of
  scrolling a fleet-sized map.
- **Diagnosis improves rather than widening.** A typo'd element in a use-case file is attributed to
  THAT file: `landscape: architecture/usecases/checkout.likec4 has 2 error(s)`, and when more than
  one document is broken every detail line carries its own file.
- **Two authoring rules invert inside `architecture/`, and both are enforced by LikeC4 rather than
  by loam.** Exactly one document declares the `specification` block: every `.likec4` file loam
  parses alone must declare its own, while a second declaration inside one project is a duplicate
  error blamed on BOTH files (measured).
- **The generated `architecture/subsystems.likec4` is excluded from that project**, and
  docs/DESIGN.md rule 26 already said why: it stays a byte compare, and loam reads its contents in
  no document.
- **No new command, no new flag and no `--json` key for THIS change** — the loader is a mechanism,
  and the codes that grade on it are the use-case section above.

### Fixed — a service filed under a subsystem was named at a directory that does not exist

- **Every message that names an existing service's directory now spells it from the enumeration.**
  `services/<id>/` is right for an unfiled fleet and wrong for every filed one: a service under
  `services/platform/` lives at `services/platform/<id>/`, and eight separate messages joined the
  root form anyway — so `loam status` told a reader to go to `services/checkout-web/` when the
  directory was `services/commerce/checkout-web/`, and `loam gate --service identity-service`
  reported on `services/identity-service/` for a service at `services/platform/identity-service/`.
- **Eight sites, one rule.** `loam status`'s two adoption rungs, `loam gate`'s target and partner
  rungs, `loam validate --all`'s `landscape.service-unmodelled` and the datastore-placement fix in
  `fleet-shape`, the `loam adopt` brief's landscape instruction and artifact shape, `loam vouch`'s
  confirmation prompt, and `loam seed`'s "left exactly where it is" line — which was the worst of
  them, because that sentence is ABOUT placement.
- **`serviceTreePath` in `core/kernel/ids/dirs.ts` is that implementation**, with
  `serviceTreePathOf(docsDir, id)` beside `locateServicePaths` for callers that hold only an id.
- No new code, no new flag, no `--json` key: every change is message text and the internals that
  feed it.

### Added — a docs repo now scaffolds a README, the one file in it addressed to a person

- **`loam init --create` writes `README.md` first.** Everything else a docs repo starts with is
  either a document about the fleet or `AGENTS.md`, which runs to some 1500 generated lines and is
  named so that a human does not open it.
- `migrate-openspec` stages the same file, because its target is meant to be the docs repo
  `loam init` makes.

### Fixed — an authored view id could take the whole fleet map down while the gate printed green

- **`validate --all` now refuses a landscape view whose id loam generates**
  (`subsystem.view-id-collision`, **error**, one finding per colliding id, fleet scope).
- **Exactly one pair is compared, and that is the measured scope rather than a simplification.** A
  duplicate view id *inside* one document is already two LikeC4 errors, so `landscape.invalid` has
  had it all along (measured).
- **The check asks the generator what it mints.** `core/repo/tree/views.ts` now exports its id
  function and the `subsystem_` prefix instead of keeping them private, because a check carrying its
  own copy of that escaping would go quiet the day the encoding changed — and going quiet is the
  failure this whole family exists to prevent.

### Changed — the view doctrine narrows: loam reads what a view DECLARES, never what a view SHOWS

- **`docs/DESIGN.md` gains rule 26, and the written doctrine finally matches the enforced one.**
  loam's prose said it "never parses views"; what it actually never does is COMPUTE one.
- **Nothing is asked of any fleet, and nothing grades a views block's absence.** A repo that
  declares no dynamic view owes loam nothing, today or ever; `loam init` still scaffolds no `views`
  block — and that stays true after the use-case section above, whose four codes grade only a view
  somebody deliberately tagged. **Rule 26 itself adds no command, no flag, no stable code, no
  `--json` key and no severity change** — it records a boundary, not a behaviour.
- **`npm run arch:check` gains a `view-stage` scan, so the doctrine is a failing build rather than a
  paragraph.** `computedModel` and `layoutedModel` may not appear in `src/` at all (zero
  occurrences, so no whitelist — the one mention is inside a comment, which the scan's `codeOnly`
  blanks), and `$data` may appear only under `src/core/c4/parsed/`, which confines the blast radius
  of an upstream shape change to one module.
- **`test/likec4-view-shape.test.ts` pins the parsed record's shape at the `likec4@1.59.2` pin,
  written before any reader exists.** Ten measured facts, each load-bearing: LikeC4 synthesises an
  `index` view into every document (`_type: "element"`, no `sourcePath`) that a reader must ignore;
  a `<-` reply is recorded reversed AND flagged `isBackward`, while a forward step carries no such
  key; a `loop` is a nested entry with no endpoints and no `astPath` of its own; an untagged view
  reads `tags: null`; a step carrying `metadata` is a parse error, and a `#cap-` tag written after
  `title` is five of them.
- **loam now READS a declared `dynamic view`, and grades nothing on it yet.**
  `src/core/c4/parsed/dynamic-views.ts` normalizes the parsed record into `ParsedView`/`ParsedStep`
  — id, tags, title, description, and ordered steps carrying `source`, `target`, `title`, `notes`,
  `isBackward` and `astPath` — and it is the only module permitted to touch `$data`.
- **`astPath` is carried but optional, and that is a refusal rather than an oversight.** Every leaf
  carries one at the pin, so requiring it would look free — and would mean that an upstream release
  which stopped emitting the field turned every use case in the fleet into a view with zero steps at
  exit 0.
- **Two modules split, no behaviour changed.** `core/c4/likec4.ts` reached the 300-line limit, and
  the seam was already in it: resolving an element id to the `services/<id>/` directory it stands
  for is a distinct phase from loading a document, and runs over loam's own records rather than
  LikeC4's — it moved verbatim to `core/c4/resolve/service.ts` (28 importers rewritten, 22 of them
  one line longer, which is what splitting a widely-imported module costs and is not payable by
  squeezing a comment).
- **`SCHEMA.md`'s planned `services/<svc>/flows/` tree is retired rather than built.** A
  cross-service interaction flow is a `dynamic view` in `architecture/landscape.likec4` — the one
  document that already holds every cross-service edge.

### Fixed — a tag declared on a LikeC4 specification KIND could switch the fleet gate off

- **`validate --all` no longer reports a fleet it has stopped checking as agreeing.** LikeC4 1.59.0
  added tags on specification kinds, and 1.59.2 applies them to every element of the kind before
  loam sees anything: `specification { element softwareSystem { #external } }` puts `#external` on
  every `softwareSystem` in the document. loam reads `#external` as "deliberately not ours — stop
  grading it", so those six words silenced the landscape↔services reconciliation for the whole fleet
  at once, and the run ended on `landscape.matched` — *"N service(s) modelled —
  architecture/landscape.likec4 and services/ agree"* — over a map nothing had checked.
- **One new stable finding code, `landscape.kind-tag-graded` (error).** It fires when the
  landscape's `specification` block declares `#external` or `#platform` on an element kind **and**
  at least one element of that kind stands for a real `services/<id>/` directory — by an explicit
  `metadata { service }` binding, or by a title naming one.
- **A graded tag on a kind is still legal where it exempts nothing of ours** — and it has to be:
  `examples/docs/architecture/landscape.likec4` declares `element topic { #external #platform }` so
  that the Kafka topics nested inside an external broker do not each demand a
  `services/payment.events/` nobody owes, and that spelling is the one that scales.
- **`loam archive` now refuses a delta that declares its own feature tag on a kind**
  (`merge-failed`, exit 1, nothing written).

### Fixed — a feature delta's non-model blocks were silently discarded on archive

- **`loam archive` now refuses a delta whose `deployment { }` or `global { }` block, or whose
  `dynamic view`, the landscape merge cannot carry** (`merge-failed`, exit 1, nothing written;
  `--approve` does not override — the loss is mechanical, not a judgement about coherence).
- **A static `views { }` block is still accepted and still not merged** — `loam new` scaffolds one
  into every delta, and it is meant to be rendered while the feature is in flight rather than to
  travel.

### Added — `loam seed`: the fleet map templated from human-stated facts

- **New command `loam seed [--from <file>] [--json]`** — a tiny human-authored `fleet.yaml` (a
  `services:` list of ids, optional `subsystems:`, `externals:` and `calls:` lines like
  `checkout -> payments`) templated mechanically into `architecture/landscape.likec4` — one
  `softwareSystem` per service bound with `metadata { service '<id>' }`, `#external` systems, plain
  edges, the scaffold's own two views — plus one `services/<id>/` directory per service (under its
  subsystem where one is declared, with the marker and the regenerated
  `architecture/subsystems.likec4` in the same commit), all in one journaled transaction under the
  docs lock.
- **Seed never overwrites human work.** It writes the landscape only when the file is absent, is the
  scaffold's untouched stub, or carries seed's own line-1 stamp (`// loam-seed sha256:<digest of the
  rest>`) with a matching digest — a self-verifying record, no state anywhere else.
- **`loam status`'s empty-fleet teaching ladder now names the mechanical path**: the
  `next.author-landscape` rung over an untouched scaffold stub teaches `loam seed --from fleet.yaml`
  alongside authoring by hand.

### Added — the single-repo trial: `loam init` teaches the first hour

- **`loam init`'s human output now ends with the first-hour sequence** —
  `loam adopt --service <id> --json` → `loam validate --service <id>` → `loam vouch --service <id>`
  → `loam status`, each with a one-line reason — printed exactly when a single run both creates the
  docs repo (`--create`) and ends with a service bound (`--service`, or a binding the repo's
  existing `loam.json` already carried): the composition of the README's new five-minute trial.

### Added — `loam explain`: the vocabulary wall, answered from the binary

- **New command `loam explain [<subject>] [--json]`** — what a finding code, a refusal code or a
  loam concept means, without a docs repo and without wiring: like `loam instructions` it reads no
  `loam.json`, because the vocabulary wall is hit in the first minute in an unfamiliar repository. A
  finding code (`spine.op-undefined`) answers with the /loam-check fix table's own row — severity
  note, "what it means" and "what to do" verbatim, plus the `loam validate` invocation that surfaces
  it where the adoption brief knows one — **parsed at runtime from the same workflow body the binary
  ships**, so the explanation cannot drift from the documentation; a code graded in more than one
  table (service scope and `loam archive` plan time, say) explains every context.
- **`loam validate` and `loam verify` text reports gain a one-line footer** — `` → codes ride in
  `--json`; `loam explain <code>` says what one means and how to fix it `` — printed only when a
  non-ok finding (validate) or a notice (verify) was printed, appended as the report's last line,
  and only in text mode: every `--json` payload is byte-identical to before.
- **`loam mcp` gains `loam_explain`** — the read-tool table grows to twelve; one optional `subject`
  argument, read-only like the rest.

### Added — `loam list --subsystem` and `--owners`: the adoption campaign, sliced by group and by team

- **`loam list` gains `--subsystem <name>`** — the services section limited to one subsystem's
  services, at any depth, resolved against the same flat namespace every `loam subsystem` verb
  reads.
- **`loam list` gains `--owners <path>`** — a mechanical, read-only join of each listed service's
  directory to the owning teams in the user-named CODEOWNERS file (loam still has no permission
  model of its own; the forge's file stays the authority). `--json` gains the additive `owners` key:
  `path`, `teams[]` (owner plus that team's services in the listing's own filtered-and-ordered row
  order — the per-team campaign worklists), `unowned[]` (rows no rule matched, listed explicitly),
  `skippedRules[]`.
- **One new stable refusal, `owners-unreadable`** (exit 1): the CODEOWNERS path cannot be read, or a
  line in it cannot be parsed as `pattern owner…` — the message names the path and line.
- Considered and deferred: joining `features/**` to teams (the campaign worklist is services-only
  until someone asks), and any wider CODEOWNERS pattern grammar — implementing the fleet-wide `*`
  default above all — a half-implemented glob would attribute services the forge never did, so the
  subset grows only deliberately, with its own CHANGELOG line.

### Added — the axis-adoption rollup on `validate --all`

- **`loam validate --all --json` gains the additive `adoption` key on the `scorecard` payload** —
  services participating in each contract axis (`requirements`, `arch`, `openapi`, `asyncapi`,
  `permissions`, `capabilities`), one mechanical rule per axis (a requirement block for the two spec
  axes, file presence for the two contract files, a non-REMOVED `Requires:`/`Capability:` entry for
  the two vocabularies), the denominator carried once as the payload's existing `services` count.
- **Text mode groups the warnings a fleet-wide not-started axis alone causes under one banner per
  axis** — e.g. a freshly declared capability vocabulary's per-capability `capability.unrealized`
  warns collapse to
  `⚠ capabilities axis not started fleet-wide (0 of N services), expected during staged adoption — k warning(s) grouped: …`.

### Added — `loam vouch --sample <n>`: a partial read, recorded as one

- **New flag `loam vouch --sample <n> [--service <id>] [--yes] [--json]`** — vouch after reading a
  deterministic sample of `<n>` sections per spec-axis file, instead of the whole document.
  `--sample` never loosens attendance — no TTY and no `--yes` is still `vouch-unattended`, `--json`
  without `--yes` still refuses, and vouch stays off the generated agent allowlist.
- **The scope is stamped beside `vouched_by`, never inside `status`** — a new frontmatter field
  `vouch_scope: sampled <k>/<n> seed=<16 hex>`, written by `loam vouch` and never by hand.
- **A sampled vouch is distinguishable from a full one on every surface that reports trust.**
  `loam list` shows `vouched (sampled)` in text and adds `vouchScope: "sampled"` to the row in
  `--json` (additive, omitted for a full vouch; `maturity` stays `vouched`). `loam validate` reports
  the new warning `sources.sampled-vouch`.
- **One new stable code, `sources.sampled-vouch` (warn)** — one finding per sampled spec file,
  naming k of n, the seed and `last_verified`, from the docs repo as well (it needs no service repo,
  like `content.stale`).
- **Both spec axes count, and the fleet summaries say so.** The sample is per file, so a service
  whose `arch.spec.md` alone was sampled is one part of whose documentation nobody read:
  `loam list`, `loam show` and `loam status` grade the service from EITHER axis, and `show` prints
  the scope per file (with `archSpec.vouch_scope` additive in `--json`).
- **A later full vouch clears it.** `loam vouch` with no `--sample` deletes the `vouch_scope` field
  (the shared frontmatter writer gained an explicit list of keys to remove — deletion is something a
  call site names, never a null value it happens to hold — leaving the body byte-identical and every
  neighbouring line in place), so a document that has since been read in full stops reporting as
  sampled.
- **`--sample` composes with `--pack`.** `loam vouch --pack --sample <n>` prints the reading list
  for the sampled vouch that follows, through the same seeded derivation — so the pack and the stamp
  can never prescribe different sections — and prints only those sections in place of the full
  heading list.

### Added — `loam vouch --pack`: the re-vouch reading pack

- **New flag `loam vouch --pack [--service <id>] [--json]`** — a re-vouch now starts from a printed
  delta instead of a full re-read: for each spec-axis file (spec.md, and arch.spec.md when present)
  the pack prints (a) the file's git diff from the last commit in the DOCS repo's history whose body
  hashes to the stamped `content_digest`, with a section-level summary (changed/added/removed
  headings), (b) the source files that moved against the stamped `sources_files` index —
  added/changed/removed paths in the stale finding's own one-column layout — and (c) the sections
  whose text is identical to the vouched ancestor's, listed under `vouched_by`/`last_verified` so
  the read can stop where it should.
- **`--pack --yes` is refused** (`invalid-option`, exit 1): `--pack` is the reading list and `--yes`
  the unattended stamp, and a pack that immediately stamped would defeat the read it just
  prescribed.

### Added — `loam verify --diff-answers`: mechanical cross-examination of two blind answer sets

- **New flag `loam verify <FEAT> --diff-answers a.json b.json [--service <id>] [--json]`** — a
  read-only lens that validates BOTH answer sets with the same `checkAnswers` discipline the record
  path uses, against the same derived checklist, then reports per claim who agrees with whom:
  `cross.agree-confirmed`, `cross.agree-unconfirmed`, `cross.disagree` — joined by deterministic
  claim id only, never by claim text — plus the `cross.evidence-disjoint` warn notice naming
  agreed-confirmed claims whose cited FILE sets do not overlap (a trailing `:line` or `:start-end`
  suffix is normalized away, so two citations into one file never read as disjoint).
- **Agreement is not verification, structurally**: the payload deliberately carries no `verified`,
  `verdict` or `attested` key, `verification.yaml` is untouched (byte-identical before and after, no
  docs lock taken, works while a writer holds one), and nothing this flag does can upgrade
  `attested` to `verified` — two agents agreeing (usually two contexts of the same model, so
  correlated) ranks where a reviewer reads first, it proves nothing.
- **Refusals reuse existing codes and name WHICH file**: `answers-unreadable` / `answers-mismatch` /
  `answers-unevidenced` prefixed by "first/second answer set (`<file>`)"; `invalid-option` for a
  combination with `--record`/`--results`/`--contract-results`, for an arity other than exactly two
  files, and for an archived feature (frozen history has no current checklist to answer).

### Added — evidence pins: federated records stamp what was cited, and `loam validate` convicts drift

- **`loam verify <FEAT> --service <id> --record` now stamps `evidence_pins` under each
  agent-confirmed claim** — one pin per `file:line` citation: the cited file's sha256 at the
  attested commit (CRLF-normalized, so a Windows checkout's line endings can never read as drift),
  the cited line's text (trimmed, capped at 200 characters), and the literal token the claim asserts
  (the operationId, message name or edge op), carried structurally so nothing ever parses claim
  prose — stamped only when the attested blob actually contains it, so the validate-side token lint
  can only ever convict a disappearance, never re-litigate an absence the record-time notice already
  reported once.
- **One new record-time notice, `verify.evidence-token-missing`** (warn, in the existing
  `notices[]`, text and `--json` alike): a just-confirmed citation's file at the attested commit
  does not contain the claim's own token.
- **`loam validate`, run in a service's own repository, re-checks the pins** of every ACTIVE feature
  record that service has attested and reports the new `evidence.*` finding family: ok
  `evidence.checked` / `evidence.unpinned`, warn `evidence.unresolved` / `evidence.moved` /
  `evidence.line-changed` / `evidence.token-missing`, plus warn `evidence.record-unreadable` for a
  verification.yaml that exists but cannot be read — a hand edit that breaks the record must surface
  here as a finding, not as a silently green run.
- **No new command, no new flag, no new `ErrorCode`, no exit-code change**; the `--json` additions —
  `evidence_pins` inside the read and frozen views' `claims[]`, the notice, the findings — are
  additive payload keys.

### Added — `loam list --needs-work --review-order`: the blast-radius review queue

- **`loam list --needs-work` gains `--review-order`** — the adoption worklist sorted by blast
  radius: for each service, the number of DISTINCT other services that depend on it — drawing a call
  edge into it (with or without an `op`; a delivery edge carrying `consumes` is not a call, because
  on the event spine the arrow follows the message), subscribing to a message it produces via a
  drawn `consumes` edge, or carrying a living `Consumes:` requirement line naming a message its
  asyncapi.yaml declares `action: send` for.

### Changed — `loam status` walks the first hour of an empty docs repo

- **`loam status` in a docs repo with zero services and zero features now teaches the first hour
  instead of reporting it clean.** Three new stable `next[]` codes, in order:
  `next.author-landscape` (also emitted when `architecture/landscape.likec4` is still the scaffold's
  untouched bytes, not only when it is absent — the step names the file and the literal command),
  `next.bind-service` (wire a service repo's `loam.json` to this fleet) and `next.adopt-first`
  (write the first baseline).

### Added — `loam diff`: semantic branch diff of the docs repo, with the victims named

- **New command `loam diff --base <ref> [--json]`** — the fleet-meaningful delta between the living
  docs and a base git ref of the docs repo (a branch, `origin/main`, a commit sha): services
  added/removed, living requirements added/removed/modified (by `Requirement-ID:`/heading identity
  and content digest, so a `loam rebase` pin never reads as a change), OpenAPI operations
  added/removed/newly-deprecated, AsyncAPI messages added/removed, and cross-service joins that
  appeared or went away.
- **Fourteen new stable finding codes, zero new `ErrorCode` union members**:
  `diff.service-added`/`-removed`, `diff.requirement-added`/`-removed`/`-modified`,
  `diff.op-added`/`-removed`/`-removed-consumed`/`-deprecated`,
  `diff.message-added`/`-removed`/`-removed-consumed`, `diff.consumer-added`/`-removed` — documented
  in the generated AGENTS.md's command map.
- **loam now asks read-only git questions in the DOCS repo** (`rev-parse`/`ls-tree`/`show` — no
  checkout, no temp writes, every child process bounded by the same timeout and output caps
  provenance uses).
- **`loam mcp` gains `loam_diff`** — the read-tool table grows to eleven; the tool schema marks
  `base` required (the table now models required flags, mirrored against commander's own
  `requiredOption` by the shape test), and a call without it is refused as invalid params before any
  argv is built.

### Added — `loam verify --contract-results`: contract-test reports answer the `api.exposes` claims

- **New flag `loam verify <FEAT> --contract-results <file>`** — answer the `api.exposes` claims
  mechanically from an API contract-test report, the way `--results` answers the `scenario.tested`
  claims from a cucumber one.
- **Records gain a `contractReport:` pin and `answered_by: external-runner`** — the consumed
  report's path, sha256, mtime, distinct-operation count and format land on the record (all-at-once)
  or inside the recording service's attestation (federated, pruned with its answers, resolved inside
  the attesting repository and bound to the attested commit exactly as `report:` is), and each
  contract-confirmed claim says an external runner answered it (`[contract]` on the printed line).
- **The verdict ladder does not move** — a contract report can never answer a `scenario.tested`
  claim, so `attested` versus `verified` still turns on scenario claims alone; a contract-confirmed
  `api.exposes` claim counts toward `verified` exactly as an agent-confirmed one always has, with
  strictly more provenance behind it.
- **Ownership mirrors `--results`, contested operations included**: under the flag the contract
  report owns every `api.exposes` claim in scope — an answers-file entry for one refuses
  `answers-mismatch`, a mechanical flag alone refuses while other claims are outstanding, an
  unreadable or unrecognizable report refuses `answers-unreadable` naming the accepted shape, and
  the flag refuses on archived features exactly as `--record` does. An operationId that more than
  one service on the checklist exposes is `verify.digest-contested`'s case on this axis — a report
  entry names no service, so those claims stay `unconfirmed` and the run carries the new
  **`verify.operation-contested`** notice (warn, gating nothing, an open-vocabulary notice code
  exactly as `verify.claims-open` was); `--service` resolves it.

### Added — `loam mcp`: the read commands as MCP tools over stdio

- **New command `loam mcp`** — a hand-rolled MCP stdio server (JSON-RPC 2.0, newline-delimited,
  protocol revision 2025-06-18 negotiated down to 2025-03-26/2024-11-05) for hosts that reach tools
  through MCP rather than a shell.
- **One machine contract, not two**: every tool result carries the command's `--json` envelope
  VERBATIM in `content[0].text` (and parsed again as `structuredContent`), with `isError` following
  the envelope's `ok` — so `ok`, `error.code` and every payload key mean exactly what they mean at
  the CLI, and a refusal (`no-config`, `unknown-target`, …) arrives as a readable envelope with
  `isError: true`, not as a dead call.
- **No new stable codes, no envelope changes, no new dependency** — the server is hand-rolled on
  `node:stream` and the existing commander wiring; `@modelcontextprotocol/sdk` was considered and
  declined (three runtime dependencies is a product decision).

### Added — `loam gate`: can-i-deploy, answered from recorded evidence

- **New command `loam gate [--service <id>] [--strict] [--json]`** — a can-i-deploy-shaped PURE
  QUERY for deploy pipelines outside loam's lifecycle: it executes nothing, writes nothing, takes no
  lock, and answers only from evidence previous runs recorded.
- **Four new stable finding codes, all in the open finding vocabulary — zero new `ErrorCode` union
  members.** `gate.service-undocumented` (error): the gated service itself sits below `documented`,
  so the docs cannot say what its joins are; re-running succeeds once `loam adopt`'s required
  artifact set exists — and under a map that cannot be read it fires only when the service is below
  `documented` regardless of whether an API is owed, because the api question is then unanswerable
  and one unanswerable fact yields one finding.
- **The `--json` payload** carries `verdict`, `strict`, `landscape` (`read`/`absent`/`invalid`),
  `partners[]` (maturity rung, consumer/provider role, the joining operations and messages,
  `external`), `features[]` (the record's own tallies and three-valued verdict per touching feature)
  and `checks[]` (findings by check, in the shared finding shape) — so a pipeline wanting a stricter
  bar (vouched partners, no attested scenarios) branches on data rather than waiting for a flag.
- **No new ErrorCode strings, no changed envelope fields, and no change to what gates the archive**:
  verify still never gates the merge, archive still reads no verification record — `loam gate`'s
  verdict is advice to a deploy pipeline loam does not own (WORKFLOW.md's "What actually gates" now
  says so beside the other two gates).

### Added — `loam context`: one service's docs slice as one deterministic briefing

- **New command `loam context <service>`** — assemble, for one service, the exact docs slice bound
  to it as one payload an agent loads before working in that service's repository: the living
  requirements and arch requirements VERBATIM (bodies and Given/When/Then lines, with the
  `Operations:`/`Covers:`/`Requires:`/`Capability:`/`Publishes:`/`Consumes:` joins parsed out beside
  them), the OpenAPI operations with the requirements governing each (`x-loam-remove` filtered), the
  AsyncAPI messages with their send/receive direction, the fleet edges one hop out with the map's
  own health beside them (the `landscape` key carries `present` and `parses`, so silence is evidence
  rather than absence), the `Requires:` permissions resolved against `architecture/permissions.yaml`
  (an undeclared entry is carried with `declared: false`, never refused), the capabilities the
  service realizes — with both fleet vocabularies' own health beside their sections, so
  `declared: false` under an unreadable vocabulary reads as "nobody could look" — maturity and
  frontmatter provenance, presence pointers for runbook/health/ADRs, and every ACTIVE feature's
  delta over the service in `loam delta`'s own payload shapes, each ending with the runnable
  `loam delta <FEAT> --service <id>` line.
- **Exit 1 with `ok: true` when the pack has a silent hole** — a landscape that is present but does
  not parse, an unreadable living `openapi.yaml`/`asyncapi.yaml`, an unreadable fleet vocabulary
  (permissions or capabilities), another service's spec file the capability rollup could not read
  (degraded per file into the `capabilitiesUnread` payload key, never a refusal — one service's
  briefing is not hostage to a sibling's encoding), or an included feature whose `delta.likec4` has
  errors or whose contract delta does not parse — and a feature whose delta does not parse is still
  INCLUDED in every service's pack with its errors in the payload, because a change nobody can read
  is in flight, not absent.
- **Internal relocation**: the delta projection helpers (`apiChanges`, `eventChanges`, `archSlice`,
  `introducedServices`, `livingServices`) moved from `src/commands/delta/slices.ts` to the new
  `src/core/projection/` package, and `stripFrontmatter` to `src/core/document/frontmatter.ts`, the
  day the pack became their second caller — commands do not import commands, so the shared
  projection now lives in core.
- **`/loam-implement` gains the pack as its load step** — `loam context $2 --feature $1 --json`
  right after `loam status`, before `loam delta`: the delta is what changes, the pack is what it
  changes into, and reading it first is how a MODIFIED requirement lands as an edit rather than a
  rewrite.

### Added — `loam open`: an editor workspace derived from the committed bindings

- **New command `loam open`** — writes a `.code-workspace` file joining the docs repo and every
  service checkout whose committed `loam.json` binds to it.
- A sibling whose `loam.json` exists but cannot be read is reported in `skipped[]` — never fatal,
  and never a member, because an unreadable binding proves nothing; a sibling bound to a different
  docs repo is silently not a member.

### Added — the fleet scorecard

- **`loam validate --all --json` gains one additive payload key, `scorecard`** — ceiling-vs-actual
  aggregates for the whole fleet, recomputed per invocation from the reads the run already makes and
  never stored: `services` with the maturity rollup (every rung present), `provenance` (vouched
  services · stale source digests · sources unverifiable from here — the latter two counted off this
  run's own findings by subject, so each is the same number the report prints beside them),
  `verification` (recorded records — the features axis's `active` count is their one shared
  denominator — the three-valued verdicts, and `claims.answered` — the confirmed claims split by
  their own `answered_by`, one count per provenance with all three keys always present: `runner` (a
  digest-matched cucumber run), `external-runner` (an operationId-matched contract report) and
  `agent` (somebody's word, and every record too old to carry the field)), `operations` (defined →
  governed · deprecated, plus deprecated operations something still joins to), `messages` (defined →
  linked), `c4` (the fleet map's drawn systems, by the map's own census — actors, externals,
  groupings and containers excluded — → covered by an arch requirement) and `features` (active, with
  each feature's fleet stage over all five stage keys).
- **`loam validate --all` text output appends a "fleet scorecard" table** after the summary footer —
  one line per axis, ceiling before actual.

### Added — inverse coverage on the event axis, and the partial-verification honesty line

- **New stable finding code `event.ungoverned`** (warn) — `loam validate --service` / `--all` now
  warns, per living asyncapi.yaml, when declared message(s) are named by no requirement's
  `Publishes:`/`Consumes:` line, listing the orphaned names.
- **New verify notice `verify.claims-open`** (warn) — `loam verify`'s read view and the frozen
  post-archive view now carry a one-line honesty summary whenever a record EXISTS and leaves claims
  unconfirmed or unanswered: "not a clean result", with all four counts and the agent's-word share
  of the confirmed.
- **WORKFLOW.md gains "The honestly-small change"** — the walkthrough for a one-service,
  requirements-only change: scaffold with `--touches`, delete the scaffolded C4 delta on the
  scaffold's own printed advice, author intent.md and one spec delta, and ship down the three-step
  `next[]` (`next.generate-tests`, `next.verify`, `next.archive`), with `loam status` printing "(not
  written — none owed)" beside every artifact the change legitimately skips.
- No new command, flag, exit code, or envelope key; both new codes are open-vocabulary
  finding/notice codes, exactly as `api.ungoverned` and `verify.scenario-attested` were before them.

### Added — the LikeC4 canary

- **A weekly scheduled workflow** (`.github/workflows/likec4-canary.yml`, manual dispatch included)
  **installs `likec4@latest` over the exact 1.59.2 lockfile pin and runs the LikeC4-touching suites
  against it**, then the committed 120-service benchmark as informational evidence in the run's step
  summary.

### Documentation

- **The product comparison now follows OpenSpec v1.10.0** (released 2026-08-19) while the certified
  parser/migration corpus stays pinned at the v1.9.0 commit
  `2826b8889e5223a9a8095d4428b60b56597e1020` — v1.10.0 changed no requirement-Markdown format
  upstream, and COMPARISON.md, README.md and MIGRATING-from-OpenSpec.md now name the divergence as
  deliberate.

### Added — the shipped documentation is now guarded like a contract

- **package.json, the release preflight, and the smoke share one reviewed package-file list**
  (`scripts/package-docs.mjs`): `files[]` set-inequality with the reviewed list is now a release
  blocker and an `npm test` failure, and every reviewed page must be relatively linked from README —
  adding a shipped document is deliberately a three-place edit, and the blocker names all three
  places.
- **New drift guards run inside `npm test`** (test/docs-facts.test.ts, test/package-docs.test.ts):
  counted facts in the shipped pages must match the live tree or sit under ROADMAP's dated
  assessment snapshot; the README command table is set-equal to the built program's commands;
  SCHEMA's `architecture/permissions.yaml` example is parsed through the real vocabulary reader,
  pinning the documented `owned_by`/`enforced_by`/`description` spellings; every dotted backticked
  token in the shipped pages must be a stable code loam actually emits, a verify claim kind, or a
  reasoned allowlist entry; and each documented known gap is paired with the roadmap sentence that
  owns closing it, so shipping a roadmap item fails the gate until the gap prose leaves with it.
- No new command, flag, exit code, envelope key, or stable code; nothing in `dist/` changed.

### Added — the capability axis

- **New fleet document `architecture/capabilities.yaml`** — shape
  `capabilities: {<id>: {description, owner}}`, both leaf fields optional (`{}` is a legal
  declaration); ids are flat keys with `/` allowed for nesting (`payments/refunds` stays one key,
  never collapsed).
- **New requirement-grammar line `Capability:`** (also accepted as `Capabilities:`) — a
  comma-separated LIST, legal in both spec files, living and delta alike, parsed beside
  `Operations:`/`Covers:`/`Requires:` with the same keep-last quirk.
- **New stable finding code `capability.unknown`** (error) — a `Capability:` entry that the
  vocabulary does not declare, with close-name suggestions; graded on living spec.md/arch.spec.md at
  the service target and on a feature's deltas of both via coherence.
- **New IssueCode `capability.unknown`** — the delta-side shape of the same rule **gates
  `loam archive`** (not-coherent), overridable with `--approve`; the only new archive gate in this
  item.
- **New stable finding code `capability.invalid`** (error) — the file exists but does not read as a
  vocabulary; reported exactly once per `validate --all` run (single-target runs stay silent about
  the file), suppressing the rest of the family, because a hundred findings about one broken file is
  a cascade rather than a diagnosis.
- **New stable finding code `capability.unrealized`** (warn) — a declared capability no living
  non-`REMOVED` requirement names; one finding per capability, subject = the id.
- **`loam list capabilities`** — new explicit-only section (the no-argument default and every
  existing section's payload are byte-unchanged); new additive `--json` payload key `capabilities`
  with deterministic, diff-stable ordering (rows by id, `realizedBy` by service/file/requirement,
  `statuses` keys sorted).
- **`loam explore --capability <id>`** — new repeatable flag seeding the exploration from a declared
  capability's realizing services; every miss (undeclared, or declared and realized by nothing)
  lands in the new additive payload field `unresolvedCapabilities` — explore still refuses nothing.
- **`migrate-openspec --apply` preserves capability identity**: the staged target declares the union
  of living and active-horizon OpenSpec capability ids in `architecture/capabilities.yaml` (empty
  bodies — no description is invented, the authored `## Purpose` prose stays verbatim under
  `legacy/`), and every routed requirement — living, delta and rename-materialized alike — carries a
  `Capability: <id>` line.

### Added — subsystems: `services/` may now be a tree, and no identity notices

Nested directories under `services/` are now legal: a directory marked by a `subsystem.yaml` is a
**subsystem** and is walked, at any depth.
- **Three-way classification, the third branch a refusal.** A directory under `services/` holding
  `subsystem.yaml` is a subsystem (walked); one holding any service artifact is a service (not
  walked deeper); one holding **neither** while containing subdirectories is the new error
  `subsystem.unmarked`, naming every service stranded beneath it — those services stay enumerated
  and counted, so the fleet is never silently smaller (the deleted-marker merge race).
- **`subsystem.yaml` is a marker, not a manifest** — optional `title`, `description`, `owner`; never
  members (SCHEMA.md, "Subsystems").
- **The tree is mirrored into a GENERATED views file, never into the authored landscape.**
  `architecture/subsystems.likec4` holds LikeC4 views only — no model, no tags, no `specification` —
  one view per subsystem enumerating every service beneath it (members resolved to landscape
  *element* ids through the same `metadata { service }`-then-title join every check uses; a member
  nothing models is omitted, which `landscape.service-unmodelled` already reports). New fleet-scope
  error **`subsystem.views-stale`** in `validate --all`: the file's bytes do not match the tree —
  exactly one finding on exactly one file, graded by byte comparison (nothing in loam ever parses
  the generated file), fixed by the one command.
- **New command `loam subsystem <verb>`** — `new`, `move`, `rename`, `rm`, `list`, `history`,
  `sync`; options `--into`, `--under`, `--title`, `--description`, `--owner`, `--json`.
- **`loam subsystem move <name>... --into <sub|.>` is ONE transaction over N directory renames plus
  the generated views file** — the first consumer of the crash journal's new moves half.
- **`loam adopt --subsystem <name>`** — the brief's artifact paths land inside the named group, so
  an adoption need not land unfiled and cost a second command.
- **`loam list` gains additive `--json` keys**: `services[].subsystem` (the path as a string array,
  `[]` = unfiled), top-level `subsystems[]` (`name`, `path`, `title`, transitive `memberCount`) and
  `unfiledServices` (a count — unfiled is permanent and normal, so it is never a finding).
- **`subsystem move`/`rename` notice old snapshots.** When an archived feature holds a version-2
  snapshot addressing a directory being moved by its literal pre-move path, the move prints a notice
  (JSON: additive `warnings` key) naming the feature — `loam unarchive <FEAT> --force` after the
  move would restore into the old location, resurrecting the pre-move directory beside the moved
  one.

### Changed — archive snapshots are re-keyed by service id (manifest version 2 → 3)

The undo snapshot's manifest (`features/archive/<dir>/.loam-before/manifest.json`) bumps to
**version 3**: every entry under `services/` now carries `(service, artifact)` — the service id and
the artifact's path inside the service directory — beside the as-archived literal `path`, and
`loam unarchive` resolves the write target through the **current** services enumeration, falling
back to the literal path when the id is not enumerated.

### Added — the AsyncAPI feature lifecycle

- **File-format contract** (SCHEMA.md): a feature changes an async contract through
  `features/<FEAT>/specs/<svc>/asyncapi.yaml` — a complete AsyncAPI 3.0 document.
- **`loam rebase` pins asyncapi slots**: every slot a feature's asyncapi.yaml restates is pinned
  against the living contract; `rebase --json`'s `pins[]` entries may now carry
  `file: "asyncapi.yaml"` with `kind` = the section name and `target` = the slot key (new values in
  existing fields — no envelope key changes).
- **New validate finding `asyncapi.remove-marker-living`** (error): a living asyncapi.yaml carrying
  `x-loam-remove: true` — at ANY depth: a slot, an inline channel message, or anywhere else one
  leaked (the document root, `info`), the sweep exactly as deep as the strip — names where it sits,
  the `openapi.remove-marker-living` discipline on the event axis.
- **The coherence gate grades the event axis** (`validate --feature` and the archive gate alike,
  since the gate consumes coherence issues wholesale). Three strings validate already emitted joined
  the IssueCode union unchanged: `asyncapi.invalid` (now also fired for a FEATURE's own
  asyncapi.yaml, suspending that service's event checks and gating archive),
  `asyncapi.ref-unresolved`, and `spec-event.message-undefined` (now also graded on delta
  requirement lines in feature scope). **What a `--json` consumer notices.** The event axis grades
  two things that need no asyncapi.yaml at all: a feature delta's tagged edges carrying
  `metadata { publishes }` / `{ consumes }` (`c4-event.message-undefined`) and a delta requirement's
  `Publishes:`/`Consumes:` lines (`spec-event.message-undefined`).
- **The merge is verdict-driven, per slot** (`channels.<key>` / `operations.<key>` /
  `components.messages.<key>`): a pinned QUOTE is never a merge input — not even under `--approve` —
  so a change that landed on the living contract after the delta was written survives an archive
  that merely restates the slot (the lost-update case); an EDIT overwrites; a `stale` pin still
  writes, because reaching the merge at all means `--approve` said to, and the plan names what it
  cost.
- **New stable plan-warn codes**, each with a /loam-check fix-table row:
  `asyncapi.message-modified`, `asyncapi.channel-modified`, `asyncapi.operation-modified` — the
  delta redefines a slot the living AsyncAPI already has and the merge overwrites it wholesale, the
  event axis's mirror of `openapi.op-modified`'s family.
- **`asyncapi.ref-unresolved` is now also a gating plan issue** (it stays a validate warn on living
  contracts): a `$ref` the MERGED document would carry that resolves in neither the feature's
  asyncapi.yaml nor the living one — including a removal that deletes a slot the living document
  still references — refuses the archive at `not-coherent` unless `--approve`.
- **New gating plan code `asyncapi.remove-marker-inline`** (error, `--approve` overrides, with a
  /loam-check fix-table row): an `x-loam-remove: true` nested on an INLINE channel message
  (`channels.<ck>.messages.<mk>`).
- **`archive --json` gains the additive `asyncapiRemovals` key** (`[{service, slots}]`, the labels
  of living slots the plan deletes), beside `openapiRemovals`.
- **New verify claim kind `event.declares`** in `CLAIM_KINDS` (the `verification.yaml` value
  vocabulary), after `api.exposes` in the checklist's story order: one claim per genuinely NEW
  (direction, message) a feature's asyncapi delta declares relative to the living contract's
  send/receive sets — `"<svc> declares it <sends|receives> message '<name>'"`.
- **`delta --json` gains the additive per-service `events` key** —
  `{changes: [{slot, message, direction, remove}], unreadable, error?}`, the event-axis mirror of
  the `api`/`openapi` pair: every message declaration in the feature's asyncapi.yaml with the slot
  it lives in, the direction the document's own operations give it (`send`/`receive`/null), and its
  removal marker; the text view prints the same rows. **An unreadable feature asyncapi.yaml now
  makes `loam delta` exit 1** exactly as the openapi path does — the brief is an implementation
  task, and "no event work here" over a YAML error is work silently dropped.
- **`loam status` sees the event axis.** The feature artifact table gains an `asyncapi` row per
  touched service (additive `--json` value in the `ARTIFACT_IDS` vocabulary; never required — an
  event contract is genuinely optional, so absence is `done` like arch.spec.md), the `asyncapi.*` /
  `c4-event.*` / `spec-event.*` finding families now turn their responsible artifact row `draft`
  (asyncapi.yaml, delta.likec4 and the spec delta respectively), a feature whose findings include
  `asyncapi.baseline-missing` gets a `next.rebase` step naming `loam rebase`, and a blocked
  verification's `blockedBy` list names `asyncapi` among the feeders it waits on.
- **The authoring surfaces teach the axis**: `loam new`'s spec template comment documents the
  `Publishes:`/`Consumes:` requirement lines and when to hand-create `specs/<svc>/asyncapi.yaml`
  (nothing is scaffolded — the axis's absence-grading rests on the contract being optional), and the
  `/loam-feature` workflow carries the event-axis authoring step beside the openapi one, rebase
  pinning included.

### Changed — `validate --all` parses the fleet's C4 documents in one workspace

`loam validate --all` now parses the run's C4 documents — every service model, every active
feature's delta, and the landscape — in **one** LikeC4 workspace instead of spinning up one
workspace per document: measured **~18.8x faster** (13.7s → 0.73s median) on the committed
120-service benchmark, with peak memory roughly halved (docs/BENCHMARKS.md).

### Changed — a restated component or path-level key can no longer silently revert a landed change

The operation pin's discipline now reaches the two surfaces it deliberately did not: path-item
non-method keys (`parameters`, `servers`, `summary`, `x-*`) and every `components/<kind>/<name>`.
The merge skips quoted surfaces exactly as it skips quoted operations, and component copying is
verdict-driven: **archives that used to exit 0 while a restated component or path-level key
overwrote another feature's landed change now refuse until `loam rebase <FEAT>` runs or `--approve`
says the overwrite is meant.** `loam validate` moves with it: a feature whose delta restates a
path-level key or a component another change has since moved now fails where it passed, on the same
`openapi.baseline-stale`, before any archive is attempted.

### Changed — the architecture rules became one executable gate

- **New contributor gate `npm run arch:check`** runs every architecture check the design docs state
  — file-level import cycles, the package graph, the core→commands ban (named and type-only imports;
  a bare side-effect or dynamic import is not seen), the barrel ban, the console/process boundary
  with `core/envelope/json.ts` as the one named exception, the child-process timeout/`maxBuffer`
  policy, and brand-cast containment — each with a negative self-test in `test/arch-gate.test.ts`.
- **Under `--json`, an unreadable loam.json no longer prints a stray line on stderr.** The
  `config-invalid` envelope message now carries the actual parse problem (stdout stays the single
  machine-readable stream); in text mode the same sentence prints from the command layer.
- **`loam verify --record`'s git questions are bounded** — a 10-second deadline whose refusal says
  the deadline fired (a blocking credential helper used to hang the record forever), and a
  deliberate 64 MiB output cap in place of Node's implicit 1 MiB that refused sound evidence over 1
  MiB.
- **Validated identities are branded types end to end.** Feature ids, docs directories and feature
  directories join service ids: the smart constructors in `core/kernel/ids/` are the only bridge,
  the path builders in `core/repo/paths.ts` refuse raw strings at compile time, and `arch:check`
  fails a brand cast outside the constructor modules.

### Changed — every multi-file writer now commits through a journaled, crash-consistent transaction

`loam archive` and `loam unarchive` have long committed through a lock, a byte-level
compare-and-swap, a snapshot and a fsynced `.loam-commit` journal.
- **`loam rebase`** journals its pin writes.
- **`loam vouch`** now takes the docs lock for its commit window (the roadmap called this lock
  missing) — the slow half, reading specs and hashing sources, stays unlocked so independent
  services' vouches do not serialise — and journals the spec.md/arch.spec.md pair.
- **`loam new`** builds its entire scaffold in memory, then commits it under the lock as one set of
  exclusive creates.
- **`loam gherkin`** — the writer the roadmap named, a plain write/delete loop in the service repo —
  commits through staging, the lock and the journal at **`<gherkinDir>/loam/.loam-lock`** /
  **`.loam-commit`**, two new transient dotfiles in the directory loam already owns.
- **`loam verify --record`** recovers (or refuses **`commit-interrupted`**) under its held lock
  before the authoritative read — the last docs-repo writer that could still silently write over a
  half-commit.
- **`loam validate` leads every mode with the new error finding `docs.commit-interrupted`** while a
  `.loam-commit` sits in the docs repo: a half-merged tree graded green would certify bytes no run
  produced, and in CI that green merges.
- **`loam doctor` covers the service repo too:** when loam.json names a service, the same residue
  scan runs over `<gherkinDir>/loam/` and grades with the same `doctor.docs-locked` /
  `doctor.commit-interrupted` / `doctor.commit-unreadable` / `doctor.staging-temps` codes; the
  report gains an additive `serviceWritePath` key.
- **Recovery is reported, not silent:** any journaled writer that first rolls a predecessor's commit
  forward carries an additive `recovered` key in its `--json` payload and says so in the human view
  — docs changing beyond the command's own writes would otherwise read as its doing.
- **`recovered.feature` and `status`'s `interrupted.feature` no longer always name a feature.** When
  the journal being recovered was left by `loam vouch` or `loam gherkin`, the field holds the
  **service** id those commands were committing for, and `recovered.command` / `interrupted.command`
  can now read `rebase`, `vouch`, `new` or `gherkin` where they only ever read `archive` or
  `unarchive`.
- **`loam doctor --json`'s `writePath.intent` now has two shapes.** A journal from the smaller
  transaction reads `{version: 2, command, rerun, target, …}` — no `feature`, and each file carries
  the staged `tmp` beside its digests.
- **`loam gherkin --dry-run` recovers before it plans** — archive's own dry-run precedent.
- A journal written by this loam and found by an older one grades as `doctor.commit-unreadable`
  (fail-safe, human-directed) — worth knowing where fleets pin loam per repo.

### Changed — recording a verification is now atomic, locked, and compare-and-swap

- **`loam verify --record` / `--results` takes the docs repo's advisory lock and commits the record
  atomically.** The record used to be one plain `writeFile` from an unlocked read, which lost work
  three ways: two services recording one feature concurrently could read the same pre-image and the
  last writer silently discarded the other's attestation; a process killed mid-write left the only
  record truncated (and every later `--record` refusing on `record-unreadable`); and an edit landing
  between the read and the write was buried. A kill mid-record leaves the previous record whole plus
  a staging temp that `loam doctor` already names under its write-path residue.
- **The git questions `verify --record` asks now have a deadline and an output cap.** Every `git`
  call on the record path (`rev-parse`, `diff`, `show`) runs while the docs lock is held, and none
  of them was bounded: a git blocked on a credential-helper prompt hung the record forever with the
  lock in hand, wedging every `archive`, `rebase` and other `--record` in the fleet behind a live
  pid that stale-lock breaking rightly refuses to touch.
- **A staging failure while recording answers `merge-failed`, not `internal`.** A read-only feature
  directory or a full disk at the staging step escaped as the one code with no stable meaning; it is
  now the same refusal archive gives the identical condition — nothing was recorded, the record is
  as the last writer left it.
- **`loam doctor` grades a `.loam-lock` that cannot name its holder as damage, and exits 1 where it
  exited 0.** An empty or unparseable lock file — what a crash inside a lock create used to leave,
  or an editor's accident — got the warning "wait for it to finish", advice that can never work:
  stale-lock breaking rightly refuses to interpret a lock it cannot read, so nothing was ever going
  to release it while every writer refused `docs-busy` forever. **What a `--json` consumer
  notices:** the finding keeps its `doctor.docs-locked` code but arrives with `severity: "blocker"`,
  so `healthy` is `false` and a preflight that passed over such a lock now fails.
- **A `verification.yaml` that is a symlink to a target that does not exist now refuses
  `record-unreadable`, naming the broken link.** The read side used to call it absent while the
  commit's exclusive create saw the link itself and refused — so every `--record` answered
  `record-raced` with advice (re-run) that could never work.

### Changed — the OpenSpec compatibility baseline moves to v1.9.0, and the gate that backs it runs again

- **`audit-openspec` and `migrate-openspec` now report v1.9.0 as the certified release baseline.**
  The banner line and `baselines.release` under `--json` carry `1.9.0` /
  `2826b8889e5223a9a8095d4428b60b56597e1020` (2026-08-13, and the tip of `main` when pinned) instead
  of `1.7.0` / `4e16790`.

### Fixed

- **The OpenSpec corpus gate had not run for eight days: it failed at module resolution, not at a
  corpus.** `scripts/check-openspec-corpus.ts` imported `../src/core/spec.js`, which moved into
  `src/core/document/` when core's leaves became packages, so every scheduled and manual invocation
  died with `ERR_MODULE_NOT_FOUND` while three documents pointed at it as the evidence for the
  compatibility claim.

### Documentation

- Added the evidence-backed `ROADMAP.md`, updated the product comparison to OpenSpec v1.9 while
  preserving the exact v1.7 compatibility baseline, documented
  AsyncAPI/authorization/response-governance joins, and reconciled release, contributor,
  security and generated-agent guidance with the implemented contracts.

### Added — the decision layer gets somewhere to live: outlines, an authorization vocabulary, and a walk that asks for both

- **A markdown table in a scenario body is now a `Scenario Outline`.** `loam gherkin` emits the
  table as `Examples` — one row per case, columns padded, deterministic to the byte — instead of
  dropping it into the scenario description where cucumber ran it as one vacuous scenario.
- **`architecture/permissions.yaml` — the fleet's authorization vocabulary — and the `Requires:`
  line that joins to it.** A third spine beside `Operations:` and `Covers:`, because neither can
  carry a permission: the cardinality is wrong for an operation, a permission is not a C4 element,
  and OpenAPI's `security` carries permission NAMES only for oauth2/openIdConnect — the spec
  requires an empty scope array for `http bearer` and `apiKey`, which is what most of a legacy fleet
  authenticates with. Three codes: **`permissions.unknown`** (error — an entry the vocabulary does
  not declare; an ERROR where its `Covers:` sibling is a warning, because an invented permission
  reads exactly like a real one in the requirement, in the generated scenario and in the test
  somebody then writes from it), **`permissions.invalid`** (the file exists and does not read as a
  vocabulary — reported alone, since grading every `Requires:` line against it would be a cascade
  rather than a diagnosis), and **`permissions.unenforced`** (warn — a declared permission no
  requirement anywhere in the fleet names, the mirror of `api.ungoverned`).
- **`api.response-ungoverned` (warn) — a declared 4xx/5xx response no scenario reaches.**
  `api.ungoverned` grades whole OPERATIONS against requirements, so an endpoint with one happy-path
  requirement and twelve declared failure codes was fully governed by every check loam had — and the
  refusals are precisely where a service's decision layer surfaces.
- **`sources` is described as digest input rather than a reading list.** Nobody follows those paths
  and nothing asks them to — the value is that `vouch` hashes their content so a later `validate`
  can say the code moved.

### Fixed

- **An optional `arch.spec.md` could refuse an entire `--all` run.** The new fleet-wide `Requires:`
  sweep read both requirement documents of every service without checking existence first, and
  `FleetContext.readRequirements` throws ENOENT — which surfaced as `repository-unavailable` with no
  targets and nothing validated.

### Changed — three archives that used to exit 0 now refuse, because each one was a silent loss

- **Unpinned deltas gate the archive.** `delta.baseline-missing` and `openapi.baseline-missing` keep
  their warn severity — `loam validate` stays green, the documents are legal — but both now carry
  `gates`, so `loam archive` (dry run included) refuses instead of merging.
- **A scaffold nobody edited cannot archive.** Two new gating warnings from
  `loam validate --feature`, `loam status` and the archive gate: **`scaffold.placeholder`** — a
  feature document still carries `loam new`'s exact template text (a `TODO — name the behaviour`
  requirement, a `TODO — name the case` scenario, an `<angle-bracket>` fill-in, a
  `TODO — what this service owns` description) — and **`intent.empty`** — intent.md is missing or
  says nothing outside the scaffold's own comments.
- **A feature's own broken openapi.yaml is now named.** `validate --feature` reports
  **`openapi.invalid`** (error — the same code the living contract gets) when a feature's
  `specs/<svc>/openapi.yaml` exists but does not parse, and suspends the service's contract-axis
  checks instead of grading against the empty parse — which used to skip every baseline pin and
  removal marker in the broken file silently and false-fire `spec-api.op-undefined` against
  requirements whose operations the unreadable file defined.

### Fixed — the fleet map's containers are visible to the checks that guard removals and ordering

- The element→service resolver was called without the enumerated fleet in exactly the places that
  are repository-aware: the removal gate's consumer scan, the feature dependency graph, coherence's
  edge grading, arch coverage and its `Covers:` matcher, the verify checklist, and `loam delta`'s
  projection.

### Fixed — edge metadata loam parsed but did not keep

- **`loam archive` dropped an event binding at exit 0.** What makes two C4 edges the same edge
  accounted for `metadata { op }` and ignored `metadata { publishes }` and `metadata { consumes }`
  entirely.

### Added — fleet-shape and contract-depth checks

These checks are specified with repository-owned synthetic docs fixtures and compare artifacts loam
already parses.
- **`landscape.platform-candidate` (warn)** — an `#external` element consumed by three or more
  distinct services and not tagged `#platform`.
- **`landscape.datastore-private` / `landscape.datastore-shared` (warn)** — a fleet-level `database`
  element graded by its consumer count.
- **`c4.no-relationships` (warn)** — a parsed model with elements and zero relationships, when its
  own evidence says it should reach something: more than one nested element, or dependencies
  declared in this service's health.yaml.
- **`health.dependency-unmodelled` (warn)** — every `dependencies:` id in health.yaml must resolve
  in the service's OWN `model.likec4`, by element id, `metadata { service }` binding, or title
  (exact match, did-you-mean hints, no case folding).
- **The contract-depth probes** — form validated and depth did not: an operation whose one response
  is `description: OK`, a message whose payload is bare `type: object`, and a `$ref` to a schema
  nobody wrote all validated exactly as cleanly as complete contracts. Four warns close it:
  **`openapi.response-undescribed`** (no response declares a schema while at least one should —
  204/304 excepted), **`asyncapi.payload-undescribed`** (a payload declaring no shape at all; a
  non-JSON `schemaFormat` is never judged, so the Avro migration stays a document change), and
  **`openapi.ref-unresolved` / `asyncapi.ref-unresolved`** (internal `$ref`s to nothing — on the
  async axis these used to vanish silently).
- **`spine.message-external` (warn), and `spine.message-unproduced` narrows to mean what it says** —
  a message produced outside the fleet was inexpressible: the landscape said the producer was
  `#external` and the error fired anyway, so a truthful map cost a red build and the exit ramp was
  deleting the link.

### Changed — the adopt protocol makes deployment evidence boundaries explicit

- **The reproducibility bar is stated**, beside the honest half: `loam validate` grades form and
  joins, never depth, so green means the files agree with each other — and `unchecked[]` now says
  nothing measures a shallow baseline against the service.
- **`api.covered` carries both counts** — operations governed and living requirements — because the
  ratio is the one signal that lets a reviewer smell a thin baseline from the summary line.

### What a `--json` consumer notices, upgrading to this release

- **Repos that were green can newly show warnings** — the eight codes above, plus `agents.stale`
  from the version bump itself (and this time the AGENTS.md review is real work: the code tables
  materially changed). `valid` stays true and plain exit codes stay 0, but **a `--strict` CI job
  that exited 0 yesterday can exit 1 today**. A freshly migrated OpenSpec repo now reports
  `openapi.response-undescribed` as its honest state — OpenSpec never carried response schemas.

- **One red case turns green**: a consumed message whose only producer is an `#external` `publishes`
  edge no longer errors. Fleets that took the old exit ramp — deleting the link to get green — get
  no signal to restore it; re-add the edge and the consumption, the map is allowed to be truthful
  now.

- **`landscape.matched` no longer appears** on a fleet where any fleet-shape warning fires — a map
  with a shape warning did not fully agree.

- No envelope keys changed shape; the new findings ride the existing `findings[]`/`details`
  contract, and prose (including `api.covered`'s message) was reworded freely as always. A feature's
  per-service deltas live in `features/<FEAT>/specs/<svc>/`, and that `<svc>` is a directory name
  somebody typed — but unlike `--service`, nothing ever asked the id grammar about it.
  `specs/Payment Service/` (with the space) validated green —
  `✓ Payment Service: requirements covered`, even, because a tagged element whose *title* matched
  the directory counted as introducing the service — and `loam archive` then exited 0 and
  materialised `services/Payment Service/`. The very next `loam validate --all` failed it with
  `service.id-invalid`: a directory loam itself wrote, and one no loam command can address or
  re-create. New finding: **`delta.service-id-invalid`** (error), from `loam validate --feature`,
  `loam status`, and the archive gate, naming the `specs/<svc>/` directory and the exact rule the
  name breaks — the same sentence `service.id-invalid` uses, Windows-reserved stems (`NUL`) and
  trailing dots (`payments.`) included. `loam archive` refuses on it before anything joins the name
  into a path, `--dry-run` included, and **`--approve` does not override it**: which service you
  meant is a judgment call, but a name the grammar refuses is a directory loam can never address,
  mechanically. The fix is a rename of the specs/ directory. The same guarantee on the architecture
  axis. A tagged element's explicit `metadata { service '…' }` binding is a name the landscape merge
  splices into the living `architecture/landscape.likec4` verbatim, and the archive probes
  `services/<binding>/` with it — `metadata { service '../outside-svc' }` parses in LikeC4 without a
  single error, validated with nothing but a warning, archived at exit 0, and the `../` collapsed
  the probe right out of `services/`. The next `validate --all` then failed the very map archive had
  just written (`landscape.binding-unknown`). New coherence issue: **`c4.service-binding-invalid`**
  (error), from `loam validate --feature`, `loam status`, and the archive gate, naming the element
  and the rule its binding breaks; **`--approve` does not override it either**, for the same reason.
  The check's scope is the splice's, not the tag's: the merge carries a tagged element's authored
  block into the living landscape byte for byte, untagged children included, so an untagged
  `container` nested inside a tagged system — `metadata { service '../outside-svc' }` on the child —
  is held to the same grammar, because its binding reaches the living map exactly as its parent's
  does. A prose title with no binding stays legal C4 — a title becomes a path only through
  `specs/<svc>/`, which the finding above now guards. Together the two codes close every text→path
  route into the archive merge. **What a `--json` consumer notices.** `loam validate --feature` can
  now exit 1 on repos that used to pass, with `delta.service-id-invalid` or
  `c4.service-binding-invalid` in `findings[]` — and the same two findings reach
  `loam validate --all` and the bare positional `loam validate <FEAT>`, which grade every feature
  through the same check: a repo that exited 0 yesterday exits 1 today, and a CI job running
  `validate --all` fails naming the feature. The fix is renaming the `specs/<svc>/` directory or
  editing the `metadata { service }` binding, never a flag. `loam archive` refuses both with the
  envelope code `not-coherent` and the offending finding in `issues[]`, whether or not `--approve`
  was passed; a refusal `--approve` cannot move now also says "--approve does not override this" in
  `error.message`, and every issue `archive --json` emits (`issues[]`, `warnings[]`, `overridden[]`)
  carries a new additive `overridable` key — whether `--approve` can move it — so a consumer
  branches on data instead of keeping its own code list. One ordering change rides along: the
  illegal `specs/<svc>/` name is refused ahead of the conflict-marker scan, so a feature carrying
  both defects reports `not-coherent` where it used to report `merge-failed`. A `services/<bad>/` a
  previous archive already created is repaired by renaming — the `service.id-invalid` message spells
  the three places the old name is written.

### Fixed — coherence grading resolves an edge's target before it builds a path

The coherence check behind `loam validate --feature`, `loam status` and the archive gate joined an
op-edge's *declared* target — the element's `metadata { service '…' }` binding, or its title —
straight into `services/<target>/` to read the living spec, the living OpenAPI and the deprecation
flags. **What a `--json` consumer notices.** Nothing, unless a feature's delta declared a target
that never matched a `services/` or `specs/` directory *and* the joined path landed on a real file:
those repos can newly see `c4-api.op-undefined` (error, gates archive) and `c4.op-ungoverned` (warn)
where the out-of-repo file used to satisfy the check.

### Fixed — `loam validate` resolves a service name before it builds a path

`loam validate --service <name>` and `loam validate <name>` both spelled
`<docsDir>/services/<name>/` out of whatever the caller typed, and neither ever checked it.
`loam validate --service ../../outside/services/x` therefore resolved **above the docs repo**, and
where a `spec.md` happened to sit at that path loam opened it, graded it, and reported its
frontmatter back through `--json`.

### Added — `loam adopt` states the walk, and `validate` grades it

- **`walk[]` in the brief** — nine ordered stops, each naming what to open, what to take from it,
  and which artifacts it feeds (`lands`).
- **`sources.unwalked` (warn) / `sources.walked` (ok)** — the walk graded against the repository,
  reported by `loam validate --service <id>` run inside the service's own repo.

### Added — how to draw a shared broker, before the fleet map becomes a star

A broker modelled as ONE element is the node every service in the fleet points at: a map that read
fine at five services is a star with sixty spokes at sixty, and nothing warns on the way there,
because loam parses the model and renders no view.

## [0.1.0-beta.3] - 2026-08-08

Still a prerelease under the `beta` dist-tag; the 5–10 service pilot has not run yet. The entries
below describe implementation behavior and repository-owned synthetic fixtures; they claim no
production-fleet or external execution evidence. One breaking change, in `loam vouch`; read that
section before upgrading a CI job.

### Changed — `loam vouch` now records a person, and refuses when it cannot

**This is a breaking change for any script or CI job that runs `loam vouch`: add `--yes`.**

`vouch` is the one command in loam whose output is a claim about a human act — everything else it
checks is internal consistency, which fluent prose satisfies on its own. Its own docblock called it
"the one command that records a person", and it recorded none: no identity of any kind, no
interactive gate. Run twice, unattended, from a script, it stamped `status: verified` both times.
Meanwhile every generated command and skill file pre-approved `Bash(loam:*)`, which handed the agent
that wrote a draft the power to promote its own draft. That inverts the argument loam makes about
test evidence everywhere else — an agent must not be able to *say* a scenario is tested — by letting
one say a spec matches the code.

Three changes close it, and none of them is a signature:

- **`vouched_by` is stamped beside `status` and `last_verified`**, taken from git —
  `GIT_COMMITTER_*`/`GIT_AUTHOR_*` first and then `user.name`/`user.email`, which is git's own
  precedence, so a CI job and a laptop resolve it the same way. It is a name, not a proof: git
  config is a text file. What it buys is that a reviewer can ask a *specific person* what they read,
  which is the question `status: verified` was silently answering with nobody. It rides `--json` as
  `vouched_by`, and a re-vouch refreshes it.
- **`--yes`, and a confirmation when there is a terminal.** Without `--yes`, `vouch` refuses
  `vouch-unattended` when stdin is not a TTY, and in `--json` mode regardless (a question cannot be
  asked on a stream whose contract is one JSON document). On a terminal it states what is about to
  be claimed and takes only an explicit yes; `vouch-declined` is the answer when the person says no.
  `vouch-unattributable` is the refusal when git can name nobody at all — better than stamping an
  anonymous claim.
- **The generated `allowed-tools` allowlist names loam's verbs one by one** —
  `Bash(loam adopt:*), Bash(loam validate:*), …` — and deliberately not `vouch`. A verb missing from
  the list is not forbidden, only unapproved: the agent asks, and a person answers. That is the
  correct cost for this one, and it is what makes the refusal something a human sees rather than
  something an agent routes around.

New error codes: `vouch-unattended`, `vouch-unattributable`, `vouch-declined`. Existing specs
carrying `status: verified` with no `vouched_by` are not re-graded — nothing new fires on them — but
the next vouch stamps a name.

### Fixed — a docs repo that could be cloned, and rendered

- **`loam init --create` writes `services/.gitkeep` and `features/.gitkeep`.** Both directories were
  created empty; git tracks files, not directories, so after the first push neither existed for
  anyone who cloned. A missing `services/` is a *blocker* in `doctor`, so the second person to touch
  the repo got a red preflight on a repository the first person left green.
- **`loam init --create` writes `likec4.config.json`, and the docs repo is a loadable LikeC4
  workspace again.** loam parses every `.likec4` file *alone*, so the landscape, each
  `services/<id>/model.likec4` and each `features/<FEAT>/delta.likec4` legitimately declares its own
  `specification { … }` block and re-declares the elements it names. LikeC4's own loader merges the
  whole tree into one model, so pointing `npx likec4 start` at the repo root — the command loam's
  own brief recommends — reported every one of those declarations as a duplicate: on loam's
  four-file `examples/docs`, 16 errors from the renderer and 0 from `loam validate --all`. The
  scaffolded config declares the root as one project scoped to `architecture/`; a service model or
  feature delta renders from its own directory (`npx likec4 start services/<id>`), which is what
  parsing them in isolation meant all along. `doctor` reports `doctor.likec4-config-missing`
  (warning) on a docs repo created before this, with the exact file to write in its `fix`.

### Fixed — three commands that answered the wrong question

- **`loam status` now sees the repository it is standing in.** With `loam.json` naming a service the
  docs repo has no directory for — a freshly wired service repo, the most common repo there is — the
  fleet count made "nothing is in flight and every service is written down" vacuously true, and
  `next.fleet-clean` came out on top. `doctor` had the right answer (`doctor.service-unknown`) at
  the same moment, and the documented agent loop reads `status --json` and runs `next[0]`: an agent
  following it was sent to start a feature instead of adopting the service under its feet. The new
  step is **`next.adopt-bound`**, first in `next[]` (behind only `next.recover-commit`), and
  suppressed under an explicit `--service`, which is a question about a different service.
- **`doctor.service-unbound` is no longer raised inside the docs repo.** Having no service binding
  there is the correct state — the docs repo is the fleet, not any one service — and the `fix` it
  printed (`loam init --service <id>` here) would have made the repo wrong. `currentService` still
  reports `unbound`; only the advice is gone.
- **`loam instructions` checks the arguments it substitutes.** `loam instructions loam-adopt "$PWD"`
  rendered a protocol reading `services//Users/someone/work/svc/` — a page of confident instructions
  built around a value no loam command accepts. Each workflow now declares what its `$1`, `$2`, …
  stand for, and a service-id or feature-id placeholder is checked against the same grammar
  `loam adopt` and `loam new` use before anything is printed (`invalid-option`). An *unsupplied*
  placeholder is still left standing, and a free-text one (a feature title) is still free.

### Fixed — `doctor.agent-files-stale` and `agents.stale` across a prerelease

`versionTrails` compared only the numeric triple, so `0.1.0-beta.1` neither trailed nor outranked
`0.1.0-beta.2`. But beta.2 is precisely the release that changed the *form* of every generated file
— embedded protocol text became a pointer at `loam instructions` — and its own changelog told
readers to delete the files and re-run `loam init`. The one upgrade that most needed the warning was
the one bump shape that could never raise it. Prerelease identifiers are now compared per semver:
numerically where they are numbers, a prerelease behind its own final release, and a longer
identifier list ahead of a prefix of itself. A stamp whose version is not valid semver still reads
as no stamp at all, unchanged.

### Added — the async contract axis (AsyncAPI 3), phase one

Kafka was already drawable in the fleet map and describable in prose, and that was all: a
`paymentService -> kafka 'Publishes PaymentAuthorized'` edge read as fully documented while naming
no contract anybody could check. The event axis gives it the treatment the HTTP axis has — an
artifact, a join token, and findings — in a first slice that reads and grades but does not yet
merge.

- **`services/<svc>/asyncapi.yaml`** — the async contract, sibling of `openapi.yaml`, optional and
  adopt-seeded. **AsyncAPI 3.0 only**: its operations are named top-level objects carrying
  `action: send|receive`, which is the exact analog of an `operationId`, where 2.x spells the same
  thing as `publish`/`subscribe` under a channel and leaves whose perspective they take ambiguous. A
  2.x document declares no `operations` and reads as a contract with no messages rather than as a
  mis-parsed one. No new runtime dependency: the document is read with the `yaml` parser already
  present, by the same shallow structural walk `core/openapi.ts` uses.
- **The join token is a message name**, spelled three times and required to be identical: a
  landscape edge's `metadata { publishes '...' }` / `metadata { consumes '...' }`, a requirement's
  `Publishes:` / `Consumes:` line, and the message's `name` in `asyncapi.yaml` (its declaration key
  when it has no `name`).
- **loam never reads inside a message's `payload`.** It joins on names and on the `action` of the
  operation carrying them, and nothing else. Write payloads as JSON Schema; a fleet that later
  adopts Avro changes a `schemaFormat` line in its documents and nothing in loam. Keep payloads
  inside the document rather than `$ref`-ing an external `.avsc` — external references are out of
  scope here exactly as on the OpenAPI axis.
- **New finding codes**, all from `loam validate --service <id>`: `service.no-asyncapi`,
  `asyncapi.invalid`, `asyncapi.duplicate-message`, `spine.message-undefined`,
  `spec-event.message-undefined`, `spine.message-unproduced`, `asyncapi.message-contested`,
  `event.messages-unlinked`, and the `ok` confirmation `event.covered`. No existing code changed,
  and no refusal that used to succeed now fails: every one of these fires only on a file or a
  `metadata` key that did not exist before this release.
- **`spine.message-unproduced` is the check with no HTTP analog**, and it is why the axis exists. On
  the API axis the provider owns the contract, so "does this operation exist" is answered inside one
  service's directory. An event's schema lives in the *producer's* repository, so "does anybody
  publish what I consume" is a fleet question — and a consumer joined to nothing was previously
  indistinguishable from a healthy one. `asyncapi.message-contested` is its other half: two services
  claiming to send one name means every consumer's join picks one arbitrarily.
- **`service.no-asyncapi` has two grades, not three.** Its `service.no-openapi` sibling warns when
  the landscape cannot prove nobody calls a service, because most services expose HTTP. An event
  contract is genuinely optional and most services touch no topic, so the absent file is an
  **error** when something already joins into it — the stranded message names ride in `details` —
  and **silence** otherwise.
- `asyncapi.yaml` presence rides in `loam list`/`loam show` (`has.asyncapi`, and a lowercase `e` in
  the text flags, beside the arch spec's `a`). It is deliberately **not** part of the maturity
  ladder: making it a fourth required artifact would demote every already-`documented` service in
  the fleet without one byte of their files changing.

**Not in this slice, and stated so nobody reads the absence as a bug:** a feature cannot yet add a
message. There is no `features/<FEAT>/specs/<svc>/asyncapi.yaml`, no merge, no baseline pin, and no
`verify` claim on this axis — a message is retired, for now, by editing the living contract in a
reviewed PR. Deprecation markers and a removal family are deliberately absent rather than pending:
an async contract that only ever grows has nothing to mark, because a consumer reading a topic with
lag breaks on a removed field regardless of what the document says about it.

## [0.1.0-beta.2] - 2026-08-07

Still a prerelease, still under the `beta` dist-tag: the 5–10 service pilot has not run yet, and
this release changes what `loam init` leaves in a repository, which is exactly the kind of thing a
pilot is for. Two new commands, that change to the generated files, and a code-quality pass over
`src/` with the defects it turned up. The refactoring half is invisible by construction; what
follows is only the part a user can observe.

### Added

- **`loam explore [<service>...]`** — read the fleet around a change nobody has written down yet,
  and write nothing. It answers the one question `loam new` takes as an argument: which services a
  feature touches. For each seed it reports the ring one hop out in the fleet map, each service's
  maturity rung and living operations, who already calls whom, the active features already covering
  the same services, and the literal `loam new` line the seeds imply. `--op <operationId>` seeds
  from an operation when you know the call but not who owns it; `--as <FEAT>` names the feature in
  the suggested line. A seed naming no `services/<id>/` is reported with its near-misses rather than
  refused — a feature may be introducing that service, and a typo looks identical until you read the
  list. The neighbours are deliberately **not** folded into the suggested command: loam knows those
  services are connected, not whether you change them.
- **`loam instructions [<workflow>] [args...]`** — print one of the six workflow protocols
  (`loam-adopt`, `loam-feature`, `loam-implement`, `loam-check`, `loam-verify`, `loam-ship`) with
  `$1`, `$2` filled in from the arguments given. With no argument it lists them. It is the only
  command that reads no `loam.json` and no docs repo, deliberately: `loam-adopt`'s own first step is
  to run `loam init` when there is no config, so it cannot be the step that requires one.
- **[WORKFLOW.md](WORKFLOW.md)** — the working protocol as a document: the artifact graph and its
  five derived states, what actually gates and what only advises, the six workflows, how an agent
  drives the cycle from `--json`, and why there is no task-list artifact.

### Changed — what `loam init` writes into a command or skill file

- **A generated file is now a pointer at `loam instructions`, not a copy of the protocol.** It
  carries the workflow's purpose and its spine — the verbs, in order — and defers this release's
  flags, finding codes and fix tables to the binary; a fresh `.claude/commands/` drops from about 53
  KB to about 11 KB, and the finding-code tables move with it. The protocol itself is unchanged and
  complete; only its delivery moved. The reason is that the two go stale in opposite directions and
  only one is fixable: loam never regenerates a generated file (your edits outrank the template, and
  that is not changing), so a protocol copied into a repository will eventually describe a different
  loam with total confidence, while a pointer cannot. `doctor.agent-files-stale` still reports a
  file whose version stamp has fallen behind, and now has almost nothing to be wrong about.
- **Nothing rewrites an existing file.** A repository scaffolded by an earlier loam keeps exactly
  the files it was given, full protocol text and all — re-running `loam init` over it leaves them
  byte-unchanged. The version stamp is how you tell, and `loam doctor` raises
  `doctor.agent-files-stale` against them only once this binary's stamp is ahead of theirs. To take
  the new form, delete the files and re-run `loam init`.
- Both new commands reuse the existing refusal codes (`invalid-option`, `unknown-target`). No stable
  code was added, changed or removed.
- **The feature-id grammar has one home.** It was spelled privately in `loam new` and again in the
  OpenSpec migration; `core/ids.ts` owns it now, so an id one command accepts cannot be an id the
  other refuses. The only user-visible edge is wording: `migrate-openspec`'s
  `mapping.feature-id-invalid` message now ends with the same "e.g. FEAT-101 or BUG-42" example
  every other refusal gives. The code is unchanged.

### Fixed — commands that wrote or attested on evidence they had not checked

- **`archive` no longer installs an unreadable feature contract as the living one.** A feature
  `openapi.yaml` that does not parse as an OpenAPI document was planned verbatim into
  `services/<svc>/openapi.yaml` and reported `ok: true`; every other command reads `readOpenapi`'s
  `unreadable` flag, and the one that writes was the one that did not. It now refuses with
  `merge-failed`, naming the file. The same code now answers when the contract is being created
  rather than merged — that case used to escape as `internal`.
- **`verify --record` no longer attests when it could not check the report.** The committed-report
  binding check tested for git's exit code 1 and nothing else, so a `git diff` killed by a signal —
  a CI timeout, the OOM killer, a fork failure — skipped the check and wrote the attestation anyway.
  A run that cannot reach an exit status is now a refusal that says git could not be run to
  completion.
- **An interrupted `archive` can be retried on a docs repo composed of symlinks.** Checking whether
  the snapshot was stale resolved the manifest's paths through a symlink test meant for writes, so a
  `services/<svc>/` mounted from a sibling checkout — a layout every walk of the repo follows on
  purpose — turned every retry into a permanent refusal. That check only reads a file and compares a
  digest; containment is now judged without resolving the mount. `unarchive`, which writes the
  pre-image back, deliberately keeps the stricter test.
- **A malformed `.loam-before/manifest.json` or `.loam-lock` is answered, not assumed.** Both were
  read through a cast: well-formed JSON that was not an object slipped past as "a different loam",
  and a bare `null` threw a `TypeError` out of the refusal itself. They now answer
  `commit-interrupted` and `docs-busy` respectively — the codes that case always deserved.
- **A `spec.md` whose bytes are UTF-16LE is refused on the write path.** The write path's UTF-8
  guard was a weaker copy of the read path's and missed exactly the file the read path had been
  hardened against: such a document parsed as zero requirements, so a merge computed over an empty
  baseline and wrote that back.

### Fixed — user errors reported as `internal`

- **`list`, `show` and `validate` report `repository-unavailable`** where a filesystem failure
  carries no path — a directory where `spec.md` belongs reports EISDIR with no `path`, which
  defeated the guard. `status` had this fix; the other three copies of the same catch block did not.
- **`loam.json` that cannot be read reports `config-invalid`.** The read sat one line above its own
  `try`, so a config file that was a directory, or carried a restrictive permission bit, crashed
  every command in the CLI.
- **`loam new` refuses instead of scaffolding into a directory that is not a docs repo**, and
  **`loam adopt` refuses (`docs-missing`)** instead of briefing an agent to write a baseline into a
  docs repo that does not exist. Both previously exited 0.

### Fixed — checks that answered differently depending on where they were asked

- **A relocated operation grades the same under `validate`, `status` and `archive`.** `FleetContext`
  carried a second implementation of `serviceOperationIds` that interleaved removals with upserts,
  so an operation removed at one path and defined at another answered "undefined" or "defined"
  depending on which the author spelled first — and `spec-api.op-undefined` is a gating error.
- **`c4.op-ungoverned` joins per service.** Operation ids are unique only within a contract, so an
  operation governed on one service suppressed the warning for an unrelated service that shared its
  name.
- **`api.covered` no longer counts a REMOVED requirement as governing.** An operation whose only
  governing requirement was removed now reports `api.ungoverned` (a warning; nothing about gating or
  exit codes changes).
- **`loam status` (fleet form) reports `blocked` for a repo holding an interrupted commit journal**,
  agreeing with the per-feature form, which already did. It previously said `done` and "ship it"
  over a tree the other form called blocked.
- **`loam delta` exits 1 when the feature's `openapi.yaml` does not parse**, matching the rule the
  architecture axis already had, and its `--json` payload carries an `openapi` key saying so. An
  unparseable contract used to project as "no operations".

### Fixed — deletion that reached outside the repository

- **`loam gherkin` orphan cleanup no longer follows a symlinked directory out of the repo.**
  Enumeration follows symlinks by design, so a planted `<gherkinDir>/loam/sub -> /outside` produced
  orphan paths that `unlink` resolved and deleted elsewhere. A symlinked `.feature` sitting directly
  in `loam/` is still removed — the link goes, its target survives — which is the distinction the
  guard now draws.

### Changed — internal structure

No behaviour depends on this, and it is recorded because the next contributor will notice it: the
eight runtime import cycles in `src/core/` are gone, five helper modules were extracted from the
modules that happened to hold them (`document-bytes`, `records`, `steps`, `concurrency`, and the
docs-repo gate), and the duplicated spellings of six shared rules now have one home each.
`docs/CODE-STYLE.md` records the conventions and the defect behind each one.

## [0.1.0-beta.1] - 2026-08-06

The first published release, and a prerelease on purpose: it ships under the `beta` dist-tag, not
`latest`. This entry covers the pre-publication hardening pass. Most of it is not new capability —
it is the difference between a command that reports a problem and one that was quietly blind to it,
and in four places it is the difference between an undo that works and one that certifies text
nobody wrote. Grouped by what a user would notice.

### Fixed — data loss and silent failure

- **A file whose bytes are not UTF-8 is no longer rewritten.** The whole write path moves bytes
  rather than strings; text is produced only where a parser needs it. Undecodable content refuses
  the merge (`merge-failed`, naming the file) instead of replacing every such byte with U+FFFD — in
  the living document *and* in the snapshot meant to undo it, which left nothing to restore from. A
  non-UTF-8 `openapi.yaml` now grades `openapi.invalid` instead of being handed to the YAML parser
  with the damage already done.
- **`unarchive` no longer restores an edited snapshot and certifies it.** The snapshot manifest is
  version 2: every entry records `before`, a sha256 of the pre-image it will restore, alongside the
  existing `after`. `unarchive` hashes each pre-image before staging anything and refuses on a
  mismatch (`snapshot-corrupt`) — and `--force` deliberately does not override it, because `--force`
  discards later changes to the living docs while the damage here is to the undo itself. A version-1
  snapshot is refused as `snapshot-missing`.
- **A commit killed halfway can now be repaired.** `archive` and `unarchive` fsync an intent journal
  (`.loam-commit`) before the first swap and recover from it on the next run, under the lock: an
  archive is undone, an unarchive is finished (the merged text it was replacing is recorded nowhere
  else). Where the files no longer permit a safe repair the answer is `commit-interrupted`, a
  refusal. Previously a SIGKILL between two renames left a half-merged repo that `doctor` called
  healthy, `validate` blamed on the author's delta, and nothing could roll back.
- **A removal marker can no longer be published into a living contract.** `x-loam-remove` written at
  path level, beside the methods, names no operation and retires nothing; `archive` gates it
  (`openapi.remove-marker-path-level`) and the marker is stripped from every merge branch, so it
  never reaches the fleet's living OpenAPI under any flag.
- **Symlinked service and feature directories are enumerated.** A `services/<svc>` or
  `features/<FEAT>` reached through a symlink used to vanish from every listing, which also produced
  a false `landscape.binding-unknown` for the service that was right there. Dangling links are
  skipped exactly as an absent directory is.

### Fixed — checks that were blind

- **Nested landscape elements are graded.** The landscape cross-check kept only top-level elements,
  so ordinary grouped C4 — services under an `enterprise`, `group` or `boundary` — reported *every*
  service as unmodelled. The tree is walked instead: an element is at service level when no ancestor
  already stands for a service, an element that contains a service is a grouping, and
  `landscape.binding-unknown` is now graded at any depth.
- **A missing `openapi.yaml` no longer silences the API axis.** It is an **error** when a living
  non-`REMOVED` `Operations:` line or an op-linked landscape edge already points into the absent
  file, with the stranded operationIds in `details`; a warning when nothing does and the landscape
  cannot prove nobody calls the service; silent when it can. Correspondingly, one absent contract is
  one finding rather than one `spine.op-undefined` per inbound consumer — a file that is not there
  proves nothing about an edge.
- **A feature delta addressed to a nonexistent service is refused** (`delta.service-unknown`, naming
  close ids). A typo in `--touches` used to validate green and materialise a phantom service
  directory on archive.
- **`openapi.duplicate-operationid` fires in service scope**, not only through an unrelated
  feature's delta — so `validate --all` sees it on a fleet with no feature in flight.
- **`c4.uncovered` no longer fires on a re-declared edge.** A delta that restates a living edge to
  hang a requirement on it was told to write a decorative architecture requirement.
- **`loam doctor` reports what it could not see before**: a held or stale `.loam-lock`, an
  interrupted commit, orphaned staging temp files, and generated command/skill files that have
  fallen behind (below).

### Changed — verification says which answers came from a test run

`--record` may still confirm a `scenario.tested` claim on an agent's word; a service with no
runnable suite yet has to be able to record its answers. What changed is that the record now says
so, everywhere:

- a three-valued **`verdict`** — `verified`, `attested`, `unverified` — recomputed from `claims[]`
  on every read and never taken from the record's own `summary:` block. `verified` in `--json` is
  exactly `verdict === "verified"`, so a record with zero claims no longer reads as verified by
  arithmetic;
- `verify.scenario-attested` (warning, gating nothing) naming each claim, on the read view, the
  recording view and the frozen post-archive view alike; `loam status` re-reports it and offers
  `next.verify-attested`, and such a feature reaches `stage: ready`, never `done`;
- a `summary:` block contradicting its own `claims[]` makes the whole record `record-unreadable`
  (`verify.record-miscounted`) — neither half can be believed, so neither is reported as fact;
- `--results` writes down **which report it read** (path, sha256, mtime, tagged-scenario count),
  must resolve inside the attesting repository in federated mode, and refuses a committed report
  that differs from the attested commit. That says which file was consumed; it does not say the file
  came from executing that commit, and no digest can;
- two services wording a scenario identically share one digest, so a single report cannot say whose
  suite ran it: those claims are left unconfirmed under `verify.digest-contested` rather than
  confirming both.

### Changed — `loam status` is a projection over the gates

`status` used to say "ship it" on trees `archive` refused. It now takes `stage` and `next[]` from
the union of what `validate --feature` errors on and what `archive` refuses to merge, so it may be
more pessimistic than either and is never greener than both — an invariant with a test behind it.
Also: `checks.coherent` runs the same functions `validate` does (coherence, provenance, missing
scenarios); `owesContract` keys on the contract *file* rather than the service directory; `next[]`
names `loam delta`, `loam gherkin` and `loam rebase`; the fleet form is capped at ten steps plus a
`next.elided` notice and always ends on `next.fleet-gate`; and a filesystem failure that carries no
path (a directory where a file belongs) is reported rather than crashing the command.

### Changed — generated agent files carry a version stamp

Every generated command and skill body now opens with `<!-- generated by loam vX.Y.Z -->`, and
`loam doctor` raises `doctor.agent-files-stale` for a file with no stamp or an older one. loam still
never rewrites a generated file — the fix is a human's — but drift is now detectable, which it
previously was not: a command file mangled to one line left `doctor: healthy: true`. Doctor also
stops reporting a repo initialized `--no-skills` as missing its skills.

`loam rebase` and `loam status` were added to the shipped workflow bodies, which is where the
mechanism that prevents two in-flight features from overwriting each other actually gets run.
`doctor`'s fix line now spells `loam adopt --service <id>`; the positional form it used to print is
refused by the CLI, and a new test parses every command loam prints against the real CLI so that
class of defect cannot return silently.

### Changed — `loam init` keeps the pointer it was given

`--docs` wins only when it is actually passed. A re-run in a wired repository keeps the `docsDir`
its committed `loam.json` already names, `--create` included, and spreads the rest of the config
forward; `--json` reports `docsDirSource` as `flag`, `config` or `default`. Following `doctor`'s
advice to re-run `init` used to repoint the repo at an empty decoy over which `validate --all` went
green.

### Fixed — the OpenSpec on-ramp

- **A Store checkout is audited by its planning shape, not by its marker.** A
  `.openspec-store/store.yaml` beside real `specs/` used to make audit look for
  `<checkout>/openspec`, find nothing, and report `ready: true, capabilities: 0` — then apply a
  target holding no requirements at all. The shape picks the root; the marker picks only the kind; a
  checkout with planning content in neither place is refused by name.
- **A workspace nobody could read is never `ready`** (`openspec.workspace-empty`).
- New blockers for shapes that silently migrated nothing: `openspec.change-quoted-requirements`
  (requirements under `## Requirements` inside an active delta — the shape OpenSpec's own living
  template mandates, which stages nothing in a change), `openspec.nonstandard-living-spec` (markdown
  under `specs/` named neither `spec.md` nor `design.md`), `openspec.hidden-change-directory` (a
  dot-prefixed directory under `changes/`, which enumeration skips).
- **The source digest no longer covers archived changes.** Frozen history never gates, so it must
  not be able to invalidate a completed mapping either; a living or active edit still does.
- **The staged target is a real docs repo** — its own `loam.json`, `AGENTS.md` and an empty
  `architecture/landscape.likec4` — so `FOLLOW-UP.md`'s instructions run where they are written, and
  `FOLLOW-UP.md` now ends with the cutover procedure: `services/` and `features/` move, everything
  else is review residue.
- **A target inside a live loam fleet is refused**, instead of producing phantom features in every
  `loam list`.
- The living capability tree is copied verbatim under `legacy/openspec/specs/`, so `## Purpose`
  prose, section prose and capability `design.md` are preserved rather than dropped; an ISO-8601
  `created` timestamp is a valid date; fenced FROM/TO examples inside a `## RENAMED Requirements`
  block are no longer parsed as renames; and a rename's TO name no longer demands a service
  allocation the router never asks for.

### Performance

`loam list` and `loam validate --service` are now flat in landscape edge count: loam reads LikeC4's
parsed model and never computes a view, which it had no use for. On a generated 120-service fleet
the same commands previously did not finish above roughly 200 edges. Measured at 120 services and
400/800 edges on an 8-core laptop: `list --json` 1.1–1.5 s, `validate --service <id> --json` 1.4–1.6
s. `loam init` no longer scaffolds a `views { view index { include * } }` block it never reads.

`loam validate --all` remains ~30 s on that fleet — it parses a fresh LikeC4 workspace per service —
and no speedup is claimed for it. Its target loop is now a bounded pool rather than a serial
`await`, which is byte-for-byte output-identical and deterministic in ordering, but measured as a
wash on the hardware available; the lever that moved this command was the parsed model, not the loop
shape.

### Fixed — release engineering

- The CI `package` job could never pass: `release-check.mjs` refused `--fixture-ready` whenever
  `GITHUB_ACTIONS` was set. The guard now keys on a tag ref, which is what it was actually
  protecting against. Any claim that CI had validated release readiness was false before this.
- `npm run test:package` failed against the current tarball — the smoke test called
  `loam init --docs docs` without `--create`.
- Five release scripts spawned `npm.cmd`/`loam.cmd` without a shell, which Node ≥ 20.12 rejects on
  Windows; they now resolve npm's CLI and run it through `process.execPath`. Windows itself is
  unexercised here — there is no Windows host — so this is verified structurally and a platform
  runtime check remains outstanding.
- `pack-release` and `verify-release-artifact` compared an unpeeled `GITHUB_SHA` against `HEAD`, so
  an annotated or signed tag — the `npm version` and `git tag -a/-s` default — could never pass.
  Both peel now; `git tag -s v<version>` works.
- Release artifact retention raised 1 → 14 days, so a candidate awaiting human approval outlives a
  weekend; CI narrowed to pushes on `main` with a concurrency group, so tags no longer run both
  workflows in parallel.

### Documentation

README, COMPARISON, SCHEMA and MIGRATING were re-checked claim by claim against the code and against
upstream OpenSpec live on 2026-08-05. Corrected: the documented migration entry point
(`migrate-openspec <root>` returns `invalid-option`; `audit-openspec` is the real first step and
appeared nowhere in the README), the corpus and test counts, the `--baseline` flag the reproduction
recipe needs, the Executability and agent-surface comparison rows, and the claim that OpenSpec has
no multi-repo story — Stores shipped in v1.5.0, and the honest argument is their documented "No
sync, ever — by design" plus the absence of any lockfile or commit pin. Removed: the argument that
upstream's generated instructions are broken, which upstream fixed inside 48 hours and which loam
had in its own surface.

### Added

- A tag-driven npm release gate using GitHub OIDC trusted publishing and provenance.
- A reproducible two-fleet pilot harness and scorecard contract.

### Changed

- The supported runtime now matches the direct LikeC4 dependency: Node.js 22.22.3 or newer.

## Upgrading to this release

Nothing to upgrade from — this is the first published version. One note for a repository initialized
from a pre-release build: the first `loam doctor` after installing this one reports
`doctor.agent-files-stale` for **every** generated command and skill file. Earlier builds wrote no
version stamp, so "no stamp" and "an old stamp" are indistinguishable, and loam refuses to assume
the instructions on disk describe this binary. Read each file, then bump its stamp by hand, or
delete it and re-run `loam init` — the drift is reported and never repaired for you.
