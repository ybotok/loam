/**
 * The `loam-drawing` reference page: how to draw the C4 model so that a person
 * can read the picture — one relationship kind per kind of traffic, an arrow
 * that points where the evidence says, a legend, and overview views that each
 * answer one question.
 *
 * WHY A PAGE. A large real fleet was drawn by agents following loam's pages,
 * and every document validated while the pictures were unreadable: every arrow
 * pointed into the broker and the stores (deployment configuration says only
 * that two things are connected, and the agents turned that into a direction),
 * the overview views were walls of tiny boxes, and the lines were the default
 * gray because LikeC4 merges relationships of different kinds into one line
 * with no style. Nothing loam grades could have caught any of it — loam reads
 * elements and relationships and never a view, and no check reads a
 * relationship's KIND — so the only place the lesson can live is the text an
 * agent reads before it draws. That text is consulted at a moment the agent
 * can name ("I am drawing an edge", "I am writing a view"), which is the split
 * rule in ../reference.ts: a reference page, not AGENTS.md.
 *
 * WHY ITS OWN PACKAGE. ../ sits at the five-file cap, and this page is a
 * subject of its own rather than a section of an existing one: loam-spine says
 * which joins the metadata makes, and this page says how the picture is drawn
 * around them. Every LikeC4 spelling below was measured at the 1.59.2 pin
 * (`likec4 validate`, `export json`, `gen dot`) on a neutral fleet shaped like
 * examples/docs — never on the fleet the lesson came from, which is
 * confidential and must not reach this repository in any form.
 */
import type { CommandContent } from "../../../contract.js";

