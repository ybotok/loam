/**
 * The GENERATED platform views — `architecture/platform.likec4`, the two
 * altitudes above a subsystem. For each root (`./scope.ts`):
 *
 *  - `view platform_<root>_context`: the root as ONE box, and every person and
 *    system an edge joins to it. LikeC4 lifts each service's edge to the box on
 *    its own, so nothing is drawn twice.
 *  - `view platform_<root> of <root>`: the root's boxes — its subsystem groups
 *    and the services filed directly in it — and the people who reach them.
 *    `of` is the one keyword the other generated views spend too: LikeC4
 *    computes `navigateTo` into this view on the root's box in every other view
 *    that draws it, the context view included (measured), so the reader clicks
 *    from the context into the inside, and from a box into its own view.
 *
 * Both leave infrastructure out, and the inside view therefore needs the async
 * edges `./coupling.ts` derives. They are the FIRST MODEL CONTENT loam
 * generates — every other generated document holds views only — and this file
 * draws the line for them: they live in this document alone; loam's own reads
 * never load it (`GENERATED_ARCHITECTURE_FILES`, `core/repo/paths.ts`), so no
 * check grades an edge loam wrote and only the renderer sees them; they join
 * two subsystem groups and never a service or any other box (`./coupling.ts`
 * has the measurement); and each is titled `async: …` so a reader can tell it from an
 * edge somebody drew. Measured at the 1.59.2 pin: such an edge, in its own
 * document with no kind or tag declared, parses, shows on the inside view and
 * stays inside the box on the context view.
 *
 * NO LINE STYLE, by measurement rather than taste. LikeC4 draws every
 * relationship between the same two boxes of a view as ONE edge, titled
 * `[...]`, and a `style { line dotted }` on the derived one restyled that
 * merged edge dotted whichever document loaded first — so a synchronous call
 * beside an event would have been drawn as an event. The title is the marker.
 *
 * Leaf of the render package, like `../service/`: it may not import `../text.ts`
 * or `../body.ts` (the edge runs the other way, `../views.ts` composes), so the
 * two escapers arrive as functions and the element→service join as the set of
 * ids it bound.
 */
import type { Elem, Rel } from "../../../../c4/likec4.js";
import { GENERATED_MARK } from "../service/header.js";
import { escapeViewIdSegment } from "../service/view-id.js";
import { type CoupledPair, coupling } from "./coupling.js";
import { platformScopes, type PlatformScope } from "./scope.js";

/** Everything the render reads, resolved by the composer in `../views.ts`. */
export interface PlatformViewsInput {
  elements: readonly Elem[];
  relationships: readonly Rel[];
  /** The element ids the element→service join bound — what "holds a service" means. */
  services: ReadonlySet<string>;
  /** The elements a generated subsystem view is drawn `of` — never a root (`./scope.ts`). */
  subsystems: ReadonlySet<string>;
  /** Somebody's words as the body of a LikeC4 string (`likec4String`). */
  quote: (text: string) => string;
  /** Somebody's words as one segment of a view title (`titleSegment`). */
  segment: (text: string) => string;
}

/** The bytes, or null when the file must be absent — and the roots they were drawn for. */
export interface PlatformRender {
  content: string | null;
  roots: string[];
}

/**
 * The prefix every platform view id begins with, and the minting of both ids.
 * Exported because `subsystem.view-id-collision` has to ask the generator what
 * it mints rather than re-deriving it, as it does for the other two files.
 * The escape is `../service/view-id.ts`'s: it hex-escapes `_`, so no escaped
 * root id can end in `_context`, and the two ids of one root never collide with
 * the ids of another.
 */
export const PLATFORM_VIEW_PREFIX = "platform_";

export function platformViewId(root: string): string {
  return `${PLATFORM_VIEW_PREFIX}${escapeViewIdSegment(root)}`;
}

export function platformContextViewId(root: string): string {
  return `${platformViewId(root)}_context`;
}

