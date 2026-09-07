/**
 * What one subsystem's generated view SHOWS: which boxes it draws around the
 * services beneath a directory, and the one thing it may say about the map.
 *
 * Split from `../views.ts` when that file crossed the 400-line limit: the file
 * render (header, view ids, staleness comparison) and the body render (the
 * boxes) are two subjects, and the seam is exactly where the second one
 * consults the LANDSCAPE. Everything here reads element ids and nothing else —
 * no view is ever parsed (docs/DESIGN.md rule 26), and the generated file
 * stays a pure function of the tree plus the committed map.
 */
import { type Elem } from "../../../c4/likec4.js";
import { serviceResolver } from "../../../c4/resolve/service.js";
import { servicesUnder, withinSubsystem } from "../find.js";
import type { FleetTree, SubsystemEntry, WalkedService } from "../walk.js";
import { subsystemLabel } from "./text.js";

/**
 * Everything a view's body needs from the landscape, resolved ONCE: the
 * element standing for each service, every element id the map declares, and
 * whether an element is a service's own box. A record rather than four
 * threaded parameters because the body render recurses down the subsystem
 * subtree and would otherwise sit on the parameter limit at every hop
 * (`docs/CODE-STYLE.md`'s own prescription).
 */
export interface RenderContext {
  tree: FleetTree;
  elementOf: Map<string, string>;
  elementIds: ReadonlySet<string>;
  isServiceElement: (id: string) => boolean;
}

export function renderContext(tree: FleetTree, elements: Elem[]): RenderContext {
  const known: ReadonlySet<string> = new Set(tree.services.map((s) => s.id));
  const resolve = serviceResolver(elements, known);
  return {
    tree,
    elementOf: elementByService(tree, elements, resolve),
    elementIds: new Set(elements.map((e) => e.id)),
    isServiceElement: (id: string): boolean => known.has(resolve(id)),
  };
}

/** A view's body lines, the one comment the render may write above it, and its subject. */
export interface ViewBody {
  lines: string[];
  disclosure: string | null;
  /**
   * The element this view is declared `of`, or null when the map holds none
   * that owns exactly this subsystem. It is computed here rather than by the
   * file render because `owningAncestor` below already decides it — the same
   * answer decides which of the three body shapes applies, and two callers
   * deriving it separately could draw the boundary of one element while
   * declaring the view of another.
   */
  of: string | null;
}

/**
 * Three shapes, and which one applies is a fact about the landscape rather
 * than a setting:
 *
 *  1. **The model draws this group.** Some ancestor element holds exactly this
 *     subsystem's members and nothing else, so the view includes it beside the
 *     leaves and the renderer nests them inside the box the AUTHOR drew, with
 *     the author's own title. Measured: including the ancestor alone renders
 *     one empty box and the leaves alone render flat — both lines are needed.
 *  2. **The model is flat.** No member element is nested at all, so there is
 *     no authored box to agree with, and the view wraps the members in a
 *     `group '<title>'` of its own — a real named box in the renderer, derived
 *     from the DIRECTORY the services already sit in, mirroring the subtree so
 *     a parent subsystem shows its children as boxes rather than as one pile.
 *     Nothing is invented: the grouping is the tree, and the tree is what this
 *     file has always mirrored.
 *  3. **The model nests them, differently.** The members ARE nested but no
 *     ancestor owns exactly them — the directory tree and the map disagree
 *     about this group. loam draws no box (a synthetic one would silently
 *     replace the author's boundary with the folder's, and the picture would
 *     look the same whether or not the two agree) and writes ONE comment line
 *     saying so, outside the view body. That comment is the whole of loam's
 *     answer to the drift: it grades nothing, it fails nothing, and it appears
 *     in the diff of the very commit that caused it — placement stays a fact
 *     nothing branches on.
 */
export function viewBody(ctx: RenderContext, sub: SubsystemEntry): ViewBody {
  const members = memberElements(ctx, sub);
  if (members.length === 0) return { lines: [], disclosure: null, of: null };
  if (members.every((id) => !id.includes("."))) {
    return { lines: [...groupedBody(ctx, sub, "    "), ...boundaryLines(members)], disclosure: null, of: null };
  }
  const includes = [...ownedAncestors(ctx, sub), ...members].map((id) => `    include ${id}`);
  const lines = [...includes, ...boundaryLines(members)];
  const owner = owningAncestor(ctx, sub);
  if (owner !== null) return { lines, disclosure: null, of: owner };
  const shared = sharedAncestor(ctx, members);
  return {
    lines,
    of: null,
    disclosure:
      shared === null
        ? "model: no boundary — these members do not share a containing element."
        : `model: no boundary — ${shared} also holds services outside this subsystem.`,
  };
}