export const LOAM_DRAWING: CommandContent = {
  name: "loam-drawing",
  description:
    "Reference: drawing the map so a person can read it — relationship kinds and which way each arrow points, the legend, overview views",
  // A reference page takes no arguments: see ../spine.ts for why the hint is
  // empty rather than a spelled-out "<none>".
  argumentHint: "",
  purpose:
    "How to draw the C4 model so the picture reads: one relationship kind per kind of traffic and an arrow only where evidence gives one, a legend drawn from real edges, and overview views that each answer one question at one altitude.",
  invocation: "loam instructions loam-drawing",
  placeholders: [],
  spine: [
    "Which way an arrow points — the relationship kinds",
    "The legend",
    "Overview views that read",
    "A feature's message flows",
  ],
  body: `Drawing the fleet so that a person can read it: one relationship kind per kind of traffic, an arrow only where evidence gives one, a legend, and overview views that each answer one question.

Nothing on this page is graded. loam reads elements and relationships, never a
view, and no check reads a relationship's kind — so a map can validate clean
and still be a wall of tiny boxes joined by gray lines. Every spelling below was
measured at the LikeC4 1.59.2 pin loam ships.

## Which way an arrow points — the relationship kinds

A plain \`->\` says only that two things are connected. A fleet drawn from
deployment configuration, which says nothing more than that, ends with every
arrow pointing into the broker and the stores. So give every relationship ONE
kind, and give each kind one meaning:

- \`publishes\` — producer \`->\` topic, with \`metadata { publishes '<message>' }\`:
  the producer puts the message on the topic.
- \`delivers\` — topic \`->\` consumer, with \`metadata { consumes '<message>' }\`:
  the broker hands the message to the consumer.
- \`reads\` — service \`->\` store, its head drawn at the SERVICE end (a tail
  arrow): data flows out of the store into the service.
- \`writes\` — service \`->\` store, its head at the store: data lands in the store.
- \`readsWrites\` — service \`->\` store, heads at both ends: both.
- \`calls\` — caller \`->\` provider, with \`metadata { op '<operationId>' }\`: a
  synchronous request.
- \`connects\` — gray, dashed, no arrowhead: a connection whose direction nobody
  has established yet.

For the store kinds the arrowhead is where the data lands, and putting it there
is the style's job, never the arrow's: a store edge is ALWAYS written
service \`->\` store, and a read gets its head at the service end from the
\`reads\` style. Never flip a store edge to show a read. \`Covers:\` names an
edge as \`a -> b\`, review order reads a plain edge's source as depending on its
target, and the consumer census behind \`landscape.datastore-shared\` reads both
directions only for an element whose kind is \`database\`, \`queue\`, \`topic\`,
\`cache\` or \`bucket\` — a store drawn as any other kind has a service for a
consumer only when the store is the edge's TARGET. SCHEMA.md, "Which way an edge
points", lists every reader.

**Never guess a direction.** Give an edge a direction only from evidence:

- the service's code: the client that sends, the listener that receives, the
  repository that writes;
- a configuration name that says which side the service is on —
  \`*_PRODUCER_*\`, \`*_CONSUMER_*\`, a consumer-group id;
- the service's own \`asyncapi.yaml\`: \`action: send\` publishes,
  \`action: receive\` consumes.

Configuration that lists a broker address or a database URL says only that the
two are connected: draw that as \`connects\`. A \`connects\` edge is an honest
placeholder, not a defect, and adopting the service from its code is what turns
it into a real kind (\`loam instructions loam-adopt <id>\`, step 3). A guessed
\`publishes\` is worse than a \`connects\`: it reads exactly like a right one, it
binds the event spine, and nobody goes back to check it.

Declare the kinds once, in \`architecture/landscape.likec4\`'s own
\`specification\` block, where every extending model borrows them:

    specification {
      relationship publishes {
        color amber
        line solid
        head normal
      }
      relationship delivers {
        color amber
        line solid
        head normal
      }
      relationship reads {
        color green
        head none
        tail normal
      }
      relationship writes {
        color green
        head normal
      }
      relationship readsWrites {
        color green
        head normal
        tail normal
      }
      relationship calls {
        color secondary
        line solid
        head normal
      }
      relationship connects {
        color gray
        line dashed
        head none
        tail odot
      }
    }

Then name the kind in brackets on each edge:

    marketplace.checkoutWeb -[calls]-> marketplace.orderService 'createOrder' {
      metadata { op 'createOrder' }
    }
    marketplace.orderService -[publishes]-> kafka.orderEvents 'OrderPlaced' {
      metadata { publishes 'order.OrderPlaced' }
    }
    kafka.orderEvents -[delivers]-> marketplace.paymentService 'OrderPlaced' {
      metadata { consumes 'order.OrderPlaced' }
    }
    marketplace.paymentService -[reads]-> marketplace.ordersDb 'order totals'
    marketplace.orderService -[connects]-> kafka 'broker address in its deployment config'

A store a service owns and nests INSIDE its own element cannot take an edge from
that element: LikeC4 refuses a relationship between a parent and its child
("Invalid parent-child relationship"). Draw that edge from the container that
does the work, in the service's own model
(\`marketplace.orderService.api -[readsWrites]-> marketplace.orderService.db\`),
or draw the store beside the service.

A feature's \`delta.likec4\` parses on its own, so it declares every kind it
draws in its own \`specification\` block too. **The living map must declare that
kind as well before the feature archives.** \`loam archive\` copies the edge into
\`architecture/landscape.likec4\` as written and never copies a declaration, so
on a map that lacks the kind the merged map would not parse.
\`loam validate --feature\` and \`loam status <FEAT>\` say so beforehand, as
\`delta.specification-not-merged\` (an error), naming the line to add — for
example \`relationship publishes\` in \`architecture/landscape.likec4\`'s
\`specification\` — and \`loam archive\` refuses until it is there, \`--approve\` or
not. The same holds for an element kind, a tag and a custom color. A kind is
vocabulary, not a change, so adding it to the map's \`specification\` is an
ordinary edit to the living map, made in the feature's change or in one before
it. When another \`architecture/\` document already declares it, the finding says
so: move that declaration into the landscape rather than declaring it twice.

Two spellings to avoid:

- **Never put a tag on a kind** (\`relationship publishes { #async }\`). LikeC4
  copies a kind's tags onto every edge of that kind. A \`#<FEAT>\` there makes
  every such edge in the delta part of the change, context included, and an
  \`#obl-\` tag there claims the obligation for every edge of that kind. Tag the
  edge instead.
- **Never use the dotted form** (\`orderService .publishes kafka.orderEvents\`).
  LikeC4 reads it, but not every loam reader does: \`loam validate --base\` scans
  an extending model without the map's kinds and does not see such an edge.
  Write \`-[publishes]->\`.

\`connects\` carries \`tail odot\` on purpose. An edge with no arrowhead at either
end is laid out with \`constraint=false\` and \`minlen=0\`, and enough of them
collapse a view into one band. The small circle at the source keeps the edge in
the layout without claiming a direction.

The kind is the picture and the metadata is the join. \`metadata { op }\`,
\`publishes\` and \`consumes\` are what loam grades (\`loam instructions loam-spine\`).
A kind changes no grade, so a kind with no metadata beside it is a drawing that
nothing checks.

## The legend

Add a \`legend\` view to \`architecture/landscape.likec4\` that draws ONE real
edge of each kind the map uses. Use real services, a real topic and a real store,
so that a reader learns the colours from the fleet itself. Name each edge by
both of its endpoints:

    view legend {
      title 'Fleet / 0 · Legend'
      include marketplace.checkoutWeb -> marketplace.orderService
      include marketplace.orderService -> kafka.orderEvents
      include kafka.orderEvents -> marketplace.paymentService
      include marketplace.paymentService -> marketplace.ordersDb
    }

A view can name only elements the model declares, so the legend is written once
the map has real edges of each kind, and it gains a line when the map gains a
kind. \`loam init\` cannot scaffold one, because an empty map has nothing to draw.

## Overview views that read

A view is a picture for one reader with one question. Every rule below comes
from an overview that drew the whole fleet and so showed nothing:

- **One question per view, at one altitude.** "Who publishes to the broker?" is
  one view, and "who calls whom" is another. A fleet overview draws subsystem
  boxes, not services: the generated \`architecture/subsystems.likec4\` and
  \`architecture/services.likec4\` views are the drill-down. Aim for at most
  about 20 nodes and 25 drawn lines.
- **Filter by ONE kind, and say it positively.** A view above service altitude
  merges every relationship between two boxes into one drawn line. When those
  relationships are of different kinds, LikeC4 falls back to the default gray
  and the line says nothing. \`where kind is publishes\` keeps the line amber;
  \`where kind is not calls\` and \`where kind is publishes or kind is connects\`
  still merge into gray.
- **Know the form that draws nothing.** Where \`fleet\`'s children are subsystem
  groups, \`include fleet.* -> * where kind is publishes\` renders an EMPTY view,
  with no error. Use a unary form, a named target or a tag target instead:

      include fleet.* -> where kind is publishes
      include fleet.* -> element.tag = #broker where kind is publishes
      include kafka -> fleet.* where kind is delivers
      include -> fleet.* where kind is delivers

- **Prefer relationship rules to element lists.** An element included directly
  brings every relationship between it and the others: \`include fleet.orders, kafka\`
  draws one merged gray line, where
  \`include fleet.orders -> where kind is publishes\` draws one amber line.
- **Lay out rows with \`rank\`.** \`rank source { … }\`, \`rank same { … }\` and
  \`rank sink { … }\` put nodes in rows, and the braces are required. A
  \`rank source\` row whose nodes' edges all point INTO them is ignored, so a row
  of consumers belongs at \`sink\`.
- **Give a direction-less edge a marker.** An edge with no arrowhead at either
  end is laid out unconstrained and collapses the view into one band, so give it
  \`tail odot\`, as the \`connects\` style above does.
- **Titles make folders.** LikeC4 splits a title on \`/\` into browser folders
  and lists sub-folders before views, so number the views you want read in
  order: \`title 'Fleet / 1 · Who publishes'\`.
- **Never author \`view … of\` a subsystem or service element.** The generated
  views own that drill-down, and an authored one in a file that sorts before
  them — \`landscape.likec4\` does — takes the click from every other view that
  draws the element.
- **No \`xs\` nodes across a whole fleet, and no \`include parent.**\` with
  excludes.** Together they drew a 68-node band at 2.5 pixels per label, a view
  nobody can read.

## A feature's message flows

A feature delta draws a message the way the map does: through the broker. Write
\`orderService -[publishes]-> kafka.orderEvents\` and
\`kafka.orderEvents -[delivers]-> notificationService\`, never
\`orderService -> notificationService\` for an event. A direct edge reads as a
call, sits outside the event spine, and draws a second picture of the topic the
map already draws. Point at the topic the living map nests in the broker, leave
that context untagged, and tag only the edges the feature adds.

A producer outside the fleet is an \`#external\` element, and the edge it
publishes on carries the metadata (\`loam instructions loam-spine\`, "A message
produced outside the fleet", has the full join):

    crm = softwareSystem 'crm' {
      #external
    }
    crm -[publishes]-> kafka.crmEvents 'CustomerUpdated' {
      metadata { publishes 'crm.CustomerUpdated' }
    }
`,
};
