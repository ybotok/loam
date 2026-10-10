/**
 * The revival findings: a feature delta that would bring back what an
 * ARCHIVED feature took out of the living contract — an operation, slot or
 * message it retired, or an address it moved one away from, which would put
 * it back there beside where it lives now.
 *
 * `openapi.op-revived` and `asyncapi.slot-revived` — one code per axis, because
 * a caller acts the same way whichever slot section came back. Both are a
 * warning that GATES archive, `openapi.baseline-missing`'s doctrine: the
 * document is legal, and re-adding a retired operation can be exactly what a
 * feature means (a rollback of a retirement, a deprecation reversed), so
 * `--approve` carries the call. What it must never be again is SILENT — the
 * merge cannot tell a quote of a dead operation from an addition, and treated
 * every one as an addition.
 *
 * The question is asked of the contract the archive would WRITE: the
 * archive's own merge runs over the two texts (./merged.ts), and where the
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
 * The candidates are computed where both documents are already in hand — the
 * feature gate's two walks (../declared.ts, ../events/declared.ts) — and only
 * graded here, so the archive walk (./archived.ts) is paid for only when the
 * merged contract answers something at an address the living one does not.
 * `serviceRevivals` asks the same two functions per axis standalone, for
 * `loam rebase`, which reads no gate — on the event axis through the gate's
 * own reading of the pair (./event-pair.ts) — so the two can never grade one
 * tree two ways.
 */
