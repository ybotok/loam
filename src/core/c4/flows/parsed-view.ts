/**
 * What a LikeC4 dynamic view IS at the parsed stage, declared by loam.
 *
 * A file of its own beside `./flatten.ts` rather than above it, because the two
 * are different phases and only one of them changes when the dependency does:
 * this is a claim about likec4 1.59.2's parse output, and the walk next door is
 * loam's reading of it. `../likec4.ts` keeps its `ReadableModel` beside its
 * flatten because the pair fits in one file; this pair does not.
 *
 * Structural and loam's own, for the same reason `ReadableModel` is: a
 * hand-written interface over the fields actually read means the compiler
 * checks the shape where the two loaders cast, and a dependency that renames a
 * field breaks the build instead of quietly reading `undefined`. Importing
 * LikeC4's own view types would additionally pull `@likec4/core` — a transitive
 * package, not one of loam's three declared dependencies — into the product's
 * import graph.
 *
 * EVERY FIELD BELOW IS REQUIRED, and that is what makes the paragraph above
 * true rather than merely intended. A type assertion silently accepts a source
 * that LACKS an optional property, so `views?:` would have compiled clean
 * through the rename it exists to catch — and then `views ?? {}` would answer
 * "no dynamic views" for every document in the fleet, which is the fail-open
 * inversion of the whole design. Upstream declares `views` on
 * `ParsedLikeC4ModelData`, and `title` and `steps` on the parsed view, so the
 * required form is not a wish: it is what the dependency already promises.
 */

/** The slice of a parsed LikeC4 model loam reads for flows: the declared views. */
export interface ReadableViews {
  $data: { views: Record<string, ParsedView> };
}

/**
 * One declared view. `_type` is the discriminator, and the two arms spell
 * LikeC4's whole `ViewType` — only 'dynamic' is a flow, and only it is read
 * past the discriminator, so an element view claiming `steps` it does not have
 * is not representable.
 */
export type ParsedView = ParsedDynamicView | ParsedStaticView;

interface ParsedDynamicView {
  _type: "dynamic";
  title: string | null;
  /** Optional upstream too (`WithOptionalTags`): an untagged view omits the key. */
  tags?: readonly string[] | null;
  steps: readonly ParsedNode[];
}

interface ParsedStaticView {
  _type: "element" | "deployment";
}

/**
 * A step, or one of the blocks LikeC4 nests around steps. A plain step is the
 * member carrying NO `_type`, which is what discriminates the union.
 *
 * `series` is LikeC4's parse of the chain form `a -> b -> c` and holds plain
 * steps only; the flatten inlines it (see `FlowNode`).
 */
export type ParsedNode = ParsedStep | ParsedSeries | ParsedBlock | ParsedAlt | ParsedTry;

/**
 * One interaction as authored. There is deliberately no `metadata` field to
 * read: the parsed step has none, which is why `./resolve.ts` exists.
 */
export interface ParsedStep {
  source: string;
  target: string;
  title?: string | null;
}

interface ParsedSeries {
  _type: "series";
  steps: readonly ParsedStep[];
}

interface ParsedBlock {
  _type: "par" | "opt" | "loop" | "break";
  title?: string | null;
  steps: readonly ParsedNode[];
}

export interface ParsedAlt {
  _type: "alt";
  title?: string | null;
  branches: readonly ParsedBranch[];
}

export interface ParsedBranch {
  _type: "when" | "if" | "else";
  title?: string | null;
  steps: readonly ParsedNode[];
}

export interface ParsedTry {
  _type: "try";
  try: ParsedSection;
  catch?: ParsedSection;
  finally?: ParsedSection;
}

export interface ParsedSection {
  title?: string | null;
  steps: readonly ParsedNode[];
}
