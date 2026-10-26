/**
 * Every fleet map an earlier loam scaffolded, frozen, so `isLandscapeStub` in
 * ./landscape.ts can still tell an untouched old scaffold from a hand-drawn map.
 *
 * Moved out of ./landscape.ts when that file neared its line limit, along the
 * seam the two halves already had: ./landscape.ts holds the stub loam writes
 * NOW and the predicate that reads it, this module holds what loam wrote
 * before. The first changes whenever the advice to a new fleet improves; this
 * one only ever grows by one entry, when that happens — today in
 * ./legacy-kinded.ts, which holds the generations that declare relationship
 * kinds and which this list ends with.
 */

import { KINDED_LANDSCAPE_STUBS } from "./legacy-kinded.js";

/**
 * Stubs earlier versions of loam wrote, FROZEN — never re-derived from
 * `LANDSCAPE_STUB` in ./landscape.ts, or an edit to it would silently rewrite
 * history.
 *
 * `isLandscapeStub` is a suffix match on the exact bytes, and `loam seed`
 * refuses (`seed-landscape-edited`) on a map it judges authored. So editing
 * the stub reclassifies every untouched older scaffold as hand-edited, in
 * repositories nobody has touched — the teaching step disappears from `loam
 * status` and `seed` refuses a map its own scaffold wrote. Each entry is one
 * shipped generation of the file, OLDEST FIRST, appended when
 * `LANDSCAPE_STUB`'s text changes — every generation loam ever wrote is here,
 * not just the previous one, since a repository scaffolded two releases ago is
 * as untouched as one scaffolded yesterday.
 *
 * Generation 1 (v0.1.0-beta.1, .2): the stub lived in core/docs.ts, carried no
 * `views` block at all ("on purpose: loam reads the model and never a view")
 * and no `tag platform`.
 * Generation 2 (v0.1.0-beta.3): the same file with the render paragraph
 * rewritten — still no `views` block, still no `tag platform`.
 * Generation 3 (v0.2.0-alpha.1 through .5): the `views` paragraph taught the
 * retired shape — that a service model "renders from its OWN directory" and
 * "each declares its own `specification` block" — which was written before an
 * extending model belonged to the root project.
 * Generation 4 (v0.2.0-alpha.6 through .11): the extending shape's render
 * paragraph and the shared-broker advice, with no relationship kinds — every
 * edge a plain `->`, which is how a fleet drawn from deployment configuration
 * ended with every arrow pointing into its broker and its stores.
 * Generation 5 onward declare the seven relationship kinds and live in
 * ./legacy-kinded.ts, appended at the end of this list: one more whole stub
 * here would have taken this file past its line limit.
 */
export const LEGACY_LANDSCAPE_STUBS: readonly string[] = [
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
//   checkoutWeb -> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
//
// There is no \`views\` block, on purpose: loam reads the model and never a
// view, so it would draw nothing. Add views here if you want diagrams, and
// render them with LikeC4's own tooling (\`npx likec4 start\`) — but scope them,
// because computing a view is superlinear in the number of edges and an
// \`include *\` over a whole fleet takes minutes.

specification {
  element person
  element softwareSystem
  element container
  element database
}

model {
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
//   checkoutWeb -> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
//
// There is no \`views\` block, on purpose: loam reads the model and never a
// view, so it would draw nothing. Add views here if you want diagrams, and
// render them with LikeC4's own tooling — \`npx likec4 start\` from the docs
// repo root, which likec4.config.json scopes to this directory. (A service
// model or a feature delta renders from its OWN directory, e.g.
// \`npx likec4 start services/<id>\`: each declares its own \`specification\`
// block, so the renderer can only be given one of them at a time.) Scope your
// views, because computing one is superlinear in the number of edges and an
// \`include *\` over a whole fleet takes minutes.

specification {
  element person
  element softwareSystem
  element container
  element database
}

model {
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
//   checkoutWeb -> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
//
// The \`views\` block at the bottom is for LikeC4's own tooling — loam reads
// the model and never a view. Render with \`npx likec4 start\` from the docs
// repo root, which likec4.config.json scopes to this directory. (A service
// model or a feature delta renders from its OWN directory, e.g.
// \`npx likec4 start services/<id>\`: each declares its own \`specification\`
// block, so the renderer can only be given one of them at a time.) Keep views
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
//   checkoutWeb -> paymentService 'Authorizes' {
//     metadata { op 'authorizePayment' }
//   }
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
  ...KINDED_LANDSCAPE_STUBS,
];
