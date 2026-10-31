/**
 * FleetSeed → landscape DSL body: a pure, deterministic function — identical
 * fleet.yaml, identical bytes, on any machine — because the stamp
 * (`./stamp.ts`) digests the output and a nondeterministic templater would
 * read as hand-edited on the next run.
 *
 * The DSL shape is deliberately minimal: one bound `softwareSystem` per
 * service (the `metadata { service '<id>' }` binding is what every loam join
 * reads — element ids are cosmetic), `#external` systems for the externals,
 * and one edge per statement fleet.yaml makes. An edge carries an operationId
 * or a message name ONLY when fleet.yaml states it, copied token for token —
 * a templated guess would be the extractor this command exists not to be —
 * and its kind is the one the statement's section names, so drawing it
 * chooses nothing. All seven kinds are DECLARED, as the scaffold's stub
 * declares them, so whatever draws the next edge can name one.
 */
import type { FleetSeed, JoinKey, SeedEdge } from "./fleet-file.js";

/** Which kind of declared name an element id is being built for. */
type ElementKind = "svc" | "ext";

/**
 * A LikeC4 identifier for a declared name, mechanically: `.` and `-` become
 * `_`, and the result takes its kind's prefix — `svc_` for a service, `ext_`
 * for an external.
 *
 * The prefix is not decoration, and not only about the digit-initial case
 * (LikeC4 identifiers are letter/underscore-initial). LikeC4's KEYWORDS are
 * bare lowercase words — `notes`, `tag`, `view`, `metadata`, `style`, `link`,
 * `import`, `description`, `size`, `line`, `this` and some thirty more — and a
 * service legally named `notes` emitted as a bare `notes = softwareSystem`
 * does not parse. The self-check would catch that, but only to refuse a fleet
 * whose fault it is not, under `internal`, with no fix to offer. No keyword
 * contains `_`, so a prefixed identifier is PROVABLY not one — at this LikeC4
 * version and at every later one. A reserved-word list here would be the same
 * bug again, rotting the first time the language grew a word.
 *
 * The fold is not injective — `a-b` and `a.b` both give `a_b` — so residual
 * collisions take a deterministic numeric suffix in sorted processing order.
 * Aesthetics do not matter here: the binding metadata, not the element id, is
 * the element's identity to loam.
 */
function foldName(name: string, kind: ElementKind): string {
  return `${kind}_${name.replace(/[.-]/g, "_")}`;
}

/**
 * The element id loam SUGGESTS for a service no map draws yet — this seed's
 * own convention, exported so it is the only one. The adopt brief and the
 * `loam new` delta used to camel-case the directory name instead, so a seeded
 * fleet received three spellings of one box (`svc_payment_service` on the
 * map, `paymentService` in every brief and scaffold), and a delta that reused
 * the scaffold's guess never lined up with the map it was told to match. The
 * id stays cosmetic — `metadata { service '<id>' }` is the join — but a
 * suggestion gets pasted, so it has to be one spelling, and the keyword-proof
 * one above is the one already on disk in every seeded repo.
 */
export function serviceElementId(service: string): string {
  return foldName(service, "svc");
}

/** Element ids for every declared name (services ∪ externals), collision-suffixed deterministically. */
function elementIds(seed: FleetSeed): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const named: Array<readonly [string, ElementKind]> = [
    ...[...seed.services]
      .map((s) => s.id as string)
      .sort()
      .map((n) => [n, "svc"] as const),
    ...[...seed.externals].sort().map((n) => [n, "ext"] as const),
  ];
  for (const [name, kind] of named) {
    let candidate = foldName(name, kind);
    for (let n = 2; used.has(candidate); n += 1) candidate = `${foldName(name, kind)}_${n}`;
    used.add(candidate);
    ids.set(name, candidate);
  }
  return ids;
}

/** The kind each join is drawn as; a call with no operation is drawn `calls` as well. */
const KIND_OF: Record<JoinKey, string> = { op: "calls", publishes: "publishes", consumes: "delivers" };

/** The section rank of the total order: calls (named or not) < publishes < consumes. */
const RANK_OF: Record<JoinKey, number> = { op: 0, publishes: 1, consumes: 2 };

