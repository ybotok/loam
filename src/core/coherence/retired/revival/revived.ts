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
 * The candidates — what the contract the archive would WRITE answers that
 * the living one does not (./arrivals.ts) — are computed where both
 * documents are already in hand, in the feature gate's two walks
 * (../../declared.ts, ../../events/declared.ts), and only graded here, so
 * the archive walk (../archived.ts) is paid for only when the merged
 * contract answers something at an address the living one does not.
 * `serviceRevivals` asks the same two functions per axis standalone, for
 * `loam rebase`, which reads no gate — on the event axis through the gate's
 * own reading of the pair (../event-pair.ts) — so the two can never grade one
 * tree two ways.
 */
import { existsSync } from "node:fs";
import type { Issue } from "../../../vocabulary/issue.js";
import type { PathableService } from "../../../kernel/ids/service.js";
import type { DocsDir, FeatureDir } from "../../../kernel/ids/dirs.js";
import { featureSpecPaths } from "../../../repo/paths.js";
import { locateServicePaths } from "../../../repo/service-target.js";
import { readOpenapi } from "../../../openapi/doc.js";
import { readAsyncapi } from "../../../asyncapi/read.js";
import { entriesOf } from "../../../asyncapi/digest.js";
import { collectRefs } from "../../../openapi/depth.js";
import type { FleetContext } from "../../../fleet-context.js";
import { retiredKey, type RetiredIndex, type RetiredLookup, type Vacated, type Vacations } from "../archived.js";
import { readEventPair } from "../event-pair.js";
import { eventArrivals, operationArrivals, type Arrival, type EventArrivals } from "./arrivals.js";

/** The two remedies, spelled once: which one applies is the human's call, never loam's. */
const REMEDY =
  "Delete the quote if you only restated it; archive with --approve if the feature brings it back on purpose.";

/**
 * The vacations that make one arrival a revival — undefined when it is none.
 * Either the living contract answers the identity nowhere, and an archived
 * feature retired it (anywhere: a retired operation re-added at a new path is
 * the same operation back, and a message is its name wherever it is
 * declared) or moved it away from this very address; or the merged contract
 * answers it at two or more addresses, and an archived feature retired it at,
 * or moved it away from, this very address — an old address resurrected
 * beside the current one. An identity the living contract still holds that
 * the merged contract answers at exactly one address — a move back, a swap,
 * a replacement with no operationId — is never a revival, and neither is an
 * address no archived feature vacated. One the living contract holds nowhere
 * is the first case at one address too: this once said "exactly one address
 * is never a revival" unqualified, and a quote of an address a move vacated,
 * after a hand edit took the id out of where the move put it, is one.
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
      ? `'${id}' (${at}), ${broughtBack(by, replacing(arrival, "holds"))}`
      // A second address, not the operation back: it is living, so the
      // remedy is which address to drop — never "bring it back".
      : `'${id}' at ${at}, ${arrival.replaces === undefined ? "an address the living contract no longer has" : "an address it no longer lives at"} — ${vacators(by, " there")}${present(by, livesAt, "lives")}, and archiving this delta would put it back at ${at} beside ${besides.join(" and ")}: one operationId at ${count(besides.length + 1)} addresses.${replacing(arrival, "holds")} ${dropOne(arrival, `add a removal marker for '${id}' at ${besides.join(" and ")} to this same delta${keeping(arrival, "address")}`)}`;
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
 *
 * A `components.messages` key is retired by its marker, but a channel (or an
 * operation) of the contract the merge would leave (`root`) that still
 * `$ref`s it would point at nothing: its send stops sending the message,
 * `asyncapi.remove-message-consumed` where the fleet consumes it. This once
 * said only "retire it at components.messages.<K2>", a remedy that, followed
 * exactly, drew that error — so every slot still pointing there is named,
 * to restate with the `$ref` pointed at `to`.
 */
export function moveBackRemedy(declaredAt: readonly string[], to: string, root: unknown): string {
  const steps = declaredAt.map((slot) => {
    if (!slot.startsWith("channels.")) {
      const holders = pointingAt(root, slot);
      return holders.length === 0 ? `retire it at ${slot}` : `retire it at ${slot}, and restate ${holders.join(" and ")} with every $ref to ${slot} pointed at ${to}`;
    }
    const channel = slot.slice("channels.".length, slot.lastIndexOf(".messages."));
    return `restate channel ${channel} with a $ref to ${to}, or retire channel ${channel}`;
  });
  return [...new Set(steps)].join("; and ");
}

