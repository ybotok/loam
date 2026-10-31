/**
 * The `loam-spine` reference page: how the artifacts JOIN.
 *
 * Operation and message ids, coverage and permission references, the
 * capability tree and its `Realizes:` join, the requirement baseline pins
 * (`Based-On:` / `x-loam-based-on`), how to draw a shared broker, how to
 * declare a message produced outside the fleet, and where those joins are
 * written instead when the map is still `loam seed`'s.
 *
 * This is the grammar a reader consults while writing ONE document, which is
 * why it is a printed page rather than a section of AGENTS.md: it is consulted
 * at a moment you can name, and paying for it on every invocation of every
 * session bought nothing. Which element IS which service deliberately stayed
 * in AGENTS.md — today as ORIENTATION's `## The identity rule` in
 * ../../agents-md.ts — because an agent cannot read the landscape at all
 * without it, so it is orientation rather than reference.
 *
 * The text is the AGENTS.md section verbatim; nothing was rewritten to move
 * it, so a cross-reference from the remaining file still names the same
 * headings. The one section written here since, the seeded map's, was added
 * when fleet.yaml learned to state joins: it is the answer to "where does
 * this join go" that the other sections' landscape snippets would get wrong on
 * a map seed still owns. See ./reference.ts for why these four pages exist.
 */
import type { CommandContent } from "../../contract.js";

