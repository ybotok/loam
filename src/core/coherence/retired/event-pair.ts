/**
 * One service's pair of event contracts — the feature delta and the living
 * contract — read the one way every slot judgement on the event axis reads
 * them.
 *
 * Two readers build it, and they must never disagree: the feature gate's walk
 * (../events/declared.ts), which grades baselines and markers and collects the
 * revival candidates, and `serviceRevivals` (./revival/revived.ts), which asks the
 * revival question standalone for `loam rebase`. The second used to re-spell
 * the first's guards — existence, decode, an unreadable living side — and its
 * own living-slot map, so a change to the gate's guard would have left rebase
 * and validate giving two answers about one tree with no test comparing them.
 *
 * Here, in retired/, because it is the lowest package both readers import: the
 * event walk already imports this package (for the revival candidates), and a
 * value edge from here up into events/ would be a package cycle. The merge
 * simulation (./merged.ts) is here for the same reason, and rides on the pair
 * as `merged()`: the walk grades the post-archive contract with it, and the
 * revival check compares it with the living contract — one simulation per
 * pair, whichever asks first.
 */
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { readOr } from "../../openapi/contract-text.js";
import { asyncapiSlots, slotsByKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import { mergedAsyncapiDoc, type MergedEvents } from "./merged.js";

/** The four facts every slot judgement reads: each side as the reader parsed it, and as its slots. */
export interface EventPair {
  featDoc: AsyncapiDoc;
  featSlots: AsyncapiSlot[];
  livingDoc: AsyncapiDoc;
  /** The living contract's slots by `slotKey`; empty where it is absent or did not read. */
  livingSlots: Map<string, AsyncapiSlot>;
}

/** The pair, plus the texts and trees the gate's other graders read from the same bytes. */
export interface EventPairRead extends EventPair {
  /** The feature delta's resolved parse — `{}` when its text did not decode. */
  featPlain: unknown;
  featText: string | undefined;
  /** The living contract's text — undefined when it is ABSENT or did not read; `livingAnswers` tells the two apart. */
  livingText: string | undefined;
  /** The living contract's resolved parse; `{}` where there is no living text. */
  livingPlain: unknown;
  /**
   * Can anything be graded against the living side? Absent is a real answer —
   * everything the delta spells is new, and a baseline only means something
   * for a slot that already exists. Unreadable is NOT an answer: grading pins,
   * markers or revivals against an empty parse would call every restatement
   * new and every marker stale, so each of those checks stands down and the
   * (later) merge refuses the unreadable side by name.
   */
  livingAnswers: boolean;
  /**
   * The living contract as the archive would leave it (./merged.ts), computed
   * on first ask and kept — the create branch's document where no living
   * contract exists; undefined where the living side does not answer, or the
   * merge refuses the pair. The walk asks it only with a living text in hand.
   * Its tree rides along for the one reader that follows a `$ref` back.
   */
  merged(): MergedEvents | undefined;
}

/**
 * Where one service's two contracts of one axis live, and their parses — read
 * by the caller, which needs them before this. The OpenAPI revival read
 * (./revival/arrivals.ts) takes the same shape.
 */
export interface PairSides<Doc = AsyncapiDoc> {
  featPath: string;
  /** Readable: an unreadable feature delta is `asyncapi.invalid` (`openapi.invalid`), and nothing is graded against it. */
  featDoc: Doc;
  livingPath: string;
  livingDoc: Doc;
  /** The service the pair belongs to — what a refusal of the simulated merge would name. */
  service: string;
  /**
   * The delta's text when the caller holds a version of it that is not on
   * disk yet — `loam rebase`'s, with the pins it is about to write; read from
   * `featPath` when absent. The merge's quote/edit verdict turns on the pins,
   * so the revival question asked of the delta as it stood before a repin can
   * answer for a document rebase is about to replace: a quote pinned to its
   * own content is skipped, and repinned over another operation it is an edit
   * that lands. A pin changes no identity or address, so `featDoc`, read from
   * disk, still names what the text declares.
   */
  featText?: string;
}

/**
 * Read both sides' texts and slots. Each text is parsed ONCE and kept: the
 * slot walk and the surface half of the baseline grade read the same resolved
 * tree, and a second `parse` of the same bytes is a second chance for the two
 * halves to disagree about what the delta declares.
 */
export async function readEventPair(sides: PairSides, context?: FleetContext): Promise<EventPairRead> {
  const { featPath, featDoc, livingPath, livingDoc, service } = sides;
  const featText = sides.featText ?? (await readOr(featPath, context));
  const featPlain: unknown = featText === undefined ? {} : parse(featText);
  const livingExists = existsSync(livingPath);
  const livingText = !livingExists || livingDoc.unreadable ? undefined : await readOr(livingPath, context);
  const livingPlain: unknown = livingText === undefined ? {} : parse(livingText);
  const livingAnswers = livingText !== undefined || !livingExists;
  // Lazy: most pairs never need it on the rebase path, and the walk asks for
  // it once. Boxed, so an `undefined` answer is remembered too.
  let simulated: { merged: MergedEvents | undefined } | undefined;
  const merged = (): MergedEvents | undefined =>
    (simulated ??= {
      merged: !livingAnswers || featText === undefined
        ? undefined
        : mergedAsyncapiDoc({ livingText, livingDoc, livingRoot: livingPlain, featureText: featText, service }),
    }).merged;
  return {
    featDoc,
    featSlots: asyncapiSlots(featPlain),
    featPlain,
    featText,
    livingDoc,
    livingSlots: slotsByKey(asyncapiSlots(livingPlain)),
    livingText,
    livingPlain,
    livingAnswers,
    merged,
  };
}