const HEADER =
  `${GENERATED_MARK} — the platform above its subsystems: a context view and an inside view per root.\n` +
  "// Do not edit: `loam views` regenerates this file from the fleet map,\n" +
  "// and `loam validate --all` reports `subsystem.views-stale` when it drifts.\n" +
  "// The edges titled `async:` are events, derived from the spine's keys and topics; nothing in loam reads them back.\n" +
  "// An event drawn only as edges to a broker, with no message key and no topic, is not derived.\n";

/** How many names an edge title spells before it counts the rest — a label is read on the diagram. */
const NAMES_SHOWN = 3;

export function renderPlatformViews(input: PlatformViewsInput): PlatformRender {
  const scopes = platformScopes(input.elements, input.relationships, input.services, input.subsystems);
  if (scopes.length === 0) return { content: null, roots: [] };
  const lines: string[] = [HEADER];
  const coupled = scopes.map((scope) => ({ scope, derived: coupling(scope, input.elements, input.relationships) }));
  if (coupled.some(({ derived }) => derived.pairs.length > 0)) {
    lines.push("model {");
    for (const { scope, derived } of coupled) {
      if (derived.pairs.length === 0) continue;
      lines.push(`  // ${scope.root.id}`);
      for (const pair of derived.pairs) lines.push(edgeLine(pair, input.quote));
    }
    lines.push("}", "");
  }
  lines.push("views {");
  for (const [i, { scope, derived }] of coupled.entries()) {
    if (i > 0) lines.push("");
    lines.push(`  // ${scope.root.id}`);
    if (derived.outsideGroups > 0) lines.push(`  // ${outsideGroupsDisclosure(derived.outsideGroups)}`);
    lines.push(...contextView(scope, input.segment), "", ...insideView(scope, input.segment));
  }
  lines.push("}");
  return { content: lines.join("\n") + "\n", roots: scopes.map((s) => s.root.id) };
}

function edgeLine(pair: CoupledPair, quote: (text: string) => string): string {
  const shown = pair.names.slice(0, NAMES_SHOWN).join(", ");
  const rest = pair.names.length - NAMES_SHOWN;
  return `  ${pair.source} -> ${pair.target} '${quote(`async: ${shown}${rest > 0 ? ` +${rest}` : ""}`)}'`;
}

/**
 * The one sentence a root is owed when an event joins a box that is not a
 * subsystem group — a service filed directly in it, an external system, a
 * person: no edge is derived there, and the reader is told why rather than left
 * to wonder at a box the inside view shows unconnected.
 */
function outsideGroupsDisclosure(count: number): string {
  return (
    `${count} event pair(s) end at a box of this root that is not a subsystem group, and no edge is derived ` +
    "for them: a relationship is drawn in every view naming both its ends, so it would surface in every " +
    "per-service and hand-drawn view of those boxes."
  );
}

/**
 * The context view. Metadata before every `include`, as in the other generated
 * files: measured, a `title` after an `include` is a parse error, and one parse
 * error in this file blanks the whole `architecture/` project in the renderer.
 */
function contextView(scope: PlatformScope, segment: (text: string) => string): string[] {
  return [
    `  view ${platformContextViewId(scope.root.id)} {`,
    `    title '${label(scope, segment)} — context'`,
    "    description 'The platform as one box, and every person and system an edge joins to it. Stores, caches and topics are left out.'",
    `    include ${scope.root.id}`,
    ...scope.peers.map((peer) => `    include ${peer}`),
    "  }",
  ];
}

function insideView(scope: PlatformScope, segment: (text: string) => string): string[] {
  return [
    `  view ${platformViewId(scope.root.id)} of ${scope.root.id} {`,
    `    title '${label(scope, segment)} — inside'`,
    "    description 'The subsystems of the platform and the people who reach them. Edges titled async are events, derived from the spine.'",
    ...scope.boxes.map((box) => `    include ${box}`),
    ...scope.actors.map((actor) => `    include ${actor}`),
    "  }",
  ];
}

/** The root's title as one title segment, or its id when the map gave it none. */
function label(scope: PlatformScope, segment: (text: string) => string): string {
  const title = segment(scope.root.title);
  return title === "" ? segment(scope.root.id) : title;
}