/**
 * What this group TOUCHES: for each member, every edge it has in either
 * direction, so the view answers "what does payments talk to" and not only
 * "who is in payments".
 *
 * **The measured trap, and it is why these lines are appended by the caller of
 * `groupedBody` rather than inside it:** placed INSIDE the `group { }` block of
 * the flat-map body shape, this exact predicate parses and validates with ZERO
 * errors and draws a false picture. Measured at likec4 1.59.2 on a flat map of
 * `alpha, beta` grouped and `outsider, store` outside it: at view level the two
 * neighbours are drawn with no parent, correctly outside the box; moved inside
 * the `group { }`, both are drawn as CHILDREN of that group — the diagram then
 * claims `outsider` and `store` are part of the subsystem. A maintainer tidying
 * the body by moving these lines next to the includes they refer to would ship
 * that, and nothing anywhere would report it. They belong at view level, always.
 *
 * The WILDCARD is correct here, and that is not an inconsistency with the
 * per-service views, which measure it as a defect (`./service/peers.ts`): at
 * subsystem altitude a counterpart collapsing to its own group box is exactly
 * the sentence "payments touches identity", and — once those group boxes are
 * themselves views' subjects (`of <ancestor>`) — it is a click-through into
 * that subsystem. At service altitude the same collapse is a lie about who
 * calls whom.
 *
 * MEMBERS only, never `ownedAncestors`: `-> *` on an authored container pulls
 * in every edge any descendant of it has, and in the `// model: no boundary`
 * shape that container also holds services outside this subsystem — the view
 * would draw traffic that is nobody-here's. Measured at 58 services in 11
 * groups: 13-15 nodes and 31-39 edges per subsystem view, of which 11-12 nodes
 * carry drill-down — the members into their own service views, the neighbouring
 * group boxes into THEIR subsystem views.
 */
function boundaryLines(members: readonly string[]): string[] {
  return ["", ...members.map((id) => `    include ${id} -> *, * -> ${id}`)];
}

/**
 * The flat-model body: this subsystem as a box, its child subsystems as boxes
 * inside it, its own services as leaves. Recursive, and the recursion is the
 * point — a parent subsystem's view is otherwise one undifferentiated pile of
 * every service beneath it.
 *
 * An empty child renders an empty named box, which is what the tree says: the
 * group exists and holds nothing yet.
 */
function groupedBody(ctx: RenderContext, sub: SubsystemEntry, indent: string): string[] {
  const inner = `${indent}  `;
  const out = [`${indent}group '${subsystemLabel(sub)}' {`];
  for (const child of childSubsystems(ctx, sub)) out.push(...groupedBody(ctx, child, inner));
  for (const id of directMemberElements(ctx, sub)) out.push(`${inner}include ${id}`);
  out.push(`${indent}}`);
  return out;
}

