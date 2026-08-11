/**
 * How the artifacts JOIN: the operationId spine, the requirement baseline
 * pins (`Based-On:` / `x-loam-based-on`), which element is which service,
 * and how to draw a shared broker.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const SPINE = `## The ID spine

Three artifacts describe the same call in three languages. They are joined by the
**operationId**, and that join is what \`loam validate\` checks:

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
(\`delta.baseline-missing\`), never a refusal — an entire migrated corpus that
cannot archive is not a safety property.

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
also the one view whose computation takes minutes rather than milliseconds.

`;
