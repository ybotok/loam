/**
 * The `specification { ... }` block, read off LikeC4's parsed model.
 *
 * loam reads a model for what it MEANS, and until LikeC4 1.59.0 the
 * specification carried nothing loam had to mean anything by: it declared which
 * kinds and tags exist, and LikeC4 itself enforced that every use was declared.
 * 1.59.0 added **tags on kinds** — `specification { element softwareSystem {
 * #external } }` — and LikeC4 applies those tags to every element of the kind
 * before loam ever sees it. So `Elem.tags` stopped answering the question loam
 * was actually asking of it.
 *
 * That distinction is what this module exists for. loam does not need the
 * specification to SEE an inherited tag — the tag is already on the element, and
 * `flattenModel` has always copied it faithfully. It needs the specification to
 * tell an inherited tag from one somebody wrote on the element, because loam
 * gives two tags grading meaning (`#external` exempts an element from the
 * landscape↔services reconciliation, `#platform` silences a hub warning) and a
 * kind-wide declaration of either switches that grading off for every element of
 * the kind at once. Six words in the specification block turned a fleet gate
 * green over a fleet it had stopped checking; `kindTagFindings`
 * (commands/validate/fleet/kind-tags.ts) is the check that refuses that, and this
 * is the reader it is built on.
 *
 * Everything here is defensive. The specification is not part of the model API
 * loam's `ReadableModel` slice pins, and 1.59.2 already spells the two kind
 * tables differently — element kinds carry `tags` at the top of the kind record,
 * relationship kinds carry theirs under `style` — which is exactly the kind of
 * internal detail that moves between releases. Both positions are read for both
 * tables, so a shape that swaps degrades to "no kind tags" (the pre-1.59.0
 * answer) rather than throwing inside a validate run.
 */

/** The slice of a LikeC4 `specification { ... }` block loam reads, normalized. */
export interface DocSpecification {
  /** Tag names each ELEMENT kind declares, by kind name. Kinds declaring none are absent. */
  elementKindTags: Record<string, string[]>;
  /**
   * Tag names each RELATIONSHIP kind declares, by kind name.
   *
   * Read and carried even though no check grades relationship tags today: the
   * feature tag on an edge is what `loam archive` splices on, and a kind-wide
   * declaration of one is the same defect on the write path. Dropping the table
   * here would make that a second reader's problem to rediscover.
   */
  relationshipKindTags: Record<string, string[]>;
  /**
   * The sorted union of every `metadata { }` key used anywhere in the document,
   * computed by LikeC4 for free. loam's own binding vocabulary is four keys —
   * `service`, `op`, `publishes`, `consumes` — and a near miss (`ops`,
   * `serviceId`) parses clean, binds nothing, and reports nothing.
   */
  metadataKeys: string[];
}

/** Every string in `v`, or `[]` — `v` is `unknown` off an untyped parse. */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The tags one kind record declares. 1.59.2 puts an element kind's under `tags`
 * and a relationship kind's under `style.tags`; both are read for both, because
 * which one a given kind table uses is LikeC4's internal business and a check
 * that silently stopped seeing tags would fail OPEN — the exact failure this
 * module was added to close.
 */
function kindTags(kind: unknown): string[] {
  if (!kind || typeof kind !== "object") return [];
  const rec = kind as Record<string, unknown>;
  const style = rec["style"];
  const nested = style && typeof style === "object" ? (style as Record<string, unknown>)["tags"] : undefined;
  return [...new Set([...stringList(rec["tags"]), ...stringList(nested)])];
}

/** `{ kind: [tag, ...] }` for every kind in one of the specification's kind tables. */
function tagTable(table: unknown): Record<string, string[]> {
  if (!table || typeof table !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [name, kind] of Object.entries(table as Record<string, unknown>)) {
    const tags = kindTags(kind);
    if (tags.length > 0) out[name] = tags;
  }
  return out;
}

/**
 * Normalize the `specification` LikeC4 hangs off its parsed model. Takes the
 * whole untyped value so every shape assumption lives in this file: callers get
 * `DocSpecification` or nothing, and never touch `unknown`.
 */
export function readSpecification(spec: unknown): DocSpecification | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const rec = spec as Record<string, unknown>;
  return {
    elementKindTags: tagTable(rec["elements"]),
    relationshipKindTags: tagTable(rec["relationships"]),
    metadataKeys: stringList(rec["metadataKeys"]),
  };
}
