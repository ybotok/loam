/**
 * The revival findings: a feature delta spelling something the living contract
 * no longer has, which an ARCHIVED feature retired — or spelling it at an
 * address an archived feature MOVED it away from, which would put it back
 * there beside where it lives now.
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
 * The candidates are computed where both documents are already in hand — the
 * feature gate's two walks (../declared.ts, ../events/declared.ts) — and only
 * graded here, so the archive walk (./archived.ts) is paid for only when some
 * entry is absent from the living contract at all. `serviceRevivals` is the
 * same question asked standalone, for `loam rebase`, which reads no gate — on
 * the event axis through the gate's own reading of the pair
 * (./event-pair.ts), so the two cannot grade one tree two ways.
 */
import { existsSync } from "node:fs";
import type { Issue } from "../../vocabulary/issue.js";
import type { PathableService } from "../../kernel/ids/service.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featureSpecPaths } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "../../openapi/doc.js";
import { classifyBaselineDigests } from "../../openapi/digest.js";
import { slotKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { EventMessage } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import { retiredKey, type ArchivedBy, type RetiredIndex, type RetiredLookup } from "./archived.js";
import { readEventPair, type EventPairRead } from "./event-pair.js";
import { messageRetirements, operationRetirements } from "./retirement.js";

/** The two remedies, spelled once: which one applies is the human's call, never loam's. */
const REMEDY =
  "Delete the quote if you only restated it; archive with --approve if the feature brings it back on purpose.";

/**
 * One delta entry the living contract does not hold as spelled, and where the
 * living contract holds its identity instead: nowhere, for an entry absent by
 * identity (new, or retired); the addresses it lives at now, for one spelled at
 * an address it is not at (new there, or moved away by an archived feature) —
 * only those the merge would leave it at. An address this same delta rewrites
 * is not one archiving would leave the identity at, so it is no second
 * address, and a delta rewriting every one of them is moving the entry back.
 */
export interface Absent<T> {
  entry: T;
  livesAt: string[];
}

/** `METHOD /path` — how every finding here names an operation's address. */
const address = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

/**
 * The feature operations the living contract does not hold as spelled — the
 * only ones a revival can be. By id first: a retired operation quoted at a new
 * path is the same operation coming back. Then by address: an operation whose
 * id lives on at ANOTHER slot, spelled at a slot the living contract leaves
 * empty, would put the id back at an address it left — invisible to the
 * slot-keyed baseline gate (nothing living at the slot) and to the id check
 * above (the id is living). Not when this delta itself carries a removal
 * marker for the id: then the quote is its own relocation, stated, and the
 * merge leaves the id at one address. Nor when it defines ANOTHER operation
 * at every slot the id lives at: the merge writes per method and path, so
 * that definition replaces the living one, and the delta is a swap moving
 * the id back — which this once called a revival, with a remedy (a marker at
 * the slot) nobody could write, the YAML key already holding the other
 * operation. An unreadable side proves nothing (`openapi.invalid` owns it),
 * so it yields no candidate.
 */
export function absentOperations(featDoc: OpenapiDoc, livingDoc: OpenapiDoc): Absent<Operation>[] {
  if (featDoc.unreadable || livingDoc.unreadable) return [];
  const living = livingDoc.ops.filter((op) => !op.remove);
  const relocating = operationRetirements(featDoc.ops).markerIds;
  const absent: Absent<Operation>[] = [];
  for (const op of featDoc.ops) {
    if (op.remove) continue;
    const at = living.filter((l) => l.id === op.id);
    if (at.length === 0) {
      absent.push({ entry: op, livesAt: [] });
      continue;
    }
    const occupied = living.some((l) => l.method === op.method && l.path === op.path);
    if (occupied || relocating.has(op.id)) continue;
    const livesAt = at.filter((l) => !overwritten(l, featDoc.ops)).map(address);
    if (livesAt.length > 0) absent.push({ entry: op, livesAt });
  }
  return absent;
}

/**
 * Does the delta write ANOTHER operation over living `l`'s slot? The merge's
 * own rule (openapi/merge/merge.ts): a definition at the same method and path
 * replaces what stands there — unless it is a QUOTE, equal to its own pin,
 * which the merge never writes, so the living operation stays. A definition
 * carrying `l`'s own id is a restatement of it, not a replacement.
 */
function overwritten(l: Operation, ops: readonly Operation[]): boolean {
  return ops.some(
    (o) =>
      !o.remove &&
      o.method === l.method &&
      o.path === l.path &&
      o.id !== l.id &&
      classifyBaselineDigests(o.basedOn, o.digest, l.digest) !== "quote",
  );
}

/**
 * `absentOperations` that an archived feature retired, or moved away from the
 * address the delta spells — each named for what happened. Any archived feature —
 * the one asking is never among them: coherence grades only features in flight
 * (status/feature/feature.ts), so a retirer bearing the asking feature's id is
 * another directory carrying the same id, and its retirement is as real as
 * anyone's. Excluding it by id, as this once did, could only hide a revival.
 */
export function revivedOperations(service: string, absent: readonly Absent<Operation>[], index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  const revive = (what: string): void => {
    issues.push({ severity: "warn", gates: true, code: "openapi.op-revived", subject: service, message: `${service}: this feature's openapi.yaml spells ${what}` });
  };
  for (const { entry: op, livesAt } of absent) {
    const at = address(op);
    if (livesAt.length === 0) {
      const by = index.operations.get(retiredKey(service, op.id));
      if (by !== undefined) revive(`'${op.id}' (${at}), which the living contract no longer has — ${retirers(by)} retired it, and archiving this delta would put it back. ${REMEDY}`);
      continue;
    }
    // Moved, not retired: the remedy is not "bring it back" — it never left.
    const by = index.movedOperations.get(retiredKey(service, op.id, op.method, op.path));
    if (by === undefined) continue;
    const where = livesAt.join(" and ");
    revive(`'${op.id}' at ${at}, an address the living contract no longer has — ${retirers(by)} moved it to ${where}, where it lives now, and archiving this delta would put it back at ${at} as well: one operationId at two addresses. Delete the quote if you only restated it, and make any change at ${where}; to move it back on purpose, add a removal marker for '${op.id}' at ${where} to this same delta.`);
  }
  return issues;
}

/** What an event delta declares that the living contract does not have. */
export interface AbsentEvents {
  /** `channels` and `operations` slots whose key the living contract lacks — their identity IS the key. */
  slots: AsyncapiSlot[];
  /**
   * Message declarations whose NAME the living contract lacks — the join
   * token, wherever it is declared — and `components.messages` declarations
   * of a name the living contract declares elsewhere and the merge would
   * leave there, at a key it leaves empty: the operation axis's moved
   * address, on the one slot a message relocation vacates.
   */
  messages: Absent<EventMessage>[];
}

/**
 * The event axis's candidates. A `components.messages` slot is graded by the
 * message NAME it declares, not by its key: the name is what every join reads,
 * so a retired message redeclared under a new key is the same message back,
 * and a new message reusing a dead key is not. Absent from living is a
 * candidate; a living side that does not answer (./event-pair.ts) proves
 * nothing, so it yields none.
 */
export function absentEvents(read: EventPairRead): AbsentEvents {
  const { featDoc, featSlots, livingDoc, livingSlots } = read;
  if (!read.livingAnswers || featDoc.unreadable || livingDoc.unreadable) return { slots: [], messages: [] };
  const living = livingDoc.messages.filter((m) => m.remove !== true);
  const occupied = new Set(livingDoc.messages.map((m) => m.slot));
  // A name this delta marks for removal somewhere is its own relocation, as
  // on the operation axis — stated, and leaving the name in one place.
  const relocating = messageRetirements(featDoc, featSlots, livingDoc).markerNames;
  const messages: Absent<EventMessage>[] = [];
  for (const m of featDoc.messages) {
    if (m.remove === true) continue;
    const declaredAt = living.filter((l) => l.name === m.name).map((l) => l.slot);
    if (declaredAt.length === 0) {
      messages.push({ entry: m, livesAt: [] });
      continue;
    }
    const displaced = m.slot.startsWith("components.messages.") && !occupied.has(m.slot) && !relocating.has(m.name);
    if (!displaced) continue;
    const livesAt = surviving(read, m.name, declaredAt);
    if (livesAt.length > 0) messages.push({ entry: m, livesAt });
  }
  return {
    slots: featSlots.filter((s) => !s.remove && s.section !== "components.messages" && !livingSlots.has(slotKey(s))),
    messages,
  };
}

/**
 * Which of the places the living contract declares `name` the merge would
 * leave it declared at — read off the pair's merge simulation, not re-derived:
 * an upsert of a channel replaces its interior wholesale, a channel marker
 * takes the interior with it, a quoted channel keeps the living one, and a
 * marker nested on an inline message retires nothing (the deep strip
 * publishes the message without it). Reading the living contract alone, as
 * this once did, took a channel restated with a `$ref` as still declaring the
 * message inline, and called a deliberate move back "one message name in two
 * places". A merge the pair refuses has no answer, and the living
 * declarations stand — the archive refuses that merge by name.
 */
function surviving(read: EventPairRead, name: string, declaredAt: readonly string[]): string[] {
  const after = read.merged();
  if (after === undefined) return [...declaredAt];
  return declaredAt.filter((slot) => after.messages.some((d) => d.remove !== true && d.name === name && d.slot === slot));
}

/**
 * How a delta takes a message name OUT of the places it is declared — the
 * move-back remedy, per place, toward wherever the message is moved back to
 * (`to`, a `components.messages` slot). A `components.messages` key is a
 * slot, and a removal marker there retires what it declares. A declaration
 * INLINE under a channel is not: it is the channel slot's interior
 * (SCHEMA.md), so a marker nested on it retires nothing —
 * `asyncapi.remove-marker-inline`, and the deep strip publishes the message
 * without the marker. This once said "retire it at
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

/** `absentEvents` that an archived feature retired, or moved away from the key spelled — any archived feature, `revivedOperations`' reason. */
export function revivedEvents(service: string, absent: AbsentEvents, index: RetiredIndex): Issue[] {
  const issues: Issue[] = [];
  const revive = (what: string, by: ArchivedBy): void => {
    issues.push({
      severity: "warn",
      gates: true,
      code: "asyncapi.slot-revived",
      subject: service,
      message: `${service}: this feature's asyncapi.yaml declares ${what}, which the living contract no longer has — ${retirers(by)} retired it, and archiving this delta would put it back. ${REMEDY}`,
    });
  };
  const moved = (message: EventMessage, livesAt: readonly string[], by: ArchivedBy): void => {
    const where = livesAt.join(" and ");
    issues.push({
      severity: "warn",
      gates: true,
      code: "asyncapi.slot-revived",
      subject: service,
      message: `${service}: this feature's asyncapi.yaml declares message '${message.name}' at ${message.slot}, a key the living contract no longer has — ${retirers(by)} moved it to ${where}, where it is declared now, and archiving this delta would declare it at ${message.slot} as well: one message name in two places. Delete the quote if you only restated it, and make any change at ${where}; to move it back on purpose, ${moveBackRemedy(livesAt, message.slot)} in this same delta.`,
    });
  };
  const revivedChannels = new Set<string>();
  for (const slot of absent.slots) {
    const by = index.slots.get(retiredKey(service, slot.section, slot.key));
    if (by === undefined) continue;
    if (slot.section === "channels") revivedChannels.add(slot.key);
    revive(`${slot.section}.${slot.key}`, by);
  }
  for (const { entry: message, livesAt } of absent.messages) {
    // A message declared inline under a channel that is itself coming back is
    // that channel's interior, and the channel's finding already names the
    // revival — one act, one finding.
    if ([...revivedChannels].some((ck) => message.slot.startsWith(`channels.${ck}.messages.`))) continue;
    if (livesAt.length > 0) {
      const by = index.movedMessages.get(retiredKey(service, message.name, message.slot));
      if (by !== undefined) moved(message, livesAt, by);
      continue;
    }
    const by = index.messages.get(retiredKey(service, message.name));
    if (by === undefined) continue;
    revive(`message '${message.name}' (${message.slot})`, by);
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
 * two walks compute the same candidates from the documents they already hold;
 * `loam rebase` holds none, and must not pin a revived operation as if this
 * feature were adding it. One reading of each document, the gate's: by id on
 * the contract axis through `absentOperations`, and on the event axis through
 * `readEventPair` and `absentEvents`, the walk's own reader and candidates.
 */
export async function serviceRevivals(request: ServiceRevivalRequest): Promise<Issue[]> {
  const { docsDir, featureDir, service, retired, context } = request;
  const feature = featureSpecPaths(featureDir, service);
  const living = await locateServicePaths(docsDir, service, context);
  const issues: Issue[] = [];

  const ops = existsSync(feature.openapi)
    ? absentOperations(await readOpenapi(feature.openapi, context), await readOpenapi(living.openapi, context))
    : [];
  if (ops.length > 0) issues.push(...revivedOperations(service, ops, await retired()));

  if (!existsSync(feature.asyncapi)) return issues;
  const featDoc = await readAsyncapi(feature.asyncapi, context);
  // An unreadable delta is `asyncapi.invalid` in the gate, which grades
  // nothing else against it; the guards on the living side are the pair's.
  if (featDoc.unreadable) return issues;
  const livingDoc = await readAsyncapi(living.asyncapi, context);
  const sides = { featPath: feature.asyncapi, featDoc, livingPath: living.asyncapi, livingDoc, service };
  const events = absentEvents(await readEventPair(sides, context));
  if (events.slots.length > 0 || events.messages.length > 0) issues.push(...revivedEvents(service, events, await retired()));
  return issues;
}

/** "archived FEAT-112", "archived FEAT-112 and FEAT-140", "archived FEAT-1, FEAT-2 and FEAT-3". */
function retirers(by: ArchivedBy): string {
  const [first, ...rest] = by;
  const list = rest.reduce((said, id, i) => `${said}${i === rest.length - 1 ? " and" : ","} ${id}`, first);
  return `archived ${list}`;
}