/**
 * The total order edges are drawn in: section, then `from`, then `to` (the
 * declared names in codepoint order — the order 0.2.0-alpha.18 drew its bare
 * calls in, which is what keeps a join-free fleet.yaml's edges byte-identical),
 * then the id, a bare call before any id. TOTAL is the point: the stamp digests
 * these bytes, so input order leaking into output order would make an
 * untouched map read as hand-edited after somebody merely reordered
 * fleet.yaml. The old comparator answered "greater" both ways for an identical
 * pair, which was safe only because pairs were deduplicated first; once a pair
 * carries one edge per id, the id has to break the tie. Two edges equal under
 * this order are the same edge, which the reader has already merged.
 */
function edgeOrder(a: SeedEdge, b: SeedEdge): number {
  const rank = (e: SeedEdge): number => (e.join === null ? 0 : RANK_OF[e.join.key]);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  if (a.join === null || b.join === null) return a.join === b.join ? 0 : a.join === null ? -1 : 1;
  if (a.join.id !== b.join.id) return a.join.id < b.join.id ? -1 : 1;
  return 0;
}

/**
 * One edge's DSL. A joined edge is titled with its id (decision D6): parallel
 * arrows between one pair stay legible, and `loam diff` names a victim as
 * `edge a → b ("refundPayment")` rather than an anonymous arrow. One edge per
 * id rather than one edge listing several, because the model reader keeps
 * only the FIRST value of a repeated metadata key (`core/c4/parsed/values.ts`'s
 * `metaKey`) — a second op on one edge would be drawn and never checked. The id
 * is safe inside the quotes because the reader refused every character that
 * could end the string (`./joins.ts`'s `idHazard`).
 */
function edgeLines(e: SeedEdge, el: (name: string) => string): string[] {
  const arrow = `  ${el(e.from)} -[${e.join === null ? "calls" : KIND_OF[e.join.key]}]-> ${el(e.to)}`;
  if (e.join === null) return [arrow];
  return [`${arrow} '${e.join.id}' {`, `    metadata { ${e.join.key} '${e.join.id}' }`, "  }"];
}

