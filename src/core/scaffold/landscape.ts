/**
 * The bytes a brand-new docs repo's fleet map starts with, and the one
 * question anybody asks of them afterwards: has a human touched this yet?
 *
 * Split out of `../docs.ts` when the README joined the scaffold and the file
 * reached its line limit, and the seam was already there: `docs.ts` says what
 * a docs repo is MADE OF — which directories, which files, in what order —
 * while this package holds the CONTENT of the authored templates it lays down.
 * The two change for different reasons: a new artifact edits the first, better
 * advice to a new fleet edits the second.
 */

/**
 * The fleet map, empty but valid.
 *
 * Nobody writes this file automatically — `adopt` deliberately does not touch
 * it, because who calls whom is a human judgement and a generated landscape
 * would be a guess presented as the map. But "nobody writes it" used to mean
 * "it is simply absent", and an absent landscape is the one artifact whose
 * absence silences the fleet-wide checks entirely: every cross-service breach
 * `validate` exists to find is invisible on a repo with no landscape.
 *
 * So the scaffold lays down the empty map instead: the four element kinds a
 * fleet actually uses are declared, the model is empty, and the comments say
 * what to add and why. The first `loam adopt` then has somewhere to be drawn.
 *
 * A `views` block IS scaffolded — reversing the decision this comment used to
 * record, which was: no views, because computing one is superlinear in edge
 * count and a scaffolded `include *` handed every repo a fleet-sized bill for
 * the first tool that renders. That cost was real and still is; what changed
 * is the shape of the block. A fleet map stops being readable at the third
 * service unless platform infrastructure is split out, and the split's
 * `exclude element.tag = #platform` is exactly the
 * pruning that keeps the fleet view's render affordable — the scaffold now
 * pays the old objection instead of ignoring it. loam itself still reads
 * elements and relationships and never a view. The platform view's predicate
 * is scaffolded because it is the line users mistype: the obvious spelling
 * draws boxes with no edges.
 * The `views` block below has a deliberate second copy: `core/c4/seed/template.ts` emits the
 * same two views into a seeded landscape (two strikes; extract on a third), and test/seed.test.ts
 * compares the two blocks byte for byte — comments included — so whichever copy drifts fails.
 */
export const LANDSCAPE_STUB = `// The fleet map: every service in services/ appears here, and every call
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
`;

/**
 * Stubs earlier versions of loam wrote, FROZEN — never re-derived from the
 * constant above, or an edit to it would silently rewrite history.
 *
 * `isLandscapeStub` is a suffix match on the exact bytes, and `loam seed`
 * refuses (`seed-landscape-edited`) on a map it judges authored. So editing
 * the stub reclassifies every untouched older scaffold as hand-edited, in
 * repositories nobody has touched — the teaching step disappears from `loam
 * status` and `seed` refuses a map its own scaffold wrote. Each entry is one
 * shipped generation of the file, OLDEST FIRST, appended when the text above
 * changes — every generation loam ever wrote is here, not just the previous
 * one, since a repository scaffolded two releases ago is as untouched as one
 * scaffolded yesterday.
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
];

/**
 * The one thing loam itself ever writes ABOVE the stub: `core/docs.ts`'s
 * `landscapePreamble`, spliced in as `${preamble.trimEnd()}\n//\n` — comment
 * lines, closed by a bare `//` that separates the caller's sentence from the
 * scaffold's own opening paragraph. `migrate-openspec` is the only caller.
 *
 * Matched as a SHAPE rather than as the migrator's exact sentence because the
 * preamble is a parameter, and because the alternative is a second copy of that
 * sentence in a package `core/scaffold/` must not import from
 * (`commands/migrate-openspec/materialize/target.ts`). The shape is tight where
 * it has to be: the closing bare `//` is what a hand-written note above the map
 * does not have.
 */
const LOAM_PREAMBLE = /^(?:\/\/[^\n]*\n)*\/\/\n$/;

/**
 * Whether the fleet map is still a scaffold's own bytes — the sentinel
 * doctrine of core/coherence/authoring/sentinels.ts: the writer above and this
 * checker read ONE string, so they cannot drift apart. CRLF-normalised because
 * a checkout under core.autocrlf is still untouched. Every generation loam ever
 * wrote counts, not just the current one — see `LEGACY_LANDSCAPE_STUBS`. A
 * hand-edit inside the stub body breaks the match — the safe failure mode is a
 * false "authored", which merely drops one teaching step from `loam status`'s
 * empty-fleet ladder (core/status/fleet/next.ts).
 *
 * ANCHORED AT BOTH ENDS, past a preamble loam wrote itself. This was a bare
 * `endsWith`, so anything a person put ABOVE the stub was invisible to the
 * guard: `loam seed` overwrote a two-line "OWNED BY THE ARCHITECTURE GUILD — do
 * not regenerate" header while printing "replaced the scaffold's untouched
 * stub", against its own promise that "Seed never overwrites human work"
 * (`commands/seed/commit.ts`; verification 2026-09-04, second pass). The suffix
 * match existed for the migration preamble alone, so that is now the only
 * prefix accepted, and everything else above the stub makes the file authored.
 */
export function isLandscapeStub(content: string): boolean {
  const normal = (s: string): string => s.replace(/\r\n/g, "\n").trimEnd();
  const seen = normal(content);
  return [LANDSCAPE_STUB, ...LEGACY_LANDSCAPE_STUBS].some((stub) => {
    const body = normal(stub);
    if (!seen.endsWith(body)) return false;
    const prefix = seen.slice(0, seen.length - body.length);
    return prefix === "" || LOAM_PREAMBLE.test(prefix);
  });
}
