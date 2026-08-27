/**
 * The `dynamic view`s a document DECLARES, read off LikeC4's parsed model.
 *
 * This is the only module in loam permitted to touch `$data`, and
 * `scripts/arch-check.mjs` enforces that rather than trusting it (docs/DESIGN.md
 * rule 26). The confinement is the point: `$data` is public and typed but thinly
 * documented for this use, so an upstream shape change has a blast radius of one
 * file, and `test/likec4-view-shape.test.ts` is the tripwire that fires before
 * the change reaches a check.
 *
 * It takes the WHOLE model as `unknown` rather than a `$data` slice handed in by
 * its caller, and that is not squeamishness — naming `$data` in `../likec4.ts`
 * would violate the containment scan this module exists behind. Callers pass the
 * model; every assumption about LikeC4's record shape lives here.
 *
 * Everything is defensive, in the same posture as `./specification.ts`: a shape
 * this reader cannot make sense of degrades to ZERO views, never to a wrong one
 * and never to a throw inside a validate run. That asymmetry is deliberate and
 * is loam's standing rule for a suspended axis — a check with no views to grade
 * reports could-not-look, while a check fed a half-read view would report
 * nothing-wrong about a flow it never saw.
 */
import { descText } from "./values.js";

/** One hop of a declared use case: an ordered edge between two elements. */
export interface ParsedStep {
  /**
   * 1-based pre-order position among the view's LEAF steps — what lets a finding
   * say "step 4 of Checkout". Group wrappers do not consume an ordinal: a
   * `loop` is a bracket around hops, not a hop, and counting it would shift
   * every number after it away from what the author sees on the diagram.
   */
  ordinal: number;
  /**
   * The step's endpoints, ALREADY ORIENTED — see `isBackward`. Dotted FQN
   * strings naming elements, never relationship ids: a step says who talks to
   * whom, and which relationship backs that is a join loam performs later.
   */
  source: string;
  target: string;
  /** The step's label, absent when the author wrote none. */
  title?: string;
  /** A `notes '...'` block on the step, decoded from LikeC4's rich-text shape. */
  notes?: string;
  /**
   * True when the author wrote the hop as a reply — `a <- b` rather than
   * `b -> a`. LOAD-BEARING, and measured: LikeC4 records `a <- b 'reply'` as
   * `{source: b, target: a, isBackward: true}` — already reversed AND flagged —
   * while a forward step carries no such key at all. `source`/`target` above are
   * therefore correct as they stand and need no flipping; the flag is carried so
   * a check can tell a return hop from a call, and so a message naming the
   * failing step can suggest the `<-` spelling to an author who wrote the arrow
   * the long way round.
   */
  isBackward: boolean;
  /**
   * LikeC4's own path to the step inside the view (`/steps@1/steps@0`), carried
   * verbatim. It is the only stable handle on a nested step — two hops between
   * the same pair inside different `loop` blocks are otherwise indistinguishable
   * — and it is message text, never identity: nothing joins on it.
   *
   * OPTIONAL, and that is a deliberate refusal to make it load-bearing. Every
   * leaf carries one at the 1.59.2 pin, so requiring it would look free — and
   * would mean that an upstream release which stopped emitting it turned every
   * use case in the fleet into a view with zero steps. That is the silent wrong
   * answer this module exists to avoid: a hop loam cannot cite is still a hop it
   * must grade.
   */
  astPath?: string;
}

/** One declared `dynamic view`, flattened to what rule 26 permits reading. */
export interface ParsedView {
  id: string;
  /**
   * The view's declared tags, `[]` when it declares none. Normalized here
   * because LikeC4 reads an untagged view's tags as `null`, and a caller
   * testing `.length` on that would throw inside a validate run.
   *
   * Tags live on the VIEW and nowhere else: a step cannot carry tags, and
   * `metadata` on a step is a hard parse error. That is measured, and it is why
   * a use case is opted in as a whole rather than hop by hop.
   */
  tags: string[];
  title?: string;
  description?: string;
  /** The declared hops, in author order, groups flattened away. */
  steps: ParsedStep[];
}