/** Render the landscape body (unstamped — `sealLandscape` adds line 1). */
export function renderLandscape(seed: FleetSeed): string {
  const ids = elementIds(seed);
  // Every name reaching `el` was declared (every statement's endpoints are
  // validated against services ∪ externals before rendering), so the fallback
  // is unreachable — it exists so a future caller cannot get a silent
  // `undefined` into the DSL.
  const el = (name: string): string => ids.get(name) ?? foldName(name, "svc");

  const lines: string[] = [
    // ONE header for every seeded file, join-free or not (decision D7). The
    // old one told the reader to hand-write `metadata { op }` on an edge HERE,
    // which — now that fleet.yaml can say it — is advice that locks seed out
    // of its own file for nothing. Each stamp's digest covers its own file's
    // body, header included, so a map sealed under the old header still
    // verifies against itself, and its first re-seed rewrites the comment once.
    "// Generated from fleet.yaml by `loam seed` — edit fleet.yaml and re-run to",
    "// regenerate. Hand edits make this file yours: the stamp on line 1 is how",
    "// seed tells, and it will then refuse to touch the file again.",
    "//",
    "// Name the operation a call uses in fleet.yaml, not here, and seed draws it as",
    "// a join `loam validate --all --spine` checks against the provider's",
    "// openapi.yaml; messages go under fleet.yaml's publishes: and consumes:.",
    "//",
    "//   calls:",
    "//     - checkout-web -> payment-service: authorizePayment",
    "",
    "specification {",
    "  element person",
    "  element softwareSystem",
    "  element container",
    "  element database",
    "",
    "  // #platform keeps ubiquitous infrastructure out of the fleet view;",
    "  // #external marks somebody else's system, so validate does not ask for a",
    "  // services/ directory nobody owes. A tag must be declared before it is",
    "  // used, so both are declared here whether or not this fleet uses them.",
    "  tag platform",
    "  tag external",
    // The relationship kinds are DUPLICATED from core/scaffold/landscape.ts's
    // LANDSCAPE_STUB for the views block's reason below, and test/seed.test.ts
    // compares the two byte for byte the same way. Three of them are used, each
    // because a fleet.yaml section states it: `calls:` is drawn `-[calls]->`,
    // `publishes:` `-[publishes]->` and `consumes:` `-[delivers]->`. Calls were
    // plain edges once, on the reading that fleet.yaml has no spelling for what
    // an edge carries and choosing a kind would be a guess — but the list is
    // named `calls` and each entry is written 'caller -> callee', so the person
    // who wrote it stated the kind, and the plain arrow taught the one spelling
    // `loam instructions loam-feature` tells an agent never to draw (QUICKSTART
    // walk, 2026-10-28). The message sections are named for the same reason.
    // No other kind is ever chosen here. Declaring all seven is what lets the
    // adoptions and feature deltas that follow draw kinded edges into this map,
    // and lets an archive that copies one in still parse.
    "",
    "  // One kind per kind of traffic, each with one direction. The style is the",
    "  // picture: amber for messages, green for data at rest, gray and dashed for",
    "  // a connection nobody has given a direction yet. Never tag a kind: LikeC4",
    "  // copies a kind's tags onto every edge of it.",
    "  relationship publishes {",
    "    color amber",
    "    line solid",
    "    head normal",
    "  }",
    "  relationship delivers {",
    "    color amber",
    "    line solid",
    "    head normal",
    "  }",
    "  relationship reads {",
    "    color green",
    "    head none",
    "    tail normal",
    "  }",
    "  relationship writes {",
    "    color green",
    "    head normal",
    "  }",
    "  relationship readsWrites {",
    "    color green",
    "    head normal",
    "    tail normal",
    "  }",
    "  relationship calls {",
    "    color secondary",
    "    line solid",
    "    head normal",
    "  }",
    "  relationship connects {",
    "    color gray",
    "    line dashed",
    "    head none",
    "    // A marker at the source: an edge with no arrowhead at either end is laid",
    "    // out unconstrained, and enough of them flatten a view into one band.",
    "    tail odot",
    "  }",
    // The palette is DUPLICATED from LANDSCAPE_STUB like the kinds above, and
    // test/seed.test.ts compares it byte for byte the same way.
    "",
    "  // The technology palette: one colour per technology, the same on every loam",
    "  // map. Red is reserved: a red box is Redis or Oracle and never anything",
    "  // else, LikeC4's own `red` included. Tag the element (#redis) and colour",
    "  // it by tag in a style group, after the #external rule, because the later",
    "  // rule wins: `loam instructions loam-drawing` has the spelling.",
    "  tag redis",
    "  tag oracle",
    "  tag kafka",
    "  tag elastic",
    "  color redisRed #DC382D",
    "  color oracleRed #8E1B3A",
    "  color kafkaAmber #A35829",
    "  color elasticTeal #00BFB3",
    "}",
    "",
    "model {",
  ];

  const services = [...seed.services].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const s of services) {
    lines.push(`  ${el(s.id)} = softwareSystem '${s.id}' {`);
    lines.push(`    metadata { service '${s.id}' }`);
    lines.push("  }");
  }
  const externals = [...seed.externals].sort();
  for (const x of externals) {
    lines.push(`  ${el(x)} = softwareSystem '${x}' {`);
    lines.push("    #external");
    lines.push("  }");
  }
  const edges = [...seed.edges].sort(edgeOrder);
  if (edges.length > 0) lines.push("");
  // Drawn with its kind, as `loam instructions loam-feature` tells an agent to
  // draw every edge: the fleet.yaml section a statement sits in states that
  // kind, so this chooses nothing, and a bare `->` on the first map a new user
  // copies from taught the one spelling the protocol forbids.
  for (const e of edges) lines.push(...edgeLines(e, el));
  lines.push("}");

  // The views block below is DUPLICATED from core/docs.ts's LANDSCAPE_STUB
  // (two copies — extract on a third, per the house rule). The tripwire in
  // test/seed.test.ts compares the two blocks BYTE FOR BYTE, comments and
  // wrapping included, so whichever copy drifts fails the suite — a
  // view-names-only compare let a corrected predicate land in one copy and
  // leave every seeded fleet map rendering the old one.
  // The emitted comment speaks to the docs repo's reader, not to loam's:
  // internal paths mean nothing where this file lands.
  lines.push(
    "",
    "// The views are for LikeC4's own tooling — loam reads the model and never",
    "// a view. Render with `npx likec4 start` from the docs repo root. Tag",
    "// ubiquitous infrastructure #platform to keep the fleet view readable.",
    "views {",
    "  view fleet {",
    "    include *",
    "    exclude element.tag = #platform",
    "  }",
    "  // The obvious spelling — `include element.tag = #platform` — draws the",
    "  // platform boxes with NO edges and no consumers. The predicate that works is",
    "  // the relationship form below.",
    "  view platform {",
    "    include * -> element.tag = #platform",
    "  }",
    "}",
  );
  return lines.join("\n") + "\n";
}
