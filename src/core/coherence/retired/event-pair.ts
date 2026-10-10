/**
 * One service's pair of event contracts — the feature delta and the living
 * contract — read the one way every slot judgement on the event axis reads
 * them.
 *
 * Two readers build it, and they must never disagree: the feature gate's walk
 * (../events/declared.ts), which grades baselines and markers and collects the
 * revival candidates, and `serviceRevivals` (./revived.ts), which asks the
 * revival question standalone for `loam rebase`. The second used to re-spell
 * the first's guards — existence, decode, an unreadable living side — and its
 * own living-slot map, so a change to the gate's guard would have left rebase
 * and validate giving two answers about one tree with no test comparing them.
 *
 * Here, in retired/, because it is the lowest package both readers import: the
 * event walk already imports this package (for the revival candidates), and a
 * value edge from here up into events/ would be a package cycle.
 */
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { readOr } from "../../openapi/contract-text.js";
import { asyncapiSlots, slotsByKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";

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
}

/** Where the two documents live, and their parses — read by the caller, which needs them before this. */
export interface EventPairSides {
  featPath: string;
  /** Readable: an unreadable feature delta is `asyncapi.invalid`, and nothing is graded against it. */
  featDoc: AsyncapiDoc;
  livingPath: string;
  livingDoc: AsyncapiDoc;
}

/**
 * Read both sides' texts and slots. Each text is parsed ONCE and kept: the
 * slot walk and the surface half of the baseline grade read the same resolved
 * tree, and a second `parse` of the same bytes is a second chance for the two
 * halves to disagree about what the delta declares.
 */
export async function readEventPair(sides: EventPairSides, context?: FleetContext): Promise<EventPairRead> {
  const { featPath, featDoc, livingPath, livingDoc } = sides;
  const featText = await readOr(featPath, context);
  const featPlain: unknown = featText === undefined ? {} : parse(featText);
  const livingExists = existsSync(livingPath);
  const livingText = !livingExists || livingDoc.unreadable ? undefined : await readOr(livingPath, context);
  const livingPlain: unknown = livingText === undefined ? {} : parse(livingText);
  return {
    featDoc,
    featSlots: asyncapiSlots(featPlain),
    featPlain,
    featText,
    livingDoc,
    livingSlots: slotsByKey(asyncapiSlots(livingPlain)),
    livingText,
    livingPlain,
    livingAnswers: livingText !== undefined || !livingExists,
  };
}
