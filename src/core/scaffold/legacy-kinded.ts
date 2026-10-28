/**
 * The scaffolded fleet maps that declare the seven relationship kinds, frozen —
 * the generations after the ones ./legacy.ts holds.
 *
 * Split out of ./legacy.ts along the line the generations already had: every
 * stub there draws plain `->` edges and declares no relationship kind, every
 * stub here declares the seven kinds `loam instructions loam-drawing` teaches.
 * Each generation is a whole copy of a file of about 140 lines, and the fifth
 * would have taken ./legacy.ts past the 400-line limit. ./legacy.ts appends
 * this list to its own, so `LEGACY_LANDSCAPE_STUBS` stays one list in shipping
 * order and its readers see no seam.
 *
 * The rules are ./legacy.ts's: FROZEN — never re-derived from `LANDSCAPE_STUB`
 * in ./landscape.ts — OLDEST FIRST, and one entry appended whenever that stub's
 * text changes.
 *
 * Generation 5 (v0.2.0-alpha.13 through .14): the seven relationship kinds and
 * no technology palette — no `redisRed`, `oracleRed`, `kafkaAmber` or
 * `elasticTeal`, and no technology tag.
 *
 * Generation 6 (v0.2.0-alpha.15 through .16): the palette, and no `tag external`
 * — the one tag the stub's own comments told a reader to use, which a map
 * scaffolded by `loam init` then refused as undeclared while `loam seed`'s
 * declared it.
 */