export const LOAM_SPINE: CommandContent = {
  name: "loam-spine",
  description: "Reference: the ID spine — every join between the artifacts, and the baseline pins",
  // A reference page takes no arguments: it is one document, printed whole.
  // The empty hint is what `loam instructions` prints beside the name, and an
  // invented one ("<none>") would read as an argument somebody could pass.
  argumentHint: "",
  purpose:
    "The exact joins the artifacts are held together by — operationId, message name, `Covers:`, `Requires:`, `Capability:`/`Realizes:` — and the `Based-On:` pins that stop two features in flight reverting each other.",
  invocation: "loam instructions loam-spine",
  placeholders: [],
  spine: [
    "The ID spine",
    "The requirement baseline — `Based-On:`",
    "Drawing a shared broker",
    "A message produced outside the fleet",
    "A seeded map: state the joins in fleet.yaml",
  ],
  body: `The ID spine: how the artifacts join, and what pins a change to the version it was written against.

## The ID spine

The spine is a family of exact joins, not one magic id: feature tag; service
binding; synchronous operation; asynchronous message; architecture coverage;
authorization permission. Three artifacts describe the same synchronous call in
three languages. They are joined by the **operationId**, and that join is what
\`loam validate\` checks:

- architecture — a C4 edge names the operation it calls:
  \`checkoutWeb -> paymentService 'Calls authorizePayment' { metadata { op 'authorizePayment' } }\`
- behaviour — a requirement declares the operations it governs:
  \`Operations: authorizePayment\`
- contract — the provider's \`openapi.yaml\` defines it:
  \`operationId: authorizePayment\`

Spell it identically in all three places. A mismatch is an error, not a warning:
an edge calling an operation nobody defines is a broken contract between services.

Features are joined the same way: a delta's new elements and edges carry the
feature id as a LikeC4 tag (\`#FEAT-101\`), and that tag is exactly what
\`loam archive\` folds into the living landscape. Untagged elements in a delta are
context for the diagram, not changes.

The other joins use the same discipline:

- \`metadata { publishes|consumes 'message' }\` on an edge ↔
  \`Publishes:\`/\`Consumes:\` in a requirement ↔ the AsyncAPI 3 message name;
- \`Covers:\` in an architecture requirement ↔ a C4 element/edge or
  \`alert:<id>\` / \`sli:<id>\` from health.yaml;
- \`Requires: <subject>/<permission>\` in either requirement file ↔ the fleet
  declaration in \`architecture/permissions.yaml\`;
- \`Capability:\` in either requirement file ↔ a declared id in
  \`architecture/capabilities.yaml\`. A LIST, comma-separated — the relation is
  many-to-many in both directions.

The permissions file is opt-in: a fleet with no \`Requires:\` line owes none.
Once a requirement names a permission, an undeclared pair is
\`permissions.unknown\` (error). An unreadable vocabulary is
\`permissions.invalid\`; a declaration nothing requires is
\`permissions.unenforced\` (warn). The subject is what the permission is checked
ON (user, profile, service), not necessarily the caller. \`owned_by\` and
\`enforced_by\` are explanatory and are not resolved against services; this is
a checked document join, not proof that the identity provider implements it.

The capability axis opts in the OTHER way: the FILES are the opt-in, not the
line. A fleet with neither \`architecture/capabilities.yaml\` nor a
\`capabilities/\` directory gets no capability findings at all, however many
\`Capability:\` lines its requirements already carry.

A capability may be declared on either side, and the vocabulary is the UNION.
A name alone is a line in \`architecture/capabilities.yaml\` —
\`capabilities: {<id>: {description, owner}}\`, nested ids such as
\`payments/refunds\` kept as one flat key. A name with prose behind it gets a
document instead: \`capabilities/<id>/spec.md\`, the AUTHORED business tree,
one directory per capability with nesting spelled by the tree
(\`capabilities/payments/refunds/spec.md\`). The directory is the list — there
is no manifest — and its existence is what opts the fleet in, so \`loam init\`
does not scaffold it. A directory holding neither the document nor a
capability beneath it is \`capability.doc-missing\` (warn).

The document carries narrative and then \`## Requirements\`, in the same
grammar every spec.md uses, with two rules of its own. Every requirement needs
a \`Requirement-ID:\` — these documents outlive the services that realize them,
so identity is the line and not the heading; without one it is
\`capability.requirement-unidentified\` (error). And a capability requirement
must be observable OUTSIDE the fleet: \`Operations:\`, \`Covers:\`,
\`Publishes:\` and \`Consumes:\` all resolve against one service's own contract,
so carrying any of them is \`capability.requirement-service-scoped\` (error) —
write it in that service's spec.md instead. Naming no service is an authoring
rule that PR review holds, not one loam checks: matching service names in prose
would be a heuristic, and loam does not guess. The axis's own two joins are
refused here as well (\`capability.requirement-inert-join\`, error): they point
INTO the tree, so nothing reads them written inside it.

A FEATURE changes a capability document with a delta, not by editing it:
\`features/<FEAT>/capabilities/<id>/spec.md\`, the same
\`## ADDED|MODIFIED|REMOVED Requirements\` grammar the service deltas use, the
same nesting (\`features/<FEAT>/capabilities/payments/refunds/\`), the same
\`Based-On:\` pins, and the same \`delta.*\` refusals with the capability id as
the subject. \`scaffold.placeholder\` reads it too, so an unedited template
heading refuses the archive here as it does in a spec delta, and
\`capability.doc-missing\` (warn) names a directory in it that holds no
\`spec.md\` — an empty one is not a delta, so the merge would carry nothing.
\`loam archive\` merges it into the living document in the same
transaction as the service merge, creating \`capabilities/<id>/spec.md\` — and
so the whole tree — when this is the first feature to mention it. Only what
the delta marks as the document's own comes across: its H1 as the title
(unless it names the feature or calls itself a delta — then the title is the
id), its \`## Purpose\` section as the narrative, and a line linking back to the
archived delta for everything else, because loam merges requirements and never
prose; after that the narrative is yours to edit in place. The document's three rules above are
graded on the delta BEFORE the merge, so a capability requirement filed at the
wrong altitude is refused while you still hold it. Editing the living document
directly is still legal; the delta is what makes two features touching one
promise collide loudly instead of silently. \`loam new <FEAT> --capability <id>\`
scaffolds that delta, and \`loam show <FEAT>\` and \`loam delta <FEAT>\` list the
promises a feature changes — a capability delta names no service, so without
those two a business-only feature reads as a feature carrying nothing.

A service requirement says which promise it serves with \`Realizes:\`, entries
spelled \`<capability-id>#<Requirement-ID>\`. This is the join the tree exists
for, and it is NOT the same claim as \`Capability:\` beside it — that names a
theme, this names one promise, and a requirement commonly carries both. The
capability half of an entry is what makes the target addressable, since a
\`Requirement-ID\` is unique only inside its own document; the separator is the
LAST \`#\`, because the requirement half's grammar excludes one and the
capability half's does not. Written by whoever implements the requirement,
never by the analyst — a business document must not be edited every time the
fleet rearranges which service carries which part.

Both directions are graded. An entry naming no capability requirement is
\`capability.realizes-unknown\` (error; in a feature delta it gates
\`loam archive\`, \`--approve\`-overridable), and its message says which of the
five failures happened — malformed entry, undeclared capability, declared but
undocumented, document with no requirements, or an id that document does not
declare. A capability requirement nothing keeps is
\`capability.requirement-unrealized\` (warn, one per requirement): it never
gates, because writing the business document ahead of the fleet is the intended
use. \`loam list capabilities --json\` carries the whole join — each capability's
requirements, and what realizes each one.

\`Realizes:\` is not the only way to keep a promise, and for a criterion that
CROSSES services it is not enough: "I enter a login and a password and I am in"
belongs to no single service's spec, because each promises only its own part. A
USE CASE can carry it, because it IS the hop sequence. So a \`dynamic view\`
already tagged \`#cap-<slug>\` may carry \`#req-<slug>\` as well, naming one of
that capability's requirements — the architect's answer to the analyst's
promise, graded by the same four \`usecase.*\` codes down to the operation. The
second tag is SCOPED by the first: a \`Requirement-ID\` is unique only inside its
own document, so a \`#req-\` tag on a view that resolves no capability, or two, is
\`usecase.requirement-unresolved\` (error) rather than a guess. Several \`#req-\`
tags on one view are legal — a flow commonly keeps two promises. Both tags spell
their id with every character outside \`[A-Za-z0-9_-]\` flattened to \`-\`,
because that is all a LikeC4 tag name accepts.

Against that vocabulary an undeclared name is \`capability.unknown\` (error; in
a feature delta it gates \`loam archive\`, \`--approve\`-overridable), an
unreadable \`capabilities.yaml\` is \`capability.invalid\` exactly once per run
with every grade that resolves against the vocabulary suspended behind it, and
a declared capability no living requirement realizes is
\`capability.unrealized\` (warn, one per capability). The fleet total is
readable: \`loam list capabilities\` reports each capability's realizing
requirements, their services and the draft/verified split, and
\`loam explore --capability <id>\` seeds an exploration from the realizing
services.

## The requirement baseline — \`Based-On:\`

A MODIFIED requirement carries its FULL new text, not a diff, so archive does not
merge your wording into the living one — it REPLACES it. When two features rewrite
the same requirement, the loser loses everything they wrote, scenarios and all.

\`loam validate\` names the other feature while both are in flight
(\`delta.modified-conflict\`), but that warning cannot see the case that actually
happens: the first feature archives, stops being an active feature, the second
revalidates GREEN, and its archive lands text written against a document that no
longer exists — \`+0 ~1 -0\`, exit 0, nobody told.

So a MODIFIED or REMOVED requirement pins the living version it was written
against, directly under its identity:

\`\`\`markdown
### Requirement: Cancel an order
Requirement-ID: REQ-042
Based-On: 3bcc7a40f2b23ff3
\`\`\`

You do not compute that value — \`loam rebase FEAT-101\` writes it, for every
MODIFIED/REMOVED requirement in the feature, from the living text as it stands
right now. Run it when you finish authoring a delta, and again after you resolve
a collision. Archive refuses on a stale pin (\`delta.baseline-stale\`) and says
both digests.

**Restamping is not resolving.** A pin claims "I read this version". If
\`loam rebase\` reports a requirement as moved, re-read the living requirement and
fold in what you still mean BEFORE you ship — otherwise you have re-pinned to a
document you never read, and archive will merge your text over theirs with
loam's blessing. There is no automatic three-way merge and there will not be one:
requirement prose does not merge, people do.

A delta adopted from OpenSpec has no such line and gets a warning
(\`delta.baseline-missing\`) — one that GATES the archive: unpinned is exactly
the shape that reverts someone else's landed change at exit 0. A migrated
corpus is not stranded by this: \`loam rebase <FEAT>\` pins every delta in one
command, and a human's \`--approve\` archives unpinned when the loss is meant.

### The same pin on the contract axis

A feature's \`openapi.yaml\` is a self-contained document holding ONLY what the
feature adds, changes or removes — not a copy of the living contract. The merge
walks only the paths and methods the delta spells: an operation you leave out
stays exactly as the living contract has it, a local \`$ref\`
(\`#/components/schemas/Order\`) resolves into the living document, and a new
operation has no living version to pin — an add-only delta needs no rebase.

What the merge does upsert is every operation the document DOES spell. So an
operation you quote without changing it — copied for context, or a whole
contract pasted in — is a collision waiting for someone else's edit: two
features over one service, each quoting the operation the other edits, destroy
each other, and the second to archive pushes its authoring-time copy back over
whatever landed in between. Quote nothing you do not change. Each quote costs a
pin, and a parallel feature that REMOVES the quoted operation makes it worse
either way: pinned, the quote is \`openapi.baseline-invalid\`, an error that
blocks your archive, and \`openapi.op-revived\` beside it; unpinned, it is
\`openapi.op-revived\` alone — a warning that gates, because the merge would
read the dead operation as a new one and put it back (\`asyncapi.slot-revived\`
is the same finding on a channel, operation or message slot). A parallel
feature that MOVES the operation to another address does the same to a quote
of the old one, which archived would answer the operationId at both. The fix
for both is to delete the quote. Keep it only when the feature brings a
retired operation back ON PURPOSE: then drop any pin, and a human archives
with \`--approve\`. \`loam rebase\` never pins a retired operation as new —
nothing lives at its slot, so there is no version to pin — and prints the same
finding (\`revived[]\` in \`--json\`), so the decision stays with you. It judges
the delta as it will write it, pins included: a quote of an address another
operation lives at now — one a move vacated, since re-occupied — IS repinned,
over the operation living there, which makes it an edit the merge would write;
the revival that edit makes is reported by that rebase (or its \`--dry-run\`),
not first by the next validate. The check reads the removal
markers of the features under \`features/archive/\` — a removal made by
hand-editing a living contract is invisible to it.

The guard against that collision, for every living operation the delta does
spell, is a pin — a vendor extension beside \`x-loam-remove\`:

\`\`\`yaml
paths:
  /orders/{id}/cancel:
    post:
      operationId: cancelOrder
      x-loam-based-on: 86feabe621ed887d
\`\`\`

\`loam rebase\` writes one on every operation in the delta the living contract
already holds, pinned to the living version; what the feature adds gets none.
That is what lets the merge tell a QUOTE from an EDIT:

- pin equals the operation's own content → you quoted it → **the merge skips it
  entirely** and the living contract keeps whatever it holds. Archive prints
  \`· quotes …\` so the plan never silently writes less than your delta spells.
- pin equals the living operation → you edited it, nobody else did → merged.
- pin matches neither → you edited it AND somebody landed a change to it →
  \`openapi.baseline-stale\`, refused.

The two surfaces an in-operation key cannot reach — path-level keys
(\`parameters\`, \`servers\`, \`summary\`, \`x-*\`) and every
\`components/<kind>/<name>\` — are pinned the same way through one root record,
\`x-loam-baselines\`, which \`loam rebase\` also writes and the merge strips: a
quoted key or component is skipped, an edited one is written and warned as
\`openapi.path-item-modified\` / \`openapi.component-modified\`. A new component
is copied in when something the merge writes references it; a living one you
only \`$ref\` needs no copy in the delta at all. Removal markers carry no pin;
\`openapi.remove-target-mismatch\` is what guards those.

## Drawing a shared broker

A broker drawn as ONE element is the node every service in the fleet points at,
and any view over it is a star nobody can read. Nothing in loam catches this —
loam parses the model and renders no view, so the map can be perfectly valid and
completely illegible. Two habits keep it readable, and both are cheap only
before the fleet is drawn:

**Model the topic, not the broker.** Nest a topic per channel inside the broker's
element and point the edges at it — \`paymentService -> kafka.paymentEvents\`, not
\`paymentService -> kafka\`. One hub of degree sixty becomes twelve of degree
five, and it is the truer model besides: what a producer and a consumer share is
the topic, never the broker. Every check joins the same way, because an edge into
a nested element resolves to the element that owns it. Declare the kind once —

    specification {
      element topic {
        style { shape queue }
      }
    }

The KIND is what does the work: since 2026-09-07 loam reads \`database\`, \`queue\`,
\`topic\`, \`cache\` and \`bucket\` as infrastructure rather than as candidate
services, so a topic drawn this way is out of the service census and nobody is
asked for a \`services/payment.events/\` (measured: the same element spelled
\`container\` earns \`landscape.service-undocumented\`, spelled \`topic\` it earns
nothing). This used to need \`#external\` ON THE KIND as a workaround, because
**LikeC4 does not inherit tags** and a topic nested inside an \`#external\` broker
is not external itself. That workaround is no longer owed. Tag the kind
\`#external\` if you want the topics out of the fleet VIEW as well — that is what
the next paragraph's \`exclude\` reads, and it is a rendering choice now rather
than a way to silence a check.

**Scope the views.** \`exclude element.tag = #external\` keeps the fleet overview to
the calls between our own services; a second view over the broker draws the event
spine on its own. Views are LikeC4's and loam computes none, so this costs loam
nothing and is worth doing anyway — an \`include *\` over the whole fleet map is
also the one view whose computation takes minutes rather than milliseconds. The
scaffolded landscape applies the same pruning to ubiquitous infrastructure with
\`#platform\`: the fleet view excludes it, and the platform view's
\`include * -> element.tag = #platform\` (the relationship form — the obvious
spelling draws boxes with no edges) keeps "who depends on it" answerable.

## A message produced outside the fleet

A platform service that is not ours — a config service, an auth broker —
produces messages our services consume, and no \`services/<id>/\` will ever hold
its contract. Declare the production on the landscape, where the element
already says \`#external\`:

    externalConfig = softwareSystem 'external-config' {
      #external
    }
    externalConfig -> kafka.configTopic 'publishes config refreshes' {
      metadata { publishes 'config.ConfigRefreshed' }
    }

\`spine.message-unproduced\` then stops firing — the message HAS a producer,
outside the fleet — and the contract question moves to the one file that can
answer it: the consuming service's own asyncapi.yaml. While that file declares
no shape for the message, \`spine.message-external\` (warn) says so; once the
consumer declares the payload, the axis is quiet. A truthful map and a green
build no longer exclude each other, which is the exact choice this used to force.

## A seeded map: state the joins in fleet.yaml

A landscape \`loam seed\` wrote carries a stamp on line 1, and while the stamp
holds, fleet.yaml is its source: every edge on it is a statement there. So on a
seeded map every join on this page is written in fleet.yaml, never in the
landscape — a hand edit, even a correct one, makes the map hand-owned, and seed
refuses it (\`seed-landscape-edited\`) from then on.

    calls:                       # caller -> provider, drawn -[calls]-> with metadata { op }
      - checkout-web -> payment-service: authorizePayment
      - order-service -> payment-service: [capturePayment, refundPayment]
    publishes:                   # producer -> broker, drawn with metadata { publishes }
      - payment-service -> kafka: payment.PaymentCaptured
      - external-config -> kafka: config.ConfigRefreshed   # an outside producer, declared under externals:
    consumes:                    # broker -> consumer, drawn -[delivers]-> with metadata { consumes }
      - kafka -> order-service: payment.PaymentAuthorized

Re-running \`loam seed --from fleet.yaml\` regenerates the map, one titled edge
per id, and \`loam validate --all --spine\` grades each join against the
contracts copied into services/<id>/. A \`consumes:\` line ends at a service: one
pointing at an external is refused with the arrow turned round, because it would
check nothing. A call into an external may name its operation; it is drawn and
never graded, because that contract is not in the docs repo. What fleet.yaml
cannot say — a title, a container, a nested topic like the broker section above
draws, a database — is past seeding: drawing it makes the map yours, and adopt
briefs and feature C4 deltas grow it from there.
`,
};