/** The child subsystems one level down, ordered by name. */
function childSubsystems(ctx: RenderContext, sub: SubsystemEntry): SubsystemEntry[] {
  return ctx.tree.subsystems
    .filter((c) => c.path.length === sub.path.length + 1 && withinSubsystem(sub.path, c.path))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The drawn elements of the services filed in THIS directory, not in a child. */
function directMemberElements(ctx: RenderContext, sub: SubsystemEntry): string[] {
  return drawnElements(
    ctx,
    membersOf(ctx.tree, sub).filter((s) => s.subsystem.length === sub.path.length),
  );
}

/** The drawn elements of every service beneath this subsystem, ordered by service id. */
function memberElements(ctx: RenderContext, sub: SubsystemEntry): string[] {
  return drawnElements(ctx, membersOf(ctx.tree, sub));
}

/**
 * The element ids these services resolve to. A service the map does not draw
 * is omitted rather than invented: the omission is already an error
 * (`landscape.service-unmodelled`), and rendering only what the committed
 * documents resolve keeps the output a function of committed bytes alone.
 */
function drawnElements(ctx: RenderContext, services: WalkedService[]): string[] {
  return services.map((s) => ctx.elementOf.get(s.id)).filter((id): id is string => id !== undefined);
}

/**
 * The boxes a nested-model view draws: this subsystem's own owning ancestor
 * when it has one, plus the owning ancestor of every subsystem beneath it — so
 * a parent view keeps its children's boundaries instead of flattening them
 * into one box. Sorted and de-duplicated, because two subsystems resolve to
 * one element only in a tree that already reports a collision.
 */
function ownedAncestors(ctx: RenderContext, sub: SubsystemEntry): string[] {
  const found = new Set<string>();
  for (const candidate of ctx.tree.subsystems) {
    if (!withinSubsystem(sub.path, candidate.path)) continue;
    const owner = owningAncestor(ctx, candidate);
    if (owner !== null) found.add(owner);
  }
  return [...found].sort();
}

/**
 * The deepest ancestor element that holds exactly this subsystem's members —
 * or null when no element does.
 *
 * "Exactly" is the whole guard, and dropping it was measured on loam's own
 * `examples/docs`: the members' longest common ancestor there is a group of
 * five services while the subsystem holds two, so an unguarded include would
 * generate a box labelled for the group with two of its five children drawn
 * inside it — a diagram asserting something false, in a file the reader is
 * told not to edit. Tightness is judged over ELEMENTS rather than over
 * documented services: mid-adoption a group commonly holds systems no
 * `services/<id>/` exists for yet, and counting only the documented ones would
 * draw that same false box for the whole of an adoption.
 *
 * An ancestor that is itself a service's element is refused separately: one
 * service's box containing another's is a picture of nothing.
 */
function owningAncestor(ctx: RenderContext, sub: SubsystemEntry): string | null {
  const members = memberElements(ctx, sub);
  if (members.length === 0) return null;
  const owned = new Set(members);
  for (const candidate of ancestorChain(members)) {
    if (!ctx.elementIds.has(candidate) || ctx.isServiceElement(candidate)) continue;
    if (ownsExactly(ctx, candidate, owned)) return candidate;
  }
  return null;
}

/** The deepest common ancestor the map declares at all — the disclosure's subject. */
function sharedAncestor(ctx: RenderContext, members: string[]): string | null {
  return ancestorChain(members).find((id) => ctx.elementIds.has(id)) ?? null;
}

/** The common proper ancestors of every member id, deepest first. */
function ancestorChain(members: string[]): string[] {
  const segments = members.map((id) => id.split("."));
  let common = Math.min(...segments.map((s) => s.length - 1));
  for (let i = 0; i < common; i++) {
    if (!segments.every((s) => s[i] === segments[0]![i])) {
      common = i;
      break;
    }
  }
  const out: string[] = [];
  for (let depth = common; depth > 0; depth--) out.push(segments[0]!.slice(0, depth).join("."));
  return out;
}

/**
 * Does every element beneath `ancestor` belong to this subsystem — as a
 * member, as one of a member's own containers, or as a container of one?
 */
function ownsExactly(ctx: RenderContext, ancestor: string, members: ReadonlySet<string>): boolean {
  const prefix = `${ancestor}.`;
  for (const id of ctx.elementIds) {
    if (!id.startsWith(prefix)) continue;
    const claimed = [...members].some((m) => id === m || id.startsWith(`${m}.`) || m.startsWith(`${id}.`));
    if (!claimed) return false;
  }
  return true;
}

/**
 * The landscape element standing for each service id: for every element,
 * resolve it through the shared join, and let the SHALLOWEST element win
 * (document order breaking ties). Shallowest, because `serviceResolver`
 * resolves a service's own containers to the service too, and a view should
 * include the service-level box, not whichever nested container happened to be
 * declared first.
 */
function elementByService(
  tree: FleetTree,
  elements: Elem[],
  resolve: (id: string) => string,
): Map<string, string> {
  const known: ReadonlySet<string> = new Set(tree.services.map((s) => s.id));
  const depth = (id: string): number => id.split(".").length;
  const out = new Map<string, string>();
  for (const e of elements) {
    const service = resolve(e.id);
    if (!known.has(service)) continue;
    const held = out.get(service);
    if (held === undefined || depth(e.id) < depth(held)) out.set(service, e.id);
  }
  return out;
}

/** Services beneath this subsystem at any depth, ordered by id — the transitive membership. */
function membersOf(tree: FleetTree, sub: SubsystemEntry): WalkedService[] {
  return [...servicesUnder(tree, sub)].sort((a, b) => (a.id < b.id ? -1 : 1));
}
