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
`;

/**
 * Whether the fleet map is still the scaffold's own bytes — the sentinel
 * doctrine of core/coherence/authoring/sentinels.ts: the writer above and this
 * checker read ONE string, so they cannot drift apart. `endsWith`, not
 * equality, because `migrate-openspec` prepends a `landscapePreamble` to the
 * identical stub; CRLF-normalised because a checkout under core.autocrlf is
 * still untouched. A hand-edit inside the stub body breaks the suffix match —
 * the safe failure mode is a false "authored", which merely drops one teaching
 * step from `loam status`'s empty-fleet ladder (core/status/fleet/next.ts).
 */
export function isLandscapeStub(content: string): boolean {
  const normal = (s: string): string => s.replace(/\r\n/g, "\n").trimEnd();
  return normal(content).endsWith(normal(LANDSCAPE_STUB));
}
