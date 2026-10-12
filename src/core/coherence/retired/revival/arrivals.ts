/**
 * The revival candidates: every identity — an operationId, or a message
 * name — that the contract the archive would WRITE answers at an address
 * the living contract does not. Split from ./revived.ts, which grades them,
 * along the seam between the two questions: what the merge would leave, and
 * which of it an archived feature took out.
 *
 * The question is asked of the contract the archive would WRITE: the
 * archive's own merge runs over the two texts (../merged.ts), and where the
 * result answers each operationId and message name is compared with where
 * the living contract answers it now. This once re-derived the merge from
 * the delta, case by case — any removal marker naming the id excused a quote,
 * another NAMED operation at the id's address made a swap — and every review
 * found a shape the derivation got wrong: a marker at an address the id never
 * lived at (it deletes nothing, so the second address stays), a replacement
 * with no operationId (it replaces all the same, so there is no second
 * address), a retirement whose address became a second one when a later
 * feature re-added the id elsewhere. The merged contract answers each of
 * them by construction.
 *
 * The same comparison read the other way round answers the removal gate's
 * blind spot: a living operationId the merged contract answers nowhere,
 * with no marker naming it, was taken out by an overwrite (`Displacement`).
 */
import { existsSync } from "node:fs";
import type { OpenapiDoc, Operation } from "../../../openapi/doc.js";
import { readOr } from "../../../openapi/contract-text.js";
import { slotKey, type AsyncapiSlot } from "../../../asyncapi/digest.js";
import type { EventMessage } from "../../../asyncapi/model.js";
import type { FleetContext } from "../../../fleet-context.js";
import { operationAddress } from "../archived.js";
import type { EventPairRead, PairSides } from "../event-pair.js";
import { mergedOpenapiDoc } from "../merged.js";

/**
 * One identity — an operationId, or a message name — that the merged
 * contract answers at an address the living contract does not. The only
 * shape a revival can take: everything else the merge writes is already
 * living where it stands.
 */
export interface Arrival {
  id: string;
  /** The new address: `METHOD /path`, or the slot a message is declared in. */
  at: string;
  /** Where the living contract answers the identity now — empty for nowhere. */
  livesAt: string[];
  /** Every OTHER address the merged contract answers it at. */
  besides: string[];
  /**
   * What the living contract answers at `at` now — another operationId, or
   * another message name — which the merge replaces there: a slot holds one
   * entry. Absent where nothing does. A finding that called such an address
   * one "the living contract no longer has" sent its reader to a remedy that
   * deleted the other entry with nothing naming it.
   */
  replaces?: string;
  /**
   * Can this same delta take it out of every one of `besides`? A living
   * address the delta spells nothing at takes a removal marker; a declaration
   * inline under a channel is taken out by restating or retiring the channel
   * (`moveBackRemedy`). A key the delta already spells holds what it spells,
   * and a marker cannot be written beside it — the remedy that once named
   * one there could not be followed.
   */
  markable: boolean;
}

/**
 * A living operationId the merged contract answers NOWHERE although no
 * removal marker in the delta names it: another operation now stands at
 * every address it held, so the merge — which writes per method and path —
 * replaced it there. The removal gate's own question
 * (`openapi.remove-op-consumed`, ../../coherence.ts) asked of the one way to
 * take an operation out of a contract that carries no marker for it to read:
 * a delta defining
 * `fetchOrder` where `getOrder` lives archived at exit 0 while a landscape
 * edge still called `getOrder`, and the next `validate` reported the
 * contract broken (`spine.op-undefined`) on a repository nobody in the
 * feature touched. Read off the merged contract, never re-derived from the
 * delta, for this module's reason.
 */
export interface Displacement {
  /** The living operationId the contract the archive would write no longer defines. */
  id: string;
  /**
   * Every address it lives at now, with what the merged contract answers
   * there — the operationId that replaces it, or nothing for an operation
   * written without one, which the reader cannot name.
   */
  at: ReadonlyArray<{ address: string; by?: string }>;
}

/** What the merged contract answers that the living one does not, and what it stops answering. */
export interface OperationArrivals {
  /** Every (operationId, address) the merged contract has and the living one lacks — the revival candidates. */
  operations: Arrival[];
  /** Every living operationId the merged contract answers nowhere, no removal marker naming it. */
  displaced: Displacement[];
}

/** An identity and one address a contract answers it at. */
type Placed = readonly [id: string, at: string];

const opsPlaced = (ops: readonly Operation[]): Placed[] => ops.filter((op) => !op.remove).map((op) => [op.id, operationAddress(op)]);
const messagesPlaced = (all: readonly EventMessage[]): Placed[] => all.filter((m) => m.remove !== true).map((m) => [m.name, m.slot]);

