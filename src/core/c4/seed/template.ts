/**
 * FleetSeed → landscape DSL body: a pure, deterministic function — identical
 * fleet.yaml, identical bytes, on any machine — because the stamp
 * (`./stamp.ts`) digests the output and a nondeterministic templater would
 * read as hand-edited on the next run.
 *
 * The DSL shape is deliberately minimal: one bound `softwareSystem` per
 * service (the `metadata { service '<id>' }` binding is what every loam join
 * reads — element ids are cosmetic), `#external` systems for the externals,
 * and PLAIN edges. No operationIds: those arrive with contracts, and a
 * templated guess would be the extractor this command exists not to be.
 */
import type { FleetSeed } from "./fleet-file.js";

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

/** Render the landscape body (unstamped — `sealLandscape` adds line 1). */
export function renderLandscape(seed: FleetSeed): string {
  const ids = elementIds(seed);
  // Every name reaching `el` was declared (calls are validated against
  // services ∪ externals before rendering), so the fallback is unreachable —
  // it exists so a future caller cannot get a silent `undefined` into the DSL.
  const el = (name: string): string => ids.get(name) ?? foldName(name, "svc");

  const lines: string[] = [
    "// Generated from fleet.yaml by `loam seed` — edit fleet.yaml and re-run to",
    "// regenerate. Hand edits make this file yours: the stamp on line 1 is how",
    "// seed tells, and it will then refuse to touch the file again.",
    "//",
    "// As contracts arrive, give each call the operationId it uses, so",
    "// requirements, C4 and OpenAPI can be cross-checked:",
    "//",
    "//   checkout -> paymentService 'Authorizes' {",
    "//     metadata { op 'authorizePayment' }",
    "//   }",
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
  const calls = [...seed.calls].sort((a, b) =>
    a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
  );
  if (calls.length > 0) lines.push("");
  for (const c of calls) lines.push(`  ${el(c.from)} -> ${el(c.to)}`);
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
