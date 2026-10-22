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

import { LEGACY_LANDSCAPE_STUBS } from "./legacy.js";

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
 *
 * The seven RELATIONSHIP kinds are scaffolded for the element kinds' reason:
 * they are vocabulary, not a guess about this fleet. Declared here, every
 * extending model and every adoption borrows them, so the first edge anybody
 * draws can say what it carries and which way it points. A real fleet drawn
 * without them ended with every arrow pointing into its broker and its stores,
 * because deployment configuration says only that two things are connected. A
 * declaration here also keeps a feature archivable: the archive copies a
 * delta's edge into this file and never a declaration, so a kind this file
 * lacks refuses the merge (`merge-failed`). A `legend` view is NOT scaffolded:
 * a view names only elements the model declares, this model is empty, and an
 * invented example would be a box every fleet check grades. The comment says
 * when to write one. The kinds block has the same deliberate second copy in
 * `core/c4/seed/template.ts`, pinned the same way by test/seed.test.ts.
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
`;

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
