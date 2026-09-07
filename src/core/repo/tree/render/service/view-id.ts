/**
 * The identifier loam mints for a per-service overview view, and the ONE
 * encoder every generated view id is spelled through.
 *
 * The encoder lives HERE, in the child package, rather than beside the
 * subsystem render that has used it since it was written — and the direction is
 * forced rather than chosen. `../views.ts` imports this package to compose the
 * per-service file, so an import the other way would be the package cycle
 * `scripts/package-graph.mjs` refuses; that script's own advice for exactly this
 * shape is "move the helper; do not import the weight", and an id encoder is the
 * leaf while the two renders are the weight. One copy is also the point: the
 * injectivity argument below holds across BOTH prefixes only while they share an
 * encoder, and a second spelling would be a second chance to collide.
 *
 * INJECTIVITY is a correctness rule and not tidiness. The renderer refuses the
 * whole `architecture/` project over a duplicate view id, and the naive folding
 * (every non-identifier byte and the join separator alike becoming `_`) collided
 * three DISTINCT healthy names onto one identifier — `a_b`, and `b` under `a`,
 * both rendering `subsystem_a_b` — so `validate --all` was green while the
 * renderer refused the fleet map, and `subsystem.name-collision` never fired
 * because the flat namespace really was intact.
 *
 * Hence the encoding: an identifier byte (`[A-Za-z0-9]`) passes through, any
 * other byte becomes `_` + two lowercase hex digits (`.` → `_2e`, `-` → `_2d`,
 * `_` itself → `_5f` — the underscore must be escaped precisely because it is
 * BOTH legal in a name and the separator between path segments). Underscore runs
 * then decode uniquely — one is an escape, two a separator, three a separator
 * followed by an escape — so no two distinct legal names share an identifier. A
 * name `subsystem.name-invalid` already flagged may hold a code point above 0xff
 * whose longer hex could in principle re-collide; it is deterministic still, and
 * that directory is already an error finding by name.
 *
 * The prefix is EXPORTED, with the minting function, because the collision check
 * (`subsystem.view-id-collision`) has to ask the generator what it mints rather
 * than re-derive it. A check carrying its own copy of the escaping goes quiet the
 * day the encoding changes, and going quiet is the failure that whole family
 * exists to prevent.
 */

/**
 * The reserved prefix for a generated per-service overview. Distinct from
 * `subsystem_` so the two generated files can never mint the same id for
 * different subjects, and it cannot match the shape LikeC4 mints for an unnamed
 * view (`^view_[0-9a-z]+$`, `core/c4/parsed/view-ids.ts`), so a generated id is
 * never mistaken for a synthesized one.
 */
export const SERVICE_VIEW_PREFIX = "service_";

/** One name, folded to identifier bytes injectively — the banner argues why this shape. */
export function escapeViewIdSegment(name: string): string {
  return [...name]
    .map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16).padStart(2, "0")}`))
    .join("");
}

/**
 * The view id for one service, from its `services/<id>/` DIRECTORY name.
 *
 * The directory id rather than the map element's title or its fqn, for the same
 * reason the title uses it: it is the name every loam command already addresses
 * the service by, a directory name cannot hold a `/` or a `.`, and it cannot
 * drift when somebody renames a box on the map. Two services cannot share a
 * directory id — the walk's flat namespace already refuses that as
 * `subsystem.name-collision` — so injectivity of the encoder is injectivity of
 * the whole id.
 */
export function serviceViewId(id: string): string {
  return `${SERVICE_VIEW_PREFIX}${escapeViewIdSegment(id)}`;
}
