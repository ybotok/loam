/**
 * The corners of LikeC4's parse output that are typed `unknown`, decoded.
 *
 * LikeC4 models `metadata { ... }` values and a `description` as open shapes —
 * a value may be a string, an array, or a rich-text object, and the declared
 * type says none of that. Every one of those crossings needs a defensive read
 * that answers "not present" rather than throwing, and each read encodes a
 * defect somebody hit. They live together here, one module below the adapter
 * (`../likec4.ts`) that calls them, because the adapter is at its line limit and
 * because "decode a value LikeC4 left untyped" is a subject of its own: the
 * specification reader beside this file is the same subject on a different
 * corner of the same object. The ORDER relationships come back in is one more
 * such corner — LikeC4 promises none, and the one it happens to give changes
 * between runs — so `compareRels` lives here too.
 */

/**
 * Read one string key out of a LikeC4 `metadata { ... }` block. Four keys carry
 * loam's spines: `op` on a relationship (the OpenAPI operationId it calls),
 * `publishes`/`consumes` on a relationship (the AsyncAPI message it produces or
 * receives), and `service` on an element (the services/<id> directory it stands
 * for). Every one of them is read by BOTH model readers — the parsed one
 * (`flattenModel` in `../likec4.ts`, which calls this) and the text scanner
 * `scanModel` uses for archive's splice map — because a key only one of them
 * sees is a key the merge silently drops. Elements with no metadata come back as
 * `{}`, so a missing key is indistinguishable from a missing block — both mean
 * "not bound".
 */
export function metaKey(m: unknown, key: string): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
    // A key written TWICE in one block comes back as an array, accepted with no
    // error, and reading only the string form dropped every value — so an edge
    // naming two operations reported as naming none, `c4.op-link-missing` telling
    // the author the opposite of what they wrote. First wins, matching the text
    // scanner's `keyedLiteral`: the two readers disagreeing about a binding is
    // exactly what the paragraph above exists to prevent. Later values stay
    // dropped — one id per key per edge is the model.
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return undefined;
}

/** LikeC4 descriptions can be a string or a rich-text object ({ txt } / { text } / { md }). */
export function descText(d: unknown): string | undefined {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    for (const key of ["txt", "text", "md", "value"]) {
      const v = o[key];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

/**
 * The fields of a relationship its order is decided on — `Rel` in
 * `../likec4.ts`, stated structurally because that module imports this one and
 * a type imported back would close a cycle.
 */
export interface RelKeys {
  readonly source: string;
  readonly target: string;
  readonly title?: string;
  readonly op?: string;
  readonly publishes?: string;
  readonly consumes?: string;
  readonly tags: readonly string[];
}

/**
 * The ONE order every loader hands relationships back in: by source, then
 * target, title, `op`, `publishes`, `consumes` and tags — plain code-unit
 * compares, so the order is a function of the documents' text alone and never
 * of the locale, the machine or the run. Two edges equal on every key are equal
 * in every field `Rel` (`../likec4.ts`) carries, so which of them comes first
 * cannot be seen. `flattenModel` there sorts with it; it lives here, beside the
 * other reads of LikeC4's parse output that cannot be taken at face value,
 * because the adapter is at its line limit.
 *
 * LikeC4 does not give one, for two measured reasons (1.59.2). Its parsed
 * model indexes relations in a plain object keyed by an id HASHED FROM THE
 * DOCUMENT'S URI — and every loader stages documents under a fresh
 * crypto-random folder per invocation (`../workspace.ts` says why), so the ids
 * change on every run. A JavaScript object enumerates integer-like keys
 * numerically ahead of every other key, so whenever a hash comes out all
 * digits (about one hash in 2,200) that edge jumps to the front of the list,
 * on that run only. And inside a project of several documents the base order
 * is whichever file Langium's concurrent folder walk finished reading first.
 * The first reason is what failed a scheduled CI run on 2026-09-28:
 * `loadProjectBatch` and `loadProject` returned one service's two edges in
 * opposite orders on an unchanged commit — and on a fleet map of a few hundred
 * edges it would reorder some run's findings far more often than that.
 *
 * Declaration order is therefore NOT what a reader gets, and nothing may read
 * meaning into the position of an edge: what the `Rel` list promises is the
 * same order for the same documents, which is what the text report and the
 * `--json` envelope being diffed between runs and machines needs.
 */
export function compareRels(a: RelKeys, b: RelKeys): number {
  // An absent field sorts ahead of every present one, the empty string
  // included, so "no title" and "an empty title" cannot tie. Tags are LikeC4
  // identifiers, which cannot contain the comma that joins them.
  const opt = (value: string | undefined): string => (value === undefined ? "" : `=${value}`);
  const keys = (r: RelKeys): string[] => [
    r.source,
    r.target,
    opt(r.title),
    opt(r.op),
    opt(r.publishes),
    opt(r.consumes),
    r.tags.join(","),
  ];
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
  }
  return 0;
}