/** The channels and operations of `root` holding a `$ref` to one `components.messages` slot, at any depth. */
function pointingAt(root: unknown, slot: string): string[] {
  const key = slot.slice("components.messages.".length);
  // JSON Pointer escaping, `~` before `/`, so a key spelling either is the pointer that reaches it.
  const pointer = `#/components/messages/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  const sections = root !== null && typeof root === "object" ? (root as Record<string, unknown>) : {};
  return (["channels", "operations"] as const).flatMap((section) =>
    entriesOf(sections[section])
      .filter(([, node]) => collectRefs(node).includes(pointer))
      .map(([key]) => `${section === "channels" ? "channel" : "operation"} ${key}`),
  );
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
    // revival — one act, one finding. Only while the merged contract declares
    // the name nowhere else: where it does, the channel's finding says nothing
    // of the second place, and this was once skipped all the same — a stale
    // delta restating a channel whose inline message an archived feature
    // re-declared under components archived under --approve into
    // `asyncapi.duplicate-message`.
    if (arrival.besides.length === 0 && [...revivedChannels].some((ck) => arrival.at.startsWith(`channels.${ck}.messages.`))) continue;
    const by = revivalOf(arrival, index.messages.get(retiredKey(service, arrival.id)));
    if (by === undefined) continue;
    const { id, at, livesAt, besides } = arrival;
    revive(livesAt.length === 0
      ? `message '${id}' (${at}), ${broughtBack(by, replacing(arrival, "declares"))}`
      : `message '${id}' at ${at}, ${arrival.replaces === undefined ? "a key the living contract no longer has" : "a key it is no longer declared at"} — ${vacators(by, " there")}${present(by, livesAt, "is declared")}, and archiving this delta would declare it at ${at} beside ${besides.join(" and ")}: one message name in ${count(besides.length + 1)} places.${replacing(arrival, "declares")} ${dropOne(arrival, `${moveBackRemedy(besides, at, arrived.mergedRoot)} in this same delta${keeping(arrival, "key")}`)}`);
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
  /**
   * The text rebase will write, by the path it writes it to — a contract
   * delta absent here is graded as it stands on disk (`PairSides.featText`).
   */
  planned?: ReadonlyMap<string, string>;
}

/**
 * Both axes' revival findings for one service, read standalone — the gate's
 * two walks compute the same arrivals from the documents they already hold;
 * `loam rebase` holds none, and must not pin a revived operation as if this
 * feature were adding it. One detection, the gate's: `operationArrivals` on
 * the contract axis, and on the event axis `readEventPair` and
 * `eventArrivals`, the walk's own reader and candidates. Asked of the text
 * rebase will WRITE (`planned`), not the text it found: its repin can turn a
 * skipped quote into an edit, and the revival that edit makes is the one the
 * next validate reports — this once ran over the delta as on disk, before
 * the repin, and stayed silent about it.
 */
export async function serviceRevivals(request: ServiceRevivalRequest): Promise<Issue[]> {
  const { docsDir, featureDir, service, retired, context, planned } = request;
  const feature = featureSpecPaths(featureDir, service);
  const living = await locateServicePaths(docsDir, service, context);
  const issues: Issue[] = [];

  if (existsSync(feature.openapi)) {
    const featDoc = await readOpenapi(feature.openapi, context);
    const livingDoc = await readOpenapi(living.openapi, context);
    const sides = { featPath: feature.openapi, featDoc, livingPath: living.openapi, livingDoc, service, featText: planned?.get(feature.openapi) };
    const ops = await operationArrivals(sides, context);
    if (ops.length > 0) issues.push(...revivedOperations(service, ops, await retired()));
  }

  if (!existsSync(feature.asyncapi)) return issues;
  const featDoc = await readAsyncapi(feature.asyncapi, context);
  // An unreadable delta is `asyncapi.invalid` in the gate, which grades
  // nothing else against it; the guards on the living side are the pair's.
  if (featDoc.unreadable) return issues;
  const livingDoc = await readAsyncapi(living.asyncapi, context);
  const sides = { featPath: feature.asyncapi, featDoc, livingPath: living.asyncapi, livingDoc, service, featText: planned?.get(feature.asyncapi) };
  const events = eventArrivals(await readEventPair(sides, context));
  if (events.slots.length > 0 || events.messages.length > 0) issues.push(...revivedEvents(service, events, await retired()));
  return issues;
}

/** The retired shape: absent from living, so the merge reads it as an addition. */
function broughtBack(by: Vacations, replaced = ""): string {
  return `which the living contract no longer has — ${vacators(by, "")}, and archiving this delta would put it back.${replaced} ${REMEDY}`;
}

/** The entry the merge would replace at the arrival's address, said as a sentence of its own — or nothing. */
function replacing({ at, replaces }: Arrival, verb: "holds" | "declares"): string {
  return replaces === undefined ? "" : ` ${at} now ${verb} '${replaces}', and archiving this delta replaces it there.`;
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

/**
 * A move back over another living entry takes that entry out too, unless the
 * same delta puts it elsewhere — said in the remedy, because followed as it
 * once read, the move back reached a clean gate and an archive that deleted
 * the other entry with nothing naming it.
 */
function keeping({ replaces }: Arrival, place: "address" | "key"): string {
  return replaces === undefined ? "" : ` — and define '${replaces}' at another ${place} in it if it is to stay`;
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