import { existsSync } from "node:fs";
import type { Issue } from "../../vocabulary/issue.js";
import type { PathableService } from "../../kernel/ids/service.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featureSpecPaths } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "../../openapi/doc.js";
import { readOr } from "../../openapi/contract-text.js";
import { slotKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { EventMessage } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import {
  operationAddress,
  retiredKey,
  type RetiredIndex,
  type RetiredLookup,
  type Vacated,
  type Vacations,
} from "./archived.js";
import { readEventPair, type EventPairRead, type PairSides } from "./event-pair.js";
import { mergedOpenapiDoc } from "./merged.js";

/** The two remedies, spelled once: which one applies is the human's call, never loam's. */
const REMEDY =
  "Delete the quote if you only restated it; archive with --approve if the feature brings it back on purpose.";

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
   * Can this same delta take it out of every one of `besides`? A living
   * address the delta spells nothing at takes a removal marker; a declaration
   * inline under a channel is taken out by restating or retiring the channel
   * (`moveBackRemedy`). A key the delta already spells holds what it spells,
   * and a marker cannot be written beside it — the remedy that once named
   * one there could not be followed.
   */
  markable: boolean;
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
    return [{ id, at, livesAt, besides, markable: besides.every((b) => markable(b, livesAt)) }];
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
 */
export async function operationArrivals(sides: PairSides<OpenapiDoc>, context?: FleetContext): Promise<Arrival[]> {
  const { featPath, featDoc, livingPath, livingDoc, service } = sides;
  if (featDoc.unreadable || livingDoc.unreadable) return [];
  const living = opsPlaced(livingDoc.ops);
  if (arrivals(living, opsPlaced(featDoc.ops), () => true).length === 0) return [];
  const featureText = await readOr(featPath, context);
  const livingExists = existsSync(livingPath);
  const livingText = livingExists ? await readOr(livingPath, context) : undefined;
  if (featureText === undefined || (livingExists && livingText === undefined)) return [];
  const merged = mergedOpenapiDoc({ livingText, livingDoc, featureText, service });
  if (merged === undefined) return [];
  const spelled = new Set([...featDoc.ops, ...featDoc.anonymousRemovals].map(operationAddress));
  return arrivals(living, opsPlaced(merged.ops), (b, livesAt) => livesAt.includes(b) && !spelled.has(b));
}

/** What an event delta brings that the living contract does not have. */
export interface EventArrivals {
  /** `channels` and `operations` slots whose key the living contract lacks — their identity IS the key. */
  slots: AsyncapiSlot[];
  /** Message names at slots the living contract does not declare them in — the operation axis's arrivals. */
  messages: Arrival[];
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
  return { slots, messages: arrivals(messagesPlaced(livingDoc.messages), messagesPlaced(merged.messages), markable) };
}

/**
 * The vacations that make one arrival a revival — undefined when it is none.
 * Either the living contract answers the identity nowhere, and an archived
 * feature retired it (anywhere: a retired operation re-added at a new path is
 * the same operation back, and a message is its name wherever it is
 * declared) or moved it away from this very address; or the merged contract
 * answers it at two or more addresses, and an archived feature retired it at,
 * or moved it away from, this very address — an old address resurrected
 * beside the current one. An identity the merged contract answers at exactly
 * one address — a move back, a swap, a replacement with no operationId — is
 * never a revival, and neither is an address no archived feature vacated.
 *
 * Any archived feature — the one asking is never among them: coherence
 * grades only features in flight (status/feature/feature.ts), so a vacation
 * bearing the asking feature's id is another directory carrying the same
 * id, and as real as anyone's. Excluding it by id, as this once did, could
 * only hide a revival.
 */
function revivalOf({ at, livesAt, besides }: Arrival, vacations: Vacations | undefined): Vacations | undefined {
  if (vacations === undefined) return undefined;
  const [first, ...rest] = vacations.filter((v) =>
    livesAt.length === 0 ? v.to.length === 0 || v.at === at : besides.length > 0 && v.at === at,
  );
  return first === undefined ? undefined : [first, ...rest];
}

/** The operation arrivals that are revivals — each named for what happened, retired or vacated. */
export function revivedOperations(service: string, arrived: readonly Arrival[], index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  for (const arrival of arrived) {
    const by = revivalOf(arrival, index.operations.get(retiredKey(service, arrival.id)));
    if (by === undefined) continue;
    const { id, at, livesAt, besides } = arrival;
    const what = livesAt.length === 0
      ? `'${id}' (${at}), ${broughtBack(by)}`
      // A second address, not the operation back: it is living, so the
      // remedy is which address to drop — never "bring it back".
      : `'${id}' at ${at}, an address the living contract no longer has — ${vacators(by, " there")}${present(by, livesAt, "lives")}, and archiving this delta would put it back at ${at} beside ${besides.join(" and ")}: one operationId at ${count(besides.length + 1)} addresses. ${dropOne(arrival, `add a removal marker for '${id}' at ${besides.join(" and ")} to this same delta`)}`;
    issues.push({ severity: "warn", gates: true, code: "openapi.op-revived", subject: service, message: `${service}: this feature's openapi.yaml spells ${what}` });
  }
  return issues;
}

/**
 * How a delta takes a message name OUT of the places it is declared — the
 * move-back remedy, per place, toward wherever the message is moved back to
 * (`to`). A `components.messages` key is a slot, and a removal marker there
 * retires what it declares. A declaration INLINE under a channel is not: it
 * is the channel slot's interior (SCHEMA.md), so a marker nested on it
 * retires nothing — `asyncapi.remove-marker-inline`, and the deep strip
 * publishes the message without the marker. This once said "retire it at
 * channels.<ck>.messages.<mk>", a remedy that, followed exactly, changed
 * nothing and drew a second refusal. The channel is the unit: restated with
 * the message as a `$ref` (an upsert replaces the interior), or retired. The
 * channel key is read the way the archive plan's remove-marker-inline
 * message reads it, so the two name the same channel.
 */
export function moveBackRemedy(declaredAt: readonly string[], to: string): string {
  const steps = declaredAt.map((slot) => {
    if (!slot.startsWith("channels.")) return `retire it at ${slot}`;
    const channel = slot.slice("channels.".length, slot.lastIndexOf(".messages."));
    return `restate channel ${channel} with a $ref to ${to}, or retire channel ${channel}`;
  });
  return [...new Set(steps)].join("; and ");
}

/** The event arrivals that are revivals — `revivedOperations`' rule, on the slot and the message name. */
export function revivedEvents(service: string, arrived: EventArrivals, index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  const revive = (what: string): void => {
    issues.push({ severity: "warn", gates: true, code: "asyncapi.slot-revived", subject: service, message: `${service}: this feature's asyncapi.yaml declares ${what}` });
  };
  const revivedChannels = new Set<string>();
  for (const slot of arrived.slots) {
    const by = index.slots.get(retiredKey(service, slot.section, slot.key));
    if (by === undefined) continue;
    if (slot.section === "channels") revivedChannels.add(slot.key);
    revive(`${slot.section}.${slot.key}, ${broughtBack(by)}`);
  }
  for (const arrival of arrived.messages) {
    // A message declared inline under a channel that is itself coming back is
    // that channel's interior, and the channel's finding already names the
    // revival — one act, one finding.
    if ([...revivedChannels].some((ck) => arrival.at.startsWith(`channels.${ck}.messages.`))) continue;
    const by = revivalOf(arrival, index.messages.get(retiredKey(service, arrival.id)));
    if (by === undefined) continue;
    const { id, at, livesAt, besides } = arrival;
    revive(livesAt.length === 0
      ? `message '${id}' (${at}), ${broughtBack(by)}`
      : `message '${id}' at ${at}, a key the living contract no longer has — ${vacators(by, " there")}${present(by, livesAt, "is declared")}, and archiving this delta would declare it at ${at} beside ${besides.join(" and ")}: one message name in ${count(besides.length + 1)} places. ${dropOne(arrival, `${moveBackRemedy(besides, at)} in this same delta`)}`);
  }
  return issues;
}

/** What `serviceRevivals` needs: the feature, the service, and the run's reads. */
export interface ServiceRevivalRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  service: PathableService;
  retired: RetiredLookup;
  context?: FleetContext;
}

