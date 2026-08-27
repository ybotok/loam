/**
 * How the artifacts JOIN: operation and message ids, coverage and permission
 * references, requirement baseline pins (`Based-On:` / `x-loam-based-on`),
 * which element is which service, and how to draw a shared broker.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const SPINE = `## The ID spine

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

### The same pin on the contract axis — and why it matters more there

A feature's \`openapi.yaml\` is a COMPLETE document, not a patch: you restate the
living contract around the slot you are changing, and the merge upserts every
operation the document spells. So the collision on this axis needs no overlap at
all. Two features touching one service, editing DIFFERENT operations, destroy
each other — the second to archive quietly pushes its authoring-time copy of the
operation it never meant to touch back over whatever landed in between.

The same marker fixes it, as a vendor extension beside \`x-loam-remove\`:

\`\`\`yaml
paths:
  /orders/{id}/cancel:
    post:
      operationId: cancelOrder
      x-loam-based-on: 86feabe621ed887d
\`\`\`

\`loam rebase\` writes one on EVERY operation in the delta, pinned to the living
version. That is what lets the merge tell a QUOTE from an EDIT:

- pin equals the operation's own content → you quoted it → **the merge skips it
  entirely** and the living contract keeps whatever it holds. Archive prints
  \`· quotes …\` so the plan never silently writes less than your delta spells.
- pin equals the living operation → you edited it, nobody else did → merged.
- pin matches neither → you edited it AND somebody landed a change to it →
  \`openapi.baseline-stale\`, refused.

Not covered, deliberately, and worth knowing: path-level keys (\`parameters\`,
\`servers\`) and \`components/schemas\` are still upserted wholesale, so a restated
schema can still revert another feature's change to it —
\`openapi.path-item-modified\` and \`openapi.component-modified\` are your only
warning there. Removal markers carry no pin either; \`openapi.remove-target-mismatch\`
is what guards those.

## Which element IS which service

An element says which service it is with \`metadata { service 'payment-service' }\`.
Without one, its **title** is used instead — which is what most of this repo relies
on, and also the trap: rename a box in a diagram and every check joining it to
\`services/<svc>/\` silently stops matching. Bind an element whenever its title is
not exactly the directory name, and prefer binding over renaming a directory.

\`services/\` is the list of services — there is no manifest, and none should be
added. \`loam validate --all\` compares that list to the landscape both ways: a
directory nothing draws is an error, and an element with no directory is a warning.
Systems that are not ours — kafka, a payment gateway — carry \`#external\`, which
says so once and stops the warning for good.

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
a nested element resolves to the element that owns it. Declare the kind once and
tag it there —

    specification {
      element topic {
        #external
        style { shape queue }
      }
    }

— because **LikeC4 does not inherit tags**: a topic nested inside an \`#external\`
broker is not external itself, and \`loam validate --all\` will ask for a
\`services/payment.events/\` nobody owes (\`landscape.service-undocumented\`).

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

`;