/** Every (identity, address) the merged contract has and the living one lacks, in the merged contract's order. */
function arrivals(
  living: readonly Placed[],
  merged: readonly Placed[],
  markable: (address: string, livesAt: readonly string[]) => boolean,
): Arrival[] {
  const where = (all: readonly Placed[], id: string): string[] => all.filter(([i]) => i === id).map(([, at]) => at);
  return merged.flatMap(([id, at]) => {
    const livesAt = where(living, id);
    if (livesAt.includes(at)) return [];
    const besides = where(merged, id).filter((b) => b !== at);
    const replaces = living.find(([, address]) => address === at)?.[0];
    return [{ id, at, livesAt, besides, markable: besides.every((b) => markable(b, livesAt)), ...(replaces === undefined ? {} : { replaces }) }];
  });
}

/**
 * The OpenAPI candidates: the merged contract against the living one. An
 * unreadable side proves nothing (`openapi.invalid` owns it), nor does a text
 * that does not decode, so either yields none; neither does a merge the
 * archive refuses (`merge-failed`, which `--approve` cannot pass). The merge
 * runs only when some definition in the delta is not living at its own
 * address already: nothing else the merge writes can be new, so a delta that
 * only restates what stands has nothing to compare and never pays for it.
 * The displacements ride the same run, and the same trigger is enough for
 * them: a named operation replacing a living one at its address is itself
 * a definition not living there.
 */
export async function operationArrivals(sides: PairSides<OpenapiDoc>, context?: FleetContext): Promise<OperationArrivals> {
  const none: OperationArrivals = { operations: [], displaced: [] };
  const { featPath, featDoc, livingPath, livingDoc, service } = sides;
  if (featDoc.unreadable || livingDoc.unreadable) return none;
  const living = opsPlaced(livingDoc.ops);
  if (arrivals(living, opsPlaced(featDoc.ops), () => true).length === 0) return none;
  const featureText = sides.featText ?? (await readOr(featPath, context));
  const livingExists = existsSync(livingPath);
  const livingText = livingExists ? await readOr(livingPath, context) : undefined;
  if (featureText === undefined || (livingExists && livingText === undefined)) return none;
  const merged = mergedOpenapiDoc({ livingText, livingDoc, featureText, service });
  if (merged === undefined) return none;
  const spelled = new Set([...featDoc.ops, ...featDoc.anonymousRemovals].map(operationAddress));
  const placed = opsPlaced(merged.ops);
  return {
    operations: arrivals(living, placed, (b, livesAt) => livesAt.includes(b) && !spelled.has(b)),
    displaced: displacements(living, placed, new Set(featDoc.ops.filter((op) => op.remove).map((op) => op.id))),
  };
}

/**
 * The living identities the merged contract answers nowhere, minus every one
 * a removal marker names: those are the removal gate's already — retired,
 * relocated, or a marker the exactness checks refuse — and grading them here
 * too would file one loss under two findings.
 */
function displacements(living: readonly Placed[], merged: readonly Placed[], marked: ReadonlySet<string>): Displacement[] {
  const answered = new Set(merged.map(([id]) => id));
  const gone = [...new Set(living.map(([id]) => id))].filter((id) => !answered.has(id) && !marked.has(id));
  return gone.map((id) => ({
    id,
    at: living.filter(([i]) => i === id).map(([, address]) => {
      const by = merged.find(([, at]) => at === address)?.[0];
      return by === undefined ? { address } : { address, by };
    }),
  }));
}

/** What an event delta brings that the living contract does not have. */
export interface EventArrivals {
  /** `channels` and `operations` slots whose key the living contract lacks — their identity IS the key. */
  slots: AsyncapiSlot[];
  /** Message names at slots the living contract does not declare them in — the operation axis's arrivals. */
  messages: Arrival[];
  /**
   * The merged contract's tree, where the move-back remedy follows a `$ref`
   * back to the channel holding it (`moveBackRemedy`) — absent where the
   * merge refused, and then no message is graded.
   */
  mergedRoot?: unknown;
}

/**
 * The event axis's candidates. A message is graded by its NAME, not by its
 * key: the name is what every join reads, so a retired message redeclared
 * under a new key is the same message back, and a new message reusing a dead
 * key is not. A living side that does not answer (./event-pair.ts) proves
 * nothing, so it yields none; a merge the pair refuses grades no message.
 * The slots are read off the delta, and they are the merged contract's new
 * slots exactly: the merge writes every slot the delta declares, bar a quote,
 * which has a living counterpart.
 */
export function eventArrivals(read: EventPairRead): EventArrivals {
  const { featDoc, featSlots, livingDoc, livingSlots } = read;
  if (!read.livingAnswers || featDoc.unreadable || livingDoc.unreadable) return { slots: [], messages: [] };
  const slots = featSlots.filter((s) => !s.remove && s.section !== "components.messages" && !livingSlots.has(slotKey(s)));
  const merged = read.merged();
  if (merged === undefined) return { slots, messages: [] };
  const spelled = new Set(featSlots.filter((s) => s.section === "components.messages").map((s) => `${s.section}.${s.key}`));
  const markable = (b: string, livesAt: readonly string[]): boolean =>
    b.startsWith("channels.") || (livesAt.includes(b) && !spelled.has(b));
  return { slots, messages: arrivals(messagesPlaced(livingDoc.messages), messagesPlaced(merged.doc.messages), markable), mergedRoot: merged.root };
}