export const KINDED_LANDSCAPE_STUBS: readonly string[] = [
  `// The fleet map: every service in services/ appears here, and every call
// between two of them is an edge. This file is written by hand — loam never
// guesses it, because "who calls whom" is the one fact no generator can read
// off a repository.
//
// After \`loam adopt --service <id>\`, add the service here:
//
//   paymentService = softwareSystem 'payment-service' {
//     description 'Owns payment authorization/capture'
//     metadata { service 'payment-service' }   // binds the box to services/<id>/
//   }
//
// and give each call the operationId it uses, so requirements, C4 and OpenAPI
// can be cross-checked:
//
//   checkoutWeb -[calls]-> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
//
// Every edge says what it carries with one of the relationship kinds declared
// below, and points the way the evidence says — never a guess:
//
//   checkoutWeb -[calls]-> orderService            a synchronous request
//   orderService -[publishes]-> kafka.orderEvents   producer to topic
//   kafka.orderEvents -[delivers]-> paymentService  topic to consumer
//   paymentService -[reads]-> ordersDb              always service to store; the
//                                                   style puts the head on the reader
//   orderService -[connects]-> kafka                no direction established yet
//
// Configuration that only names an address says two things are connected and
// nothing more: that is \`connects\`, and adopting the service from its code
// turns it into the real kind. Once the map has a real edge of each kind, add
// a \`legend\` view that draws one of each. \`loam instructions loam-drawing\`
// has the whole convention.
//
// The \`views\` block at the bottom is for LikeC4's own tooling — loam reads
// the model and never a view. Render with \`npx likec4 start\` from the docs
// repo root, which likec4.config.json scopes to this directory. A service's
// \`services/<id>/model.likec4\` EXTENDS this map: it declares no
// \`specification\` block of its own, so it belongs to THIS project and renders
// with it, containers and all. A model that declares its own \`specification\`
// stands alone instead — it renders only from its own directory
// (\`npx likec4 start services/<id>\`), and the \`exclude\` list in the root
// likec4.config.json has to cover that directory or its declarations collide
// with this file's. \`loam subsystem sync\` maintains both, so neither is
// hand-edited. Keep views
// scoped, because computing one is superlinear in the number of edges — the
// \`fleet\` view below stays affordable precisely because it excludes the
// platform hubs.
//
// One shape is worth getting right before the fleet is drawn: a shared broker.
// Kafka as a single element becomes the node every service points at, and any
// view over it is a star nobody can read. Model the TOPIC instead — a \`topic\`
// nested inside the broker's element, edges pointing at \`kafka.<topic>\` — which
// splits one hub of degree sixty into a dozen small ones and is the truer model
// besides. Tag the KIND, not just the broker: LikeC4 does not inherit tags, so a
// topic under an \`#external\` broker is not external itself and \`validate\` asks
// for a services/ directory nobody owes.
//
//   specification {
//     element topic {
//       #external
//       style { shape queue }
//     }
//   }

specification {
  element person
  element softwareSystem
  element container
  element database

  // Ubiquitous infrastructure — logging Kafka, auth, service discovery — takes
  // one inbound edge per service, and by the third service the fleet view is a
  // hairball. Tag those elements #platform: the fleet view excludes them
  // without losing "who depends on the Identity Provider", which the platform
  // view answers.
  tag platform

  // One kind per kind of traffic, each with one direction. The style is the
  // picture: amber for messages, green for data at rest, gray and dashed for
  // a connection nobody has given a direction yet. Never tag a kind: LikeC4
  // copies a kind's tags onto every edge of it.
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
    // A marker at the source: an edge with no arrowhead at either end is laid
    // out unconstrained, and enough of them flatten a view into one band.
    tail odot
  }
}

model {
}

views {
  view fleet {
    include *
    exclude element.tag = #platform
  }
  // The obvious spelling — \`include element.tag = #platform\` — draws the
  // platform boxes with NO edges and no consumers. The predicate that works is
  // the relationship form below.
  view platform {
    include * -> element.tag = #platform
  }
}
`,
  `// The fleet map: every service in services/ appears here, and every call
// between two of them is an edge. This file is written by hand — loam never
// guesses it, because "who calls whom" is the one fact no generator can read
// off a repository.
//
// After \`loam adopt --service <id>\`, add the service here:
//
//   paymentService = softwareSystem 'payment-service' {
//     description 'Owns payment authorization/capture'
//     metadata { service 'payment-service' }   // binds the box to services/<id>/
//   }
//
// and give each call the operationId it uses, so requirements, C4 and OpenAPI
// can be cross-checked:
//
//   checkoutWeb -[calls]-> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
//
// Every edge says what it carries with one of the relationship kinds declared
// below, and points the way the evidence says — never a guess:
//
//   checkoutWeb -[calls]-> orderService            a synchronous request
//   orderService -[publishes]-> kafka.orderEvents   producer to topic
//   kafka.orderEvents -[delivers]-> paymentService  topic to consumer
//   paymentService -[reads]-> ordersDb              always service to store; the
//                                                   style puts the head on the reader
//   orderService -[connects]-> kafka                no direction established yet
//
// Configuration that only names an address says two things are connected and
// nothing more: that is \`connects\`, and adopting the service from its code
// turns it into the real kind. Once the map has a real edge of each kind, add
// a \`legend\` view that draws one of each. \`loam instructions loam-drawing\`
// has the whole convention.
//
// The \`views\` block at the bottom is for LikeC4's own tooling — loam reads
// the model and never a view. Render with \`npx likec4 start\` from the docs
// repo root, which likec4.config.json scopes to this directory. A service's
// \`services/<id>/model.likec4\` EXTENDS this map: it declares no
// \`specification\` block of its own, so it belongs to THIS project and renders
// with it, containers and all. A model that declares its own \`specification\`
// stands alone instead — it renders only from its own directory
// (\`npx likec4 start services/<id>\`), and the \`exclude\` list in the root
// likec4.config.json has to cover that directory or its declarations collide
// with this file's. \`loam subsystem sync\` maintains both, so neither is
// hand-edited. Keep views
// scoped, because computing one is superlinear in the number of edges — the
// \`fleet\` view below stays affordable precisely because it excludes the
// platform hubs.
//
// One shape is worth getting right before the fleet is drawn: a shared broker.
// Kafka as a single element becomes the node every service points at, and any
// view over it is a star nobody can read. Model the TOPIC instead — a \`topic\`
// nested inside the broker's element, edges pointing at \`kafka.<topic>\` — which
// splits one hub of degree sixty into a dozen small ones and is the truer model
// besides. Tag the KIND, not just the broker: LikeC4 does not inherit tags, so a
// topic under an \`#external\` broker is not external itself and \`validate\` asks
// for a services/ directory nobody owes.
//
//   specification {
//     element topic {
//       #external
//       style { shape queue }
//     }
//   }

specification {
  element person
  element softwareSystem
  element container
  element database

  // Ubiquitous infrastructure — logging Kafka, auth, service discovery — takes
  // one inbound edge per service, and by the third service the fleet view is a
  // hairball. Tag those elements #platform: the fleet view excludes them
  // without losing "who depends on the Identity Provider", which the platform
  // view answers.
  tag platform

  // One kind per kind of traffic, each with one direction. The style is the
  // picture: amber for messages, green for data at rest, gray and dashed for
  // a connection nobody has given a direction yet. Never tag a kind: LikeC4
  // copies a kind's tags onto every edge of it.
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
    // A marker at the source: an edge with no arrowhead at either end is laid
    // out unconstrained, and enough of them flatten a view into one band.
    tail odot
  }

  // The technology palette: one colour per technology, the same on every loam
  // map. Red is reserved: a red box is Redis or Oracle and never anything
  // else, LikeC4's own \`red\` included. Tag the element (#redis) and colour
  // it by tag in a style group, after the #external rule, because the later
  // rule wins: \`loam instructions loam-drawing\` has the spelling.
  tag redis
  tag oracle
  tag kafka
  tag elastic
  color redisRed #DC382D
  color oracleRed #8E1B3A
  color kafkaAmber #A35829
  color elasticTeal #00BFB3
}

model {
}

views {
  view fleet {
    include *
    exclude element.tag = #platform
  }
  // The obvious spelling — \`include element.tag = #platform\` — draws the
  // platform boxes with NO edges and no consumers. The predicate that works is
  // the relationship form below.
  view platform {
    include * -> element.tag = #platform
  }
}
`,
];