/**
 * Both axes' revival findings for one service, read standalone — the gate's
 * two walks compute the same arrivals from the documents they already hold;
 * `loam rebase` holds none, and must not pin a revived operation as if this
 * feature were adding it. One detection, the gate's: `operationArrivals` on
 * the contract axis, and on the event axis `readEventPair` and
 * `eventArrivals`, the walk's own reader and candidates.
 */
export async function serviceRevivals(request: ServiceRevivalRequest): Promise<Issue[]> {
  const { docsDir, featureDir, service, retired, context } = request;
  const feature = featureSpecPaths(featureDir, service);
  const living = await locateServicePaths(docsDir, service, context);
  const issues: Issue[] = [];

  if (existsSync(feature.openapi)) {
    const featDoc = await readOpenapi(feature.openapi, context);
    const livingDoc = await readOpenapi(living.openapi, context);
    const sides = { featPath: feature.openapi, featDoc, livingPath: living.openapi, livingDoc, service };
    const ops = await operationArrivals(sides, context);
    if (ops.length > 0) issues.push(...revivedOperations(service, ops, await retired()));
  }

  if (!existsSync(feature.asyncapi)) return issues;
  const featDoc = await readAsyncapi(feature.asyncapi, context);
  // An unreadable delta is `asyncapi.invalid` in the gate, which grades
  // nothing else against it; the guards on the living side are the pair's.
  if (featDoc.unreadable) return issues;
  const livingDoc = await readAsyncapi(living.asyncapi, context);
  const sides = { featPath: feature.asyncapi, featDoc, livingPath: living.asyncapi, livingDoc, service };
  const events = eventArrivals(await readEventPair(sides, context));
  if (events.slots.length > 0 || events.messages.length > 0) issues.push(...revivedEvents(service, events, await retired()));
  return issues;
}

/** The retired shape: absent from living, so the merge reads it as an addition. */
function broughtBack(by: Vacations): string {
  return `which the living contract no longer has — ${vacators(by, "")}, and archiving this delta would put it back. ${REMEDY}`;
}

/**
 * The duplicate shape's remedy, naming the address to drop: the quote, if it
 * only restated the entry; to move it back on purpose, every other address —
 * through `moveBack` when this delta can take the entry out of all of them,
 * and otherwise only by keeping both under `--approve`, never a marker at a
 * key the delta already spells.
 */
function dropOne({ at, besides, markable }: Arrival, moveBack: string): string {
  const keep = `Delete the quote at ${at} if you only restated it, and make any change at ${besides.join(" and ")}`;
  return markable
    ? `${keep}; to move it back on purpose, ${moveBack}.`
    : `${keep}; archive with --approve if the feature brings it back there on purpose.`;
}

function count(n: number): string {
  return n === 2 ? "two" : String(n);
}

/** "FEAT-112", "FEAT-112 and FEAT-140", "FEAT-1, FEAT-2 and FEAT-3". */
function idList([first, ...rest]: readonly [string, ...string[]]): string {
  return rest.reduce((said, id, i) => `${said}${i === rest.length - 1 ? " and" : ","} ${id}`, first);
}

/**
 * Who took an entry out, and how — "archived FEAT-112 retired it",
 * "archived FEAT-200 moved it to POST /y" — each feature once, in id order,
 * movers that put it in the same place sharing one clause and retirers
 * last. `there` places a retirement at the address the finding names, where
 * the entry lives on elsewhere and the difference matters.
 */
function vacators(by: Vacations, there: string): string {
  const byDestination = new Map<string, [string, ...string[]]>();
  const retirers: string[] = [];
  for (const { by: id, to } of by) {
    if (to.length === 0) {
      if (!retirers.includes(id)) retirers.push(id);
      continue;
    }
    const where = to.join(" and ");
    const ids = byDestination.get(where);
    if (ids === undefined) byDestination.set(where, [id]);
    else if (!ids.includes(id)) ids.push(id);
  }
  const clauses = [...byDestination].map(([where, ids], i) => `${idList(ids)} ${i === 0 ? "moved it " : ""}to ${where}`);
  const [first, ...rest] = retirers;
  if (first !== undefined) clauses.push(`${idList([first, ...rest])} retired it${there}`);
  return `archived ${clauses.reduce((all, clause, i) => `${all}${i === clauses.length - 1 ? ", and" : ","} ${clause}`)}`;
}

/**
 * Where the entry stands now — "…, where it lives now" when every vacation
 * was a move to exactly there, and said apart otherwise ("; it lives at
 * POST /z now"): the two part ways once anything lands after a move, and
 * this once credited a later feature's address to the mover (`Vacated`).
 * `verb` is how the axis says it — an operation "lives", a message "is
 * declared".
 */
function present(by: readonly Vacated[], livesAt: readonly string[], verb: "lives" | "is declared"): string {
  const now = new Set(livesAt);
  const unchanged = by.every(({ to }) => to.length > 0 && to.length === now.size && to.every((where) => now.has(where)));
  return unchanged ? `, where it ${verb} now` : `; it ${verb} at ${livesAt.join(" and ")} now`;
}
