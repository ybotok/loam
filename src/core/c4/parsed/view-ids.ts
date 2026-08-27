/**
 * The ids of every view a document AUTHORS — the census read, as distinct from
 * `./dynamic-views.ts`'s use-case read.
 *
 * Two readers over one record, because docs/DESIGN.md rule 26 states two
 * filters and they are not interchangeable. A use-case reader wants dynamic
 * views and filters on `_type === "dynamic"`. A census must see authored
 * ELEMENT views too — a `view fleet { include * }` claims an id exactly as
 * firmly as a dynamic one does — so it filters on `sourcePath !== undefined`
 * instead. Measured: the `index` view LikeC4 synthesizes into every document is
 * `_type: "element"` AND carries no `sourcePath`, so each filter drops it, and a
 * reader that learned only the other one would report a fiction.
 *
 * Kept as its own module rather than a second export beside the use-case reader:
 * the two share nothing but the reach into `$data`, and a defensive adapter is
 * safer when each one owns its shape assumptions outright — the same reason
 * `./specification.ts` states.
 *
 * Ids only. What the view SHOWS stays unread, in any document, forever.
 */

/**
 * The shape LikeC4 mints for a view its author never named — `view of svc { }`
 * becomes `view_1yu7e9n`.
 *
 * Excluded from the census, and this is a correctness rule rather than
 * tidiness: such an id is not a claim anybody wrote, and MEASURED at the
 * 1.59.2 pin it is not even stable across loam's own two loaders — the same
 * document yields `view_1yu7e9n` through `loadFile` and `view_zmkx82` through
 * `loadBatch`, because the mint hashes the document URI and the batch stages
 * into a temp workspace. Reporting it would put a value in `LoadedDoc` that
 * depends on which loader ran, which is the one thing
 * test/fleet-context-parity.test.ts exists to forbid; it also cannot collide
 * with anything loam generates, since every generated id loam mints carries a
 * prefix of its own.
 *
 * The cost is exact and small: an author who literally writes
 * `view view_abc { }` loses that id from the census. It is a name nobody
 * chooses, and no check reads the census for anything but collisions against
 * loam's own generated prefixes, which this shape can never match.
 */
const MINTED_ID = /^view_[0-9a-z]+$/;

/** A record, or nothing — `v` is `unknown` off an untyped parse. */
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Every view id the document declares, in the record's own order.
 *
 * `model` is the AWAITED `parsedModel()` result; `$data` is undefined on the
 * unresolved promise, so a caller that forgets the await gets an empty census
 * rather than a throw. Empty is also what a malformed record yields — this runs
 * inside `validate --all` over every C4 document a fleet has, and the one
 * behaviour it may never have is failing the run it was added to.
 */
export function readViewIds(model: unknown): string[] {
  const views = record(record(record(model)?.["$data"])?.["views"]);
  if (!views) return [];
  const out: string[] = [];
  for (const raw of Object.values(views)) {
    const rec = record(raw);
    // Authored, which is what `sourcePath` means here. The synthesized entry
    // has none, and reporting a collision against a view nobody wrote would be
    // a false error on every fleet in existence.
    if (!rec || typeof rec["sourcePath"] !== "string") continue;
    const id = rec["id"];
    if (typeof id === "string" && id.length > 0 && !MINTED_ID.test(id)) out.push(id);
  }
  return out;
}