/** A record, or nothing — `v` is `unknown` off an untyped parse. */
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** The value at `key`, when it is a non-empty string. */
function str(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Every leaf step under `entries`, depth-first in author order.
 *
 * Steps NEST: a `loop 'until accepted' { ... }` arrives as an entry with
 * `_type: "loop"`, a title, its own `steps[]`, and NO endpoints and NO `astPath`
 * of its own (measured). A walk that treated every entry as a hop would read the
 * bracket as a step and then fail to find a relationship backing it — inventing
 * a finding out of a grouping the author drew for legibility.
 *
 * The test is structural rather than a list of group keywords (`loop`, `par`,
 * ...): an entry with a nested `steps` array is a group whatever LikeC4 calls
 * it, and an entry with two string endpoints is a hop. A future group kind
 * therefore flattens correctly on the day it ships instead of on the day
 * somebody notices.
 */
function leaves(entries: unknown, out: Record<string, unknown>[]): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const rec = record(entry);
    if (!rec) continue;
    if (Array.isArray(rec["steps"])) {
      leaves(rec["steps"], out);
      continue;
    }
    if (typeof rec["source"] === "string" && typeof rec["target"] === "string") out.push(rec);
  }
}

/** One leaf entry as a `ParsedStep`. Every leaf yields one; nothing is dropped. */
function step(rec: Record<string, unknown>, ordinal: number): ParsedStep {
  const astPath = str(rec, "astPath");
  const title = str(rec, "title");
  const notes = descText(rec["notes"]);
  return {
    ordinal,
    source: rec["source"] as string,
    target: rec["target"] as string,
    ...(title === undefined ? {} : { title }),
    ...(notes === undefined ? {} : { notes }),
    // Present-and-true is the only truthy form LikeC4 emits; absent means
    // forward. Read as a boolean rather than carried as `true | undefined` so a
    // caller cannot accidentally test `=== false` against a key that is never
    // written.
    isBackward: rec["isBackward"] === true,
    ...(astPath === undefined ? {} : { astPath }),
  };
}

/**
 * The dynamic views one parsed document declares, in the record's own order.
 *
 * `model` is the awaited `parsedModel()` result. The `await` matters and is the
 * mistake every draft of this made: `$data` is `undefined` on the unresolved
 * promise, so a reader handed the promise reports a document with views as
 * having none — a silent zero, which is the one wrong answer this module is
 * written to avoid.
 *
 * Two entries are dropped on the way out, for different reasons:
 *
 *  - Anything whose `_type` is not `"dynamic"`. LikeC4 synthesises an `index`
 *    view into EVERY document, including one with no `views` block at all
 *    (measured), so reporting element views would be reporting a fiction the
 *    author never wrote. A census that must see authored element views wants the
 *    other filter rule 26 states — `sourcePath !== undefined` — and must not
 *    reuse this function to get it.
 *  - Anything with no `id`. There is nothing to name in a finding, and a view
 *    loam cannot name is a view it cannot ask anybody to fix.
 */
export function readDynamicViews(model: unknown): ParsedView[] {
  const data = record(record(model)?.["$data"]);
  const views = record(data?.["views"]);
  if (!views) return [];

  const out: ParsedView[] = [];
  for (const raw of Object.values(views)) {
    const rec = record(raw);
    if (!rec || rec["_type"] !== "dynamic") continue;
    const id = str(rec, "id");
    if (id === undefined) continue;

    const found: Record<string, unknown>[] = [];
    leaves(rec["steps"], found);
    const steps = found.map((leaf, i) => step(leaf, i + 1));

    const title = str(rec, "title");
    const description = descText(rec["description"]);
    out.push({
      id,
      tags: Array.isArray(rec["tags"]) ? rec["tags"].filter((t): t is string => typeof t === "string") : [],
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      steps,
    });
  }
  return out;
}
